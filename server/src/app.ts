import { Router } from "@lit-labs/router";
import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { UIElement } from "~/mixins/light-dom";
import "./styles/globals.css";

@customElement("app-root")
class App extends UIElement {
  private router = new Router(this, [
    {
      path: "/",
      render: () => html`<page-services></page-services>`,
      enter: async () => {
        await import("./pages/services");

        return true;
      },
    },
  ]);

  render() {
    return html`
      <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
        <header class="flex items-baseline justify-between">
          <h1 class="text-xl font-semibold">${location.hostname}</h1>
          <span class="text-muted-foreground text-sm">dot server</span>
        </header>
        <main>${this.router.outlet()}</main>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": App;
  }
}
