---
description: Debug browser-specific UI issues with Chrome DevTools tools first
agent: ask
---

Use Chrome DevTools tools as the primary workflow for this command.

Follow these steps:

1. Use `${ARGUMENTS}` as the issue description, page URL, or area to inspect.
2. If `${ARGUMENTS}` does not clearly identify a page, route, or problem, ask one concise question with the `question` tool to get the missing target.
3. Start with the default inspection sequence:
   - take a page snapshot
   - list console messages
   - list network requests
4. Use the initial evidence to decide the next step:
   - for visible UI regressions, interaction bugs, or missing content, continue with snapshots, targeted element inspection, console details, and relevant network request details
   - for accessibility, SEO, or general best-practices audits, run Lighthouse
   - for page-load speed, Core Web Vitals, or runtime responsiveness issues, run a performance trace
5. Prefer evidence from the browser session over source-only guesses.
6. Summarize the findings directly for the user, including the concrete browser evidence that supports the conclusion.
7. Do not edit files unless the user explicitly asks for fixes after the debugging step.
