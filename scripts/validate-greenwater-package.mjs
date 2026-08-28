import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateGreenwaterPackageBuffer } from "./lib/greenwater-package-validator.mjs";

const packagePath = process.argv[2];
const referencePath = process.argv[3];
if (!packagePath) {
  console.error("Usage: npm run validate:environment -- /absolute/path/to/GREENWATER_ENVIRONMENT_{STAGE1,STAGE2,v1.0}.zip [/absolute/path/to/preceding-stage.zip]");
  process.exitCode = 2;
} else {
  try {
    const resolvedPath = resolve(packagePath);
    const bytes = await readFile(resolvedPath);
    const referencePackage = referencePath ? await readFile(resolve(referencePath)) : undefined;
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
