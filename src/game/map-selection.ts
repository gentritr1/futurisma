export type MapSelection = "greenwater" | "bitterpan";

export function resolveMapSelection(search: string): MapSelection {
  const requested = new URLSearchParams(search).get("map")?.toLowerCase();
  return requested === "bitterpan" ? "bitterpan" : "greenwater";
}
