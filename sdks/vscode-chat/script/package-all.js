const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const nodeDistDir = path.resolve(__dirname, "..", "..", "..", "packages", "opencode", "dist", "node")

if (!fs.existsSync(nodeDistDir)) {
  console.error("Node.js bundle not found. Build it first:")
  console.error("  cd packages/opencode && bun script/build-node.ts")
  process.exit(1)
}

console.log("Building webview + node bundle + extension...")
execSync(
  "bun run build:webview && bun run copy:webview && bun run copy:node-bundle && bun run build:extension",
  { cwd: __dirname + "/..", stdio: "inherit" },
)

console.log("\nPackaging VSIX...")
execSync(
  "npx @vscode/vsce package --no-dependencies",
  { cwd: __dirname + "/..", stdio: "inherit" },
)

console.log("\nDone.")
