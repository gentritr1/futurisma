import assert from "node:assert/strict";
import {
  crc32,
  parseGlb,
  readZipArchive,
  validateArchivePath,
  validateManifestFiles,
} from "./lib/greenwater-package-validator.mjs";

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(value);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

function expectFailure(action, pattern) {
  assert.throws(action, pattern);
}

function binaryGlb(json, binary) {
  const jsonSource = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - (jsonSource.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binaryChunk.length);
  output.write("glTF", 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binaryChunk.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binaryChunk.copy(output, binaryHeader + 8);
  return output;
}

const valid = storedZip([
  ["PACKAGE/MANIFEST.json", "{}"],
  ["PACKAGE/source/file.js", "export const safe = true;"],
]);
const parsed = readZipArchive(valid);
assert.equal(parsed.get("PACKAGE/source/file.js").toString(), "export const safe = true;");

expectFailure(
  () => readZipArchive(storedZip([["../escape.txt", "unsafe"]])),
  /not canonical/,
);
expectFailure(
  () => readZipArchive(storedZip([["PACKAGE/file.txt", "one"], ["package/FILE.txt", "two"]])),
  /case-colliding/,
);
expectFailure(
  () => validateArchivePath("/absolute/file.txt"),
  /absolute/,
);

const corrupted = Buffer.from(valid);
const payloadOffset = corrupted.indexOf(Buffer.from("export const safe"));
corrupted[payloadOffset] ^= 0xff;
expectFailure(() => readZipArchive(corrupted), /CRC-32/);

const symlink = Buffer.from(valid);
const symlinkEocd = symlink.length - 22;
const symlinkDirectory = symlink.readUInt32LE(symlinkEocd + 16);
symlink.writeUInt16LE((3 << 8) | 20, symlinkDirectory + 4);
symlink.writeUInt32LE((0o120777 << 16) >>> 0, symlinkDirectory + 38);
expectFailure(() => readZipArchive(symlink), /symlinks and special files/);

const manifestFile = Buffer.from("payload");
const manifestFiles = new Map([
  ["MANIFEST.json", Buffer.from("{}")],
  ["file.bin", manifestFile],
]);
const baseManifest = {
  format: "GREENWATER_ENVIRONMENT_MANIFEST",
  version: "1.0",
  stage: 1,
  files: [{ path: "file.bin", bytes: 7, sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5" }],
};
validateManifestFiles(manifestFiles, baseManifest);
expectFailure(
  () => validateManifestFiles(manifestFiles, { ...baseManifest, files: [{ ...baseManifest.files[0], bytes: 8 }] }),
  /byte count/,
);

const malformedGlb = Buffer.alloc(20);
malformedGlb.write("glTF", 0);
malformedGlb.writeUInt32LE(2, 4);
malformedGlb.writeUInt32LE(24, 8);
expectFailure(() => parseGlb(malformedGlb, "fixture.glb"), /header length/);

const nonFiniteBinary = Buffer.alloc(12);
nonFiniteBinary.writeFloatLE(Number.NaN, 0);
const nonFiniteGlb = binaryGlb({
  asset: { version: "2.0" },
  buffers: [{ byteLength: 12 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
  accessors: [{
    bufferView: 0,
    componentType: 5126,
    count: 1,
    type: "VEC3",
  }],
}, nonFiniteBinary);
expectFailure(() => parseGlb(nonFiniteGlb, "non-finite.glb"), /non-finite FLOAT/);

console.log("Package boundary PASS: canonical paths, symlinks, CRC, manifest bytes/hashes, GLB framing, and non-finite geometry reject corrupt input.");
