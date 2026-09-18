---
name: agent-benchmark
description: Run this repository's OpenCode agent benchmark and return its completed report. Use when asked to run, repeat, or inspect the agent benchmark or `/agent-benchmark`.
---

# Agent Benchmark

Run the benchmark command directly from the repository root. Use the shell
tool's background execution when available; this does not need another agent.

## Resolve the model first

The benchmark runs OpenCode in an isolated config, so the calling harness's model name is never a valid `--model` value. A Cursor session model such as `claude-opus-5-thinking-high` is not an OpenCode id.

- `opencode models` prints the candidates, one `provider/model` id per line. If it prints nothing it was blocked from the network, so re-run it with network access rather than guessing an id.
- Only providers OpenCode authenticates natively work in a run: `jq -r 'keys[]' ~/.local/share/opencode/auth.json` lists the authenticated ones, and each run loads the context-capture plugin alone, so a provider that exists only through a plugin is absent from the benchmark even though `opencode models` lists it in your own session. `cursor/*` is the current example and cannot be benchmarked, whichever id you give it.
- Pick the closest usable id to the current session model, and ask which to use when the session model has no clear equivalent among the usable providers.
- An unusable model is not rejected up front. The run ends within about 15 seconds reporting 0 passing deterministic runs, the `process completed` check records `exit=1`, and each run's `events.ndjson` holds an `UnknownError` with `Unexpected server error`. Read that signature as a model or provider problem, not an agent or skill regression.

## Run it

1. Build the benchmark arguments from `--model <resolved provider/model>` followed by any requested flags. If the requested flags already include `--model`, do not add one.
2. Run:

   ```bash
   mise run benchmarks:opencode -- <arguments>
   ```

   Use background execution only when the shell tool can notify this session
   on completion; otherwise wait in the foreground with a suitable timeout.
3. For a background run, report that it started and name the resolved model.
   Await the completion notification without polling or duplicating the run.
4. Report the exit status, deterministic pass count, output path, host report
   path, and any model/provider error. Distinguish benchmark failures from
   model/provider failures using the signature above.
