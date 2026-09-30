/**
 * Renders the wOS app icons from ONE source: the approved mark (`wOS` in Geist Mono Bold, off-white #e6e6e3 on
 * #0b0b0b, centred on the ink box), drawn exactly as apps/web/scripts/render-mark.mjs draws the site favicon, with the
 * same size rule (the mark fills 94% of the width at 16 px, 84% up to 32 px, 66% above). The font is the site's
 * committed apps/web/assets/GeistMono-700.ttf. Runs in Electron (no other dependency):
 *
 *   npm run icons -w apps/desktop        (= electron scripts/render-icons.mjs)
 *
 * Writes, and these files are committed:
 *   build/icon.png            1024 px, the source PNG electron-builder also reads
 *   build/icons/NxN.png       16..1024, the Linux icon set (linux.icon)
 *   build/icon.icns           macOS app icon (PNG entries icp4..ic14)
 *   build/icon.ico            Windows app, window and NSIS installer icon (16..48 as 32-bit BMP, 64..256 as PNG)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const FONT = join(here, "../web/assets/GeistMono-700.ttf");
const BG = "#0b0b0b";
const FG = "#e6e6e3";
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** The site's rule (render-mark.mjs): how much of the width the mark fills at a given size. */
const share = (s) => (s <= 16 ? 0.94 : s <= 32 ? 0.84 : 0.66);

// ------------------------------------------------------------------------------ containers

/** ICNS: "icns", total length, then (type, length incl. 8-byte header, PNG bytes) per entry. */
export function icns(entries) {
  const parts = entries.map(([type, png]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

/** A 32-bit BMP (DIB) ICO image from RGBA pixels: BITMAPINFOHEADER, BGRA rows bottom-up, 1-bit AND mask. */
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

/** ICO: ICONDIR, one ICONDIRENTRY per image, then the images (BMP or PNG). */
export function ico(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

// ------------------------------------------------------------------------------ render

async function render() {
  const dir = mkdtempSync(join(tmpdir(), "wos-icons-"));
  const page = join(dir, "mark.html");
  const font = readFileSync(FONT).toString("base64");
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:G;src:url(data:font/ttf;base64,${font});font-weight:700}</style><span style="font-family:G;font-weight:700">wOS</span>`,
  );
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(pathToFileURL(page).toString());
  const out = {};
  for (const size of SIZES) {
    out[size] = await win.webContents.executeJavaScript(
      `(async () => {
        await document.fonts.load("700 100px G");
        const size = ${size}, share = ${share(size)};
        const c = document.createElement("canvas"); c.width = c.height = size;
        const g = c.getContext("2d"); g.fillStyle = ${JSON.stringify(BG)}; g.fillRect(0, 0, size, size);
        g.font = "700 100px G"; let m = g.measureText("wOS");
        const px = (size * share) / ((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 100);
        g.font = "700 " + px + "px G"; m = g.measureText("wOS");
        const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        g.fillStyle = ${JSON.stringify(FG)};
        g.fillText("wOS", (size - w) / 2 + m.actualBoundingBoxLeft, (size - h) / 2 + m.actualBoundingBoxAscent);
        const rgba = g.getImageData(0, 0, size, size).data;
        let bin = ""; for (let i = 0; i < rgba.length; i++) bin += String.fromCharCode(rgba[i]);
        return { png: c.toDataURL("image/png").split(",")[1], rgba: btoa(bin) };
      })()`,
    );
  }
  win.destroy();
  rmSync(dir, { recursive: true, force: true });
  return out;
}

async function main() {
  const r = await render();
  const png = (s) => Buffer.from(r[s].png, "base64");
  const rgba = (s) => Buffer.from(r[s].rgba, "base64");
  mkdirSync(join(here, "build/icons"), { recursive: true });
  writeFileSync(join(here, "build/icon.png"), png(1024));
  for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(here, `build/icons/${s}x${s}.png`), png(s));
  writeFileSync(
    join(here, "build/icon.icns"),
    icns([
      ["icp4", png(16)],
      ["icp5", png(32)],
      ["icp6", png(64)],
      ["ic07", png(128)],
      ["ic08", png(256)],
      ["ic09", png(512)],
      ["ic10", png(1024)],
      ["ic11", png(32)],
      ["ic12", png(64)],
      ["ic13", png(256)],
      ["ic14", png(512)],
    ]),
  );
  writeFileSync(
    join(here, "build/icon.ico"),
    ico([...[16, 24, 32, 48].map((s) => ({ size: s, data: dib(s, rgba(s)) })), ...[64, 128, 256].map((s) => ({ size: s, data: png(s) }))]),
  );
  console.log("wOS icons written to build/ (icon.png, icons/, icon.icns, icon.ico)");
}

app.whenReady().then(
  () =>
    main().then(
      () => app.quit(),
      (e) => {
        console.error(e);
        app.exit(1);
      },
    ),
  (e) => {
    console.error(e);
    app.exit(1);
  },
);
