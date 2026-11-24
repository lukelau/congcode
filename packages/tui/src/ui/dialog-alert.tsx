import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import { getScrollAcceleration } from "../util/scroll"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert(props: DialogAlertProps) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data

  const confirm = () => {
    props.onConfirm?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm alert",
        group: "Dialog",
        run: confirm,
      },
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{ actions: { primary: [{ title: "ok", key: "enter", onTrigger: confirm }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={confirm}
          >
            <text fg={theme.text.action.primary.focused}>ok</text>
          </box>
        </box>
      }
    >
      <scrollbox
        maxHeight={20}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: true }}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <text fg={theme.text.muted} wrapMode="word">
          {props.message}
        </text>
      </scrollbox>
    </DialogLayout>
  )
}
