---
name: dot-session-queue
description: Park an OpenCode 2 session on the Home Assistant box to pick up on another machine, with dot session send, queue and remove. Use when the user asks to send, park, queue or move this session (or another one) to another machine, the laptop or the desktop, asks what sessions are waiting to be picked up, or wants a queued one removed.
license: Apache-2.0
compatibility: Requires the dot CLI, the host's configured OpenCode 2 launcher and a private ~/.config/dot/session-queue.yml with SSH access to the queue folder.
---

# Session Queue

## Send A Session

1. Prefer the `dot` Code Mode namespace's `session_send` tool, with `sessionId`
   and `attach` in place of the flags below; without it, run `dot session send
   --json`. To send this session, leave the ID out: it uses
   `$OPENCODE_SESSION_ID`, which OpenCode sets for its shell and Code Mode
   tools, then the session Herdr reports for your own pane
   (`dot session current` prints the one it would pick). Afterwards, check
   `result.sessionId` is your `Current conversation session ID`; if it isn't,
   remove the entry (below) and send again with that ID. Never ask the user for
   the ID and never guess it from the directory or the latest session.
   To send another session, pass the ID the user gives or the one Herdr
   reports for that pane (`agent_session.value` from the `herdr` Code Mode
   namespace's agent get, or `herdr agent get <pane-id>`).
2. Sending exports the session and its
   subagent sessions, adds a patch of uncommitted changes (untracked files
   included) and uploads them to the queue over SSH.
   Attach this task's scratch folders by default: pass
   `--attach <folder>` for each of `/tmp/opencode/<task>/` and
   `~/.cache/agent-scratch/<task>/` that exists, plus any other file the work
   depends on that Git ignores or that lives outside the repository. Don't
   attach files already in the patch. `dot session take` puts attachments back
   at the same path, relative to the repository or home directory, and never
   overwrites an existing file.
3. Tell the user, briefly:
   - the entry ID (`result.id`), how many changed files went in the patch and
     what was attached (`result.attachments`);
   - that the turn doing the sending is cut off in the export, because the
     export is taken while you are still working;
   - any warning in `notes`, especially when HEAD isn't pushed, since the other
     machine may not have that commit;
   - that the original session is left as it is.
4. Stop after sending. Anything you do afterwards won't be in the copy.

## List, Remove And Take

- The `dot` Code Mode namespace's `session_queue` tool, or
  `dot session queue --json`, lists what's waiting, newest first.
- `session_remove` (`dot session remove <entry-id>...`) takes entries out of
  the queue without importing them, such as one sent by mistake. It moves them
  to `removed/` on the queue, so they can still be recovered by hand. Remove
  only entries the user asked about or that you queued by mistake.
- Never run `dot session take` or its Code Mode tool. Picking a session up claims it, imports it,
  may apply a patch and opens a Herdr pane, so it belongs to the user on the
  machine that should continue the work. Tell them to run `dot session take`
  there.

## When It Fails

- "No session queue": the private config is missing on this machine.
- SSH errors: run the doctor check (the `dot` namespace's `doctor` tool, or
  `dot doctor`) and report the Session queue row rather than
  retrying in a loop.
