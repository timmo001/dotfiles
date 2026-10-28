import {
  CandidatesRequest,
  ChannelRequest,
  MarkWatchedRequest,
  QueueAddRequest,
  RecheckRequest,
  resolveSocketPath,
  UpnextClient,
} from "@timmo001/effect-upnext";
import { Effect, Layer, Option, Path, Schema } from "effect";
import { type ClientNamespace, clientTools, pathExists } from "./tool";

const socketPath = resolveSocketPath(Option.none()).pipe(Effect.provide(Path.layer));

const tool = clientTools(Layer.unwrap(Effect.map(socketPath, UpnextClient.layer)));

const withUpnext = <A, E>(f: (client: UpnextClient["Service"]) => Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.service(UpnextClient), f);

/** The upnext daemon's watch feed through its socket. */
export const upnextNamespace: ClientNamespace = {
  kind: "client",
  command: "upnext",
  description:
    "The upnext watch feed through its daemon: what's live and new from followed Twitch and YouTube channels plus saved links, and the channels it follows.",
  available: socketPath.pipe(
    Effect.flatMap(pathExists),
    Effect.orElseSucceed(() => false),
  ),
  tools: [
    tool({
      name: "feed",
      description: "Read the feed: live streams first, then new uploads, then saved items, with each source's status.",
      access: "read",
      pinned: true,
      input: Schema.Struct({}),
      run: () => withUpnext((client) => client.GetFeed()),
    }),
    tool({
      name: "candidates",
      description: "List followed Twitch channels or YouTube subscriptions that aren't in the feed yet, by the name channel_add takes.",
      access: "read",
      input: CandidatesRequest,
      run: (input) => withUpnext((client) => client.ListCandidates(input)),
    }),
    tool({
      name: "recheck",
      description: "Check every source, or one, for new items now. With open, live channels set to auto-open are opened.",
      access: "write",
      timeout: "5 minutes",
      input: RecheckRequest,
      resource: (input) => (input.open ? "open" : "check"),
      summary: (input) => `recheck ${input.source ?? "every source"}${input.open ? " and open live channels" : ""}`,
      run: (input) => withUpnext((client) => client.Recheck(input)),
    }),
    tool({
      name: "queue_add",
      description: "Save a URL to watch later.",
      access: "write",
      input: QueueAddRequest,
      summary: (input) => `queue ${input.url}`,
      run: (input) => withUpnext((client) => client.QueueAdd(input)),
    }),
    tool({
      name: "mark_watched",
      description: "Hide YouTube uploads or remove saved items from the feed, by their ids.",
      access: "write",
      input: MarkWatchedRequest,
      summary: (input) => `mark watched ${input.ids.join(", ")}`,
      run: (input) => withUpnext((client) => client.MarkWatched(input)),
    }),
    tool({
      name: "channel_add",
      description:
        "Follow a Twitch login or YouTube channel ID, or change its auto-open and YouTube notification settings.",
      access: "write",
      input: ChannelRequest,
      resource: (input) => input.source,
      summary: (input) => `follow ${input.source} ${input.name}`,
      run: (input) => withUpnext((client) => client.AddChannel(input)),
    }),
    tool({
      name: "channel_remove",
      description: "Stop following a Twitch login or YouTube channel ID.",
      access: "write",
      input: Schema.Struct({ source: ChannelRequest.fields.source, name: Schema.String }),
      resource: (input) => input.source,
      summary: (input) => `unfollow ${input.source} ${input.name}`,
      run: (input) => withUpnext((client) => client.RemoveChannel(input)),
    }),
  ],
};
