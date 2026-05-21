# Handoff: Phase 1D — `dot doctor` Command

## Focus

Port the 1,220-line `dot-doctor-lib` to TypeScript Effect with structured, parallel health checks. This is the most complex single-command port but produces the highest value: typed results, parallel execution, better error reporting, and serves as the integration test for the whole system.

---

## Prerequisites

- Phase 0 complete (all core services)
- Phase 1A complete (stow command — doctor checks stow integrity)
- `Config` service provides paths, private access, repo lists
- `CommandExecutor` service runs `git`, `pacman`, `stow`, etc.
- `OutputLog` service for structured output

---

## What `dot doctor` Does (from bash)

Reference: `scripts/.local/bin/dot-doctor-lib` (1,220 lines).

### Legacy behaviour

1. Parse `--open-opencode` flag (captures output to file, then launches opencode)
2. Initialise counters: `issues=0`, `warnings=0`, per-section message arrays
3. Helper functions: `doctor_log_section` (wraps `log_section`), `doctor_warn` (accumulates + counts), `doctor_error` (accumulates + counts)
4. Run ~19 check sections sequentially, each calling `doctor_log_section` then per-check `log_info`/`doctor_warn`/`doctor_error`
5. Per-check output: `log_info "$tool is installed"` (OK), `doctor_warn "$tool is missing"` (warn), `doctor_error "$check failed"` (error)
6. At end: grouped summary sections — `doctor_log_section 'Collected Errors'` then `doctor_log_section 'Collected Warnings'` with section-grouped messages
7. Final summary line: `"$warnings warning(s), $issues error(s)"`
8. Actionable fix commands suggested inline (e.g. `paru -S ...` for missing packages)

### Logging level (match legacy)

Legacy outputs one section heading per check category, then per-item info/warn/error lines. The summary at the end is grouped by section. The port should aim for similar density:
- Section heading per check category (not one per individual check)
- Per-item OK/warn/error line with the item name and status
- Detail lines indented where useful (e.g. "expected vs actual")
- Grouped summary at end: errors by section, then warnings by section
- Final count line: `"X warning(s), Y error(s)"`
- No artificial "Complete" section — the summary IS the completion signal
- Skip warnings with reason when private checks are unavailable

### Check Sections (from legacy, in order)

1. Dependencies — required tools installed (stow, git, gum, etc.)
2. Secret Service — `gnome-keyring-daemon` running
3. Repositories — all expected repos exist, correct remotes
4. Private repositories — private repos exist (if private available)
5. Stow integrity — no broken symlinks, no unexpected files
6. OpenCode location — opencode binary in expected path
7. Git config — includes configured correctly
8. Workflow watch — systemd user service active
9. Startup notification — systemd user service active
10. Daily volume reset — systemd timer active
11. Omarchy repos/worktrees — expected worktrees exist
12. Private access — private dotfiles accessible
13. Browser flags — chrome://flags configured
14. Hardware video decode — vainfo/vdpauinfo checks
15. Browser extensions — expected extensions installed
16. Public packages — AUR packages installed + up-to-date
17. Private package repo — repo configured + accessible
18. Private packages — private packages installed
19. Pacman hooks — expected hooks in place

---

## Implementation

### Types

```typescript
// dot/src/doctor/types.ts
type Severity = "ok" | "warn" | "error"

interface CheckResult {
  readonly severity: Severity
  readonly message: string
  readonly detail?: string  // extra context (e.g. expected vs actual)
}

interface CheckSection {
  readonly name: string
  readonly results: readonly CheckResult[]
}

interface DoctorReport {
  readonly sections: readonly CheckSection[]
  readonly warnings: number
  readonly errors: number
  readonly timestamp: number
}
```

### Individual Check Modules

Each module exports an Effect returning `CheckResult[]`:

```typescript
// dot/src/doctor/checks/dependencies.ts
import { Effect } from "effect"
import { CommandExecutor } from "../../services/CommandExecutor.js"

const REQUIRED_TOOLS = ["stow", "git", "gum", "paru", "opencode", "lazygit"] as const

export const checkDependencies = Effect.gen(function* () {
  const executor = yield* CommandExecutor
  const results: CheckResult[] = []

  for (const tool of REQUIRED_TOOLS) {
    const exit = yield* executor.exitCode("which", [tool])
    results.push(exit === 0
      ? { severity: "ok", message: `${tool} installed` }
      : { severity: "error", message: `${tool} not found` }
    )
  }
  return results
})
```

```typescript
// dot/src/doctor/checks/repos.ts
export const checkRepos = Effect.gen(function* () {
  const config = yield* Config
  const executor = yield* CommandExecutor
  const results: CheckResult[] = []

  for (const repo of config.repos) {
    const exists = yield* Effect.sync(() => Bun.file(`${repo.path}/.git`).exists())
    if (!exists) {
      results.push({ severity: "error", message: `Missing repo: ${repo.name}`, detail: repo.path })
      continue
    }
    // Check remote matches expected
    const remote = yield* executor.run("git", ["remote", "get-url", "origin"], { cwd: repo.path })
    if (!remote.trim().includes(repo.expectedRemote)) {
      results.push({ severity: "warn", message: `${repo.name}: unexpected remote`, detail: remote.trim() })
    } else {
      results.push({ severity: "ok", message: `${repo.name} OK` })
    }
  }
  return results
})
```

### Check Runner (Parallel)

```typescript
// dot/src/doctor/runner.ts
import { Effect } from "effect"
import { checkDependencies } from "./checks/dependencies.js"
import { checkRepos } from "./checks/repos.js"
import { checkStow } from "./checks/stow.js"
import { checkPackages } from "./checks/packages.js"
// ... etc

interface SectionDef {
  readonly name: string
  readonly check: Effect<CheckResult[], any, any>
  readonly requiresPrivate?: boolean
}

const sections: SectionDef[] = [
  { name: "Dependencies", check: checkDependencies },
  { name: "Repositories", check: checkRepos },
  { name: "Stow Integrity", check: checkStow },
  { name: "Public Packages", check: checkPackages },
  // ... all sections
]

export const runDoctor = Effect.gen(function* () {
  const config = yield* Config
  const applicable = sections.filter(s => !s.requiresPrivate || config.canUsePrivate)

  // Run all checks in parallel
  const results = yield* Effect.all(
    applicable.map(s =>
      s.check.pipe(
        Effect.map(results => ({ name: s.name, results })),
        Effect.catchAll(err => Effect.succeed({
          name: s.name,
          results: [{ severity: "error" as const, message: `Check crashed: ${err}` }]
        }))
      )
    ),
    { concurrency: "unbounded" }
  )

  const warnings = results.flatMap(s => s.results).filter(r => r.severity === "warn").length
  const errors = results.flatMap(s => s.results).filter(r => r.severity === "error").length

  return { sections: results, warnings, errors, timestamp: Date.now() } satisfies DoctorReport
})
```

### Command

```typescript
// dot/src/commands/Doctor.ts
import { Effect } from "effect"
import { Config } from "../services/Config.js"
import { OutputLog } from "../services/OutputLog.js"
import { runDoctor } from "../doctor/runner.js"

export const doctor = Effect.gen(function* () {
  const config = yield* Config
  const log = yield* OutputLog
  const report = yield* runDoctor

  // Stream results as they complete (section → items)
  for (const section of report.sections) {
    yield* log.section(section.name)
    for (const result of section.results) {
      switch (result.severity) {
        case "ok": yield* log.info(result.message); break
        case "warn": yield* log.warn(result.message); break
        case "error": yield* log.error(result.message); break
      }
      if (result.detail) yield* log.info(`  ${result.detail}`)
    }
  }

  // Grouped summary (matches legacy: errors by section, then warnings by section)
  if (report.errors > 0) {
    yield* log.section("Collected Errors")
    for (const section of report.sections) {
      const errors = section.results.filter(r => r.severity === "error")
      if (errors.length === 0) continue
      yield* log.info(`  ${section.name}`)
      for (const r of errors) yield* log.error(`    ${r.message}`)
    }
  }

  if (report.warnings > 0) {
    yield* log.section("Collected Warnings")
    for (const section of report.sections) {
      const warns = section.results.filter(r => r.severity === "warn")
      if (warns.length === 0) continue
      yield* log.info(`  ${section.name}`)
      for (const r of warns) yield* log.warn(`    ${r.message}`)
    }
  }

  yield* log.info(`${report.warnings} warning(s), ${report.errors} error(s)`)

  // Write report to file
  const reportPath = `${config.stateDir}/doctor-${report.timestamp}.log`
  // ... write formatted report to file
})
```

### `--open-opencode` Flag

When passed, write the report to a temp file, then launch `opencode run` with the report path as context:

```typescript
if (flags.openOpencode) {
  yield* launcher.suspend(`opencode run --context ${reportPath}`)
}
```

---

## Migration Strategy

Port checks incrementally. Start with the structural checks (dependencies, repos, stow) that are simple `which`/`test -d` equivalents. Leave complex checks (browser extensions, packages) for subsequent iterations within this phase.

### Priority Order

1. Dependencies (simple `which` checks)
2. Repositories (git remote checks)
3. Stow integrity (symlink validation)
4. Git config (file content checks)
5. Public packages (pacman query + AUR version compare)
6. Systemd services (systemctl status checks)
7. Private checks (gated by `config.canUsePrivate`)
8. Browser/hardware (last — most complex, least critical)

---

## Validation

```bash
dot doctor            # Should run all checks, show results
dot doctor 2>&1 | cat # CLI mode (plain stdout)
# In TUI: select Doctor from menu → OutputPane shows streaming results
```

Expected output shape (similar to legacy):
```
── Dependencies
[INFO]   stow is installed
[INFO]   git is installed
[WARN]   gum is missing
── Repositories
[INFO]   dotfiles OK
[INFO]   dotfiles-private OK
[ERROR]  hypr: unexpected remote
           expected: git@github.com:user/hypr.git
── Stow Integrity
[INFO]   All symlinks valid
── Collected Errors
[INFO]     Repositories
[ERROR]     hypr: unexpected remote
── Collected Warnings
[INFO]     Dependencies
[WARN]      gum is missing
[INFO]   1 warning(s), 1 error(s)
```

Integration test: if `dot doctor` reports 0 errors, the system is healthy.

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-doctor-lib` | Full 1,220-line bash implementation |
| `scripts/.local/bin/dot-lib` | Package check helpers used by doctor |
| `dot/src/services/Config.ts` | Provides repo lists, paths |
| `dot/src/services/CommandExecutor.ts` | For running git/pacman/systemctl |

---

## Suggested Skills

- `effect` — Effect.all with concurrency, Effect.catchAll, Effect.gen
- `types-enforce-ts` — Discriminated unions for CheckResult, exhaustive switches

---

## Constraints

- All checks must be Effect programs (no raw async/await)
- Checks run in parallel where possible (`Effect.all` with `concurrency: "unbounded"`)
- Each check must catch its own errors (a crashing check reports itself as error, doesn't kill the run)
- Private-only checks skipped gracefully when private dotfiles unavailable
- Report always written to log file (in addition to TUI/stdout display)
- Match legacy logging density: section headings per category, per-item status lines, grouped summary
- No artificial "Complete" section — the grouped summary + final count IS the completion signal
- Unicode symbols (✓ ⚠ ✗) are optional — the severity level (`[INFO]`/`[WARN]`/`[ERROR]`) is the primary signal
