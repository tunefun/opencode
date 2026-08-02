import { fork, execSync, type ChildProcess } from "child_process"
import * as net from "net"
import * as path from "path"
import * as fs from "fs"
import * as vscode from "vscode"

export interface ServerHandle {
  port: number
  process: ChildProcess
  dispose(): void
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

function pollServer(port: number, timeoutMs: number, output: vscode.OutputChannel): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  return new Promise((resolve, reject) => {
    const tick = () => {
      attempt++
      output.appendLine(`[pollServer] attempt=${attempt} start...`)
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2_000)
      fetch(`http://127.0.0.1:${port}/global/health`, { signal: ctrl.signal })
        .then((r) => {
          clearTimeout(timer)
          if (r.ok) {
            output.appendLine(`[pollServer] OK attempt=${attempt}`)
            resolve()
          } else {
            output.appendLine(`[pollServer] attempt=${attempt} status=${r.status}`)
            if (Date.now() < deadline) setTimeout(tick, 200)
            else reject(new Error(`Server not healthy (status=${r.status})`))
          }
        })
        .catch((e: Error & { code?: string }) => {
          clearTimeout(timer)
          output.appendLine(`[pollServer] attempt=${attempt} err=${e.code ?? e.message}`)
          if (Date.now() < deadline) setTimeout(tick, 200)
          else reject(new Error(`Server start timeout after ${attempt} attempts`))
        })
    }
    tick()
  })
}

function isWindows() {
  return process.platform === "win32"
}

function killTree(pid: number) {
  try {
    if (isWindows()) {
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" })
    } else {
      process.kill(-pid, "SIGKILL")
    }
  } catch {
    // process already dead
  }
}

function findSidecar(): string {
  const bundled = path.resolve(__dirname, "sidecar.js")
  if (fs.existsSync(bundled)) return bundled

  throw new Error(
    `Sidecar script not found at ${bundled}. ` +
    `Run 'bun run build' to build and copy the Node.js bundle.`
  )
}

export async function startServer(directory: string): Promise<ServerHandle> {
  const port = await findFreePort()
  const outputChannel = vscode.window.createOutputChannel("OpenCode Server")

  const sidecarPath = findSidecar()
  outputChannel.appendLine(`Starting sidecar: ${sidecarPath}`)

  const pluginDir = __dirname.replace(/\\/g, "/")

  const proc = fork(sidecarPath, [], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: path.join(pluginDir, "company/opencode.jsonc"),
      OPENCODE_COMPANY_PLUGIN_DIR: pluginDir,
      OPENCODE_CALLER: "vscode-chat",
      OPENCODE_PORT: String(port),
      OPENCODE_HOSTNAME: "127.0.0.1",
      OPENCODE_CORS: JSON.stringify(["vscode-webview://"]),
    },
    stdio: "pipe",
    silent: true,
  })

  let stderr = ""

  proc.stdout?.on("data", (data: Buffer) => {
    outputChannel.append(data.toString())
  })
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString()
    stderr += text
    outputChannel.append(text)
  })

  proc.on("error", (err) => {
    outputChannel.appendLine(`Process error: ${err.message}`)
  })

  proc.on("exit", (code, signal) => {
    outputChannel.appendLine(`opencode exited code=${code} signal=${signal}`)
    if (stderr) outputChannel.appendLine(`stderr: ${stderr.slice(-500)}`)
  })

  try {
    outputChannel.appendLine(`Waiting for server on port ${port}...`)
    await waitForReady(proc, port, 60_000, outputChannel)
    outputChannel.appendLine("Server ready")
  } catch (err) {
    outputChannel.appendLine(`Failed to connect: ${err}`)
    killTree(proc.pid!)
    throw err
  }

  const pid = proc.pid!

  return {
    port,
    process: proc,
    dispose() {
      outputChannel.appendLine(`Disposing server (pid=${pid})...`)
      killTree(pid)
    },
  }
}

function waitForReady(proc: ChildProcess, port: number, timeoutMs: number, output: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      output.appendLine("IPC ready signal timed out, falling back to health check...")
      pollServer(port, timeoutMs, output).then(resolve, reject)
    }, 10_000)

    proc.on("message", (msg: any) => {
      if (msg?.type === "error") {
        clearTimeout(timer)
        reject(new Error(msg.message))
        return
      }
      if (msg?.type === "ready") {
        clearTimeout(timer)
        output.appendLine("Sidecar reported ready via IPC")
        resolve()
      }
    })
  })
}
