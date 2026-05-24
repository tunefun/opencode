const fs = require("fs")
const path = require("path")

const src = path.resolve(__dirname, "..", "..", "..", "packages", "ide-plugin-webview", "dist")
const dest = path.resolve(__dirname, "..", "webview")

fs.cpSync(src, dest, { recursive: true, force: true })
console.log("Webview dist copied to webview/")
