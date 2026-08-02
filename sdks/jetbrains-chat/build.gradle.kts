plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.0"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "ai.opencode"
version = "1.15.10"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create("IC", "2024.3")
    }
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
}

intellijPlatform {
    pluginConfiguration {
        name = "OpenCode Chat"
        id = "ai.opencode.jetbrains-chat"

        ideaVersion {
            sinceBuild = "241"
        }

        vendor {
            name = "OpenCode"
            url = "https://opencode.ai"
        }
        description = provider { "AI-powered coding assistant chat panel for JetBrains IDEs" }
        changeNotes = provider { """
            <h3>1.15.10</h3>
            <ul>
              <li>Initial release</li>
            </ul>
        """.trimIndent() }
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.named("processResources") {
    dependsOn("syncWebview")
}

tasks.register("syncWebview") {
    doLast {
        val src = file("../../packages/ide-plugin-webview/dist")
        val dst = file("src/main/resources/webview")
        if (src.exists()) {
            copy {
                from(src)
                into(dst)
            }
        }
    }
}

tasks.register("syncNodeBundle") {
    doLast {
        val src = file("../../packages/opencode/dist/node")
        val dst = file("dist/node")
        if (!src.exists()) return@doLast
        copy {
            from(src)
            into(dst)
        }
        file("$dst/package.json").writeText("{\"type\":\"module\"}")
        val jsonc = file("../../packages/opencode/node_modules/jsonc-parser")
        if (jsonc.exists()) {
            copy {
                from(jsonc)
                into("$dst/node_modules/jsonc-parser")
            }
        }
        val ptyDir = file("$dst/node_modules/@lydell/node-pty")
        ptyDir.mkdirs()
        file("$ptyDir/package.json").writeText("{\"type\":\"module\",\"main\":\"index.js\"}")
        file("$ptyDir/index.js").writeText(
            "export function spawn() { throw new Error('@lydell/node-pty is not available in JetBrains plugin') }\n",
        )
    }
}

tasks.register("syncCompany") {
    doLast {
        val script = file("../company/build.mjs")
        val staging = file("../company/.build")
        val dst = file("dist/company")
        val proc = ProcessBuilder("node", script.absolutePath).inheritIO().start()
        if (proc.waitFor() != 0) throw GradleException("Failed to prepare company bundle")
        dst.deleteRecursively()
        copy {
            from(staging)
            into(dst)
        }
    }
}

val nodeRuntimeVersion = "v24.18.1"

data class NodeRuntimeTarget(val dir: String, val archive: String, val binaryPath: String, val binaryName: String)

fun nodeRuntimeTargets(): List<NodeRuntimeTarget> {
    val v = nodeRuntimeVersion
    return listOf(
        NodeRuntimeTarget("win32-x64", "node-$v-win-x64.zip", "node-$v-win-x64/node.exe", "node.exe"),
        NodeRuntimeTarget("win32-arm64", "node-$v-win-arm64.zip", "node-$v-win-arm64/node.exe", "node.exe"),
        NodeRuntimeTarget("darwin-x64", "node-$v-darwin-x64.tar.gz", "node-$v-darwin-x64/bin/node", "node"),
        NodeRuntimeTarget("darwin-arm64", "node-$v-darwin-arm64.tar.gz", "node-$v-darwin-arm64/bin/node", "node"),
        NodeRuntimeTarget("linux-x64", "node-$v-linux-x64.tar.xz", "node-$v-linux-x64/bin/node", "node"),
        NodeRuntimeTarget("linux-arm64", "node-$v-linux-arm64.tar.xz", "node-$v-linux-arm64/bin/node", "node"),
    )
}

tasks.register("syncNodeRuntime") {
    doLast {
        val workDir = file("build/node-runtime-download")
        workDir.mkdirs()
        for (target in nodeRuntimeTargets()) {
            val destNode = file("dist/node-runtime/${target.dir}/${target.binaryName}")
            if (destNode.exists()) {
                println("syncNodeRuntime: ${target.dir} already present, skip")
                continue
            }
            try {
                bundleNodeRuntime(project, workDir, target)
            } catch (e: Exception) {
                if (target.dir == currentPlatformNodeDir()) {
                    bundleLocalNode(project, destNode)
                    println("syncNodeRuntime: ${target.dir} bundled from local Node.js")
                } else {
                    println("syncNodeRuntime: WARNING failed to bundle ${target.dir}: ${e.message}")
                }
            }
        }
    }
}

fun bundleNodeRuntime(project: Project, workDir: File, target: NodeRuntimeTarget) {
    val url = "https://nodejs.org/dist/$nodeRuntimeVersion/${target.archive}"
    val archive = File(workDir, target.archive)
    var extracted: File? = null
    for (round in 1..6) {
        downloadWithResume(workDir, archive, url)
        runProcessIgnoreExit(workDir, listOf("tar", "-xf", target.archive, target.binaryPath))
        val candidate = File(workDir, target.binaryPath)
        if (candidate.isFile) {
            extracted = candidate
            break
        }
        println("syncNodeRuntime: ${target.dir} extraction produced no binary (round $round)")
        archive.delete()
    }
    if (extracted == null) throw GradleException("Failed to obtain node runtime for ${target.dir}")
    val destNode = project.file("dist/node-runtime/${target.dir}/${target.binaryName}")
    destNode.parentFile.mkdirs()
    project.copy {
        from(extracted)
        into(destNode.parentFile)
        if (!target.binaryName.endsWith(".exe")) {
            filePermissions { unix("rwxr-xr-x") }
        }
    }
    println("syncNodeRuntime: bundled ${target.dir}")
}

fun runProcessIgnoreExit(workDir: File, args: List<String>) {
    try {
        val process = ProcessBuilder(args).directory(workDir).redirectErrorStream(true).start()
        process.inputStream.bufferedReader().readText()
        process.waitFor()
    } catch (ignored: Exception) {}
}

fun downloadWithResume(workDir: File, file: File, url: String) {
    var attempts = 0
    var unchanged = 0
    while (attempts < 40 && unchanged < 3) {
        val before = file.length()
        try {
            runProcess(workDir, listOf("curl", "-sS", "-L", "-C", "-", "-o", file.absolutePath, url))
        } catch (ignored: Exception) {
            // Resume may fail (e.g. range not supported); keep trying.
        }
        val after = file.length()
        if (after == before) unchanged++ else unchanged = 0
        attempts++
    }
}

fun runProcess(workDir: File, args: List<String>) {
    val process = ProcessBuilder(args).directory(workDir).redirectErrorStream(true).start()
    val output = process.inputStream.bufferedReader().readText()
    val code = process.waitFor()
    if (code != 0) {
        throw GradleException("Command failed ($code): ${args.joinToString(" ")}\n$output")
    }
}

fun currentPlatformNodeDir(): String {
    val os = System.getProperty("os.name").lowercase()
    val arch = System.getProperty("os.arch").lowercase()
    val platform = when {
        os.contains("win") -> "win32"
        os.contains("mac") -> "darwin"
        else -> "linux"
    }
    val archName = if (arch.contains("aarch64") || arch.contains("arm64")) "arm64" else "x64"
    return "$platform-$archName"
}

fun bundleLocalNode(project: Project, destNode: File) {
    val exeName = if (System.getProperty("os.name").lowercase().contains("win")) "node.exe" else "node"
    val local = findLocalNode(exeName) ?: return
    destNode.parentFile.mkdirs()
    project.copy {
        from(local)
        into(destNode.parentFile)
    }
}

fun findLocalNode(exeName: String): File? {
    val path = System.getenv("PATH") ?: return null
    for (dir in path.split(File.pathSeparator)) {
        if (dir.isBlank()) continue
        val f = File(dir, exeName)
        if (f.isFile()) return f
    }
    return null
}

tasks.named("prepareSandbox") {
    dependsOn("syncNodeBundle", "syncNodeRuntime", "syncCompany")
    doLast {
        val nodeDir = file("dist/node")
        if (nodeDir.exists()) {
            copy {
                from(nodeDir)
                into("${layout.buildDirectory.get()}/idea-sandbox/IC-2024.3/plugins/${project.name}/dist/node")
            }
        }
        val nodeRuntimeDir = file("dist/node-runtime")
        if (nodeRuntimeDir.exists()) {
            copy {
                from(nodeRuntimeDir)
                into("${layout.buildDirectory.get()}/idea-sandbox/IC-2024.3/plugins/${project.name}/dist/node-runtime")
            }
        }
        val sidecar = file("dist/sidecar.cjs")
        if (sidecar.exists()) {
            copy {
                from(sidecar)
                into("${layout.buildDirectory.get()}/idea-sandbox/IC-2024.3/plugins/${project.name}/dist")
            }
        }
        val companyDir = file("dist/company")
        if (companyDir.exists()) {
            copy {
                from(companyDir)
                into("${layout.buildDirectory.get()}/idea-sandbox/IC-2024.3/plugins/${project.name}/company")
            }
        }
    }
}

