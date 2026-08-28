/**
 * P7 — the only module in `src/` permitted to touch browser storage.
 *
 * `scripts/validate-security.mjs` used to ban `localStorage` across the whole
 * tree. The meta layer needs settings, a chosen livery and best laps to survive
 * a reload, so the ban narrowed to a single-file exemption rather than
 * dissolving, and this file is that file. Everything here is deliberately
 * boring: one key, two calls, and a try/catch around each. All decisions —
 * defaults, per-field guards, the discard rule for an unrecognised schema, the
 * degrade-to-memory rule — live in `save-schema.js`, which runs under Node so
 * `scripts/validate-persistence.mjs` can attack it with hostile payloads.
 *
 * Nothing stored here is identity-shaped. It is four settings, a livery code
 * and per-course lap times; there is no account, no server and no upload, which
 * is also why the game needs no consent banner.
 *
 * Note the Content Security Policy does not and cannot govern this: CSP has no
 * Web Storage directive, so neither the `index.html` meta policy nor
 * `public/_headers` changes for this phase. The security validator is the
 * enforcement.
 */
import {
  createSaveStore,
  type PersistenceMode,
  type SaveSettings,
} from "./save-schema.js";

/**
 * Bump when the stored shape changes. A *newer* file is still discarded — this
 * build cannot know what a future shape means. An older one is migrated:
 * `save-schema.js` carries a ladder of one-version steps, and v2 is the first
 * rung. P10 added an optional best-lap ghost to each course record, so v1 → v2
 * is purely additive and a v1 file arrives with every field intact.
 */
export const SCHEMA_VERSION = 2;

/**
 * The single storage key. Every key this game writes is prefixed `futurisma.`
 * so the origin stays partitioned from anything else served beside it.
 *
 * The `.v1` suffix is the *storage slot*, not the schema version, and it stays
 * put through a migration on purpose: a v2 payload has to land back on the key
 * the v1 payload was read from, or the migration would leave the old file
 * orphaned beside a blank new one and read as a wipe. The suffix moves only for
 * a break so total that no ladder can bridge it.
 */
const STORAGE_KEY = "futurisma.save.v1";

/**
 * Grabs the storage object behind a guard. Reading `window.localStorage` is
 * itself a throwing operation in a browser configured to block site data, so
 * the failure has to be caught here rather than at the call sites.
 */
function openStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

const storage = openStorage();

/**
 * The live save for this page load. Reads once at module evaluation; every
 * mutation writes through. A refused write drops the store to `"memory"` for
 * the rest of the session and is reported through diagnostics as
 * `persistenceMode`.
 */
export const save = createSaveStore(
  storage === null ? null : {
    read: () => localStorage.getItem(STORAGE_KEY),
    write: (text: string) => {
      localStorage.setItem(STORAGE_KEY, text);
    },
  },
  SCHEMA_VERSION,
);

/**
 * What the diagnostics line carries about storage: whether the save is actually
 * durable this session, which shape it was normalized against, and the two
 * choices a soak run needs to be able to read back after a reload.
 */
export function persistenceDiagnostics(): {
  persistenceMode: PersistenceMode;
  schemaVersion: number;
  storedLivery: string;
  storedTrack: string;
} {
  return {
    persistenceMode: save.mode,
    schemaVersion: SCHEMA_VERSION,
    storedLivery: save.livery,
    storedTrack: save.track,
  };
}

export type { PersistenceMode, SaveSettings };
