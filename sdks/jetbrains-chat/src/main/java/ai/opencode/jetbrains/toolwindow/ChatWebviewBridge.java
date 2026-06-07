package ai.opencode.jetbrains.toolwindow;

import ai.opencode.jetbrains.protocol.HostMessage;
import ai.opencode.jetbrains.protocol.MessageJson;
import ai.opencode.jetbrains.protocol.WebviewMessage;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import com.intellij.util.ui.UIUtil;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

public class ChatWebviewBridge {

    private static final Logger log = Logger.getInstance(ChatWebviewBridge.class);
    private final JBCefBrowser browser;
    private final String projectDir;
    private String serverUrl;
    private MessageHandler messageHandler;
    private JBCefJSQuery jsQuery;
    private boolean loaded;

    public interface MessageHandler {
        void onMessage(WebviewMessage msg);
    }

    public ChatWebviewBridge(JBCefBrowser browser, String projectDir) {
        this.browser = browser;
        this.projectDir = projectDir;
    }

    public void setMessageHandler(MessageHandler handler) {
        this.messageHandler = handler;
    }

    public boolean isLoaded() {
        return loaded;
    }

    public void load(int serverPort, MutableString indexHtml) {
        serverUrl = "http://127.0.0.1:" + serverPort;

        if (browser.isDisposed()) {
            log.warn("Cannot load: browser is disposed");
            return;
        }

        String rawHtml;
        try (InputStream in = getClass().getResourceAsStream("/webview/index.html")) {
            rawHtml = in != null ? new String(in.readAllBytes(), StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            rawHtml = null;
        }

        if (rawHtml == null) {
            log.warn("index.html not found in resources");
            return;
        }

        createJsQuery();
        String theme = UIUtil.getPanelBackground().getRed() < 128 ? "dark" : "light";
        indexHtml.set(injectScripts(rawHtml, theme));

        browser.loadURL("http://plugin-internal/index.html");
        loaded = true;
    }

    private void createJsQuery() {
        if (jsQuery != null) return;
        jsQuery = JBCefJSQuery.create((JBCefBrowserBase) browser);
        jsQuery.addHandler(json -> {
            handleJsonMessage(json);
            return new JBCefJSQuery.Response(null);
        });
    }

    public void handleJsonMessage(String json) {
        try {
            WebviewMessage msg = MessageJson.INSTANCE.readValue(json, WebviewMessage.class);
            if (messageHandler != null) messageHandler.onMessage(msg);
        } catch (Exception e) {
            log.warn("Failed to parse webview message: " + json, e);
        }
    }

    public void postMessage(HostMessage msg) {
        if (browser.isDisposed()) return;
        try {
            String json = MessageJson.INSTANCE.writeValueAsString(msg);
            String encoded = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
            browser.getCefBrowser().executeJavaScript(
                "try { window.postMessage(JSON.parse(atob('" + encoded + "')), '*') } catch(e) {}",
                browser.getCefBrowser().getURL(),
                0
            );
        } catch (Exception e) {
            log.warn("Failed to serialize message", e);
        }
    }

    public void dispose() {
        if (jsQuery != null) {
            try {
                jsQuery.dispose();
            } catch (Exception ignored) {}
            jsQuery = null;
        }
        loaded = false;
    }

    private String injectScripts(String rawHtml, String theme) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("url", serverUrl);
        config.put("directory", projectDir);
        String serverConfigJson;
        try {
            serverConfigJson = MessageJson.INSTANCE.writeValueAsString(config);
        } catch (Exception e) {
            serverConfigJson = "{}";
        }

        String queryCode = jsQuery != null ? jsQuery.inject("json") : "";

        String bridgeScript = "\n<script>\n" +
            "window.__OPENCODE_SERVER__ = " + serverConfigJson + ";\n" +
            "window.ocBridgePost = function(json) { try { " + queryCode + " } catch(e) {} };\n" +
            "var _api={postMessage:function(msg){try{var j=JSON.stringify(msg);ocBridgePost(j)}catch(e){}}," +
            "getState:function(){return window.__vscode_state__}," +
            "setState:function(s){window.__vscode_state__=s}};\n" +
            "window.__vscode_api__=_api;\n" +
            "Object.defineProperty(window,'acquireVsCodeApi',{value:function(){return _api},writable:false});\n" +
            "try{localStorage.setItem('opencode-color-scheme','" + theme + "')}catch(e){};\n" +
            "</script>\n";

        return rawHtml
            .replace("<html", "<html data-color-scheme=\"" + theme + "\"")
            .replace("</head>", bridgeScript + "</head>");
    }
}
