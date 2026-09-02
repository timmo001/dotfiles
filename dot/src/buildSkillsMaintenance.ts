import { Effect, Layer } from "effect";
import { buildSkillsMaintenance } from "./lib/skillsMaintenance.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { Config } from "./services/Config.js";

Effect.runPromise(
  buildSkillsMaintenance.pipe(
    Effect.provide(Layer.mergeAll(CommandExecutor.layer, Config.layer)),
  ),
).catch((error) => {
  console.error(error);
  process.exit(1);
});
