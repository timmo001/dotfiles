---
name: dot-session-queue
description: Park an OpenCode 2 session on the Home Assistant box to pick up on another machine, with dot session send and dot session queue. Use when the user asks to send, park, queue or move this session (or another one) to another machine, the laptop or the desktop, or asks what sessions are waiting to be picked up.
license: Apache-2.0
compatibility: Requires the dot CLI, the host's configured OpenCode 2 launcher and a private ~/.config/dot/session-queue.yml with SSH access to the queue folder.
---

# Session Queue

## Send A Session

1. For this session, take the exact `Current conversation session ID` from the
   harness's injected environment context. Never guess it from the directory,
   the focused pane or the latest session. For another session, use the ID the
   user gives or the one Herdr reports for that pane.
2. Run `dot session send <session-id> --json`. It exports the session and its
   subagent sessions, adds a patch of uncommitted changes (untracked files
   included) and uploads them to the queue over SSH.
3. Tell the user, briefly:
   - the entry ID (`result.id`) and how many changed files went in the patch;
   - that the turn doing the sending is cut off in the export, because the
     export is taken while you are still working;
   - any warning in `notes`, especially when HEAD isn't pushed, since the other
     machine may not have that commit;
   - that the original session is left as it is.
4. Stop after sending. Anything you do afterwards won't be in the copy.

## List And Take

- `dot session queue --json` lists what's waiting, newest first.
- Never run `dot session take`. Picking a session up claims it, imports it,
  may apply a patch and opens a Herdr pane, so it belongs to the user on the
  machine that should continue the work. Tell them to run `dot session take`
  there.

## When It Fails

- "No session queue": the private config is missing on this machine.
- SSH errors: run `dot doctor` and report the Session queue row rather than
  retrying in a loop.
