package ai.opencode.jetbrains.actions;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.fileEditor.FileEditorManager;

public class AddSelectionAction extends AnAction {

    public AddSelectionAction() {
        super("Add Selection to OpenCode");
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
        if (panel == null) return;
        panel.addSelection();
    }

    @Override
    public void update(AnActionEvent e) {
        var project = e.getProject();
        boolean enabled = project != null
            && AddFileAction.getChatPanel(project) != null
            && FileEditorManager.getInstance(project).getSelectedTextEditor() != null;
        e.getPresentation().setEnabled(enabled);
    }
}
