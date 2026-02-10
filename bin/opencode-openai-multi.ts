#!/usr/bin/env node

import { runInstallerCli } from "../lib/installer-cli.js"

const args = process.argv.slice(2)

runInstallerCli(args)
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
