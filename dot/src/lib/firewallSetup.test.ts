import { describe, expect, test } from "bun:test";
import { firewallSetupScript } from "./firewallSetup.js";

describe("firewallSetupScript", () => {
  test("batches ufw commands into one shell script", () => {
    expect(
      firewallSetupScript([
        ["allow", "8123/tcp", "comment", "Home Assistant"],
        ["reload"],
      ]),
    ).toBe("set -e\nufw allow 8123/tcp comment 'Home Assistant'\nufw reload");
  });

  test("quotes shell-sensitive arguments", () => {
    expect(
      firewallSetupScript([["allow", "4096/tcp", "comment", "Bob's app"]]),
    ).toBe("set -e\nufw allow 4096/tcp comment 'Bob'\"'\"'s app'");
  });
});
