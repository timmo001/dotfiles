---
title: Cursor
description: Cursor launchers and shell command defaults.
sidebar:
  order: 8
---

Cursor's system desktop entry and the `cursor` shell function use plain launch behaviour, which routes to the last active window type.

Two additional application entries provide explicit choices in the desktop launcher:

- **Cursor Editor** opens the Editor window with `--classic`.
- **Cursor Agents** uses Cursor's `cursor://anysphere.cursor-deeplink/glass` route to open or focus the Agents window. Cursor calls this interface Glass internally; there is no `--modern` flag.

The Git panel's **Open in agent** action runs `cursor-agent` for repositories selected with **Cursor Agent**.
