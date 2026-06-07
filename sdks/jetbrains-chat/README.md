# OpenCode Chat（JetBrains）

面向 JetBrains IDE（IntelliJ IDEA、PyCharm、WebStorm 等）的 AI 编码助手聊天面板。它把 OpenCode Webview 嵌入工具窗口，并以 Node.js sidecar 进程的方式运行一个 OpenCode 服务。

## 功能

- **聊天面板** — 右侧的 "OpenCode Chat" 工具窗口（基于 JBCef 的 Webview）。
- **添加文件与选中内容** — 在 Project 视图中右键文件即可加入；或在编辑器中右键选中内容，选择 *Add Selection to OpenCode*。
- **从聊天打开文件** — 对话中的文件链接会在 IDE 编辑器中打开，并高亮选中区域。
- **聚焦命令** — *Focus OpenCode Chat* 聚焦聊天输入框。
- **暗/亮主题同步** — Webview 跟随 IDE 的外观主题。
- **DevTools** — 标题栏按钮可打开内嵌浏览器的开发者工具，便于调试。

## 环境要求

- JetBrains IDE 2024.1+（build 241+，目标平台 IntelliJ Platform 2024.3）。
- 插件内置 Node.js 运行时；若当前平台缺少对应运行时，则回退使用系统 `node`（Node.js 22+）。

## 架构

```
┌────────────────────────────────────────────────────────────┐
│  JetBrains 插件（JVM）                                      │
│   ├─ services/OpenCodeServer   sidecar 进程管理              │
│   ├─ toolwindow/ChatToolWindowFactory  工具窗口 UI           │
│   ├─ toolwindow/ChatWebviewBridge      webview ↔ host        │
│   └─ toolwindow/WebviewSchemeHandler   通过                  │
│        http://plugin-internal scheme 提供 webview            │
└──────────────┬─────────────────────────────────────────────┘
               │  JBCef（window.postMessage 桥接）
┌──────────────▼─────────────────────────────────────────────┐
│  packages/ide-plugin-webview（SolidJS，位于 resources/webview）│
└──────────────┬─────────────────────────────────────────────┘
               │  HTTP / WebSocket
┌──────────────▼─────────────────────────────────────────────┐
│  Node.js sidecar: dist/sidecar.cjs → dist/node/node        │
│  （打包的 OpenCode 服务，绑定 127.0.0.1）                    │
└────────────────────────────────────────────────────────────┘
```

- 插件不会随 IDE 启动而自动运行：sidecar 只在用户首次打开 "OpenCode Chat" 工具窗口时启动，并在所有使用它的工具窗口内容销毁（项目关闭）后停止。
- `OpenCodeServer` 是应用级服务（`applicationService`）。它在一个空闲端口上启动共享的 Node.js sidecar，把 stdout/stderr 写入 IDE 日志，轮询 `/global/health` 直到就绪，并在最后一个使用它的项目关闭后停止进程。它优先使用内置的 Node 运行时（`dist/node-runtime/<platform>-<arch>/`），找不到时回退到系统 Node。
- `ChatToolWindowFactory` 用 JBCef 浏览器构建工具窗口，并在工具窗口内容创建时启动 sidecar、内容销毁时释放服务。它会在工具窗口隐藏/显示之间保持浏览器存活，以保留页面状态。
- `ChatWebviewBridge` 把 `window.__OPENCODE_SERVER__` 和一个 `acquireVsCodeApi()` 兼容垫片注入 HTML，并通过 `JBCefJSQuery` 桥接转发 webview → host 消息。
- `WebviewSchemeHandler` 从插件的 `webview/` 资源中提供 `http://plugin-internal/...`，其中内存中的 `index.html` 会在运行时注入服务地址与工作区目录。

Webview 协议（host ↔ webview 消息）定义在 `src/main/java/ai/opencode/jetbrains/protocol/`，并在 [ide-plugin-webview README](../../packages/ide-plugin-webview/README.md) 中有文档说明。

## 构建与打包

需要 JDK 17 和 [IntelliJ Platform Gradle plugin](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html)（由 Gradle wrapper 管理）。

```bash
# 1. 构建共享 Webview
cd packages/ide-plugin-webview && bun install && bun run build

# 2. 构建 OpenCode Node.js 服务包
cd packages/opencode && bun script/build-node.ts

# 3. 把资源同步进插件并准备沙箱
cd sdks/jetbrains-chat
./gradlew syncWebview syncNodeBundle syncNodeRuntime prepareSandbox

# 4. 在 IntelliJ 沙箱中运行插件
./gradlew runIde
```

相关 Gradle 任务（见 `build.gradle.kts`）：

| 任务 | 作用 |
| --- | --- |
| `syncWebview` | 把 `packages/ide-plugin-webview/dist/` 复制到 `src/main/resources/webview/` |
| `syncNodeBundle` | 把 `packages/opencode/dist/node/` 复制到 `dist/node/`，写入 `sidecar.cjs`，并 stub 掉 `@lydell/node-pty` |
| `syncNodeRuntime` | 为 win32/darwin/linux × x64/arm64 下载并解压 Node.js 运行时（`v24.18.1`）到 `dist/node-runtime/`；当前平台失败时回退使用本机 Node |
| `prepareSandbox` | 把 node bundle 和运行时复制进 IDE 沙箱 |

`processResources` 依赖 `syncWebview`，因此构建时 Webview 资源始终是最新的。

## 打包可分发的插件

```bash
./gradlew buildPlugin
# 产物位于 build/distributions/<plugin>.zip —— 可通过
# Settings → Plugins → ⚙ → Install Plugin from Disk... 安装
```

## 开发

1. 在 IntelliJ IDEA 中以 Gradle 项目打开 `sdks/jetbrains-chat`。
2. 先构建 webview 与 node bundle（上面的步骤 1–2），再从 Gradle 工具窗口运行 `syncWebview` / `syncNodeBundle` / `syncNodeRuntime`。
3. `./gradlew runIde` 启动一个加载了插件沙箱版 IDE。

内置 Node 运行时首次下载可能较慢；之后会缓存到 `build/node-runtime-download/` 和 `dist/node-runtime/`。

## 故障排查

- **"Node.js not found"** — 插件既找不到当前平台的内置运行时，也找不到系统 `node`。请安装 Node.js 22+，或运行 `./gradlew syncNodeRuntime` 内置一份。
- **"Sidecar not found at …/dist/sidecar.cjs"** — 没有同步 node bundle。运行 `./gradlew syncNodeBundle`。
- 服务 stdout/stderr 与健康检查失败的信息记录在 `ai.opencode.jetbrains.services.OpenCodeServer` logger 下（Help → Show Log in Explorer）。

## 支持

早期版本。如有问题或反馈，请在 https://github.com/anomalyco/opencode/issues 提交 issue。
