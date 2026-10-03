export type RelayPhase = 'idle' | 'sky' | 'mark' | 'strike' | 'cooldown';

/** Fixed-step, race-local hazard. The lane locks before the strike and every
 * volley can damage the craft only once. Nothing writes garage/save data. */
export class RelayAttack {
  phase: RelayPhase = 'idle';
  remaining = 0;
  targetProgress = 0;
  playerProgress = 0;
  targetLateral = 0;
  integrity = 100;
  hits = 0;
  volley = 0;
  stun = 0;
  immunity = 0;
  private hitThisVolley = false;
  private pendingImpact = false;
  get interferenceStrength(): number {
    switch (this.phase) {
      case 'idle': return 0;
      case 'sky': return .52;
      case 'mark': return .7;
      case 'strike': return .86;
      case 'cooldown': return .42;
    }
  }
  readonly halfLength = 52;
  readonly halfWidth = 3.8;

  step(delta: number, progress: number, lateral: number, lap: number, totalLaps: number, length: number): void {
    const dt = Math.max(0, Math.min(delta, .05));
    this.playerProgress=progress;
    this.immunity = Math.max(0, this.immunity - dt);
    this.stun = Math.max(0, this.stun - dt);
    if (lap < totalLaps) return;
    if (this.phase === 'idle') { this.phase = 'sky'; this.remaining = 1.6; this.volley++; }
    this.remaining -= dt;
    if (this.remaining <= 0) {
      if (this.phase === 'sky') {
        this.phase = 'mark'; this.remaining = 2;
        this.targetProgress = (progress + 145 / length) % 1;
        this.targetLateral = lateral < -3.5 ? -7.5 : lateral > 3.5 ? 7.5 : 0;
        this.hitThisVolley = false;
      } else if (this.phase === 'mark') { this.phase = 'strike'; this.remaining = 1.5; }
      else if (this.phase === 'strike') { this.phase = 'cooldown'; this.remaining = 3; }
      else { this.phase = 'sky'; this.remaining = 1.6; this.volley++; }
    }
    const distance = Math.abs(((progress - this.targetProgress + 1.5) % 1) - .5) * length;
    if (this.phase === 'strike' && !this.hitThisVolley && this.immunity === 0 &&
        distance < this.halfLength && Math.abs(lateral - this.targetLateral) < this.halfWidth) {
      this.hitThisVolley = true; this.pendingImpact = true;
      this.integrity = Math.max(28, this.integrity - 18); this.hits++;
      this.stun = 1.25;
    }
  }
  applySpeed(previous: number, normal: number, delta: number): number {
    let speed = normal;
    if (this.pendingImpact) { speed *= .52; this.pendingImpact = false; }
    if (speed > previous) speed = previous + (speed - previous) * (.55 + .45 * this.integrity / 100);
    if (this.stun > 0) speed = Math.max(0, speed - 13 * delta);
    return Math.min(speed, 115 * (.7 + .3 * this.integrity / 100));
  }
  recover(): void { this.immunity = 2; this.stun = 0; this.pendingImpact = false; }
  reset(): void {
    this.phase = 'idle'; this.remaining = this.hits = this.volley = this.stun = this.immunity = 0;
    this.integrity = 100; this.hitThisVolley = this.pendingImpact = false;
  }
}
