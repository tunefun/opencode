import { spawnSync } from "child_process"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const here = path.dirname(fileURLToPath(import.meta.url))
const companyDir = path.resolve(here, "..")
const pluginsDir = here
const pluginsOut = path.join(companyDir, ".build", "plugins")

fs.rmSync(pluginsOut, { recursive: true, force: true })
fs.mkdirSync(pluginsOut, { recursive: true })

const useBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0
const runner = useBun
  ? { cmd: "bun", shell: false }
  : process.platform === "win32"
    ? { cmd: "npm.cmd", shell: true }
    : { cmd: "npm", shell: false }

for (const name of fs.readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name)
  if (!fs.statSync(dir).isDirectory()) continue
  const pkgPath = path.join(dir, "package.json")
  if (!fs.existsSync(pkgPath)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  if (!pkg.scripts?.build) {
    console.error(`Plugin ${path.relative(companyDir, dir)} has no "build" script in package.json`)
    process.exit(1)
  }

  const main = pkg.main ?? "dist/index.js"
  const outDir = path.join(pluginsOut, name)
  fs.mkdirSync(outDir, { recursive: true })

  const result = spawnSync(runner.cmd, ["run", "build"], {
    cwd: dir,
    stdio: "inherit",
    shell: runner.shell,
    env: { ...process.env, OUTDIR: outDir },
  })
  if (result.status !== 0) {
    console.error(`Plugin build failed: ${path.relative(companyDir, dir)}`)
    process.exit(result.status ?? 1)
  }

  const outFile = path.join(outDir, path.basename(main))
  if (!fs.existsSync(outFile)) {
    console.error(
      `Plugin ${path.relative(companyDir, dir)} produced no output at $OUTDIR/${path.basename(main)} ` +
        `(package.json "main" = "${main}")`,
    )
    process.exit(1)
  }
  console.log(`Built ${path.relative(pluginsDir, dir)}`)
}
console.log(`Plugins built at ${pluginsOut}`)
