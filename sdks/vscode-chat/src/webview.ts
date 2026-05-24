import * as vscode from "vscode"
import * as path from "path"
import { readFileSync } from "fs"
import type { HostMessage, WebviewMessage, FileSelection } from "./protocol"

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _serverPort?: number
  private _errorChannel = vscode.window.createOutputChannel("OpenCode WebView Errors")
  private _pendingMessages: HostMessage[] = []

  constructor(private readonly _extensionUri: vscode.Uri, private _directory: string) {
    vscode.window.onDidChangeActiveColorTheme(() => this._syncTheme())
  }

  setServer(port: number) {
    this._serverPort = port
    this._reloadHtml()
    this._postInit()
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "webview")],
    }

    webviewView.webview.html = this._serverPort != null
      ? this._getHtml(webviewView.webview)
      : this._getLoadingHtml()
    this._errorChannel.appendLine(`[webview] resolveWebviewView port=${this._serverPort}`)

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this._handleMessage(msg)
    })

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this._postInit()
    })

    for (const msg of this._pendingMessages.splice(0)) {
      webviewView.webview.postMessage(msg)
    }
  }

  post(msg: HostMessage) {
    if (this._view) {
      this._view.webview.postMessage(msg)
    } else {
      this._pendingMessages.push(msg)
    }
  }

  addSelection(filePath: string, selection: FileSelection) {
    this._errorChannel.appendLine(`[webview] addSelection path=${filePath} selection=${JSON.stringify(selection)}`)
    this.post({ type: "addFile", path: filePath, selection })
    this._view?.show?.(true)
  }

  addFile(filePath: string) {
    this._errorChannel.appendLine(`[webview] addFile path=${filePath}`)
    this.post({ type: "addFile", path: filePath })
    this._view?.show?.(true)
  }

  focus() {
    this._view?.show?.(true)
    this.post({ type: "focusInput" })
  }

  private _colorScheme(): string {
    const kind = vscode.window.activeColorTheme.kind
    return (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast) ? "dark" : "light"
  }

  private _syncTheme() {
    const scheme = this._colorScheme()
    this._view?.webview.postMessage({ type: "setColorScheme", colorScheme: scheme })
  }

  private _reloadHtml() {
    if (!this._view) return
    this._view.webview.html = this._getHtml(this._view.webview)
    this._errorChannel.appendLine(`[webview] HTML reloaded (port=${this._serverPort})`)
  }

  private _postInit() {
    this.post({ type: "init", directory: this._directory ?? "" })
  }

  private _getLoadingHtml(): string {
    const scheme = this._colorScheme()
    return `<!DOCTYPE html>
<html data-color-scheme="${scheme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
</head>
<body style="margin:0;background:var(--vscode-sideBar-background,#1e1e1e);color:var(--vscode-descriptionForeground,#888);font-family:system-ui,sans-serif;font-size:13px;display:flex;align-items:center;justify-content:center;height:100vh">
  Starting server...
</body>
</html>`
  }

  private _getHtml(webview: vscode.Webview): string {
    const isDev = !!process.env.OPENCODE_DEV
    const viteUrl = process.env.OPENCODE_WEBVIEW_URL ?? "http://localhost:5173"
    const scheme = this._colorScheme()

    const serverConfig = JSON.stringify({
      url: `http://127.0.0.1:${this._serverPort!}`,
      directory: this._directory,
    }).replace(/<\//g, "<\\/")

    const debugScript = this._getDebugScript()

    const csp = [
      "default-src 'none'",
      `script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource}${isDev ? ` ${viteUrl}` : ""}`,
      `style-src 'unsafe-inline' ${webview.cspSource}${isDev ? ` ${viteUrl}` : ""}`,
      `img-src ${webview.cspSource} data: https:${isDev ? ` ${viteUrl}` : ""}`,
      `font-src ${webview.cspSource}${isDev ? ` ${viteUrl}` : ""}`,
      `connect-src http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*${isDev ? ` ws://localhost:5173 ${viteUrl}` : ""}`,
    ].join("; ")

    if (isDev) {
      return `<!DOCTYPE html>
<html data-color-scheme="${scheme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <script>window.__OPENCODE_SERVER__=${serverConfig}</script>
  <script>document.documentElement.dataset.colorScheme="${scheme}";document.documentElement.dataset.theme="oc-2";try{localStorage.setItem("opencode-color-scheme","${scheme}")}catch(e){};window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="setColorScheme"){document.documentElement.dataset.colorScheme=d.colorScheme;try{localStorage.setItem("opencode-color-scheme",d.colorScheme)}catch(e){};window.dispatchEvent(new StorageEvent("storage",{key:"opencode-color-scheme",newValue:d.colorScheme}))}})</script>
  <script>
    window.__HMR_HOSTNAME__ = new URL("${viteUrl}").hostname
    window.__HMR_PORT__ = 5173
    window.__HMR_PROTOCOL__ = "ws"
  </script>
  ${debugScript}
  <script type="module" src="${viteUrl}/@vite/client"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${viteUrl}/src/entry.tsx"></script>
</body>
</html>`
    }

    const distPath = path.join(this._extensionUri.fsPath, "webview")
    const indexPath = path.join(distPath, "index.html")
    let html = readFileSync(indexPath, "utf8")

    html = html.replace(/<html([^>]*)>/, `<html data-color-scheme="${scheme}"$1>`)

    html = html.replace(
      /<script id="oc-theme-preload-script">[^<]*<\/script>/,
      `<script id="oc-theme-preload-script">document.documentElement.dataset.colorScheme="${scheme}";document.documentElement.dataset.theme="oc-2";try{localStorage.setItem("opencode-color-scheme","${scheme}")}catch(e){};window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="setColorScheme"){document.documentElement.dataset.colorScheme=d.colorScheme;try{localStorage.setItem("opencode-color-scheme",d.colorScheme)}catch(e){};window.dispatchEvent(new StorageEvent("storage",{key:"opencode-color-scheme",newValue:d.colorScheme}))}})</script>`,
    )

    html = html.replace("<head>", `<head><script>window.__OPENCODE_SERVER__=${serverConfig}</script>`)

    const assetsDir = vscode.Uri.joinPath(this._extensionUri, "webview", "assets")
    const assetsWebviewUri = webview.asWebviewUri(assetsDir).toString() + "/"
    html = html.replace(/(["'\s])\/assets\//g, `$1${assetsWebviewUri}`)
    html = html.replace(/(["'\s])\.\/assets\//g, `$1${assetsWebviewUri}`)

    return html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">${debugScript}`)
  }

  private _getDebugScript(): string {
    return `<script>!function(){var v=window.__vscode_api__=window.__vscode_api__||acquireVsCodeApi();function L(m){try{v.postMessage({type:"webviewError",message:m})}catch(e){}}
function D(m){L(m)}
var orig=window.fetch;window.fetch=function(u,o){var p=orig.call(window,u,o);var u2=typeof u==="string"?u:(u&&(u.url||u.href))||"";var short=String(u2).replace(/http:\\/\\/localhost:\\d+\\//,"/");var m=(o&&o.method)||(u&&u.method)||"GET";p.then(function(r){D("fetch "+r.status+" "+m+" "+short)}).catch(function(e){D("FETCH_ERR "+m+" "+short+" "+e.message)});return p}
window.addEventListener("error",function(e){D("ERR "+e.message)})
window.addEventListener("unhandledrejection",function(e){D("PROMISE_ERR "+String(e.reason))});var ce=console.error;console.error=function(){ce.apply(console,arguments);D("[ERR] "+Array.from(arguments).join(" "))};var cl=console.log;console.log=function(){cl.apply(console,arguments);D("[LOG] "+Array.from(arguments).join(" "))}
}()</script>`
  }

  private async _handleMessage(msg: WebviewMessage) {
    switch (msg.type) {
      case "ready": {
        this._errorChannel.appendLine("[webview] ready received")
        this._postInit()
        break
      }
      case "openFile": {
        const wsFolder = vscode.workspace.workspaceFolders?.[0]
        if (!wsFolder) return
        const uri = vscode.Uri.joinPath(wsFolder.uri, msg.path)
        const doc = await vscode.workspace.openTextDocument(uri)
        const opts: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.One }
        if (msg.selection) {
          opts.selection = new vscode.Range(
            msg.selection.startLine - 1, msg.selection.startChar - 1,
            msg.selection.endLine - 1, msg.selection.endChar - 1,
          )
        }
        await vscode.window.showTextDocument(doc, opts)
        break
      }
      case "openLink": {
        vscode.env.openExternal(vscode.Uri.parse(msg.url))
        break
      }
      case "restart": {
        vscode.commands.executeCommand("workbench.action.reloadWindow")
        break
      }
      case "webviewError": {
        this._errorChannel.appendLine(msg.message)
        this._errorChannel.show(true)
        break
      }
    }
  }
}
