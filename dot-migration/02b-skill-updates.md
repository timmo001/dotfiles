# Handoff: Phase 2b — `dot skill-updates` Port

## Focus

Port the `skill-updates` command from bash to TypeScript Effect. This is the most complex secondary command (678 lines of bash) with heavy GitHub API interaction, frontmatter parsing, file diffing, and interactive OpenCode session launching.

---

## Prerequisites

- Phase 0 complete (foundation services)
- Phase 1 complete (core commands)
- Phase 2 commands ported (establishes all secondary command patterns)
- `gh` CLI available in PATH (used for GitHub API calls)

---

## Current Implementation

**Source**: `scripts/.local/bin/dot-skill-updates-lib`

### Modes

| Flag | Mode | Behaviour |
|------|------|-----------|
| `--check` | Report-only | Exit 1 if updates available; no changes |
| `--update` | Auto-apply | Apply without prompting (used by `dot update` post-hook) |
| (default) | Interactive | Prompt per skill; launch OpenCode for local-edit conflicts |

### Data Flow

1. Scan `$PUBLIC_DOTFILES/agents/.config/opencode/skills/*/SKILL.md` for `# origin:` frontmatter
2. For each skill with an origin URL:
   - Parse GitHub URL → `owner/repo/branch/path`
   - Query latest commit SHA touching that path via `gh api repos/{owner}/{repo}/commits?path={path}&per_page=1&sha={branch}`
   - Compare against stored `# upstream-sha:` in SKILL.md frontmatter
   - If SHA matches → skip (cached, up to date)
   - Fetch upstream files, normalise both sides, diff
   - If no content changes → write SHA, report "up to date"
   - If changes + no local edits → auto-apply (in update mode) or prompt
   - If changes + `# local-edits:` declared → queue for interactive OpenCode review
3. Auto-commit cleanly updated skills
4. For skills with local edits (interactive mode): launch `opencode --prompt ... --agent plan` with diff report, then offer commit/skip/quit

### Key Functions

| Function | Purpose |
|----------|---------|
| `_skill_updates_stored_sha` | Read `# upstream-sha:` from SKILL.md frontmatter |
| `_skill_updates_write_sha` | Write/update SHA in frontmatter |
| `_skill_updates_gh_api` | Retrying GitHub API wrapper (3 attempts, exponential backoff) |
| `_skill_updates_upstream_sha` | Get latest commit SHA touching a path |
| `_skill_updates_parse_origin` | Parse `https://github.com/{owner}/{repo}/tree/{branch}/{path}` |
| `_skill_updates_normalise_local` | Strip local-only frontmatter for clean comparison |
| `_skill_updates_normalise_upstream` | Strip upstream-only metadata (metadata block, category, tags) |
| `_skill_updates_fetch_file` | Fetch file via GitHub contents API + base64 decode |
| `_skill_updates_list_local_files` | Recursively list local skill files |
| `_skill_updates_list_upstream_files` | Recursively list upstream skill files via API |
| `_skill_updates_apply_frontmatter` | Rebuild SKILL.md with local frontmatter format |
| `_skill_updates_check_skill` | Core per-skill check + apply logic |
| `cmd_skill_updates` | Orchestrator: scan skills, collect results, handle modes |

### SKILL.md Frontmatter Format (local)

```yaml
---
name: skill-name
description: Short description
# origin: https://github.com/owner/repo/tree/branch/path/to/skill
# upstream-sha: abc123...
# local-edits:
#   - Customised X for local conventions
#   - Added Y section
---
```

### Normalisation Rules

**Local normalise** (strips before comparison):
- `# origin:` lines
- `# upstream-sha:` lines
- `# local-edits:` + indented `#   - ` lines

**Upstream normalise** (strips before comparison):
- `metadata:` block + indented children
- `category:` lines
- `tags:` block + indented children

---

## Suggested Architecture

### Services Needed

- `Config` — for `publicDotfiles` path
- `OutputLog` — structured output
- `CommandExecutor` or `Launcher` — for running `gh api` and `opencode`

### New Domain Module: `dot/src/lib/skillUpdates.ts`

```typescript
// Core types
interface SkillOrigin {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly path: string;
}

interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly origin: SkillOrigin;
  readonly storedSha: string | null;
  readonly localEdits: readonly string[];
}

type CheckResult =
  | { type: "up-to-date" }
  | { type: "changes"; summary: string; files: readonly FileChange[] }
  | { type: "local-edits"; summary: string; files: readonly FileChange[] }
  | { type: "error"; reason: string };

interface FileChange {
  readonly path: string;
  readonly status: "modified" | "removed-upstream" | "added-upstream";
  readonly diff?: string;
}
```

### GitHub API Layer

Consider creating a small `GitHubApi` service or module:

```typescript
// Retrying gh api wrapper
const ghApi = (args: string[]) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    // Retry with exponential backoff (Schedule.exponential)
    return yield* executor.run("gh", ["api", ...args]).pipe(
      Effect.retry(Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(2)))),
    );
  });

// Fetch latest commit SHA
const getUpstreamSha = (origin: SkillOrigin) => ...

// Fetch file content (base64 decode)
const fetchFile = (origin: SkillOrigin, filePath: string) => ...
```

### Frontmatter Parser

```typescript
// Parse SKILL.md frontmatter into SkillMeta
const parseSkillMeta = (content: string, skillName: string): SkillMeta | null => ...

// Apply local frontmatter format to upstream content
const applyLocalFrontmatter = (upstream: string, meta: SkillMeta, sha: string): string => ...

// Normalise for comparison
const normaliseLocal = (content: string): string => ...
const normaliseUpstream = (content: string): string => ...
```

### Command: `dot/src/commands/SkillUpdates.ts`

```typescript
export const skillUpdates = (opts?: {
  readonly check?: boolean;
  readonly update?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    const mode = opts?.check ? "check" : opts?.update ? "update" : "interactive";
    const skillsDir = `${config.publicDotfiles}/agents/.config/opencode/skills`;

    yield* log.section("Skill Updates");

    // Scan skills with origins
    const skills = yield* scanSkills(skillsDir);

    // Process each skill
    for (const skill of skills) {
      const result = yield* checkSkill(skill, mode);
      // Handle result per mode...
    }
  });
```

---

## Complexity Considerations

1. **GitHub API rate limiting**: The bash version has retry logic. Use `Effect.retry` with `Schedule.exponential`.
2. **Interactive prompts**: In interactive mode, uses `gum confirm` for yes/no. Could use `launcher.suspend()` for gum calls or implement inline prompts.
3. **OpenCode session launch**: For local-edit conflicts, launches `opencode --prompt "..." --agent plan`. Use `launcher.suspend()`.
4. **Git commit**: After auto-applying, commits with a message. Use `CommandExecutor` to run `git add` + `git commit`.
5. **File I/O**: Reading/writing skill files. Use `Bun.file()` / `Bun.write()` wrapped in `Effect.sync`.
6. **Diff generation**: Uses `diff --unified=2` for change summaries. Could use a subprocess call or a JS diff library.

---

## Suggested Approach

1. Start with `check` mode (read-only, simplest path)
2. Add `update` mode (read-only check + write files + git commit)
3. Add `interactive` mode last (prompt logic + OpenCode handoff)

---

## Validation

```bash
bun run build

# Check mode (should match bash output):
dot skill-updates --check

# Update mode (used by dot update post-hook):
dot skill-updates --update

# Interactive (default):
dot skill-updates
```

Compare output against `dot-legacy skill-updates` for each mode.

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-skill-updates-lib` | Full 678-line bash implementation |
| `dot/src/commands/Stow.ts` | Pattern reference for service usage |
| `dot/src/services/CommandExecutor.ts` | For `gh api` subprocess calls |
| `agents/.config/opencode/skills/*/SKILL.md` | Real skill files to test against |

---

## Suggested Skills

- `effect` — Effect.gen, retry, schedule, service patterns
- `types-enforce-ts` — Type safety for domain types

---

## Constraints

- Every function is an Effect (no raw async/await)
- Log via OutputLog, not console.log
- Gracefully handle missing `gh` CLI (warn and skip)
- Preserve exact frontmatter format compatibility with existing SKILL.md files
- Do not break the `dot update` post-hook flow (`--update` mode must work identically)
