---
name: dot-git-links
description: Add a Git panel icon link after GitHub issue and pull request links you share, using dot link git. Use when a reply, Plannotator Inbox message, review, summary or report links to an issue or pull request in the user's personal repositories, assigned to them, or opened by them, so the reader can open it in the Git panel instead of the browser.
license: Apache-2.0
compatibility: Requires the dot CLI from timmo001/dotfiles. The Git panel only lists issues and pull requests for repositories with tracking turned on in private dot-git.yml.
metadata:
  author: timmo001
---

# Git Panel Links

The Git panel only lists the user's own work, so only these links can get an
icon:

- issues and pull requests in the user's personal repositories (`timmo001/*`)
- issues and pull requests assigned to them
- pull requests and issues they opened

Leave out everything else, such as other people's pull requests and upstream or
organisation issues the user isn't assigned to, without calling the command.

When you're about to share links that qualify, run `dot link git <url>...` once
with every one of them. It prints JSON under an
agent, one entry per URL, in order:

```json
[{"url":"https://github.com/timmo001/dotfiles/issues/1078","link":"dot://git/issue/timmo001/dotfiles/1078","listed":true,"markdown":"[🖥️](dot://git/issue/timmo001/dotfiles/1078)"}]
```

- Put `markdown` after the GitHub link, separated by a space, and leave the GitHub
  link as it is:

  ```markdown
  [#1078 Chromium extension to open pages through dot:// links](https://github.com/timmo001/dotfiles/issues/1078) [🖥️](dot://git/issue/timmo001/dotfiles/1078)
  ```

- When `markdown` is null, add nothing. The Git panel doesn't list the item, so
  the icon would open the same GitHub page as the link next to it.
- Copy the `markdown` value exactly. Don't build `dot://` links or pick an icon
  yourself, and don't add them for anything else, such as commits, files or
  repositories.
- Only add icon links where Markdown links render: chat replies, the Plannotator
  Inbox, Plannotator reviews and Markdown documents. Leave them out of commit
  messages and anything posted to GitHub, where nobody else can open them.
- Skip the call when the message has no qualifying links, and use
  the result for every mention of the same item in that message.
