import { Show, onMount, createMemo, For, Match, Switch, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useServer } from "@/context/server"
import { sessionTitle } from "@/utils/session-title"
import { messageAgentColor } from "@/utils/agent"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { sessionHref } from "@/utils/session-route"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const ROW = "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] border-0 bg-transparent text-left transition-colors duration-100 hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"

export function SessionSwitcher(props: { directory: string }) {
  const sync = useSync()
  const serverSync = useServerSync()
  const language = useLanguage()
  const navigate = useNavigate()
  const permission = usePermission()
  const server = useServer()
  const [open, setOpen] = createSignal(false)

  onMount(() => {
    void serverSync().project.loadSessions(props.directory)
  })

  const [workspaceStore, setWorkspaceStore] = serverSync().child(props.directory, { bootstrap: false })

  const sessions = createMemo(() =>
    sortedRootSessions(sync().data, Date.now()),
  )

  const hasMore = createMemo(() => workspaceStore.sessionTotal > sessions().length)

  const loadMore = async () => {
    setWorkspaceStore("limit", (limit) => (limit ?? 0) + 5)
    await serverSync().project.loadSessions(props.directory)
  }

  const groups = createMemo(() => {
    const records = sessions().map((s) => ({ session: s }))
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000

    const today: typeof records = []
    const yest: typeof records = []
    const older: typeof records = []

    for (const r of records) {
      const t = r.session.time.updated ?? r.session.time.created
      if (t >= todayStart) today.push(r)
      else if (t >= yesterdayStart) yest.push(r)
      else older.push(r)
    }

    return [
      { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: today },
      { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yest },
      { id: "older" as const, title: language.t("home.sessions.group.older"), sessions: older },
    ].filter((g) => g.sessions.length > 0)
  })

  return (
    <TooltipV2 placement="bottom" value={language.t("home.sessions.search.sessions")}>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "small",
          icon: "bubble-5",
          class: "text-text-muted hover:text-text-base",
          "aria-label": language.t("home.sessions.search.sessions"),
        }}
        trigger=""
      class="[&_[data-slot=popover-body]]:p-0 w-[280px] max-w-[calc(100vw-20px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-start"
    >
      <Show when={open()}>
        <div class="flex flex-col rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)] overflow-hidden">
          <div class="flex items-center justify-between shrink-0 h-9 px-3 border-b border-border-weak-base">
            <span class="text-12-medium text-text-strong">Sessions</span>
          </div>
          <div class="max-h-[320px] overflow-auto p-1">
            <For each={groups()}>
              {(group) => (
                <div class="mb-1">
                  <div class="text-10-medium text-text-muted uppercase tracking-wider px-2 py-0.5">
                    {group.title}
                  </div>
                  <For each={group.sessions}>
                    {(record) => {
                      const s = record.session
                      const [sessionStore] = serverSync().child(s.directory, { bootstrap: false })
                      const tint = createMemo(() =>
                        messageAgentColor(serverSync().session.data.message[s.id], sessionStore.agent),
                      )
                      const isWorking = createMemo(() => {
                        if (
                          !!sessionPermissionRequest(
                            sessionStore.session,
                            serverSync().session.data.permission,
                            s.id,
                            (item) => !permission.autoResponds(item, s.directory),
                          )
                        )
                          return false
                        return serverSync().session.data.session_working(s.id)
                      })
                      const hasPermissions = createMemo(() =>
                        !!sessionPermissionRequest(
                          sessionStore.session,
                          serverSync().session.data.permission,
                          s.id,
                          (item) => !permission.autoResponds(item, s.directory),
                        ),
                      )

                      return (
                        <button
                          type="button"
                          class={`${ROW} h-8 gap-1.5 px-2`}
                          onClick={() => {
                            setOpen(false)
                            navigate(sessionHref(server.key, s.id))
                          }}
                        >
                          <Show when={isWorking() || hasPermissions()}>
                            <div
                              class="flex size-3 shrink-0 items-center justify-center"
                              style={{ color: tint() ?? "inherit" }}
                            >
                              <Switch>
                                <Match when={isWorking()}>
                                  <Spinner class="size-2.5" />
                                </Match>
                                <Match when={hasPermissions()}>
                                  <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                                </Match>
                              </Switch>
                            </div>
                          </Show>
                          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-12-regular text-text-base [font-weight:530] flex-1">
                            {sessionTitle(s.title) || s.id}
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              )}
            </For>
            <Show when={hasMore()}>
              <button
                type="button"
                class="flex w-full text-left text-12-regular text-text-weak hover:text-text-base px-2 py-1.5 rounded"
                onClick={() => void loadMore()}
              >
                {language.t("common.loadMore")}
              </button>
            </Show>
            <Show when={groups().length === 0 && !hasMore()}>
              <div class="px-3 py-4 text-12-regular text-text-weak text-center">
                No sessions yet
              </div>
            </Show>
          </div>
        </div>
      </Show>
      </Popover>
    </TooltipV2>
  )
}
