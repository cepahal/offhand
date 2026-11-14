import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/viewer/camera-rig.js';

const DEG = Math.PI / 180;
const start = { radius: 300, phi: Math.PI / 2, theta: 0, target: [0, 0, 0] as [number, number, number] };

function run(rig: CameraRig, seconds: number, onFrame?: (t: number) => void, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += 1000 / 60;
    onFrame?.(t);
    rig.step(1 / 60);
  }
  return t;
}

describe('camera rig', () => {
  it('lands a single step exactly, quickly, with only a small settle', () => {
    const rig = new CameraRig();
    rig.setPose(start);
    rig.nudge('yaw', -18 * DEG, 0);
    let peak = 0;
    let at90 = -1;
    run(rig, 1.5, (t) => {
      const moved = -rig.pose().theta / DEG;
      peak = Math.max(peak, moved);
      if (at90 < 0 && moved >= 18 * 0.9) at90 = t;
    });
    expect(rig.pose().theta / DEG).toBeCloseTo(-18, 3);
    expect(at90).toBeGreaterThan(0);
    expect(at90).toBeLessThan(350);
    expect(peak).toBeLessThan(18 * 1.04);
    expect(rig.active).toBe(false);
  });

  it('turns a run of steps into one continuous glide that never stops between them', () => {
    const rig = new CameraRig();
    rig.setPose(start);
    const steps = [0, 600, 1200, 1800];
    let next = 0;
    let prev = rig.pose().theta;
    let minSpeed = Infinity;
    run(rig, 4.5, (t) => {
      while (next < steps.length && t >= steps[next]!) rig.nudge('yaw', 18 * DEG, steps[next++]!);
      const speed = Math.abs(rig.pose().theta - prev) * 60 / DEG;
      prev = rig.pose().theta;
      if (t > 700 && t < 1900) minSpeed = Math.min(minSpeed, speed);
    });
    expect(rig.pose().theta / DEG).toBeCloseTo(72, 2);
    expect(minSpeed).toBeGreaterThan(8); // still moving at ≥ 8°/s between swipes
  });

  it('zooms in log space and respects the distance limits', () => {
    const rig = new CameraRig();
    rig.setPose(start);
    rig.minRadius = 100;
    for (let i = 0; i < 20; i++) rig.nudge('zoom', -Math.log(1.12), i * 2000);
    run(rig, 3);
    expect(rig.pose().radius).toBeCloseTo(100, 1);
  });

  it('keeps the camera off the poles', () => {
    const rig = new CameraRig();
    rig.setPose(start);
    for (let i = 0; i < 30; i++) rig.nudge('pitch', 12 * DEG, i * 2000);
    run(rig, 3);
    expect(rig.pose().phi).toBeLessThan(Math.PI - 0.04);
  });

  it('travels the short way round and stops dead when the user grabs the view', () => {
    const rig = new CameraRig();
    rig.setPose({ ...start, theta: 170 * DEG });
    rig.travelTo({ theta: -170 * DEG, target: [10, 0, 0] });
    run(rig, 0.1);
    expect(rig.pose().theta).toBeGreaterThan(170 * DEG);
    run(rig, 3);
    expect(rig.pose().theta).toBeCloseTo(190 * DEG, 3);
    expect(rig.pose().target[0]).toBeCloseTo(10, 3);
    rig.nudge('yaw', 30 * DEG, 0);
    run(rig, 0.05);
    rig.stop();
    const held = rig.pose().theta;
    run(rig, 1);
    expect(rig.pose().theta).toBe(held);
  });
});
