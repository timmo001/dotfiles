import { defineConfig } from "oxlint";
import recommendedEffect from "@timmo001/oxlint-rules/configs/recommended-effect";

export default defineConfig({
  extends: [recommendedEffect],
  options: {
    typeAware: true,
    maxWarnings: 0,
  },
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".benchmarks/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "agents/**/*",
    "!agents/.config/",
    "!agents/.config/opencode/",
    "!agents/.config/opencode/plugins/",
    "!agents/.config/opencode/plugins/**/*.ts",
    "!agents/.config/opencode/plugins/**/*.tsx",
    "docs/**",
    "node_modules/**",
  ],
  overrides: [
    {
      // Herdr app mods keep strictNullChecks off in their generated jsconfig.json.
      files: ["herdr-app/.config/herdr-app/mods/**/*.js"],
      rules: { "typescript/no-useless-default-assignment": "off" },
    },
  ],
});
