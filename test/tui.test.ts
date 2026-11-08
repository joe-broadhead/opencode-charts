import { describe, expect, test } from "bun:test"
import { setupView, viewMessage } from "../src/tui.ts"

/** The report the RPC carries, with the heading the dialog title replaces. */
const status = (text = "Charts status\nConnection: Ready\nNext step: Nothing to do.") => ({ text })

describe("the status dialog", () => {
  test("shows the report without its heading, and the one line of keys", () => {
    const message = viewMessage({ status: status() })
    expect(message).toBe("Connection: Ready\nNext step: Nothing to do.\n\nr refresh · esc close")
    expect(message).not.toContain("Charts status")
  })

  test("shows a refusal's own message and next step", () => {
    const message = viewMessage({ error: { type: "unavailable", message: "STATUS_UNAVAILABLE: Charts status could not be read.", data: { nextStep: "Run /charts-status again." } } })
    expect(message).toContain("STATUS_UNAVAILABLE: Charts status could not be read. Next step: Run /charts-status again.")
    expect(message).toEndWith("r refresh · esc close")
  })

  test("says the plugin is not running when the server does not answer", () => {
    const message = viewMessage({ error: { type: "rpc.unavailable", message: "no such rpc" } })
    expect(message).toContain("STATUS_UNAVAILABLE: The Charts plugin is not running on this OpenCode server.")
    expect(message).toContain("Run /plugins to see why it did not start.")
  })

  test("any other failure is one coded line, never a stack", () => {
    const message = viewMessage({ error: new Error("boom at /a/b") })
    expect(message).toStartWith("STATUS_UNAVAILABLE: Could not read Charts status.")
    expect(message).not.toContain("boom at /a/b\n")
  })
})

describe("the keymap layer", () => {
  test("has one palette command and one refresh key, and the /charts slash alias", () => {
    let commands: { id: string; title: string; bind?: string; slash?: { name: string } }[] = []
    const context = {
      location: undefined,
      client: { rpc: () => ({ status: async () => status() }) },
      data: { on: () => () => undefined },
      ui: { dialog: { alert: async () => undefined, set: () => undefined, clear: () => undefined } },
      keymap: {
        layer: (build: () => { commands: typeof commands }) => {
          commands = build().commands
          return () => undefined
        },
      },
    }
    const dispose = setupView(context as never)
    expect(commands.map((command) => command.title)).toEqual(["Charts: Status", "Refresh Charts status"])
    expect(commands[0]!.slash).toEqual({ name: "charts" })
    expect(commands[1]!.bind).toBe("r")
    dispose()
  })
})
