"""Case pack writing and validation.

A case pack is a folder casepacks/<app>/<caseId>/ with:
    manifest.json        validated against packages/contracts/schema/CasePackManifest.json
    layers/<id>.glb      one surface mesh per layer, vertices in RAS millimetres
    volumes/<id>.nii.gz  optional volumes for the slice panel (RAS, canonical orientation)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import trimesh
from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[3]


def schema_path() -> Path:
    d = os.environ.get("OFFHAND_SCHEMA_DIR")
    base = Path(d) if d else REPO_ROOT / "packages" / "contracts" / "schema"
    return base / "CasePackManifest.json"


def load_schema() -> dict[str, Any]:
    p = schema_path()
    if not p.exists():
        raise FileNotFoundError(
            f"{p} not found. Generate it with: pnpm --filter @offhand/contracts gen:schema"
        )
    return json.loads(p.read_text(encoding="utf-8"))


def validate_manifest(manifest: dict[str, Any], case_dir: Path | None = None) -> list[str]:
    """Return a list of problems (empty = valid)."""
    errors = [
        f"{'/'.join(str(x) for x in e.absolute_path) or '(root)'}: {e.message}"
        for e in Draft202012Validator(load_schema()).iter_errors(manifest)
    ]
    if errors:
        return errors
    layer_ids = {layer["id"] for layer in manifest["layers"]}
    tp_ids = {t["id"] for t in manifest.get("timepoints") or []}
    if len(layer_ids) != len(manifest["layers"]):
        errors.append("layers: duplicate layer id")
    for f in manifest["findings"]:
        if "layerId" in f and f["layerId"] not in layer_ids:
            errors.append(f"finding {f['id']}: unknown layerId {f['layerId']}")
        if "timepointId" in f and f["timepointId"] not in tp_ids:
            errors.append(f"finding {f['id']}: unknown timepointId {f['timepointId']}")
    for v in manifest["volumes"]:
        if "timepointId" in v and v["timepointId"] not in tp_ids:
            errors.append(f"volume {v['id']}: unknown timepointId {v['timepointId']}")
    if case_dir is not None:
        if case_dir.name != manifest["caseId"]:
            errors.append(f"folder name {case_dir.name!r} != caseId {manifest['caseId']!r}")
        if case_dir.parent.name != manifest["app"]:
            errors.append(f"parent folder {case_dir.parent.name!r} != app {manifest['app']!r}")
        for item in [*manifest["layers"], *manifest["volumes"]]:
            if not (case_dir / item["file"]).exists():
                errors.append(f"missing file: {item['file']}")
    return errors


def validate_case_dir(case_dir: Path) -> list[str]:
    mf = case_dir / "manifest.json"
    if not mf.exists():
        return [f"{mf} not found"]
    try:
        manifest = json.loads(mf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"manifest.json is not valid JSON: {e}"]
    return validate_manifest(manifest, case_dir)


def write_glb(mesh: trimesh.Trimesh, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = mesh.export(file_type="glb")
    path.write_bytes(data if isinstance(data, bytes) else bytes(data))


def write_manifest(manifest: dict[str, Any], case_dir: Path) -> list[str]:
    """Validate then write manifest.json. Raises ValueError (and writes nothing) if invalid."""
    errors = validate_manifest(manifest, case_dir)
    if errors:
        raise ValueError("invalid manifest:\n  " + "\n  ".join(errors))
    (case_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return errors


def layer_entry(
    id: str, label: str, color: str, default_opacity: float, peel_order: int
) -> dict[str, Any]:
    return {
        "id": id,
        "label": label,
        "file": f"layers/{id}.glb",
        "color": color,
        "defaultOpacity": default_opacity,
        "peelOrder": peel_order,
        "kind": "surface",
    }
