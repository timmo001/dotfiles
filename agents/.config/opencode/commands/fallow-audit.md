---
description: Audit changed JavaScript or TypeScript code with Fallow
agent: ask
---

Load and apply the `fallow` skill before proceeding.

Prefer the `fallow_audit` MCP tool over ad-hoc shell commands for this command.

Audit the current changeset with changed-file scope against the branch base. If `${ARGUMENTS}` clearly names a workspace or package, use it to narrow the audit when the tool supports that scope.

Report changed-code verdict and findings first, ordered by severity. If there are no findings, say that explicitly and include the audit verdict.

Do not edit files unless the user explicitly asks for fixes after the audit step.
