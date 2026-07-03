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
 * Output lands under `DOT_CONTEXT_CAPTURE_DIR` (default
 * `/tmp/opencode/context-baseline`): one file per system segment, a JSONL of
 * per-tool sizes, and the raw tool schemas. A companion script tokenizes these
 * to attribute the starter-context cost by source. This is a measurement
 * harness, not a behaviour change: it never mutates `system` or tool defs.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const CAPTURE_ENABLED = Boolean(process.env["DOT_CONTEXT_CAPTURE"])
const CAPTURE_DIR =
  process.env["DOT_CONTEXT_CAPTURE_DIR"] || "/tmp/opencode/context-baseline"

/** Reset the capture directory once per process so reruns start clean. */
let prepared = false
function prepareDir(): void {
  if (prepared) return
  prepared = true
  if (existsSync(CAPTURE_DIR)) rmSync(CAPTURE_DIR, { recursive: true, force: true })
  mkdirSync(join(CAPTURE_DIR, "system"), { recursive: true })
  mkdirSync(join(CAPTURE_DIR, "tools"), { recursive: true })
}

/** Filesystem-safe slug for a tool id or segment label. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120)
}

export const ContextCapture = (async () => {
  if (!CAPTURE_ENABLED) return {}
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      prepareDir()
      const segments = output.system
      const index: Array<{ segment: number; chars: number; file: string }> = []
      segments.forEach((segment, i) => {
        const file = join("system", `${String(i).padStart(3, "0")}.txt`)
        writeFileSync(join(CAPTURE_DIR, file), segment)
        index.push({ segment: i, chars: segment.length, file })
      })
      writeFileSync(
        join(CAPTURE_DIR, "system-index.json"),
        JSON.stringify(index, null, 2),
      )
    },
    "tool.definition": async (input, output) => {
      prepareDir()
      const params = JSON.stringify(output.parameters ?? {})
      const record = {
        toolID: input.toolID,
        descriptionChars: (output.description ?? "").length,
        parametersChars: params.length,
        totalChars: (output.description ?? "").length + params.length,
      }
      appendFileSync(
        join(CAPTURE_DIR, "tools.jsonl"),
        JSON.stringify(record) + "\n",
      )
      writeFileSync(
        join(CAPTURE_DIR, "tools", `${slug(input.toolID)}.json`),
        JSON.stringify(
          { description: output.description, parameters: output.parameters },
          null,
          2,
        ),
      )
    },
  }
}) satisfies Plugin
