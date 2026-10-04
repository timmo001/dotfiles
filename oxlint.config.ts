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
    "omarchy/.config/omarchy/plugins/**",
  ],
});
