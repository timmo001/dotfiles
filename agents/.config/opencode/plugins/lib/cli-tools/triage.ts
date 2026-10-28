import { TriageClient } from "@timmo001/effect-triage-client";
import { Config, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { type ClientNamespace, clientTools, runCliOutput } from "./tool";

const issue = Schema.String.annotate({
  description:
    "The issue's ID, or a link to its page in triage's web UI, such as https://triage.example.com/issues/0123456789abcdef",
});

const note = Schema.String.annotate({
  description:
    "In Markdown. Say what fixed it and where: the change, commit, package or version, and the hosts it's in place on, or why it's muted, so if it comes back on another host anyone can check whether that fix reached it or it's a different case",
});

const limit = (description: string) =>
  Schema.optionalKey(Schema.Int).annotate({ description });

/** An issue ID from an ID or a link to its page, as triage's MCP server reads it. */
const issueId = (input: string) => {
  const match = /\/issues\/([^/?#]+)/.exec(input.trim());

  return match?.[1] === undefined ? input.trim() : decodeURIComponent(match[1]);
};

/** `--name=value`, so a value starting with `-` isn't read as a flag. */
const option = (name: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [`--${name}=${value}`];

const statusCommand = { resolved: "resolve", muted: "mute", open: "reopen" } as const;

const layer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.String("TRIAGE_SERVER");
    const token = yield* Config.Redacted("TRIAGE_ADMIN_TOKEN");

    return TriageClient.layer({ url, token });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

const tool = clientTools(layer);

const withClient = <A, E>(f: (client: TriageClient["Service"]) => Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.service(TriageClient), f);

/**
 * The triage server's issues through its client, named like triage's MCP tools. Notes go
 * through the triage CLI, which redacts this machine's user and host names from them.
 */
export const triageNamespace: ClientNamespace = {
  kind: "client",
  command: "triage",
  description:
    "Crashes and errors triage collected from your machines, on the server in $TRIAGE_SERVER. Find issues with list_issues, read one with get_issue (an ID or a link to its page), page through its events with get_issue_events, and see how issues like it were fixed with find_similar_issues. Notes say why an issue was resolved or muted before and which host it regressed on. Once you've fixed an issue, ask the user before resolving it with set_issue_status, with a note on what fixed it and the hosts it's in place on, and before merging with merge_issues. The triage-resolve skill has the full steps.",
  available: Effect.sync(
    () => process.env.TRIAGE_SERVER !== undefined && process.env.TRIAGE_ADMIN_TOKEN !== undefined,
  ),
  tools: [
    tool({
      name: "list_issues",
      description:
        "Find triage issues, the latest seen first unless sorted otherwise, with their kind, state, counts and hosts. Every state is included unless state is set, so a resolved issue that came back shows up too. Page with offset until fewer than limit come back. Read one in full with get_issue.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        search: Schema.optionalKey(Schema.String).annotate({
          description: "Only issues whose title contains this, ignoring case",
        }),
        state: Schema.optionalKey(
          Schema.Array(Schema.Literals(["regressed", "new", "ongoing", "quiet", "resolved", "muted"])),
        ).annotate({ description: "Only issues in one of these states" }),
        kind: Schema.optionalKey(
          Schema.Array(Schema.Literals(["Crash", "UnitFailure", "OutOfMemory", "LogError"])),
        ).annotate({ description: "Only issues of one of these kinds" }),
        host: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Only issues that happened on one of these hosts",
        }),
        label: Schema.optionalKey(Schema.Array(Schema.Literals(["worth", "noise", "none"]))).annotate({
          description: "Only issues labelled worth fixing or noise, or none for those without a label",
        }),
        sort: Schema.optionalKey(
          Schema.Literals(["lastSeen", "firstSeen", "worth", "count", "title"]),
        ).annotate({ description: "What to sort by, lastSeen by default" }),
        order: Schema.optionalKey(Schema.Literals(["asc", "desc"])).annotate({
          description: "desc by default",
        }),
        offset: Schema.optionalKey(Schema.Int).annotate({ description: "How many issues to skip" }),
        limit: limit("The most issues to return, 20 by default"),
      }),
      run: (input) =>
        withClient((client) =>
          client.issues.list({ query: { limit: 20, ...input } }),
        ),
    }),
    tool({
      name: "get_issue",
      description:
        "Read a triage issue: its kind, state and counts, the hosts it happened on, what the decision models made of it, suggested fixes, its notes and status history, its fingerprints, its latest events, the warnings its program logged most on those hosts, and nearby issues on the same hosts within a minute, which often share a cause. The notes say why it was resolved or muted before and which host it regressed on, so read them before fixing it again. issue.count is how many events it has; read the rest with get_issue_events.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ issue }),
      run: (input) =>
        withClient((client) =>
          client.issues.get({ params: { id: issueId(input.issue) } }),
        ),
    }),
    tool({
      name: "get_issue_events",
      description:
        "Read a page of a triage issue's events, newest first, with the total. Page with offset until total is reached.",
      access: "read",
      input: Schema.Struct({
        issue,
        offset: Schema.optionalKey(Schema.Int).annotate({
          description: "How many of the newest events to skip",
        }),
        limit: limit("The most events to return, 100 by default and up to 500"),
      }),
      run: ({ issue, ...query }) =>
        withClient((client) =>
          client.issues.events({ params: { id: issueId(issue) }, query }),
        ),
    }),
    tool({
      name: "find_similar_issues",
      description:
        "Find issues like a triage issue, with the fixes suggested for each and their notes, to see what worked before: a crash of the same program with the same signal, the same unit failing, another error from the same program, or another OOM kill. Resolved issues come first.",
      access: "read",
      input: Schema.Struct({
        issue,
        limit: limit("The most issues to return, 10 by default and up to 50"),
      }),
      run: ({ issue, ...query }) =>
        withClient((client) =>
          client.issues.similar({ params: { id: issueId(issue) }, query }),
        ),
    }),
    tool({
      name: "set_issue_status",
      description:
        "Resolve, mute or reopen a triage issue, with a note on why. Resolve it once it's fixed on every host in get_issue's hosts, after asking the user: if it happens again it opens as regressed. Mute only noise that can't be fixed. Reopen a resolved or muted issue with open.",
      access: "write",
      input: Schema.Struct({
        issue,
        status: Schema.Literals(["resolved", "muted", "open"]).annotate({
          description: "resolved, muted, or open to reopen it",
        }),
        note: Schema.optionalKey(note),
      }),
      resource: (input) => `${input.status} ${issueId(input.issue)}`,
      summary: (input) => `triage ${statusCommand[input.status]} ${issueId(input.issue)}`,
      run: (input) =>
        runCliOutput("triage", [
          statusCommand[input.status],
          ...option("note", input.note),
          "--",
          issueId(input.issue),
        ]),
    }),
    tool({
      name: "add_issue_note",
      description:
        "Add a note to a triage issue without changing its status, such as what you found, a fix that's in progress, or which hosts have it so far.",
      access: "write",
      input: Schema.Struct({ issue, text: note }),
      summary: (input) => `triage note ${issueId(input.issue)}`,
      run: (input) => runCliOutput("triage", ["note", "--", issueId(input.issue), input.text]),
    }),
    tool({
      name: "label_issue",
      description:
        "Label a triage issue worth fixing or noise. Labels are what decision models are compared against.",
      access: "write",
      input: Schema.Struct({
        issue,
        label: Schema.Literals(["worth", "noise"]),
      }),
      summary: (input) => `triage label ${issueId(input.issue)} ${input.label}`,
      run: (input) =>
        withClient((client) =>
          client.issues.setLabel({ params: { id: issueId(input.issue) }, payload: { label: input.label } }),
        ),
    }),
    tool({
      name: "merge_issues",
      description:
        "Merge triage issues that are the same problem into the one seen first, such as a unit failure and the crash behind it. Only after asking the user, since a wrong merge mixes their events and statuses.",
      access: "write",
      input: Schema.Struct({
        issues: Schema.Array(issue).annotate({ description: "At least two issues to merge" }),
      }),
      resource: (input) => input.issues.map(issueId).join(" "),
      summary: (input) => `triage merge ${input.issues.map(issueId).join(" ")}`,
      run: (input) =>
        withClient((client) =>
          client.issues.merge({ payload: { ids: input.issues.map(issueId) } }),
        ),
    }),
  ],
};
