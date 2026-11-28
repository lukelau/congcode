/** @jsxImportSource @opentui/solid */
import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { useTuiPaths } from "../context/runtime"
import { Keymap } from "../context/keymap"
import { usePromptRef } from "../context/prompt"
import { buildFileTree, flattenFileTree, type FileTreeItem, type FileTreeRow } from "../feature-plugins/system/diff-viewer-file-tree-utils"
import { listWorkspaceEntries } from "../util/workspace-files"
import { truncateFilePath } from "../ui/file-path"

const PAGE_SIZE = 800

export function FileTreePane(props: { sessionID: string; width: number; focused: boolean; onFocus: () => void }) {
  const data = useData()
  const theme = useTheme()
  const paths = useTuiPaths()
  const prompt = usePromptRef()

  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set<number>())
  const [autoExpanded, setAutoExpanded] = createSignal(false)
  const [selected, setSelected] = createSignal<number | undefined>(undefined)
  const [limit, setLimit] = createSignal(PAGE_SIZE)
  const [revision, setRevision] = createSignal(0)

  const root = createMemo(() => paths.cwd ?? data.location.default().directory)

  const [entries] = createResource(
    () => ({ directory: root(), revision: revision(), sessionID: props.sessionID }),
    async (input) => listWorkspaceEntries(input.directory),
  )

  const tree = createMemo(() => {
    const list = entries()
    if (!list || list.length === 0) return undefined
    return buildFileTree(list.map((entry): FileTreeItem => ({ file: entry.path })))
  })

  // Expand the top level once so the tree opens showing content instead of a single collapsed root.
  createEffect(() => {
    const value = tree()
    if (!value || autoExpanded()) return
    const roots = new Set<number>()
    for (const id of value.roots) {
      if (value.nodes[id]?.kind === "directory") roots.add(id)
    }
    setAutoExpanded(true)
    if (roots.size > 0) setExpanded(roots)
  })

  const allRows = createMemo(() => {
    const value = tree()
    if (!value) return [] as FileTreeRow[]
    return flattenFileTree(value, expanded())
  })
  const rows = createMemo(() => allRows().slice(0, limit()))
  const hasMore = createMemo(() => allRows().length > rows().length)

  const refresh = () => {
    setLimit(PAGE_SIZE)
    setRevision((value) => value + 1)
  }

  const toggle = (row: FileTreeRow) => {
    if (row.kind !== "directory") return
    const next = new Set(expanded())
    if (next.has(row.id)) next.delete(row.id)
    else next.add(row.id)
    setExpanded(next)
    setLimit(PAGE_SIZE)
  }

  const current = () => rows().find((row) => row.id === selected())

  const move = (offset: number) => {
    const list = rows()
    if (list.length === 0) return
    const index = selected() === undefined ? -1 : list.findIndex((row) => row.id === selected())
    const next = Math.max(0, Math.min(list.length - 1, index + offset))
    const row = list[next]
    if (!row) return
    setSelected(row.id)
    if (hasMore() && next >= list.length - 1) setLimit((value) => value + PAGE_SIZE)
  }

  const expand = () => {
    const row = current() ?? rows()[0]
    if (!row) return
    if (row.kind === "directory") {
      if (!expanded().has(row.id)) toggle(row)
      setSelected(row.id)
      return
    }
    setSelected(row.id)
  }

  const collapse = () => {
    const row = current()
    if (!row) return
    if (row.kind === "directory" && expanded().has(row.id)) {
      toggle(row)
      return
    }
    // Otherwise jump to the parent directory row so ← walks back up the tree.
    const value = tree()
    if (!value) return
    for (let parent = value.nodes[row.id]?.parent; parent !== undefined; parent = value.nodes[parent]?.parent) {
      if (rows().some((item) => item.id === parent)) {
        setSelected(parent)
        return
      }
    }
  }

  // A row stores only its display name, so the full relative path is rebuilt from the parent chain.
  const relativePath = (row: FileTreeRow) => {
    const value = tree()
    if (!value) return row.name
    const segments: string[] = []
    for (let id: number | undefined = row.id; id !== undefined; id = value.nodes[id]?.parent) {
      const node = value.nodes[id]
      if (!node) break
      segments.unshift(node.name)
    }
    return segments.join("/")
  }

  const reference = (row: FileTreeRow) => {
    if (row.kind !== "file") return
    const ref = prompt.current
    if (!ref) return
    ref.insertReference(relativePath(row))
    ref.focus()
  }

  const activate = (row: FileTreeRow) => {
    setSelected(row.id)
    if (row.kind === "directory") toggle(row)
    else reference(row)
  }

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => props.focused && rows().length > 0,
    commands: [
      { bind: "up,k", title: "File tree: previous", group: "File tree", run: () => move(-1) },
      { bind: "down,j", title: "File tree: next", group: "File tree", run: () => move(1) },
      { bind: "left,h", title: "File tree: collapse", group: "File tree", run: collapse },
      { bind: "right,l", title: "File tree: expand", group: "File tree", run: expand },
      { bind: "return,space", title: "File tree: open / reference", group: "File tree", run: () => {
        const row = current()
        if (row) activate(row)
      } },
    ],
  }))

  const label = (row: FileTreeRow) => {
    const width = Math.max(8, props.width - 4 - row.depth * 2)
    return truncateFilePath(row.name, width)
  }

  return (
    <box
      width={props.width}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.background.raised.base}
      border={["right"]}
      borderColor={theme.border.base}
      onMouseDown={props.onFocus}
    >
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} paddingTop={1} flexShrink={0}>
        <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1}>
          {root() ?? ""}
        </text>
        <text fg={theme.text.muted} onMouseUp={refresh}>
          ⟳
        </text>
      </box>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        focusable
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Switch>
          <Match when={entries.loading}>
            <text fg={theme.text.muted} paddingLeft={1}>
              Loading…
            </text>
          </Match>
          <Match when={rows().length === 0}>
            <text fg={theme.text.muted} paddingLeft={1}>
              No files
            </text>
          </Match>
          <Match when={rows().length > 0}>
            <For each={rows()}>
              {(row) => {
                const isSelected = () => selected() === row.id
                const open = () => row.kind === "directory" && expanded().has(row.id)
                return (
                  <box
                    flexDirection="row"
                    height={1}
                    flexShrink={0}
                    backgroundColor={isSelected() && props.focused ? theme.background.raised.high : undefined}
                    onMouseDown={(event: MouseEvent) => {
                      if (event.button !== MouseButton.LEFT) return
                      event.stopPropagation()
                      props.onFocus()
                      setSelected(row.id)
                    }}
                    onMouseUp={(event: MouseEvent) => {
                      if (event.button !== MouseButton.LEFT) return
                      event.stopPropagation()
                      activate(row)
                    }}
                  >
                    <text wrapMode="none" flexShrink={0}>
                      <span style={{ fg: theme.text.muted }}>
                        {`${"  ".repeat(Math.min(row.depth, 10))}${row.kind === "directory" ? (open() ? "v " : "> ") : "  "}`}
                      </span>
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={
                          row.kind === "directory"
                            ? theme.text.base
                            : isSelected()
                              ? theme.text.action.primary.selected
                              : theme.text.muted
                        }
                        attributes={isSelected() ? TextAttributes.BOLD : undefined}
                        wrapMode="none"
                        truncate
                      >
                        {label(row)}
                      </text>
                    </box>
                  </box>
                )
              }}
            </For>
            <Show when={hasMore()}>
              <text fg={theme.text.muted} paddingLeft={1} onMouseDown={() => setLimit((value) => value + PAGE_SIZE)}>
                … {allRows().length - rows().length} more
              </text>
            </Show>
          </Match>
        </Switch>
      </scrollbox>
      <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          ↑↓ move  ←→ expand
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          Enter/@ reference
        </text>
      </box>
    </box>
  )
}