import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { validateGreenwaterPackageBuffer } from "./lib/greenwater-package-validator.mjs";
import { archivePath, archiveRoot, skipArchives } from "./lib/archive-root.mjs";

/**
 * Accepts either a filesystem path (absolute or relative to the working
 * directory, for ad-hoc use) or a bare archive name resolved under the
 * archive root. Returns null when the package cannot be located, so an
 * archive-less checkout skips instead of failing.
 */
function locate(argument) {
  if (isAbsolute(argument)) return existsSync(argument) ? argument : null;
  if (!argument.includes("/") && !argument.includes("\\")) {
    const inRoot = archivePath(argument);
    if (existsSync(inRoot)) return inRoot;
    return null;
  }
  const fromCwd = resolve(argument);
  return existsSync(fromCwd) ? fromCwd : null;
}

const packageArgument = process.argv[2];
const referenceArgument = process.argv[3];
if (!packageArgument) {
  console.error("Usage: npm run validate:environment -- GREENWATER_ENVIRONMENT_{STAGE1,STAGE2,v1.0}.zip [preceding-stage.zip]");
  console.error(`Bare names resolve under the archive root (${archiveRoot()}); absolute or path-bearing arguments are used as given.`);
  process.exitCode = 2;
} else {
  const resolvedPath = locate(packageArgument);
  const resolvedReference = referenceArgument ? locate(referenceArgument) : null;
  const missing = [];
  if (!resolvedPath) missing.push(packageArgument);
  if (referenceArgument && !resolvedReference) missing.push(referenceArgument);
  if (missing.length > 0) {
    skipArchives(
      `${missing.join(", ")} not found under archive root ${archiveRoot()}`,
    );
  } else {
    try {
      const bytes = await readFile(resolvedPath);
      const referencePackage = resolvedReference ? await readFile(resolvedReference) : undefined;
      const report = validateGreenwaterPackageBuffer(bytes, { referencePackage });
      const runtime = report.stage >= 2
        ? ` Runtime: ${report.placements} placements, ${report.runtimeMeshes} meshes, ${report.runtimeTriangles} triangles.`
        : "";
      const renders = report.renders === undefined ? "" : ` Acceptance renders: ${report.renders}.`;
      const comparison = report.exactFilesMatched === undefined
        ? ""
        : report.correctedDecks === undefined
          ? ` Accepted Stage 1 contract preserved: ${report.exactFilesMatched} immutable files byte-identical, ${report.semanticAssetsMatched} generated assets semantically identical, ${report.geometryBufferViewsMatched} geometry buffers byte-identical.`
          : ` Accepted Stage 2 contract preserved: ${report.exactFilesMatched} immutable files byte-identical, ${report.semanticAssetsMatched} generated assets semantically identical, ${report.accessorPayloadsMatched} unchanged accessor payloads byte-identical; exactly ${report.correctedDecks} deck meshes carry the winding fix.`;
      console.log(`Greenwater package PASS: stage ${report.stage}, ${report.entries} entries, ${report.roots} roots, ${report.meshes} meshes, ${report.triangles} art-kit triangles, ${report.paintedSlots}/${report.reservedSlots} painted/reserved atlas slots.${runtime}${renders}${comparison}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Greenwater package FAIL: ${message}`);
      process.exitCode = 1;
    }
  }
}
