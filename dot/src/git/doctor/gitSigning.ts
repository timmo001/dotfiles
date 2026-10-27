import { Api } from "@timmo001/effect-gh";
import { Effect, FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { Config } from "../../services/Config.js";
import { GitHub, viewerLogin } from "../services/GitHub.js";
import { gitOutput } from "../../lib/git.js";
import { resolvedOmarchyHost } from "../../lib/omarchyHost.js";
import { HOME_DIR, displayPath, expandHomePath } from "../../lib/paths.js";
import type { CheckResult } from "../../doctor/types.js";

/** The SSH key a host signs with when it has no signing config yet. */
const DEFAULT_SIGNING_KEY = "~/.ssh/id_ed25519.pub";

/** Read a global git config value, following includes; "" when unset. */
const globalConfig = (key: string) =>
  gitOutput(["config", "--global", "--includes", "--get", key], {
    cwd: HOME_DIR,
  }).pipe(
    Effect.map((value) => value.trim()),
    Effect.orElseSucceed(() => ""),
  );

/** The `<type> <blob>` part of an SSH public key line, without its comment. */
function keyIdentity(publicKey: string): string {
  return publicKey.trim().split(/\s+/).slice(0, 2).join(" ");
}

/** The authenticated user's SSH signing keys on GitHub. */
const githubSigningKeys = (login: string) =>
  Api.json(
    { endpoint: `users/${login}/ssh_signing_keys?per_page=100`, method: "GET" },
    Schema.Array(Schema.Struct({ key: Schema.String })),
  );

/** Where a public key stands for local verification and on GitHub. */
interface KeyStatus {
  /** The configured allowed signers file, or "" when unset. */
  readonly allowedSigners: string;
  /** Whether the allowed signers file lists the key; null when it can't be read. */
  readonly allowed: boolean | null;
  /** The GitHub login checked, or "" when gh is unavailable. */
  readonly login: string;
  /** Whether GitHub lists the key as a signing key; null when unknown. */
  readonly registered: boolean | null;
}

/** Look up a public key in the allowed signers file and GitHub's signing keys. */
const keyStatus = Effect.fn("GitSigning.keyStatus")(function* (
  publicKey: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const github = yield* GitHub;
  const identity = keyIdentity(publicKey);
  const allowedSigners = yield* globalConfig("gpg.ssh.allowedSignersFile");

  const allowedContent = allowedSigners
    ? yield* fs
        .readFileString(expandHomePath(allowedSigners))
        .pipe(Effect.orElseSucceed(() => null))
    : null;

  const login = yield* github
    .read("user", viewerLogin)
    .pipe(Effect.orElseSucceed(() => ""));

  const registered = login
    ? yield* github.read("ssh_signing_keys", githubSigningKeys(login)).pipe(
        Effect.map((keys) =>
          keys.some(({ key }) => keyIdentity(key) === identity),
        ),
        Effect.orElseSucceed(() => null),
      )
    : null;

  return {
    allowedSigners,
    allowed: allowedContent === null ? null : allowedContent.includes(identity),
    login,
    registered,
  } satisfies KeyStatus;
});

/** The command that registers a key file on GitHub as a signing key. */
function registerCommand(keyFile: string): string {
  return `gh auth refresh -h github.com -s admin:ssh_signing_key, then gh ssh-key add ${keyFile} --type signing --title "${hostname()}"`;
}

/** The allowed signers line for a public key. */
const allowedSignersLine = (publicKey: string) =>
  globalConfig("user.email").pipe(
    Effect.map(
      (email) =>
        `${email || "<email>"} namespaces="git" ${keyIdentity(publicKey)}`,
    ),
  );

/**
 * Walk a host with signing off through turning it on with its default SSH
 * key: register it on GitHub, list it in the allowed signers file, and add
 * the host's signing config to the private dotfiles.
 */
const signingOffSteps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;

  const publicKey = yield* fs
    .readFileString(expandHomePath(DEFAULT_SIGNING_KEY))
    .pipe(Effect.orElseSucceed(() => null));

  if (publicKey === null) {
    return {
      severity: "warn",
      message: `Commit signing is off and there is no SSH key at ${DEFAULT_SIGNING_KEY}`,
      detail: `Run: ssh-keygen -t ed25519 -N "" -f ${DEFAULT_SIGNING_KEY.replace(/\.pub$/, "")}, then dot doctor for the next steps`,
    } satisfies CheckResult;
  }

  const status = yield* keyStatus(publicKey);
  const host = (yield* resolvedOmarchyHost(config)) ?? "<host>";

  const privateRoot = config.privateDotfiles
    ? displayPath(config.privateDotfiles)
    : "the private dotfiles";

  const steps = [
    ...(status.registered === true
      ? []
      : [
          `Register the key on GitHub as a signing key: ${registerCommand(DEFAULT_SIGNING_KEY)}`,
        ]),
    ...(status.allowed === true
      ? []
      : [
          `Add to ${status.allowedSigners || "the allowed signers file"}: ${yield* allowedSignersLine(publicKey)}`,
        ]),
    `Add ${privateRoot}/git--${host}/.config/git/config.signing setting user.signingkey = ${DEFAULT_SIGNING_KEY}, commit.gpgsign = true and tag.gpgsign = true, then run dot stow`,
  ];

  return {
    severity: "warn",
    message: status.registered
      ? `Commit signing is off; ${DEFAULT_SIGNING_KEY} is already a GitHub signing key`
      : "Commit signing is off",
    detail: steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
  } satisfies CheckResult;
});

/**
 * Check that commits and tags are signed, and for SSH signing that the key
 * exists, verifies locally through the allowed signers file, and is
 * registered on GitHub as a signing key. With signing off, list the steps to
 * turn it on for this host.
 */
export const checkGitSigning = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const results: CheckResult[] = [];

  if ((yield* globalConfig("commit.gpgsign")) !== "true") {
    results.push(yield* signingOffSteps);

    return results;
  }

  results.push(
    (yield* globalConfig("tag.gpgsign")) === "true"
      ? { severity: "ok", message: "Commits and tags are signed" }
      : {
          severity: "warn",
          message: "Commits are signed but tags are not",
          detail: "Set tag.gpgsign = true",
        },
  );

  if ((yield* globalConfig("gpg.format")) !== "ssh") return results;

  const signingKey = yield* globalConfig("user.signingkey");

  if (!signingKey) {
    results.push({
      severity: "error",
      message: "SSH signing is on but user.signingkey is not set",
    });

    return results;
  }

  const literal = signingKey.startsWith("key::")
    ? signingKey.slice("key::".length)
    : signingKey.startsWith("ssh-")
      ? signingKey
      : null;

  const keyPath = literal === null ? expandHomePath(signingKey) : null;

  const publicKey =
    keyPath === null
      ? literal
      : yield* fs
          .readFileString(keyPath)
          .pipe(Effect.orElseSucceed(() => null));

  if (publicKey === null) {
    results.push({
      severity: "error",
      message: "SSH signing key not found, so commits will fail",
      detail: `Expected: ${keyPath ? displayPath(keyPath) : signingKey}`,
    });

    return results;
  }

  const status = yield* keyStatus(publicKey);

  results.push(
    status.allowed
      ? {
          severity: "ok",
          message: "Signing key is in the allowed signers file",
        }
      : {
          severity: "warn",
          message:
            status.allowed === false
              ? "Signing key is missing from the allowed signers file"
              : "No allowed signers file, so local verification shows no signature",
          detail: status.allowedSigners
            ? `Add to ${status.allowedSigners}: ${yield* allowedSignersLine(publicKey)}`
            : "Set gpg.ssh.allowedSignersFile",
        },
  );

  results.push(
    status.registered === null
      ? {
          severity: "warn",
          message: "Could not check GitHub signing keys",
        }
      : status.registered
        ? {
            severity: "ok",
            message: `Signing key is registered on GitHub (${status.login})`,
          }
        : {
            severity: "warn",
            message:
              "Signing key is not registered on GitHub, so commits show as unverified",
            detail: `Run: ${registerCommand(keyPath ? displayPath(keyPath) : "<key file>")}`,
          },
  );

  return results;
});
