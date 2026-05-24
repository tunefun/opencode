import * as vscode from "vscode"
import * as path from "path"
import { ChatWebviewProvider } from "./webview"
import { startServer, type ServerHandle } from "./server"
import { registerCommands } from "./commands"

let serverHandle: ServerHandle | undefined

export async function activate(context: vscode.ExtensionContext) {
  const vscodeWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!vscodeWorkspace) {
    vscode.window.showWarningMessage("OpenCode Chat: Open a workspace folder first.")
    return
  }
  const workspaceDir = vscodeWorkspace.replace(/^[a-z]:/, (d) => d.toUpperCase())

  const outputChannel = vscode.window.createOutputChannel("OpenCode Chat")

  const provider = new ChatWebviewProvider(context.extensionUri, workspaceDir)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode-chat.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )
  outputChannel.appendLine("Webview provider registered")

  registerCommands(context, provider)

  outputChannel.appendLine("Starting opencode server...")

  try {
    serverHandle = await startServer(workspaceDir)
    outputChannel.appendLine(`Server started on port ${serverHandle.port}`)
  } catch (err) {
    outputChannel.appendLine(`Failed to start server: ${err}`)
    vscode.window.showErrorMessage(`OpenCode Chat: Failed to start server. ${err}`)
    return
  }

  provider.setServer(serverHandle.port)

  context.subscriptions.push({
    dispose() {
      outputChannel.appendLine("Extension deactivating, stopping server...")
      serverHandle?.dispose()
    },
  })

  outputChannel.appendLine("OpenCode Chat activated.")
}

export function deactivate() {
  serverHandle?.dispose()
}
