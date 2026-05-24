const fs = require("fs")
const path = require("path")

const srcDir = path.resolve(__dirname, "..", "..", "..", "packages", "opencode", "dist", "node")
const destDir = path.resolve(__dirname, "..", "dist", "node")
const sidecarSrc = path.resolve(__dirname, "sidecar.js")
const sidecarDest = path.resolve(__dirname, "..", "dist", "sidecar.js")

if (!fs.existsSync(srcDir)) {
  console.error(`Node.js bundle not found: ${srcDir}`)
  console.error("Build it first: cd packages/opencode && bun script/build-node.ts")
  process.exit(1)
}

fs.rmSync(destDir, { recursive: true, force: true })
fs.cpSync(srcDir, destDir, { recursive: true, force: true })
console.log(`Node.js bundle copied: ${destDir}`)

fs.cpSync(sidecarSrc, sidecarDest)
console.log(`Sidecar copied: ${sidecarDest}`)

fs.writeFileSync(
  path.join(destDir, "package.json"),
  JSON.stringify({ type: "module" }),
)

const ptyDir = path.join(destDir, "node_modules", "@lydell", "node-pty")
fs.mkdirSync(ptyDir, { recursive: true })
fs.writeFileSync(
  path.join(ptyDir, "package.json"),
  JSON.stringify({ type: "module", main: "index.js" }),
)
fs.writeFileSync(
  path.join(ptyDir, "index.js"),
  "export function spawn() { throw new Error('@lydell/node-pty is not available in VSCode extension') }\n",
)
console.log("PTY stub created")

const jsoncSrc = path.resolve(__dirname, "..", "..", "..", "packages", "opencode", "node_modules", "jsonc-parser")
const jsoncDest = path.join(destDir, "node_modules", "jsonc-parser")
fs.cpSync(jsoncSrc, jsoncDest, { recursive: true, force: true, dereference: true })
console.log("jsonc-parser copied")
