import { describe, expect, test } from "bun:test";
import { uncommentLocaleExpr } from "../../src/lib/localeSetup.js";

describe("uncommentLocaleExpr", () => {
  test("escapes backslashes and dots throughout the locale name", () => {
    expect(uncommentLocaleExpr(String.raw`foo\bar.baz`)).toBe(
      String.raw`sed -i '/^#[[:space:]]*foo\\bar\.baz[[:space:]]/s/^#[[:space:]]*//' /etc/locale.gen`,
    );
  });
});
