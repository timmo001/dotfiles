import { describe, expect, test } from "bun:test";
import { chooseElevationBinary } from "./elevatedCommand.js";

describe("chooseElevationBinary", () => {
  test("prefers pkexec in a graphical session", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: true,
        hasSudo: false,
        hasGraphicalSession: true,
      }),
    ).toBe("pkexec");
  });

  test("prefers pkexec over sudo in a graphical session", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: true,
        hasSudo: true,
        hasGraphicalSession: true,
      }),
    ).toBe("pkexec");
  });

  test("falls back to sudo without a graphical session", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: true,
        hasSudo: true,
        hasGraphicalSession: false,
      }),
    ).toBe("sudo");
  });

  test("uses sudo when pkexec is absent even in a graphical session", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: false,
        hasSudo: true,
        hasGraphicalSession: true,
      }),
    ).toBe("sudo");
  });

  test("uses pkexec as a last resort when sudo is absent", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: true,
        hasSudo: false,
        hasGraphicalSession: false,
      }),
    ).toBe("pkexec");
  });

  test("defaults to pkexec when neither binary is available", () => {
    expect(
      chooseElevationBinary({
        hasPkexec: false,
        hasSudo: false,
        hasGraphicalSession: false,
      }),
    ).toBe("pkexec");
  });
});
