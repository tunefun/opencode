import "@/index.css"
import "./ide.css"
import { Show, lazy, onMount, type ParentProps } from "solid-js"
import { Navigate, Route, Router, useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { render } from "solid-js/web"
import { AppBaseProviders, PlatformProvider, ServerConnection } from "@opencode-ai/app"
import { ServerProvider } from "@/context/server"
import { GlobalProvider } from "@/context/global"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { TabsProvider, useTabs } from "@/context/tabs"
import { SettingsProvider } from "@/context/settings"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { CommandProvider } from "@/context/command"
import { HighlightsProvider } from "@/context/highlights"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createIDEPlatform, getHostApi, getServerInfo, onHostMessage } from "./platform"
import { FileProvider } from "@/context/file"
import { PromptProvider, usePrompt } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import { SessionSwitcher } from "./session-switcher"
import { TargetSessionRouteContent } from "@/pages/session"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useSettingsDialog } from "@/components/settings-dialog"
import { useLanguage } from "@/context/language"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Button } from "@opencode-ai/ui/button"
import { installClipboardPolyfill } from "./clipboard"

// 必须在应用渲染前执行，确保会话区代码块的复制按钮在非安全上下文
// （JetBrains 的 plugin-internal webview）中也能工作。
installClipboardPolyfill()

const NewSession = lazy(() => import("@/pages/new-session"))

const serverInfo = getServerInfo()
const platform = createIDEPlatform()
const host = getHostApi()
const defaultServer = ServerConnection.Key.make(serverInfo.url)
const Directory = serverInfo.directory

const servers: ServerConnection.Any[] = [
  {
    type: "http",
    http: { url: serverInfo.url },
    authToken: false,
  },
]

type PendingFile = { path: string; selection?: { startLine: number; startChar: number; endLine: number; endChar: number } }
const pendingFiles: PendingFile[] = []
let componentMounted = false

onHostMessage((msg) => {
  if (msg.type !== "addFile") return
  if (componentMounted) return
  pendingFiles.push({ path: msg.path, selection: msg.selection })
})

function IDEFileHandler() {
  const prompt = usePrompt()

  onMount(() => {
    componentMounted = true
    for (const file of pendingFiles.splice(0)) {
      prompt.context.add({ type: "file", path: file.path, selection: file.selection as any })
    }
  })

  onHostMessage((msg) => {
    if (msg.type !== "addFile") return
    prompt.context.add({ type: "file", path: msg.path, selection: msg.selection as any })
  })

  return null
}

// The IDE sidebar should not show the right-hand Context / Git Changes panels by
// default, even if a previous session persisted them as open. Close them on mount.
function IDEResetSidePanels() {
  const layout = useLayout()
  const { view } = useSessionLayout()
  onMount(() => {
    view().reviewPanel.close()
    layout.fileTree.close()
  })
  return null
}

// New-layout target session route: /server/:serverKey/session/:id
function IDETargetSessionRoute() {
  return (
    <>
      <IDEResetSidePanels />
      <TargetSessionRouteContent />
    </>
  )
}

// New-layout draft route: /new-session?draftId=…
function IDEDraftRoute() {
  const tabs = useTabs()
  const server = useServer()
  const sdk = useSDK()
  const navigate = useNavigate()
  const [search] = useSearchParams<{ draftId?: string }>()

  onMount(() => {
    if (search.draftId) return
    void tabs.newDraft({ server: server.key, directory: sdk().directory }).then((draft) => {
      navigate(`/new-session?draftId=${draft.draftID}`, { replace: true })
    })
  })

  return (
    <FileProvider>
      <PromptProvider>
        <IDEFileHandler />
        <CommentsProvider>
          <NewSession />
        </CommentsProvider>
      </PromptProvider>
    </FileProvider>
  )
}

// +New button: create a draft tab and navigate to it, matching the app's new layout.
function NewSessionButton() {
  const language = useLanguage()
  const tabs = useTabs()
  const server = useServer()
  const sdk = useSDK()
  const navigate = useNavigate()
  const newSession = async () => {
    const draft = await tabs.newDraft({ server: server.key, directory: sdk().directory })
    navigate(`/new-session?draftId=${draft.draftID}`)
  }
  return (
    <TooltipV2 placement="bottom" value={language.t("command.session.new")}>
      <Button
        type="button"
        variant="ghost"
        size="small"
        icon="new-session"
        class="text-text-muted hover:text-text-base"
        aria-label={language.t("command.session.new")}
        onClick={() => void newSession()}
      />
    </TooltipV2>
  )
}

// Settings gear opens the same v2 settings dialog as the native web app.
function SettingsButton() {
  const language = useLanguage()
  const openSettings = useSettingsDialog()
  return (
    <TooltipV2 placement="bottom" value={language.t("sidebar.settings")}>
      <IconButtonV2
        type="button"
        variant="ghost-muted"
        size="small"
        class="shrink-0"
        aria-label={language.t("sidebar.settings")}
        onClick={openSettings}
        icon={<IconV2 name="settings-gear" />}
      />
    </TooltipV2>
  )
}

// Redirect legacy /:dir/session/:id to the new-layout server route.
function IDELegacySessionRedirect() {
  const params = useParams<{ id: string }>()
  const server = useServer()
  return <Navigate href={sessionHref(server.key, params.id)} />
}

function IDEShell(props: ParentProps) {
  const language = useLanguage()
  return (
    <div class="ide-webview flex flex-col h-dvh">
      <div class="flex items-center shrink-0 h-9 px-3 gap-1">
        <span class="flex-1" />
        <SessionSwitcher directory={Directory} />
        <NewSessionButton />
        <TooltipV2 placement="bottom" value={language.t("status.popover.trigger")}>
          <StatusPopoverV2 />
        </TooltipV2>
        <SettingsButton />
      </div>
      <div class="flex-1 min-h-0 contain-strict">{props.children}</div>
    </div>
  )
}

function IDERouter() {
  return (
    <Router
      root={(props: ParentProps) => (
        <TabsProvider>
          <LayoutProvider>
            <NotificationProvider>
              <PermissionProvider directory={() => Directory}>
                <ModelsProvider directory={() => Directory}>
                  <SDKProvider directory={Directory}>
                    <DirectoryDataProvider directory={Directory}>
                      <IDEShell>{props.children}</IDEShell>
                    </DirectoryDataProvider>
                  </SDKProvider>
                </ModelsProvider>
              </PermissionProvider>
            </NotificationProvider>
          </LayoutProvider>
        </TabsProvider>
      )}
    >
      <Route path="/new-session" component={IDEDraftRoute} />
      <Route path="/server/:serverKey/session/:id" component={IDETargetSessionRoute} />
      <Route path="/:dir/session/:id" component={IDELegacySessionRedirect} />
      <Route path="/*all" component={IDEDraftRoute} />
    </Router>
  )
}

function NoDirectory() {
  return (
    <div class="h-dvh flex items-center justify-center bg-background-base text-text-weak text-14-regular">
      No workspace directory
    </div>
  )
}

function App() {
  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <ServerProvider defaultServer={defaultServer} servers={servers}>
          <Show when={Directory} fallback={<NoDirectory />}>
            <GlobalProvider>
              <SettingsProvider>
                <ServerSDKProvider>
                  <ServerSyncProvider>
                    <CommandProvider>
                      <HighlightsProvider>
                        <IDERouter />
                      </HighlightsProvider>
                    </CommandProvider>
                  </ServerSyncProvider>
                </ServerSDKProvider>
              </SettingsProvider>
            </GlobalProvider>
          </Show>
        </ServerProvider>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

const root = document.getElementById("root")
if (root instanceof HTMLElement) {
  render(() => <App />, root)
}

if (host) {
  host.postMessage({ type: "ready" })
}
