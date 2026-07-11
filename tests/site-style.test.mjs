import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../assets/css/styles.css", import.meta.url), "utf8");

function luminance(hex) {
  const channels = hex
    .match(/[a-f\d]{2}/gi)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("primary button gradient stops retain AA text contrast", () => {
  for (const color of ["#8a5d2f", "#6b3f1d", "#764b22", "#542f12"]) {
    assert.ok(contrastRatio("#ffffff", color) >= 4.5, `${color} must retain 4.5:1 contrast against white text`);
    assert.match(css, new RegExp(color, "i"));
  }
});

test("focus indicator remains visible on light and dark surfaces", () => {
  assert.ok(contrastRatio("#6b3f1d", "#ffffff") >= 3);
  assert.ok(contrastRatio("#ffffff", "#0d1520") >= 3);
  assert.match(css, /:focus-visible\s*\{[\s\S]*?outline:\s*3px solid #fff;[\s\S]*?box-shadow:\s*0 0 0 6px #6b3f1d;/i);
});

test("legacy audit results stay hidden until real results exist", () => {
  assert.match(css, /\.audit-results-shell\[hidden\]\s*\{\s*display:\s*none;/i);
});
