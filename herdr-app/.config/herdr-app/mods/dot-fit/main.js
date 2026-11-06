// Fits the Herdr window to its width. Sits in a 0px block across the layout
// (main-fit's work column, terminals-compact's top bar), so it can see the
// window's width:
// - narrow (below NARROW_LAYOUT): switch to props().narrow, a tabs-on-top layout
// - wide again (WIDE_LAYOUT and up): switch back to props().wide
// - in a layout with a sidebar, fold it to its rail below FOLD and unfold it
//   from UNFOLD, unless it was folded by hand
// props().offset: what the layout's padding takes off the block's width.

import { View, div } from "gpui-kit";
import { layout, props, run, shared, setShared, window } from "herdr";

const NARROW_LAYOUT = 480;
const WIDE_LAYOUT = 520;
const FOLD = 760;
const UNFOLD = 820;

function find(node, id) {
  if (node?.id === id) return node;

  for (const child of node?.children ?? []) {
    const found = find(child, id);

    if (found) return found;
  }

  return null;
}

// True when the window just went below `edge`, or opened there.
const below = (width, before, edge) => width < edge && (before === null || before >= edge);

// True when the window just reached `edge`, or opened there.
const above = (width, before, edge) => width >= edge && (before === null || before < edge);

export default class Fit extends View {
  init() {
    this.width = null;
  }

  fit(blockWidth) {
    const sidebar = find(layout(), "sidebar");
    const shown = sidebar && !sidebar.hidden;
    const px = shown ? (sidebar.size?.px ?? 268) : 0;
    const width = blockWidth + (shown ? px + 1 : 0) + (props()?.offset ?? 0);
    const before = this.width;

    this.width = width;

    const { narrow, wide } = props() ?? {};

    if (narrow && below(width, before, NARROW_LAYOUT)) return run("layout.switch", { name: narrow });

    if (wide && above(width, before, WIDE_LAYOUT)) return run("layout.switch", { name: wide });

    if (!shown) return;

    // Unfolded by hand since: a later fold is the person's, not ours.
    if (px >= 160 && shared("dot.sidebar.folded")) setShared("dot.sidebar.folded", false);

    // Only act when the window crosses a threshold, so folding or unfolding
    // by hand at any size sticks.
    if (px >= 160 && below(width, before, FOLD)) {
      setShared("sidebar.width", px);
      setShared("sidebar.collapsed", true);
      setShared("dot.sidebar.folded", true);
      run("layout.resize", { id: "sidebar", px: window()?.platform === "macos" ? 76 : 44 });
    } else if (px < 160 && above(width, before, UNFOLD) && shared("dot.sidebar.folded")) {
      setShared("dot.sidebar.folded", false);
      setShared("sidebar.collapsed", false);
      run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 268 });
    }
  }

  render() {
    return div()
      .id("dot-fit")
      .size_full()
      .on_size_change((size) => this.fit(size.width));
  }
}
