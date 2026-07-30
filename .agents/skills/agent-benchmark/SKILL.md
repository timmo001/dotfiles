---
name: agent-benchmark
description: Run this repository's OpenCode agent benchmark as a detached background process. Use when asked to run, repeat, or inspect the agent benchmark or `/agent-benchmark`.
---

# Agent Benchmark

Run the benchmark from the repository root through Pitchfork without searching for its implementation. Follow the repository-owned background-task pattern used by System Bridge.

## Resolve the model first

The benchmark runs OpenCode in an isolated config, so the calling harness's model name is never a valid `--model` value. A Cursor session model such as `claude-opus-5-thinking-high` is not an OpenCode id.

- `opencode models` prints the candidates, one `provider/model` id per line. If it prints nothing it was blocked from the network, so re-run it with network access rather than guessing an id.
- Only providers OpenCode authenticates natively work in a run: `jq -r 'keys[]' ~/.local/share/opencode/auth.json` lists the authenticated ones, and each run loads the context-capture plugin alone, so a provider that exists only through a plugin is absent from the benchmark even though `opencode models` lists it in your own session. `cursor/*` is the current example and cannot be benchmarked, whichever id you give it.
- Pick the closest usable id to the current session model, and ask which to use when the session model has no clear equivalent among the usable providers.
- An unusable model is not rejected up front. The run ends within about 15 seconds reporting 0 passing deterministic runs, the `process completed` check records `exit=1`, and each run's `events.ndjson` holds an `UnknownError` with `Unexpected server error`. Read that signature as a model or provider problem, not an agent or skill regression.

## Run it

1. Build the benchmark arguments from `--model <resolved provider/model>` followed by any requested flags. If the requested flags already include `--model`, do not add one.
2. Run `mise run benchmarks:opencode:background -- <arguments>`. This starts the benchmark as the managed Pitchfork daemon `agent-benchmark` and returns without waiting for completion.
3. Run `mise run benchmarks:opencode:status` once to confirm that Pitchfork accepted the daemon. Do not wait for completion or poll it.
4. Report the daemon name, the resolved model, and the status result immediately. Point to `mise run benchmarks:opencode:logs` for current output and `mise run benchmarks:opencode:stop` for cancellation. Mention `mise run benchmarks:opencode:logs:follow` (or `mise run benchmarks:opencode:logs -- --follow`) only as an interactive live stream that keeps running after the benchmark completes and must be cancelled manually. Never use follow mode to wait for completion; use status and ordinary logs instead.
5. Explain that the completed logs contain the deterministic pass count, artifact path, and host report path.

Do not start a duplicate run while `agent-benchmark` is active. Pitchfork owns process lifetime, logs, status, and stopping; do not replace it with `nohup`, shell backgrounding, or direct process signals.
