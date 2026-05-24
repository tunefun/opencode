export interface FileSelection {
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
  | { type: "setColorScheme"; colorScheme: string }

export type WebviewMessage =
  | { type: "ready" }
  | { type: "openFile"; path: string; selection?: FileSelection }
  | { type: "openLink"; url: string }
  | { type: "restart" }
  | { type: "resize"; width: number; height: number }
  | { type: "webviewError"; message: string; source?: string; line?: number; col?: number; stack?: string }
