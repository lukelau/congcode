import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "../../context/local"
import { useData } from "../../context/data"
import { useLocation } from "../../context/location"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"

/** Formats a token count compactly, e.g. 200000 -> "200K", 1000000 -> "1M". */
export function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) return undefined
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`
  }
  return String(value)
}

/** Formats a per-million-token price, e.g. 3 -> "$3/M", 0 -> "free". */
export function formatPrice(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value === 0) return "free"
  const rounded = value >= 1 ? value.toFixed(2).replace(/\.?0+$/, "") : value.toFixed(3).replace(/0+$/, "")
  return `$${rounded}/M`
}

/**
 * Shows the active model's identity and key limits in the session sidebar and
 * opens the model picker when clicked, so the right pane offers a direct entry
 * point to switch models.
 */
export function SidebarModel(props: { sessionID: string }) {
  const theme = useTheme()
  const local = useLocal()
  const data = useData()
  const location = useLocation()
  const keymap = Keymap.use()

  const parsed = createMemo(() => local.model.parsed())

  const info = createMemo(() => {
    const value = local.model.current()
    if (!value) return undefined
    const ref = location.ref ?? data.location.default()
    const list = data.location.model.list(ref) ?? []
    // The speed shows beside the name, so look up the entry the model stands for.
    const standard = local.model.standard()
    const id = standard?.modelID ?? value.modelID
    return list.find((item) => item.providerID === value.providerID && item.id === id)
  })

  const prices = createMemo(() => {
    const cost = info()?.cost?.[0]
    if (!cost) return undefined
    return { input: formatPrice(cost.input), output: formatPrice(cost.output) }
  })

  return (
    <Show when={parsed()}>
      {(value) => (
        <box id="sidebar.model" onMouseUp={() => keymap.dispatch("model.list")}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.base}>
              <b>Model</b>
            </text>
            <box flexGrow={1} />
            <text fg={theme.text.muted}>/models</text>
          </box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
            {value().model}
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {value().provider}
          </text>
          <Show when={info()}>
            {(model) => (
              <>
                <Show when={formatTokens(model().limit?.context)}>
                  {(context) => <text fg={theme.text.muted}>{context()} context</text>}
                </Show>
                <Show when={formatTokens(model().limit?.output)}>
                  {(output) => <text fg={theme.text.muted}>{output()} output</text>}
                </Show>
                <Show when={prices()}>
                  {(price) => (
                    <text fg={theme.text.muted}>
                      {price().input} in · {price().output} out
                    </text>
                  )}
                </Show>
              </>
            )}
          </Show>
          <Show when={local.model.variant.list().length > 0}>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              variant: {local.model.variant.current() ?? "default"}
            </text>
          </Show>
          <Show when={local.model.speed.list().length > 0}>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              speed: {local.model.speed.current() ?? "standard"}
            </text>
          </Show>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "congcode.sidebar.model",
  setup(context) {
    context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <SidebarModel sessionID={props.sessionID} />,
    })
  },
})