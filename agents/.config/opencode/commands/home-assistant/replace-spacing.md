---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*)
description: Replace hardcoded spacing values with ha-space tokens from core.globals.ts
---

# Replace Spacing Values with Design Tokens

Replace hardcoded spacing values with ha-space-x tokens from src/resources/theme/core.globals.ts.

Target file: $ARGUMENTS (if no argument provided, use the current file in context)

Follow these steps:

1. Read the target file to understand the current spacing values
2. Identify CSS spacing properties with hardcoded pixel values (padding, margin, gap, etc.)
3. Replace values that exactly match ha-space tokens:
   - 0px → var(--ha-space-0)
   - 4px → var(--ha-space-1)
   - 8px → var(--ha-space-2)
   - 12px → var(--ha-space-3)
   - 16px → var(--ha-space-4)
   - 20px → var(--ha-space-5)
   - 24px → var(--ha-space-6)
   - 28px → var(--ha-space-7)
   - 32px → var(--ha-space-8)
   - 36px → var(--ha-space-9)
   - 40px → var(--ha-space-10)
   - 44px → var(--ha-space-11)
   - 48px → var(--ha-space-12)
   - (and so on up to --ha-space-20: 80px)
4. For negative values, ONLY use calc() if the positive version matches a token:
   - -8px → calc(var(--ha-space-2) * -1) (because 8px = --ha-space-2)
   - -16px → calc(var(--ha-space-4) * -1) (because 16px = --ha-space-4)
   - DO NOT replace -10px (because 10px has no token)
   - DO NOT replace -5px (because 5px has no token)
5. Only replace values in CSS properties, not in calculations or other contexts
6. Double check your work - only apply to CSS which exactly matches the token values

IMPORTANT:

- DO NOT replace values that don't exactly match a token
- DO NOT replace values in non-CSS contexts
- DO NOT replace border-width, line-height, or other non-spacing properties
- Only replace spacing properties: padding, margin, gap, top, left, right, bottom, inset, etc.
- Use calc(var(--ha-space-x) * -1) for negative values
- Show a summary of all replacements made
