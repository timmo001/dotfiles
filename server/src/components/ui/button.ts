import { cva, type VariantProps } from "class-variance-authority";
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { UIElement } from "~/mixins/light-dom";

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90",
        outline:
          "border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

/** A button styled on its host element, so its children render as they are. */
@customElement("ui-button")
class Button extends UIElement {
  @property() variant: ButtonVariants["variant"] = "default";
  @property() size: ButtonVariants["size"] = "default";
  @property({ type: Boolean }) disabled = false;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "button");
    this.tabIndex = 0;
    this.addEventListener("click", this.#onClick, { capture: true });
    this.addEventListener("keydown", this.#onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("click", this.#onClick, { capture: true });
    this.removeEventListener("keydown", this.#onKeydown);
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed);

    // oxlint-disable-next-line wc/no-self-class
    this.setAttribute(
      "class",
      buttonVariants({ variant: this.variant, size: this.size }),
    );
    this.toggleAttribute("aria-disabled", this.disabled);
    this.style.pointerEvents = this.disabled ? "none" : "";
    this.style.opacity = this.disabled ? "0.5" : "";
  }

  render() {
    return html``;
  }

  #onClick = (event: MouseEvent) => {
    if (!this.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  #onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    this.click();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "ui-button": Button;
  }
}
