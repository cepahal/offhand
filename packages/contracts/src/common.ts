import { z } from 'zod';

export const Vec3 = z
  .tuple([z.number(), z.number(), z.number()])
  .describe('3-vector [x, y, z]. In case packs this is RAS millimetres.');
export type Vec3 = z.infer<typeof Vec3>;

export const Unit = z.number().min(0).max(1);

export const AppId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .describe('App id, e.g. "chairside", "kneeview", "neuroview", "jawline", or "test-pattern".');
export type AppId = z.infer<typeof AppId>;
