const path = require("path")
const { pathToFileURL } = require("url")

async function main() {
  const port = parseInt(process.env.OPENCODE_PORT || "0")
  const hostname = process.env.OPENCODE_HOSTNAME || "127.0.0.1"
  const cors = JSON.parse(process.env.OPENCODE_CORS || '["vscode-webview://"]')

  const bundleUrl = pathToFileURL(path.join(__dirname, "node", "node.js")).href
  const { Server } = await import(bundleUrl)

  const listener = await Server.listen({ port, hostname, cors })
  console.log(`opencode server listening on http://${listener.hostname}:${listener.port}`)

  process.send?.({ type: "ready" })

  const cleanup = async () => {
    await listener.stop()
    process.exit(0)
  }
  process.on("SIGTERM", cleanup)
  process.on("SIGINT", cleanup)

  await new Promise(() => {})
}

main().catch((err) => {
  console.error("Sidecar failed:", err)
  process.send?.({ type: "error", message: err.message })
  process.exit(1)
})
