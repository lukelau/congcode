import { createSignal } from "solid-js"

// Shared revision counter so any component can ask the notes sidebar to reload
// after a note file is written elsewhere (e.g. "Save as Note" in a message menu).
const [revision, setRevision] = createSignal(0)

export const notesRevision = revision

export function bumpNotesRevision(): void {
  setRevision((value) => value + 1)
}