---
title: Yazi
description: Restore the shared Yazi plugin set across devices.
sidebar:
  order: 5
---

Yazi is installed from the public package list. Its `package.toml` lockfile is stowed from `yazi/.config/yazi/`, while downloaded plugin code remains local to each device.

After `dot init` or `dot update` has stowed the configuration, restore the locked plugins:

```bash
ya pkg install
```

Add, remove, or upgrade plugins with `ya pkg`. These commands update the tracked lockfile through its stowed path:

```bash
ya pkg add yazi-rs/plugins:git
ya pkg delete yazi-rs/plugins:git
ya pkg upgrade
```
