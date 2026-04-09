---
allowed-tools: Fetch(*), Bash(gh:*), Bash(git:*), Read(*), Grep(*), Glob(*), LS(*)
description: Review a GitHub pull request and provide feedback comments
agent: code-reviewer
---

# Review GitHub Pull Request

Review the GitHub pull request: $ARGUMENTS.

Follow these steps:

1. Use 'gh pr view' to get the PR details and description.
2. Use 'gh pr diff' to see all the changes in the PR.
3. Use 'gh pr checks' to see the status of CI checks.
    - There may be warnings in the checks (linters etc.) which are not treated as errors. Provide recommendations for how to fix the warnings.
    - Do not use 'gh pr checks --watch' unless the user explicitly asks you to watch or wait for checks to complete.
4. Analyze the code changes for:
    - Code quality and style consistency
    - Potential bugs or issues
    - Performance implications
    - Missing type safety
    - Breaking changes (these need to be flagged as breaking changes in the PR template)
    - Security concerns
    - Test coverage
    - Documentation updates if needed
5. Ensure any existing review comments have been addressed.
6. Generate constructive review comments in the CONSOLE. DO NOT POST TO GITHUB YOURSELF.

IMPORTANT:

-   DO NOT make any changes to the code
-   Only provide review feedback
-   Be constructive and specific in your comments
-   Suggest improvements where appropriate
-   Keep feedback specific and evidence-based
-   Format your review as GitHub review comments that can be posted
-   If needed for a better review, checkout the PR locally using 'gh pr checkout'. When checked out locally, ensure the local checkout if up to date with the remote version.

Output format:

-   Provide an overview of the PR
-   List specific comments for each file/line that needs attention
-   Include positive feedback where appropriate
-   Summarize with an overall assessment (approve, request changes, or comment)
