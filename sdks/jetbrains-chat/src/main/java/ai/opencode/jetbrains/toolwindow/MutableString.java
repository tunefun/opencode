package ai.opencode.jetbrains.toolwindow;

public class MutableString {
    private String value;

    public MutableString(String value) {
        this.value = value;
    }

    public String get() {
        return value;
    }

    public void set(String value) {
        this.value = value;
    }
}
