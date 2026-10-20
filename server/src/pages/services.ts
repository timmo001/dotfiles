import type { ServiceHealth, ServiceStatus } from "@dot/server-api";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Logs,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  type IconNode,
} from "lucide";
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { AtomController } from "~/controllers/atom-controller";
import { journal, registry, serviceAction, services } from "~/lib/atoms";
import { cn, formatTime } from "~/lib/utils";
import { UIElement } from "~/mixins/light-dom";
import "../components/ui/button";
import "../components/ui/icon";

const HEALTH_CLASS: Record<ServiceHealth, string> = {
  failed: "bg-destructive/20 text-destructive",
  missing: "bg-destructive/20 text-destructive",
  inactive: "bg-muted text-muted-foreground",
  stale: "bg-warn/20 text-warn",
  degraded: "bg-warn/20 text-warn",
  warning: "bg-warn/20 text-warn",
  running: "bg-info/20 text-info",
  ok: "bg-ok/20 text-ok",
};

/** The failure in a result, as a message for the page. */
function failureMessage<A, E extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<A, E>,
): string | undefined {
  if (!AsyncResult.isFailure(result)) return undefined;

  return Option.match(AsyncResult.error(result), {
    onSome: (error) => error.message,
    onNone: () => Cause.pretty(result.cause),
  });
}

const icon = (node: IconNode) => html`<ui-icon .icon=${node}></ui-icon>`;

/** One registered service: its health, schedule and controls, with its journal on demand. */
@customElement("service-row")
class ServiceRow extends UIElement {
  @property({ attribute: false }) status!: ServiceStatus;
  @state() private showLogs = false;

  private action = new AtomController(this, () =>
    serviceAction(this.status.unit),
  );

  private logs = new AtomController(this, () => journal(this.status.unit));

  private run(action: "start" | "stop") {
    registry.set(serviceAction(this.status.unit), action);
  }

  private renderLogs() {
    if (!this.showLogs) return nothing;

    const result = this.logs.value;
    const error = failureMessage(result);

    const text = Option.match(AsyncResult.value(result), {
      onSome: (journal) => journal.text || "(no journal output)",
      onNone: () => (error ? "" : "Loading…"),
    });

    return html`
      <div class="col-span-full">
        ${
          error
            ? html`<p class="text-destructive text-sm">${error}</p>`
            : nothing
        }
        <pre
          class="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap"
        >
${text}</pre>
      </div>
    `;
  }

  render() {
    const status = this.status;
    const action = this.action.value;
    const busy = action.waiting;
    const error = failureMessage(action);

    const schedule = [
      status.lastRun ? `Last run ${formatTime(status.lastRun)}` : undefined,
      status.nextRun ? `next ${formatTime(status.nextRun)}` : status.nextNote,
    ]
      .filter(Boolean)
      .join(" · ");

    return html`
      <div
        class="grid grid-cols-[6rem_1fr_auto] items-start gap-x-4 gap-y-2 border-b py-3 last:border-b-0"
      >
        <span
          class=${cn(
            "rounded-md px-2 py-0.5 text-center text-xs font-medium uppercase",
            HEALTH_CLASS[status.health],
          )}
          >${status.health}</span
        >
        <div class="min-w-0">
          <div class="font-medium">${status.label}</div>
          <div class="text-muted-foreground text-xs">
            ${status.unit} · ${status.activeState}
          </div>
          <div class="text-sm">${status.summary}</div>
          ${
            schedule
              ? html`<div class="text-muted-foreground text-xs">
                  ${schedule}
                </div>`
              : nothing
          }
          ${
            error
              ? html`<div class="text-destructive text-xs">${error}</div>`
              : nothing
          }
        </div>
        <div class="flex gap-1">
          <ui-button
            size="sm"
            variant="outline"
            ?disabled=${busy}
            @click=${() => this.run("start")}
          >
            ${icon(status.kind === "service" ? RotateCcw : Play)}
            ${status.kind === "service" ? "Restart" : "Run"}
          </ui-button>
          <ui-button
            size="sm"
            variant="outline"
            ?disabled=${busy}
            @click=${() => this.run("stop")}
          >
            ${icon(Square)} Stop
          </ui-button>
          <ui-button
            size="sm"
            variant=${this.showLogs ? "default" : "ghost"}
            @click=${() => {
              this.showLogs = !this.showLogs;

              if (this.showLogs) registry.refresh(journal(status.unit));
            }}
          >
            ${icon(Logs)} Logs
          </ui-button>
        </div>
        ${this.renderLogs()}
      </div>
    `;
  }
}

/** Registered user services from `dot services status`. */
@customElement("page-services")
class PageServices extends UIElement {
  private services = new AtomController(this, () => services);

  render() {
    const result = this.services.value;
    const error = failureMessage(result);
    const snapshot = Option.getOrUndefined(AsyncResult.value(result));

    return html`
      <section class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Services</h2>
          <ui-button
            size="sm"
            variant="ghost"
            ?disabled=${result.waiting}
            @click=${() => registry.refresh(services)}
          >
            ${icon(RefreshCw)} Refresh
          </ui-button>
        </div>
        ${
          error
            ? html`<p class="text-destructive text-sm">${error}</p>`
            : nothing
        }
        ${snapshot?.errors.map(
          (invalid) =>
            html`<p class="text-warn text-sm">
              ${invalid.file}: ${invalid.message}
            </p>`,
        )}
        ${
          snapshot === undefined
            ? error
              ? nothing
              : html`<p class="text-muted-foreground">Loading…</p>`
            : snapshot.services.length === 0
              ? html`<p class="text-muted-foreground">
                  No services registered in ${snapshot.directory}
                </p>`
              : html`<div class="bg-card rounded-lg border px-4">
                  ${snapshot.services.map(
                    (status) =>
                      html`<service-row .status=${status}></service-row>`,
                  )}
                </div>`
        }
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "service-row": ServiceRow;
    "page-services": PageServices;
  }
}
