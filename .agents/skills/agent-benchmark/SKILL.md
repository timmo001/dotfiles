---
name: agent-benchmark
description: Run this repository's OpenCode agent benchmark as a detached background process. Use when asked to run, repeat, or inspect the agent benchmark or `/agent-benchmark`.
---

# Agent Benchmark

Run the benchmark from the repository root through Pitchfork without searching for its implementation. Follow the repository-owned background-task pattern used by System Bridge.

1. Build the benchmark arguments from `--model <current-session-provider/model>` followed by any requested flags. If the requested flags already include `--model`, do not add the current session model.
2. Run `mise run benchmarks:opencode:background -- <arguments>`. This starts the benchmark as the managed Pitchfork daemon `agent-benchmark` and returns without waiting for completion.
3. Run `mise run benchmarks:opencode:status` once to confirm that Pitchfork accepted the daemon. Do not wait for completion or poll it.
4. Report the daemon name and the status result immediately. Point to `mise run benchmarks:opencode:logs` for current output and `mise run benchmarks:opencode:stop` for cancellation. Mention `mise run benchmarks:opencode:logs:follow` (or `mise run benchmarks:opencode:logs -- --follow`) only as an interactive live stream that keeps running after the benchmark completes and must be cancelled manually. Never use follow mode to wait for completion; use status and ordinary logs instead.
5. Explain that the completed logs contain the deterministic pass count, artifact path, and host report path.

Do not start a duplicate run while `agent-benchmark` is active. Pitchfork owns process lifetime, logs, status, and stopping; do not replace it with `nohup`, shell backgrounding, or direct process signals.
