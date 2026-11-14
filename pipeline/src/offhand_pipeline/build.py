"""Spec-driven case pack build.

A build spec is a JSON file that says which public-dataset files make up one case and how the
dataset's own labels map to layers. Paths are relative to the spec file. Example (volumetric):

{
  "app": "kneeview", "caseId": "case-001", "title": "Knee MRI, one subject",
  "source": {"dataset": "...", "url": "...", "license": "...", "citation": "...", "subjectId": "..."},
  "labels": "seg.nii.gz",
  "layers": [
    {"id": "bone", "label": "<label name from the dataset>", "values": [1, 2],
     "color": "#e8e0d0", "defaultOpacity": 1, "peelOrder": 1},
    {"id": "skin", "label": "Skin surface (intensity threshold)", "color": "#d9a38a",
     "defaultOpacity": 0.25, "peelOrder": 0,
     "threshold": {"volume": "image.nii.gz", "min": 120}}
  ],
  "volumes": [{"id": "mr", "file": "image.nii.gz", "modality": "MR", "sequence": "qDESS"}],
  "findings": [{"layerId": "lesion", "values": [5], "labelPrefix": "<dataset label>", "minVoxels": 20}],
  "share": {"templateId": "default", "pollOptions": []},
  "policyId": "default",
  "maxFaces": 300000
}

Mesh-only datasets (intraoral scans) use "mesh" instead of "labels":
  "mesh": {"file": "scan.obj", "vertexLabels": "scan.json", "key": "labels",
           "transform": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
and each layer's "values" are matched against the per-vertex labels.
Optional per-layer "labels" (another label map) and per-finding "labels"/"timepointId" support
longitudinal cases with one label map per visit.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from scipy import ndimage

from . import casepack
from .mesh import components, decimate, mask_to_mesh, split_budget
from .volume import Volume, crop_to, label_bounds_ras, load_volume, save_nifti

DEFAULT_MAX_FACES = 300_000


class SpecError(ValueError):
    pass


def _req(d: dict[str, Any], key: str, where: str) -> Any:
    if key not in d:
        raise SpecError(f"{where}: missing '{key}'")
    return d[key]


def build_from_spec(spec_path: Path, out: Path | None = None, repo_root: Path | None = None) -> Path:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    base = spec_path.parent
    app = _req(spec, "app", "spec")
    case_id = _req(spec, "caseId", "spec")
    out = out or (repo_root or casepack.REPO_ROOT) / "casepacks" / app / case_id
    out.mkdir(parents=True, exist_ok=True)
    max_faces = int(spec.get("maxFaces", DEFAULT_MAX_FACES))
    layers_spec: list[dict[str, Any]] = _req(spec, "layers", "spec")

    if "mesh" in spec:
        meshes = _layers_from_mesh(spec["mesh"], layers_spec, base)
    else:
        meshes = _layers_from_volume(spec, layers_spec, base)

    budget = split_budget({k: len(m.faces) for k, m in meshes.items()}, max_faces)
    layer_entries = []
    for ls in layers_spec:
        lid = ls["id"]
        if lid not in meshes:
            raise SpecError(f"layer {lid}: produced no geometry (check 'values')")
        mesh = decimate(meshes[lid], budget[lid])
        casepack.write_glb(mesh, out / "layers" / f"{lid}.glb")
        layer_entries.append(
            casepack.layer_entry(
                lid,
                _req(ls, "label", f"layer {lid}"),
                ls.get("color", "#cccccc"),
                float(ls.get("defaultOpacity", 1.0)),
                int(_req(ls, "peelOrder", f"layer {lid}")),
            )
        )

    volume_entries = []
    for v in spec.get("volumes", []):
        vid = _req(v, "id", "volume")
        src = _load(spec, base / _req(v, "file", f"volume {vid}"))
        if "cropToLabels" in v:  # {"labels": "<label map>", "marginMm": 10}
            c = v["cropToLabels"]
            lo, hi = label_bounds_ras(_load(spec, base / _req(c, "labels", f"volume {vid} crop")),
                                      float(c.get("marginMm", 10)))
            src = crop_to(src, lo, hi)
        if "dtype" in v:  # e.g. "int16" for HU-valued CT/CBCT stored as float64
            dt = np.dtype(v["dtype"])
            data = np.asarray(src.data)
            if np.issubdtype(dt, np.integer):
                info = np.iinfo(dt)
                data = np.clip(np.round(data), info.min, info.max)
            src = Volume(data=data.astype(dt), affine=src.affine)
        save_nifti(src, out / "volumes" / f"{vid}.nii.gz")
        entry = {
            "id": vid,
            "file": f"volumes/{vid}.nii.gz",
            "modality": _req(v, "modality", f"volume {vid}"),
            "sequence": _req(v, "sequence", f"volume {vid}"),
        }
        if "timepointId" in v:
            entry["timepointId"] = v["timepointId"]
        volume_entries.append(entry)

    findings = _findings(spec, base) if "mesh" not in spec else []

    manifest: dict[str, Any] = {
        "schema": 1,
        "app": app,
        "caseId": case_id,
        "title": _req(spec, "title", "spec"),
        "source": _req(spec, "source", "spec"),
        "deidentified": True,
        "coordinateSystem": "RAS",
        "units": "mm",
        "layers": layer_entries,
        "volumes": volume_entries,
        "findings": findings,
        "share": spec.get("share", {"templateId": "default", "pollOptions": []}),
        "policyId": _req(spec, "policyId", "spec"),
    }
    if "timepoints" in spec:
        manifest["timepoints"] = spec["timepoints"]
    if "report" in spec:
        manifest["report"] = spec["report"]
    casepack.write_manifest(manifest, out)
    shutil.copyfile(spec_path, out / "build-spec.json")  # provenance: how this pack was made
    return out


def _layers_from_volume(
    spec: dict[str, Any], layers_spec: list[dict[str, Any]], base: Path
) -> dict[str, trimesh.Trimesh]:
    cache: dict[str, Volume] = {}

    def vol(rel: str) -> Volume:
        if rel not in cache:
            cache[rel] = _load(spec, base / rel)
        return cache[rel]

    out: dict[str, trimesh.Trimesh] = {}
    for ls in layers_spec:
        lid = _req(ls, "id", "layer")
        if "threshold" in ls:
            t = ls["threshold"]
            v = vol(_req(t, "volume", f"layer {lid} threshold"))
            mask = _body_mask(v.data, float(_req(t, "min", f"layer {lid} threshold")))
            out[lid] = mask_to_mesh(mask, v.affine, smooth_iterations=int(ls.get("smooth", 15)))
            continue
        labels_rel = ls.get("labels", spec.get("labels"))
        if not labels_rel:
            raise SpecError(f"layer {lid}: no 'labels' map (spec or layer)")
        v = vol(labels_rel)
        values = _req(ls, "values", f"layer {lid}")
        mask = np.isin(np.asarray(v.data).astype(np.int64), values)
        if not mask.any():
            raise SpecError(f"layer {lid}: label values {values} not present in {labels_rel}")
        out[lid] = mask_to_mesh(mask, v.affine, smooth_iterations=int(ls.get("smooth", 15)))
    return out


def _body_mask(data: np.ndarray, threshold: float) -> np.ndarray:
    """Largest connected component above threshold, holes filled slice-wise and in 3D."""
    m = np.asarray(data) > threshold
    lab, n = ndimage.label(m)
    if n == 0:
        raise SpecError(f"nothing above threshold {threshold}")
    sizes = ndimage.sum_labels(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    m = lab == (int(np.argmax(sizes)) + 1)
    m = ndimage.binary_closing(m, iterations=2)
    for k in range(m.shape[2]):
        m[:, :, k] = ndimage.binary_fill_holes(m[:, :, k])
    return ndimage.binary_fill_holes(m)


def _layers_from_mesh(
    mesh_spec: dict[str, Any], layers_spec: list[dict[str, Any]], base: Path
) -> dict[str, trimesh.Trimesh]:
    mesh = trimesh.load(base / _req(mesh_spec, "file", "mesh"), force="mesh", process=False)
    raw = json.loads((base / _req(mesh_spec, "vertexLabels", "mesh")).read_text(encoding="utf-8"))
    labels = np.asarray(raw[mesh_spec.get("key", "labels")] if isinstance(raw, dict) else raw)
    if len(labels) != len(mesh.vertices):
        raise SpecError(f"vertex labels: {len(labels)} labels for {len(mesh.vertices)} vertices")
    if "transform" in mesh_spec:
        mesh.apply_transform(np.asarray(mesh_spec["transform"], dtype=float))
    face_labels = face_majority(labels, np.asarray(mesh.faces))
    out: dict[str, trimesh.Trimesh] = {}
    for ls in layers_spec:
        lid = _req(ls, "id", "layer")
        sel = np.isin(face_labels, _req(ls, "values", f"layer {lid}"))
        if not sel.any():
            raise SpecError(f"layer {lid}: no faces with labels {ls['values']}")
        sub = mesh.submesh([np.nonzero(sel)[0]], append=True)
        sub.remove_unreferenced_vertices()
        out[lid] = sub
    return out


def face_majority(vertex_labels: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Label per face = label shared by >= 2 of its vertices, else the first vertex's label."""
    a, b, c = (vertex_labels[faces[:, i]] for i in range(3))
    return np.where((b == c) & (a != b), b, a)


def _findings(spec: dict[str, Any], base: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rule in spec.get("findings", []):
        labels_rel = rule.get("labels", spec.get("labels"))
        if not labels_rel:
            raise SpecError("finding rule: no 'labels' map")
        v = _load(spec, base / labels_rel)
        values = _req(rule, "values", "finding rule")
        prefix = _req(rule, "labelPrefix", "finding rule")
        comps = components(
            np.isin(np.asarray(v.data).astype(np.int64), values), v.affine, int(rule.get("minVoxels", 1))
        )
        for i, c in enumerate(comps[: int(rule.get("max", 20))], start=1):
            f: dict[str, Any] = {
                "id": f"{rule.get('idPrefix', 'f')}-{i}",
                "label": f"{prefix} {i}" if len(comps) > 1 else prefix,
                "center": c["center"],
                "radiusMm": c["radiusMm"],
                "provenance": "dataset_label",
            }
            for key in ("layerId", "timepointId"):
                if key in rule:
                    f[key] = rule[key]
            out.append(f)
    return out


def _load(spec: dict[str, Any], path: Path) -> Volume:
    """Load a volume; apply the spec's optional "worldTransform" (4x4, RAS -> RAS) to its affine.

    Used when a dataset's header orientation is known to be wrong (checked against anatomy, e.g.
    upper teeth must be superior to lower teeth), so labels and image are corrected together.
    """
    v = load_volume(path)
    if "worldTransform" in spec:
        t = np.asarray(spec["worldTransform"], dtype=float)
        if t.shape != (4, 4):
            raise SpecError("worldTransform must be a 4x4 matrix")
        v = Volume(data=v.data, affine=t @ v.affine)
    return v
