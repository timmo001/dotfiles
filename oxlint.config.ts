import { defineConfig } from "oxlint";
import recommendedEffect from "@timmo001/oxlint-rules/configs/recommended-effect";

export default defineConfig({
  extends: [recommendedEffect],
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
    "!agents/.config/opencode/plugins-v2/",
    "!agents/.config/opencode/plugins-v2/**/*.ts",
    "docs/**",
    "node_modules/**",
    "omarchy/.config/omarchy/plugins/**",
  ],
});
