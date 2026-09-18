import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem } from "effect";
import { DependencyConfigError } from "./deps/config.js";
import {
  dependencyPolicySchemaFile,
  renderDependencySchema,
} from "./deps/policyFile.js";

Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = `../${dependencyPolicySchemaFile}`;
  const schema = renderDependencySchema();

  if (process.argv.includes("--check")) {
    if (
      !(yield* fs.exists(path)) ||
      (yield* fs.readFileString(path)) !== schema
    )
      return yield* new DependencyConfigError({
        message:
          "Dependency editor schema is stale; run mise run dot:deps:schema",
      });
    yield* Console.log("Dependency editor schema is current");
  } else yield* fs.writeFileString(path, schema);
}).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
