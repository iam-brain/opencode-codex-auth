import { select } from "./select"

export type ConfirmOptions = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  useColor?: boolean
}

export async function confirm(
  message: string,
  defaultYes = false,
  options: ConfirmOptions = {}
): Promise<boolean> {
  const items = defaultYes
    ? [
        { label: "Yes", value: true },
        { label: "No", value: false }
      ]
    : [
        { label: "No", value: false },
        { label: "Yes", value: true }
      ]

  const result = await select(items, {
    message,
    input: options.input,
    output: options.output,
    useColor: options.useColor
  })
  return result ?? false
}
