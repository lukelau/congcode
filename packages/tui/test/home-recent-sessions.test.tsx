import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

function session(id: string, title: string, projectID: string, dir: string, updated: number) {
  return {
    id,
    parentID: undefined,
    projectID,
    title,
    location: { directory: dir },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated },
  }
}

// Two roots in the current directory that belong to different projects: the home
// list filters by directory alone, so both show even though the project root was
// resolved differently. The third session is in another directory and must not.
const local = [
  session("ses_new", "Newest local", "proj_a", directory, 300),
  session("ses_old", "Older other project", "proj_b", directory, 100),
]
const elsewhere = session("ses_other", "Elsewhere", "proj_a", `${directory}/elsewhere`, 400)
const all = new Map([...local, elsewhere].map((s) => [s.id, s]))

test("home recent sessions shows every root in the directory regardless of project", async () => {
  await using setup = await createAppFixture({
    width: 120,
    height: 40,
    config: { animations: false },
    fetch: (url) => {
      const id = url.pathname.startsWith("/api/session/") ? url.pathname.slice("/api/session/".length) : undefined
      if (id) {
        const match = all.get(id)
        return match ? json({ data: match }) : undefined
      }
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"), { timeout: 15000 })
  for (const item of all.values()) {
    setup.events.emit({
      id: `evt_${item.id}`,
      created: 1,
      type: "session.created",
      durable: { aggregateID: item.id, seq: 1, version: 1 },
      data: { sessionID: item.id },
    })
  }

  await setup.waitForFrame((frame) => frame.includes("Newest local") && frame.includes("Older other project"), {
    timeout: 15000,
  })
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Recent sessions")
  expect(frame).toContain("Newest local")
  expect(frame).toContain("Older other project")
  // A session in a different directory is not part of this directory's history.
  expect(frame).not.toContain("Elsewhere")
}, 30_000)