/**
 * @file Opt-in capture of the assembled starter context for token profiling.
 *
 * Inert unless `DOT_CONTEXT_CAPTURE` is set in the environment, so it adds no
 * runtime cost to normal sessions beyond loading an early-returning module.
 * When enabled, it records the two buckets that make up the starter context:
 *
 *   1. `experimental.chat.system.transform` -> the `system` string array
 *      (core prompt, AGENTS.md, skill catalogue, references, plugin injections).
 *   2. `tool.definition` -> every tool's description and JSON-schema parameters
 *      (built-in tools plus each MCP server's advertised surface).
 *
 * Output lands in a private, unique child of `DOT_CONTEXT_CAPTURE_DIR` (default
 * `/tmp/opencode`): one file per system segment, a JSONL of per-tool sizes, and
 * the raw tool schemas. A companion script tokenizes these to attribute the
 * starter-context cost by source. This is a measurement harness, not a
 * behaviour change: it never mutates `system` or tool defs.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CAPTURE_ENABLED = process.env["DOT_CONTEXT_CAPTURE"] === "1"
const CAPTURE_PARENT =
  process.env["DOT_CONTEXT_CAPTURE_DIR"] || join(tmpdir(), "opencode")

/** Create one private capture directory without deleting caller-controlled paths. */
let captureDir: string | undefined
function prepareDir(): string {
  if (captureDir) return captureDir
  mkdirSync(CAPTURE_PARENT, { recursive: true, mode: 0o700 })
  captureDir = mkdtempSync(join(CAPTURE_PARENT, "context-baseline-"))
  mkdirSync(join(captureDir, "system"), { mode: 0o700 })
  mkdirSync(join(captureDir, "tools"), { mode: 0o700 })
  return captureDir
}

/** Filesystem-safe slug for a tool id or segment label. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120)
}

export const ContextCapture = (async () => {
  if (!CAPTURE_ENABLED) return {}
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const dir = prepareDir()
      const segments = output.system
      const index: Array<{ segment: number; chars: number; file: string }> = []
      segments.forEach((segment, i) => {
        const file = join("system", `${String(i).padStart(3, "0")}.txt`)
        writeFileSync(join(dir, file), segment, { mode: 0o600 })
        index.push({ segment: i, chars: segment.length, file })
      })
      writeFileSync(
        join(dir, "system-index.json"),
        JSON.stringify(index, null, 2),
        { mode: 0o600 },
      )
    },
    "tool.definition": async (input, output) => {
      const dir = prepareDir()
      const params = JSON.stringify(output.parameters ?? {})
      const record = {
        toolID: input.toolID,
        descriptionChars: (output.description ?? "").length,
        parametersChars: params.length,
        totalChars: (output.description ?? "").length + params.length,
      }
      appendFileSync(
        join(dir, "tools.jsonl"),
        JSON.stringify(record) + "\n",
        { mode: 0o600 },
      )
      writeFileSync(
        join(dir, "tools", `${slug(input.toolID)}.json`),
        JSON.stringify(
          { description: output.description, parameters: output.parameters },
          null,
          2,
        ),
        { mode: 0o600 },
      )
    },
  }
}) satisfies Plugin
