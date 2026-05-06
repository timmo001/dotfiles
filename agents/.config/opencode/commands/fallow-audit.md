---
description: Audit changed JavaScript or TypeScript code with Fallow
agent: ask
---

Load and apply the `fallow` skill before proceeding.

Prefer the `fallow_audit` MCP tool over ad-hoc shell commands for this command.

Follow these steps:

1. Audit the current changeset with Fallow using changed-file scope against the branch base.
2. If `${ARGUMENTS}` clearly names a workspace or package scope, use it to narrow the audit when the tool supports that scope.
3. Focus on the changed-code verdict and findings for:
   - dead code
   - complexity and health issues
   - duplication
4. Report findings first, ordered by severity.
5. If there are no findings, say that explicitly and include the audit verdict.
6. When useful, call out whether a finding appears newly introduced by the current changes versus inherited.
7. Do not edit files unless the user explicitly asks for fixes after the audit step.
