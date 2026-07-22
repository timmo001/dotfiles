import { describe, expect, test } from "bun:test";
import { browserVideoFlagResults } from "../../../src/doctor/checks/hardwareVideo.js";

describe("browserVideoFlagResults", () => {
  test("accepts Chromium's default hardware video settings", () => {
    expect(
      browserVideoFlagResults(
        "chromium",
        "--ozone-platform=wayland\n--enable-features=TouchpadOverscrollHistoryNavigation\n",
      ),
    ).toEqual([
      {
        severity: "ok",
        message: "chromium-flags.conf has no harmful hardware video overrides",
      },
    ]);
  });

  test("ignores commented video flags", () => {
    expect(
      browserVideoFlagResults(
        "chromium",
        "# --enable-features=VaapiVideoDecodeLinuxGL\n",
      ),
    ).toEqual([
      {
        severity: "ok",
        message: "chromium-flags.conf has no harmful hardware video overrides",
      },
    ]);
  });

  test("warns about obsolete VAAPI feature overrides", () => {
    expect(
      browserVideoFlagResults(
        "chromium",
        "--enable-features=VaapiVideoDecodeLinuxGL,VaapiVideoEncoder\n",
      ),
    ).toEqual([
      {
        severity: "warn",
        message: "chromium-flags.conf has obsolete video feature overrides",
        detail: "VaapiVideoDecodeLinuxGL, VaapiVideoEncoder",
      },
    ]);
  });

  test("warns when accelerated video decode is disabled", () => {
    expect(
      browserVideoFlagResults(
        "chrome",
        "  --disable-features=Example, AcceleratedVideoDecoder, AcceleratedVideoDecodeLinuxGL\n",
      ),
    ).toEqual([
      {
        severity: "warn",
        message: "chrome-flags.conf disables hardware video acceleration",
        detail: "AcceleratedVideoDecoder, AcceleratedVideoDecodeLinuxGL",
      },
    ]);
  });

  test("warns when the GPU is disabled", () => {
    expect(browserVideoFlagResults("chromium", "--disable-gpu\n")).toEqual([
      {
        severity: "warn",
        message: "chromium-flags.conf disables hardware video acceleration",
        detail: "--disable-gpu",
      },
    ]);
  });

  test("warns when the GPU blocklist is bypassed", () => {
    expect(
      browserVideoFlagResults("chromium", "--ignore-gpu-blocklist\n"),
    ).toEqual([
      {
        severity: "warn",
        message: "chromium-flags.conf bypasses Chromium's GPU blocklist",
        detail:
          "Remove --ignore-gpu-blocklist unless it is needed for diagnosis",
      },
    ]);
  });
});
