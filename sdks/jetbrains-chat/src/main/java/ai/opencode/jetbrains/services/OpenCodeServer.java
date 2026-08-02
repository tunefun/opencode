package ai.opencode.jetbrains.services;

import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.extensions.PluginId;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

public class OpenCodeServer {

    private static final Logger log = Logger.getInstance(OpenCodeServer.class);

    private int port;
    private Process process;
    private final ConcurrentHashMap<String, Boolean> activeProjects = new ConcurrentHashMap<>();
    private final AtomicReference<CompletableFuture<Void>> pending = new AtomicReference<>();

    public int getPort() {
        return port;
    }

    public boolean isRunning() {
        return process != null && process.isAlive();
    }

    public CompletableFuture<Void> ensureStarted(String workspaceDir) {
        activeProjects.put(workspaceDir, true);

        if (isRunning()) return CompletableFuture.completedFuture(null);

        CompletableFuture<Void> existing = pending.get();
        if (existing != null) return existing;

        CompletableFuture<Void> future = new CompletableFuture<>();
        if (!pending.compareAndSet(null, future)) {
            CompletableFuture<Void> current = pending.get();
            return current != null ? current : future;
        }

        port = findFreePort();
        List<String> cmd = buildCommand();
        log.info("Starting opencode server on port " + port + ": " + String.join(" ", cmd));

        try {
            ProcessBuilder pb = new ProcessBuilder(cmd)
                .directory(new File(workspaceDir));
            String pluginDir = resolvePluginDir().replace('\\', '/');
            pb.environment().put("OPENCODE_CONFIG", pluginDir + "/company/opencode.jsonc");
            pb.environment().put("OPENCODE_COMPANY_PLUGIN_DIR", pluginDir);
            pb.environment().put("OPENCODE_CALLER", "jetbrains-chat");
            pb.environment().put("OPENCODE_PORT", String.valueOf(port));
            pb.environment().put("OPENCODE_HOSTNAME", "127.0.0.1");
            pb.environment().put("OPENCODE_CORS", "[\"http://plugin-internal\"]");
            process = pb.start();

            Thread stdoutThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                  String line;
                    while ((line = reader.readLine()) != null) {
                        log.info("[opencode stdout] " + line);
                    }
                } catch (Exception e) {
                  log.error("Server process ended unexpectedly", e);
                    // process ended
                }
            }, "opencode-server-stdout");
            stdoutThread.start();

            Thread stderrThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream()))) {
                  String line;
                    while ((line = reader.readLine()) != null) {
                        log.info("[opencode stderr] " + line);
                    }
                } catch (Exception e) {
                  log.error("Server process ended unexpectedly", e);
                    // process ended
                }
            }, "opencode-server-stderr");
            stderrThread.start();

            pollServer().thenAccept(v -> future.complete(null))
                .exceptionally(e -> {
                    log.error("Server health check failed", e);
                    dispose();
                    future.completeExceptionally(e);
                    return null;
                });
        } catch (Exception e) {
            log.error("Failed to start opencode server", e);
            pending.set(null);
            future.completeExceptionally(e);
        }

        return future;
    }

    public void releaseProject(String workspaceDir) {
        activeProjects.remove(workspaceDir);
        if (activeProjects.isEmpty()) {
            dispose();
        }
    }

    public void dispose() {
        pending.set(null);
        if (process != null) {
            try {
                process.descendants().forEach(p -> p.destroyForcibly());
                process.destroyForcibly();
            } catch (Exception ignored) {}
            process = null;
        }
        port = 0;
    }

    private List<String> buildCommand() {
        String nodePath = findNodeExecutable();
        if (nodePath == null) {
            throw new IllegalStateException("Node.js not found. Install Node.js 22+ to run the OpenCode server.");
        }

        String sidecarPath = resolvePluginDir() + "/dist/sidecar.cjs";
        if (!new File(sidecarPath).exists()) {
            throw new IllegalStateException("Sidecar not found at " + sidecarPath + ". Rebuild the plugin's node bundle.");
        }
        return List.of(nodePath, sidecarPath);
    }

    private String findNodeExecutable() {
        String bundled = findBundledNode();
        if (bundled != null) return bundled;

        String cmd = isWindows() ? "node.exe" : "node";
        String pathEnv = System.getenv("PATH");
        if (pathEnv != null) {
            for (String dir : pathEnv.split(Pattern.quote(File.pathSeparator))) {
                if (dir == null || dir.isEmpty()) continue;
                File candidate = new File(dir, cmd);
                if (candidate.isFile()) return candidate.getAbsolutePath();
            }
        }

        if (isWindows()) {
            String programFiles = System.getenv("ProgramFiles");
            String programFilesX86 = System.getenv("ProgramFiles(x86)");
            String localAppData = System.getenv("LOCALAPPDATA");
            for (String dir : new String[]{
                programFiles != null ? programFiles + "\\nodejs" : null,
                programFilesX86 != null ? programFilesX86 + "\\nodejs" : null,
                localAppData != null ? localAppData + "\\Programs\\nodejs" : null,
            }) {
                if (dir == null) continue;
                File candidate = new File(dir, "node.exe");
                if (candidate.isFile()) return candidate.getAbsolutePath();
            }
        } else {
            for (String p : new String[]{"/usr/bin/node", "/usr/local/bin/node", "/opt/homebrew/bin/node"}) {
                if (new File(p).isFile()) return p;
            }
        }
        return null;
    }

    private String findBundledNode() {
        String os = System.getProperty("os.name", "").toLowerCase();
        String arch = System.getProperty("os.arch", "").toLowerCase();
        String platform = os.contains("win") ? "win32" : os.contains("mac") ? "darwin" : "linux";
        String archName = arch.contains("aarch64") || arch.contains("arm64") ? "arm64" : "x64";
        String exe = os.contains("win") ? "node.exe" : "node";
        File candidate = new File(resolvePluginDir() + "/dist/node-runtime/" + platform + "-" + archName + "/" + exe);
        if (!candidate.isFile()) return null;
        if (!isWindows()) {
            try {
                candidate.setExecutable(true, false);
            } catch (Exception e) {
                log.warn("Failed to make bundled node executable: " + candidate, e);
            }
        }
        return candidate.getAbsolutePath();
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private String resolvePluginDir() {
        var plugin = PluginManagerCore.getPlugin(PluginId.getId("ai.opencode.jetbrains-chat"));
        if (plugin != null && plugin.getPluginPath() != null) {
            return plugin.getPluginPath().toFile().getAbsolutePath();
        }
        throw new IllegalStateException("Plugin not found");
    }

    private int findFreePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (Exception e) {
            return 4096;
        }
    }

    private CompletableFuture<Void> pollServer() {
        HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
        String url = "http://127.0.0.1:" + port + "/global/health";
        CompletableFuture<Void> future = new CompletableFuture<>();
        long deadline = System.currentTimeMillis() + 60_000;

        Thread pollThread = new Thread(() -> {
            while (isRunning() && System.currentTimeMillis() < deadline) {
                try {
                    HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(2))
                        .GET()
                        .build();
                    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                    if (response.statusCode() >= 200 && response.statusCode() < 300) {
                        future.complete(null);
                        return;
                    }
                } catch (Exception ignored) {}
                try { Thread.sleep(200); } catch (InterruptedException e) { break; }
            }
            future.completeExceptionally(new RuntimeException("Health check timed out"));
        }, "opencode-health-check");
        pollThread.start();

        return future;
    }
}
