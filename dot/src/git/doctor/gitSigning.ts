import { Api } from "@timmo001/effect-gh";
import { Effect, FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { GitHub, viewerLogin } from "../services/GitHub.js";
import { gitOutput } from "../../lib/git.js";
import { HOME_DIR, displayPath, expandHomePath } from "../../lib/paths.js";
import type { CheckResult } from "../../doctor/types.js";

/** Read a global git config value, following includes; "" when unset. */
const globalConfig = (key: string) =>
  gitOutput(["config", "--global", "--includes", "--get", key], {
    cwd: HOME_DIR,
  }).pipe(
    Effect.map((value) => value.trim()),
    Effect.orElseSucceed(() => ""),
  );

/** The base64 blob of an SSH public key line (`<type> <blob> [comment]`). */
function keyBlob(publicKey: string): string {
  return publicKey.trim().split(/\s+/)[1] ?? "";
}

/** The authenticated user's SSH signing keys on GitHub. */
const githubSigningKeys = (login: string) =>
  Api.json(
    { endpoint: `users/${login}/ssh_signing_keys?per_page=100`, method: "GET" },
    Schema.Array(Schema.Struct({ key: Schema.String })),
  );

/**
 * Check that commits and tags are signed, and for SSH signing that the key
 * exists, verifies locally through the allowed signers file, and is
 * registered on GitHub as a signing key.
 */
export const checkGitSigning = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const github = yield* GitHub;
  const results: CheckResult[] = [];

  const commitSign = yield* globalConfig("commit.gpgsign");
  const tagSign = yield* globalConfig("tag.gpgsign");

  if (commitSign !== "true") {
    results.push({
      severity: "warn",
      message: "Commit signing is off",
      detail:
        "Set user.signingkey, commit.gpgsign and tag.gpgsign in the managed git config",
    });

    return results;
  }

  results.push(
    tagSign === "true"
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

  const blob = keyBlob(publicKey);
  const allowedSigners = yield* globalConfig("gpg.ssh.allowedSignersFile");

  const allowedContent = allowedSigners
    ? yield* fs
        .readFileString(expandHomePath(allowedSigners))
        .pipe(Effect.orElseSucceed(() => null))
    : null;

  results.push(
    allowedContent?.includes(blob)
      ? {
          severity: "ok",
          message: "Signing key is in the allowed signers file",
        }
      : {
          severity: "warn",
          message: allowedContent
            ? "Signing key is missing from the allowed signers file"
            : "No allowed signers file, so local verification shows no signature",
          detail: allowedSigners
            ? `Add the key to ${allowedSigners}`
            : "Set gpg.ssh.allowedSignersFile",
        },
  );

  const login = yield* github
    .read("user", viewerLogin)
    .pipe(Effect.orElseSucceed(() => ""));

  const registered = login
    ? yield* github.read("ssh_signing_keys", githubSigningKeys(login)).pipe(
        Effect.map((keys) => keys.some(({ key }) => keyBlob(key) === blob)),
        Effect.orElseSucceed(() => null),
      )
    : null;

  results.push(
    registered === null
      ? {
          severity: "warn",
          message: "Could not check GitHub signing keys",
        }
      : registered
        ? {
            severity: "ok",
            message: `Signing key is registered on GitHub (${login})`,
          }
        : {
            severity: "warn",
            message:
              "Signing key is not registered on GitHub, so commits show as unverified",
            detail: `Run: gh auth refresh -h github.com -s admin:ssh_signing_key, then gh ssh-key add ${keyPath ? displayPath(keyPath) : "<key file>"} --type signing --title "${hostname()}"`,
          },
  );

  return results;
});
