import { describe, expect, test } from "bun:test";
import { calculateFloatingPosition } from "../../src/commands/LaunchFloatingWebapp.js";

describe("floating webapp geometry", () => {
  test("accounts for scale, monitor origin, and reserved edges", () => {
    expect(
      calculateFloatingPosition(
        {
          x: 3840,
          y: 120,
          width: 2560,
          height: 1440,
          scale: 2,
          reservedRight: 10,
          reservedBottom: 40,
        },
        { width: 380, height: 500, rightMargin: 16, bottomMargin: 6 },
      ),
    ).toEqual({ x: 2794, y: 234 });
  });

  test("matches the mocked integration geometry", () => {
    expect(
      calculateFloatingPosition(
        {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          scale: 1,
          reservedRight: 10,
          reservedBottom: 40,
        },
        { width: 380, height: 500, rightMargin: 16, bottomMargin: 6 },
      ),
    ).toEqual({ x: 1514, y: 534 });
  });
});
