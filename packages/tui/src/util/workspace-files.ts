import { readdir } from "node:fs/promises"
import path from "node:path"

/** A path relative to the listed root, using forward slashes. */
export type WorkspaceEntry = {
  readonly path: string
  readonly kind: "file" | "directory"
}

const MAX_ENTRIES = 5000
const MAX_DEPTH = 12

// Directories that are never useful to show in a working-tree file list.
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  ".next",
  ".nuxt",
  ".cache",
  ".venv",
  "__pycache__",
])

/** Files and directories under `root`, parents before their children, each level sorted directory-first. */
export async function listWorkspaceEntries(root: string): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = []
  await visit(root, "", 0, entries)
  return entries
}

async function visit(directory: string, relative: string, depth: number, entries: WorkspaceEntry[]) {
  if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return
  let items
  try {
    items = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  items.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  for (const item of items) {
    if (entries.length >= MAX_ENTRIES) return
    if (item.name.startsWith(".") && item.name !== ".gitignore") continue
    const next = relative ? `${relative}/${item.name}` : item.name
    if (item.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(item.name)) continue
      entries.push({ path: next, kind: "directory" })
      await visit(path.join(directory, item.name), next, depth + 1, entries)
      continue
    }
    if (!item.isFile()) continue
    entries.push({ path: next, kind: "file" })
  }
}