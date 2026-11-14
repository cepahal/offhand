import { open } from "node:fs/promises";
import { constants, gunzipSync } from "node:zlib";

/** Voxel counts along the three volume axes, from a NIfTI-1 header (.nii or .nii.gz). */
export async function niftiDims(file: string): Promise<[number, number, number]> {
  return (await niftiHeader(file)).dims;
}

export interface NiftiHeader {
  dims: [number, number, number];
  /** sform rows (srow_x, srow_y, srow_z): voxel index -> RAS mm. */
  srow: [number[], number[], number[]];
}

/** Voxel index along each axis nearest a RAS point, for an axis-aligned (canonical) volume. */
export function rasToIndex(h: NiftiHeader, ras: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((k) => {
    const row = h.srow[k]!;
    const scale = row[k]!;
    const i = scale ? Math.round((ras[k]! - row[3]!) / scale) : 0;
    return Math.min(h.dims[k]! - 1, Math.max(0, i));
  }) as [number, number, number];
}

export async function niftiHeader(file: string): Promise<NiftiHeader> {
  const fh = await open(file, "r");
  let raw: Buffer;
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    raw = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  const header = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }) : raw;
  if (header.length < 348) throw new Error(`${file}: NIfTI header is truncated`);
  const le = header.readInt32LE(0) === 348;
  if (!le && header.readInt32BE(0) !== 348) throw new Error(`${file}: not a NIfTI-1 file`);
  const dim = (i: number) => (le ? header.readInt16LE(40 + 2 * i) : header.readInt16BE(40 + 2 * i));
  const dims: [number, number, number] = [dim(1), dim(2), dim(3)];
  if (dim(0) < 3 || dims.some((d) => d < 1)) throw new Error(`${file}: not a 3D volume`);
  const f32 = (off: number) => (le ? header.readFloatLE(off) : header.readFloatBE(off));
  const row = (off: number) => [0, 1, 2, 3].map((i) => f32(off + 4 * i));
  return { dims, srow: [row(280), row(296), row(312)] };
}
