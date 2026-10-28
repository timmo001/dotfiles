import { Schema } from "effect";
import { type CliTool, defineCliTool } from "./tool";

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

/** `--name=value`, so a value starting with `-` isn't read as a flag. */
const option = (name: string, value: string | number | undefined): readonly string[] =>
  value === undefined ? [] : [`--${name}=${value}`];

const options = (name: string, values: readonly string[] | undefined): readonly string[] =>
  (values ?? []).flatMap((value) => option(name, value));

const statusCommand = { resolved: "resolve", muted: "mute", open: "reopen" } as const;

/** triage CLI commands exposed as Code Mode tools, named like its MCP tools. */
export const triageTools: readonly CliTool[] = [
  defineCliTool({
    name: "list_issues",
    description:
      "Find triage issues, the latest seen first unless sorted otherwise, with their kind, state, counts and hosts. Every state is included unless state is set, so a resolved issue that came back shows up too. Page with offset until fewer than limit come back. Read one in full with get_issue.",
    access: "read",
    pinned: true,
    json: true,
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
    invocation: (input) => ({
      args: [
        "issues",
        "--server",
        "--json",
        ...option("search", input.search),
        ...options("state", input.state),
        ...options("kind", input.kind),
        ...options("host", input.host),
        ...options("label", input.label),
        ...option("sort", input.sort),
        ...option("order", input.order),
        ...option("offset", input.offset),
        ...option("limit", input.limit),
      ],
    }),
  }),
  defineCliTool({
    name: "get_issue",
    description:
      "Read a triage issue: its kind, state and counts, the hosts it happened on, what the decision models made of it, suggested fixes, its notes and status history, its fingerprints, its latest events, the warnings its program logged most on those hosts, and nearby issues on the same hosts within a minute, which often share a cause. The notes say why it was resolved or muted before and which host it regressed on, so read them before fixing it again. issue.count is how many events it has; read the rest with get_issue_events.",
    access: "read",
    pinned: true,
    json: true,
    input: Schema.Struct({ issue }),
    invocation: (input) => ({ args: ["issue", "--json", "--", input.issue] }),
  }),
  defineCliTool({
    name: "get_issue_events",
    description:
      "Read a page of a triage issue's events, newest first, with the total. Page with offset until total is reached.",
    access: "read",
    json: true,
    input: Schema.Struct({
      issue,
      offset: Schema.optionalKey(Schema.Int).annotate({
        description: "How many of the newest events to skip",
      }),
      limit: limit("The most events to return, 100 by default and up to 500"),
    }),
    invocation: (input) => ({
      args: [
        "events",
        "--json",
        ...option("offset", input.offset),
        ...option("limit", input.limit),
        "--",
        input.issue,
      ],
    }),
  }),
  defineCliTool({
    name: "find_similar_issues",
    description:
      "Find issues like a triage issue, with the fixes suggested for each and their notes, to see what worked before: a crash of the same program with the same signal, the same unit failing, another error from the same program, or another OOM kill. Resolved issues come first.",
    access: "read",
    json: true,
    input: Schema.Struct({
      issue,
      limit: limit("The most issues to return, 10 by default and up to 50"),
    }),
    invocation: (input) => ({
      args: ["similar", "--json", ...option("limit", input.limit), "--", input.issue],
    }),
  }),
  defineCliTool({
    name: "set_issue_status",
    description:
      "Resolve, mute or reopen a triage issue, with a note on why. Resolve it once it's fixed on every host in get_issue's hosts, after asking the user: if it happens again it opens as regressed. Mute only noise that can't be fixed. Reopen a resolved or muted issue with open.",
    access: "write",
    json: false,
    input: Schema.Struct({
      issue,
      status: Schema.Literals(["resolved", "muted", "open"]).annotate({
        description: "resolved, muted, or open to reopen it",
      }),
      note: Schema.optionalKey(note),
    }),
    invocation: (input) => ({
      args: [statusCommand[input.status], ...option("note", input.note), "--", input.issue],
    }),
  }),
  defineCliTool({
    name: "add_issue_note",
    description:
      "Add a note to a triage issue without changing its status, such as what you found, a fix that's in progress, or which hosts have it so far.",
    access: "write",
    json: false,
    input: Schema.Struct({ issue, text: note }),
    invocation: (input) => ({ args: ["note", "--", input.issue, input.text] }),
  }),
  defineCliTool({
    name: "label_issue",
    description:
      "Label a triage issue worth fixing or noise. Labels are what decision models are compared against.",
    access: "write",
    json: false,
    input: Schema.Struct({
      issue,
      label: Schema.Literals(["worth", "noise"]),
    }),
    invocation: (input) => ({ args: ["label", "--", input.issue, input.label] }),
  }),
  defineCliTool({
    name: "merge_issues",
    description:
      "Merge triage issues that are the same problem into the one seen first, such as a unit failure and the crash behind it. Only after asking the user, since a wrong merge mixes their events and statuses.",
    access: "write",
    json: false,
    input: Schema.Struct({
      issues: Schema.Array(issue).annotate({ description: "At least two issues to merge" }),
    }),
    invocation: (input) => ({ args: ["merge", "--", ...input.issues] }),
  }),
];
