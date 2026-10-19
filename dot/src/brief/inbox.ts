import { Effect } from "effect";
import {
  readInboxThread,
  sendInboxMessage,
  waitForInboxReply,
  type InboxSession,
} from "../lib/inboxClient.js";

export {
  openInboxSession,
  type InboxMessage,
  type InboxQuestion,
  type InboxSession,
  type InboxThread,
} from "../lib/inboxClient.js";

/** Name of the Inbox thread every report joins. */
export const BRIEF_THREAD = "Daily brief";

/** Post a message to the brief's Inbox thread. */
export const sendBrief = (options: {
  readonly projectPath: string;
  readonly body: string;
  readonly idempotencyKey: string;
  readonly supersedes: readonly string[];
}) => sendInboxMessage({ ...options, thread: BRIEF_THREAD });

/** Answer one of the person's messages in the brief's thread. */
export const replyToBrief = (options: {
  readonly projectPath: string;
  readonly replyTo: string;
  readonly body: string;
}) =>
  sendInboxMessage({
    ...options,
    idempotencyKey: `brief-reply-${options.replyTo}`,
  }).pipe(Effect.asVoid);

/** Read a whole Inbox thread, every message with its questions and answers. */
export const readBriefThread = readInboxThread;

/** Hold until the person replies in the brief's thread, or about 50 seconds pass. */
export const waitForBriefReply = (
  session: InboxSession,
  options: {
    readonly projectPath: string;
    readonly threadId: string;
    readonly cursor: number | undefined;
  },
) => waitForInboxReply(session, options);
