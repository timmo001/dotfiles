---
description: Check imported skills for upstream updates
---

Load `check-skill-updates`. Treat `${ARGUMENTS}` as an optional skill filter and any explicit instruction to apply updates.

Use the skill's separate workflows for installed copies and maintained imports. Report upstream changes and conflicts with local adaptations before applying updates that the user has not already requested. Edit maintained imports in the standalone skills checkout.

Report what changed and the validation result. Do not commit unless explicitly requested.
