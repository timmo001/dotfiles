/**
 * @file Blocks reads of .env files to prevent leaking secrets.
 *
 * Guards `tool.execute.before` on the `read` tool. Any file named `.env` or
 * `.env.*` (except `.env.example`) throws before the read reaches disk.
 */

import type { Plugin } from "@opencode-ai/plugin"

function argRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export const EnvProtection = (async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const filePath = stringArg(argRecord(output.args).filePath)
      const fileName = filePath.split(/[\\/]/).pop() ?? ""
      const isProtectedEnvFile =
        fileName === ".env" || (fileName.startsWith(".env.") && fileName !== ".env.example")

      if (input.tool === "read" && isProtectedEnvFile) {
        throw new Error("Do not read .env files")
      }
    },
  }
}) satisfies Plugin

export default EnvProtection
