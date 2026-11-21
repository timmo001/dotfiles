/**
 * @file Podman's auto-update, shared by `dot up containers` and the `dot up`
 * check that offers it.
 */
import { Effect, Option, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** One container `podman auto-update --format json` reports on. */
const AutoUpdateReport = Schema.Struct({
  Unit: Schema.String,
  ContainerName: Schema.String,
  Image: Schema.String,
  /** `true`, `false`, `failed`, `rolled back`, or `pending` with `--dry-run`. */
  Updated: Schema.String,
});

/** One container `podman auto-update --format json` reports on. */
export interface AutoUpdateReport extends Schema.Schema.Type<
  typeof AutoUpdateReport
> {}

const decodeReports = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(AutoUpdateReport)),
);

/** Podman couldn't be run or its auto-update report didn't decode. */
export class PodmanError extends Schema.TaggedError<PodmanError>()(
  "PodmanError",
  { message: Schema.String },
) {}

/** Whether Podman is installed. */
export const hasPodman = Effect.sync(() => Bun.which("podman") !== null);

/** Run Podman and return its non-empty output lines. */
export const podmanLines = Effect.fn("Podman.lines")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  const output = yield* executor.run("podman", args).pipe(
    Effect.mapError(
      (error) =>
        new PodmanError({
          message: `podman ${args.join(" ")}: ${error.stderr.trim()}`,
        }),
    ),
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
});

/** The names of running containers marked `AutoUpdate=registry`. */
export const markedContainers = podmanLines([
  "ps",
  "--filter",
  "label=io.containers.autoupdate=registry",
  "--format",
  "{{.Names}}",
]);

/**
 * Run `podman auto-update`, or only check with `dryRun`. Podman prints its
 * report even when it exits non-zero for a unit that failed, so that report
 * still counts; with no report it fails with Podman's error.
 */
export const autoUpdate = Effect.fn("Podman.autoUpdate")(function* (
  dryRun: boolean,
) {
  const executor = yield* CommandExecutor;

  const args = [
    "auto-update",
    "--format",
    "json",
    ...(dryRun ? ["--dry-run"] : []),
  ];

  const output = yield* executor.run("podman", args).pipe(
    Effect.catchTag("CommandError", (error) =>
      error.stdout?.trim()
        ? Effect.succeed(error.stdout)
        : Effect.fail(
            new PodmanError({
              message: `podman ${args.join(" ")} exited ${error.exitCode}: ${error.stderr.trim()}`,
            }),
          ),
    ),
  );

  // With nothing to update Podman prints nothing at all.
  if (output.trim() === "") return [];

  const reports = decodeReports(output);

  if (Option.isNone(reports))
    return yield* new PodmanError({
      message: `podman ${args.join(" ")} printed a report that didn't decode`,
    });

  return reports.value;
});
