package ai.opencode.jetbrains.actions;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;

public class FocusAction extends AnAction {

    public FocusAction() {
        super("Focus OpenCode Chat");
    }

    @Override
    public ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }

    @Override
    public void actionPerformed(AnActionEvent e) {
        var project = e.getProject();
        if (project == null) return;
        var panel = AddFileAction.getChatPanel(project);
        if (panel != null) panel.focusInput();
    }

    @Override
    public void update(AnActionEvent e) {
        e.getPresentation().setEnabled(e.getProject() != null);
    }
}
