import {
  type CliRenderer,
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type { Theme } from "../../theme.js";
import type { NoteCreateKind } from "../types.js";
import { StatusList, type StatusListItem } from "../../tui/StatusList.js";

/** Width of the create prompt box in characters. */
const PROMPT_WIDTH = 50;

/** Configuration for the create note template choice item. */
interface CreateTemplateItem {
  /** Display label for the template. */
  readonly label: string;
  /** Short description of the template. */
  readonly description: string;
  /** The note creation kind this template maps to. */
  readonly kind: NoteCreateKind;
}

/** Result of the create prompt: template kind plus user-provided metadata. */
export interface NoteCreatePromptResult {
  /** Selected template kind. */
  readonly kind: NoteCreateKind;
  /** User-entered note name/title. */
  readonly name: string;
  /** User-entered one-line description. */
  readonly description: string;
}

const ALL_TEMPLATES: readonly CreateTemplateItem[] = [
  {
    label: "Note",
    description: "General repository note with title and tags",
    kind: "note",
  },
  {
    label: "Handoff",
    description: "Implementation handoff with structured sections",
    kind: "handoff",
  },
];

/** Configuration callbacks for {@link NoteCreatePrompt}. */
export interface NoteCreatePromptOptions {
  /** Called when the user completes the create flow with kind, name, and description. */
  readonly onSubmit: (result: NoteCreatePromptResult) => void;
  /** Called when the prompt is dismissed without submission. */
  readonly onDismiss: () => void;
}

type PromptStage = "template" | "details";
type DetailsFocus = "name" | "description";

/**
 * Centred popup overlay for creating a new note.
 *
 * Stage 1: template selection (StatusList).
 * Stage 2: name and description input fields.
 */
export class NoteCreatePrompt {
  private renderer: CliRenderer;
  private theme: Theme;
  private root: BoxRenderable;
  private callbacks: NoteCreatePromptOptions;

  // Stage 1: template selection
  private templateTitle: TextRenderable;
  private templateList: StatusList<CreateTemplateItem>;
  private templateSep: TextRenderable;
  private templateHelp: TextRenderable;

  // Stage 2: details input
  private detailsTitle: TextRenderable;
  private nameLabel: TextRenderable;
  private nameInput: InputRenderable;
  private descLabel: TextRenderable;
  private descInput: InputRenderable;
  private detailsSep: TextRenderable;
  private detailsHelp: TextRenderable;

  private stage: PromptStage = "template";
  private detailsFocus: DetailsFocus = "name";
  private selectedKind: NoteCreateKind = "note";

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    options: NoteCreatePromptOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "note-create-prompt-root",
      position: "absolute",
      width: PROMPT_WIDTH,
      zIndex: 160,
      visible: false,
      borderStyle: "rounded",
      borderColor: theme.accent,
      backgroundColor: theme.bgElevated,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
    });

    // --- Stage 1: Template selection ---
    this.templateTitle = new TextRenderable(renderer, {
      id: "note-create-prompt-template-title",
      content: t`${bold(fg(theme.accent)("Create Note"))}`,
      marginBottom: 1,
    });
    this.root.add(this.templateTitle);

    this.templateList = new StatusList(renderer, {
      id: "note-create-prompt-template-list",
      theme,
      onSelect: (item) => this.advanceToDetails(item.value.kind),
    });
    this.root.add(this.templateList);

    this.templateSep = new TextRenderable(renderer, {
      id: "note-create-prompt-template-sep",
      content: t`${fg(theme.fgSubtle)("─".repeat(PROMPT_WIDTH - 4))}`,
      marginTop: 1,
    });
    this.root.add(this.templateSep);

    this.templateHelp = new TextRenderable(renderer, {
      id: "note-create-prompt-template-help",
      content: t`${dim("↑↓")} ${dim("navigate")}  ${dim("Enter")} ${dim("select")}  ${dim("Esc")} ${dim("cancel")}`,
    });
    this.root.add(this.templateHelp);

    // --- Stage 2: Details input ---
    this.detailsTitle = new TextRenderable(renderer, {
      id: "note-create-prompt-details-title",
      content: t`${bold(fg(theme.accent)("Note Details"))}`,
      marginBottom: 1,
      visible: false,
    });
    this.root.add(this.detailsTitle);

    this.nameLabel = new TextRenderable(renderer, {
      id: "note-create-prompt-name-label",
      content: t`${fg(theme.fgMuted)("Name:")}`,
      visible: false,
    });
    this.root.add(this.nameLabel);

    this.nameInput = new InputRenderable(renderer, {
      id: "note-create-prompt-name-input",
      width: "100%",
      placeholder: "Enter note name...",
      backgroundColor: theme.bgElevated,
      focusedBackgroundColor: theme.bgInput,
      textColor: theme.fg,
      cursorColor: theme.accent,
      visible: false,
    });
    this.root.add(this.nameInput);

    this.descLabel = new TextRenderable(renderer, {
      id: "note-create-prompt-desc-label",
      content: t`${fg(theme.fgMuted)("Description:")}`,
      marginTop: 1,
      visible: false,
    });
    this.root.add(this.descLabel);

    this.descInput = new InputRenderable(renderer, {
      id: "note-create-prompt-desc-input",
      width: "100%",
      placeholder: "One-line description (optional)...",
      backgroundColor: theme.bgElevated,
      focusedBackgroundColor: theme.bgInput,
      textColor: theme.fg,
      cursorColor: theme.accent,
      visible: false,
    });
    this.root.add(this.descInput);

    this.detailsSep = new TextRenderable(renderer, {
      id: "note-create-prompt-details-sep",
      content: t`${fg(theme.fgSubtle)("─".repeat(PROMPT_WIDTH - 4))}`,
      marginTop: 1,
      visible: false,
    });
    this.root.add(this.detailsSep);

    this.detailsHelp = new TextRenderable(renderer, {
      id: "note-create-prompt-details-help",
      content: t`${dim("Tab")} ${dim("next field")}  ${dim("Enter")} ${dim("create")}  ${dim("Esc")} ${dim("cancel")}`,
      visible: false,
    });
    this.root.add(this.detailsHelp);

    // Wire input Enter events
    this.nameInput.on(InputRenderableEvents.ENTER, () => {
      if (!this.root.visible || this.stage !== "details") return;
      if (this.nameInput.value.trim()) {
        this.setDetailsFocus("description");
      }
    });

    this.descInput.on(InputRenderableEvents.ENTER, () => {
      if (!this.root.visible || this.stage !== "details") return;
      this.submit();
    });

    renderer.root.add(this.root);
  }

  /** Whether the prompt is currently visible. */
  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Show the create prompt starting at the template selection stage.
   *
   * When a handoff filter is active, skips template selection and jumps
   * directly to the details stage with kind = "handoff".
   */
  show(preferHandoff: boolean): void {
    this.nameInput.value = "";
    this.descInput.value = "";

    if (preferHandoff) {
      this.selectedKind = "handoff";
      this.showDetailsStage();
    } else {
      this.showTemplateStage();
    }
  }

  /** Hide the prompt and release focus. */
  hide(): void {
    this.root.visible = false;
    this.templateList.setActive(false);
    this.nameInput.blur();
    this.descInput.blur();
  }

  /** Handle keyboard input when the prompt has focus. */
  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.hide();
      this.callbacks.onDismiss();
      return true;
    }

    if (this.stage === "details") {
      if (key.name === "tab") {
        this.setDetailsFocus(
          this.detailsFocus === "name" ? "description" : "name",
        );
        return true;
      }
      // Backspace on empty name goes back to template stage (unless handoff-only)
      if (
        key.name === "backspace" &&
        this.detailsFocus === "name" &&
        !this.nameInput.value
      ) {
        this.showTemplateStage();
        return true;
      }
    }

    if (this.stage === "template") {
      if (key.name === "backspace") {
        this.hide();
        this.callbacks.onDismiss();
        return true;
      }
    }

    return false;
  }

  /** Remove the prompt from the render tree. */
  destroy(): void {
    this.hide();
    this.renderer.root.remove(this.root);
  }

  private advanceToDetails(kind: NoteCreateKind): void {
    this.selectedKind = kind;
    this.showDetailsStage();
  }

  private showTemplateStage(): void {
    this.stage = "template";

    // Show template elements
    this.templateTitle.visible = true;
    this.templateList.visible = true;
    this.templateSep.visible = true;
    this.templateHelp.visible = true;

    // Hide details elements
    this.detailsTitle.visible = false;
    this.nameLabel.visible = false;
    this.nameInput.visible = false;
    this.descLabel.visible = false;
    this.descInput.visible = false;
    this.detailsSep.visible = false;
    this.detailsHelp.visible = false;
    this.nameInput.blur();
    this.descInput.blur();

    this.templateList.setItems(
      ALL_TEMPLATES.map((tpl): StatusListItem<CreateTemplateItem> => ({
        id: tpl.kind,
        title: tpl.label,
        description: tpl.description,
        color: this.theme.fg,
        value: tpl,
      })),
    );

    const itemLines = ALL_TEMPLATES.length * 2;
    const chromeLines = 7;
    const totalHeight = itemLines + chromeLines;
    this.positionRoot(totalHeight);
    this.root.visible = true;
    this.templateList.setActive(true);
  }

  private showDetailsStage(): void {
    this.stage = "details";

    // Hide template elements
    this.templateTitle.visible = false;
    this.templateList.visible = false;
    this.templateSep.visible = false;
    this.templateHelp.visible = false;
    this.templateList.setActive(false);

    // Show details elements
    const kindLabel = this.selectedKind === "handoff" ? "Handoff" : "Note";
    this.detailsTitle.content = t`${bold(fg(this.theme.accent)(`New ${kindLabel}`))}`;
    this.detailsTitle.visible = true;
    this.nameLabel.visible = true;
    this.nameInput.visible = true;
    this.descLabel.visible = true;
    this.descInput.visible = true;
    this.detailsSep.visible = true;
    this.detailsHelp.visible = true;

    // title(1) + titleMargin(1) + nameLabel(1) + nameInput(1) + descLabelMargin(1) + descLabel(1) + descInput(1) + sepMargin(1) + sep(1) + help(1) + border(2) = 12
    const totalHeight = 12;
    this.positionRoot(totalHeight);
    this.root.visible = true;
    this.setDetailsFocus("name");
  }

  private setDetailsFocus(field: DetailsFocus): void {
    this.detailsFocus = field;
    if (field === "name") {
      this.nameInput.focus();
      this.descInput.blur();
    } else {
      this.descInput.focus();
      this.nameInput.blur();
    }
  }

  private submit(): void {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.setDetailsFocus("name");
      return;
    }
    const description = this.descInput.value.trim();
    this.hide();
    this.callbacks.onSubmit({
      kind: this.selectedKind,
      name,
      description,
    });
  }

  private positionRoot(height: number): void {
    this.root.top = Math.max(
      1,
      Math.floor((this.renderer.height - height) / 2),
    );
    this.root.left = Math.max(
      1,
      Math.floor((this.renderer.width - PROMPT_WIDTH) / 2),
    );
    this.root.height = height;
  }
}
