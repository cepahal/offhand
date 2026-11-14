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


ITK_SUFFIXES = (".mha", ".mhd", ".nrrd", ".nhdr")


def _sitk():
    try:
        import SimpleITK as sitk  # type: ignore[import-not-found]
    except ImportError as e:  # pragma: no cover - optional dependency
        raise RuntimeError("DICOM/MetaImage/NRRD need SimpleITK: uv sync --extra dicom") from e
    return sitk


def load_dicom_series(folder: Path | str) -> Volume:
    """Read a DICOM series folder (needs the optional `dicom` extra: SimpleITK)."""
    sitk = _sitk()
    reader = sitk.ImageSeriesReader()
    files = reader.GetGDCMSeriesFileNames(str(folder))
    if not files:
        raise FileNotFoundError(f"no DICOM series in {folder}")
    reader.SetFileNames(files)
    return _from_sitk(reader.Execute())


def load_itk_image(path: Path | str) -> Volume:
    """Read a MetaImage (.mha/.mhd) or NRRD file. ITK physical space is LPS; converted to RAS."""
    return _from_sitk(_sitk().ReadImage(str(path)))


def _from_sitk(img) -> Volume:  # noqa: ANN001
    sitk = _sitk()
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
    if p.name.lower().endswith(ITK_SUFFIXES):
        return load_itk_image(p)
    raise ValueError(f"unsupported volume: {p} (expected .nii/.nii.gz, .mha/.mhd/.nrrd or a DICOM folder)")


def save_nifti(vol: Volume, path: Path | str) -> None:
    """Write RAS+ canonical NIfTI (axis flips only; voxel values untouched)."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img = nib.as_closest_canonical(nib.Nifti1Image(vol.data, vol.affine))
    img.set_qform(img.affine, code=1)
    img.set_sform(img.affine, code=1)
    nib.save(img, str(path))


def crop_to(vol: Volume, ras_lo: np.ndarray, ras_hi: np.ndarray) -> Volume:
    """Crop to the voxels inside an axis-aligned RAS box (inclusive)."""
    corners = np.array([[x, y, z] for x in (ras_lo[0], ras_hi[0]) for y in (ras_lo[1], ras_hi[1])
                        for z in (ras_lo[2], ras_hi[2])])
    inv = np.linalg.inv(vol.affine)
    ijk = corners @ inv[:3, :3].T + inv[:3, 3]
    shape = np.array(vol.data.shape[:3])
    lo = np.clip(np.floor(ijk.min(axis=0)).astype(int), 0, shape)
    hi = np.clip(np.ceil(ijk.max(axis=0)).astype(int) + 1, 0, shape)
    data = vol.data[lo[0] : hi[0], lo[1] : hi[1], lo[2] : hi[2]]
    aff = vol.affine.copy()
    aff[:3, 3] = voxel_to_ras(vol.affine, lo)[0]
    return Volume(data=data, affine=aff)


def label_bounds_ras(vol: Volume, margin_mm: float) -> tuple[np.ndarray, np.ndarray]:
    """RAS box around all non-zero voxels, grown by margin_mm."""
    m = np.asarray(vol.data) != 0
    nz = [np.nonzero(np.any(m, axis=ax))[0] for ax in ((1, 2), (0, 2), (0, 1))]
    if any(len(a) == 0 for a in nz):
        raise ValueError("label map is empty")
    lo = np.array([a.min() for a in nz], dtype=float)
    hi = np.array([a.max() for a in nz], dtype=float)
    pts = voxel_to_ras(vol.affine, np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1])
                                              for z in (lo[2], hi[2])]))
    return pts.min(axis=0) - margin_mm, pts.max(axis=0) + margin_mm


def voxel_to_ras(affine: np.ndarray, ijk: np.ndarray) -> np.ndarray:
    """Apply a 4x4 affine to an (N, 3) array of voxel coordinates."""
    ijk = np.atleast_2d(ijk).astype(float)
    return ijk @ affine[:3, :3].T + affine[:3, 3]
