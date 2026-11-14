import { z } from 'zod';
import { Unit } from './common.js';

/** The nine gestures the PAJ7620U2 reports natively. */
export const GestureName = z
  .enum(['up', 'down', 'left', 'right', 'forward', 'backward', 'cw', 'ccw', 'wave'])
  .describe('Gesture name as reported by the board (already orientation-corrected by firmware).');
export type GestureName = z.infer<typeof GestureName>;

const seq = z.number().int().nonnegative().describe('Per-boot sequence number, increments per event.');
const ms = z.number().int().nonnegative().describe('Board uptime in milliseconds (millis()).');

export const GestureHit = z
  .object({
    t: z.literal('g').describe('Discrete gesture.'),
    g: GestureName,
    seq,
    ms,
  })
  .describe('A discrete gesture detected by the PAJ7620U2.');

export const GestureHover = z
  .object({
    t: z.literal('h').describe('Hover sample.'),
    x: Unit.describe('Normalised hand X over the sensor, 0..1.'),
    y: Unit.describe('Normalised hand Y over the sensor, 0..1.'),
    z: Unit.describe('Normalised proximity, 0 = far/none, 1 = very close.'),
    seq,
    ms,
  })
  .describe('Continuous hover sample, sent only while an object is in view.');

export const GestureHeartbeat = z
  .object({
    t: z.literal('hb').describe('Heartbeat, every 2 s.'),
    fw: z.string().describe('Firmware version string.'),
    ms,
    paj: z
      .enum(['ok', 'missing', 'lost'])
      .optional()
      .describe('Optional (additive): sensor health as seen by the firmware.'),
  })
  .describe('Board heartbeat. Absence for > timeout means the link is lost.');

export const GestureError = z
  .object({
    t: z.literal('err').describe('Error report.'),
    msg: z.string().describe('Human-readable error message.'),
  })
  .describe('Error reported by the board firmware.');

/** One JSON object per line over USB serial at 115200 baud. */
export const GestureEvent = z
  .discriminatedUnion('t', [GestureHit, GestureHover, GestureHeartbeat, GestureError])
  .describe('Line-delimited JSON event emitted by the ESP32 gesture board.');
export type GestureEvent = z.infer<typeof GestureEvent>;
export type GestureHit = z.infer<typeof GestureHit>;
export type GestureHover = z.infer<typeof GestureHover>;
export type GestureHeartbeat = z.infer<typeof GestureHeartbeat>;
