import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { defineConfig } from "vite"

const theme = fileURLToPath(new URL("../app/public/oc-theme-preload.js", import.meta.url))

export default defineConfig({
  plugins: [
    {
      name: "ide-webview:config",
      config() {
        return {
          resolve: {
            alias: {
              "@": fileURLToPath(new URL("../app/src", import.meta.url)),
            },
          },
          define: {
            "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify("prod"),
          },
          worker: {
            format: "es",
          },
        }
      },
    },
    {
      name: "ide-webview:theme-preload",
      transformIndexHtml(html) {
        return html.replace(
          '<script id="oc-theme-preload-script" data-inline></script>',
          `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
        )
      },
    },
    tailwindcss(),
    solidPlugin(),
  ],
  base: "./",
  server: {
    cors: {
      origin: /^vscode-webview:\/\//,
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
    sourcemap: false,
    assetsInlineLimit: 0,
  },
})
