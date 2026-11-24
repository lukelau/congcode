import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { DialogAlert } from "../../ui/dialog-alert"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { createNoteFile, listNotes, readNote, resolveNotesDirectory, slugify } from "../../util/notes"
import { notesRevision } from "../../util/notes-signal"

export function SidebarNotes(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const [refresh, setRefresh] = createSignal(0)
  const [view, updateView] = props.context.storage.store("notes.view", { initial: { open: true } })

  const directory = createMemo(() => {
    const configured = props.context.config?.data.notes?.directory
    return resolveNotesDirectory(props.context.paths?.cwd ?? props.context.data.location.default().directory, configured)
  })

  const [notes] = createResource(
    () => [directory(), refresh(), notesRevision()] as const,
    ([dir]) => listNotes(dir),
  )

  const reload = () => setRefresh((value) => value + 1)

  const preview = async (file: string, name: string) => {
    try {
      const content = await readNote(file)
      props.context.ui.dialog.show(() => <DialogAlert title={name} message={content || "(empty)"} />)
    } catch (error) {
      props.context.ui.toast.show({ message: String(error), variant: "error", duration: 4000 })
    }
  }

  const create = () => {
    props.context.ui.dialog.show(() => (
      <DialogPrompt
        title="New note"
        placeholder="note name"
        onConfirm={(value) => {
          const stem = slugify(value)
          void createNoteFile(directory(), stem)
            .then(() => {
              reload()
              props.context.ui.toast.show({ message: `Created ${stem}.md`, variant: "success", duration: 3000 })
            })
            .catch((error) =>
              props.context.ui.toast.show({ message: String(error), variant: "error", duration: 4000 }),
            )
        }}
      />
    ))
  }

  return (
    <box>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => {
          void updateView((draft) => {
            draft.open = !draft.open
          }).catch((error) => console.error("Failed to persist notes sidebar state", error))
        }}
      >
        <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
        <text fg={theme.text.base}>
          <b>Notes</b>
        </text>
        <box flexGrow={1} />
        <text fg={theme.text.muted} onMouseUp={create}>
          + new
        </text>
      </box>
      <Show when={view.open}>
        <Show
          when={notes() && notes()!.length > 0}
          fallback={
            <text fg={theme.text.muted} wrapMode="none" truncate>
              No notes yet
            </text>
          }
        >
          <For each={notes()}>
            {(note) => (
              <box
                flexDirection="row"
                gap={1}
                minWidth={0}
                onMouseUp={() => void preview(note.file, note.name)}
              >
                <text fg={theme.text.muted} flexShrink={0}>
                  •
                </text>
                <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  {note.name}
                </text>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "congcode.sidebar.notes",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarNotes context={context} sessionID={props.sessionID} />,
    })
  },
})