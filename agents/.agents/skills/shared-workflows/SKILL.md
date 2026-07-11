---
name: shared-workflows
description: Use, configure, maintain, or create reusable GitHub Actions workflows for personal and organisation repositories. Use when a task mentions shared workflows, reusable workflows, `workflow_call`, cross-repository workflow `uses:`, or the personal workflows repository; do not use for repository-specific or proof-of-concept CI unless evaluating whether it should be shared.
---

# Shared Workflows

Prefer an existing production shared workflow over duplicating CI logic. Keep repository-specific workflows and proofs of concept in their consumer repository.

## Workflow

1. Establish ownership and scope.
   - Resolve the authenticated GitHub user and the active repository owner rather than assuming either from a local path.
   - For a repository owned by the authenticated user, use that user's shared-workflows repository. In this setup, the personal reference is `@workflows` (`timmo001/workflows`).
   - For an organisation repository, inspect and follow that organisation's shared-workflow repository and conventions. Never fall back to the personal repository automatically.
   - Follow repository-local instructions when they are stricter than this skill.
2. Search existing contracts first.
   - Inspect the shared repository's current reusable workflows and the active repository's existing callers.
   - Select by behaviour and prerequisites, not by filename alone.
   - Read the selected workflow at the exact ref the caller will use. Check `workflow_call` inputs, secrets, outputs, permissions, runner assumptions, expected files, package manager, artifacts, event context, and concurrency behaviour.
   - Treat shell-valued inputs as trusted configuration. Never populate them from pull request content or other untrusted data.
3. Configure the caller minimally.
   - Use reusable workflows only at the job level with `jobs.<job_id>.uses`.
   - Pin new or updated cross-repository calls to a full commit SHA and retain a short comment naming the tracked branch or release when the repository convention permits it.
   - Pass only non-default inputs that the consumer needs. Map required secrets explicitly and grant the narrowest caller permissions that satisfy the contract.
   - Preserve working historical SHA-pinned callers. If their workflow no longer exists on the shared repository's default branch, inspect the historical contract at that SHA, but do not copy it into new integrations without a separate decision to restore or replace it.
4. Create shared behaviour only when justified.
   - A candidate must be production behaviour with plausible reuse across repositories and a stable caller-facing contract. Otherwise keep it local.
   - Define the final interface before implementation: typed inputs and defaults, required secrets, outputs, permissions, supported events, artifacts, failure behaviour, and compatibility expectations.
   - For a missing personal workflow, recommend a separate numbered handoff named `handoff-{workflow-name}-01-create-shared-workflow.md`. Write directly to `@workflows` only when the user's requested scope explicitly includes that repository.
   - For a missing organisation workflow, use the organisation's planning and contribution process rather than creating a personal substitute.
5. Protect consumers when changing a contract.
   - Discover consumers across repositories owned by the relevant user or organisation; the local `dot` inventory is research context, not the boundary.
   - Classify changes to inputs, secrets, outputs, permissions, artifacts, prerequisites, defaults, and runtime behaviour as compatible or breaking.
   - For a breaking change, define migration order and update callers deliberately. Do not rely on a mutable branch to coordinate rollout.
   - Keep shared-workflow implementation, its validation, and directly required documentation together. Treat broad consumer migrations as separate reviewable stages when they can stand independently.

## Validation

Validate in dependency order:

1. Run the shared repository's formatting and workflow lint checks.
2. Validate the reusable workflow syntax and its declared contract.
3. Validate each changed caller against the pinned revision, including permissions and secret mappings.
4. Run the smallest representative caller workflow or repository check available.
5. For contract changes, confirm every discovered consumer is compatible, migrated, or explicitly deferred.

Report the selected shared contract and pinned SHA, caller changes, permissions and secrets required (names only), validation evidence, and any consumers or migrations left outstanding.
