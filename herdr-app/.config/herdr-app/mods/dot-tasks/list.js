// A filtered list popup for the dot mods. Subclasses set `title`,
// `placeholder` and `empty`, fill `this.items` ({ id, label, detail? }) in
// `load()` and implement `pick(item)`. Type to filter, ↑/↓ and Enter to pick,
// Esc to leave. Mods can't import from another mod's folder, so dot-repos,
// dot-tasks and dot-plannotator each carry an identical copy of this file.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";

const ROWS = 10;
const ROW_HEIGHT = 32;

export class ListPicker extends View {
  init(_props, cx) {
    this.items = [];
    this.message = "Loading…";
    this.filter = "";
    this.at = 0;
    this.input = InputState.new({ placeholder: this.placeholder });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", () => this.choose(this.matches()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        await this.load();
        this.message = this.items.length ? null : this.empty;
      } catch (error) {
        this.message = String(error?.message ?? error);
      }

      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  choose(item) {
    if (!item) return;
    this.close();
    this.pick(item);
  }

  matches() {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);

    return this.items.filter((item) => {
      const text = `${item.label} ${item.detail ?? ""}`.toLowerCase();

      return words.every((word) => text.includes(word));
    });
  }

  render() {
    const t = theme();
    const matches = this.matches();
    this.at = Math.max(0, Math.min(this.at, matches.length - 1));
    const start = Math.max(0, Math.min(this.at - Math.floor(ROWS / 2), matches.length - ROWS));
    const shown = matches.slice(start, start + ROWS);

    const row = (item) =>
      h_flex()
        .id(`dot-${item.id}`)
        .mx(4)
        .px(10)
        .h(ROW_HEIGHT)
        .flex_none()
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(item === matches[this.at], (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.choose(item))
        .child(div().flex_none().text_color(t.foreground).child(item.label))
        .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(item.detail ?? ""));

    const body = this.message
      ? div().px(10).py(8).text_color(t.muted).child(this.message)
      : matches.length
        ? v_flex().h(shown.length * ROW_HEIGHT).flex_none().children(shown.map(row))
        : div().px(10).py(8).text_color(t.muted).child("Nothing matches");

    return v_flex()
      .id("dot-list")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;

        if (k === "escape") return this.close();

        if (!matches.length) return;

        if (k === "down") this.at = (this.at + 1) % matches.length;
        else if (k === "up") this.at = (this.at + matches.length - 1) % matches.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.title))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(body);
  }
}
