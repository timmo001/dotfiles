import { describe, expect, test } from "bun:test";
import {
  LaunchFloatingWebappError,
  calculateFloatingPosition,
  parseFloatingWebappArgs,
} from "../../src/commands/LaunchFloatingWebapp.js";

describe("floating webapp arguments", () => {
  test("preserves defaults and accepts an existing address", () => {
    expect(parseFloatingWebappArgs(["--address", "0xabc"])).toEqual({
      width: 380,
      height: 500,
      rightMargin: 16,
      bottomMargin: 6,
      address: "0xabc",
    });
  });

  test("accepts all geometry and target options", () => {
    expect(
      parseFloatingWebappArgs([
        "--monitor",
        "DP-2",
        "--workspace",
        "3",
        "--width",
        "420",
        "--height",
        "600",
        "--right-margin",
        "20",
        "--bottom-margin",
        "8",
        "https://example.com/page",
      ]),
    ).toEqual({
      monitor: "DP-2",
      workspace: "3",
      width: 420,
      height: 600,
      rightMargin: 20,
      bottomMargin: 8,
      url: "https://example.com/page",
    });
  });

  test("rejects invalid values and mutually exclusive targets", () => {
    expect(() => parseFloatingWebappArgs(["--width", "x", "url"])).toThrow(
      "WIDTH must be a non-negative integer",
    );
    expect(() => parseFloatingWebappArgs(["--width", "0", "url"])).toThrow(
      "width and height must be positive",
    );
    expect(() =>
      parseFloatingWebappArgs(["--address", "0xabc", "url"]),
    ).toThrow("mutually exclusive");
    expect(() => parseFloatingWebappArgs([])).toThrow(
      LaunchFloatingWebappError,
    );
  });
});

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
