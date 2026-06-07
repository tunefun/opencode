package ai.opencode.jetbrains.actions;

import ai.opencode.jetbrains.toolwindow.ChatToolWindowFactory;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.ToolWindowManager;

public class AddFileAction extends AnAction {

    @Override
    public ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }

    @Override
    public void actionPerformed(AnActionEvent e) {
        var project = e.getProject();
        if (project == null) return;
        ChatToolWindowFactory.ChatPanel panel = getChatPanel(project);
        if (panel == null) return;

        VirtualFile file = e.getData(CommonDataKeys.VIRTUAL_FILE);
        if (file == null) {
            var files = FileEditorManager.getInstance(project).getSelectedFiles();
            if (files != null && files.length > 0) file = files[0];
        }
        if (file != null) {
            panel.addFile(file.getPath(), null);
        }
    }

    @Override
    public void update(AnActionEvent e) {
        var project = e.getProject();
        e.getPresentation().setEnabled(project != null && getChatPanel(project) != null);
    }

    public static ChatToolWindowFactory.ChatPanel getChatPanel(com.intellij.openapi.project.Project project) {
        var tw = ToolWindowManager.getInstance(project).getToolWindow("OpenCode Chat");
        if (tw == null) return null;
        var content = tw.getContentManager().getContent(0);
        if (content == null) return null;
        if (content.getComponent() instanceof ChatToolWindowFactory.ChatPanel) {
            return (ChatToolWindowFactory.ChatPanel) content.getComponent();
        }
        return null;
    }
}
