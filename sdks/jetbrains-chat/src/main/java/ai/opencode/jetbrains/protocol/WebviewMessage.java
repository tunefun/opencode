package ai.opencode.jetbrains.protocol;

public class WebviewMessage {
    public String type;
    public String path;
    public FileSelection selection;
    public String url;
    public String message;
    public String source;
    public Integer line;
    public Integer col;
    public String stack;
}
