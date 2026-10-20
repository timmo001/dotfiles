import { createElement, type IconNode } from "lucide";
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { UIElement } from "~/mixins/light-dom";

/** A lucide icon, passed as its node so only the icons in use are bundled. */
@customElement("ui-icon")
class Icon extends UIElement {
  @property({ attribute: false }) icon: IconNode | undefined;
  @property({ type: Number }) size = 16;

  render() {
    if (!this.icon) return html``;

    const element = createElement(this.icon);
    element.setAttribute("width", String(this.size));
    element.setAttribute("height", String(this.size));

    return element;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ui-icon": Icon;
  }
}
