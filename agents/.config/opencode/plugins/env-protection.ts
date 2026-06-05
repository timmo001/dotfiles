/**
 * @file Blocks direct access to .env files to prevent leaking secrets.
 *
 * Guards tool calls that target `.env` or `.env.*` files, except the exact
 * `.env.example` template.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { argRecord, stringArg, targetsProtectedEnv } from "../lib/guard-paths"

const ENV_COMMAND_PATTERN =
  /(?:^|[\s;&|()])(?:cat|cd|cp|env|grep|head|less|ls|more|mv|open|rg|rm|source|tail|test|vim|vi|nvim|\.|<|>|\[)\b|[<>]/

function toolTargetsProtectedEnv(
  tool: string,
  args: Record<string, unknown>,
): boolean {
  if (tool === "read") return targetsProtectedEnv(stringArg(args.filePath) || stringArg(args.path))

  if (tool === "grep") {
    return [args.path, args.include].some((value) => targetsProtectedEnv(stringArg(value)))
  }

  if (tool === "glob") {
    return [args.pattern, args.path].some((value) => targetsProtectedEnv(stringArg(value)))
  }

  return false
}

function commandTargetsProtectedEnv(command: string): boolean {
  if (!targetsProtectedEnv(command)) return false
  return ENV_COMMAND_PATTERN.test(command)
}

export const EnvProtection = (async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = argRecord(output.args)
      const command = stringArg(args.command)

      if (
        toolTargetsProtectedEnv(input.tool, args) ||
        (input.tool === "bash" && commandTargetsProtectedEnv(command))
      ) {
        throw new Error("Do not read .env files")
      }
    },
  }
}) satisfies Plugin

export default EnvProtection
