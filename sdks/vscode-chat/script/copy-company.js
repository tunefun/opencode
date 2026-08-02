const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const srcDir = path.resolve(__dirname, "..", "..", "company")
const stagingDir = path.join(srcDir, ".build")
const destDir = path.resolve(__dirname, "..", "dist", "company")

if (!fs.existsSync(srcDir)) {
  console.error(`Company config dir not found: ${srcDir}`)
  process.exit(1)
}

execSync(`node ${JSON.stringify(path.join(srcDir, "build.mjs"))}`, { stdio: "inherit" })

fs.rmSync(destDir, { recursive: true, force: true })
fs.cpSync(stagingDir, destDir, { recursive: true, force: true })
console.log(`Company config copied: ${destDir}`)
