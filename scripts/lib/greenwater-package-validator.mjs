import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2_048;
const MAX_COMPRESSION_RATIO = 200;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXPECTED_MATERIALS = [
  "GW_MAT_concrete",
  "GW_MAT_metal",
  "GW_MAT_jungle",
  "GW_MAT_water",
  "GW_MAT_signage",
  "GW_MAT_emissive",
];
const EXPECTED_ALPHA_MODES = new Map([
  ["GW_MAT_concrete", "OPAQUE"],
  ["GW_MAT_metal", "OPAQUE"],
  ["GW_MAT_jungle", "MASK"],
  ["GW_MAT_water", "BLEND"],
  ["GW_MAT_signage", "MASK"],
  ["GW_MAT_emissive", "OPAQUE"],
]);
const EXPECTED_TEXTURES = new Map([
  ["concrete", { path: "textures/greenwater_concrete_1024.png", size: 1024 }],
  ["metal", { path: "textures/greenwater_metal_1024.png", size: 1024 }],
  ["jungle", { path: "textures/greenwater_jungle_1024.png", size: 1024 }],
  ["water", { path: "textures/greenwater_water_1024.png", size: 1024 }],
  ["signage", { path: "textures/greenwater_signage_1024.png", size: 1024 }],
  ["emissive", { path: "textures/greenwater_emissive_512.png", size: 512 }],
]);
const EXPECTED_ATLAS_SLOTS = new Map([
  ["concrete", [
    "deck_clean", "deck_worn", "deck_repair", "deck_joint",
    "kerb", "drain", "apron", "revetment",
    "threshold_bar", "chequer", "hatching", "numeral_09",
    "grade_ramp", "stain_damp", "algae_edge", "reserved_c15",
  ]],
  ["metal", [
    "steel_plate", "steel_worn", "oxide", "rivet_plate",
    "truss", "pipe", "tank_shell", "hangar_wall",
    "hangar_rib", "corrugate", "catch_net", "crane_boom",
    "walkway_grate", "antenna_lattice", "tower_glass", "reserved_m15",
  ]],
  ["jungle", [
    "canopy_a", "canopy_b", "canopy_c", "fern",
    "vine", "reed", "trunk", "undergrowth",
    "canopy_a_far", "canopy_b_far", "canopy_c_far", "litter",
    "reserved_j12", "reserved_j13", "reserved_j14", "reserved_j15",
  ]],
  ["water", [
    "deep", "shallow", "weir_sheet", "foam",
    "sheen", "silt_edge", "reserved_w06", "reserved_w07",
    "reserved_w08", "reserved_w09", "reserved_w10", "reserved_w11",
    "reserved_w12", "reserved_w13", "reserved_w14", "reserved_w15",
  ]],
  ["signage", [
    "chevron01", "chevron02", "chevron03", "chevron04",
    "board03", "board02", "board01", "pylon_bar",
    "wrongway_cross", "red_edge_break", "lap_board", "chequer_band",
    "sector_plate", "guide_arrow", "hazard_stripe", "reserved_s15",
  ]],
  ["emissive", [
    "amber_lamp", "amber_beacon", "red_lamp", "cyan_accent",
    "sodium_pool", "hangar_mouth", "board_glow", "chequer_glow",
    "reserved_e08", "reserved_e09", "reserved_e10", "reserved_e11",
    "reserved_e12", "reserved_e13", "reserved_e14", "reserved_e15",
  ]],
]);
const EXPECTED_KIT_ROOTS = [
  "GW_MOD_surface_deck_straight",
  "GW_MOD_surface_deck_arc_r45",
  "GW_MOD_surface_deck_arc_r55",
  "GW_MOD_surface_deck_arc_r70",
  "GW_MOD_surface_deck_arc_r85",
  "GW_MOD_surface_deck_arc_r100",
  "GW_MOD_surface_deck_arc_r180",
  "GW_MOD_surface_banking_transition",
  "GW_MOD_surface_grade_ramp",
  "GW_MOD_surface_kerb_drain",
  "GW_MOD_surface_decal_set",
  "GW_MOD_edge_soft_rail_8m",
  "GW_MOD_edge_soft_rail_post",
  "GW_MOD_edge_hard_revetment_8m",
  "GW_MOD_edge_hard_revetment_corner",
  "GW_MOD_edge_catch_net_8m",
  "GW_MOD_sign_chevron_set",
  "GW_MOD_sign_distance_set",
  "GW_MOD_sign_checkpoint_pylon_pair",
  "GW_LM_CRADLE",
  "GW_MOD_structure_hangar_bay",
  "GW_MOD_structure_hangar_mouth",
  "GW_MOD_structure_hangar_corner",
  "GW_MOD_structure_gantry_leg",
  "GW_MOD_structure_gantry_span",
  "GW_MOD_structure_gantry_walkway_12m",
  "GW_MOD_structure_pipe_run_8m",
  "GW_MOD_structure_pipe_elbow",
  "GW_MOD_structure_tank_sphere",
  "GW_MOD_structure_weir",
  "GW_LM_WATER_TOWER",
  "GW_LM_ANTENNA",
  "GW_LM_CRANE",
  "GW_LM_TOWER",
  "GW_MOD_nature_canopy_tree_a",
  "GW_MOD_nature_canopy_tree_b",
  "GW_MOD_nature_canopy_tree_c",
  "GW_MOD_nature_fern_cluster",
  "GW_MOD_nature_vine_drape",
  "GW_MOD_nature_reed_card",
  "GW_MOD_water_set",
  "GW_MOD_light_sodium_fixture",
  "GW_MOD_light_flood_mast",
  "GW_MOD_light_beacon_lamp",
];
const EXPECTED_SECTORS = [
  "RUNWAY_START",
  "T1_CRADLE_BEND",
  "WATER_TABLE",
  "LINK_APRON",
  "HANGAR_SIX",
  "HANGAR_EXIT",
  "GREENWATER_SWEEP",
  "CANOPY_PASSAGE",
  "THE_ELBOW",
  "FUEL_ROW",
  "T10_TOTEM_TURN",
  "RUNWAY_HOME",
];
const EXPECTED_SOURCE_FILES = [
  "source/greenwater-environment.html",
  "source/gw-atlas.js",
  "source/gw-kit.js",
  "source/gw-glb.js",
  "source/gw-place.js",
  "source/gw-zipcheck.js",
  "source/zip.js",
  "source/data/greenwater-blockout.json",
];
const EXPECTED_STAGE_THREE_SOURCE_FILES = [
  "source/gw-previews.js",
];
const EXPECTED_PREVIEW_STATIONS = new Map([
  ["V1_START", 12],
  ["V2_WATER_TABLE", 470],
  ["V3_HANGAR_ENTRY", 640],
  ["V4_GREENWATER_SWEEP", 900],
  ["V5_CANOPY_ANTENNA", 1260],
  ["V6_T10_RETURN", 2060],
]);
const EXPECTED_PREVIEW_FILES = [...EXPECTED_PREVIEW_STATIONS.keys()].flatMap((station) => [
  `previews/${station}_beauty.png`,
  `previews/silhouette/${station}_silhouette.png`,
  `previews/material_id/${station}_material_id.png`,
]);
const COMMON_PACKAGE_FILES = [
  "models/greenwater_artkit.glb",
  ...[...EXPECTED_TEXTURES.values()].map((texture) => texture.path),
  "data/GW_ATLAS_LAYOUT.json",
  "data/GW_KIT_COUNTS.json",
  ...EXPECTED_SOURCE_FILES,
];
const EXACT_STAGE_ONE_REFERENCE_FILES = [
  ...[...EXPECTED_TEXTURES.values()].map((texture) => texture.path),
  "data/GW_ATLAS_LAYOUT.json",
  "source/gw-atlas.js",
  "source/gw-kit.js",
  "source/gw-zipcheck.js",
  "source/zip.js",
  "source/data/greenwater-blockout.json",
];
const EXACT_STAGE_TWO_REFERENCE_FILES = [
  ...[...EXPECTED_TEXTURES.values()].map((texture) => texture.path),
  "data/GW_ATLAS_LAYOUT.json",
  "data/greenwater_art_placements.json",
  "data/GW_BUDGET.json",
  "source/gw-atlas.js",
  "source/gw-kit.js",
  "source/gw-zipcheck.js",
  "source/zip.js",
  "source/data/greenwater-blockout.json",
];

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readUInt16(bytes, offset, label) {
  assert.ok(offset >= 0 && offset + 2 <= bytes.length, `${label} is truncated.`);
  return bytes.readUInt16LE(offset);
}

function readUInt32(bytes, offset, label) {
  assert.ok(offset >= 0 && offset + 4 <= bytes.length, `${label} is truncated.`);
  return bytes.readUInt32LE(offset);
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    assert.fail(`${label} is not valid UTF-8.`);
  }
}

export function validateArchivePath(name) {
  assert.ok(typeof name === "string" && name.length > 0, "ZIP entry name is empty.");
  assert.ok(name.length <= 240, `ZIP entry path is too long: ${name}`);
  assert.ok(name === name.normalize("NFC"), `ZIP entry path is not NFC-normalized: ${name}`);
  assert.match(name, /^[A-Za-z0-9._/-]+$/, `ZIP entry path is not portable ASCII: ${name}`);
  assert.ok(!name.includes("\0"), `ZIP entry path contains NUL: ${name}`);
  assert.ok(!name.includes("\\"), `ZIP entry path uses a backslash: ${name}`);
  assert.ok(!name.startsWith("/"), `ZIP entry path is absolute: ${name}`);
  assert.ok(!/^[A-Za-z]:/.test(name), `ZIP entry path uses a drive prefix: ${name}`);
  assert.ok(!name.includes(":"), `ZIP entry path contains a colon: ${name}`);
  assert.ok(!name.endsWith("/"), `Directory-only ZIP entries are not allowed: ${name}`);
  const segments = name.split("/");
  assert.ok(
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `ZIP entry path is not canonical: ${name}`,
  );
  return name;
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = readUInt16(bytes, offset + 20, "ZIP end record");
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  assert.fail("ZIP end-of-central-directory record is missing or malformed.");
}

export function readZipArchive(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert.ok(bytes.length >= 22, "ZIP archive is too short.");
  assert.ok(bytes.length <= MAX_ARCHIVE_BYTES, "ZIP archive exceeds the 512 MiB limit.");
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUInt16(bytes, eocdOffset + 4, "ZIP end record");
  const directoryDisk = readUInt16(bytes, eocdOffset + 6, "ZIP end record");
  const entriesOnDisk = readUInt16(bytes, eocdOffset + 8, "ZIP end record");
  const entryCount = readUInt16(bytes, eocdOffset + 10, "ZIP end record");
  const directorySize = readUInt32(bytes, eocdOffset + 12, "ZIP end record");
  const directoryOffset = readUInt32(bytes, eocdOffset + 16, "ZIP end record");
  const archiveCommentLength = readUInt16(bytes, eocdOffset + 20, "ZIP end record");
  assert.equal(diskNumber, 0, "Multi-disk ZIP archives are not supported.");
  assert.equal(directoryDisk, 0, "Multi-disk ZIP archives are not supported.");
  assert.equal(entriesOnDisk, entryCount, "ZIP entry counts disagree.");
  assert.equal(archiveCommentLength, 0, "ZIP archive comments are not allowed.");
  assert.ok(entryCount > 0 && entryCount <= MAX_ENTRY_COUNT, "ZIP entry count is invalid.");
  assert.ok(
    entryCount !== 0xffff
      && directorySize !== 0xffffffff
      && directoryOffset !== 0xffffffff,
    "ZIP64 archives are not supported.",
  );
  assert.equal(
    directoryOffset + directorySize,
    eocdOffset,
    "ZIP central directory does not end at the end record.",
  );

  const centralEntries = [];
  const names = new Set();
  const caseFoldedNames = new Set();
  let offset = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(
      readUInt32(bytes, offset, `ZIP central entry ${index}`),
      ZIP_CENTRAL_SIGNATURE,
      `ZIP central entry ${index} has a bad signature.`,
    );
    const versionMadeBy = readUInt16(bytes, offset + 4, `ZIP central entry ${index}`);
    const flags = readUInt16(bytes, offset + 8, `ZIP central entry ${index}`);
    const method = readUInt16(bytes, offset + 10, `ZIP central entry ${index}`);
    const expectedCrc = readUInt32(bytes, offset + 16, `ZIP central entry ${index}`);
    const compressedSize = readUInt32(bytes, offset + 20, `ZIP central entry ${index}`);
    const uncompressedSize = readUInt32(bytes, offset + 24, `ZIP central entry ${index}`);
    const nameLength = readUInt16(bytes, offset + 28, `ZIP central entry ${index}`);
    const extraLength = readUInt16(bytes, offset + 30, `ZIP central entry ${index}`);
    const commentLength = readUInt16(bytes, offset + 32, `ZIP central entry ${index}`);
    const startingDisk = readUInt16(bytes, offset + 34, `ZIP central entry ${index}`);
    const externalAttributes = readUInt32(bytes, offset + 38, `ZIP central entry ${index}`);
    const localOffset = readUInt32(bytes, offset + 42, `ZIP central entry ${index}`);
    assert.equal(startingDisk, 0, "ZIP entry points at another disk.");
    assert.equal(flags & ~ZIP_UTF8_FLAG, 0, "Encrypted or streamed ZIP entries are not allowed.");
    assert.ok(method === ZIP_STORE || method === ZIP_DEFLATE, "ZIP compression method is unsupported.");
    assert.equal(extraLength, 0, "ZIP central-entry extra fields are not allowed.");
    assert.equal(commentLength, 0, "ZIP entry comments are not allowed.");
    const sourceSystem = versionMadeBy >>> 8;
    if (sourceSystem === 3) {
      const fileType = (externalAttributes >>> 16) & 0xf000;
      assert.ok(fileType === 0 || fileType === 0x8000, "ZIP symlinks and special files are not allowed.");
    } else {
      assert.equal(externalAttributes & 0x10, 0, "ZIP directory entries are not allowed.");
    }
    assert.ok(uncompressedSize <= MAX_ENTRY_BYTES, "ZIP entry exceeds the 256 MiB limit.");
    if (method === ZIP_STORE) assert.equal(compressedSize, uncompressedSize);
    if (uncompressedSize > 0) {
      assert.ok(compressedSize > 0, "Non-empty ZIP entry has no compressed bytes.");
      assert.ok(
        uncompressedSize / compressedSize <= MAX_COMPRESSION_RATIO,
        "ZIP entry exceeds the compression-ratio limit.",
      );
    }
    totalUncompressedBytes += uncompressedSize;
    assert.ok(
      totalUncompressedBytes <= MAX_TOTAL_UNCOMPRESSED_BYTES,
      "ZIP archive exceeds the 1 GiB expanded-size limit.",
    );
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    assert.ok(
      nameEnd + extraLength + commentLength <= directoryOffset + directorySize,
      `ZIP central entry ${index} is truncated.`,
    );
    const name = validateArchivePath(decodeUtf8(bytes.subarray(nameStart, nameEnd), "ZIP entry name"));
    assert.ok(!names.has(name), `ZIP contains a duplicate path: ${name}`);
    assert.ok(
      !caseFoldedNames.has(name.toLocaleLowerCase("en-US")),
      `ZIP contains a case-colliding path: ${name}`,
    );
    names.add(name);
    caseFoldedNames.add(name.toLocaleLowerCase("en-US"));
    centralEntries.push({
      name,
      flags,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  assert.equal(offset, directoryOffset + directorySize, "ZIP central directory size is inconsistent.");

  const files = new Map();
  const occupiedRanges = [];
  for (const entry of centralEntries) {
    const label = `ZIP local entry ${entry.name}`;
    assert.equal(readUInt32(bytes, entry.localOffset, label), ZIP_LOCAL_SIGNATURE, `${label} has a bad signature.`);
    const localFlags = readUInt16(bytes, entry.localOffset + 6, label);
    const localMethod = readUInt16(bytes, entry.localOffset + 8, label);
    const localCrc = readUInt32(bytes, entry.localOffset + 14, label);
    const localCompressedSize = readUInt32(bytes, entry.localOffset + 18, label);
    const localUncompressedSize = readUInt32(bytes, entry.localOffset + 22, label);
    const localNameLength = readUInt16(bytes, entry.localOffset + 26, label);
    const localExtraLength = readUInt16(bytes, entry.localOffset + 28, label);
    assert.equal(localExtraLength, 0, `${label} extra fields are not allowed.`);
    const localNameStart = entry.localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    assert.ok(localNameEnd + localExtraLength <= directoryOffset, `${label} overlaps the central directory.`);
    const localName = decodeUtf8(bytes.subarray(localNameStart, localNameEnd), `${label} name`);
    assert.equal(localName, entry.name, `${label} disagrees with the central-directory path.`);
    assert.equal(localFlags, entry.flags, `${label} flags disagree with the central directory.`);
    assert.equal(localMethod, entry.method, `${label} compression disagrees with the central directory.`);
    assert.equal(localCrc, entry.expectedCrc, `${label} CRC disagrees with the central directory.`);
    assert.equal(localCompressedSize, entry.compressedSize, `${label} size disagrees with the central directory.`);
    assert.equal(localUncompressedSize, entry.uncompressedSize, `${label} size disagrees with the central directory.`);
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    assert.ok(dataEnd <= directoryOffset, `${label} data overlaps the central directory.`);
    const compressed = bytes.subarray(dataStart, dataEnd);
    const output = entry.method === ZIP_STORE
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    assert.equal(output.length, entry.uncompressedSize, `${label} expanded size is wrong.`);
    assert.equal(crc32(output), entry.expectedCrc, `${label} failed its CRC-32 check.`);
    files.set(entry.name, output);
    occupiedRanges.push([entry.localOffset, dataEnd, entry.name]);
  }
  occupiedRanges.sort((left, right) => left[0] - right[0]);
  assert.equal(occupiedRanges[0][0], 0, "ZIP contains an unaccounted prefix before its first entry.");
  for (let index = 1; index < occupiedRanges.length; index += 1) {
    assert.equal(
      occupiedRanges[index - 1][1],
      occupiedRanges[index][0],
      `ZIP has a gap or overlap between ${occupiedRanges[index - 1][2]} and ${occupiedRanges[index][2]}.`,
    );
  }
  assert.equal(
    occupiedRanges.at(-1)[1],
    directoryOffset,
    "ZIP contains an unaccounted payload before the central directory.",
  );
  return files;
}

function resolvePackageFiles(archiveFiles) {
  const manifestPaths = [...archiveFiles.keys()].filter(
    (name) => name === "MANIFEST.json" || name.endsWith("/MANIFEST.json"),
  );
  assert.equal(manifestPaths.length, 1, "ZIP must contain exactly one top-level MANIFEST.json.");
  const manifestPath = manifestPaths[0];
  const prefix = manifestPath.slice(0, -"MANIFEST.json".length);
  const logicalFiles = new Map();
  for (const [name, bytes] of archiveFiles) {
    assert.ok(name.startsWith(prefix), `ZIP entry sits outside the package root: ${name}`);
    const logicalName = validateArchivePath(name.slice(prefix.length));
    assert.ok(!logicalFiles.has(logicalName), `ZIP has duplicate logical path: ${logicalName}`);
    logicalFiles.set(logicalName, bytes);
  }
  return logicalFiles;
}

function parseJson(files, path) {
  const bytes = files.get(path);
  assert.ok(bytes, `Package is missing ${path}.`);
  try {
    return JSON.parse(decodeUtf8(bytes, path));
  } catch (error) {
    assert.fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

export function validateManifestFiles(files, manifest) {
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest), "MANIFEST.json must be an object.");
  assert.equal(manifest.format, "GREENWATER_ENVIRONMENT_MANIFEST", "Manifest format is unexpected.");
  assert.equal(manifest.version, "1.0", "Manifest version is unsupported.");
  assert.ok(Number.isInteger(manifest.stage) && manifest.stage >= 1 && manifest.stage <= 3, "Manifest stage is invalid.");
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "Manifest file list is empty.");
  const declaredPaths = new Set();
  const caseFoldedPaths = new Set();
  for (const record of manifest.files) {
    assert.ok(record && typeof record === "object", "Manifest file record is invalid.");
    const path = validateArchivePath(record.path);
    assert.notEqual(path, "MANIFEST.json", "Manifest cannot recursively hash itself.");
    assert.ok(!declaredPaths.has(path), `Manifest repeats ${path}.`);
    assert.ok(!caseFoldedPaths.has(path.toLocaleLowerCase("en-US")), `Manifest paths collide by case: ${path}`);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `Manifest byte count is invalid for ${path}.`);
    assert.match(record.sha256, /^[a-f0-9]{64}$/, `Manifest SHA-256 is invalid for ${path}.`);
    const bytes = files.get(path);
    assert.ok(bytes, `Manifest declares missing file ${path}.`);
    assert.equal(bytes.length, record.bytes, `${path} byte count differs from the manifest.`);
    assert.equal(sha256(bytes), record.sha256, `${path} SHA-256 differs from the manifest.`);
    declaredPaths.add(path);
    caseFoldedPaths.add(path.toLocaleLowerCase("en-US"));
  }
  assert.equal(
    declaredPaths.size + 1,
    files.size,
    "ZIP contains files that are absent from MANIFEST.json.",
  );
  for (const path of files.keys()) {
    assert.ok(path === "MANIFEST.json" || declaredPaths.has(path), `ZIP contains undeclared file ${path}.`);
  }
}

export function parsePng(bytes, label, allowGlbPadding = false) {
  assert.ok(Buffer.isBuffer(bytes), `${label} bytes are missing.`);
  assert.ok(bytes.length >= 33, `${label} is too short to be a PNG.`);
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${label} has a bad PNG signature.`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset < bytes.length) {
    assert.ok(offset + 4 <= bytes.length, `${label} PNG chunk is truncated.`);
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    assert.ok(crcOffset + 4 <= bytes.length, `${label} PNG chunk is truncated.`);
    const typeBytes = bytes.subarray(typeStart, dataStart);
    const type = typeBytes.toString("ascii");
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    assert.equal(
      crc32(Buffer.concat([typeBytes, bytes.subarray(dataStart, dataEnd)])),
      expectedCrc,
      `${label} ${type} chunk failed its CRC check.`,
    );
    if (!sawHeader) {
      assert.equal(type, "IHDR", `${label} must begin with IHDR.`);
      assert.equal(length, 13, `${label} IHDR length is invalid.`);
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      assert.ok(width > 0 && height > 0 && width <= 4096 && height <= 4096, `${label} dimensions are invalid.`);
      assert.equal(bytes[dataStart + 8], 8, `${label} must use 8-bit channels.`);
      assert.equal(bytes[dataStart + 9], 6, `${label} must be RGBA.`);
      assert.equal(bytes[dataStart + 10], 0, `${label} uses unsupported PNG compression.`);
      assert.equal(bytes[dataStart + 11], 0, `${label} uses unsupported PNG filtering.`);
      assert.equal(bytes[dataStart + 12], 0, `${label} must be non-interlaced.`);
      sawHeader = true;
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "IEND") {
      assert.equal(length, 0, `${label} IEND chunk is invalid.`);
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
  }
  assert.ok(sawHeader && sawData && sawEnd, `${label} is missing required PNG chunks.`);
  const padding = bytes.subarray(offset);
  if (allowGlbPadding) {
    assert.ok(padding.length <= 3, `${label} has excessive GLB image padding.`);
    assert.ok(padding.every((byte) => byte === 0), `${label} has non-zero bytes after IEND.`);
  } else {
    assert.equal(offset, bytes.length, `${label} contains trailing bytes after IEND.`);
  }
  return { width, height, byteLength: offset };
}

function componentByteLength(componentType) {
  const lengths = new Map([
    [5120, 1],
    [5121, 1],
    [5122, 2],
    [5123, 2],
    [5125, 4],
    [5126, 4],
  ]);
  const length = lengths.get(componentType);
  assert.ok(length, `GLB accessor uses unsupported component type ${componentType}.`);
  return length;
}

function componentCount(type) {
  const counts = new Map([
    ["SCALAR", 1],
    ["VEC2", 2],
    ["VEC3", 3],
    ["VEC4", 4],
    ["MAT2", 4],
    ["MAT3", 9],
    ["MAT4", 16],
  ]);
  const count = counts.get(type);
  assert.ok(count, `GLB accessor uses unsupported type ${type}.`);
  return count;
}

export function parseGlb(bytes, label = "GLB") {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 20, `${label} is too short.`);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF", `${label} magic is invalid.`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label} must be glTF 2.0.`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label} header length differs from its bytes.`);
  let offset = 12;
  let json;
  let binary;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    const length = readUInt32(bytes, offset, `${label} chunk`);
    const type = readUInt32(bytes, offset + 4, `${label} chunk`);
    const start = offset + 8;
    const end = start + length;
    assert.equal(length % 4, 0, `${label} chunk is not four-byte aligned.`);
    assert.ok(end <= bytes.length, `${label} chunk overruns the file.`);
    if (chunkIndex === 0) assert.equal(type, 0x4e4f534a, `${label} first chunk must be JSON.`);
    if (type === 0x4e4f534a) {
      assert.equal(json, undefined, `${label} contains multiple JSON chunks.`);
      assert.ok(length <= 32 * 1024 * 1024, `${label} JSON chunk exceeds 32 MiB.`);
      try {
        json = JSON.parse(decodeUtf8(bytes.subarray(start, end), `${label} JSON`).trim());
      } catch (error) {
        assert.fail(`${label} JSON is invalid: ${error instanceof Error ? error.message : error}`);
      }
    } else if (type === 0x004e4942) {
      assert.equal(binary, undefined, `${label} contains multiple BIN chunks.`);
      binary = bytes.subarray(start, end);
    } else {
      assert.fail(`${label} contains unsupported chunk type ${type}.`);
    }
    offset = end;
    chunkIndex += 1;
  }
  assert.equal(offset, bytes.length, `${label} chunk table is inconsistent.`);
  assert.ok(json && binary, `${label} must contain JSON and BIN chunks.`);
  assert.equal(json.asset?.version, "2.0", `${label} asset version is invalid.`);
  assert.ok(Array.isArray(json.buffers) && json.buffers.length === 1, `${label} must use one embedded buffer.`);
  assert.ok(!json.buffers[0].uri, `${label} buffer must be embedded.`);
  assert.ok(
    json.buffers[0].byteLength <= binary.length && binary.length - json.buffers[0].byteLength <= 3,
    `${label} BIN padding or declared byte length is invalid.`,
  );
  const bufferViews = json.bufferViews ?? [];
  assert.ok(bufferViews.length <= 50_000, `${label} contains too many bufferViews.`);
  for (const [index, view] of bufferViews.entries()) {
    assert.equal(view.buffer, 0, `${label} bufferView ${index} uses another buffer.`);
    const byteOffset = view.byteOffset ?? 0;
    assert.ok(Number.isSafeInteger(byteOffset) && byteOffset >= 0, `${label} bufferView ${index} offset is invalid.`);
    assert.ok(Number.isSafeInteger(view.byteLength) && view.byteLength > 0, `${label} bufferView ${index} length is invalid.`);
    assert.ok(byteOffset + view.byteLength <= json.buffers[0].byteLength, `${label} bufferView ${index} overruns BIN.`);
    if (view.byteStride !== undefined) {
      assert.ok(
        Number.isInteger(view.byteStride) && view.byteStride >= 4 && view.byteStride <= 252 && view.byteStride % 4 === 0,
        `${label} bufferView ${index} stride is invalid.`,
      );
    }
  }
  const accessors = json.accessors ?? [];
  assert.ok(accessors.length <= 50_000, `${label} contains too many accessors.`);
  const accessorUses = new Map();
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    const nodeNames = (json.nodes ?? [])
      .filter((node) => node.mesh === meshIndex)
      .map((node) => node.name)
      .filter(Boolean);
    for (const primitive of mesh.primitives ?? []) {
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes ?? {})) {
        const uses = accessorUses.get(accessorIndex) ?? [];
        uses.push(`${nodeNames.join("/") || mesh.name || `mesh ${meshIndex}`} ${semantic}`);
        accessorUses.set(accessorIndex, uses);
      }
    }
  }
  let scannedAccessorComponents = 0;
  for (const [index, accessor] of accessors.entries()) {
    assert.equal(accessor.sparse, undefined, `${label} accessor ${index} must not be sparse.`);
    assert.ok(Number.isInteger(accessor.bufferView), `${label} accessor ${index} has no bufferView.`);
    const view = bufferViews[accessor.bufferView];
    assert.ok(view, `${label} accessor ${index} points at a missing bufferView.`);
    assert.ok(
      Number.isSafeInteger(accessor.count) && accessor.count > 0 && accessor.count <= 10_000_000,
      `${label} accessor ${index} count is invalid.`,
    );
    const componentLength = componentByteLength(accessor.componentType);
    const elements = componentCount(accessor.type);
    scannedAccessorComponents += accessor.count * elements;
    assert.ok(
      scannedAccessorComponents <= 50_000_000,
      `${label} contains too many accessor components to validate safely.`,
    );
    const elementLength = componentLength * elements;
    const stride = view.byteStride ?? elementLength;
    assert.ok(stride >= elementLength, `${label} accessor ${index} stride is too small.`);
    const accessorOffset = accessor.byteOffset ?? 0;
    assert.ok(Number.isSafeInteger(accessorOffset) && accessorOffset >= 0, `${label} accessor ${index} offset is invalid.`);
    assert.equal(
      ((view.byteOffset ?? 0) + accessorOffset) % componentLength,
      0,
      `${label} accessor ${index} is not component-aligned.`,
    );
    assert.equal(stride % componentLength, 0, `${label} accessor ${index} stride is not component-aligned.`);
    if (accessor.normalized === true) {
      assert.ok([5120, 5121, 5122, 5123].includes(accessor.componentType), `${label} accessor ${index} normalization is invalid.`);
    }
    const finalByte = accessorOffset + stride * (accessor.count - 1) + elementLength;
    assert.ok(finalByte <= view.byteLength, `${label} accessor ${index} overruns its bufferView.`);
    if (accessor.componentType === 5126) {
      const start = (view.byteOffset ?? 0) + accessorOffset;
      for (let element = 0; element < accessor.count; element += 1) {
        for (let component = 0; component < elements; component += 1) {
          assert.ok(
            Number.isFinite(binary.readFloatLE(start + element * stride + component * 4)),
            `${label} accessor ${index} (${(accessorUses.get(index) ?? ["unreferenced"])[0]}) contains a non-finite FLOAT value.`,
          );
        }
      }
    }
    for (const boundName of ["min", "max"]) {
      if (accessor[boundName] === undefined) continue;
      assert.ok(
        Array.isArray(accessor[boundName])
          && accessor[boundName].length === elements
          && accessor[boundName].every(Number.isFinite),
        `${label} accessor ${index} ${boundName} is invalid.`,
      );
    }
    if (accessor.min && accessor.max) {
      assert.ok(
        accessor.min.every((minimum, component) => minimum <= accessor.max[component]),
        `${label} accessor ${index} bounds are inverted.`,
      );
    }
  }
  return { json, binary };
}

function normalizeAccessorComponent(value, componentType, normalized) {
  if (!normalized) return value;
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  assert.fail(`Normalized accessor uses unsupported component type ${componentType}.`);
}

function readAccessorElement(parsed, accessorIndex, elementIndex) {
  const accessor = parsed.json.accessors[accessorIndex];
  assert.ok(accessor, `GLB accessor ${accessorIndex} is missing.`);
  assert.ok(elementIndex >= 0 && elementIndex < accessor.count, `GLB accessor ${accessorIndex} read is out of range.`);
  const view = parsed.json.bufferViews[accessor.bufferView];
  const componentLength = componentByteLength(accessor.componentType);
  const elements = componentCount(accessor.type);
  const stride = view.byteStride ?? componentLength * elements;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + stride * elementIndex;
  const values = new Array(elements);
  for (let component = 0; component < elements; component += 1) {
    const offset = start + component * componentLength;
    let value;
    if (accessor.componentType === 5120) value = parsed.binary.readInt8(offset);
    else if (accessor.componentType === 5121) value = parsed.binary.readUInt8(offset);
    else if (accessor.componentType === 5122) value = parsed.binary.readInt16LE(offset);
    else if (accessor.componentType === 5123) value = parsed.binary.readUInt16LE(offset);
    else if (accessor.componentType === 5125) value = parsed.binary.readUInt32LE(offset);
    else value = parsed.binary.readFloatLE(offset);
    values[component] = normalizeAccessorComponent(
      value,
      accessor.componentType,
      accessor.normalized === true,
    );
  }
  return values;
}

function accessorPayload(parsed, accessorIndex) {
  const accessor = parsed.json.accessors[accessorIndex];
  assert.ok(accessor, `GLB accessor ${accessorIndex} is missing.`);
  const view = parsed.json.bufferViews[accessor.bufferView];
  const elementLength = componentByteLength(accessor.componentType) * componentCount(accessor.type);
  const stride = view.byteStride ?? elementLength;
  const sourceStart = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const payload = Buffer.allocUnsafe(accessor.count * elementLength);
  for (let index = 0; index < accessor.count; index += 1) {
    parsed.binary.copy(
      payload,
      index * elementLength,
      sourceStart + index * stride,
      sourceStart + index * stride + elementLength,
    );
  }
  return payload;
}

function accessorContract(accessor, includeBounds = true) {
  const contract = {
    componentType: accessor.componentType,
    normalized: accessor.normalized ?? false,
    count: accessor.count,
    type: accessor.type,
  };
  if (includeBounds) {
    contract.min = accessor.min;
    contract.max = accessor.max;
  }
  return contract;
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(1e-5, Math.abs(right) * 1e-6);
}

function validateAttributeAccessor(parsed, accessorIndex, semantic, label) {
  const accessor = parsed.json.accessors[accessorIndex];
  if (semantic === "POSITION" || semantic === "NORMAL") {
    assert.equal(accessor.type, "VEC3", `${label} ${semantic} accessor type is invalid.`);
    assert.equal(accessor.componentType, 5126, `${label} ${semantic} must use FLOAT components.`);
  } else if (semantic === "TEXCOORD_0") {
    assert.equal(accessor.type, "VEC2", `${label} TEXCOORD_0 accessor type is invalid.`);
    assert.ok(
      accessor.componentType === 5126
        || ([5121, 5123].includes(accessor.componentType) && accessor.normalized === true),
      `${label} TEXCOORD_0 component type is invalid.`,
    );
  } else {
    assert.ok(["VEC3", "VEC4"].includes(accessor.type), `${label} COLOR_0 accessor type is invalid.`);
    assert.ok(
      accessor.componentType === 5126
        || ([5121, 5123].includes(accessor.componentType) && accessor.normalized === true),
      `${label} COLOR_0 component type is invalid.`,
    );
  }
  if (semantic === "POSITION") {
    assert.ok(accessor.min && accessor.max, `${label} POSITION accessor must declare bounds.`);
  }
  const actualMin = new Array(componentCount(accessor.type)).fill(Infinity);
  const actualMax = new Array(componentCount(accessor.type)).fill(-Infinity);
  for (let index = 0; index < accessor.count; index += 1) {
    const values = readAccessorElement(parsed, accessorIndex, index);
    for (let component = 0; component < values.length; component += 1) {
      const value = values[component];
      assert.ok(Number.isFinite(value), `${label} ${semantic} contains a non-finite value.`);
      actualMin[component] = Math.min(actualMin[component], value);
      actualMax[component] = Math.max(actualMax[component], value);
      if (semantic === "TEXCOORD_0" || semantic === "COLOR_0") {
        assert.ok(value >= -1e-6 && value <= 1 + 1e-6, `${label} ${semantic} is outside 0..1.`);
      }
    }
  }
  if (semantic === "POSITION") {
    assert.ok(
      actualMin.every((value, component) => approximatelyEqual(value, accessor.min[component]))
        && actualMax.every((value, component) => approximatelyEqual(value, accessor.max[component])),
      `${label} POSITION bounds differ from its binary values.`,
    );
  }
}

function embeddedImageBytes(parsed, image, label) {
  assert.equal(image.mimeType, "image/png", `${label} must be a PNG.`);
  assert.ok(Number.isInteger(image.bufferView), `${label} must be embedded through a bufferView.`);
  assert.equal(image.uri, undefined, `${label} must not use an external URI.`);
  const view = parsed.json.bufferViews?.[image.bufferView];
  assert.ok(view, `${label} points at a missing bufferView.`);
  const start = view.byteOffset ?? 0;
  return parsed.binary.subarray(start, start + view.byteLength);
}

function validateNodeTransform(node, label) {
  if (node.translation !== undefined) {
    assert.ok(
      Array.isArray(node.translation)
        && node.translation.length === 3
        && node.translation.every(Number.isFinite),
      `${label} translation is invalid.`,
    );
  }
  if (node.rotation !== undefined) {
    assert.ok(
      Array.isArray(node.rotation)
        && node.rotation.length === 4
        && node.rotation.every(Number.isFinite),
      `${label} rotation is invalid.`,
    );
  }
  if (node.scale !== undefined) {
    assert.ok(
      Array.isArray(node.scale)
        && node.scale.length === 3
        && node.scale.every((value) => Number.isFinite(value) && value > 0),
      `${label} has a non-positive or invalid scale.`,
    );
    assert.ok(
      Math.abs(node.scale[0] - node.scale[1]) < 1e-6
        && Math.abs(node.scale[1] - node.scale[2]) < 1e-6,
      `${label} has non-uniform scale.`,
    );
  }
  if (node.matrix === undefined) return;
  assert.ok(
    Array.isArray(node.matrix)
      && node.matrix.length === 16
      && node.matrix.every(Number.isFinite),
    `${label} matrix is invalid.`,
  );
  const matrix = node.matrix;
  const xLength = Math.hypot(matrix[0], matrix[1], matrix[2]);
  const yLength = Math.hypot(matrix[4], matrix[5], matrix[6]);
  const zLength = Math.hypot(matrix[8], matrix[9], matrix[10]);
  assert.ok(xLength > 0 && yLength > 0 && zLength > 0, `${label} matrix has a zero scale axis.`);
  assert.ok(
    Math.abs(xLength - yLength) < 1e-6 && Math.abs(yLength - zLength) < 1e-6,
    `${label} matrix has non-uniform scale.`,
  );
  const xy = matrix[0] * matrix[4] + matrix[1] * matrix[5] + matrix[2] * matrix[6];
  const xz = matrix[0] * matrix[8] + matrix[1] * matrix[9] + matrix[2] * matrix[10];
  const yz = matrix[4] * matrix[8] + matrix[5] * matrix[9] + matrix[6] * matrix[10];
  assert.ok(
    Math.abs(xy) / (xLength * yLength) < 1e-6
      && Math.abs(xz) / (xLength * zLength) < 1e-6
      && Math.abs(yz) / (yLength * zLength) < 1e-6,
    `${label} matrix contains shear.`,
  );
  const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
  assert.ok(determinant > 0, `${label} matrix contains a reflected scale.`);
}

function validateNodeHierarchy(json, label) {
  const nodes = json.nodes;
  const parentCounts = new Uint16Array(nodes.length);
  for (const [index, node] of nodes.entries()) {
    validateNodeTransform(node, `${label} node ${index}`);
    if (node.mesh !== undefined) {
      assert.ok(Number.isInteger(node.mesh) && json.meshes[node.mesh], `${label} node ${index} points at a missing mesh.`);
    }
    if (node.children === undefined) continue;
    assert.ok(Array.isArray(node.children), `${label} node ${index} children are invalid.`);
    assert.equal(new Set(node.children).size, node.children.length, `${label} node ${index} repeats a child.`);
    for (const child of node.children) {
      assert.ok(Number.isInteger(child) && nodes[child], `${label} node ${index} points at a missing child.`);
      parentCounts[child] += 1;
      assert.ok(parentCounts[child] <= 1, `${label} node ${child} has multiple parents.`);
    }
  }
  const sceneRoots = json.scenes[json.scene].nodes ?? [];
  assert.ok(sceneRoots.length > 0, `${label} scene has no roots.`);
  assert.equal(new Set(sceneRoots).size, sceneRoots.length, `${label} scene repeats a root.`);
  const states = new Uint8Array(nodes.length);
  let reached = 0;
  const visit = (index) => {
    assert.ok(Number.isInteger(index) && nodes[index], `${label} scene points at a missing root.`);
    assert.notEqual(states[index], 1, `${label} node graph contains a cycle.`);
    if (states[index] === 2) return;
    states[index] = 1;
    reached += 1;
    for (const child of nodes[index].children ?? []) visit(child);
    states[index] = 2;
  };
  for (const root of sceneRoots) {
    assert.equal(parentCounts[root], 0, `${label} scene root ${root} is also a child.`);
    visit(root);
  }
  assert.equal(reached, nodes.length, `${label} contains nodes unreachable from the scene.`);
}

function validateGlbContract(parsed, files, label, expectedKitRoots = undefined) {
  const { json } = parsed;
  assert.equal(json.extensionsUsed, undefined, `${label} must not use glTF extensions.`);
  assert.equal(json.extensionsRequired, undefined, `${label} must not require glTF extensions.`);
  assert.equal(json.skins, undefined, `${label} must not contain skins.`);
  assert.equal(json.animations, undefined, `${label} must not contain animations.`);
  assert.equal(json.cameras, undefined, `${label} must not contain cameras.`);
  assert.ok(!json.extensions?.KHR_lights_punctual, `${label} must not contain lights.`);
  assert.ok(Array.isArray(json.scenes) && json.scenes.length === 1, `${label} must contain one scene.`);
  assert.ok(Number.isInteger(json.scene), `${label} must select a default scene.`);
  assert.ok(Array.isArray(json.nodes) && json.nodes.length > 0, `${label} nodes are missing.`);
  assert.ok(Array.isArray(json.meshes) && json.meshes.length > 0, `${label} meshes are missing.`);
  validateNodeHierarchy(json, label);
  for (const [index, node] of json.nodes.entries()) {
    assert.match(node.name ?? "", /^GW_[\x21-\x7e]+$/, `${label} node ${index} has an invalid name.`);
    assert.ok(!(node.matrix && (node.translation || node.rotation || node.scale)), `${label} node ${index} mixes matrix and TRS.`);
  }
  const materials = json.materials ?? [];
  assert.equal(materials.length, EXPECTED_MATERIALS.length, `${label} must use exactly six materials.`);
  assert.deepEqual(
    [...materials.map((material) => material.name)].sort(),
    [...EXPECTED_MATERIALS].sort(),
    `${label} material names differ from the contract.`,
  );
  for (const material of materials) {
    assert.equal(material.alphaMode ?? "OPAQUE", EXPECTED_ALPHA_MODES.get(material.name), `${material.name} alpha mode is wrong.`);
    assert.equal(material.normalTexture, undefined, `${material.name} contains a normal map.`);
    assert.equal(material.occlusionTexture, undefined, `${material.name} contains an AO map.`);
    assert.equal(material.pbrMetallicRoughness?.metallicRoughnessTexture, undefined, `${material.name} contains a packed material map.`);
  }
  let triangles = 0;
  let scannedIndices = 0;
  const validatedAttributeAccessors = new Set();
  for (const [meshIndex, mesh] of json.meshes.entries()) {
    if (mesh.name !== undefined) {
      assert.match(mesh.name, /^GW_[\x21-\x7e]+$/, `${label} mesh ${meshIndex} has an invalid name.`);
    }
    assert.ok(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, `${label} mesh ${meshIndex} has no primitives.`);
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, `${label} contains a non-triangle primitive.`);
      assert.ok(Number.isInteger(primitive.indices), `${label} contains non-indexed geometry.`);
      assert.ok(Number.isInteger(primitive.material) && materials[primitive.material], `${label} primitive material is invalid.`);
      for (const attribute of ["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"]) {
        assert.ok(Number.isInteger(primitive.attributes?.[attribute]), `${label} primitive is missing ${attribute}.`);
      }
      const attributeAccessors = ["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"]
        .map((attribute) => json.accessors[primitive.attributes[attribute]]);
      assert.ok(attributeAccessors.every(Boolean), `${label} primitive points at a missing attribute accessor.`);
      assert.ok(
        attributeAccessors.every((accessor) => accessor.count === attributeAccessors[0].count),
        `${label} primitive attribute counts disagree.`,
      );
      for (const semantic of ["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"]) {
        const accessorIndex = primitive.attributes[semantic];
        const key = `${semantic}:${accessorIndex}`;
        if (validatedAttributeAccessors.has(key)) continue;
        validateAttributeAccessor(parsed, accessorIndex, semantic, label);
        validatedAttributeAccessors.add(key);
      }
      const indexAccessor = json.accessors[primitive.indices];
      assert.ok(indexAccessor && indexAccessor.type === "SCALAR", `${label} index accessor is invalid.`);
      assert.ok([5121, 5123, 5125].includes(indexAccessor.componentType), `${label} index component type is invalid.`);
      assert.ok(indexAccessor.normalized !== true, `${label} index accessor cannot be normalized.`);
      assert.equal(indexAccessor.count % 3, 0, `${label} triangle index count is invalid.`);
      scannedIndices += indexAccessor.count;
      assert.ok(scannedIndices <= 10_000_000, `${label} contains too many indices to validate safely.`);
      const vertexCount = attributeAccessors[0].count;
      for (let index = 0; index < indexAccessor.count; index += 1) {
        const value = readAccessorElement(parsed, primitive.indices, index)[0];
        assert.ok(Number.isInteger(value) && value < vertexCount, `${label} contains an out-of-range index.`);
      }
      triangles += indexAccessor.count / 3;
    }
  }
  assert.equal(json.textures?.length, 6, `${label} must embed six textures.`);
  assert.equal(json.images?.length, 6, `${label} must embed six images.`);
  assert.equal(
    new Set(json.textures.map((texture) => texture.name)).size,
    6,
    `${label} texture names must be unique.`,
  );
  assert.equal(
    new Set(json.textures.map((texture) => texture.source)).size,
    6,
    `${label} textures must use six distinct embedded images.`,
  );
  for (const texture of json.textures) {
    assert.match(texture.name ?? "", /^GW_TEX_(concrete|metal|jungle|water|signage|emissive)$/, `${label} texture name is invalid.`);
    assert.ok(Number.isInteger(texture.source) && json.images[texture.source], `${label} texture source is invalid.`);
    const role = texture.name.slice("GW_TEX_".length);
    const contract = EXPECTED_TEXTURES.get(role);
    const external = files.get(contract.path);
    assert.ok(external, `Package is missing ${contract.path}.`);
    const embedded = embeddedImageBytes(parsed, json.images[texture.source], `${label} ${role} image`);
    const embeddedPng = parsePng(embedded, `${label} ${role} image`, true);
    assert.equal(
      sha256(embedded.subarray(0, embeddedPng.byteLength)),
      sha256(external),
      `${label} embedded ${role} image differs from its PNG.`,
    );
  }
  if (expectedKitRoots) {
    const sceneRoots = json.scenes[json.scene].nodes ?? [];
    assert.equal(sceneRoots.length, 1, `${label} art kit must have one wrapper root.`);
    const wrapper = json.nodes[sceneRoots[0]];
    assert.equal(wrapper.name, "GW_ARTKIT", `${label} art-kit wrapper is misnamed.`);
    assert.ok(
      wrapper.matrix === undefined
        && wrapper.translation === undefined
        && wrapper.rotation === undefined
        && wrapper.scale === undefined,
      `${label} art-kit wrapper transform must be identity.`,
    );
    const kitRoots = (wrapper.children ?? []).map((index) => json.nodes[index]?.name);
    assert.deepEqual(kitRoots, expectedKitRoots, `${label} top-level kit roots differ from the contract.`);
  }
  return { triangles, meshes: json.meshes.length, nodes: json.nodes.length };
}

function validateAtlasLayout(files) {
  const layout = parseJson(files, "data/GW_ATLAS_LAYOUT.json");
  assert.equal(layout.format, "GREENWATER_ATLAS_LAYOUT", "Atlas layout format is unexpected.");
  assert.equal(layout.version, "1.0", "Atlas layout version is unsupported.");
  assert.ok(Array.isArray(layout.sheets) && layout.sheets.length === 6, "Atlas layout must contain six sheets.");
  let paintedSlots = 0;
  let reservedSlots = 0;
  const roles = new Set();
  for (const sheet of layout.sheets) {
    const contract = EXPECTED_TEXTURES.get(sheet.role);
    assert.ok(contract, `Atlas layout has unexpected role ${sheet.role}.`);
    assert.ok(!roles.has(sheet.role), `Atlas layout repeats ${sheet.role}.`);
    roles.add(sheet.role);
    assert.equal(sheet.file, contract.path.split("/").at(-1), `${sheet.role} atlas filename is wrong.`);
    assert.equal(sheet.size, contract.size, `${sheet.role} atlas size is wrong.`);
    assert.equal(sheet.grid, "4x4", `${sheet.role} atlas grid is wrong.`);
    assert.equal(sheet.slot_size, contract.size / 4, `${sheet.role} slot size is wrong.`);
    assert.equal(sheet.uv_inset_px, 1.5, `${sheet.role} UV inset is wrong.`);
    assert.ok(Array.isArray(sheet.slots) && sheet.slots.length === 16, `${sheet.role} must define 16 slots.`);
    const indices = new Set();
    const names = new Set();
    for (const slot of sheet.slots) {
      assert.ok(Number.isInteger(slot.index) && slot.index >= 0 && slot.index < 16, `${sheet.role} slot index is invalid.`);
      assert.ok(!indices.has(slot.index), `${sheet.role} repeats slot ${slot.index}.`);
      assert.match(slot.name, /^[a-z0-9_]+$/, `${sheet.role} slot name is invalid.`);
      assert.ok(!names.has(slot.name), `${sheet.role} repeats slot name ${slot.name}.`);
      assert.equal(slot.x, (slot.index % 4) * sheet.slot_size, `${sheet.role} slot ${slot.index} x is wrong.`);
      assert.equal(slot.y, Math.floor(slot.index / 4) * sheet.slot_size, `${sheet.role} slot ${slot.index} y is wrong.`);
      assert.equal(slot.w, sheet.slot_size, `${sheet.role} slot ${slot.index} width is wrong.`);
      assert.equal(slot.h, sheet.slot_size, `${sheet.role} slot ${slot.index} height is wrong.`);
      if (slot.name.startsWith("reserved_")) reservedSlots += 1;
      else paintedSlots += 1;
      indices.add(slot.index);
      names.add(slot.name);
    }
    assert.deepEqual(
      sheet.slots.map((slot) => slot.name),
      EXPECTED_ATLAS_SLOTS.get(sheet.role),
      `${sheet.role} atlas slots differ from the frozen contract.`,
    );
  }
  assert.equal(paintedSlots, 71, "Atlas contract must contain 71 painted slots.");
  assert.equal(reservedSlots, 25, "Atlas contract must contain 25 reserved slots.");
  return { paintedSlots, reservedSlots };
}

function validateKitCounts(files, glbSummary) {
  const counts = parseJson(files, "data/GW_KIT_COUNTS.json");
  assert.equal(counts.format, "GREENWATER_KIT_COUNTS", "Kit-count format is unexpected.");
  assert.equal(counts.version, "1.0", "Kit-count version is unsupported.");
  assert.equal(counts.roots, 44, "Kit-count root total must be 44.");
  assert.ok(Array.isArray(counts.per_root) && counts.per_root.length === 44, "Kit-count per-root list must contain 44 entries.");
  assert.deepEqual(counts.per_root.map((root) => root.name), EXPECTED_KIT_ROOTS, "Kit-count roots differ from the contract.");
  assert.equal(counts.named_meshes, glbSummary.meshes, "Kit-count mesh total differs from the GLB.");
  assert.equal(counts.triangles, glbSummary.triangles, "Kit-count triangle total differs from the GLB.");
  assert.equal(counts.textures, 6, "Kit-count texture total must be six.");
  assert.ok(counts.per_root.every((root) => Array.isArray(root.variants_missing) && root.variants_missing.length === 0), "Kit-count report has missing variants.");
}

function validatePackageFileSet(files, stage) {
  const expected = new Set([
    ...COMMON_PACKAGE_FILES,
    "VALIDATION.json",
    "HANDOFF.md",
    "MANIFEST.json",
    ...(stage >= 2 ? [
      "models/greenwater_environment_runtime.glb",
      "data/greenwater_art_placements.json",
      "data/GW_BUDGET.json",
    ] : []),
    ...(stage >= 3 ? [
      "data/GW_STAGE3_ACCEPTANCE.json",
      ...EXPECTED_STAGE_THREE_SOURCE_FILES,
      ...EXPECTED_PREVIEW_FILES,
    ] : []),
  ]);
  assert.deepEqual(
    [...files.keys()].sort(),
    [...expected].sort(),
    `Stage ${stage} package file set differs from the frozen contract.`,
  );
}

function validateSourceMap(files) {
  const map = parseJson(files, "source/data/greenwater-blockout.json");
  assert.equal(map.format, "FUTURISMA_MAP_BLOCKOUT", "Map source format is unexpected.");
  assert.equal(map.version, "1.0", "Map source version is unsupported.");
  assert.equal(map.centreline?.lapLength, 2515.982, "Map lap length differs from the accepted blockout.");
  assert.equal(map.centreline?.sampleCount, 1258, "Map sample count differs from the accepted blockout.");
  assert.ok(
    Array.isArray(map.centreline?.samples)
      && map.centreline.samples.length === map.centreline.sampleCount,
    "Map centreline sample array is incomplete.",
  );
  assert.deepEqual(map.sectors?.map((sector) => sector.name), EXPECTED_SECTORS, "Map sectors differ from the accepted blockout.");
  for (const hazard of map.hazards ?? []) {
    if (!["steam_vent", "cable_coil"].includes(hazard.type)) continue;
    assert.ok(Number.isFinite(hazard.distance), `${hazard.id} distance is invalid.`);
    assert.ok(Number.isFinite(hazard.lateralOffset), `${hazard.id} lateralOffset is invalid.`);
  }
  return map;
}

function validateStageOne(files, manifest) {
  for (const path of [
    "models/greenwater_artkit.glb",
    "data/GW_ATLAS_LAYOUT.json",
    "data/GW_KIT_COUNTS.json",
    "VALIDATION.json",
    "HANDOFF.md",
  ]) {
    assert.ok(files.has(path), `Stage 1 package is missing ${path}.`);
  }
  const dimensions = new Map();
  for (const [role, contract] of EXPECTED_TEXTURES) {
    const png = files.get(contract.path);
    assert.ok(png, `Stage 1 package is missing ${contract.path}.`);
    const size = parsePng(png, contract.path);
    assert.equal(size.width, contract.size, `${role} atlas width is wrong.`);
    assert.equal(size.height, contract.size, `${role} atlas height is wrong.`);
    dimensions.set(role, size);
  }
  const parsedGlb = parseGlb(files.get("models/greenwater_artkit.glb"), "greenwater_artkit.glb");
  const glbSummary = validateGlbContract(
    parsedGlb,
    files,
    "greenwater_artkit.glb",
    EXPECTED_KIT_ROOTS,
  );
  const atlas = validateAtlasLayout(files);
  validateKitCounts(files, glbSummary);
  const validation = parseJson(files, "VALIDATION.json");
  assert.equal(validation.artkit?.pass, true, "Stage 1 validation is not PASS.");
  assert.ok(
    Array.isArray(validation.artkit.checks)
      && validation.artkit.checks.length >= 19
      && validation.artkit.checks.every((check) => check.pass === true),
    "Stage 1 validation checks are incomplete or failing.",
  );
  assert.equal(validation.artkit.binary?.nonFinite, 0, "Stage 1 art-kit binary audit found non-finite values.");
  assert.equal(validation.artkit.binary?.colourOutOfRange, 0, "Stage 1 art-kit vertex colours are outside 0..1.");
  assert.equal(validation.artkit.binary?.indexOutOfRange, 0, "Stage 1 art-kit indices are out of range.");
  validateSourceMap(files);
  assert.equal(manifest.art_kit?.roots, 44, "Manifest art-kit root total must be 44.");
  assert.equal(manifest.art_kit?.named_meshes, glbSummary.meshes, "Manifest mesh total differs from the GLB.");
  assert.equal(manifest.art_kit?.triangles, glbSummary.triangles, "Manifest triangle total differs from the GLB.");
  assert.equal(manifest.material_roles, 6, "Manifest material-role total must be six.");
  return { ...glbSummary, ...atlas, dimensions };
}

function meshTriangleCount(json, meshIndex) {
  return json.meshes[meshIndex].primitives.reduce(
    (total, primitive) => total + json.accessors[primitive.indices].count / 3,
    0,
  );
}

function hasIdentityTransform(node) {
  return node.matrix === undefined
    && node.translation === undefined
    && node.rotation === undefined
    && node.scale === undefined;
}

function validatePlacements(files, manifest, map) {
  const data = parseJson(files, "data/greenwater_art_placements.json");
  assert.equal(data.format, "GREENWATER_ART_PLACEMENTS", "Placement format is unexpected.");
  assert.equal(data.version, "1.0", "Placement version is unsupported.");
  assert.equal(data.map, "MAP01_GREENWATER_STRIP", "Placement map identifier is unexpected.");
  assert.equal(data.centreline_m, map.centreline.lapLength, "Placement lap length differs from the source map.");
  assert.deepEqual(data.coordinates, {
    unit: "metre",
    up: "+Y",
    axes: "+X east, +Z south, right-handed",
    origin: "centre of the start/finish line on the surface",
  }, "Placement coordinates differ from the contract.");
  assert.ok(Array.isArray(data.sector_groups), "Placement sector-group table is missing.");
  assert.ok(Array.isArray(data.placements), "Placement list is missing.");
  assert.equal(data.sector_groups.length, 63, "Placement file must declare 63 merged groups.");
  assert.equal(data.placements.length, 2267, "Placement file must contain 2,267 placements.");

  const roles = new Set(EXPECTED_TEXTURES.keys());
  const groupNames = new Set();
  let groupTriangles = 0;
  for (const group of data.sector_groups) {
    assert.match(group.name ?? "", /^GW_[A-Z0-9_]+_(concrete|metal|jungle|water|signage|emissive|mast)$/, `Invalid runtime group name ${group.name}.`);
    assert.ok(!groupNames.has(group.name), `Placement file repeats runtime group ${group.name}.`);
    assert.ok(EXPECTED_SECTORS.includes(group.sector), `${group.name} uses an unknown sector.`);
    assert.ok(roles.has(group.role), `${group.name} uses an unknown material role.`);
    assert.ok(Number.isSafeInteger(group.triangles) && group.triangles > 0, `${group.name} triangle count is invalid.`);
    assert.ok(Number.isFinite(group.cull_distance_m) && group.cull_distance_m > 0, `${group.name} cull distance is invalid.`);
    if (group.name === "GW_LM_ANTENNA_LOD1_mast") {
      assert.equal(group.sector, "CANOPY_PASSAGE", "Antenna LOD sector is wrong.");
      assert.equal(group.role, "metal", "Antenna LOD material role is wrong.");
      assert.equal(group.cull_distance_m, 1800, "Antenna LOD cull distance is wrong.");
    } else {
      assert.equal(group.name, `GW_SECTOR_${group.sector}_${group.role}`, `${group.name} does not match its sector and role.`);
      assert.equal(group.cull_distance_m, data.group_cull_distances?.[group.role], `${group.name} cull distance differs from its role.`);
    }
    groupNames.add(group.name);
    groupTriangles += group.triangles;
  }
  assert.equal(groupTriangles, 55488, "Placement group triangles differ from the Stage 2 contract.");

  const ids = new Set();
  const modules = new Set();
  for (const placement of data.placements) {
    assert.match(placement.id ?? "", /^GW_PLACE_[A-Za-z0-9_]+$/, "Placement ID is invalid.");
    assert.ok(!ids.has(placement.id), `Placement ID is repeated: ${placement.id}.`);
    assert.ok(
      EXPECTED_KIT_ROOTS.includes(placement.module) || placement.module === "GW_LM_ANTENNA_LOD1",
      `${placement.id} uses unknown module ${placement.module}.`,
    );
    assert.ok(EXPECTED_SECTORS.includes(placement.sector), `${placement.id} uses unknown sector ${placement.sector}.`);
    assert.ok(
      Array.isArray(placement.position)
        && placement.position.length === 3
        && placement.position.every(Number.isFinite),
      `${placement.id} position must contain three finite numbers; got ${JSON.stringify(placement.position)}.`,
    );
    assert.ok(
      placement.position.every((component) => Math.abs(component) <= 5000),
      `${placement.id} position exceeds the world safety bound.`,
    );
    assert.ok(Number.isFinite(placement.rotation_y_deg), `${placement.id} rotation is invalid.`);
    assert.ok(Number.isFinite(placement.scale) && placement.scale > 0 && placement.scale <= 10, `${placement.id} scale is invalid.`);
    assert.ok(
      Array.isArray(placement.material_roles)
        && placement.material_roles.length > 0
        && new Set(placement.material_roles).size === placement.material_roles.length
        && placement.material_roles.every((role) => roles.has(role)),
      `${placement.id} material roles are invalid.`,
    );
    assert.ok(
      Number.isFinite(placement.cull_distance_m)
        && placement.cull_distance_m > 0
        && placement.cull_distance_m <= 2000,
      `${placement.id} cull distance is invalid.`,
    );
    assert.ok(
      placement.lod === null || placement.lod === "GW_LM_ANTENNA_LOD1",
      `${placement.id} LOD reference is invalid.`,
    );
    for (const role of placement.material_roles) {
      const expectedGroup = placement.module === "GW_LM_ANTENNA_LOD1"
        ? "GW_LM_ANTENNA_LOD1_mast"
        : `GW_SECTOR_${placement.sector}_${role}`;
      assert.ok(groupNames.has(expectedGroup), `${placement.id} has no matching runtime group for ${role}.`);
    }
    ids.add(placement.id);
    modules.add(placement.module);
  }
  assert.equal(data.counts?.placements, data.placements.length, "Placement count summary is wrong.");
  assert.equal(data.counts?.merged_groups, data.sector_groups.length, "Merged-group count summary is wrong.");
  assert.equal(data.counts?.kit_roots_used, modules.size, "Used-root count summary is wrong.");
  assert.equal(data.counts?.triangles, groupTriangles, "Placement triangle summary is wrong.");
  assert.equal(manifest.runtime?.placements, data.placements.length, "Manifest placement count is wrong.");
  assert.equal(manifest.runtime?.merged_groups, data.sector_groups.length, "Manifest merged-group count is wrong.");
  assert.equal(manifest.runtime?.kit_roots_used, modules.size, "Manifest used-root count is wrong.");
  assert.equal(manifest.runtime?.triangles, groupTriangles, "Manifest runtime triangle count is wrong.");
  assert.equal(manifest.runtime?.sectors, EXPECTED_SECTORS.length, "Manifest sector count is wrong.");
  assert.equal(manifest.runtime?.collides, false, "Environment art must remain non-colliding.");
  return { data, groupNames, groupTriangles };
}

function validateRuntimeHierarchy(parsed, placementSummary) {
  const { json } = parsed;
  const sceneRoots = json.scenes[json.scene].nodes ?? [];
  assert.equal(sceneRoots.length, 1, "Runtime GLB must have one scene root.");
  const wrapper = json.nodes[sceneRoots[0]];
  assert.equal(wrapper.name, "GW_ENVIRONMENT_RUNTIME", "Runtime GLB wrapper is misnamed.");
  assert.ok(hasIdentityTransform(wrapper), "Runtime GLB wrapper transform must be identity.");
  assert.deepEqual(
    (wrapper.children ?? []).map((index) => json.nodes[index]?.name),
    [...EXPECTED_SECTORS.map((sector) => `GW_SECTOR_${sector}`), "GW_LM_ANTENNA_LOD1"],
    "Runtime GLB sector holders differ from the contract.",
  );

  const meshNodes = json.nodes.filter((node) => node.mesh !== undefined);
  assert.equal(meshNodes.length, placementSummary.data.sector_groups.length, "Runtime GLB mesh-node total differs from placements.");
  assert.deepEqual(
    [...meshNodes.map((node) => node.name)].sort(),
    [...placementSummary.groupNames].sort(),
    "Runtime GLB mesh-node names differ from placement groups.",
  );
  assert.equal(new Set(meshNodes.map((node) => node.mesh)).size, meshNodes.length, "Runtime GLB reuses a mesh across group nodes.");
  const placementGroups = new Map(placementSummary.data.sector_groups.map((group) => [group.name, group]));
  for (const node of meshNodes) {
    assert.ok(hasIdentityTransform(node), `${node.name} transform must be baked and identity.`);
    const mesh = json.meshes[node.mesh];
    assert.equal(mesh.primitives.length, 1, `${node.name} must contain one merged primitive.`);
    const group = placementGroups.get(node.name);
    assert.equal(meshTriangleCount(json, node.mesh), group.triangles, `${node.name} triangle count differs from placements.`);
    assert.equal(
      json.materials[mesh.primitives[0].material].name,
      `GW_MAT_${group.role}`,
      `${node.name} material differs from placements.`,
    );
  }
}

function validateBudget(files, manifest, placementSummary) {
  const budget = parseJson(files, "data/GW_BUDGET.json");
  const placementGroups = new Map(
    placementSummary.data.sector_groups.map((group) => [group.name, group]),
  );
  assert.equal(budget.format, "GREENWATER_BUDGET_MEASUREMENT", "Budget format is unexpected.");
  assert.equal(budget.version, "1.0", "Budget version is unsupported.");
  assert.deepEqual(budget.limits, { drawCalls: 24, triangles: 175000 }, "Budget limits differ from the contract.");
  assert.equal(budget.pass, true, "Stage 2 budget result is not PASS.");
  assert.ok(Array.isArray(budget.trace) && budget.trace.length === 420, "Budget trace must contain 420 stations.");
  for (const [index, station] of budget.trace.entries()) {
    assert.equal(station.station, index * 6, `Budget station ${index} is not on the 6 m interval.`);
    assert.ok(EXPECTED_SECTORS.includes(station.sector), `Budget station ${index} uses an unknown sector.`);
    assert.ok(Number.isSafeInteger(station.drawCalls) && station.drawCalls >= 0, `Budget station ${index} draw calls are invalid.`);
    assert.ok(Number.isSafeInteger(station.triangles) && station.triangles >= 0, `Budget station ${index} triangles are invalid.`);
    assert.ok(station.drawCalls <= budget.limits.drawCalls, `Budget station ${index} exceeds the draw-call limit.`);
    assert.ok(station.triangles <= budget.limits.triangles, `Budget station ${index} exceeds the triangle limit.`);
  }
  const worstCalls = budget.trace.reduce((worst, station) => station.drawCalls > worst.drawCalls ? station : worst);
  const worstTriangles = budget.trace.reduce((worst, station) => station.triangles > worst.triangles ? station : worst);
  for (const [label, declared, measured] of [
    ["draw calls", budget.worst_draw_calls, worstCalls],
    ["triangles", budget.worst_triangles, worstTriangles],
  ]) {
    assert.equal(declared.station, measured.station, `Worst ${label} station is wrong.`);
    assert.equal(declared.sector, measured.sector, `Worst ${label} sector is wrong.`);
    assert.equal(declared.drawCalls, measured.drawCalls, `Worst ${label} draw-call count is wrong.`);
    assert.equal(declared.triangles, measured.triangles, `Worst ${label} triangle count is wrong.`);
    assert.ok(Array.isArray(declared.visible), `Worst ${label} visible-group list is missing.`);
    assert.equal(new Set(declared.visible).size, declared.visible.length, `Worst ${label} repeats a visible group.`);
    assert.ok(declared.visible.every((name) => placementSummary.groupNames.has(name)), `Worst ${label} names an unknown group.`);
    assert.equal(declared.visible.length, declared.drawCalls, `Worst ${label} visible-group count differs from draw calls.`);
    const triangleTotal = declared.visible.reduce(
      (total, name) => total + placementGroups.get(name).triangles,
      0,
    );
    assert.equal(triangleTotal, declared.triangles, `Worst ${label} visible triangles do not add up.`);
  }
  assert.equal(manifest.budgets?.pass, true, "Manifest budget result is not PASS.");
  assert.equal(manifest.budgets?.worst_visible_draw_calls, budget.worst_draw_calls.drawCalls, "Manifest worst draw-call count is wrong.");
  assert.equal(manifest.budgets?.draw_call_limit, budget.limits.drawCalls, "Manifest draw-call limit is wrong.");
  assert.equal(manifest.budgets?.worst_visible_triangles, budget.worst_triangles.triangles, "Manifest worst triangle count is wrong.");
  assert.equal(manifest.budgets?.triangle_limit, budget.limits.triangles, "Manifest triangle limit is wrong.");
  return budget;
}

function validateStageTwo(files, manifest, stageOneSummary) {
  const map = validateSourceMap(files);
  const placementSummary = validatePlacements(files, manifest, map);
  const runtime = parseGlb(files.get("models/greenwater_environment_runtime.glb"), "greenwater_environment_runtime.glb");
  const runtimeSummary = validateGlbContract(runtime, files, "greenwater_environment_runtime.glb");
  validateRuntimeHierarchy(runtime, placementSummary);
  assert.equal(runtimeSummary.triangles, placementSummary.groupTriangles, "Runtime GLB triangles differ from placements.");
  validateBudget(files, manifest, placementSummary);
  const validation = parseJson(files, "VALIDATION.json");
  assert.equal(validation.artkit?.pass, true, "Stage 2 art-kit validation is not PASS.");
  assert.equal(validation.runtime?.pass, true, "Stage 2 runtime validation is not PASS.");
  assert.ok(
    Array.isArray(validation.runtime.checks)
      && validation.runtime.checks.length >= 19
      && validation.runtime.checks.every((check) => check.pass === true),
    "Stage 2 runtime validation checks are incomplete or failing.",
  );
  assert.equal(validation.runtime.binary?.nonFinite, 0, "Stage 2 runtime binary audit found non-finite values.");
  assert.equal(validation.runtime.binary?.colourOutOfRange, 0, "Stage 2 runtime vertex colours are outside 0..1.");
  assert.equal(validation.runtime.binary?.indexOutOfRange, 0, "Stage 2 runtime indices are out of range.");
  assert.equal(validation.budgets?.pass, true, "Stage 2 packaged budget validation is not PASS.");
  return { ...stageOneSummary, runtime: runtimeSummary, placements: placementSummary.data.placements.length };
}

function validateStageThree(files, manifest, stageTwoSummary) {
  for (const path of EXPECTED_PREVIEW_FILES) {
    const preview = parsePng(files.get(path), path);
    assert.equal(preview.width, 1600, `${path} width is wrong.`);
    assert.equal(preview.height, 1000, `${path} height is wrong.`);
  }

  const acceptance = parseJson(files, "data/GW_STAGE3_ACCEPTANCE.json");
  assert.equal(acceptance.format, "GREENWATER_STAGE3_ACCEPTANCE", "Stage 3 acceptance format is unexpected.");
  assert.equal(acceptance.version, "1.0", "Stage 3 acceptance version is unsupported.");
  assert.equal(acceptance.budgets?.pass, true, "Stage 3 packaged budget result is not PASS.");
  assert.deepEqual(acceptance.budgets?.limits, { drawCalls: 24, triangles: 175000 }, "Stage 3 budget limits differ from the contract.");
  assert.ok(Array.isArray(acceptance.stations) && acceptance.stations.length === 6, "Stage 3 must describe six render stations.");
  for (const station of acceptance.stations) {
    assert.equal(station.station_m, EXPECTED_PREVIEW_STATIONS.get(station.id), `${station.id} station distance is wrong.`);
    assert.ok(EXPECTED_SECTORS.includes(station.sector), `${station.id} uses an unknown sector.`);
    assert.ok(typeof station.next_opening === "string" && station.next_opening.length > 0, `${station.id} next-opening note is missing.`);
    assert.ok(typeof station.orientation_landmark === "string" && station.orientation_landmark.length > 0, `${station.id} landmark note is missing.`);
    assert.ok(typeof station.deliberate_occluder === "string" && station.deliberate_occluder.length > 0, `${station.id} occluder note is missing.`);
    assert.equal(station.measured?.lookahead_m, 105, `${station.id} readability lookahead is wrong.`);
    const expectedFiles = [
      `previews/${station.id}_beauty.png`,
      `previews/silhouette/${station.id}_silhouette.png`,
      `previews/material_id/${station.id}_material_id.png`,
    ];
    assert.deepEqual([...station.files].sort(), expectedFiles.sort(), `${station.id} render files differ from the contract.`);
  }

  assert.equal(acceptance.readability?.status, "HUMAN_SIGN_OFF_REQUIRED", "Stage 3 readability status must require human sign-off.");
  assert.equal(acceptance.readability?.counts_toward_render_verdict, false, "Readability must remain outside the automated render verdict.");
  assert.ok(Array.isArray(acceptance.readability?.measured) && acceptance.readability.measured.length === 6, "Stage 3 readability measurements are incomplete.");
  for (const measurement of acceptance.readability.measured) {
    assert.equal(measurement.station_m, EXPECTED_PREVIEW_STATIONS.get(measurement.id), `${measurement.id} readability station is wrong.`);
    assert.ok(Number.isFinite(measurement.margin), `${measurement.id} readability margin is invalid.`);
    assert.equal(typeof measurement.opening_is_brightest_window, "boolean", `${measurement.id} readability verdict is invalid.`);
  }

  const validation = parseJson(files, "VALIDATION.json");
  assert.equal(validation.renders?.pass, true, "Stage 3 render validation is not PASS.");
  assert.equal(validation.renders?.frames, 18, "Stage 3 render validation must cover 18 frames.");
  assert.ok(
    Array.isArray(validation.renders.checks)
      && validation.renders.checks.length === 8
      && validation.renders.checks.every((check) => check.pass === true),
    "Stage 3 objective render checks are incomplete or failing.",
  );
  assert.deepEqual(validation.renders.readability, acceptance.readability, "Stage 3 readability reports disagree.");
  assert.deepEqual(validation.acceptance, acceptance, "Stage 3 acceptance report differs from VALIDATION.json.");

  const integrity = validation.geometry_integrity;
  assert.equal(integrity?.deckFacesUp, true, "Stage 4 deck winding correction is not PASS.");
  assert.ok(Array.isArray(integrity.deckNormals) && integrity.deckNormals.length === 12, "Stage 4 deck-normal audit must cover all twelve sectors.");
  assert.deepEqual(integrity.deckNormals.map((entry) => entry.sector), EXPECTED_SECTORS, "Stage 4 deck-normal sectors differ from the map.");
  assert.ok(
    integrity.deckNormals.every((entry) => entry.surface_normals_up > 0 && entry.surface_normals_down === 0 && entry.triangles > 0),
    "Stage 4 deck-normal audit found a downward surface.",
  );
  assert.equal(
    integrity.deckNormals.reduce((total, entry) => total + entry.triangles, 0),
    2516,
    "Stage 4 deck-normal triangle coverage is incomplete.",
  );

  const runtime = parseGlb(files.get("models/greenwater_environment_runtime.glb"), "Stage 3 runtime GLB");
  assert.ok(runtime.json.materials.every((material) => material.doubleSided !== true), "Stage 3 runtime must retain backface culling.");
  return { ...stageTwoSummary, renders: EXPECTED_PREVIEW_FILES.length };
}

function normalizedMaterial(parsed, material) {
  const clone = structuredClone(material);
  for (const key of ["normalTexture", "occlusionTexture", "emissiveTexture"]) {
    if (clone[key]?.index !== undefined) clone[key].index = parsed.json.textures[clone[key].index]?.name;
  }
  const pbr = clone.pbrMetallicRoughness;
  for (const key of ["baseColorTexture", "metallicRoughnessTexture"]) {
    if (pbr?.[key]?.index !== undefined) pbr[key].index = parsed.json.textures[pbr[key].index]?.name;
  }
  return clone;
}

function compareMaterialContracts(current, reference, label) {
  const currentMaterials = new Map(current.json.materials.map((material) => [material.name, normalizedMaterial(current, material)]));
  const referenceMaterials = new Map(reference.json.materials.map((material) => [material.name, normalizedMaterial(reference, material)]));
  assert.deepEqual([...currentMaterials.keys()].sort(), [...referenceMaterials.keys()].sort(), `${label} material names changed.`);
  for (const [name, material] of currentMaterials) {
    assert.deepEqual(material, referenceMaterials.get(name), `${label} changed material ${name}.`);
  }
}

function compareGlbGeometry(current, reference, label, allowDeckWindingCorrection = false) {
  for (const key of ["scenes", "scene", "nodes", "samplers"]) {
    assert.deepEqual(current.json[key], reference.json[key], `${label} changed ${key}.`);
  }
  compareMaterialContracts(current, reference, label);
  const currentMeshNodes = current.json.nodes.filter((node) => node.mesh !== undefined);
  const referenceMeshNodes = reference.json.nodes.filter((node) => node.mesh !== undefined);
  assert.equal(currentMeshNodes.length, current.json.meshes.length, `${label} must use one named node per mesh.`);
  assert.equal(referenceMeshNodes.length, reference.json.meshes.length, `${label} reference must use one named node per mesh.`);
  const currentMeshes = new Map(currentMeshNodes.map((node) => [node.name, current.json.meshes[node.mesh]]));
  const referenceMeshes = new Map(referenceMeshNodes.map((node) => [node.name, reference.json.meshes[node.mesh]]));
  assert.equal(currentMeshes.size, currentMeshNodes.length, `${label} mesh-node names must be unique.`);
  assert.equal(referenceMeshes.size, referenceMeshNodes.length, `${label} reference mesh-node names must be unique.`);
  assert.deepEqual([...currentMeshes.keys()].sort(), [...referenceMeshes.keys()].sort(), `${label} mesh names changed.`);
  const correctedDecks = [];
  let accessorsMatched = 0;
  for (const [meshName, currentMesh] of currentMeshes) {
    const referenceMesh = referenceMeshes.get(meshName);
    assert.equal(currentMesh.primitives.length, referenceMesh.primitives.length, `${label} changed ${meshName} primitive count.`);
    for (let primitiveIndex = 0; primitiveIndex < currentMesh.primitives.length; primitiveIndex += 1) {
      const currentPrimitive = currentMesh.primitives[primitiveIndex];
      const referencePrimitive = referenceMesh.primitives[primitiveIndex];
      assert.equal(currentPrimitive.mode ?? 4, referencePrimitive.mode ?? 4, `${label} changed ${meshName} primitive mode.`);
      assert.equal(
        current.json.materials[currentPrimitive.material].name,
        reference.json.materials[referencePrimitive.material].name,
        `${label} changed ${meshName} material role.`,
      );
      assert.deepEqual(
        Object.keys(currentPrimitive.attributes).sort(),
        Object.keys(referencePrimitive.attributes).sort(),
        `${label} changed ${meshName} vertex attributes.`,
      );
      const isDeck = allowDeckWindingCorrection && /^GW_SECTOR_[A-Z0-9_]+_concrete$/.test(meshName);
      for (const semantic of Object.keys(currentPrimitive.attributes)) {
        const currentAccessorIndex = currentPrimitive.attributes[semantic];
        const referenceAccessorIndex = referencePrimitive.attributes[semantic];
        const includeBounds = !(isDeck && semantic === "NORMAL");
        assert.deepEqual(
          accessorContract(current.json.accessors[currentAccessorIndex], includeBounds),
          accessorContract(reference.json.accessors[referenceAccessorIndex], includeBounds),
          `${label} changed ${meshName} ${semantic} accessor contract.`,
        );
        const bytesMatch = accessorPayload(current, currentAccessorIndex)
          .equals(accessorPayload(reference, referenceAccessorIndex));
        if (isDeck && semantic === "NORMAL") {
          assert.equal(bytesMatch, false, `${label} did not correct ${meshName} normals.`);
        } else {
          assert.equal(bytesMatch, true, `${label} changed ${meshName} ${semantic} bytes.`);
          accessorsMatched += 1;
        }
      }
      assert.deepEqual(
        accessorContract(current.json.accessors[currentPrimitive.indices]),
        accessorContract(reference.json.accessors[referencePrimitive.indices]),
        `${label} changed ${meshName} index accessor contract.`,
      );
      const indicesMatch = accessorPayload(current, currentPrimitive.indices)
        .equals(accessorPayload(reference, referencePrimitive.indices));
      if (isDeck) {
        assert.equal(indicesMatch, false, `${label} did not correct ${meshName} triangle winding.`);
        correctedDecks.push(meshName);
      } else {
        assert.equal(indicesMatch, true, `${label} changed ${meshName} index bytes.`);
        accessorsMatched += 1;
      }
    }
  }
  if (allowDeckWindingCorrection) {
    assert.deepEqual(
      correctedDecks.sort(),
      EXPECTED_SECTORS.map((sector) => `GW_SECTOR_${sector}_concrete`).sort(),
      `${label} corrected a set other than the twelve sector decks.`,
    );
  }
  return { accessorsMatched, correctedDecks: correctedDecks.length };
}

function compareArtKitContract(files, referenceFiles) {
  const current = parseGlb(files.get("models/greenwater_artkit.glb"), "Stage 2 greenwater_artkit.glb");
  const reference = parseGlb(referenceFiles.get("models/greenwater_artkit.glb"), "accepted Stage 1 greenwater_artkit.glb");
  for (const key of ["scenes", "scene", "nodes", "meshes", "accessors", "materials", "textures", "samplers"]) {
    assert.deepEqual(current.json[key], reference.json[key], `Stage 2 changed accepted art-kit ${key}.`);
  }

  const currentImageViews = new Set((current.json.images ?? []).map((image) => image.bufferView));
  const referenceImageViews = new Set((reference.json.images ?? []).map((image) => image.bufferView));
  const currentGeometryViews = current.json.bufferViews
    .map((view, index) => ({ view, index }))
    .filter(({ index }) => !currentImageViews.has(index));
  const referenceGeometryViews = reference.json.bufferViews
    .map((view, index) => ({ view, index }))
    .filter(({ index }) => !referenceImageViews.has(index));
  assert.equal(currentGeometryViews.length, referenceGeometryViews.length, "Stage 2 changed the accepted art-kit geometry buffer count.");
  for (let index = 0; index < currentGeometryViews.length; index += 1) {
    const currentView = currentGeometryViews[index].view;
    const referenceView = referenceGeometryViews[index].view;
    assert.deepEqual(currentView, referenceView, `Stage 2 changed accepted art-kit geometry bufferView ${index}.`);
    const currentStart = currentView.byteOffset ?? 0;
    const referenceStart = referenceView.byteOffset ?? 0;
    assert.ok(
      current.binary.subarray(currentStart, currentStart + currentView.byteLength)
        .equals(reference.binary.subarray(referenceStart, referenceStart + referenceView.byteLength)),
      `Stage 2 changed accepted art-kit geometry bytes in bufferView ${index}.`,
    );
  }
  return currentGeometryViews.length;
}

function compareKitCountContract(files, referenceFiles) {
  const current = structuredClone(parseJson(files, "data/GW_KIT_COUNTS.json"));
  const reference = structuredClone(parseJson(referenceFiles, "data/GW_KIT_COUNTS.json"));
  delete current.glb?.sha256;
  delete reference.glb?.sha256;
  assert.deepEqual(current, reference, "Stage 2 changed the accepted kit-count contract beyond its GLB container hash.");
}

function compareStageOneReference(files, referenceFiles) {
  for (const path of EXACT_STAGE_ONE_REFERENCE_FILES) {
    assert.ok(files.get(path).equals(referenceFiles.get(path)), `Stage 2 changed accepted Stage 1 file ${path}.`);
  }
  const geometryBufferViewsMatched = compareArtKitContract(files, referenceFiles);
  compareKitCountContract(files, referenceFiles);
  return {
    exactFilesMatched: EXACT_STAGE_ONE_REFERENCE_FILES.length,
    semanticAssetsMatched: 2,
    geometryBufferViewsMatched,
  };
}

function compareStageTwoReference(files, referenceFiles) {
  for (const path of EXACT_STAGE_TWO_REFERENCE_FILES) {
    assert.ok(files.get(path).equals(referenceFiles.get(path)), `Final package changed accepted Stage 2 file ${path}.`);
  }
  const currentArtKit = parseGlb(files.get("models/greenwater_artkit.glb"), "final greenwater_artkit.glb");
  const referenceArtKit = parseGlb(referenceFiles.get("models/greenwater_artkit.glb"), "accepted Stage 2 greenwater_artkit.glb");
  const artKit = compareGlbGeometry(currentArtKit, referenceArtKit, "Final package art kit");
  compareKitCountContract(files, referenceFiles);

  const currentRuntime = parseGlb(files.get("models/greenwater_environment_runtime.glb"), "final runtime GLB");
  const referenceRuntime = parseGlb(referenceFiles.get("models/greenwater_environment_runtime.glb"), "accepted Stage 2 runtime GLB");
  const runtime = compareGlbGeometry(currentRuntime, referenceRuntime, "Final package runtime", true);
  return {
    exactFilesMatched: EXACT_STAGE_TWO_REFERENCE_FILES.length,
    semanticAssetsMatched: 3,
    geometryBufferViewsMatched: undefined,
    accessorPayloadsMatched: artKit.accessorsMatched + runtime.accessorsMatched,
    correctedDecks: runtime.correctedDecks,
  };
}

export function validateGreenwaterPackageBuffer(
  input,
  { referencePackage, stageOneReference, stageTwoReference } = {},
) {
  const archiveFiles = readZipArchive(input);
  const files = resolvePackageFiles(archiveFiles);
  const manifest = parseJson(files, "MANIFEST.json");
  validateManifestFiles(files, manifest);
  assert.ok([1, 2, 3].includes(manifest.stage), "Only Stage 1, Stage 2 and final v1.0 package contracts are supported.");
  const expectedPackageName = manifest.stage === 3
    ? "GREENWATER_ENVIRONMENT_v1.0.zip"
    : `GREENWATER_ENVIRONMENT_STAGE${manifest.stage}.zip`;
  assert.equal(manifest.package, expectedPackageName, "Manifest package name is wrong.");
  validatePackageFileSet(files, manifest.stage);
  const stageOneSummary = validateStageOne(files, manifest);
  const stageTwoSummary = manifest.stage >= 2
    ? validateStageTwo(files, manifest, stageOneSummary)
    : undefined;
  const summary = manifest.stage === 3
    ? validateStageThree(files, manifest, stageTwoSummary)
    : stageTwoSummary ?? stageOneSummary;

  const comparisonBytes = referencePackage
    ?? (manifest.stage === 3 ? stageTwoReference : stageOneReference);
  let referenceComparison;
  if (comparisonBytes !== undefined) {
    const referenceArchive = readZipArchive(comparisonBytes);
    const referenceFiles = resolvePackageFiles(referenceArchive);
    const referenceManifest = parseJson(referenceFiles, "MANIFEST.json");
    validateManifestFiles(referenceFiles, referenceManifest);
    const expectedReferenceStage = manifest.stage - 1;
    assert.equal(referenceManifest.stage, expectedReferenceStage, `The comparison package must be Stage ${expectedReferenceStage}.`);
    validatePackageFileSet(referenceFiles, referenceManifest.stage);
    const referenceStageOne = validateStageOne(referenceFiles, referenceManifest);
    if (referenceManifest.stage === 1) {
      referenceComparison = compareStageOneReference(files, referenceFiles);
    } else {
      validateStageTwo(referenceFiles, referenceManifest, referenceStageOne);
      referenceComparison = compareStageTwoReference(files, referenceFiles);
    }
  }
  return {
    stage: manifest.stage,
    entries: files.size,
    roots: manifest.art_kit.roots,
    meshes: summary.meshes,
    triangles: summary.triangles,
    paintedSlots: summary.paintedSlots,
    reservedSlots: summary.reservedSlots,
    runtimeMeshes: summary.runtime?.meshes,
    runtimeTriangles: summary.runtime?.triangles,
    placements: summary.placements,
    renders: summary.renders,
    ...referenceComparison,
  };
}
