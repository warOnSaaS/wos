// Not part of the build: run with playwright-core available (e.g. from a scratch dir) to regenerate the mark files.
// Renders the approved wOS mark (Geist Mono Bold, layout B: off-white on near-black, natural spacing,
// centred on the ink box) at every size the site and apps need.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
const W = new URL("..", import.meta.url).pathname;
const font = readFileSync(W + "assets/GeistMono-700.ttf").toString("base64");
const BG = "#0b0b0b", FG = "#e6e6e3";
const share = (s) => (s <= 16 ? 0.94 : s <= 32 ? 0.84 : 0.66);
const targets = [
  [16, W + "app/icon1.png"],
  [32, W + "app/icon2.png"],
  [180, W + "app/apple-icon.png"],
  [96, W + "assets/wos-mark-96.png"],
  [500, process.env.HOME + "/Downloads/wos-avatar-500.png"],
  [1024, process.env.HOME + "/Downloads/wos-icon-1024.png"],
  [1024, W + "../desktop/build/icon.png"],
];
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext()).newPage();
await p.setContent(`<style>@font-face{font-family:G;src:url(data:font/ttf;base64,${font});font-weight:700}</style><span style="font-family:G;font-weight:700">wOS</span>`);
await p.evaluate(() => document.fonts.ready);
for (const [size, file] of targets) {
  const url = await p.evaluate(({ size, share, BG, FG }) => {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d"); g.fillStyle = BG; g.fillRect(0, 0, size, size);
    g.font = "700 100px G"; let m = g.measureText("wOS");
    const px = (size * share) / ((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 100);
    g.font = `700 ${px}px G`; m = g.measureText("wOS");
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    g.fillStyle = FG; g.fillText("wOS", (size - w) / 2 + m.actualBoundingBoxLeft, (size - h) / 2 + m.actualBoundingBoxAscent);
    return c.toDataURL("image/png");
  }, { size, share: share(size), BG, FG });
  writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log(size, file);
}
await b.close();
