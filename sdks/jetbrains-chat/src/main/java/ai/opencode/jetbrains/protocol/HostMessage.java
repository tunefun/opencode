package ai.opencode.jetbrains.protocol;

public class HostMessage {
    public String type;
    public String directory;
    public String path;
    public FileSelection selection;

    public static HostMessage init(String directory) {
        HostMessage msg = new HostMessage();
        msg.type = "init";
        msg.directory = directory;
        return msg;
    }

    public static HostMessage addFile(String path, FileSelection selection) {
        HostMessage msg = new HostMessage();
        msg.type = "addFile";
        msg.path = path;
        msg.selection = selection;
        return msg;
    }

    public static HostMessage focusInput() {
        HostMessage msg = new HostMessage();
        msg.type = "focusInput";
        return msg;
    }
}
