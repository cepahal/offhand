/**
 * Spring-driven orbit camera. Velocity carries through new commands, so motion never stops dead
 * between gestures.
 *
 * - A single rotate/zoom jumps the goal: a stiff, slightly under-damped spring gives a fast start
 *   and a soft landing with a hint of settle.
 * - The same command again within REPEAT_MS is a run. Each step is then fed into the goal at the
 *   user's own cadence and followed by a critically damped spring, so a run of swipes becomes one
 *   continuous glide that eases in, cruises and eases out.
 * - Focus / reset / restore travel with a softer spring.
 * Pure math, no three.js, so it is unit-tested.
 */
export interface Tune {
  /** Natural frequency, rad/s. */
  omega: number;
  /** Damping ratio: 1 = critical, below 1 settles with a small overshoot. */
  zeta: number;
}

export const SNAP: Tune = { omega: 14, zeta: 0.8 };
export const GLIDE: Tune = { omega: 9, zeta: 1 };
export const TRAVEL: Tune = { omega: 7.5, zeta: 0.92 };

export const REPEAT_MS = 1600;
const MIN_CADENCE_MS = 220;
const MAX_CADENCE_MS = 1100;

export interface RigPose {
  radius: number;
  /** Polar angle from +Y, radians. */
  phi: number;
  /** Azimuth around +Y, radians. */
  theta: number;
  target: [number, number, number];
}

export type NudgeKind = 'yaw' | 'pitch' | 'zoom';

class Channel {
  v = 0;
  feed = 0;
  rate = 0;
  constructor(
    public x: number,
    public goal: number,
  ) {}

  step(dt: number, tune: Tune, lo: number, hi: number): void {
    if (this.feed !== 0) {
      const d = Math.sign(this.feed) * Math.min(Math.abs(this.feed), this.rate * dt);
      this.goal = Math.min(hi, Math.max(lo, this.goal + d));
      this.feed -= d;
      if (Math.abs(this.feed) < 1e-9 || this.goal === lo || this.goal === hi) this.feed = 0;
    }
    const a = -tune.omega * tune.omega * (this.x - this.goal) - 2 * tune.zeta * tune.omega * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }

  settled(eps: number): boolean {
    return this.feed === 0 && Math.abs(this.x - this.goal) < eps && Math.abs(this.v) < eps * 4;
  }

  hold(): void {
    this.goal = this.x;
    this.v = 0;
    this.feed = 0;
  }

  set(value: number): void {
    this.x = value;
    this.goal = value;
    this.v = 0;
    this.feed = 0;
  }
}

export class CameraRig {
  private theta = new Channel(0, 0);
  private phi = new Channel(Math.PI / 2, Math.PI / 2);
  private logR = new Channel(Math.log(300), Math.log(300));
  private tx = new Channel(0, 0);
  private ty = new Channel(0, 0);
  private tz = new Channel(0, 0);
  private tune: Tune = SNAP;
  private last: Partial<Record<NudgeKind, { sign: number; at: number }>> = {};
  minRadius = 1;
  maxRadius = 1e5;
  /** True while anything is still moving. */
  active = false;

  /** Jump to a pose with no motion (load, user drag end). */
  setPose(p: RigPose): void {
    this.theta.set(p.theta);
    this.phi.set(p.phi);
    this.logR.set(Math.log(Math.max(p.radius, 1e-6)));
    this.tx.set(p.target[0]);
    this.ty.set(p.target[1]);
    this.tz.set(p.target[2]);
    this.active = false;
  }

  pose(): RigPose {
    return {
      radius: Math.exp(this.logR.x),
      phi: this.phi.x,
      theta: this.theta.x,
      target: [this.tx.x, this.ty.x, this.tz.x],
    };
  }

  goalPose(): RigPose {
    return {
      radius: Math.exp(this.logR.goal + this.logR.feed),
      phi: this.phi.goal + this.phi.feed,
      theta: this.theta.goal + this.theta.feed,
      target: [this.tx.goal, this.ty.goal, this.tz.goal],
    };
  }

  /** Stop where it is (the user grabbed the view with the mouse). */
  stop(): void {
    for (const c of this.channels()) c.hold();
    this.last = {};
    this.active = false;
  }

  /**
   * One rotate or zoom step. yaw/pitch deltas are radians, zoom is a log radius delta
   * (negative = closer). `now` is ms.
   */
  nudge(kind: NudgeKind, delta: number, now: number): void {
    if (delta === 0) return;
    const ch = kind === 'yaw' ? this.theta : kind === 'pitch' ? this.phi : this.logR;
    const sign = Math.sign(delta);
    const prev = this.last[kind];
    const repeat = prev !== undefined && prev.sign === sign && now - prev.at < REPEAT_MS;
    if (repeat) {
      const cadence = Math.min(MAX_CADENCE_MS, Math.max(MIN_CADENCE_MS, now - prev.at)) / 1000;
      // Fold whatever is left of the snap step into the feed, then feed at the user's cadence.
      ch.feed += ch.goal - ch.x + delta;
      ch.goal = ch.x;
      ch.rate = Math.max(Math.abs(delta) / cadence, Math.abs(ch.feed) / (cadence * 1.5));
      this.tune = GLIDE;
    } else {
      if (prev && prev.sign !== sign) ch.feed = 0;
      ch.goal += delta;
      this.tune = SNAP;
    }
    this.clampGoals();
    this.last[kind] = { sign, at: now };
    this.active = true;
  }

  /** Fly to a pose (focus, reset, bookmark). Unspecified parts stay as they are. */
  travelTo(p: Partial<RigPose>): void {
    for (const c of this.channels()) c.feed = 0;
    if (p.theta !== undefined) {
      // Take the short way round.
      let t = p.theta;
      while (t - this.theta.x > Math.PI) t -= 2 * Math.PI;
      while (t - this.theta.x < -Math.PI) t += 2 * Math.PI;
      this.theta.goal = t;
    }
    if (p.phi !== undefined) this.phi.goal = p.phi;
    if (p.radius !== undefined) this.logR.goal = Math.log(Math.max(p.radius, 1e-6));
    if (p.target) {
      this.tx.goal = p.target[0];
      this.ty.goal = p.target[1];
      this.tz.goal = p.target[2];
    }
    this.clampGoals();
    this.last = {};
    this.tune = TRAVEL;
    this.active = true;
  }

  /** Advance by dt seconds. Returns true while moving. */
  step(dt: number): boolean {
    if (!this.active) return false;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = Math.min(dt, 0.1) / steps;
    const lr = [Math.log(this.minRadius), Math.log(this.maxRadius)] as const;
    for (let i = 0; i < steps; i++) {
      this.theta.step(h, this.tune, -Infinity, Infinity);
      this.phi.step(h, this.tune, 0.05, Math.PI - 0.05);
      this.logR.step(h, this.tune, lr[0], lr[1]);
      this.tx.step(h, this.tune, -Infinity, Infinity);
      this.ty.step(h, this.tune, -Infinity, Infinity);
      this.tz.step(h, this.tune, -Infinity, Infinity);
    }
    this.phi.x = Math.min(Math.PI - 0.02, Math.max(0.02, this.phi.x));
    const scale = Math.exp(this.logR.x);
    const settled =
      this.theta.settled(1e-4) && this.phi.settled(1e-4) && this.logR.settled(1e-4) &&
      this.tx.settled(scale * 1e-4) && this.ty.settled(scale * 1e-4) && this.tz.settled(scale * 1e-4);
    if (settled) {
      for (const c of this.channels()) c.set(c.goal);
      this.active = false;
    }
    return true;
  }

  private clampGoals(): void {
    this.phi.goal = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi.goal));
    const lo = Math.log(this.minRadius);
    const hi = Math.log(this.maxRadius);
    this.logR.goal = Math.min(hi, Math.max(lo, this.logR.goal));
  }

  private channels(): Channel[] {
    return [this.theta, this.phi, this.logR, this.tx, this.ty, this.tz];
  }
}
