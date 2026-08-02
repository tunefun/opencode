# 公司级配置（Company）

两个 IDE 聊天插件（`vscode-chat` / `jetbrains-chat`）在构建时把本目录复制进插件包，随插件分发到员工机器。sidecar 启动时插件会注入：

- `OPENCODE_CONFIG=<插件目录>/company/opencode.jsonc` — **内置优先**，覆盖机器级 `OPENCODE_CONFIG`
- `OPENCODE_COMPANY_PLUGIN_DIR=<插件目录>` — 供配置里的 `{env:...}` 引用插件安装目录

## 目录结构

```
opencode.jsonc          公司配置（默认模型 / 插件 / 技能 / 权限）
package.json            公司包构建入口（scripts.build → "node build.mjs"）
build.mjs               顶层编排：调 plugins 构建 + 组装完整分发包到 .build/
plugins/                插件集合包（自包含）
  package.json          scripts.build → "node build.mjs"（cd plugins && bun run build 单独构建全部插件）
  build.mjs             只构建各插件 → ../.build/plugins/
  corp-audit/
    package.json        必须提供 build 脚本；main 指向产物文件名；dependencies 放依赖
    src/index.ts        插件入口
skills/**/SKILL.md      公司技能
.build/                 分发包暂存目录（gitignore）：包含 opencode.jsonc、skills/、plugins/ 产物等全部目标文件
```

两层构建：**外部只调用 `build.mjs`**（顶层）——它清理 `.build/`，调用 `plugins/build.mjs`（跑各插件 `build`，产物为单个 bundle 输出到 `$OUTDIR`），再把 `opencode.jsonc`、`README.md`、`skills/` 一并拷入。两个 IDE 插件构建链只需跑 `company/build.mjs` 后整体拷贝 `.build/`。

## 定制

编辑 `opencode.jsonc`（JSONC，支持注释）：

- `model` / `small_model` — 公司默认模型
- `plugin` — 新增 `./plugins/<name>/index.js` 或 npm 包
- `skills.paths` — 已指向 `{env:OPENCODE_COMPANY_PLUGIN_DIR}/company/skills`

插件有依赖时，在插件的 `package.json` 里声明并安装：

```bash
cd sdks/company/plugins/<name> && bun install
```

改完重新构建并分发插件：

```bash
# 构建整个公司分发包
cd sdks/company && bun run build

# 或只构建插件（调试用）
cd sdks/company/plugins && bun run build

# VS Code
cd sdks/vscode-chat && bun run vsix

# JetBrains
cd sdks/jetbrains-chat && ./gradlew buildPlugin
```

## 新增 plugin

1. 在 `plugins/` 下新建目录 `plugins/<name>/`，结构：
   ```
   plugins/corp-deploy/
   ├── package.json        { "main": "dist/index.js", "scripts": { "build": "bun build src/index.ts --outfile \"$OUTDIR/index.js\" --target node --format esm" } }
   ├── src/index.ts        ← 插件入口
   └── (src/** 可随意拆模块、import npm 依赖)
   ```
2. `build` 脚本把入口 **bundle 成单个 `.js` 输出到 `$OUTDIR`**（多文件与依赖全部内联，运行时零依赖）。示例入口：
   ```ts
   // plugins/corp-deploy/src/index.ts
   import { helper } from "./lib/helper"
   export default async () => {
     return {}
   }
   ```
3. 在 `opencode.jsonc` 的 `plugin` 数组追加 `"./plugins/<name>/index.js"`，重新构建分发。

## 新增 skill

1. 新建 `skills/<name>/SKILL.md`（`name` 必须等于目录名，`description` 必填，否则不会暴露给模型）：
   ```markdown
   ---
   name: my-skill
   description: Use when ...
   ---
   （技能正文）
   ```
2. **无需改 `opencode.jsonc`** —— `skills.paths` 已指向 `{env:OPENCODE_COMPANY_PLUGIN_DIR}/company/skills`，自动递归扫描 `**/SKILL.md`。
3. 重新构建分发。

## 新增 agent / command

内联在 `opencode.jsonc`（这是唯一方式：agent/command 文件只能放在 config 扫描目录，如 `~/.config/opencode/agent/`，插件内置配置没有引用 agent 目录的机制）：

```jsonc
"agent": {
  "corp-reviewer": { "mode": "subagent", "description": "...", "prompt": "..." }
},
"command": {
  "deploy": { "description": "...", "template": "..." }
}
```

改完重新构建分发。

## 本地验证

- 不装 IDE 快速验证配置：`OPENCODE_CONFIG=sdks/company/opencode.jsonc OPENCODE_PLUGIN_DIR=sdks/company opencode`
- 装插件后看 sidecar 日志确认 plugin / skill 已加载（VS Code 的 **OpenCode Server** 通道、JetBrains 的 `OpenCodeServer` logger）

## 注意事项

- 每个插件是独立 npm 项目，**`package.json` 必须提供 `build` 脚本**，产物为单个 bundle `.js`，**输出到 `$OUTDIR` 指向的目录**（文件名 = `main` 的文件名部分，默认 `index.js`）。`plugins/build.mjs` 会校验，缺失即构建失败。
- 插件构建用 `bun run build`（无 bun 时回退 `npm run build`）；插件自身的 `build` 可用 `bun build`、esbuild 等任意工具，只要产物是单个 bundle `.js` 且落在 `$OUTDIR`。
- 两层构建：`build.mjs`（公司层）→ `plugins/build.mjs`（插件层）→ 各插件 `build`。外部（vscode/gradle 构建链）只调用公司层 `build.mjs`。
- npm 依赖在**各插件**的 `package.json` 里声明并 `bun install`；构建时 bundle 进产物，**分发时无需携带 node_modules**。首次构建前记得安装。
- **整个分发包**（opencode.jsonc、skills/、plugins/ 产物等）组装进 `.build/`，构建链整体拷入插件；`.build/` 与各层 `node_modules/` 均 gitignore，不随仓库提交。
- `plugin` 的相对路径按 `opencode.jsonc` 所在位置解析（`./plugins/xxx/index.js`）。
- `skills.paths` 的相对路径按**项目目录**解析，因此技能目录必须用 `{env:OPENCODE_COMPANY_PLUGIN_DIR}` 绝对定位。
- 优先级语义：`OPENCODE_CONFIG` 介于用户全局配置与项目配置之间，员工仍可在项目 `.opencode/` 覆盖公司默认。
