"""Loading volumes and getting them into RAS.

Every array this module returns is paired with a 4x4 affine that maps voxel indices (i, j, k) to
RAS millimetres. NIfTI files are reoriented to the closest canonical (RAS+) orientation with
nibabel; DICOM series are read with SimpleITK (LPS) and converted to RAS by flipping x and y.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import nibabel as nib
import numpy as np

LPS_TO_RAS = np.diag([-1.0, -1.0, 1.0, 1.0])


@dataclass
class Volume:
    data: np.ndarray
    """Voxel array, indexed [i, j, k]."""
    affine: np.ndarray
    """4x4 voxel index -> RAS mm."""

    @property
    def voxel_volume_mm3(self) -> float:
        return float(abs(np.linalg.det(self.affine[:3, :3])))

    @property
    def spacing(self) -> np.ndarray:
        return np.sqrt((self.affine[:3, :3] ** 2).sum(axis=0))


def load_nifti(path: Path | str, canonical: bool = True) -> Volume:
    img = nib.load(str(path))
    if canonical:
        img = nib.as_closest_canonical(img)
    data = np.asanyarray(img.dataobj)
    return Volume(data=data, affine=np.asarray(img.affine, dtype=float))


def load_dicom_series(folder: Path | str) -> Volume:
    """Read a DICOM series folder (needs the optional `dicom` extra: SimpleITK)."""
    try:
        import SimpleITK as sitk  # type: ignore[import-not-found]
    except ImportError as e:  # pragma: no cover - optional dependency
        raise RuntimeError("DICOM needs SimpleITK: uv sync --extra dicom") from e
    reader = sitk.ImageSeriesReader()
    files = reader.GetGDCMSeriesFileNames(str(folder))
    if not files:
        raise FileNotFoundError(f"no DICOM series in {folder}")
    reader.SetFileNames(files)
    img = reader.Execute()
    # SimpleITK arrays are [k, j, i]; transpose to [i, j, k].
    data = np.transpose(sitk.GetArrayFromImage(img), (2, 1, 0))
    direction = np.array(img.GetDirection(), dtype=float).reshape(3, 3)
    spacing = np.array(img.GetSpacing(), dtype=float)
    lps = np.eye(4)
    lps[:3, :3] = direction * spacing  # columns scaled by spacing
    lps[:3, 3] = img.GetOrigin()
    return Volume(data=data, affine=LPS_TO_RAS @ lps)


def load_volume(path: Path | str) -> Volume:
    p = Path(path)
    if p.is_dir():
        return load_dicom_series(p)
    if p.name.endswith((".nii", ".nii.gz")):
        return load_nifti(p)
    raise ValueError(f"unsupported volume: {p} (expected .nii/.nii.gz or a DICOM folder)")


def save_nifti(vol: Volume, path: Path | str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    nib.save(nib.Nifti1Image(vol.data, vol.affine), str(path))


def voxel_to_ras(affine: np.ndarray, ijk: np.ndarray) -> np.ndarray:
    """Apply a 4x4 affine to an (N, 3) array of voxel coordinates."""
    ijk = np.atleast_2d(ijk).astype(float)
    return ijk @ affine[:3, :3].T + affine[:3, 3]
