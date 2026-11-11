import { expect, test } from "bun:test";
import { stowPlanNeedsApply } from "../../dot/src/lib/updateMaintenance.js";

test("a restow that puts every link back is not a change", () => {
  expect(
    stowPlanNeedsApply(`UNLINK: .local/bin/a
LINK: .local/bin/a => ../../../repo/pkg/.local/bin/a (reverts previous action)
WARNING: in simulation mode so not modifying filesystem.
`),
  ).toBe(false);

  expect(
    stowPlanNeedsApply(`UNLINK: .config
LINK: .config => ../repo/pkg/.config (reverts previous action)
WARNING: in simulation mode so not modifying filesystem.
`),
  ).toBe(false);
});

test("a removed file is unlinked and not put back", () => {
  expect(
    stowPlanNeedsApply(`UNLINK: .local/bin/a
UNLINK: .local/bin/b
LINK: .local/bin/a => ../../../repo/pkg/.local/bin/a (reverts previous action)
WARNING: in simulation mode so not modifying filesystem.
`),
  ).toBe(true);
});

test("a new file is a link that does not revert", () => {
  expect(
    stowPlanNeedsApply(`UNLINK: .local/bin/a
LINK: .local/bin/c => ../../../repo/pkg/.local/bin/c
LINK: .local/bin/a => ../../../repo/pkg/.local/bin/a (reverts previous action)
WARNING: in simulation mode so not modifying filesystem.
`),
  ).toBe(true);
});

test("moving a file unlinks the old path and links the new one", () => {
  expect(
    stowPlanNeedsApply(`UNLINK: .local/bin/a
MKDIR: .local/lib
LINK: .local/lib/a => ../../../repo/pkg/.local/lib/a
WARNING: in simulation mode so not modifying filesystem.
`),
  ).toBe(true);
});

test("unfolding a directory is a change even though its first link reverts", () => {
  expect(
    stowPlanNeedsApply(`LINK: .config => test/A/.config
UNLINK: .config (reverts previous action)
MKDIR: .config
LINK: .config/A.rc => ../test/A/.config/A.rc
`),
  ).toBe(true);
});

test("an empty plan and a plain stow with nothing to do are not changes", () => {
  expect(stowPlanNeedsApply("")).toBe(false);
  expect(
    stowPlanNeedsApply(
      "WARNING: in simulation mode so not modifying filesystem.\n",
    ),
  ).toBe(false);
});
