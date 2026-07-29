---
description: Run the OpenCode agent benchmark
---

Run the project benchmark directly without searching for its implementation.

Use `mise run benchmarks:opencode -- --model <current-session-provider/model>` from the repository root. Append `${ARGUMENTS}` when arguments are provided. If the arguments include `--model`, use that model instead of adding the current session model.

Allow up to 20 minutes for the command to finish. Report the deterministic pass count, artifact path, and host report path.
