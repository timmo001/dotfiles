import { LitElement } from "lit";

/**
 * Base class for components styled with the global Tailwind stylesheet.
 * Renders into the light DOM so the global styles apply.
 */
export class UIElement extends LitElement {
  protected createRenderRoot() {
    return this;
  }
}
