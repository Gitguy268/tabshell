import test from "node:test";
import assert from "node:assert/strict";
import { themes } from "../src/themes.js";

const ansi = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
const cssVars = ["bg", "panel", "line", "text", "muted", "accent", "danger"];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}

test("the default theme keeps TabShell's original look", () => {
  const { background, foreground, cursor, selectionBackground } = themes.default.xterm;
  assert.deepEqual({ background, foreground, cursor, selectionBackground }, { background: "#0d1117", foreground: "#e6edf3", cursor: "#5fd68a", selectionBackground: "#264f78" });
  assert.deepEqual(themes.default.quotes, []);
});

for (const [id, t] of Object.entries(themes)) {
  test(`${id} defines every page colour`, () => {
    assert.ok(t.scheme === "dark" || t.scheme === "light");
    assert.deepEqual(Object.keys(t.css).sort(), [...cssVars].sort());
    for (const [name, value] of Object.entries(t.css)) assert.match(value, /^#[0-9a-f]{6}$/, name);
    assert.ok(contrast(t.css.text, t.css.panel) >= 4.5);
    assert.ok(contrast(t.css.muted, t.css.panel) >= 4.5);
    assert.ok(contrast(t.css.danger, t.css.panel) >= 4.5);
    assert.ok(contrast(t.css.accent, t.css.panel) >= 3, "focus rings and the active mode need to show");
    assert.equal(t.css.bg, t.xterm.background, "the page and terminal share one background");
  });

  test(`${id} has all 16 terminal colours, readable on its background`, () => {
    const { xterm } = t;
    for (const [name, value] of Object.entries(xterm)) assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, name);
    for (const name of ansi) assert.ok(xterm[name], name);
    // The colours nearest the background are mainly used as backgrounds and faint text.
    const backgroundish = t.scheme === "dark" ? /^(bright)?black$/i : /^(bright)?white$/i;
    for (const name of ansi.filter(n => !backgroundish.test(n))) {
      const ratio = contrast(xterm[name], xterm.background);
      assert.ok(ratio >= 4.5, `${name} is only ${ratio.toFixed(1)}:1`);
    }
    assert.ok(contrast(xterm.foreground, xterm.background) >= 4.5);
    assert.ok(contrast(xterm.foreground, xterm.selectionBackground) >= 4.5);
    assert.ok(contrast(xterm.cursor, xterm.background) >= 3, "cursor");
  });
}

for (const id of ["nujabes", "graduation"]) {
  test(`${id} has a line to show`, () => assert.ok(themes[id].quotes.length > 0));
}
