export const EnvProtection = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const filePath = output.args?.filePath ?? ""
      const fileName = filePath.split(/[\\/]/).pop() ?? ""
      const isProtectedEnvFile =
        fileName === ".env" || (fileName.startsWith(".env.") && fileName !== ".env.example")

      if (input.tool === "read" && isProtectedEnvFile) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
