# OpenCode Chat（VS Code）

面向 VS Code 的 AI 聊天助手。它把 OpenCode Webview 嵌入侧边栏，并以 sidecar 进程的方式运行一个 OpenCode 服务，让你无需离开编辑器即可与代码库对话。

## 功能

- **侧边栏聊天面板** — 活动栏中的 OpenCode UI（`opencode-chat-chatView`）。
- **添加文件与选中内容** — 在资源管理器中右键文件即可加入；或在编辑器中选中代码，通过右键菜单把选中内容加入对话。
- **聚焦命令** — `Ctrl+Shift+O`（macOS 为 `Cmd+Shift+O`）聚焦聊天输入框。
- **主题同步** — Webview 跟随 VS Code 的亮/暗主题。

## 环境要求

- VS Code `^1.94.0`
- 必须打开一个工作区文件夹，否则扩展拒绝启动。

## 架构

```
┌─────────────────────────────────────────────┐
│  VS Code 宿主（扩展）                        │
│   ├─ src/extension.ts   激活与接线            │
│   ├─ src/server.ts      sidecar 生命周期      │
│   └─ src/webview.ts     webview + 协议        │
└──────────────┬──────────────────────────────┘
               │  Webview（window.postMessage）
┌──────────────▼──────────────────────────────┐
│  packages/ide-plugin-webview（SolidJS）      │
└──────────────┬──────────────────────────────┘
               │  HTTP / WebSocket
┌──────────────▼──────────────────────────────┐
│  sidecar: dist/sidecar.js → dist/node/node  │
│  （打包的 OpenCode Node.js 服务，端口由       │
│   OPENCODE_PORT 指定，绑定 127.0.0.1）        │
└─────────────────────────────────────────────┘
```

- `src/extension.ts` 注册 Webview 提供器与命令，并在扩展激活时启动 sidecar 服务。
- `src/server.ts` 查找空闲端口，以 `OPENCODE_CALLER=vscode-chat` 环境变量 `fork` `dist/sidecar.js`，等待健康检查端点（`/global/health`）或 IPC `ready` 消息，并在释放时结束整个进程树。
- `src/webview.ts` 加载构建好的 Webview HTML，注入 `window.__OPENCODE_SERVER__`，并把 `openFile` / `openLink` / `restart` 等消息翻译成 VS Code API。当设置了 `OPENCODE_DEV` 时，改为从 Vite dev server 加载，而非构建产物。
- `src/commands.ts` 实现 `opencode-chat.open`、`focus`、`addSelection`、`addFile` 等命令。

Webview 协议（host ↔ webview 消息）定义在 `src/protocol.ts`，并在 [ide-plugin-webview README](../../packages/ide-plugin-webview/README.md) 中有文档说明。

## 构建与打包

```bash
bun install

bun run build     # webview → node bundle → extension（全部步骤）
bun run vsix      # 构建并打包 opencode-chat-<version>.vsix
bun run vsix:all  # 同 vsix，通过 script/package-all.js 执行
bun run typecheck
```

构建流水线：

1. `build:webview` — 用 Vite 构建 `packages/ide-plugin-webview`。
2. `copy:webview` — 把 `packages/ide-plugin-webview/dist/` 复制到 `webview/`。
3. `build:node-bundle` — 构建 OpenCode Node.js 服务（`packages/opencode/dist/node`）。
4. `copy:node-bundle` — 把 bundle 复制到 `dist/node/`，连同 `script/sidecar.js` → `dist/sidecar.js`，并 stub 掉 `@lydell/node-pty`（扩展内部不可用）。
5. `build:extension` — 用 esbuild 把 `src/extension.ts` 打包为 `dist/extension.js`。

安装打包好的 `.vsix`：

```bash
bun run install
```

## 开发

1. 在 VS Code 中打开本目录（`code sdks/vscode-chat`）。**不要从仓库根目录打开。**
2. 在 `sdks/vscode-chat` 内执行 `bun install`。
3. `bun run dev` — 构建所有内容后，以 `OPENCODE_DEV=1` 启动一个新 VS Code 窗口，Webview 会从 Vite dev server 加载并支持热更新。

扩展源码的改动通过 `esbuild --watch`（`bun run watch`）自动重建。验证改动时，在调试窗口中执行 `Developer: Reload Window` 重载即可。

## 故障排查

服务与 Webview 日志写在 **OpenCode Chat** / **OpenCode Server** / **OpenCode WebView Errors** 输出通道中。

- **"Sidecar script not found"** — 先运行 `bun run build`；node bundle 不随仓库提交。
- **"Open a workspace folder first"** — 扩展需要工作区文件夹来运行服务。
- **Webview 一直显示 "Starting server..."** — 查看 **OpenCode Server** 通道；sidecar 可能绑定失败，或健康检查超时（见 `src/server.ts` 中的 `pollServer` / `waitForReady`）。

## 支持

早期版本。如有问题或反馈，请在 https://github.com/anomalyco/opencode/issues 提交 issue。
