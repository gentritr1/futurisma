#!/usr/bin/env node
/**
 * FUTURISMA — atlas builder.
 *
 *   node build/build-futurisma-atlases.mjs [--out <repo-root>] [--check]
 *
 * Rasterises the three authored sheets from `atlas-draw.mjs` and writes them
 * to their served paths, plus `ATLAS_REGIONS.json` beside the authoring data.
 * `--check` rebuilds in memory and compares SHA-256 against what is on disk
 * without writing, so CI can prove the PNGs still match their source.
 *
 * Zero dependencies. PNG encoding is done here with node:zlib so the builder
 * runs in a bare `git worktree` with nothing installed, matching the P0
 * worktree-safe test gate.
 *
 * Output is deterministic: no timestamps, no ancillary chunks, one IDAT,
 * filter type 0 on every row, fixed deflate level. Two runs on two machines
 * produce identical bytes, which is what makes registering a hash in
 * `scripts/validate-assets.mjs` meaningful.
 */

import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRunwayAtlas, buildSignageAtlas, buildMotionAtlasB } from "./atlas-draw.mjs";
import {
  buildCrustTile,
  buildBitterpanCrustAtlas,
  buildHangarFixtures,
  buildLiveryWearAtlas,
} from "./atlas-draw-pass02.mjs";
import {
  buildBitterpanFacades,
  buildHorizonCards,
  buildTrimSheet,
} from "./atlas-draw-pass03.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Served destination for each sheet, relative to the repo root. */
const TARGETS = {
  greenwater_runway_1024: "public/assets/greenwater/textures/greenwater_runway_1024.png",
  futurisma_signage_1024: "public/assets/greenwater/textures/futurisma_signage_1024.png",
  greenwater_motion_b_512: "public/assets/greenwater/textures/greenwater_motion_b_512.png",
  // Pass 02.
  bitterpan_crust_tile_256: "public/assets/map02/textures/bitterpan_crust_tile_256.png",
  bitterpan_crust_1024: "public/assets/map02/textures/bitterpan_crust_1024.png",
  hangar_fixtures_512: "public/assets/greenwater/textures/hangar_fixtures_512.png",
  totem_wear_1024: "public/assets/totem/textures/totem_wear_1024.png",
  // Pass 03. The horizon sheet and the trim sheet are shared by both maps, the
  // same way greenwater_motion_512 already is, so they are served from the
  // shared greenwater texture directory rather than duplicated per map.
  bitterpan_facades_1024: "public/assets/map02/textures/bitterpan_facades_1024.png",
  futurisma_horizon_1024: "public/assets/greenwater/textures/futurisma_horizon_1024.png",
  futurisma_trim_512: "public/assets/greenwater/textures/futurisma_trim_512.png",
};

const REGIONS_TARGET = "src/game/data/ATLAS_REGIONS.json";

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- run ------------------------------------------------------------------

const args = process.argv.slice(2);
const check = args.includes("--check");
const outIndex = args.indexOf("--out");
const root = resolve(outIndex >= 0 ? args[outIndex + 1] : join(HERE, ".."));

// Pass 01 first and unchanged: its three sha256 values are registered in
// scripts/validate-assets.mjs, and the Pass 02 builders live in a separate
// module precisely so that neither their draw order nor their rng streams can
// be disturbed. A `--check` run after this change must still print OK for all
// three, which is the proof that Pass 02 was additive.
const sheets = [
  buildRunwayAtlas(),
  buildSignageAtlas(),
  buildMotionAtlasB(),
  buildCrustTile(),
  buildBitterpanCrustAtlas(),
  buildHangarFixtures(),
  buildLiveryWearAtlas(),
  buildBitterpanFacades(),
  buildHorizonCards(),
  buildTrimSheet(),
];
const regions = {};
let failed = false;

for (const sheet of sheets) {
  const png = encodePng(sheet.width, sheet.height, sheet.rgba);
  const hash = createHash("sha256").update(png).digest("hex");
  const target = TARGETS[sheet.name];
  if (!target) throw new Error(`No served path registered for ${sheet.name}.`);
  const path = join(root, target);
  regions[sheet.name] = {
    texture: `/${target.replace(/^public\//, "")}`,
    width: sheet.width,
    height: sheet.height,
    bytes: png.length,
    sha256: hash,
    regions: sheet.regions,
  };

  if (check) {
    const onDisk = existsSync(path)
      ? createHash("sha256").update(readFileSync(path)).digest("hex")
      : null;
    const ok = onDisk === hash;
    if (!ok) failed = true;
    console.log(`${ok ? "OK  " : "DIFF"} ${target}  ${hash}`);
    continue;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(
    `wrote ${target}  ${sheet.width}x${sheet.height}  ` +
    `${(png.length / 1024).toFixed(1)} KB  ${Object.keys(sheet.regions).length} regions`,
  );
  console.log(`      sha256 ${hash}`);
}

const regionsJson = `${JSON.stringify(regions, null, 1)}\n`;
if (check) {
  const path = join(root, REGIONS_TARGET);
  const same = existsSync(path) && readFileSync(path, "utf8") === regionsJson;
  if (!same) failed = true;
  console.log(`${same ? "OK  " : "DIFF"} ${REGIONS_TARGET}`);
  process.exit(failed ? 1 : 0);
}

mkdirSync(dirname(join(root, REGIONS_TARGET)), { recursive: true });
writeFileSync(join(root, REGIONS_TARGET), regionsJson);
console.log(`wrote ${REGIONS_TARGET}`);
console.log(
  "\nRegister the three sha256 values above in scripts/validate-assets.mjs " +
  "expectedHashes before merging.",
);
