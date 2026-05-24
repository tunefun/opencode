import type { Platform } from "@opencode-ai/app"
import pkg from "../package.json"

export namespace IDEBridge {
  export type FileSelection = {
    startLine: number
    startChar: number
    endLine: number
    endChar: number
  }

  export type HostMessage =
    | { type: "init"; directory: string }
    | { type: "addFile"; path: string; selection?: FileSelection }
    | { type: "setPrompt"; text: string }
    | { type: "focusInput" }

  export type WebviewMessage =
    | { type: "ready" }
    | { type: "openFile"; path: string; selection?: FileSelection }
    | { type: "openLink"; url: string }
    | { type: "restart" }
    | { type: "resize"; width: number; height: number }
    | { type: "webviewError"; message: string; source?: string; line?: number; col?: number; stack?: string }
}

declare global {
  interface Window {
    __OPENCODE_SERVER__?: { url: string; directory: string }
  }
}

declare function acquireVsCodeApi(): {
  postMessage(msg: IDEBridge.WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

type HostMessageHandler = (msg: IDEBridge.HostMessage) => void
const hostMessageHandlers = new Set<HostMessageHandler>()

window.addEventListener("message", (event) => {
  const msg = event.data as IDEBridge.HostMessage
  if (!msg || typeof msg.type !== "string") return
  for (const handler of hostMessageHandlers) {
    handler(msg)
  }
})

export function onHostMessage(handler: HostMessageHandler) {
  hostMessageHandlers.add(handler)
  return () => {
    hostMessageHandlers.delete(handler)
  }
}

const _api = (() => {
  try {
    return acquireVsCodeApi()
  } catch {
    try { return (window as any).__vscode_api__ } catch { return undefined }
  }
})()

if (_api) (window as any).__vscode_api__ = _api

export function getHostApi() {
  return _api
}

export function getServerInfo() {
  const global = window.__OPENCODE_SERVER__
  if (global) return global
  const p = new URLSearchParams(location.search)
  return {
    url: `http://localhost:${p.get("port") ?? "4096"}`,
    directory: p.get("dir") ?? "",
  }
}

export function createIDEPlatform(): Platform {
  const host = getHostApi()
  return {
    platform: "web",
    version: pkg.version,
    openLink(url: string) {
      host?.postMessage({ type: "openLink", url })
    },
    restart() {
      host?.postMessage({ type: "restart" })
      return Promise.resolve()
    },
    back() {},
    forward() {},
    notify() {
      return Promise.resolve()
    },
    getDefaultServer: async () => null,
    setDefaultServer: () => {},
  }
}
