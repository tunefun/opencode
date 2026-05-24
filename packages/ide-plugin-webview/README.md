# ide-plugin-webview

VS Code 和 JetBrains 两个 IDE 插件共用的 SolidJS Webview 前端（参见 [VS Code 插件](../../sdks/vscode-chat) 和 [JetBrains 插件](../../sdks/jetbrains-chat)）。它复用 OpenCode 应用 UI（聊天、会话、提示词输入框），并通过 HTTP 与本机运行的 OpenCode 服务通信。

## 工作原理

该 Webview 是一个独立的 Vite + SolidJS 应用，构建一次后嵌入到各个 IDE 插件中：

1. `bun run build` 在 `dist/` 中产出静态包。
2. VS Code 插件将 `dist/` 复制到 `sdks/vscode-chat/webview/`，并通过 VS Code Webview API 加载。
3. JetBrains 插件将 `dist/` 复制到 `src/main/resources/webview/`，并通过自定义的 `http://plugin-internal` CEF scheme 加载。

IDE 宿主在页面加载前注入服务配置：

```html
<script>window.__OPENCODE_SERVER__ = { "url": "http://127.0.0.1:<port>", "directory": "<workspaceDir>" }</script>
```

`src/platform.ts` 中的 `getServerInfo()` 读取该全局变量；开发模式下也会回退到 `?port=` / `?dir=` 查询参数。

## Host 桥接协议

Webview 通过一个基于 `window.postMessage` 的小型协议与 IDE 宿主通信。Webview 侧使用两个宿主都提供的 `acquireVsCodeApi()` 兼容垫片（`window.__vscode_api__`）。

### Host → Webview

| Type | Payload | 说明 |
| --- | --- | --- |
| `init` | `{ directory }` | 服务就绪后发送；Webview 据此渲染工作区。 |
| `addFile` | `{ path, selection? }` | 将文件或选中内容加入提示词上下文。`selection` 为 `{ startLine, startChar, endLine, endChar }`（从 1 开始）。 |
| `setPrompt` | `{ text }` | 预填输入框。 |
| `focusInput` | – | 聚焦输入框。 |

### Webview → Host

| Type | Payload | 说明 |
| --- | --- | --- |
| `ready` | – | Webview 挂载完成。 |
| `openFile` | `{ path, selection? }` | 在 IDE 编辑器中打开文件（用于聊天中的文件链接）。 |
| `openLink` | `{ url }` | 用默认浏览器打开外部链接。 |
| `restart` | – | 重启 IDE。 |
| `resize` | `{ width, height }` | 上报 Webview 尺寸（预留）。 |
| `webviewError` | `{ message, source?, line?, col?, stack? }` | 将 Webview 的 JS 错误转发给宿主，便于调试。 |

## IDE 相关入口

`src/entry.tsx` 为 IDE 侧边栏接好应用：

- **会话切换器**（`src/session-switcher.tsx`）：顶栏下拉框，按今天 / 昨天 / 更早分组切换会话。
- **路由**：`+ New` 按钮创建草稿会话，`/server/:serverKey/session/:id` 渲染已有会话，旧版 `/:dir/session/:id` URL 会被重定向。
- 侧边栏较窄，挂载时会自动关闭右侧面板（Context / Git Changes）。

## 开发

```bash
bun install
bun run dev       # 在 http://localhost:5173 启动 vite dev server
```

如需在 IDE 内热更新，把插件指向 dev server：

- **VS Code**：设置 `OPENCODE_WEBVIEW_URL` 为 `http://localhost:5173`（扩展会从 dev server 加载模块）。
- **JetBrains**：通过 `syncWebview` Gradle 任务加载构建产物 `dist/`；JBCef 暂未接入 dev-server HMR。

## 构建

```bash
bun run build     # 输出到 dist/
bun run typecheck
```

构建使用相对 base（`base: "./"`），无论宿主如何加载 bundle，资源路径都能正确解析。各 IDE 插件有各自的脚本负责复制 `dist/` 并打包（见 `sdks/vscode-chat` 和 `sdks/jetbrains-chat`）。
