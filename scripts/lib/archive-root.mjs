import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Provenance archives (the accepted art-package zips) are heavy, untracked
 * payloads. Code-only checkouts — a `git worktree` for a feature branch, CI —
 * do not have them. Every archive lookup therefore resolves through one root
 * so that a checkout without archives can skip provenance instead of failing,
 * while a checkout that *has* them keeps the hard byte-for-byte assertions.
 */
export const ARCHIVE_ROOT_ENV = "FUTURISMA_ARCHIVE_ROOT";
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_ARCHIVE_ROOT = join(REPO_ROOT, "artifacts");

export function archiveRoot() {
  const configured = process.env[ARCHIVE_ROOT_ENV];
  if (typeof configured === "string" && configured.trim() !== "") {
    return resolve(configured.trim());
  }
  return DEFAULT_ARCHIVE_ROOT;
}

function assertArchiveName(name) {
  if (typeof name !== "string" || name === "") {
    throw new TypeError("An archive name is required.");
  }
  if (isAbsolute(name)) {
    throw new TypeError(`Archive name ${name} must be relative to the archive root.`);
  }
  for (const segment of name.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new TypeError(`Archive name ${name} must not escape the archive root.`);
    }
  }
  return name;
}

export function archivePath(name) {
  return join(archiveRoot(), ...assertArchiveName(name).split("/"));
}

function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string[]} names archive names, relative to the archive root
 * @returns {{ available: boolean, root: string, missing: string[], reason: string | null }}
 */
export function archiveAvailability(names) {
  const root = archiveRoot();
  if (!isDirectory(root)) {
    return {
      available: false,
      root,
      missing: [...names],
      reason: `archive root ${root} is absent; set ${ARCHIVE_ROOT_ENV} to a checkout that has the accepted packages`,
    };
  }
  const missing = names.filter((name) => !isFile(archivePath(name)));
  if (missing.length > 0) {
    const listed = missing.slice(0, 3).join(", ");
    const suffix = missing.length > 3 ? `, +${missing.length - 3} more` : "";
    return {
      available: false,
      root,
      missing,
      reason: `${missing.length} accepted package(s) absent under ${root}: ${listed}${suffix}`,
    };
  }
  return { available: true, root, missing: [], reason: null };
}

export function skipArchives(reason) {
  console.log(`ARCHIVES SKIPPED (${reason})`);
}

/**
 * Skip-and-exit-0 when the archives are absent, so that a code-only checkout
 * is not gated on payloads it was never given. A present-but-wrong archive
 * still fails hard: `archiveAvailability` only reports absence.
 */
export function requireArchivesOrSkip(names) {
  const availability = archiveAvailability(names);
  if (!availability.available) {
    skipArchives(availability.reason);
    process.exit(0);
  }
  return availability;
}

export async function readArchive(name) {
  return readFile(archivePath(name));
}
