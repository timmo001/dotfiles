import {
  BridgeClient,
  CreateEntityConfigRequest,
  EntityConfigRequest,
  HistoryRequest,
  LogbookRequest,
  LogRequest,
  LogSearchRequest,
  resolveSocketPath,
  SearchRequest,
  SystemLogRequest,
  TargetRequest,
  UpdateEntityConfigRequest,
  ValidateEntityConfigRequest,
} from "@timmo001/effect-ha-bridge";
import { Duration, Effect, Layer, Option, Path, Schema, Stream } from "effect";
import { type ClientNamespace, clientTools, pathExists } from "./tool";

const socketPath = resolveSocketPath(Option.none()).pipe(Effect.provide(Path.layer));

const tool = clientTools(Layer.unwrap(Effect.map(socketPath, BridgeClient.layer)));

const withBridge = <A, E>(f: (bridge: BridgeClient["Service"]) => Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.service(BridgeClient), f);

const Data = Schema.Record(Schema.String, Schema.Json);

const watchLimits = {
  count: Schema.optionalKey(Schema.Int).annotate({ description: "Stop after this many updates, 1 by default" }),
  seconds: Schema.optionalKey(Schema.Int).annotate({ description: "Stop after this many seconds, 60 by default" }),
};

/** Collect a stream's first items, stopping at a count or a deadline. */
const collect = <A, E>(
  stream: Stream.Stream<A, E>,
  limits: { readonly count?: number; readonly seconds?: number },
) =>
  stream.pipe(
    Stream.take(limits.count ?? 1),
    Stream.interruptWhen(Effect.sleep(Duration.seconds(limits.seconds ?? 60))),
    Stream.runCollect,
  );

/** Home Assistant through the ha-bridge socket. */
export const haBridgeNamespace: ClientNamespace = {
  kind: "client",
  command: "ha-bridge",
  description:
    "Home Assistant through the ha-bridge socket: read entities, history, logbook, logs and automation or script configs, render templates, test conditions, search, and call actions or fire events. Targets take entity_id, device_id, area_id, floor_id or label_id.",
  available: socketPath.pipe(
    Effect.flatMap(pathExists),
    Effect.orElseSucceed(() => false),
  ),
  tools: [
    tool({
      name: "get_entities",
      description: "Read the state, attributes and name of the entities a target matches, optionally in one domain.",
      access: "read",
      pinned: true,
      input: TargetRequest,
      run: (input) => withBridge((bridge) => bridge.GetEntities(input)),
    }),
    tool({
      name: "search",
      description: "Fuzzy-search entities, devices and areas by name, or list those a target matches.",
      access: "read",
      pinned: true,
      input: SearchRequest,
      run: (input) => withBridge((bridge) => bridge.Search(input)),
    }),
    tool({
      name: "get_config",
      description: "Read Home Assistant's core config: location, time zone, version and units.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => bridge.GetConfig()),
    }),
    tool({
      name: "render_template",
      description: "Render a Jinja template in Home Assistant.",
      access: "read",
      input: Schema.Struct({
        template: Schema.String,
        variables: Schema.optionalKey(Data),
        strict: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input) => withBridge((bridge) => bridge.RenderTemplate(input)),
    }),
    tool({
      name: "test_condition",
      description: "Check whether a condition, in automation YAML form as JSON, holds now.",
      access: "read",
      input: Schema.Struct({ condition: Data, variables: Schema.optionalKey(Data) }),
      run: (input) => withBridge((bridge) => bridge.TestCondition(input)),
    }),
    tool({
      name: "get_history",
      description: "Read the state history of a target's entities from an ISO start time.",
      access: "read",
      input: HistoryRequest,
      run: (input) => withBridge((bridge) => bridge.GetHistory(input)),
    }),
    tool({
      name: "get_logbook",
      description: "Read logbook entries from an ISO start time, for a target or everything.",
      access: "read",
      input: LogbookRequest,
      run: (input) => withBridge((bridge) => bridge.GetLogbook(input)),
    }),
    tool({
      name: "get_system_log",
      description: "Read Home Assistant's system log: grouped errors and warnings with their counts.",
      access: "read",
      pinned: true,
      input: SystemLogRequest,
      run: (input) => withBridge((bridge) => bridge.GetSystemLog(input)),
    }),
    tool({
      name: "get_log",
      description: "Read raw log lines from core, the supervisor, the host or an app, optionally filtered.",
      access: "read",
      input: LogRequest,
      run: (input) => withBridge((bridge) => bridge.GetLog(input)),
    }),
    tool({
      name: "search_logs",
      description: "Search the logs of core, the supervisor, apps and the system log's errors at once.",
      access: "read",
      input: LogSearchRequest,
      run: (input) => withBridge((bridge) => bridge.SearchLogs(input)),
    }),
    tool({
      name: "get_log_boots",
      description: "List the host boots that get_log's boot can select.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => bridge.GetLogBoots()),
    }),
    tool({
      name: "get_log_apps",
      description: "List the apps whose logs get_log can read.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => bridge.GetLogApps()),
    }),
    tool({
      name: "get_entity_config",
      description: "Read an automation's or script's config by its entity ID.",
      access: "read",
      input: EntityConfigRequest,
      run: (input) => withBridge((bridge) => bridge.GetEntityConfig(input)),
    }),
    tool({
      name: "validate_entity_config",
      description: "Check an automation or script config before saving it, listing errors and unknown references.",
      access: "read",
      input: ValidateEntityConfigRequest,
      run: (input) => withBridge((bridge) => bridge.ValidateEntityConfig(input)),
    }),
    tool({
      name: "watch_entities",
      description: "Wait for state changes of a target's entities, returning the first count of them.",
      access: "read",
      timeout: "1 hour",
      input: Schema.Struct({ ...TargetRequest.fields, ...watchLimits }),
      run: ({ count, seconds, ...request }) =>
        withBridge((bridge) => collect(bridge.WatchEntities(request), { count, seconds })),
    }),
    tool({
      name: "watch_events",
      description: "Wait for Home Assistant events, of one type or any, returning the first count of them.",
      access: "read",
      timeout: "1 hour",
      input: Schema.Struct({ event_type: Schema.optionalKey(Schema.String), ...watchLimits }),
      run: ({ count, seconds, ...request }) =>
        withBridge((bridge) => collect(bridge.WatchEvents(request), { count, seconds })),
    }),
    tool({
      name: "call_action",
      description: "Call a Home Assistant action, such as light.turn_on, on a target.",
      access: "write",
      input: Schema.Struct({
        action: Schema.String.annotate({ description: "domain.action, such as light.turn_on" }),
        target: Schema.optionalKey(TargetRequest.fields.target),
        data: Schema.optionalKey(Data),
        return_response: Schema.optionalKey(Schema.Boolean),
      }),
      resource: (input) => input.action,
      summary: (input) => `call ${input.action} ${JSON.stringify(input.target ?? {})} ${JSON.stringify(input.data ?? {})}`,
      run: (input) => withBridge((bridge) => bridge.CallAction(input)),
    }),
    tool({
      name: "fire_event",
      description: "Fire a Home Assistant event.",
      access: "write",
      input: Schema.Struct({ event_type: Schema.String, event_data: Schema.optionalKey(Data) }),
      resource: (input) => input.event_type,
      summary: (input) => `fire ${input.event_type} ${JSON.stringify(input.event_data ?? {})}`,
      run: (input) => withBridge((bridge) => bridge.FireEvent(input)),
    }),
    tool({
      name: "create_entity_config",
      description: "Create an automation or script. Validate it first with validate_entity_config.",
      access: "write",
      input: CreateEntityConfigRequest,
      resource: (input) => input.domain,
      summary: (input) => `create ${input.domain} ${input.id ?? ""}`.trim(),
      run: (input) => withBridge((bridge) => bridge.CreateEntityConfig(input)),
    }),
    tool({
      name: "update_entity_config",
      description: "Replace an automation's or script's config. Validate it first with validate_entity_config.",
      access: "write",
      input: UpdateEntityConfigRequest,
      resource: (input) => input.domain,
      summary: (input) => `update ${input.entity_id}`,
      run: (input) => withBridge((bridge) => bridge.UpdateEntityConfig(input)),
    }),
    tool({
      name: "delete_entity_config",
      description: "Delete an automation or script.",
      access: "write",
      input: EntityConfigRequest,
      resource: (input) => input.domain,
      summary: (input) => `delete ${input.entity_id}`,
      run: (input) => withBridge((bridge) => bridge.DeleteEntityConfig(input)),
    }),
  ],
};
