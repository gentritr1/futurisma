import { save } from "./persistence";

export type MapSelection = "greenwater" | "bitterpan" | "nightshift" | "polarity" | "tideline";

/**
 * The dispatchable circuits. `label` and `mapCode` duplicate what the
 * course modules report once loaded, but the start screen has to name a circuit
 * *before* deciding which course module to import, so the selection surface
 * cannot read them off the course.
 */
export interface TrackEntry {
  readonly selection: MapSelection;
  readonly label: string;
  readonly mapCode: string;
  readonly deck: string;
}

export const TRACKS: readonly TrackEntry[] = [
  {
    selection: "greenwater",
    label: "GREENWATER STRIP",
    mapCode: "MAP 01",
    deck: "WETLAND AIRFIELD",
  },
  {
    selection: "bitterpan",
    label: "BITTERPAN WORKS",
    mapCode: "MAP 02",
    deck: "SALT PLANT",
  },
  {
    selection: "nightshift",
    label: "NIGHT SHIFT",
    mapCode: "MAP 03",
    deck: "MERIDIAN AFTER HOURS",
  },
  {
    selection: "polarity",
    label: "POLARITY",
    mapCode: "MAP 04",
    deck: "GRAVITY INTERCHANGE",
  },
  {
    selection: "tideline",
    label: "TIDELINE",
    mapCode: "MAP 05",
    deck: "FLOOD / DRAIN / PUMP HALL",
  },
];

export function trackFor(selection: MapSelection): TrackEntry {
  return TRACKS.find((track) => track.selection === selection) ?? TRACKS[0];
}

/**
 * `?map=` stays the QA override and **always wins**: a share link or a soak
 * command must land on the circuit it names regardless of what this browser
 * last chose. Only a bare URL falls through to the stored dispatch.
 */
export function resolveMapSelection(search: string): MapSelection {
  const requested = new URLSearchParams(search).get("map")?.toLowerCase();
  // Present-but-unknown still counts as an override and still resolves to
  // Greenwater, exactly as it did before the stored dispatch existed.
  const selection = requested !== undefined ? requested : save.track;
  return TRACKS.find((track) => track.selection === selection)?.selection ?? "greenwater";
}
