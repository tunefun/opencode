package ai.opencode.jetbrains.toolwindow;

import ai.opencode.jetbrains.protocol.FileSelection;
import ai.opencode.jetbrains.protocol.HostMessage;
import ai.opencode.jetbrains.protocol.WebviewMessage;
import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefClient;
import org.cef.CefApp;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.net.URI;

import ai.opencode.jetbrains.actions.OpenDevToolsAction;
import ai.opencode.jetbrains.services.OpenCodeServer;

public class ChatToolWindowFactory implements ToolWindowFactory {

    private static final Logger log = Logger.getInstance(ChatToolWindowFactory.class);

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ChatPanel panel = new ChatPanel(project, toolWindow);
        var content = toolWindow.getContentManager().getFactory().createContent(panel, null, false);
        content.setDisposer(() -> {
            panel.disposeBrowser();
            releaseServer(project);
        });
        toolWindow.getContentManager().addContent(content);
        toolWindow.setTitleActions(java.util.List.of(new OpenDevToolsAction(panel)));
        startServer(project, panel);
    }

    private void startServer(Project project, ChatPanel panel) {
        String workspaceDir = project.getBasePath();
        if (workspaceDir == null) return;
        OpenCodeServer server = ApplicationManager.getApplication()
            .getService(OpenCodeServer.class);
        server.ensureStarted(workspaceDir)
            .thenAccept(v -> {
                ApplicationManager.getApplication().invokeLater(() -> panel.setServerPort(server.getPort()));
            })
            .exceptionally(e -> {
                log.warn("OpenCode: failed to start server: " + e.getMessage());
                return null;
            });
    }

    private void releaseServer(Project project) {
        String workspaceDir = project.getBasePath();
        if (workspaceDir == null) return;
        OpenCodeServer server = ApplicationManager.getApplication()
            .getService(OpenCodeServer.class);
        server.releaseProject(workspaceDir);
    }

    @Override
    public boolean shouldBeAvailable(@NotNull Project project) {
        return true;
    }

    public static class ChatPanel extends JPanel {

        private static final Logger log = Logger.getInstance(ChatPanel.class);
        private final Project project;
        private final ToolWindow toolWindow;
        private final String projectDir;
        private final JBCefClient client;
        private final MutableString indexHtml = new MutableString("");
        private JBCefBrowser browser;
        private ChatWebviewBridge bridge;
        private int serverPort;
        private boolean devToolsWarningShown;

        public ChatPanel(Project project, ToolWindow toolWindow) {
            super(new BorderLayout());
            this.project = project;
            this.toolWindow = toolWindow;
            this.projectDir = normalizePath(project.getBasePath() != null ? project.getBasePath() : System.getProperty("user.dir"));
            this.client = JBCefApp.getInstance().createClient();
            if (client.getProperty(JBCefClient.Properties.JS_QUERY_POOL_SIZE) == null) {
                client.setProperty(JBCefClient.Properties.JS_QUERY_POOL_SIZE, 20);
            }

            WebviewSchemeHandlerFactory factory = new WebviewSchemeHandlerFactory(indexHtml);
            CefApp.getInstance().registerSchemeHandlerFactory("http", "plugin-internal", factory);

            javax.swing.UIManager.addPropertyChangeListener(evt -> {
                if ("lookAndFeel".equals(evt.getPropertyName())) syncTheme();
            });

            createBrowser();
        }

        private void createBrowser() {
            removeAll();
            browser = JBCefBrowser.createBuilder().setClient(client).build();
            add(browser.getComponent(), BorderLayout.CENTER);
            bridge = new ChatWebviewBridge(browser, projectDir);
            bridge.setMessageHandler(msg -> handleWebviewMessage(msg));
            initWebviewIfReady();
        }

        @Override
        public void addNotify() {
            super.addNotify();
            if (browser == null || browser.isDisposed()) {
                createBrowser();
            } else {
                initWebviewIfReady();
            }
        }

        public void setServerPort(int port) {
            if (serverPort == port) return;
            serverPort = port;
            if (bridge != null && bridge.isLoaded()) {
                bridge.load(port, indexHtml);
            } else {
                initWebviewIfReady();
            }
        }

        private void initWebviewIfReady() {
            if (serverPort == 0 || browser == null || browser.isDisposed()) return;
            if (bridge != null && bridge.isLoaded()) return;

            ApplicationManager.getApplication().invokeLater(() -> {
                if (browser == null || browser.isDisposed()) return;
                if (bridge != null && !bridge.isLoaded()) bridge.load(serverPort, indexHtml);
            });
        }

        public void addFile(String path, FileSelection selection) {
            if (bridge != null) bridge.postMessage(HostMessage.addFile(path, selection));
        }

        public void addSelection() {
            var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            if (editor == null) {
                var files = FileEditorManager.getInstance(project).getSelectedFiles();
                if (files != null && files.length > 0) addFile(files[0].getPath(), null);
                return;
            }
            var doc = editor.getDocument();
            var vf = editor.getVirtualFile();
            if (vf == null) return;
            var sel = editor.getSelectionModel();
            if (sel.hasSelection()) {
                int startOffset = sel.getSelectionStart();
                int endOffset = sel.getSelectionEnd();
                int startLine = doc.getLineNumber(startOffset);
                int startChar = startOffset - doc.getLineStartOffset(startLine);
                int endLine = doc.getLineNumber(endOffset);
                int endChar = endOffset - doc.getLineStartOffset(endLine);
                addFile(vf.getPath(), new FileSelection(startLine + 1, startChar + 1, endLine + 1, endChar + 1));
            } else {
                addFile(vf.getPath(), null);
            }
        }

        public void focus() {
            focusInput();
        }

        public void focusInput() {
            if (bridge != null) bridge.postMessage(HostMessage.focusInput());
        }

        public void openDevTools() {
            if (browser == null || browser.isDisposed()) return;
            if (isOutOfProcessJcef()) {
                notifyOutOfProcessJcefWorkaround();
            }
            browser.createImmediately();
            browser.openDevtools();
        }

        private static boolean isOutOfProcessJcef() {
            // Out-of-process JCEF (remote_* JBR builds, enabled by default since 2025.1) cannot
            // render DevTools for plugin-created browsers (JetBrains IJPL-227022 / JBR-9559).
            return "true".equalsIgnoreCase(System.getProperty("jcef.remote.enabled"));
        }

        private void notifyOutOfProcessJcefWorkaround() {
            if (devToolsWarningShown) return;
            devToolsWarningShown = true;
            ApplicationManager.getApplication().invokeLater(() -> {
                var notification = new com.intellij.notification.Notification(
                    "OpenCode Chat",
                    "OpenCode DevTools may not render",
                    "Your IDE runs JCEF in out-of-process mode, which is incompatible with the plugin's DevTools window (JetBrains issue IJPL-227022). " +
                        "If DevTools opens blank, disable it via Help | Registry | ide.browser.jcef.out-of-process.enabled = false and restart the IDE.",
                    com.intellij.notification.NotificationType.WARNING
                );
                notification.notify(project);
            });
        }

        private void handleWebviewMessage(WebviewMessage msg) {
            switch (msg.type) {
                case "ready":
                    if (bridge != null) bridge.postMessage(HostMessage.init(projectDir));
                    break;
                case "openFile":
                    if (msg.path != null) openFileInEditor(msg.path, msg.selection);
                    break;
                case "openLink":
                    if (msg.url != null) openExternalLink(msg.url);
                    break;
                case "restart":
                    restartIDE();
                    break;
                case "webviewError":
                    log.warn("Webview error: " + msg.message);
                    break;
            }
        }

        private void openFileInEditor(String filePath, FileSelection selection) {
            ApplicationManager.getApplication().invokeLater(() -> {
                try {
                    var vf = LocalFileSystem.getInstance().findFileByPath(filePath);
                    if (vf == null) vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(filePath);
                    if (vf == null) { log.warn("File not found: " + filePath); return; }
                    var editors = FileEditorManager.getInstance(project).openFile(vf, true);
                    if (selection != null && editors != null && editors.length > 0 && editors[0] instanceof TextEditor) {
                        var editor = ((TextEditor) editors[0]).getEditor();
                        var doc = editor.getDocument();
                        int so = doc.getLineStartOffset(selection.startLine - 1) + (selection.startChar - 1);
                        int eo = doc.getLineStartOffset(selection.endLine - 1) + (selection.endChar - 1);
                        editor.getSelectionModel().setSelection(so, eo);
                        editor.getCaretModel().moveToOffset(eo);
                    }
                } catch (Exception e) { log.warn("Failed to open file: " + filePath, e); }
            });
        }

        private void openExternalLink(String url) {
            try { BrowserUtil.browse(new URI(url)); } catch (Exception e) { log.warn("Failed to open URL: " + url, e); }
        }

        private void restartIDE() {
            ApplicationManager.getApplication().restart();
        }

        private void syncTheme() {
            if (browser == null || browser.isDisposed() || bridge == null || !bridge.isLoaded()) return;
            String scheme = com.intellij.util.ui.UIUtil.getPanelBackground().getRed() < 128 ? "dark" : "light";
            browser.getCefBrowser().executeJavaScript(
                "document.documentElement.dataset.colorScheme='" + scheme + "';" +
                "try{localStorage.setItem('opencode-color-scheme','" + scheme + "')}catch(e){};" +
                "window.dispatchEvent(new StorageEvent('storage',{key:'opencode-color-scheme',newValue:'" + scheme + "'}))",
                browser.getCefBrowser().getURL(),
                0
            );
        }

        @Override
        public void removeNotify() {
            // Keep the JBCefBrowser alive across tool window hide/show so the page state is preserved.
            // The browser is only disposed by disposeBrowser() when the tool window content is destroyed.
            super.removeNotify();
        }

        public void disposeBrowser() {
            if (bridge != null) {
                bridge.dispose();
                bridge = null;
            }
            if (browser != null) {
                browser.dispose();
                browser = null;
            }
        }

        private static String normalizePath(String path) {
            return path.replace("/", java.io.File.separator);
        }
    }
}
