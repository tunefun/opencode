// 用隐藏 textarea + execCommand("copy") 的方式写入剪贴板。
// 该方式不要求安全上下文，也不依赖用户手势权限，但必须在点击等用户事件
// 同步调用链中执行，否则 execCommand("copy") 会返回 false。
// 与 session-ui 中 message-part 的 writeClipboard 兜底逻辑保持一致。
function fallbackWriteText(text: string): Promise<void> {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand("copy")
  } finally {
    textarea.remove()
  }
  if (copied) return Promise.resolve()
  return Promise.reject(new Error("Clipboard copy failed"))
}

// 背景：Chromium 只在安全上下文（https、file://、localhost/127.0.0.1）中暴露
// navigator.clipboard。JetBrains 插件用自定义 http://plugin-internal scheme 加载
// webview（见 sdks/jetbrains-chat WebviewSchemeHandler），该 origin 不是安全上下文，
// 因此 navigator.clipboard 为 undefined，而 markdown 代码块的复制按钮（session-ui
// 的 markdown.tsx）只调用了 navigator.clipboard.writeText 且没有兜底，导致点击静默无效。
// 这里在入口最早处装上 polyfill：仅当原生 API 缺失时才覆盖，安全上下文（VSCode
// webview、本地 dev server）不受影响。
export function installClipboardPolyfill() {
  if (typeof navigator === "undefined" || typeof document === "undefined") return
  const nativeClipboard = navigator.clipboard as Clipboard | undefined
  if (nativeClipboard?.writeText) return
  try {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: fallbackWriteText },
      configurable: true,
      writable: true,
    })
  } catch {
    // navigator.clipboard 不可覆盖时（极少数情况），应用内其它复制路径（如
    // message-part 的 writeClipboard）自带 execCommand 兜底，复制仍可用。
  }
}
