/**
 * The docs sites' infrastructure as an Alchemy stack: one Worker per distro
 * branch, picked by stage, serving what `blume build` leaves in `dist/`.
 * Deploy it with `mise run docs:deploy`, which builds the site first and
 * deploys the stage in `ALCHEMY_STAGE`, `prod` by default. A stage only
 * deploys from its own distro's branch, as set in `current-distro.ts`.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import { blumeWorker } from "@timmo001/docs-kit/blume/worker";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { currentDistro } from "./current-distro";

/** Each distro branch's stage, with its distro, Worker and domain. */
const workers: Record<
  string,
  { distro: string; name: string; domain: string }
> = {
  prod: {
    distro: "arch-omarchy-quattro",
    name: "dotfiles-docs",
    domain: "dotfiles.timmo.dev",
  },
  cloud: {
    distro: "cloud",
    name: "dotfiles-docs-cloud",
    domain: "cloud.dotfiles.timmo.dev",
  },
  "ubuntu-server": {
    distro: "ubuntu-server",
    name: "dotfiles-docs-ubuntu-server",
    domain: "ubuntu-server.dotfiles.timmo.dev",
  },
};

export default Alchemy.Stack(
  "dotfiles-docs",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    // Stops one distro's docs deploying over another's site
    const worker = Object.hasOwn(workers, stage) ? workers[stage] : undefined;
    if (worker?.distro !== currentDistro) {
      const expected = Object.keys(workers).find(
        (key) => workers[key].distro === currentDistro,
      );
      return yield* Effect.die(
        new Error(
          `This branch's docs are the ${currentDistro} distro, so deploy stage "${expected}", not "${stage}"`,
        ),
      );
    }

    const built = yield* Effect.promise(() =>
      blumeWorker(new URL("dist/", import.meta.url)),
    );

    // Blume only writes the flags and date from a root wrangler config, which
    // this site no longer has, so keep the Worker's nodejs_compat and
    // compatibility date here. Each Worker was deployed by Workers Builds
    // before this stack, so it's adopted rather than failing as someone else's
    const docs = yield* Cloudflare.Worker("Docs", {
      name: worker.name,
      domain: worker.domain,
      ...built,
      compatibility: {
        date: "2026-07-17",
        flags: [...built.compatibility.flags, "nodejs_compat"],
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    return { url: docs.url };
  }),
);
