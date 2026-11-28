import { expect, test } from "bun:test"
import type { ModelInfo } from "@opencode/client"
import { SidebarModel, formatPrice, formatTokens } from "../../src/feature-plugins/sidebar/model"
import { builtins } from "../../src/plugin/builtins"

function priced(id: string): ModelInfo {
  return {
    id,
    modelID: id,
    providerID: "provider",
    name: id,
    status: "active",
    enabled: true,
    capabilities: { input: ["text"], output: ["text"], tools: true },
    cost: [{ input: 3, output: 15, cache: { read: 0, write: 0 } }],
    limit: { context: 200_000, output: 8_000 },
    time: { released: 0 },
    variants: [],
  }
}

test("formatTokens renders compact counts", () => {
  expect(formatTokens(200_000)).toBe("200K")
  expect(formatTokens(1_000_000)).toBe("1M")
  expect(formatTokens(1_500_000)).toBe("1.5M")
  expect(formatTokens(0)).toBeUndefined()
  expect(formatTokens(undefined)).toBeUndefined()
})

test("formatPrice renders per-million prices", () => {
  expect(formatPrice(3)).toBe("$3/M")
  expect(formatPrice(0.15)).toBe("$0.15/M")
  expect(formatPrice(0)).toBe("free")
  expect(formatPrice(undefined)).toBeUndefined()
})

test("sidebar model is registered as a builtin plugin", () => {
  expect(builtins.some((plugin) => plugin.id === "congcode.sidebar.model")).toBe(true)
})

test("sidebar model shows the selected model with its limits", async () => {
  const { renderLocal } = await import("../fixture/local")
  await using setup = await renderLocal({
    models: [priced("claude-x")],
    ui: () => <SidebarModel sessionID="session" />,
  })

  await setup.renderOnce()
  // Providers come from renderLocal; the model name is what local resolves.
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Model")
  expect(frame).toContain("/models")
  expect(frame).toContain("200K context")
  expect(frame).toContain("8K output")
  expect(frame).toContain("$3/M in")
})