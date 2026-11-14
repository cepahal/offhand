"""Label masks -> surface meshes in RAS millimetres.

marching cubes (in voxel space) -> affine to RAS mm -> fix winding -> Taubin smoothing (does not
shrink like plain Laplacian) -> quadric decimation to a face budget.
"""

from __future__ import annotations

import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

from .volume import voxel_to_ras


def mask_to_mesh(
    mask: np.ndarray,
    affine: np.ndarray,
    smooth_iterations: int = 15,
    max_faces: int | None = None,
) -> trimesh.Trimesh:
    """Surface of a binary mask, in the affine's world space (RAS mm), outward-facing normals."""
    m = np.asarray(mask, dtype=bool)
    if not m.any():
        raise ValueError("empty mask")
    # Crop to the bounding box (+1 voxel padding) for speed, then shift back.
    idx = np.argwhere(m)
    lo = np.maximum(idx.min(axis=0) - 1, 0)
    hi = idx.max(axis=0) + 2
    sub = np.pad(m[lo[0] : hi[0], lo[1] : hi[1], lo[2] : hi[2]], 1).astype(np.float32)
    # A light blur before marching cubes removes the voxel staircase without moving the 0.5 level.
    sub = ndimage.gaussian_filter(sub, sigma=0.5)
    verts, faces, _normals, _ = measure.marching_cubes(sub, level=0.5)
    verts = verts + lo - 1  # undo crop + pad
    world = voxel_to_ras(affine, verts)
    if np.linalg.det(affine[:3, :3]) < 0:
        faces = faces[:, ::-1]  # a mirroring affine flips the winding
    mesh = trimesh.Trimesh(vertices=world, faces=faces, process=True)
    if mesh.volume < 0:
        mesh.invert()
    if smooth_iterations > 0:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=smooth_iterations)
    if max_faces and len(mesh.faces) > max_faces:
        mesh = decimate(mesh, max_faces)
    return mesh


def decimate(mesh: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    if len(mesh.faces) <= max_faces:
        return mesh
    out = mesh.simplify_quadric_decimation(face_count=int(max_faces))
    if out.volume < 0:
        out.invert()
    return out


def split_budget(face_counts: dict[str, int], total: int) -> dict[str, int]:
    """Share a total face budget between layers in proportion to their size (min 2,000 each)."""
    n = sum(face_counts.values())
    if n <= total:
        return dict(face_counts)
    return {k: max(2000, int(total * c / n)) for k, c in face_counts.items()}


def components(mask: np.ndarray, affine: np.ndarray, min_voxels: int = 1) -> list[dict]:
    """Connected components of a mask: centre (RAS mm), equivalent-sphere radius (mm), voxels."""
    lab, n = ndimage.label(np.asarray(mask, dtype=bool))
    if n == 0:
        return []
    vox_mm3 = float(abs(np.linalg.det(affine[:3, :3])))
    sizes = ndimage.sum_labels(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    centers = ndimage.center_of_mass(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    out = []
    for size, c in zip(sizes, centers, strict=True):
        if size < min_voxels:
            continue
        vol = float(size) * vox_mm3
        out.append(
            {
                "center": [round(float(x), 2) for x in voxel_to_ras(affine, np.array(c))[0]],
                "radiusMm": round((3 * vol / (4 * np.pi)) ** (1 / 3), 2),
                "voxels": int(size),
                "volumeMm3": round(vol, 1),
            }
        )
    out.sort(key=lambda d: -d["voxels"])
    return out
