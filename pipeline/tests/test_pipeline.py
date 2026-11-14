"""Pipeline tests. Synthetic sphere volumes only (test fixtures, never shipped as case packs)."""

from __future__ import annotations

import json
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
import trimesh

from offhand_pipeline import casepack
from offhand_pipeline.build import build_from_spec, face_majority
from offhand_pipeline.mesh import components, mask_to_mesh
from offhand_pipeline.testpattern import build_testpattern
from offhand_pipeline.volume import load_nifti


def sphere_mask(shape: tuple[int, int, int], center_vox: tuple[float, float, float], r_vox: float) -> np.ndarray:
    i, j, k = np.indices(shape)
    c = np.array(center_vox)
    return (i - c[0]) ** 2 + (j - c[1]) ** 2 + (k - c[2]) ** 2 <= r_vox**2


def affine(spacing=(1.0, 1.0, 1.0), origin=(0.0, 0.0, 0.0), flip_x=False) -> np.ndarray:
    a = np.diag([*spacing, 1.0])
    a[:3, 3] = origin
    if flip_x:
        a[0, 0] = -a[0, 0]
    return a


def test_sphere_mesh_centre_and_radius_within_1mm() -> None:
    # 0.8 x 0.8 x 1.5 mm voxels, sphere radius 20 mm, centred at a known world position.
    sp = (0.8, 0.8, 1.5)
    origin = (-40.0, 12.0, 100.0)
    center_mm = np.array([0.0, 50.0, 140.0])
    center_vox = (center_mm - np.array(origin)) / np.array(sp)
    shape = (100, 100, 60)
    i, j, k = np.indices(shape)
    world = np.stack([i * sp[0] + origin[0], j * sp[1] + origin[1], k * sp[2] + origin[2]], -1)
    mask = np.linalg.norm(world - center_mm, axis=-1) <= 20.0
    assert center_vox[2] < shape[2]

    mesh = mask_to_mesh(mask, affine(sp, origin))
    assert mesh.is_watertight
    assert mesh.volume > 0  # outward normals
    assert np.linalg.norm(mesh.centroid - center_mm) < 1.0
    radius = np.linalg.norm(mesh.vertices - mesh.centroid, axis=1).mean()
    assert abs(radius - 20.0) < 1.0


def test_mirrored_affine_keeps_outward_normals() -> None:
    mask = sphere_mask((40, 40, 40), (20, 20, 20), 10)
    mesh = mask_to_mesh(mask, affine(flip_x=True))
    assert mesh.volume > 0


def test_las_file_is_reoriented_to_ras(tmp_path: Path) -> None:
    # Sphere on the patient's RIGHT (+x in RAS), stored in an LAS file (x axis flipped).
    shape = (64, 64, 64)
    a = affine(flip_x=True)
    a[0, 3] = 31.5  # voxel i=0 is at x=+31.5, i=63 at x=-31.5
    center_vox_i = 31.5 - 20.0  # world x = +20 -> i = 11.5
    mask = sphere_mask(shape, (center_vox_i, 31.5, 31.5), 6)
    path = tmp_path / "las.nii.gz"
    nib.save(nib.Nifti1Image(mask.astype(np.uint8), a), str(path))

    vol = load_nifti(path)
    assert "".join(nib.aff2axcodes(vol.affine)) == "RAS"
    mesh = mask_to_mesh(vol.data > 0, vol.affine)
    assert mesh.centroid[0] == pytest.approx(20.0, abs=1.0)  # still on the right


def test_components_report_centre_and_radius() -> None:
    mask = sphere_mask((60, 60, 60), (15, 15, 15), 5) | sphere_mask((60, 60, 60), (45, 45, 45), 8)
    comps = components(mask, affine((2, 2, 2)))
    assert len(comps) == 2
    big = comps[0]
    assert big["center"] == pytest.approx([90, 90, 90], abs=0.5)
    assert big["radiusMm"] == pytest.approx(16, abs=1.0)


def test_face_majority() -> None:
    labels = np.array([0, 11, 11, 21])
    faces = np.array([[0, 1, 2], [1, 2, 3], [0, 1, 3], [1, 0, 0]])
    assert face_majority(labels, faces).tolist() == [11, 11, 0, 0]


def test_testpattern_is_valid(tmp_path: Path) -> None:
    out = tmp_path / "test-pattern" / "tp-001"
    m = build_testpattern(out)
    assert casepack.validate_case_dir(out) == []
    assert [layer["peelOrder"] for layer in m["layers"]] == [0, 1, 2, 3, 3]
    glb = trimesh.load(out / "layers" / "cube-outer.glb", force="mesh")
    assert glb.extents == pytest.approx([120, 120, 120])


def test_manifest_validation_catches_problems(tmp_path: Path) -> None:
    out = tmp_path / "test-pattern" / "tp-001"
    build_testpattern(out)
    m = json.loads((out / "manifest.json").read_text())

    bad = dict(m, coordinateSystem="LPS")
    assert any("coordinateSystem" in e for e in casepack.validate_manifest(bad))

    bad = json.loads(json.dumps(m))
    bad["layers"][0]["file"] = "../../etc/passwd"
    assert casepack.validate_manifest(bad)

    bad = json.loads(json.dumps(m))
    bad["findings"][0]["layerId"] = "nope"
    assert any("unknown layerId" in e for e in casepack.validate_manifest(bad))

    (out / "layers" / "axes.glb").unlink()
    assert any("missing file" in e for e in casepack.validate_case_dir(out))


def test_build_from_spec(tmp_path: Path) -> None:
    # Synthetic label map: 1 = big sphere, 2 = small sphere inside it.
    shape = (48, 48, 48)
    labels = np.zeros(shape, dtype=np.uint8)
    labels[sphere_mask(shape, (24, 24, 24), 18)] = 1
    labels[sphere_mask(shape, (24, 24, 30), 5)] = 2
    nib.save(nib.Nifti1Image(labels, affine((1.5, 1.5, 1.5))), str(tmp_path / "seg.nii.gz"))
    spec = {
        "app": "synthetic",
        "caseId": "s-001",
        "title": "synthetic spheres",
        "source": {"dataset": "unit test", "url": "", "license": "n/a", "citation": "n/a", "subjectId": "0"},
        "labels": "seg.nii.gz",
        "layers": [
            {"id": "outer", "label": "label 1", "values": [1, 2], "color": "#888888", "defaultOpacity": 0.3, "peelOrder": 0},
            {"id": "inner", "label": "label 2", "values": [2], "color": "#ff0000", "defaultOpacity": 1, "peelOrder": 1},
        ],
        "volumes": [{"id": "seg", "file": "seg.nii.gz", "modality": "SEG", "sequence": "labels"}],
        "findings": [{"layerId": "inner", "values": [2], "labelPrefix": "label 2", "minVoxels": 5}],
        "policyId": "none",
        "maxFaces": 20000,
    }
    (tmp_path / "spec.json").write_text(json.dumps(spec))
    out = build_from_spec(tmp_path / "spec.json", tmp_path / "synthetic" / "s-001")
    assert casepack.validate_case_dir(out) == []
    m = json.loads((out / "manifest.json").read_text())
    f = m["findings"][0]
    assert f["provenance"] == "dataset_label"
    assert f["center"] == pytest.approx([36, 36, 45], abs=1.0)
    total = sum(len(trimesh.load(out / layer["file"], force="mesh").faces) for layer in m["layers"])
    assert total <= 20000 + 4000
