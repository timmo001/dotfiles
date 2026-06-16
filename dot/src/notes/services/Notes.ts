import { Clock, Context, Effect, Layer, Schema } from "effect";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { HOME_DIR, expandHomePath } from "../../lib/paths.js";
import {
  formatNoteLabel,
  parseNotePriority,
  type NoteCommitResult,
  type NoteContextOptions,
  type NoteCreateDraft,
  type NoteCreateKind,
  type NoteDeleteResult,
  type NoteEntry,
  type NoteFrontmatter,
  type NotePriority,
  type NoteRepoSection,
  type RepoNoteIdentity,
  type NoteWriteResult,
} from "../types.js";
import { formatNoteTimestamp } from "../time.js";

const NOTES_SUBDIR = "repo-notes";
const COMMANDS_NEEDING_LIST = new Set<string>([
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoffs-list",
]);

/** Domain error for repo-note operations. */
export class NotesError extends Schema.TaggedErrorClass<NotesError>()(
  "NotesError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

/**
 * Options controlling remote sync around a note mutation.
 *
 * Sync is for direct user actions in the `dot notes` / `dot handoffs` TUI only.
 * The OpenCode note tools and the `dot note` CLI never set this.
 */
interface NoteSyncOptions {
  /**
   * When true, after the local commit, pull the notes vault with rebase and
   * push it to its remote. Best-effort: pull/push failures never fail the note
   * operation.
   */
  readonly sync?: boolean;
}

/** Service interface for repo-scoped note context and file I/O. */
interface NotesService {
  /** Resolve the notes vault root. */
  readonly root: Effect.Effect<string, NotesError>;
  /** Resolve the notes vault's `repo-notes` directory. */
  readonly repoNotesRoot: Effect.Effect<string, NotesError>;
  /** Render the current repository's OpenCode context block. */
  readonly context: (
    options: NoteContextOptions,
  ) => Effect.Effect<string, NotesError>;
  /** List note entries for the current repository. */
  readonly list: () => Effect.Effect<readonly NoteEntry[], NotesError>;
  /** List note entries grouped by every repository notes directory. */
  readonly listAll: () => Effect.Effect<readonly NoteRepoSection[], NotesError>;
  /** Read a note file from the notes vault. */
  readonly read: (filePath: string) => Effect.Effect<string, NotesError>;
  /** Write a note file and best-effort git commit it. */
  readonly write: (
    filePath: string,
    content: string,
  ) => Effect.Effect<NoteWriteResult, NotesError>;
  /** Delete a note file and best-effort git commit it. */
  readonly delete: (
    filePath: string,
    options?: NoteSyncOptions,
  ) => Effect.Effect<NoteDeleteResult, NotesError>;
  /** Create a draft note file with seed content (no git commit yet). */
  readonly createDraft: (
    kind: NoteCreateKind,
    name: string,
    description: string,
  ) => Effect.Effect<NoteCreateDraft, NotesError>;
  /** Commit a freshly created draft note file after editor exit. */
  readonly finaliseDraft: (
    filePath: string,
    options?: NoteSyncOptions,
  ) => Effect.Effect<NoteCommitResult, NotesError>;
  /** Commit an edited existing note file after editor exit. */
  readonly finaliseEdit: (
    filePath: string,
    options?: NoteSyncOptions,
  ) => Effect.Effect<NoteCommitResult, NotesError>;
  /** Set the handoff priority in a note's frontmatter and commit it. */
  readonly setPriority: (
    filePath: string,
    priority: NotePriority,
    options?: NoteSyncOptions,
  ) => Effect.Effect<NoteCommitResult, NotesError>;
}

type CommandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

function errorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const stderr = record.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return String(error);
}

function expandHome(filePath: string): string {
  return expandHomePath(filePath);
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function parseRemoteUrl(
  url: string,
): Pick<RepoNoteIdentity, "owner" | "repo"> | null {
  const sshMatch = url.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const httpsMatch = url.match(
    /^(?:https?|ssh):\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

function parseTags(value: string): readonly string[] {
  return value
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function readNoteFrontmatter(filePath: string): NoteFrontmatter {
  let head: string;
  try {
    head = readFileSync(filePath, "utf-8").split("\n").slice(0, 20).join("\n");
  } catch {
    return { name: null, description: null, tags: [], priority: null };
  }
  const name =
    head
      .match(/^name:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") || null;
  const description =
    head
      .match(/^description:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") || null;
  const tagsRaw = head.match(/^tags:\s*\[(.+)\]$/m)?.[1];
  const priorityRaw = head.match(/^priority:\s*(.+)$/m)?.[1];
  return {
    name,
    description,
    tags: tagsRaw ? parseTags(tagsRaw) : [],
    priority: priorityRaw ? parseNotePriority(priorityRaw) : null,
  };
}

/**
 * Set or replace the `priority:` line within a note's YAML frontmatter.
 *
 * Returns the updated content, or null when the file has no frontmatter block.
 * A new line is inserted after `description:`, before `tags:`, or at the end of
 * the frontmatter body, whichever is found first.
 */
function setFrontmatterPriority(
  content: string,
  priority: NotePriority,
): string | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const priorityLine = `priority: ${priority}`;
  const lines = frontmatter[1].split(/\r?\n/);

  const existingIndex = lines.findIndex((line) => /^priority:\s*/.test(line));
  if (existingIndex !== -1) {
    lines[existingIndex] = priorityLine;
  } else {
    const descIndex = lines.findIndex((line) => /^description:\s*/.test(line));
    const tagsIndex = lines.findIndex((line) => /^tags:\s*/.test(line));
    const insertAt =
      descIndex !== -1
        ? descIndex + 1
        : tagsIndex !== -1
          ? tagsIndex
          : lines.length;
    lines.splice(insertAt, 0, priorityLine);
  }

  const body = lines.join(newline);
  return content.replace(
    frontmatter[0],
    () => `---${newline}${body}${newline}---`,
  );
}

function listNoteEntries(
  notesPath: string,
  repoSlug?: string,
): readonly NoteEntry[] {
  if (!existsSync(notesPath)) return [];

  return readdirSync(notesPath)
    .filter((filename) => filename.endsWith(".md"))
    .map((filename) => {
      const filePath = join(notesPath, filename);
      const stat = statSync(filePath);
      return {
        filename,
        filePath,
        repoSlug,
        mtime: stat.mtimeMs / 1000,
        ...readNoteFrontmatter(filePath),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function sortedDirectories(path: string) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listNoteRepoSections(
  repoNotesRoot: string,
): readonly NoteRepoSection[] {
  if (!existsSync(repoNotesRoot)) return [];

  const sections: NoteRepoSection[] = [];
  for (const owner of sortedDirectories(repoNotesRoot)) {
    const ownerPath = join(repoNotesRoot, owner.name);
    for (const repo of sortedDirectories(ownerPath)) {
      const repoSlug = `${owner.name}/${repo.name}`;
      const notesPath = join(ownerPath, repo.name);
      const entries = listNoteEntries(notesPath, repoSlug);
      if (entries.length > 0) sections.push({ repoSlug, notesPath, entries });
    }
  }

  return sections;
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function collisionFreePath(dir: string, slug: string): string {
  const base = join(dir, slug);
  if (!existsSync(base)) return base;

  const ext = ".md";
  const stem = slug.slice(0, -ext.length);
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = join(dir, `${stem}-${suffix}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  return base;
}

function draftSeedContent(
  kind: NoteCreateKind,
  identity: RepoNoteIdentity,
  now: Date,
  name: string,
  description: string,
): string {
  const date = formatNoteTimestamp(now);
  const repo = `${identity.owner}/${identity.repo}`;
  const desc =
    description ||
    `Draft ${kind === "handoff" ? "handoff" : "repository"} note.`;

  if (kind === "handoff") {
    return [
      "---",
      `repo: ${repo}`,
      `date: ${date}`,
      "type: handoff",
      `name: ${name}`,
      `description: ${desc}`,
      "priority: medium",
      "tags: [handoff, draft]",
      "---",
      "",
      `# ${name}`,
      "",
      "## Summary",
      "",
      "",
      "## Next Focus",
      "",
      "",
      "## Suggested Skills",
      "",
      "",
      "## Artifact References",
      "",
      "",
      "## Open Threads",
      "",
      "",
    ].join("\n");
  }

  return [
    "---",
    `repo: ${repo}`,
    `date: ${date}`,
    `name: ${name}`,
    `description: ${desc}`,
    "tags: [draft]",
    "---",
    "",
    `# ${name}`,
    "",
    "",
  ].join("\n");
}

function formatTag(
  name: string,
  description: string,
  lines: readonly string[],
): string {
  const body = [`Description: ${description}`, ...lines.filter(Boolean)]
    .join("\n")
    .trim();
  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n");
}

function formatErrorContext(message: string, detail?: string): string {
  return [
    "<repo-note-context>",
    formatTag(
      "metadata",
      "Information about how this repo-note context was generated.",
      [`Generated at: ${new Date().toISOString()}`],
    ),
    formatTag("warnings", "Issues encountered while collecting repo context.", [
      message,
      detail ? `Error: ${detail}` : "",
    ]),
    "</repo-note-context>",
  ].join("\n\n");
}

function formatContextBlock(args: {
  readonly command: string;
  readonly identity: RepoNoteIdentity;
  readonly notesRoot: string;
  readonly notesPath: string;
  readonly notesExist: boolean;
  readonly entries: readonly NoteEntry[];
  readonly warnings: readonly string[];
}): string {
  const metadataLines = [
    "RepoNotesPlugin generated this context. Use it to locate and manage notes for this repository.",
    `Generated at: ${new Date().toISOString()}`,
  ];
  const repoLines = [
    `Owner: ${args.identity.owner}`,
    `Repo: ${args.identity.repo}`,
    `Remote: ${args.identity.remote} (${args.identity.remoteUrl})`,
    `Notes root: ${args.notesRoot}`,
    `Notes path: ${args.notesPath}`,
    `Notes directory exists: ${args.notesExist ? "yes" : "no"}`,
  ];
  const parts = [
    "<repo-note-context>",
    formatTag("metadata", "How this context was generated.", metadataLines),
    formatTag(
      "repository",
      "Current repository identity and resolved notes path.",
      repoLines,
    ),
  ];

  if (COMMANDS_NEEDING_LIST.has(args.command)) {
    const notesLines =
      args.entries.length > 0
        ? args.entries.map(formatNoteLabel)
        : args.notesExist
          ? ["(no .md files found in notes directory)"]
          : ["(notes directory does not exist yet)"];
    parts.push(
      formatTag(
        "existing-notes",
        "Existing note files for this repository, sorted newest-first by modification time.",
        notesLines,
      ),
    );
  }

  if (args.command === "note-reference" && args.entries.length > 0) {
    const contentParts = [
      "<note-contents>",
      "Description: Full content of all note files for this repository.",
    ];
    for (const entry of args.entries) {
      let body: string;
      try {
        body = readFileSync(entry.filePath, "utf-8").trim();
      } catch (error) {
        body = `(error reading file: ${errorMessage(error)})`;
      }
      contentParts.push(`<note file="${entry.filename}">`, body, "</note>");
    }
    contentParts.push("</note-contents>");
    parts.push(contentParts.join("\n"));
  }

  if (args.warnings.length) {
    parts.push(
      formatTag(
        "warnings",
        "Non-fatal issues encountered while collecting repo note context.",
        args.warnings,
      ),
    );
  }

  parts.push("</repo-note-context>");
  return parts.join("\n\n");
}

function commitOutputLine(result: NoteCommitResult, message: string): string[] {
  return result.ok ? ["", `Committed to git: \`${message}\``] : [];
}

type SyncStepResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

function syncOutputLine(
  label: string,
  result: SyncStepResult | undefined,
): string[] {
  if (!result) return [];
  if (result.ok) return [`${label}: ${result.text || "ok"}`];
  return [`${label} failed (non-fatal): ${result.error}`];
}

/** Effect service for {@link NotesService}. */
export class Notes extends Context.Service<Notes, NotesService>()("Notes") {
  static readonly layer = Layer.effect(
    Notes,
    Effect.gen(function* () {
      const config = yield* Config;
      const executor = yield* CommandExecutor;
      const notesRoot = resolve(
        config.notesDir ?? join(HOME_DIR, "Documents", "notes"),
      );
      const repoNotesRoot = join(notesRoot, NOTES_SUBDIR);

      const commandResult = (
        cmd: string,
        args: readonly string[],
        opts?: { readonly cwd?: string },
      ): Effect.Effect<CommandResult> =>
        executor.run(cmd, args, opts).pipe(
          Effect.map((text) => ({ ok: true as const, text: text.trim() })),
          Effect.catch((error) =>
            Effect.succeed({ ok: false as const, error: errorMessage(error) }),
          ),
        );

      const fail = (message: string, detail?: string) =>
        new NotesError({ message, detail });

      const assertInsideNotesRoot = (filePath: string) =>
        Effect.try({
          try: () => {
            const expanded = expandHome(filePath);
            if (!isInsideDirectory(notesRoot, expanded)) {
              throw fail(`Path is outside the notes vault: ${filePath}`);
            }
            return resolve(expanded);
          },
          catch: (error) =>
            error instanceof NotesError ? error : fail(errorMessage(error)),
        });

      const resolveIdentity = Effect.fn("Notes.resolveIdentity")(function* () {
        const inRepo = yield* commandResult("git", [
          "rev-parse",
          "--is-inside-work-tree",
        ]);
        if (!inRepo.ok || inRepo.text !== "true") {
          return yield* Effect.fail(
            fail(
              "RepoNotesPlugin: not inside a git worktree — cannot resolve owner/repo.",
              inRepo.ok ? undefined : inRepo.error,
            ),
          );
        }

        const warnings: string[] = [];
        const remotesResult = yield* commandResult("git", ["remote"]);
        const remotes = remotesResult.ok
          ? remotesResult.text
              .split(/\r?\n/g)
              .map((remote) => remote.trim())
              .filter(Boolean)
          : [];

        if (!remotesResult.ok)
          warnings.push(`Unable to list git remotes: ${remotesResult.error}`);
        if (remotes.length === 0)
          warnings.push("No git remotes detected; defaulting to origin");

        const remote = remotes.includes("upstream")
          ? "upstream"
          : remotes.includes("origin")
            ? "origin"
            : (remotes[0] ?? "origin");
        const remoteUrl = yield* commandResult("git", [
          "remote",
          "get-url",
          remote,
        ]);

        if (!remoteUrl.ok) {
          return yield* Effect.fail(
            fail(
              `RepoNotesPlugin: unable to read URL for remote "${remote}".`,
              remoteUrl.error,
            ),
          );
        }

        const parsed = parseRemoteUrl(remoteUrl.text);
        if (!parsed) {
          return yield* Effect.fail(
            fail(
              `RepoNotesPlugin: could not parse owner/repo from remote URL: ${remoteUrl.text}`,
            ),
          );
        }

        return {
          identity: {
            ...parsed,
            remote,
            remoteUrl: remoteUrl.text,
          },
          warnings,
        };
      });

      const currentNotesPath = Effect.fn("Notes.currentNotesPath")(
        function* () {
          const { identity } = yield* resolveIdentity();
          return join(repoNotesRoot, identity.owner, identity.repo);
        },
      );

      const gitCommit = Effect.fn("Notes.gitCommit")(function* (
        filePath: string,
        message: string,
      ) {
        const relativePath = relative(notesRoot, filePath);
        const isRepo = yield* commandResult("git", [
          "-C",
          notesRoot,
          "rev-parse",
          "--is-inside-work-tree",
        ]);

        if (!isRepo.ok) {
          const init = yield* commandResult("git", ["-C", notesRoot, "init"]);
          if (!init.ok)
            return { ok: false, error: `git init failed: ${init.error}` };
        }

        const add = yield* commandResult("git", [
          "-C",
          notesRoot,
          "add",
          "--",
          relativePath,
        ]);
        if (!add.ok)
          return { ok: false, error: `git add failed: ${add.error}` };

        const commit = yield* commandResult("git", [
          "-C",
          notesRoot,
          "commit",
          "-m",
          message,
          "--no-verify",
        ]);
        if (!commit.ok) {
          if (commit.error.includes("nothing to commit")) {
            return { ok: true, text: "nothing to commit" };
          }
          return { ok: false, error: `git commit failed: ${commit.error}` };
        }

        return { ok: true, text: commit.text };
      });

      const hasRemote = Effect.fn("Notes.hasRemote")(function* () {
        const isRepo = yield* commandResult("git", [
          "-C",
          notesRoot,
          "rev-parse",
          "--is-inside-work-tree",
        ]);
        if (!isRepo.ok) return false;
        const remotes = yield* commandResult("git", [
          "-C",
          notesRoot,
          "remote",
        ]);
        return remotes.ok && remotes.text.trim().length > 0;
      });

      const gitPull = Effect.fn("Notes.gitPull")(function* () {
        if (!(yield* hasRemote())) {
          return { ok: true as const, text: "no remote; skipped pull" };
        }
        const pull = yield* commandResult("git", [
          "-C",
          notesRoot,
          "pull",
          "--rebase",
          "--autostash",
        ]);
        return pull.ok
          ? { ok: true as const, text: pull.text }
          : { ok: false as const, error: pull.error };
      });

      const gitPush = Effect.fn("Notes.gitPush")(function* () {
        if (!(yield* hasRemote())) {
          return { ok: true as const, text: "no remote; skipped push" };
        }
        const push = yield* commandResult("git", ["-C", notesRoot, "push"]);
        return push.ok
          ? { ok: true as const, text: push.text }
          : { ok: false as const, error: push.error };
      });

      // After a successful local commit, pull (rebase) then push. Best-effort:
      // returns human-readable output lines and never fails the note operation.
      const syncAfterCommit = Effect.fn("Notes.syncAfterCommit")(function* (
        commitOk: boolean,
        sync: boolean | undefined,
      ) {
        if (!sync || !commitOk) return [] as string[];
        const pull = yield* gitPull();
        const push = yield* gitPush();
        return [
          ...syncOutputLine("Pulled from remote", pull),
          ...syncOutputLine("Pushed to remote", push),
        ];
      });

      return {
        root: Effect.succeed(notesRoot),
        repoNotesRoot: Effect.succeed(repoNotesRoot),
        context: ({ command }) =>
          Effect.gen(function* () {
            const resolved = yield* resolveIdentity().pipe(
              Effect.catch((error: NotesError) =>
                Effect.succeed({ error } as const),
              ),
            );
            if ("error" in resolved) {
              return formatErrorContext(
                resolved.error.message,
                resolved.error.detail,
              );
            }

            const notesPath = join(
              repoNotesRoot,
              resolved.identity.owner,
              resolved.identity.repo,
            );
            const notesExist = existsSync(notesPath);
            const warnings = [...resolved.warnings];
            let entries: readonly NoteEntry[] = [];
            if (COMMANDS_NEEDING_LIST.has(command)) {
              try {
                entries = listNoteEntries(notesPath);
              } catch (error) {
                warnings.push(
                  `Unable to list existing notes: ${errorMessage(error)}`,
                );
              }
            }
            return formatContextBlock({
              command,
              identity: resolved.identity,
              notesRoot,
              notesPath,
              notesExist,
              entries,
              warnings,
            });
          }),
        list: () =>
          Effect.gen(function* () {
            const notesPath = yield* currentNotesPath();
            return listNoteEntries(notesPath);
          }),
        listAll: () =>
          Effect.try({
            try: () => listNoteRepoSections(repoNotesRoot),
            catch: (error) =>
              fail(
                `notes list --all: failed to list notes: ${errorMessage(error)}`,
              ),
          }),
        read: (filePath) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            return yield* Effect.try({
              try: () => readFileSync(resolvedPath, "utf-8"),
              catch: (error) =>
                fail(
                  `note_read: failed to read file ${filePath}: ${errorMessage(error)}`,
                ),
            });
          }),
        write: (filePath, content) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            const dir = dirname(resolvedPath);
            const filename = basename(resolvedPath);
            yield* Effect.try({
              try: () => {
                mkdirSync(dir, { recursive: true });
                writeFileSync(resolvedPath, content);
              },
              catch: (error) =>
                fail(
                  `note_write: failed to write file ${filePath}: ${errorMessage(error)}`,
                ),
            });

            const message = `notes: write ${filename}`;
            const commit = yield* gitCommit(resolvedPath, message);
            const output = [
              `Written: ${resolvedPath}`,
              "",
              "```markdown",
              content,
              "```",
              ...commitOutputLine(commit, message),
              "",
              "## How to undo",
              "",
              "```sh",
              "# Revert to the previous version",
              `cd ${dir} && git log --oneline -5 -- ${filename}`,
              `cd ${dir} && git checkout HEAD~1 -- ${filename}`,
              "```",
            ].join("\n");

            return { path: resolvedPath, output, commit };
          }),
        delete: (filePath, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            const dir = dirname(resolvedPath);
            const filename = basename(resolvedPath);
            yield* Effect.try({
              try: () => unlinkSync(resolvedPath),
              catch: (error) => {
                const code =
                  typeof error === "object" && error !== null
                    ? (error as Record<string, unknown>).code
                    : undefined;
                return fail(
                  code === "ENOENT"
                    ? `note_delete: file does not exist: ${filePath}`
                    : `note_delete: failed to delete file ${filePath}: ${errorMessage(error)}`,
                );
              },
            });

            const message = `notes: delete ${filename}`;
            const commit = yield* gitCommit(resolvedPath, message);
            const syncLines = yield* syncAfterCommit(commit.ok, options?.sync);
            const output = [
              `Deleted: ${resolvedPath}`,
              ...commitOutputLine(commit, message),
              ...syncLines,
              "",
              "## How to undo",
              "",
              "```sh",
              "# Restore the deleted file",
              `cd ${dir} && git revert --no-commit HEAD && git checkout HEAD -- ${filename}`,
              "",
              "# Or restore directly from the commit before deletion",
              `cd ${dir} && git checkout HEAD~1 -- ${filename}`,
              "```",
            ].join("\n");

            return { path: resolvedPath, output, commit };
          }),
        createDraft: (kind, name, description) =>
          Effect.gen(function* () {
            const { identity } = yield* resolveIdentity();
            const notesPath = join(
              repoNotesRoot,
              identity.owner,
              identity.repo,
            );
            const slug = slugifyName(name);
            const filePath = collisionFreePath(notesPath, `${slug}.md`);
            const now = new Date(yield* Clock.currentTimeMillis);
            const content = draftSeedContent(
              kind,
              identity,
              now,
              name,
              description,
            );

            yield* Effect.try({
              try: () => {
                mkdirSync(notesPath, { recursive: true });
                writeFileSync(filePath, content);
              },
              catch: (error) =>
                fail(
                  `createDraft: failed to write draft: ${errorMessage(error)}`,
                ),
            });

            const stat = statSync(filePath);
            const frontmatter = readNoteFrontmatter(filePath);
            const entry: NoteEntry = {
              filename: basename(filePath),
              filePath,
              mtime: stat.mtimeMs / 1000,
              ...frontmatter,
            };

            return { entry, content };
          }),
        finaliseDraft: (filePath, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            if (!existsSync(resolvedPath)) {
              return { ok: true, text: "draft file was removed" };
            }
            const filename = basename(resolvedPath);
            const message = `notes: create ${filename}`;
            const commit = yield* gitCommit(resolvedPath, message);
            yield* syncAfterCommit(commit.ok, options?.sync);
            return commit;
          }),
        finaliseEdit: (filePath, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            if (!existsSync(resolvedPath)) {
              return { ok: true, text: "note file was removed" };
            }
            const filename = basename(resolvedPath);
            const message = `notes: edit ${filename}`;
            const commit = yield* gitCommit(resolvedPath, message);
            yield* syncAfterCommit(commit.ok, options?.sync);
            return commit;
          }),
        setPriority: (filePath, priority, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* assertInsideNotesRoot(filePath);
            const content = yield* Effect.try({
              try: () => readFileSync(resolvedPath, "utf-8"),
              catch: (error) =>
                fail(
                  `setPriority: failed to read file ${filePath}: ${errorMessage(error)}`,
                ),
            });

            const updated = setFrontmatterPriority(content, priority);
            if (updated === null) {
              return yield* Effect.fail(
                fail(
                  `setPriority: no frontmatter found in ${filePath}; cannot set priority`,
                ),
              );
            }

            yield* Effect.try({
              try: () => writeFileSync(resolvedPath, updated),
              catch: (error) =>
                fail(
                  `setPriority: failed to write file ${filePath}: ${errorMessage(error)}`,
                ),
            });

            const filename = basename(resolvedPath);
            const message = `notes: set priority ${filename}`;
            const commit = yield* gitCommit(resolvedPath, message);
            yield* syncAfterCommit(commit.ok, options?.sync);
            return commit;
          }),
      };
    }),
  );
}
