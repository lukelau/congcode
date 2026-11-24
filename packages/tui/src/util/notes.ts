import path from "node:path"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"

const DEFAULT_DIRECTORY = ".opencode/notes"
const NOTE_EXTENSION = ".md"

export type NoteFile = {
  name: string
  file: string
  size: number
  modified: number
}

/** Resolve the notes directory for a project, honoring a configured value. */
export function resolveNotesDirectory(cwd: string, configured?: string): string {
  const target = configured?.trim() || DEFAULT_DIRECTORY
  return path.isAbsolute(target) ? target : path.join(cwd, target)
}

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** Turn a free-form title into a safe filename stem. */
export function slugify(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return cleaned || "note"
}

/** Append a titled, timestamped block of markdown to a note file. */
export async function appendNote(input: {
  directory: string
  file: string
  title?: string
  body: string
}): Promise<{ file: string }> {
  await mkdir(input.directory, { recursive: true })
  const file = path.join(input.directory, input.file.endsWith(NOTE_EXTENSION) ? input.file : `${input.file}${NOTE_EXTENSION}`)

  let header: string
  try {
    const info = await stat(file)
    header = info.size > 0 ? "\n\n" : ""
  } catch {
    header = ""
  }

  const title = input.title?.trim()
  const block =
    `${header}## ${title || "Note"} — ${timestamp()}\n\n` + input.body.trimEnd() + "\n"
  await writeFile(file, block, { flag: "a" })
  return { file }
}

/** Create (or touch) an empty note file. */
export async function createNoteFile(directory: string, file: string): Promise<{ file: string }> {
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, file.endsWith(NOTE_EXTENSION) ? file : `${file}${NOTE_EXTENSION}`)
  await writeFile(target, `# ${path.basename(target, NOTE_EXTENSION)}\n`, { flag: "a" })
  return { file: target }
}

/** List markdown note files in a directory, newest first. Missing directory yields []. */
export async function listNotes(directory: string): Promise<NoteFile[]> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const notes: NoteFile[] = []
  for (const entry of entries) {
    if (!entry.endsWith(NOTE_EXTENSION)) continue
    const file = path.join(directory, entry)
    try {
      const info = await stat(file)
      if (!info.isFile()) continue
      notes.push({ name: path.basename(entry, NOTE_EXTENSION), file, size: info.size, modified: info.mtimeMs })
    } catch {
      // ignore unreadable entries
    }
  }
  return notes.sort((a, b) => b.modified - a.modified)
}

/** Read a note file's contents. */
export async function readNote(file: string): Promise<string> {
  return readFile(file, "utf8")
}

/** Extract plain text from an assistant message's content parts. */
export function assistantText(content: ReadonlyArray<unknown>): string {
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim()
}