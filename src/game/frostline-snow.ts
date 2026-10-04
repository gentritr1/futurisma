export type WinterPower = 'stabilizer' | 'thermal';

export const SNOW_SECTIONS = [
  {from: .082, to: .145, depth: .72},
  {from: .255, to: .395, depth: 1},
  {from: .465, to: .59, depth: .9},
  {from: .64, to: .78, depth: .82},
] as const;

export const WINTER_PICKUPS: readonly {progress: number; lateral: number; kind: WinterPower}[] = [
  {progress: .069, lateral: 0, kind: 'stabilizer'},
  {progress: .12, lateral: 5.5, kind: 'thermal'},
  {progress: .242, lateral: -5.5, kind: 'stabilizer'},
  {progress: .345, lateral: 0, kind: 'thermal'},
  {progress: .452, lateral: 5.5, kind: 'stabilizer'},
  {progress: .535, lateral: -5.5, kind: 'thermal'},
  {progress: .626, lateral: 0, kind: 'stabilizer'},
  {progress: .716, lateral: -5.5, kind: 'stabilizer'},
  {progress: .755, lateral: 5.5, kind: 'thermal'},
];

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const wrap = (progress: number) => ((progress % 1) + 1) % 1;

/** The same authored snow envelope drives the shader, grip and lateral drift. */
export function snowStrengthAt(progress: number): number {
  const p = wrap(progress);
  for (const section of SNOW_SECTIONS) {
    if (p < section.from || p > section.to) continue;
    const edge = clamp(Math.min(p - section.from, section.to - p) / .007, 0, 1);
    return section.depth * edge * edge * (3 - 2 * edge);
  }
  return 0;
}

export function snowCoverageAt(progress: number, lateral: number): number {
  const clearedTrack = Math.exp(-(((Math.abs(lateral) - 5.5) / 1.15) ** 2));
  return snowStrengthAt(progress) * (1 - clearedTrack * .72);
}

/** Race-local pickups, with no timers or save writes outside the fixed tick. */
export class WinterRoad {
  elapsed = 0;
  stabilizerSeconds = 0;
  thermalSeconds = 0;
  recoverySeconds = 0;
  collected = 0;
  lastPickup: WinterPower | null = null;
  readonly collectedLap = WINTER_PICKUPS.map(() => -1);
  private previousProgress: number | null = null;
  snowballPhase: 'idle' | 'flight' | 'impact' = 'idle';
  snowballRemaining = 0;
  shotCooldown = 0;
  snowballTarget = 0;
  snowballLane = 0;
  snowballSource = .53;
  snowballSide = 1;
  snowballHits = 0;
  snowballBlocks = 0;
  visorSeconds = 0;
  private readonly ambushLap = [-1, -1];
  private volleyResolved = false;

  step(delta: number, progress: number, lateral: number, lap: number, length: number): void {
    const dt = clamp(delta, 0, .05);
    this.elapsed += dt;
    this.stabilizerSeconds = Math.max(0, this.stabilizerSeconds - dt);
    this.thermalSeconds = Math.max(0, this.thermalSeconds - dt);
    this.recoverySeconds = Math.max(0, this.recoverySeconds - dt);
    const p = wrap(progress), previous = this.previousProgress;
    this.previousProgress = p;
    if (previous === null) return;
    const travelled = wrap(p - previous) * length;
    // Teleports/recovery and reverse driving cannot collect a row of devices.
    if (travelled > 20) return;
    for (const [index, pickup] of WINTER_PICKUPS.entries()) {
      const distance = wrap(pickup.progress - previous) * length;
      if (this.collectedLap[index] === lap || distance > travelled || Math.abs(lateral - pickup.lateral) > 2.8) continue;
      this.collectedLap[index] = lap;
      this.collected++;
      this.lastPickup = pickup.kind;
      if (pickup.kind === 'stabilizer') this.stabilizerSeconds = 10;
      else this.thermalSeconds = 5.5;
    }
  }

  driftAt(progress: number, lateral: number, speed: number): number {
    const snow = snowCoverageAt(progress, lateral);
    const speedFactor = clamp((speed - 12) / 70, 0, 1.15);
    const edgeSafety = clamp((11 - Math.abs(lateral)) / 2, 0, 1);
    const protection = this.recoverySeconds > 0 ? 0 : this.stabilizerSeconds > 0 ? .08 : this.thermalSeconds > 0 ? .18 : 1;
    return (Math.sin(this.elapsed * 1.65) + .3 * Math.sin(this.elapsed * 3.1 + .8)) * 1.7 * snow * speedFactor * edgeSafety * protection;
  }

  gripAt(progress: number, lateral: number): number {
    if (this.stabilizerSeconds > 0) return 1;
    if (this.thermalSeconds > 0) return .98;
    const snowGrip = .97 - snowCoverageAt(progress, lateral) * .32;
    const p = wrap(progress);
    const iceGrip = p > .64 && p < .78 ? (Math.abs(lateral) < 5 ? .7 : .91) : .97;
    return Math.min(snowGrip, iceGrip);
  }

  applySpeed(previous: number, normal: number, throttle: number, brake: number, delta: number): number {
    if (this.thermalSeconds <= 0 || throttle < .1 || brake > .1) return normal;
    // Extra thrust only while accelerating; releasing/braking always works.
    return normal >= previous ? Math.max(normal, Math.min(108, normal + 12 * delta)) : normal;
  }

  stepSnowball(delta: number, progress: number, lateral: number, lap: number, leadMeters: number, length: number, speed: number): void {
    this.visorSeconds = Math.max(0, this.visorSeconds - delta);
    this.shotCooldown = Math.max(0, this.shotCooldown - delta);
    if (this.snowballPhase === 'idle') {
      if (!Number.isFinite(leadMeters) || leadMeters < 150 || this.shotCooldown > 0) return;
      for (const [index, entry] of [.502, .682].entries()) {
        if (progress < entry || progress > entry + .017 || this.ambushLap[index] === lap) continue;
        this.ambushLap[index] = lap;
        this.snowballSource = entry + .018;
        this.snowballSide = index === 0 ? 1 : -1;
        this.snowballTarget = wrap(progress + (Math.max(28, speed) * 1.1 + 4) / length);
        this.snowballLane = lateral < -2.75 ? -5.5 : lateral > 2.75 ? 5.5 : 0;
        this.snowballPhase = 'flight'; this.snowballRemaining = 1.1;this.shotCooldown = 18;
        this.volleyResolved = false;
        return;
      }
    } else {
      this.snowballRemaining -= delta;
      if (this.snowballRemaining <= 0) {
        if (this.snowballPhase === 'flight') { this.snowballPhase = 'impact'; this.snowballRemaining += .4; }
        else this.snowballPhase = 'idle';
      }
      const distance = Math.abs(wrap(progress - this.snowballTarget + .5) - .5) * length;
      if (this.snowballPhase === 'impact' && !this.volleyResolved && distance < 20 && Math.abs(lateral - this.snowballLane) < 3.2) {
        this.volleyResolved = true;
        if (this.recoverySeconds > 0 || this.stabilizerSeconds > 0) this.snowballBlocks++;
        else { this.snowballHits++; this.visorSeconds = 2.4; }
      }
    }
  }

  recover(): void { this.previousProgress = null; this.recoverySeconds = 2; this.visorSeconds = 0; }
  reset(): void {
    this.elapsed = this.stabilizerSeconds = this.thermalSeconds = this.recoverySeconds = this.collected = 0;
    this.lastPickup = null;
    this.previousProgress = null;
    this.collectedLap.fill(-1);
    this.ambushLap.fill(-1);
    this.snowballPhase = 'idle';this.shotCooldown = this.snowballRemaining = this.visorSeconds = this.snowballHits = this.snowballBlocks = 0;
    this.volleyResolved = false;
  }
}
