"""ISBI 2015 longitudinal MS lesion challenge (training data) -> NeuroView case packs.

Expected layout (as unpacked from training_final_v4.zip):

    <raw>/training/license.txt
    <raw>/training/trainingNN/preprocessed/trainingNN_TT_{flair,mprage}_pp.nii
    <raw>/training/trainingNN/masks/trainingNN_TT_mask{1,2}.nii

The preprocessed images and both raters' masks share one grid per subject (the dataset registers
every visit to the subject's baseline in a 1 mm template space), so masks from different visits
can be compared voxel by voxel. Everything is reoriented to RAS with nibabel; millimetres come
from the NIfTI header.

Nothing here is written by hand: layer labels name the rater and visit, finding sentences are
filled in from measured volumes, and the source block is copied from the dataset's license.txt.

The dataset licence forbids redistributing the data or anything derived from it, so the case
packs this writes stay local (casepacks/neuroview/ is git-ignored).
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage

from . import casepack
from .mesh import decimate, mask_to_mesh
from .volume import Volume, load_nifti, save_nifti

APP = "neuroview"
POLICY_ID = "neuroview-v1"
DATASET = "ISBI 2015 Longitudinal MS Lesion Segmentation Challenge, training data (IACL, Johns Hopkins University)"
URL = "https://iacl.ece.jhu.edu/index.php/MSChallenge"
RATERS = (1, 2)
# 26-connectivity: voxels touching at an edge or corner belong to the same lesion cluster.
CONNECTIVITY = np.ones((3, 3, 3), dtype=bool)

RATER_COLORS = {1: "#ff8c1a", 2: "#33ccff"}
RATER_OPACITY = {1: 0.95, 2: 0.6}
FINDINGS_MASK_TEXT = {
    "consensus": "The consensus of both rater masks",
    "rater1": "Rater 1 mask",
    "rater2": "Rater 2 mask",
}


class DatasetError(ValueError):
    """The files on disk do not match the layout this ingest expects."""


@dataclass(frozen=True)
class TrackParams:
    min_voxels: int = 10
    """Clusters smaller than this (at the later visit) are not reported."""
    enlarge_ratio: float = 0.5
    """Enlarged = volume grew by at least this fraction of the earlier volume ..."""
    enlarge_min_mm3: float = 20.0
    """... and by at least this many mm³."""


@dataclass(frozen=True)
class Visit:
    number: int
    flair: Path
    mprage: Path
    masks: dict[int, Path]

    @property
    def id(self) -> str:
        return f"visit-{self.number:02d}"


# ------------------------------------------------------------------------------------------------
# Dataset discovery
# ------------------------------------------------------------------------------------------------
def training_dir(raw: Path) -> Path:
    for cand in (raw / "training", raw):
        if any(cand.glob("training[0-9]*/preprocessed")):
            return cand
    raise DatasetError(f"no training<NN>/preprocessed folders under {raw} or {raw / 'training'}")


def find_subjects(raw: Path) -> list[str]:
    return sorted(p.name for p in training_dir(raw).glob("training[0-9]*") if (p / "preprocessed").is_dir())


def subject_visits(raw: Path, subject: str) -> list[Visit]:
    """All visits of one subject, in order, with every file checked to exist."""
    sdir = training_dir(raw) / subject
    pat = re.compile(rf"^{re.escape(subject)}_(\d+)_flair_pp\.nii(\.gz)?$")
    numbers = sorted(int(m.group(1)) for p in (sdir / "preprocessed").iterdir() if (m := pat.match(p.name)))
    if not numbers:
        raise DatasetError(f"{subject}: no {subject}_<TT>_flair_pp.nii in {sdir / 'preprocessed'}")
    visits, missing = [], []
    for n in numbers:

        def find(folder: str, stem: str) -> Path:
            for ext in (".nii", ".nii.gz"):
                p = sdir / folder / f"{subject}_{n:02d}_{stem}{ext}"
                if p.exists():
                    return p
            missing.append(f"{folder}/{subject}_{n:02d}_{stem}.nii")
            return Path()

        visits.append(
            Visit(n, find("preprocessed", "flair_pp"), find("preprocessed", "mprage_pp"), {r: find("masks", f"mask{r}") for r in RATERS})
        )
    if missing:
        raise DatasetError(f"{subject}: missing " + ", ".join(missing))
    if numbers != list(range(1, len(numbers) + 1)):
        raise DatasetError(f"{subject}: visit numbers are not 1..{len(numbers)}: {numbers}")
    return visits


def read_source(raw: Path, subject: str) -> dict[str, str]:
    """Source block, with licence and citation copied from the dataset's license.txt."""
    lic = training_dir(raw) / "license.txt"
    if not lic.exists():
        raise DatasetError(f"{lic} not found (the licence and citation are copied from it)")
    sections = [s.strip() for s in re.split(r"(?:%{10,}\s*)+", lic.read_text(encoding="utf-8", errors="replace")) if s.strip()]

    def section(head: str) -> str:
        for s in sections:
            if s.startswith(head):
                return s[len(head) :].strip()
        raise DatasetError(f"{lic}: no '{head}' section")

    def flat(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    usage = [flat(p) for p in re.split(r"\n\s*\n", section("Usage:")) if p.strip()]
    data = flat(section("Data:"))
    version = m.group(0) if (m := re.search(r"Version:\s*\S+(?:\s*\([^)]*\))?", data)) else ""
    ack = section("Acknowledgment:")
    citation = flat(ack.split("following paper:", 1)[-1])
    copyright_ = flat(section("Copyright:"))
    license_text = " ".join(p for p in [f"MS Longitudinal Challenge Data Set licence, {version}." if version else "", *usage[:2], copyright_] if p)
    return {"dataset": DATASET, "url": URL, "license": license_text, "citation": citation, "subjectId": subject}


# ------------------------------------------------------------------------------------------------
# Measurements
# ------------------------------------------------------------------------------------------------
def voxel_volume_mm3(affine: np.ndarray) -> float:
    return float(abs(np.linalg.det(np.asarray(affine)[:3, :3])))


def lesion_volume_mm3(mask: np.ndarray, affine: np.ndarray) -> float:
    """Volume of a binary mask: voxel count times the voxel volume from the affine."""
    return float(np.count_nonzero(mask)) * voxel_volume_mm3(affine)


def fmt_mm3(v: float) -> str:
    r = round(v, 1)
    return f"{int(r)}" if r == int(r) else f"{r:.1f}"


def track_lesions(
    masks: list[np.ndarray],
    affine: np.ndarray,
    visit_ids: list[str],
    params: TrackParams = TrackParams(),
    who: str = FINDINGS_MASK_TEXT["consensus"],
) -> list[dict[str, Any]]:
    """Lesion clusters that are new or enlarged at each visit compared with the visit before.

    A cluster at visit t is *new* when none of its voxels is lesion at visit t-1, and *enlarged*
    when the clusters it overlaps at t-1 add up to a volume it exceeds by both
    `params.enlarge_ratio` (relative) and `params.enlarge_min_mm3` (absolute). Each result carries
    the lesion's volume at every visit: the clusters at that visit that overlap it.
    """
    if len(masks) != len(visit_ids):
        raise ValueError("one mask per visit")
    vox = voxel_volume_mm3(affine)
    labelled = [ndimage.label(np.asarray(m, dtype=bool), structure=CONNECTIVITY) for m in masks]
    sizes = [np.bincount(lab.ravel(), minlength=n + 1) for lab, n in labelled]

    def overlap_mm3(t: int, region: np.ndarray) -> float:
        lab, _ = labelled[t]
        ids = np.unique(lab[region])
        ids = ids[ids > 0]
        return float(sizes[t][ids].sum()) * vox

    out: list[dict[str, Any]] = []
    for t in range(1, len(masks)):
        lab, n = labelled[t]
        if n == 0:
            continue
        objs = ndimage.find_objects(lab)
        found: list[dict[str, Any]] = []
        for cid in range(1, n + 1):
            if sizes[t][cid] < params.min_voxels:
                continue
            sl = objs[cid - 1]
            region = np.zeros(lab.shape, dtype=bool)
            region[sl] = lab[sl] == cid
            vol = float(sizes[t][cid]) * vox
            prev = overlap_mm3(t - 1, region)
            if prev == 0:
                kind = "new"
                excerpt = f"{who} shows a lesion of {fmt_mm3(vol)} mm³ at visit {t + 1}, not present at visit {t}."
            elif vol >= prev * (1 + params.enlarge_ratio) and vol - prev >= params.enlarge_min_mm3:
                kind = "enlarged"
                excerpt = f"{who} shows a lesion of {fmt_mm3(vol)} mm³ at visit {t + 1}, up from {fmt_mm3(prev)} mm³ at visit {t}."
            else:
                continue
            idx = np.argwhere(region)
            center_vox = idx.mean(axis=0)
            center = np.asarray(affine)[:3, :3] @ center_vox + np.asarray(affine)[:3, 3]
            found.append(
                {
                    "kind": kind,
                    "visit": t + 1,
                    "timepointId": visit_ids[t],
                    "center": [round(float(x), 2) for x in center],
                    "radiusMm": round(float((3 * vol / (4 * np.pi)) ** (1 / 3)), 2),
                    "volumeMm3": round(vol, 1),
                    "previousMm3": round(prev, 1),
                    "volumesMm3": {visit_ids[v]: round(overlap_mm3(v, region), 1) for v in range(len(masks))},
                    "reportExcerpt": excerpt,
                }
            )
        found.sort(key=lambda f: -f["volumeMm3"])
        for i, f in enumerate(found, start=1):
            f["id"] = f"{visit_ids[t]}-{f['kind']}-{i}"
            f["label"] = f"Visit {t + 1}: {f['kind']} lesion {i}"
        out.extend(found)
    return out


def brain_mask(vol: Volume) -> np.ndarray:
    """The preprocessed images are skull-stripped: brain = largest component above 0, holes filled."""
    m = np.asarray(vol.data) > 0
    lab, n = ndimage.label(m)
    if n == 0:
        raise DatasetError("brain image is empty")
    m = lab == (int(np.argmax(np.bincount(lab.ravel())[1:])) + 1)
    return ndimage.binary_fill_holes(m)


# ------------------------------------------------------------------------------------------------
# Case pack
# ------------------------------------------------------------------------------------------------
@dataclass
class IngestResult:
    case_id: str
    out: Path
    timepoints: int
    findings: list[dict[str, Any]]
    lesion_volumes_mm3: dict[str, dict[str, float]]
    faces: dict[str, int]
    warnings: list[str]


def _same_grid(vols: dict[str, Volume]) -> None:
    items = list(vols.items())
    name0, v0 = items[0]
    for name, v in items[1:]:
        if v.data.shape != v0.data.shape or not np.allclose(v.affine, v0.affine, atol=1e-3):
            raise DatasetError(f"{name} is not on the same grid as {name0} ({v.data.shape} vs {v0.data.shape})")


def ingest_subject(
    raw: Path,
    subject: str,
    out_root: Path | None = None,
    params: TrackParams = TrackParams(),
    findings_mask: str = "consensus",
    brain_faces: int = 60_000,
    lesion_faces: int = 6_000,
) -> IngestResult:
    if findings_mask not in FINDINGS_MASK_TEXT:
        raise ValueError(f"findings_mask must be one of {sorted(FINDINGS_MASK_TEXT)}")
    visits = subject_visits(raw, subject)
    source = read_source(raw, subject)
    case_id = f"isbi2015-{subject}"
    out = (out_root or casepack.REPO_ROOT / "casepacks" / APP) / case_id
    for sub in ("layers", "volumes"):
        shutil.rmtree(out / sub, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []

    flairs = {v.id: load_nifti(v.flair) for v in visits}
    masks = {(v.id, r): load_nifti(v.masks[r]) for v in visits for r in RATERS}
    mprage = load_nifti(visits[0].mprage)
    _same_grid({**{f"FLAIR {k}": x for k, x in flairs.items()}, **{f"mask{r} {k}": x for (k, r), x in masks.items()}, "MPRAGE visit 1": mprage})
    affine = mprage.affine
    bin_masks = {k: np.asarray(m.data) > 0 for k, m in masks.items()}

    layers: list[dict[str, Any]] = []
    faces: dict[str, int] = {}
    brain = decimate(mask_to_mesh(brain_mask(mprage), affine, smooth_iterations=10), brain_faces)
    casepack.write_glb(brain, out / "layers" / "brain.glb")
    faces["brain"] = len(brain.faces)
    layers.append(casepack.layer_entry("brain", "Brain surface (skull-stripped MPRAGE, visit 1)", "#d8c8b8", 0.2, 0))

    for v in visits:
        for r in RATERS:
            lid = f"lesions-r{r}-{v.id}"
            m = bin_masks[(v.id, r)]
            try:
                mesh = decimate(mask_to_mesh(m, affine, smooth_iterations=5), lesion_faces)
            except ValueError:
                warnings.append(f"{subject} visit {v.number} rater {r}: mask has no surface (empty or too thin); no mesh")
                continue
            casepack.write_glb(mesh, out / "layers" / f"{lid}.glb")
            faces[lid] = len(mesh.faces)
            layers.append(
                casepack.layer_entry(lid, f"Rater {r} lesion mask, visit {v.number}", RATER_COLORS[r], RATER_OPACITY[r], 1, v.id)
            )

    volumes = []
    for v in visits:
        rel = f"volumes/flair-{v.id}.nii.gz"
        save_nifti(Volume(np.asarray(flairs[v.id].data, dtype=np.float32), flairs[v.id].affine), out / rel)
        volumes.append({"id": f"flair-{v.id}", "file": rel, "modality": "MR", "sequence": "FLAIR (preprocessed)", "timepointId": v.id})

    visit_ids = [v.id for v in visits]
    if findings_mask == "consensus":
        fmasks = [bin_masks[(vid, 1)] & bin_masks[(vid, 2)] for vid in visit_ids]
    else:
        fmasks = [bin_masks[(vid, int(findings_mask[-1]))] for vid in visit_ids]
    tracked = track_lesions(fmasks, affine, visit_ids, params, FINDINGS_MASK_TEXT[findings_mask])
    findings = [
        {
            "id": f["id"],
            "label": f["label"],
            "center": f["center"],
            "radiusMm": f["radiusMm"],
            "provenance": "measured",
            "reportExcerpt": f["reportExcerpt"],
            "timepointId": f["timepointId"],
        }
        for f in tracked
    ]

    lesion_volumes = {
        name: {vid: round(lesion_volume_mm3(m, affine), 1) for vid, m in zip(visit_ids, series, strict=True)}
        for name, series in {
            "rater1": [bin_masks[(vid, 1)] for vid in visit_ids],
            "rater2": [bin_masks[(vid, 2)] for vid in visit_ids],
            "consensus": [bin_masks[(vid, 1)] & bin_masks[(vid, 2)] for vid in visit_ids],
        }.items()
    }

    manifest: dict[str, Any] = {
        "schema": 1,
        "app": APP,
        "caseId": case_id,
        "title": f"ISBI 2015 MS lesions, {subject} ({len(visits)} visits)",
        "source": source,
        "deidentified": True,
        "coordinateSystem": "RAS",
        "units": "mm",
        "layers": layers,
        "volumes": volumes,
        "timepoints": [{"id": v.id, "label": f"Visit {v.number}", "order": v.number} for v in visits],
        "findings": findings,
        "share": {"templateId": "default", "pollOptions": []},
        "policyId": POLICY_ID,
    }
    casepack.write_manifest(manifest, out)
    root = training_dir(raw)
    (out / "measurements.json").write_text(
        json.dumps(
            {
                "findingsMask": findings_mask,
                "params": asdict(params),
                "connectivity": 26,
                "voxelVolumeMm3": voxel_volume_mm3(affine),
                "lesionVolumesMm3": lesion_volumes,
                "findings": [{k: f[k] for k in ("id", "kind", "volumeMm3", "previousMm3", "volumesMm3")} for f in tracked],
                "faces": faces,
                "inputs": sorted(
                    str(p.relative_to(root)) for v in visits for p in (v.flair, v.mprage, *v.masks.values())
                ),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return IngestResult(case_id, out, len(visits), tracked, lesion_volumes, faces, warnings)
