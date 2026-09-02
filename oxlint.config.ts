import { defineConfig } from "oxlint";
import effectRulesConfig from "@timmo001/oxlint-rules/configs/effect";

export default defineConfig({
  extends: [effectRulesConfig],
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
