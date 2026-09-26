#!/usr/bin/env node
/**
 * Generates native launcher icon resources for all 25 Muchi app icon styles:
 * - Android:
 *   - res/drawable/ic_launcher_bg_<id>.xml (Adaptive icon background vector)
 *   - res/drawable/ic_launcher_fg_<id>.xml (Adaptive icon foreground vector with gradient disc + M mark)
 *   - res/mipmap-anydpi-v26/ic_launcher_<id>.xml & ic_launcher_<id>_round.xml
 *   - res/mipmap-hdpi/ic_launcher_<id>.png & ic_launcher_<id>_round.png (Raster fallback PNGs)
 * - iOS:
 *   - ios/App/App/Assets.xcassets/AppIcon-<id>.appiconset/Contents.json + PNGs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const APP_ICONS = [
  { id: "default", title: "Classic Muchi", bg: "#081612", discA: "#baffe6", discB: "#12c48c", ink: "#06241c", accent: "#34d399" },
  { id: "anime_cyber", title: "Cyber Anime", bg: "#0d0221", discA: "#ff007f", discB: "#00f0ff", ink: "#0f051d", accent: "#ff007f" },
  { id: "anime_kawaii", title: "Kawaii Mochi", bg: "#2a1526", discA: "#ffcbf2", discB: "#f72585", ink: "#ffffff", accent: "#ff70a6" },
  { id: "anime_mecha", title: "Mecha Unit-01", bg: "#120826", discA: "#7000ff", discB: "#39ff14", ink: "#0a0314", accent: "#39ff14" },
  { id: "anime_sakura", title: "Sakura Blossom", bg: "#1f1018", discA: "#ffe5ec", discB: "#fb7185", ink: "#3c0919", accent: "#fb7185" },
  { id: "anime_shonen", title: "Shonen Flame", bg: "#1a0800", discA: "#ffe600", discB: "#ff3d00", ink: "#260600", accent: "#ff9100" },
  { id: "anime_ninja", title: "Shadow Ninja", bg: "#05070e", discA: "#e63946", discB: "#1d3557", ink: "#ffffff", accent: "#e63946" },
  { id: "anime_chibi", title: "Chibi Sparkle", bg: "#19082a", discA: "#f1c0e8", discB: "#a3c4f3", ink: "#3c1361", accent: "#cfbaf0" },
  { id: "blurple_gamer", title: "Blurple Gamer", bg: "#1e1f22", discA: "#7289da", discB: "#5865f2", ink: "#ffffff", accent: "#5865f2" },
  { id: "gem_booster", title: "Gem Booster", bg: "#23153c", discA: "#f47fff", discB: "#be185d", ink: "#ffffff", accent: "#f47fff" },
  { id: "matrix_terminal", title: "Matrix Console", bg: "#001100", discA: "#80ff72", discB: "#008f11", ink: "#000000", accent: "#00ff66" },
  { id: "pixel_arcade", title: "8-Bit Arcade", bg: "#181425", discA: "#fbb954", discB: "#cd683d", ink: "#261b36", accent: "#e43b44" },
  { id: "solar_flare", title: "Solar Flare", bg: "#1c0d02", discA: "#ffea79", discB: "#ff6b00", ink: "#2b0d00", accent: "#ff8c00" },
  { id: "vaporwave", title: "Vaporwave 1984", bg: "#10061e", discA: "#f72585", discB: "#4cc9f0", ink: "#0e021a", accent: "#7209b7" },
  { id: "synthwave", title: "Synthwave Sunset", bg: "#180527", discA: "#ff4b91", discB: "#6c00ff", ink: "#ffffff", accent: "#ff4b91" },
  { id: "cosmic_nebula", title: "Cosmic Nebula", bg: "#090919", discA: "#b5179e", discB: "#480ca8", ink: "#ffffff", accent: "#4cc9f0" },
  { id: "ruby_crimson", title: "Crimson Ruby", bg: "#1a0006", discA: "#ff4d6d", discB: "#a4133c", ink: "#ffffff", accent: "#ff4d6d" },
  { id: "emerald_jade", title: "Imperial Jade", bg: "#021c14", discA: "#52b788", discB: "#1b4332", ink: "#ffffff", accent: "#74c69d" },
  { id: "holographic", title: "Holo Prism", bg: "#121420", discA: "#e0aaff", discB: "#7b2cbf", ink: "#ffffff", accent: "#c77dff" },
  { id: "y2k_chrome", title: "Y2K Liquid Chrome", bg: "#171a21", discA: "#e2e8f0", discB: "#64748b", ink: "#0f172a", accent: "#94a3b8" },
  { id: "midnight_stealth", title: "Obsidian Stealth", bg: "#000000", discA: "#334155", discB: "#0f172a", ink: "#f8fafc", accent: "#94a3b8" },
  { id: "sunset_lofi", title: "Lofi Twilight", bg: "#1e1022", discA: "#fca311", discB: "#e63946", ink: "#14213d", accent: "#fca311" },
  { id: "ocean_abyss", title: "Abyssal Deep", bg: "#030e1e", discA: "#48cae4", discB: "#0077b6", ink: "#03045e", accent: "#00b4d8" },
  { id: "citrus_burst", title: "Citrus Punch", bg: "#1a1600", discA: "#cbf3f0", discB: "#ff9f1c", ink: "#2ec4b6", accent: "#ffbf69" },
  { id: "royal_amethyst", title: "Royal Amethyst", bg: "#14041e", discA: "#d8b4e2", discB: "#5a189a", ink: "#ffffff", accent: "#e0aaff" },
];

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// CRC32 for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function renderIconPng(icon, size = 120, roundMask = false) {
  const bg = hexToRgb(icon.bg);
  const discA = hexToRgb(icon.discA);
  const discB = hexToRgb(icon.discB);
  const ink = hexToRgb(icon.ink);
  const accent = hexToRgb(icon.accent);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowOff = y * (size * 4 + 1);
    raw[rowOff] = 0; // filter type 0
    const ny = (y + 0.5) / size * 100;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 100;
      const dx = nx - 50;
      const dy = ny - 50;
      const dist = Math.hypot(dx, dy);

      if (roundMask && dist > 49.2) {
        const pOff = rowOff + 1 + x * 4;
        raw[pOff] = 0;
        raw[pOff + 1] = 0;
        raw[pOff + 2] = 0;
        raw[pOff + 3] = 0;
        continue;
      }

      // Base background + subtle accent radial glow
      const glow = Math.max(0, 1 - dist / 46) * 0.35;
      let r = bg[0] * (1 - glow) + accent[0] * glow;
      let g = bg[1] * (1 - glow) + accent[1] * glow;
      let b = bg[2] * (1 - glow) + accent[2] * glow;

      // Outer motif ring (r = 38, width 1.6)
      const ringDist = Math.abs(dist - 38);
      if (ringDist < 1.3) {
        const aRing = Math.max(0, 1 - ringDist / 1.3) * 0.55;
        r = r * (1 - aRing) + accent[0] * aRing;
        g = g * (1 - aRing) + accent[1] * aRing;
        b = b * (1 - aRing) + accent[2] * aRing;
      }

      // Inner disc (r = 32)
      if (dist <= 32.5) {
        const edge = Math.max(0, Math.min(1, 32.5 - dist));
        const tGrad = Math.max(0, Math.min(1, ((nx - 20) * 0.6 + (ny - 15) * 0.7) / 85));
        const dr = discA[0] * (1 - tGrad) + discB[0] * tGrad;
        const dg = discA[1] * (1 - tGrad) + discB[1] * tGrad;
        const db = discA[2] * (1 - tGrad) + discB[2] * tGrad;
        r = r * (1 - edge) + dr * edge;
        g = g * (1 - edge) + dg * edge;
        b = b * (1 - edge) + db * edge;

        // M stroke + center dot inside disc
        const d1 = distToSegment(nx, ny, 33.5, 64.5, 33.5, 35.5);
        const d2 = distToSegment(nx, ny, 33.5, 35.5, 50.0, 56.5);
        const d3 = distToSegment(nx, ny, 50.0, 56.5, 66.5, 35.5);
        const d4 = distToSegment(nx, ny, 66.5, 35.5, 66.5, 64.5);
        const dDot = Math.hypot(nx - 50, ny - 66);
        const mDist = Math.min(d1, d2, d3, d4);
        const inkAlpha = Math.max(
          Math.max(0, Math.min(1, 4.3 - mDist)),
          Math.max(0, Math.min(1, 4.5 - dDot))
        );
        if (inkAlpha > 0) {
          r = r * (1 - inkAlpha) + ink[0] * inkAlpha;
          g = g * (1 - inkAlpha) + ink[1] * inkAlpha;
          b = b * (1 - inkAlpha) + ink[2] * inkAlpha;
        }
      }

      const pOff = rowOff + 1 + x * 4;
      raw[pOff] = Math.round(Math.max(0, Math.min(255, r)));
      raw[pOff + 1] = Math.round(Math.max(0, Math.min(255, g)));
      raw[pOff + 2] = Math.round(Math.max(0, Math.min(255, b)));
      raw[pOff + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildAndroidBgVectorXml(icon) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="M0,0h108v108h-108z"
        android:fillColor="${icon.bg}" />
    <path
        android:pathData="M54,10A44,44 0 1,1 53.9,10Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="radial"
                android:centerX="46"
                android:centerY="42"
                android:gradientRadius="48"
                android:startColor="#66${icon.accent.slice(1)}"
                android:endColor="#00${icon.bg.slice(1)}" />
        </aapt:attr>
    </path>
</vector>
`;
}

function buildAndroidFgVectorXml(icon) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="100"
    android:viewportHeight="100">
    <!-- Outer accent halo -->
    <path
        android:pathData="M50,22A28,28 0 1,1 49.9,22Z"
        android:strokeWidth="1.5"
        android:strokeColor="#88${icon.accent.slice(1)}"
        android:fillColor="#00000000" />
    <!-- Main gradient disc (safe zone centered at 50,50 r=24) -->
    <path
        android:pathData="M50,26A24,24 0 1,1 49.9,26Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="30"
                android:startY="28"
                android:endX="70"
                android:endY="74"
                android:startColor="${icon.discA}"
                android:endColor="${icon.discB}" />
        </aapt:attr>
    </path>
    <!-- Top gloss highlight -->
    <path
        android:pathData="M34,34A10,3.8 0 1,0 54,34A10,3.8 0 1,0 34,34Z"
        android:fillColor="#44FFFFFF" />
    <!-- Muchi 'M' signature mark -->
    <path
        android:pathData="M37.5,61 L37.5,39 L50,54.8 L62.5,39 L62.5,61"
        android:strokeColor="${icon.ink}"
        android:strokeWidth="6.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
    <!-- Center resonance dot -->
    <path
        android:pathData="M50,58.8A3.2,3.2 0 1,1 49.9,58.8Z"
        android:fillColor="${icon.ink}" />
</vector>
`;
}

function buildAdaptiveIconXml(id) {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_bg_${id}"/>
    <foreground android:drawable="@drawable/ic_launcher_fg_${id}"/>
</adaptive-icon>
`;
}

const androidRes = join(ROOT, "android/app/src/main/res");
const drawableDir = join(androidRes, "drawable");
const mipmapV26Dir = join(androidRes, "mipmap-anydpi-v26");
const mipmapHdpiDir = join(androidRes, "mipmap-hdpi");
const iosAssetsDir = join(ROOT, "ios/App/App/Assets.xcassets");

mkdirSync(drawableDir, { recursive: true });
mkdirSync(mipmapV26Dir, { recursive: true });
mkdirSync(mipmapHdpiDir, { recursive: true });
mkdirSync(iosAssetsDir, { recursive: true });

for (const icon of APP_ICONS) {
  if (icon.id === "default") continue;

  // 1. Android vector background + foreground drawables
  writeFileSync(join(drawableDir, `ic_launcher_bg_${icon.id}.xml`), buildAndroidBgVectorXml(icon));
  writeFileSync(join(drawableDir, `ic_launcher_fg_${icon.id}.xml`), buildAndroidFgVectorXml(icon));

  // 2. Android adaptive icon XMLs (API 26+)
  const adaptiveXml = buildAdaptiveIconXml(icon.id);
  writeFileSync(join(mipmapV26Dir, `ic_launcher_${icon.id}.xml`), adaptiveXml);
  writeFileSync(join(mipmapV26Dir, `ic_launcher_${icon.id}_round.xml`), adaptiveXml);

  // 3. Android raster fallback PNGs (hdpi)
  const sqPng = renderIconPng(icon, 120, false);
  const rdPng = renderIconPng(icon, 120, true);
  writeFileSync(join(mipmapHdpiDir, `ic_launcher_${icon.id}.png`), sqPng);
  writeFileSync(join(mipmapHdpiDir, `ic_launcher_${icon.id}_round.png`), rdPng);

  // 4. iOS alternate icon set inside Assets.xcassets
  const appIconSetDir = join(iosAssetsDir, `AppIcon-${icon.id}.appiconset`);
  mkdirSync(appIconSetDir, { recursive: true });
  writeFileSync(join(appIconSetDir, `AppIcon-${icon.id}-120.png`), sqPng);
  writeFileSync(join(appIconSetDir, `AppIcon-${icon.id}-180.png`), renderIconPng(icon, 180, false));
  const contentsJson = {
    images: [
      {
        filename: `AppIcon-${icon.id}-120.png`,
        idiom: "iphone",
        scale: "2x",
        size: "60x60",
      },
      {
        filename: `AppIcon-${icon.id}-180.png`,
        idiom: "iphone",
        scale: "3x",
        size: "60x60",
      },
      {
        filename: `AppIcon-${icon.id}-120.png`,
        idiom: "ipad",
        scale: "2x",
        size: "60x60",
      },
    ],
    info: {
      author: "xcode",
      version: 1,
    },
  };
  writeFileSync(join(appIconSetDir, "Contents.json"), JSON.stringify(contentsJson, null, 2) + "\n");
}

console.log(`Generated native Android + iOS launcher icons for ${APP_ICONS.length} styles.`);
