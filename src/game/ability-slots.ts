/**
 * The two 56px ability slots: the device glyph and the deck indicator.
 *
 * Three circuit runtimes (polarity, tideline, ascension) already write the
 * ability HUD, each through the same five ids, and each with its own vocabulary.
 * This module does not ask them to write anything new. It OBSERVES those nodes
 * and derives the slot state from what they already say, which is why a UI pass
 * can land beside in-flight circuit work without touching a single runtime file.
 *
 * What it derives:
 *
 * - `data-device` on `.hud-device`: `empty | held | active | perfect`, read from
 *   `#polarity-power`'s text. "COLLECT" means empty, a leading key prompt means
 *   held, a trailing duration means active, and a chain or perfect note means
 *   perfect.
 * - the device slot's charge fill, read from `#power-charge-fill`'s own
 *   `scaleX`, which the runtimes already set to the charge 0..1.
 * - `data-deck` on `.hud-gravity`: `upper | lower | none`, read from
 *   `#polarity-deck`.
 * - `data-transfer` on `.hud-gravity`: `ready` when the action line names a key,
 *   `wait` otherwise.
 *
 * A MutationObserver is the right instrument here rather than a per-frame poll:
 * these nodes change a handful of times a lap, and the observer costs nothing on
 * the frames where they do not.
 */

import { readCharge, readDeck, readDeviceKind, readDeviceState } from "./ability-text.js";

/**
 * The SVG namespace, read off the authored element rather than written as a URL
 * literal. `validate-security.mjs` bans every `http(s)://` in source and it is
 * right to: a blunt rule is the point of that gate. The two slot shells are
 * authored in `index.html`, where the HTML parser supplies the namespace, so
 * this reads it back instead of restating it.
 */
let svgNamespace = "";

/** The plate outline both slots share. A 10-unit chamfer in a 72-unit box. */
const CHAMFER = "10,0 72,0 72,62 62,72 0,72 0,10";

/**
 * Authored in the 72-unit slot space. Surge is a double chevron; the shield is
 * a hex ring, drawn evenodd so the middle is a hole rather than a fill.
 */
const GLYPHS = {
  surge:
    "M14,18 L26,18 L40,36 L26,54 L14,54 L28,36 Z M34,18 L46,18 L60,36 L46,54 L34,54 L48,36 Z",
  shield:
    "M36,10 L58,23 L58,49 L36,62 L14,49 L14,23 Z M36,21 L49,28.5 L49,43.5 L36,51 L23,43.5 L23,28.5 Z",
} as const;

type DeviceKind = keyof typeof GLYPHS;
type DeviceState = "empty" | "held" | "active" | "perfect";

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  // The namespace is read from the authored shell, so this cast is the one
  // place the dynamic string meets the typed factory.
  const node = document.createElementNS(svgNamespace, name) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

class DeviceSlot {
  private readonly fill: SVGRectElement;
  private readonly glyph: SVGPathElement;
  private readonly outline: SVGPolygonElement;
  private readonly plate: SVGRectElement;
  private kind: DeviceKind | null = null;

  constructor(private readonly host: SVGSVGElement) {
    const maskId = `ability-mask-${Math.random().toString(36).slice(2, 8)}`;
    const mask = el("mask", { id: maskId });
    mask.append(
      el("polygon", { points: CHAMFER, fill: "#fff" }),
      el("path", { d: "", fill: "#000", "fill-rule": "evenodd", class: "ability-slot__cut" }),
    );
    this.plate = el("rect", { width: "72", height: "72", mask: `url(#${maskId})` });
    this.plate.setAttribute("class", "ability-slot__plate");
    this.fill = el("rect", { width: "72", height: "72", mask: `url(#${maskId})` });
    this.fill.setAttribute("class", "ability-slot__fill");
    // The fill grows up from the floor of the slot, so an emptying device reads
    // as draining rather than shrinking toward its middle.
    this.fill.style.transformOrigin = "50% 100%";
    // Drawn a second time as a 1.5 outline on top of the fill: the glyph is the
    // device's identity, and identity has to survive an empty slot.
    this.glyph = el("path", { d: "", fill: "none", "stroke-width": "1.5" });
    this.glyph.setAttribute("class", "ability-slot__glyph");
    this.outline = el("polygon", { points: CHAMFER, fill: "none", "stroke-width": "2.5" });
    this.outline.setAttribute("class", "ability-slot__outline");
    host.append(mask, this.plate, this.fill, this.glyph, this.outline);
  }

  render(kind: DeviceKind | null, state: DeviceState, charge: number): void {
    if (kind !== this.kind) {
      this.kind = kind;
      const path = kind ? GLYPHS[kind] : "";
      this.glyph.setAttribute("d", path);
      this.host.querySelector(".ability-slot__cut")?.setAttribute("d", path);
    }
    this.host.dataset.state = state;
    this.host.dataset.pulse = state === "active" || state === "perfect" ? "true" : "false";
    this.fill.style.transform = `scaleY(${state === "empty" ? 0 : charge})`;
  }
}

class DeckSlot {
  private readonly upper: SVGRectElement;
  private readonly lower: SVGRectElement;
  private readonly arrow: SVGPolygonElement;

  constructor(private readonly host: SVGSVGElement) {
    host.append(
      el("polygon", { points: CHAMFER, class: "ability-slot__plate" }),
    );
    this.upper = el("rect", { x: "12", y: "12", width: "48", height: "8", "stroke-width": "1.5" });
    this.upper.setAttribute("class", "ability-slot__deck ability-slot__deck--upper");
    this.lower = el("rect", { x: "12", y: "52", width: "48", height: "8", "stroke-width": "1.5" });
    this.lower.setAttribute("class", "ability-slot__deck ability-slot__deck--lower");
    this.arrow = el("polygon", { points: "36,24 46,36 26,36" });
    this.arrow.setAttribute("class", "ability-slot__arrow");
    host.append(this.upper, this.lower, this.arrow);
  }

  render(deck: "upper" | "lower" | "none", ready: boolean): void {
    this.host.dataset.deck = deck;
    this.host.dataset.ready = ready ? "true" : "false";
    // The arrow points at the deck you would arrive on, not the one you are on.
    this.arrow.setAttribute(
      "points",
      deck === "upper" ? "36,48 46,36 26,36" : "36,24 46,36 26,36",
    );
  }
}

/**
 * Bind the slots. Returns a teardown so a test or a hot reload can unbind.
 * A missing node is not an error: three circuits share this markup and only two
 * of them have decks.
 */
export function bindAbilitySlots(root: ParentNode = document): () => void {
  const deviceRow = root.querySelector<HTMLElement>(".hud-device");
  const gravityRow = root.querySelector<HTMLElement>(".hud-gravity");
  const powerLabel = root.querySelector<HTMLElement>("#polarity-power");
  const chargeFill = root.querySelector<HTMLElement>("#power-charge-fill");
  const deckLabel = root.querySelector<HTMLElement>("#polarity-deck");
  const actionLabel = root.querySelector<HTMLElement>("#polarity-flip");
  if (!deviceRow || !gravityRow || !powerLabel || !deckLabel || !actionLabel) {
    return () => {};
  }

  const deviceSvg = deviceRow.querySelector<SVGSVGElement>("svg.ability-slot");
  const deckSvg = gravityRow.querySelector<SVGSVGElement>("svg.ability-slot");
  if (!deviceSvg || !deckSvg) return () => {};
  svgNamespace = deviceSvg.namespaceURI ?? "";
  deviceSvg.replaceChildren();
  deckSvg.replaceChildren();

  const device = new DeviceSlot(deviceSvg);
  const deck = new DeckSlot(deckSvg);

  const sync = (): void => {
    const text = powerLabel.textContent ?? "";
    const state = readDeviceState(text);
    device.render(readDeviceKind(text), state, readCharge(chargeFill?.style.transform ?? ""));
    deviceRow.dataset.device = state;

    const deckState = readDeck(deckLabel.textContent ?? "");
    // A key prompt in the action line is the runtimes' own "you may do this now".
    const ready = (actionLabel.textContent ?? "").includes("/");
    deck.render(deckState, ready);
    gravityRow.dataset.deck = deckState;
    gravityRow.dataset.transfer = ready ? "ready" : "wait";
    // A circuit with no decks gets no deck slot rather than an empty one.
    gravityRow.dataset.decked = deckState === "none" ? "false" : "true";
  };

  sync();
  const observer = new MutationObserver(sync);
  const options: MutationObserverInit = {
    characterData: true,
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  };
  observer.observe(powerLabel, options);
  observer.observe(deckLabel, options);
  observer.observe(actionLabel, options);
  if (chargeFill) observer.observe(chargeFill, options);
  return () => observer.disconnect();
}
