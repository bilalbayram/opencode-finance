#!/usr/bin/env node
import { runCli } from "./index"

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())

runCli(process.argv.slice(2), undefined, controller.signal).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)
