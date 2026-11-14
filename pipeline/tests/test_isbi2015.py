"""ISBI 2015 ingest tests, on a small synthetic dataset tree (test fixtures only, never shipped).

The synthetic files copy the real dataset's layout and header convention: LPS voxel axes, zero
origin, so the tests exercise the same reorientation the real data needs.
"""

from __future__ import annotations

import json
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from offhand_pipeline import casepack
from offhand_pipeline.isbi2015 import (
    DatasetError,
    TrackParams,
    ingest_subject,
    lesion_volume_mm3,
    subject_visits,
    track_lesions,
)

SHAPE = (40, 44, 36)
SPACING = (0.8, 0.8, 1.5)
LICENSE = """%%%%%%%%%%%%%%%%%%%%
Data:
\tMS Longitudinal Challenge Data Set

Version: 1.0 (2015-02-11)

%%%%%%%%%%%%%%%%%%%%
Usage:

Synthetic test licence paragraph one.

Synthetic test licence paragraph two.

%%%%%%%%%%%%%%%%%%%%
Acknowledgment:

If you use this Data please acknowledge the following paper:
A. Test, "Synthetic citation", Journal, 2017.

%%%%%%%%%%%%%%%%%%%%
Copyright:

Copyright (c) synthetic
%%%%%%%%%%%%%%%%%%%%
"""


def lps_affine(spacing=SPACING) -> np.ndarray:
    """Same convention as the ISBI preprocessed files: x and y flipped, no origin offset."""
    return np.diag([-spacing[0], -spacing[1], spacing[2], 1.0])


def box(lo: tuple[int, int, int], size: tuple[int, int, int]) -> tuple[slice, slice, slice]:
    return tuple(slice(a, a + n) for a, n in zip(lo, size, strict=True))  # type: ignore[return-value]


def ras_of_voxel(ijk: tuple[float, float, float], spacing=SPACING) -> np.ndarray:
    """Hand-derived: i increases to the patient's left, j to posterior, k to superior."""
    i, j, k = ijk
    return np.array([-i * spacing[0], -j * spacing[1], k * spacing[2]])


# Lesion boxes (voxel corner, size). Visit 1 -> visit 2:
STABLE = ((5, 5, 5), (4, 4, 4))  # same in both visits: no finding
NEW = ((25, 8, 6), (4, 5, 6))  # absent at visit 1: new
GROW_V1, GROW_V2 = ((8, 25, 20), (3, 3, 3)), ((8, 25, 20), (5, 5, 5))  # 27 -> 125 voxels: enlarged
SHRINK_V1, SHRINK_V2 = ((25, 28, 22), (5, 5, 5)), ((25, 28, 22), (3, 3, 3))  # shrinks: no finding
GONE = ((15, 36, 4), (3, 3, 3))  # present at visit 1 only: no finding


def masks_for_visits() -> list[np.ndarray]:
    v1 = np.zeros(SHAPE, dtype=np.uint8)
    v2 = np.zeros(SHAPE, dtype=np.uint8)
    for b in (STABLE, GROW_V1, SHRINK_V1, GONE):
        v1[box(*b)] = 1
    for b in (STABLE, NEW, GROW_V2, SHRINK_V2):
        v2[box(*b)] = 1
    return [v1, v2]


def write_tree(root: Path, subject: str = "training01", landmark: tuple[int, int, int] = (30, 12, 25)) -> Path:
    sdir = root / "training" / subject
    (sdir / "preprocessed").mkdir(parents=True)
    (sdir / "masks").mkdir()
    (root / "training" / "license.txt").write_text(LICENSE, encoding="utf-8")
    a = lps_affine()
    i, j, k = np.indices(SHAPE)
    brain = ((i - 20) / 17) ** 2 + ((j - 22) / 19) ** 2 + ((k - 18) / 15) ** 2 <= 1.0
    for t, mask in enumerate(masks_for_visits(), start=1):
        flair = brain.astype(np.float32) * 100.0
        flair[landmark] = 5000.0  # a single bright voxel at a known position
        nib.save(nib.Nifti1Image(flair, a), str(sdir / "preprocessed" / f"{subject}_{t:02d}_flair_pp.nii"))
        nib.save(nib.Nifti1Image(flair, a), str(sdir / "preprocessed" / f"{subject}_{t:02d}_mprage_pp.nii"))
        for r in (1, 2):
            nib.save(nib.Nifti1Image(mask, a), str(sdir / "masks" / f"{subject}_{t:02d}_mask{r}.nii"))
    return root


def test_orientation_known_landmark_lands_at_its_ras_coordinate(tmp_path: Path) -> None:
    landmark = (30, 12, 25)
    raw = write_tree(tmp_path / "raw", landmark=landmark)
    r = ingest_subject(raw, "training01", tmp_path / "out", lesion_faces=2000, brain_faces=4000)

    img = nib.load(str(r.out / "volumes" / "flair-visit-01.nii.gz"))
    assert "".join(nib.aff2axcodes(img.affine)) == "RAS"
    data = np.asanyarray(img.dataobj)
    peak = np.unravel_index(int(np.argmax(data)), data.shape)
    world = nib.affines.apply_affine(img.affine, peak)
    np.testing.assert_allclose(world, ras_of_voxel(landmark), atol=1e-4)
    # 30 voxels along the file's i axis at 0.8 mm = 24 mm to the patient's LEFT (negative R).
    np.testing.assert_allclose(world, [-24.0, -9.6, 37.5], atol=1e-4)

    # The new lesion's finding centre is the centre of its voxels, in RAS mm.
    (lo, size) = NEW
    centre_vox = tuple(a + (n - 1) / 2 for a, n in zip(lo, size, strict=True))
    f = next(x for x in r.findings if x["kind"] == "new")
    np.testing.assert_allclose(f["center"], ras_of_voxel(centre_vox), atol=0.01)


def test_measured_volume_matches_hand_computed_value() -> None:
    mask = np.zeros(SHAPE, dtype=bool)
    mask[box((10, 10, 10), (4, 5, 6))] = True
    # 4 * 5 * 6 = 120 voxels; each voxel 0.8 * 0.8 * 1.5 = 0.96 mm³; 120 * 0.96 = 115.2 mm³.
    assert lesion_volume_mm3(mask, lps_affine()) == pytest.approx(115.2)
    assert lesion_volume_mm3(mask, np.diag([2.0, 1.0, 0.5, 1.0])) == pytest.approx(120.0)


def test_findings_only_for_new_or_enlarged_lesions() -> None:
    found = track_lesions(masks_for_visits(), lps_affine(), ["visit-01", "visit-02"], TrackParams(min_voxels=10))
    assert sorted(f["kind"] for f in found) == ["enlarged", "new"]
    assert {f["timepointId"] for f in found} == {"visit-02"}

    new = next(f for f in found if f["kind"] == "new")
    assert new["volumeMm3"] == pytest.approx(115.2)  # the 4 x 5 x 6 box
    assert new["volumesMm3"] == {"visit-01": 0.0, "visit-02": pytest.approx(115.2)}
    assert new["reportExcerpt"] == (
        "The consensus of both rater masks shows a lesion of 115.2 mm³ at visit 2, not present at visit 1."
    )

    grown = next(f for f in found if f["kind"] == "enlarged")
    assert grown["previousMm3"] == pytest.approx(27 * 0.96)  # 25.92
    assert grown["volumeMm3"] == pytest.approx(125 * 0.96)  # 120.0
    assert grown["reportExcerpt"] == (
        "The consensus of both rater masks shows a lesion of 120 mm³ at visit 2, up from 25.9 mm³ at visit 1."
    )


def test_small_or_modest_growth_is_not_reported() -> None:
    v1 = np.zeros(SHAPE, dtype=bool)
    v2 = np.zeros(SHAPE, dtype=bool)
    v1[box((5, 5, 5), (5, 5, 5))] = True  # 125 voxels
    v2[box((5, 5, 5), (5, 5, 6))] = True  # 150 voxels: +20 %, below the 50 % rule
    v2[box((30, 30, 30), (2, 2, 2))] = True  # 8 voxels: new but below min_voxels
    assert track_lesions([v1, v2], np.eye(4), ["a", "b"], TrackParams(min_voxels=10)) == []


def test_ingest_writes_a_valid_neuroview_case(tmp_path: Path) -> None:
    raw = write_tree(tmp_path / "raw")
    r = ingest_subject(raw, "training01", tmp_path / "neuroview", lesion_faces=2000, brain_faces=4000)
    assert casepack.validate_case_dir(r.out) == []
    m = json.loads((r.out / "manifest.json").read_text())
    assert m["caseId"] == "isbi2015-training01" and m["app"] == "neuroview" and m["policyId"] == "neuroview-v1"
    assert [t["id"] for t in m["timepoints"]] == ["visit-01", "visit-02"]
    assert [v["timepointId"] for v in m["volumes"]] == ["visit-01", "visit-02"]
    assert {f["provenance"] for f in m["findings"]} == {"measured"}
    assert m["source"]["citation"] == 'A. Test, "Synthetic citation", Journal, 2017.'
    assert "Synthetic test licence paragraph one." in m["source"]["license"]
    lesion_layers = [layer for layer in m["layers"] if layer["id"].startswith("lesions-")]
    assert {(layer["id"], layer["timepointId"]) for layer in lesion_layers} == {
        ("lesions-r1-visit-01", "visit-01"),
        ("lesions-r2-visit-01", "visit-01"),
        ("lesions-r1-visit-02", "visit-02"),
        ("lesions-r2-visit-02", "visit-02"),
    }
    assert all(n <= 4000 for n in r.faces.values())


def test_missing_files_are_reported(tmp_path: Path) -> None:
    raw = write_tree(tmp_path / "raw")
    (raw / "training" / "training01" / "masks" / "training01_02_mask2.nii").unlink()
    with pytest.raises(DatasetError, match="masks/training01_02_mask2.nii"):
        subject_visits(raw, "training01")
