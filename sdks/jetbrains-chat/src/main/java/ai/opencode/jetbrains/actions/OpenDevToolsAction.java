package ai.opencode.jetbrains.actions;

import ai.opencode.jetbrains.toolwindow.ChatToolWindowFactory;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;

public class OpenDevToolsAction extends AnAction {

    private final ChatToolWindowFactory.ChatPanel panel;

    public OpenDevToolsAction(ChatToolWindowFactory.ChatPanel panel) {
        super("Open Chat Webview DevTools", "Open the developer tools for the chat webview", null);
        this.panel = panel;
    }

    @Override
    public ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }

    @Override
    public void actionPerformed(AnActionEvent e) {
        panel.openDevTools();
    }

    @Override
    public void update(AnActionEvent e) {
        e.getPresentation().setEnabled(panel != null);
    }
}
