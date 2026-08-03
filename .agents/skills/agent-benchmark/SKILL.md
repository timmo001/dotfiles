---
name: agent-benchmark
description: Run this repository's OpenCode agent benchmark in an experimental background task and return its completed report. Use when asked to run, repeat, or inspect the agent benchmark or `/agent-benchmark`.
---

# Agent Benchmark

Run the benchmark from the repository root in one OpenCode experimental
background task. The task owns the complete benchmark run and returns its final
report to the parent session automatically.

## Resolve the model first

The benchmark runs OpenCode in an isolated config, so the calling harness's model name is never a valid `--model` value. A Cursor session model such as `claude-opus-5-thinking-high` is not an OpenCode id.

- `opencode models` prints the candidates, one `provider/model` id per line. If it prints nothing it was blocked from the network, so re-run it with network access rather than guessing an id.
- Only providers OpenCode authenticates natively work in a run: `jq -r 'keys[]' ~/.local/share/opencode/auth.json` lists the authenticated ones, and each run loads the context-capture plugin alone, so a provider that exists only through a plugin is absent from the benchmark even though `opencode models` lists it in your own session. `cursor/*` is the current example and cannot be benchmarked, whichever id you give it.
- Pick the closest usable id to the current session model, and ask which to use when the session model has no clear equivalent among the usable providers.
- An unusable model is not rejected up front. The run ends within about 15 seconds reporting 0 passing deterministic runs, the `process completed` check records `exit=1`, and each run's `events.ndjson` holds an `UnknownError` with `Unexpected server error`. Read that signature as a model or provider problem, not an agent or skill regression.

## Run it

1. Build the benchmark arguments from `--model <resolved provider/model>` followed by any requested flags. If the requested flags already include `--model`, do not add one.
2. Launch one `general` task with `background: true`. Give it the repository
   root and require it to run:

   ```bash
   mise run benchmarks:opencode -- <arguments>
   ```

   The background agent must not delegate or edit files. It must wait for the
   command to finish and return the exit status, deterministic pass count,
   artifact path, host report path, and any model/provider error.
3. Report that the benchmark started in the background and name the resolved
   model. Do not poll, sleep, request status, or duplicate the run. OpenCode
   injects the task's final result into the parent session automatically.
4. When the result arrives, summarise it for the user. Distinguish benchmark
   failures from model/provider failures using the signature above.

Use this only in a persistent interactive OpenCode session. Experimental
background tasks are process-local, so one-shot `opencode run` exits before the
benchmark can return its result. Do not replace the task with Pitchfork,
`nohup`, shell backgrounding, tmux, or direct process signals.
