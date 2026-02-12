import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runPersonaToolCli } from "../lib/persona-tool-cli"

function captureIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      out: (message: string) => out.push(message),
      err: (message: string) => err.push(message)
    }
  }
}

describe("persona-tool cli", () => {
  it("writes markdown and json outputs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "persona-tool-cli-"))
    const inputFile = path.join(root, "voice.md")
    const outFile = path.join(root, "agent.md")
    const jsonFile = path.join(root, "agent.json")
    await fs.writeFile(inputFile, "Talk like a goofy but competent pirate.", "utf8")

    const capture = captureIo()
    const code = await runPersonaToolCli(
      ["--in", inputFile, "--style", "mid", "--domain", "coding", "--out", outFile, "--json", jsonFile],
      capture.io
    )
    expect(code).toBe(0)
    expect(capture.err).toEqual([])
    expect(capture.out.join("\n")).toMatch(/Token estimate:/)

    const markdown = await fs.readFile(outFile, "utf8")
    const json = JSON.parse(await fs.readFile(jsonFile, "utf8")) as { agent_markdown: string }
    expect(markdown).toContain("## Protocol Layer (How you behave)")
    expect(json.agent_markdown).toContain("## Voice Layer (How you sound)")
  })

  it("fails with helpful error when input file is missing", async () => {
    const capture = captureIo()
    const code = await runPersonaToolCli(["--in", "/tmp/definitely-not-here.md", "--style", "mid"], capture.io)
    expect(code).toBe(1)
    expect(capture.err.join("\n")).toMatch(/Unable to read input file/i)
  })
})
