---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(git:*), TodoRead(*), TodoWrite(*)
description: Migrate dialog(s) to ha-wa-dialog (path or name targets)
---

# Migrate Dialog to ha-wa-dialog

Please migrate the dialog(s): $ARGUMENTS

## Arguments and target resolution

`$ARGUMENTS` may contain one or more dialog targets (paths or names). Resolve each target before making changes.

Resolution rules:

- If a target contains `/` or ends with `.ts`, treat it as a path (absolute or repo-relative). Normalize to the repo root.
- Otherwise resolve as a dialog name by searching `src/**/dialog*.ts` and `src/**/hui-dialog*.ts`.
  - Prefer exact filename matches: `${name}.ts`, `dialog-${name}.ts`, `${name}-dialog.ts`, `hui-dialog-${name}.ts`.
  - If the name contains `-`, search for `@customElement("${name}")`.
  - If the name looks like a class (PascalCase), search for `class ${name}` in dialog files.
  - If the name does not include `dialog`, also try `dialog-${name}` and `${name}-dialog`.
- If exactly one file is found, use it.
- If multiple matches are found, list candidates and ask the user to pick; do not guess.
- If none are found, list near matches (partial filename matches) and ask for clarification.

When multiple targets resolve, migrate them in one run but keep changes grouped by file.

You are helping migrate a Home Assistant frontend dialog from any existing dialog implementation (ha-dialog, ha-md-dialog, or custom) to the new WebAwesome-based `ha-wa-dialog` component.

## Overview

The `ha-wa-dialog` is the new standard dialog component for Home Assistant. It replaces both `ha-dialog` (legacy Material Web Components) and `ha-md-dialog` (Material Design 3). Your task is to identify the current dialog implementation and migrate it to `ha-wa-dialog`.

## IMPORTANT: Interactive Migration Process

Before making ANY changes:

1. **Read and analyze the current dialog implementation**
2. **Identify:**
   - Current dialog type (ha-dialog, ha-md-dialog, custom, etc.)
   - Whether it already uses `ha-dialog-header` and/or `ha-dialog-footer`
   - Whether the header is simple (just close button + title) or complex (custom actions, subtitle, etc.)
   - Whether it has a footer with action buttons
   - Any special features or customizations

3. **Automatic decisions (no need to ask):**
   - If uses `ha-dialog-header` with ONLY navigationIcon (close) + title -> **REPLACE** with `header-title` attribute
   - If uses `ha-dialog-footer` -> keep it in `slot="footer"`
   - If header is simple (close button + title only) -> use `header-title` attribute
   - If header has title + subtitle -> use `header-title` and `header-subtitle` attributes
   - If subtitle is above title -> also add `header-subtitle-position="above"`
   - If has action items in header but otherwise standard -> use `header-title` + `slot="headerActionItems"`
   - If has custom navigation icon but otherwise standard -> use `header-title` + `slot="headerNavigationIcon"`
   - If using `createCloseHeading()` -> replace with `header-title` attribute

4. **Ask the user ONLY for truly complex cases:**
   - `ha-dialog-header` with subtitle + action items + custom navigation -> "This dialog has a complex ha-dialog-header with multiple features. Should I keep it in slot='header', or migrate to built-in attributes + slots?"
   - Completely custom header that doesn't match ha-dialog-header structure -> "This dialog has a fully custom header implementation. Should I migrate it to use ha-dialog-header in slot='header', or attempt to simplify?"
   - Non-standard footer layout or complex button arrangements -> "This dialog has a non-standard footer. Should I migrate it as-is, or standardize with ha-dialog-footer?"
   - Complex or unusual implementations -> "This implementation is complex with [features]. Shall I attempt migration, or leave it for manual review?"

5. **Key principle: Simplify by default**
   - Default to using built-in `header-title`, `header-subtitle` attributes
   - Only use `ha-dialog-header` in `slot="header"` when functionality exceeds built-in capabilities
   - The goal is to standardize and simplify, not preserve complexity

6. **NEVER modify ha-wa-dialog component itself** - only migrate the dialog usage
7. **Wait for user confirmation ONLY for complex/ambiguous cases**
8. **Keep comments to an absolute minimum** - do not add new comments to the code, and do not remove existing ones (unless removing the code they apply to)

## Step 1: Identify Current Dialog Type

Look for imports and usage of:
- `ha-dialog` (from `@material/mwc-dialog`)
- `ha-md-dialog` (from Material Web Components)
- Custom dialog implementations
- `createCloseHeading` helper function

## Step 2: Update Imports

**Add new import:**
```typescript
import "../../components/ha-wa-dialog";
```

**Add ha-dialog-footer if the dialog has action buttons:**
```typescript
import "../../components/ha-dialog-footer";
```

**Remove old imports:**
```typescript
// Remove ANY of these if present:
import "../../components/ha-dialog";
import "../../components/ha-md-dialog";
import { createCloseHeading } from "../../components/ha-dialog";
import type { HaMdDialog } from "../../components/ha-md-dialog";
import {
  getMobileOpenFromBottomAnimation,
  getMobileCloseToBottomAnimation,
} from "../../components/ha-md-dialog";
```

**Remove query decorators:**
```typescript
// Remove:
@query("ha-dialog") private _dialog?: HaDialog;
@query("ha-md-dialog") private _dialog?: HaMdDialog;
```

## Step 3: Update Dialog State Management

Replace any existing dialog state pattern with the ha-wa-dialog pattern:

```typescript
// Add this state if not present:
@state() private _open = false;

public async showDialog(dialogParams: MyDialogParams): Promise<void> {
  this._params = dialogParams;
  this._open = true;  // Open the dialog
}

public closeDialog(): void {
  this._open = false;  // This triggers the close animation
}

private _dialogClosed(): void {
  // Cleanup happens here after dialog animation completes
  this._params = undefined;
  fireEvent(this, "dialog-closed", { dialog: this.localName });
}
```

**If migrating from ha-md-dialog, replace:**
```typescript
// OLD (ha-md-dialog):
public closeDialog(): void {
  this._dialog?.close();
}

private _dialogClosed(): void {
  this._params = undefined;
  fireEvent(this, "dialog-closed", { dialog: this.localName });
}

// NEW (ha-wa-dialog):
public closeDialog(): void {
  this._open = false;
}

private _dialogClosed(): void {
  this._params = undefined;
  fireEvent(this, "dialog-closed", { dialog: this.localName });
}
```

## Step 4: Replace Dialog Template

Choose the appropriate pattern based on the dialog's functionality. Default to the simplest pattern that meets requirements.

### Basic Pattern (Header + Content Only, NO Footer)

```typescript
protected render() {
  if (!this._params) {
    return nothing;
  }

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      header-title=${this._params.title}
      @closed=${this._dialogClosed}
    >
      <!-- Content goes directly in default slot -->
      <p>Content here</p>
    </ha-wa-dialog>
  `;
}
```

### Pattern with Standard Footer (If dialog has action buttons)

```typescript
protected render() {
  if (!this._params) {
    return nothing;
  }

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      header-title=${this._params.title}
      @closed=${this._dialogClosed}
    >
      <p>Content here</p>

      <!-- Add footer if dialog has action buttons -->
      <ha-dialog-footer slot="footer">
        <ha-button
          slot="secondaryAction"
          appearance="plain"
          @click=${this.closeDialog}
        >
          ${this.hass.localize("ui.common.cancel")}
        </ha-button>
        <ha-button slot="primaryAction" @click=${this._save}>
          ${this.hass.localize("ui.common.save")}
        </ha-button>
      </ha-dialog-footer>
    </ha-wa-dialog>
  `;
}
```

### Pattern with Built-in Header Attributes

For most cases, use the built-in header attributes:

```typescript
protected render() {
  if (!this._params) {
    return nothing;
  }

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      header-title=${this._params.title}
      header-subtitle=${this._params.subtitle}
      header-subtitle-position="below"
      @closed=${this._dialogClosed}
    >
      <p>Content here</p>
    </ha-wa-dialog>
  `;
}
```

### Pattern with Header Slots (Without Full ha-dialog-header)

You can customize parts of the header using slots without reimplementing the whole header:

```typescript
<ha-wa-dialog
  .hass=${this.hass}
  .open=${this._open}
  header-title=${this._params.title}
  header-subtitle=${this._params.subtitle}
  @closed=${this._dialogClosed}
>
  <!-- Override just the navigation icon -->
  <ha-icon-button
    slot="headerNavigationIcon"
    data-dialog="close"
    .label=${this.hass.localize("ui.common.back")}
    .path=${mdiArrowLeft}
  ></ha-icon-button>

  <!-- Add action items to the header -->
  <ha-icon-button
    slot="headerActionItems"
    .label=${this.hass.localize("ui.common.help")}
    .path=${mdiHelp}
    @click=${this._showHelp}
  ></ha-icon-button>

  <p>Content here</p>
</ha-wa-dialog>
```

### Pattern with Full ha-dialog-header Override (RARE - Only for complex cases)

**Only use this when the header has functionality beyond what built-in attributes + slots provide.**

If the dialog has a truly complex header that cannot be replicated with `header-title`, `header-subtitle`, and header slots:

```typescript
protected render() {
  if (!this._params) {
    return nothing;
  }

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      @closed=${this._dialogClosed}
    >
      <!-- Full header override using slot="header" -->
      <ha-dialog-header slot="header">
        <ha-icon-button
          slot="navigationIcon"
          data-dialog="close"
          .label=${this.hass.localize("ui.common.close")}
          .path=${mdiClose}
        ></ha-icon-button>
        <span slot="title">${this._params.title}</span>
        <span slot="subtitle">${this._params.subtitle}</span>
      </ha-dialog-header>

      <p>Content here</p>
    </ha-wa-dialog>
  `;
}
```

### Common Migration Patterns

**FROM ha-dialog:**
```typescript
// OLD:
<ha-dialog
  open
  @closed=${this.closeDialog}
  .heading=${createCloseHeading(this.hass, this._params.title)}
>
  <p>Content</p>
  <ha-button slot="secondaryAction">Cancel</ha-button>
  <ha-button slot="primaryAction">Save</ha-button>
</ha-dialog>

// NEW:
<ha-wa-dialog
  .hass=${this.hass}
  .open=${this._open}
  header-title=${this._params.title}
  @closed=${this._dialogClosed}
>
  <p>Content</p>
  <ha-dialog-footer slot="footer">
    <ha-button slot="secondaryAction" appearance="plain">Cancel</ha-button>
    <ha-button slot="primaryAction">Save</ha-button>
  </ha-dialog-footer>
</ha-wa-dialog>
```

**FROM ha-md-dialog:**
```typescript
// OLD:
<ha-md-dialog
  open
  @closed=${this._dialogClosed}
  aria-labelledby="dialog-title"
  .getOpenAnimation=${getMobileOpenFromBottomAnimation}
  .getCloseAnimation=${getMobileCloseToBottomAnimation}
>
  <!-- Simple ha-dialog-header: only navigationIcon + title -->
  <ha-dialog-header slot="headline">
    <ha-icon-button
      slot="navigationIcon"
      @click=${this.closeDialog}
      .label=${this.hass.localize("ui.common.close")}
      .path=${mdiClose}
    ></ha-icon-button>
    <span slot="title" id="dialog-title">${this._params.title}</span>
  </ha-dialog-header>
  <div slot="content">
    <p>Content</p>
  </div>
  <div slot="actions">
    <ha-button appearance="plain">Cancel</ha-button>
    <ha-button>Save</ha-button>
  </div>
</ha-md-dialog>

// NEW: Simplified - ha-dialog-header replaced with header-title attribute
<ha-wa-dialog
  .hass=${this.hass}
  .open=${this._open}
  header-title=${this._params.title}
  @closed=${this._dialogClosed}
>
  <p>Content</p>
  <ha-dialog-footer slot="footer">
    <ha-button slot="secondaryAction" appearance="plain">Cancel</ha-button>
    <ha-button slot="primaryAction">Save</ha-button>
  </ha-dialog-footer>
</ha-wa-dialog>
```

## Step 5: Handle Focus

**Remove ALL old focus patterns:**
```typescript
// Remove ANY of these:
dialogInitialFocus  // Old attribute on form elements
.focus() calls on dialog elements
```

**Note:** `autofocus` on content elements is the NEW way to handle focus.

**Add autofocus to the element that should receive focus:**
```typescript
// On any focusable element:
<ha-textfield autofocus></ha-textfield>

// On components with delegatesFocus (like ha-form):
<ha-form autofocus .schema=${schema}></ha-form>
```

## Step 6: Update Dialog Width

Replace any width customization with the width attribute:

```typescript
// Remove CSS like:
ha-dialog {
  --mdc-dialog-min-width: 500px;
}
ha-md-dialog {
  min-width: 420px;
}

// Use width attribute instead:
<ha-wa-dialog width="small">   <!-- 320px -->
<ha-wa-dialog width="medium">  <!-- 580px (default) -->
<ha-wa-dialog width="large">   <!-- 720px -->
<ha-wa-dialog width="full">    <!-- Full width -->
```

## Step 7: Update Styling

Remove dialog-specific styling and use ha-wa-dialog CSS custom properties:

```typescript
static get styles(): CSSResultGroup {
  return [
    haStyle,
    haStyleDialog,
    css`
      ha-wa-dialog {
        /* Control content padding */
        --dialog-content-padding: 24px;

        /* Or remove padding for lists */
        --dialog-content-padding: 0;
      }

      .content {
        /* Style your content wrapper */
      }
    `,
  ];
}
```

**Remove mobile-specific media queries for dialog dimensions** - ha-wa-dialog handles responsive sizing automatically. Content-specific styling can remain.

## Step 8: Handle Special Cases

### Prevent Close on Backdrop Click
```typescript
<ha-wa-dialog prevent-scrim-close>
```

### Custom Header with Subtitle
```typescript
<ha-wa-dialog
  header-title="Main Title"
  header-subtitle="Subtitle text"
  header-subtitle-position="below"
>
```

### Custom Navigation Icon (e.g., Back Button)
```typescript
<ha-wa-dialog header-title="Title">
  <ha-icon-button
    slot="headerNavigationIcon"
    data-dialog="close"
    .label=${this.hass.localize("ui.common.back")}
    .path=${mdiArrowLeft}
  ></ha-icon-button>
  <!-- content -->
</ha-wa-dialog>
```

### Custom Header Action Items
```typescript
<ha-wa-dialog header-title="Title">
  <ha-icon-button
    slot="headerActionItems"
    .label=${this.hass.localize("ui.common.help")}
    .path=${mdiHelp}
    @click=${this._showHelp}
  ></ha-icon-button>
  <!-- content -->
</ha-wa-dialog>
```

### Flex Content Layout
```typescript
<ha-wa-dialog flexcontent>
  <!-- Content will be a flex column -->
</ha-wa-dialog>
```

### Declarative Close (Using data-dialog Attribute)
```typescript
<ha-button data-dialog="close">
  ${this.hass.localize("ui.common.cancel")}
</ha-button>
```

### No Footer Dialog
```typescript
<ha-wa-dialog header-title="Information">
  <p>Content only, no action buttons.</p>
</ha-wa-dialog>
```

## Key Differences Summary

### State Management
- **ha-dialog**: Controlled by presence of `_params`
- **ha-md-dialog**: Controlled by calling `.close()` method
- **ha-wa-dialog**: Controlled by `_open` boolean state

### Header Structure
- **ha-dialog**: `createCloseHeading()` helper or `.heading` property
- **ha-md-dialog**: `ha-dialog-header` in `slot="headline"`
- **ha-wa-dialog**: `header-title` attribute or `ha-dialog-header` in `slot="header"`

### Content Slot
- **ha-dialog**: Default slot or unnamed content
- **ha-md-dialog**: `slot="content"` required
- **ha-wa-dialog**: Default slot (no slot name needed)

### Footer/Actions
- **ha-dialog**: `slot="primaryAction"` and `slot="secondaryAction"` directly on buttons
- **ha-md-dialog**: `slot="actions"` wrapper with buttons inside
- **ha-wa-dialog**: `ha-dialog-footer` in `slot="footer"` with `slot="primaryAction"` and `slot="secondaryAction"` on buttons

### Width Control
- **ha-dialog**: CSS custom properties (`--mdc-dialog-min-width`)
- **ha-md-dialog**: CSS (`min-width`, `max-width`)
- **ha-wa-dialog**: `width` attribute ("small", "medium", "large", "full")

### Focus Management
- **ha-dialog**: `dialogInitialFocus` attribute
- **ha-md-dialog**: `dialogInitialFocus` attribute (removed)
- **ha-wa-dialog**: `autofocus` attribute on element

### Animation
- **ha-dialog**: Built-in (no control)
- **ha-md-dialog**: `getOpenAnimation`/`getCloseAnimation` props
- **ha-wa-dialog**: Automatic (no customization needed)

## Complete Migration Examples

### Example 1: Simple Confirmation Dialog

**Before (ha-dialog):**
```typescript
protected render() {
  if (!this._params) return nothing;

  return html`
    <ha-dialog
      open
      @closed=${this.closeDialog}
      .heading=${createCloseHeading(this.hass, "Confirm")}
    >
      <p>Are you sure?</p>
      <ha-button slot="secondaryAction" @click=${this.closeDialog}>
        No
      </ha-button>
      <ha-button slot="primaryAction" @click=${this._confirm}>
        Yes
      </ha-button>
    </ha-dialog>
  `;
}
```

**After (ha-wa-dialog):**
```typescript
protected render() {
  if (!this._params) return nothing;

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      header-title="Confirm"
      @closed=${this._dialogClosed}
    >
      <p>Are you sure?</p>
      <ha-dialog-footer slot="footer">
        <ha-button
          slot="secondaryAction"
          appearance="plain"
          @click=${this.closeDialog}
        >
          No
        </ha-button>
        <ha-button slot="primaryAction" @click=${this._confirm}>
          Yes
        </ha-button>
      </ha-dialog-footer>
    </ha-wa-dialog>
  `;
}
```

### Example 2: Form Dialog with ha-md-dialog

**Before (ha-md-dialog):**
```typescript
protected render() {
  if (!this._entry) return nothing;

  return html`
    <ha-md-dialog
      open
      @closed=${this._dialogClosed}
      .getOpenAnimation=${getMobileOpenFromBottomAnimation}
      .getCloseAnimation=${getMobileCloseToBottomAnimation}
    >
      <ha-dialog-header slot="headline">
        <ha-icon-button
          slot="navigationIcon"
          @click=${this.closeDialog}
          .path=${mdiClose}
        ></ha-icon-button>
        <span slot="title">Edit Settings</span>
      </ha-dialog-header>
      <div slot="content">
        <ha-form
          .hass=${this.hass}
          .data=${this._data}
          .schema=${this._schema}
          @value-changed=${this._valueChanged}
        ></ha-form>
      </div>
      <div slot="actions">
        <ha-button appearance="plain" @click=${this.closeDialog}>
          Cancel
        </ha-button>
        <ha-button @click=${this._save}>Save</ha-button>
      </div>
    </ha-md-dialog>
  `;
}
```

**After (ha-wa-dialog):**
```typescript
protected render() {
  if (!this._entry) return nothing;

  return html`
    <ha-wa-dialog
      .hass=${this.hass}
      .open=${this._open}
      header-title="Edit Settings"
      @closed=${this._dialogClosed}
    >
      <ha-form
        autofocus
        .hass=${this.hass}
        .data=${this._data}
        .schema=${this._schema}
        @value-changed=${this._valueChanged}
      ></ha-form>

      <ha-dialog-footer slot="footer">
        <ha-button
          slot="secondaryAction"
          appearance="plain"
          @click=${this.closeDialog}
        >
          ${this.hass.localize("ui.common.cancel")}
        </ha-button>
        <ha-button slot="primaryAction" @click=${this._save}>
          ${this.hass.localize("ui.common.save")}
        </ha-button>
      </ha-dialog-footer>
    </ha-wa-dialog>
  `;
}
```

## Testing Checklist

After migration, verify:
- [ ] Dialog opens and closes properly
- [ ] `_open` state is managed correctly (set to `true` in `showDialog`, `false` in `closeDialog`)
- [ ] `_dialogClosed` method is called and cleans up state
- [ ] Focus is set to correct element via `autofocus` attribute
- [ ] ESC key closes dialog (unless `prevent-scrim-close`)
- [ ] Clicking backdrop closes dialog (unless `prevent-scrim-close`)
- [ ] Dialog width is appropriate using `width` attribute
- [ ] Mobile view is full screen (automatic)
- [ ] Header displays correctly (title, close button)
- [ ] Footer buttons are properly aligned
- [ ] All button click handlers work
- [ ] Scrolling works for long content
- [ ] No console errors or warnings
- [ ] Remove unused imports from old dialog

## Migration Workflow

1. **Read the entire dialog file** - understand current implementation

2. **Analyze the dialog:**
   - Current dialog type (ha-dialog, ha-md-dialog, etc.)
   - Does it use `ha-dialog-header` with ONLY navigationIcon + title? -> **REPLACE** with `header-title` attribute
   - Does it use `ha-dialog-header` with subtitle/actionItems? -> Evaluate if it can be simplified to built-in attributes + slots
   - Does it use `ha-dialog-footer`? -> Keep it in `slot="footer"` automatically
   - Does it use `createCloseHeading()`? -> Replace with `header-title` attribute
   - Simple header (close + title only)? -> Use `header-title` attribute
   - Header with subtitle? -> Use `header-title`, `header-subtitle`, and `header-subtitle-position` attributes
   - Header with action items but otherwise standard? -> Use `header-title` + `slot="headerActionItems"` for actions
   - Custom navigation icon but otherwise standard? -> Use `header-title` + `slot="headerNavigationIcon"` for icon
   - Truly complex header that exceeds built-in capabilities? -> Ask user if it should keep `ha-dialog-header` in `slot="header"`
   - Non-standard footer? -> Ask user

3. **Report findings to user briefly:**
   - "Migrating from [dialog-type] to ha-wa-dialog"
   - "Replacing simple ha-dialog-header with header-title attribute" OR "Using header-title + subtitle attributes" OR "Evaluating complex header for simplification"
   - "Using ha-dialog-footer for action buttons" OR "No footer present"
   - Only mention complex cases that need user input

4. **For simple/standard cases:**
   - Proceed with migration automatically
   - No need to wait for approval if straightforward

5. **For complex cases ONLY:**
   - Describe the complexity
   - Ask for user preference
   - Wait for approval before proceeding

6. **Perform migration:**
   - Update imports (only add what's needed)
   - Add state management if needed
   - Update methods
   - Replace template (simplify ha-dialog-header to header-title when simple; keep ha-dialog-footer)
   - Update focus handling
   - Update width if needed
   - Clean up styles

7. **Test thoroughly** - verify all functionality works

8. **Remove unused code** - delete query decorators, unused imports, old helper functions

## CRITICAL: Do NOT

- Make changes to ha-wa-dialog component itself
- Keep `ha-dialog-header` when it only has navigationIcon + title (replace with `header-title` instead)
- Keep complexity for the sake of it - always simplify to built-in attributes when possible
- Remove `ha-dialog-footer` if already present (keep it)
- Replace truly complex headers without evaluating if simplification is possible
- Remove custom functionality without asking
- Ask for approval on straightforward migrations that follow standard patterns

## CRITICAL: DO

- Default to simplification - use `header-title`, `header-subtitle` attributes
- Replace simple `ha-dialog-header` (navigationIcon + title only) with `header-title`
- Use built-in attributes + slots before resorting to full `ha-dialog-header` override
- Keep `ha-dialog-footer` when present
- Standardize and simplify the implementation
- Keep code comments minimal - do not add new comments unless absolutely necessary

## Additional Notes

- ha-wa-dialog automatically handles mobile responsiveness (full screen on small devices)
- RTL (right-to-left) languages are automatically supported
- Safe area insets are automatically applied on mobile devices
- The close button is provided by default; override with `slot="headerNavigationIcon"` if needed
- Use `data-dialog="close"` on any element for declarative closing
- Components with `delegatesFocus: true` (like ha-form) will forward focus when using `autofocus`

Now, migrate the specified dialog file to ha-wa-dialog following these guidelines. Analyze the current implementation first, then apply the appropriate migration steps. This command is self-contained; do not do any web lookups or PR searches as part of the run.
