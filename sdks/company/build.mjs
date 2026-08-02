import { spawnSync } from "child_process"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const here = path.dirname(fileURLToPath(import.meta.url))
const companyDir = here
const stagingRoot = path.join(companyDir, ".build")

fs.rmSync(stagingRoot, { recursive: true, force: true })
fs.mkdirSync(stagingRoot, { recursive: true })

const result = spawnSync(process.execPath, [path.join(companyDir, "plugins", "build.mjs")], {
  stdio: "inherit",
})
if (result.status !== 0) process.exit(result.status ?? 1)

for (const item of ["opencode.jsonc", "README.md", "skills"]) {
  const src = path.join(companyDir, item)
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(stagingRoot, item), { recursive: true, force: true })
  }
}
console.log(`Company bundle staged at ${stagingRoot}`)
