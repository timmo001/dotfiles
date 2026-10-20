/** Styles of the report page, themed for light and dark. */
export const PAGE_CSS = `
:root {
  --bg: #f6f8fa; --surface: #ffffff; --fg: #16212b; --muted: #5a6b7a; --line: #dbe3ea;
  --accent: #0288c7; --good: #2b8a5e; --warn: #c98a12; --bad: #c4553b; --neutral: #7a8a99;
  --chip: #eef3f7;
  --font-body: "Public Sans", "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f161c; --surface: #172129; --fg: #e3ebf1; --muted: #93a4b2; --line: #2a3742;
    --accent: #4cbcf0; --good: #4fbf8a; --warn: #e2ac43; --bad: #e9805f; --neutral: #8fa0ae;
    --chip: #1f2c36; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f161c; --surface: #172129; --fg: #e3ebf1; --muted: #93a4b2; --line: #2a3742;
  --accent: #4cbcf0; --good: #4fbf8a; --warn: #e2ac43; --bad: #e9805f; --neutral: #8fa0ae;
  --chip: #1f2c36; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 15px; line-height: 1.55; }
.wrap { max-width: 960px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 40px 64px; display: flex; flex-direction: column; gap: 44px; }
h1, h2, h3 { margin: 0; line-height: 1.2; text-wrap: balance; }
h1 { font-size: 2rem; letter-spacing: -0.01em; }
h2 { font-size: 1.3rem; }
h3 { font-size: 1.02rem; }
p { margin: 0; max-width: 68ch; }
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
code, .mono { font-family: var(--font-mono); font-size: 0.86em; }
section, header { display: flex; flex-direction: column; gap: 14px; }
.lede, .muted { color: var(--muted); }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: 0.88rem; }
.summary { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; }
.meter { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--line); }
.meter span, .mini span { display: block; height: 100%; }
.mini { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--line); min-width: 120px; }
.tone-good { background: var(--good); } .tone-warn { background: var(--warn); } .tone-bad { background: var(--bad); } .tone-neutral { background: var(--neutral); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.stat b { font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 0.85rem; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.delta { font-size: 0.8rem; font-variant-numeric: tabular-nums; color: var(--muted); }
.scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 8px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
th { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cards { display: flex; flex-direction: column; gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.card a.title { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.pill { font-size: 0.74rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--chip); color: var(--muted); white-space: nowrap; }
.pill.good { color: var(--good); } .pill.warn { color: var(--warn); } .pill.bad { color: var(--bad); } .pill.accent { color: var(--accent); }
td .pill { display: inline-block; margin: 0 4px 4px 0; }
tfoot th { border-top: 2px solid var(--line); border-bottom: none; color: var(--fg); }
.steps { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 14px; }
.steps p { margin: 4px 0 6px; color: var(--muted); }
.steps div { display: flex; flex-wrap: wrap; gap: 6px; }
code { font-family: var(--font-mono); font-size: 0.85em; background: var(--chip); padding: 1px 5px; border-radius: 5px; }
.changes { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.changes ul { margin: 4px 0 0; padding-left: 18px; color: var(--muted); font-size: 0.9rem; }
details.group { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
details.group > summary { cursor: pointer; padding: 10px 16px; display: flex; gap: 12px; align-items: baseline; list-style: none; }
details.group > summary::-webkit-details-marker { display: none; }
details.group > summary::before { content: "▸"; color: var(--muted); font-size: 0.8rem; }
details.group[open] > summary::before { content: "▾"; }
summary .name { font-weight: 600; flex: 1; min-width: 0; }
summary .count { color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
.files { list-style: none; margin: 0; padding: 0 16px 10px; display: flex; flex-direction: column; }
.files li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; padding: 5px 0; border-top: 1px solid var(--line); }
.files a { font-family: var(--font-mono); font-size: 0.8rem; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; min-width: 0; }
.files a:hover { color: var(--accent); text-decoration: underline; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.controls input[type="search"] { flex: 1 1 220px; min-width: 0; font: inherit; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); }
.toggle { font: inherit; font-size: 0.85rem; padding: 5px 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
.toggle[aria-pressed="true"] { background: var(--chip); color: var(--fg); border-color: var(--accent); }
.ledger { display: flex; flex-direction: column; gap: 8px; }
.note { font-size: 0.86rem; color: var(--muted); border-left: 3px solid var(--line); padding-left: 12px; }
`;

/** File-list filtering for every code section, reading its embedded JSON. */
export const PAGE_SCRIPT = `
document.querySelectorAll("[data-ledger]").forEach((root) => {
  const data = JSON.parse(document.getElementById(root.dataset.ledger).textContent);
  const state = { q: "", buckets: new Set(), pr: false, hideAllowed: false };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const list = root.querySelector(".ledger");
  const count = root.querySelector(".result-count");
  root.querySelector("input[type=search]").addEventListener("input", (event) => { state.q = event.target.value.trim().toLowerCase(); render(); });
  root.querySelectorAll("[data-bucket]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.bucket;
    state.buckets.has(id) ? state.buckets.delete(id) : state.buckets.add(id);
    button.setAttribute("aria-pressed", String(state.buckets.has(id)));
    render();
  }));
  root.querySelectorAll("[data-flag]").forEach((button) => button.addEventListener("click", () => {
    state[button.dataset.flag] = !state[button.dataset.flag];
    button.setAttribute("aria-pressed", String(state[button.dataset.flag]));
    render();
  }));
  function render() {
    const shown = data.files.filter((f) =>
      (!state.q || f.p.toLowerCase().includes(state.q)) &&
      (state.buckets.size === 0 || state.buckets.has(f.b)) &&
      (!state.pr || f.pr.length > 0) &&
      (!state.hideAllowed || !f.a));
    count.textContent = shown.length + " of " + data.files.length + " files";
    const groups = new Map();
    for (const f of shown) { if (!groups.has(f.g)) groups.set(f.g, []); groups.get(f.g).push(f); }
    const open = shown.length <= 60;
    list.innerHTML = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, files]) =>
      '<details class="group"' + (open ? " open" : "") + '><summary><span class="name">' + esc(name) + '</span><span class="count">' + files.length + ' files</span></summary><ul class="files">' +
      files.map((f) => '<li><a href="' + data.base + esc(f.p) + '">' + esc(f.p) + '</a>' +
        '<span class="pill ' + data.tones[f.b] + '">' + esc(data.labels[f.b]) + '</span>' +
        f.pr.map((n) => '<span class="pill accent">#' + n + '</span>').join("") +
        (f.a ? '<span class="pill">Allowed</span>' : "") +
        Object.entries(f.m).map(([k, v]) => '<span class="delta">' + esc(k) + " " + v + '</span>').join("") +
        '</li>').join("") + '</ul></details>').join("") || '<p class="muted">No files match.</p>';
  }
  render();
});
`;
