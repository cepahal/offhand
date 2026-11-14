"""ToothFairy2 CBCT case -> build spec (then built by build.build_from_spec).

Uses the dataset's own label map only: one layer per structure present in the case, so each tooth
is its own mesh (FDI numbering, as in the dataset). Some ToothFairy2 headers are rotated 180 degrees
relative to the anatomy, so orientation_fix() checks the labelled teeth and writes a corrective
"worldTransform" into the spec (applied to labels and image together). Peel order, outermost first:
    0  jawbones, sinuses, pharynx
    1  teeth + restorations (crowns, bridges, implants)
    2  inferior alveolar (nerve) canals
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np

from .volume import Volume, load_volume, voxel_to_ras

SOURCE = {
    "dataset": "ToothFairy2 (MICCAI 2024 challenge, training set)",
    "url": "https://ditto.ing.unimore.it/toothfairy2/",
    "license": "CC BY-SA 4.0",
    "citation": (
        "Bolelli F. et al. (2026) Multi-structure segmentation in CBCT volumes: The ToothFairy2 "
        "challenge. Medical Image Analysis, 104095. doi:10.1016/j.media.2026.104095; Bolelli F. et al. "
        "(2025) Segmenting Maxillofacial Structures in CBCT Volume, CVPR. Meshes derived from the "
        "dataset's expert labels. Not for diagnosis."
    ),
}

BONE = "#e8dcc4"
TOOTH = "#f7f3e8"


def _style(value: int) -> tuple[str, str, float, int]:
    """(layer id, colour, default opacity, peel order) for a ToothFairy2 label value."""
    fixed = {
        1: ("lower-jawbone", BONE, 1.0, 0),
        2: ("upper-jawbone", BONE, 1.0, 0),
        3: ("left-ia-canal", "#f2c230", 1.0, 2),
        4: ("right-ia-canal", "#f2c230", 1.0, 2),
        5: ("left-maxillary-sinus", "#7fb3d5", 0.35, 0),
        6: ("right-maxillary-sinus", "#7fb3d5", 0.35, 0),
        7: ("pharynx", "#9ec9e2", 0.25, 0),
        8: ("bridge", "#b8c0c8", 1.0, 1),
        9: ("crown", "#c8ced4", 1.0, 1),
        10: ("implant", "#8a9199", 1.0, 1),
    }
    if value in fixed:
        return fixed[value]
    return (f"tooth-{value}", TOOTH, 1.0, 1)


def make_spec(case_dir: Path, dataset_json: Path, spec_path: Path, case_id: str, title: str,
              max_faces: int) -> dict[str, Any]:
    names = {int(v): k for k, v in json.loads(dataset_json.read_text(encoding="utf-8"))["labels"].items()}
    labels_file = case_dir / "label.mha"
    image_file = case_dir / "image.mha"
    lab = load_volume(labels_file)
    present = sorted(int(x) for x in np.unique(np.asarray(lab.data)) if x != 0)
    world = orientation_fix(lab)

    def rel(p: Path) -> str:
        return Path(os.path.relpath(p.resolve(), spec_path.parent.resolve())).as_posix()

    layers = []
    for val in present:
        name = names.get(val)
        if name is None or name == "NA":
            continue
        lid, color, opacity, peel = _style(val)
        label = f"Tooth {val} ({name})" if lid.startswith("tooth-") else name
        layers.append({"id": lid, "label": label, "values": [val], "color": color,
                       "defaultOpacity": opacity, "peelOrder": peel})
    return {
        "app": "dental",
        "caseId": case_id,
        "title": title,
        "source": {**SOURCE, "subjectId": case_dir.name},
        "labels": rel(labels_file),
        "layers": layers,
        "volumes": [{"id": "cbct", "file": rel(image_file), "modality": "CBCT", "sequence": "CBCT",
                     "dtype": "int16", "cropToLabels": {"labels": rel(labels_file), "marginMm": 10}}],
        "findings": [],
        "share": {"templateId": "default", "pollOptions": []},
        "policyId": "default",
        "maxFaces": max_faces,
        "worldTransform": world.tolist(),
    }


def _centroid(lab: Volume, values: list[int]) -> np.ndarray | None:
    idx = np.argwhere(np.isin(np.asarray(lab.data), values))
    if len(idx) == 0:
        return None
    return voxel_to_ras(lab.affine, idx.mean(axis=0))[0]


def orientation_fix(lab: Volume) -> np.ndarray:
    """4x4 axis flips that make the header agree with the anatomy in the labels.

    Checks: patient-right teeth (FDI 1x, 4x) at +R vs left (2x, 3x); upper teeth (1x, 2x) superior
    to lower (3x, 4x); incisors (x1, x2) anterior to molars (x6, x7). Flips are about the origin.
    """
    def q(*quads: int, pos: tuple[int, ...] = tuple(range(1, 9))) -> list[int]:
        return [10 * a + b for a in quads for b in pos]

    pairs = [  # (axis, should-be-greater group, should-be-smaller group)
        (0, q(1, 4), q(2, 3)),
        (1, q(1, 2, 3, 4, pos=(1, 2)), q(1, 2, 3, 4, pos=(6, 7))),
        (2, q(1, 2), q(3, 4)),
    ]
    flip = np.ones(4)
    for axis, hi, lo in pairs:
        a, b = _centroid(lab, hi), _centroid(lab, lo)
        if a is None or b is None:
            raise ValueError(f"cannot check orientation axis {'RAS'[axis]}: teeth missing")
        if a[axis] < b[axis]:
            flip[axis] = -1
    if np.prod(flip[:3]) < 0:
        raise ValueError(f"orientation fix {flip[:3]} would mirror the anatomy; check this case by hand")
    return np.diag(flip)
