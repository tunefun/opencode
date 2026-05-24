import * as vscode from "vscode"
import type { ChatWebviewProvider } from "./webview"

export function registerCommands(context: vscode.ExtensionContext, provider: ChatWebviewProvider) {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.open", () => {
      vscode.commands.executeCommand("opencode-chat.chatView.focus")
    }),

    vscode.commands.registerCommand("opencode-chat.focus", () => {
      provider.focus()
    }),

    vscode.commands.registerCommand("opencode-chat.addSelection", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const relativePath = vscode.workspace.asRelativePath(editor.document.uri)
      const sel = editor.selection
      if (sel.isEmpty) {
        provider.addFile(relativePath)
        return
      }
      provider.addSelection(relativePath, {
        startLine: sel.start.line + 1,
        startChar: sel.start.character + 1,
        endLine: sel.end.line + 1,
        endChar: sel.end.character + 1,
      })
    }),

    vscode.commands.registerCommand("opencode-chat.addFile", (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!targetUri) return
      const relativePath = vscode.workspace.asRelativePath(targetUri)
      provider.addFile(relativePath)
    }),
  )
}
