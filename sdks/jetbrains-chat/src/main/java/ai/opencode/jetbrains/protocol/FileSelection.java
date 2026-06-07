package ai.opencode.jetbrains.protocol;

import com.fasterxml.jackson.annotation.JsonProperty;

public class FileSelection {
    @JsonProperty("startLine")
    public int startLine;
    @JsonProperty("startChar")
    public int startChar;
    @JsonProperty("endLine")
    public int endLine;
    @JsonProperty("endChar")
    public int endChar;

    public FileSelection() {}

    public FileSelection(int startLine, int startChar, int endLine, int endChar) {
        this.startLine = startLine;
        this.startChar = startChar;
        this.endLine = endLine;
        this.endChar = endChar;
    }
}
