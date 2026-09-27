const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Retarget from the visible state during rapid navigation. No queued cards,
 * cloned controls, delayed clicks, layout animation or animation dependency. */
export class GarageMotion {
  private readonly running = new Map<HTMLElement, Animation>();
  constructor(private readonly still: () => boolean) {}

  enter(element: HTMLElement, x = 0, y = 12, duration = 220): void {
    const previous = this.running.get(element);
    const current = previous ? getComputedStyle(element) : null;
    const start = { opacity: current?.opacity ?? "0.55", translate: current?.translate === "none" ? "0px 0px" : current?.translate ?? `${x}px ${y}px` };
    previous?.cancel();
    if (this.still()) { this.running.delete(element); return; }
    const animation = element.animate([start, { opacity: 1, translate: "0px 0px" }], { duration, easing: EASE });
    this.running.set(element, animation);
    void animation.finished.then(() => { if (this.running.get(element) === animation) this.running.delete(element); }, () => undefined);
  }

  fitted(element: HTMLElement): void { this.enter(element, 0, -8, 260); }

  cancel(): void {
    for (const animation of this.running.values()) animation.cancel();
    this.running.clear();
  }
}
