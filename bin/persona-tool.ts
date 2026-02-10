#!/usr/bin/env node

import { runPersonaToolCli } from "../lib/persona-tool-cli.js"

const args = process.argv.slice(2)

runPersonaToolCli(args)
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
