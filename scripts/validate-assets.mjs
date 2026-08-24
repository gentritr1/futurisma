import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ASSET_KIT_PROP_PLACEMENTS,
  ASSET_KIT_REQUIRED_PROP_NAMES,
} from "../src/game/asset-kit-layout.js";

const expectedHashes = {
  "models/futurisma_asset_kit.glb": "9cf2346b81ccbe2136fedaa78967d22a38a2017b043b005a2ab040fda1df5226",
  "models/totem_master.glb": "633bd405bb6c3e676058ba1f89ea4807b2c010ae637d832aeee8ce5231eb80f9",
  "models/totem_runtime.glb": "fb37e873ade4180b70fb998542e944171233f4f12edea006d506f1f764f24cbf",
  "textures/totem_decals_1024_base.png": "f34537951d842901cf79678f66117b6ef66ed12f985f60f15f1ba911cb3b3361",
  "textures/totem_decals_1024_nightform.png": "cac80bb0ffb70bbd23d2c216efb3a5d44379e5b7674d5badb02a36cc9253e1b4",
  "textures/totem_decals_1024_privateer.png": "98346872ed757bbe8db610ac35f2a6f243e8cfba681fdf5d936a6e0bdd1bd226",
  "textures/totem_decals_1024_works.png": "fbd124bc75286269acfe7a839309e24f1a21600e93ecc1db00b104adc610da73",
  "textures/totem_emissive_512.png": "05268acb88d36c4936f6b4424dd7bdf66eebf1ced217a1f0630b3ca12b53e521",
  "logos/kairo-dynamics.svg": "95b446999c52f9e340d25df05537b02ef2d6fcfe62fabcd62881fcf0662388c0",
  "logos/totem-syndicate.svg": "506a73cb8de719bf870d3841d51340265066645a6a87b5088189bd03dcc90b7d",
};

let assetKitBytes;
for (const [relativePath, expectedHash] of Object.entries(expectedHashes)) {
  const bytes = await readFile(
    new URL(`../public/assets/totem/${relativePath}`, import.meta.url),
  );
  if (relativePath === "models/futurisma_asset_kit.glb") assetKitBytes = bytes;
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actualHash, expectedHash, `${relativePath} differs from the accepted package.`);
}

assert.ok(assetKitBytes, "The accepted asset-kit GLB must be present.");
assert.equal(assetKitBytes.subarray(0, 4).toString("utf8"), "glTF");
assert.equal(assetKitBytes.readUInt32LE(4), 2, "The asset kit must be glTF 2.0.");
let assetKitJson;
let offset = 12;
while (offset < assetKitBytes.length) {
  const chunkLength = assetKitBytes.readUInt32LE(offset);
  const chunkType = assetKitBytes.toString("utf8", offset + 4, offset + 8);
  if (chunkType === "JSON") {
    assetKitJson = JSON.parse(
      assetKitBytes.subarray(offset + 8, offset + 8 + chunkLength).toString("utf8").trim(),
    );
    break;
  }
  offset += 8 + chunkLength;
}
assert.ok(assetKitJson, "The accepted asset kit must contain a JSON chunk.");
const assetKitNodeNames = new Set(assetKitJson.nodes?.map((node) => node.name));
for (const name of ASSET_KIT_REQUIRED_PROP_NAMES) {
  assert.ok(assetKitNodeNames.has(name), `The accepted asset kit is missing ${name}.`);
}
for (const placement of ASSET_KIT_PROP_PLACEMENTS) {
  assert.ok(Number.isFinite(placement.distance) && placement.distance >= 0);
  assert.ok(Number.isFinite(placement.lateral));
  assert.ok(Number.isFinite(placement.yaw));
  assert.ok(Number.isFinite(placement.scale) && placement.scale > 0);
}

console.log(
  `Assets PASS: ${Object.keys(expectedHashes).length} served files match the accepted Phase 1 bytes; ${ASSET_KIT_PROP_PLACEMENTS.length} authored prop placements resolve.`,
);
