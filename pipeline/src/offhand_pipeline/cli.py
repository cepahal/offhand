"""offhand-pipeline CLI.

  offhand-pipeline testpattern --out casepacks/test-pattern/tp-001
  offhand-pipeline build --spec path/to/spec.json [--out casepacks/<app>/<caseId>]
  offhand-pipeline validate casepacks/<app>/<caseId> [more dirs...]
  offhand-pipeline inspect path/to/labels.nii.gz      # label values, voxel counts, orientation
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import typer

from . import casepack
from .build import SpecError, build_from_spec
from .isbi2015 import DatasetError, TrackParams, find_subjects, ingest_subject
from .testpattern import build_testpattern
from .volume import load_volume

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Public imaging data -> offhand case packs.")


@app.command()
def testpattern(out: Path = typer.Option(Path("casepacks/test-pattern/tp-001"), help="Case pack folder.")) -> None:
    """Write the synthetic test-pattern case pack (nested cubes + markers + RAS axes)."""
    m = build_testpattern(out.resolve())
    typer.echo(f"wrote {out} ({len(m['layers'])} layers, {len(m['findings'])} findings)")


@app.command()
def build(
    spec: Path = typer.Option(..., exists=True, dir_okay=False, help="Build spec JSON (see build.py)."),
    out: Path | None = typer.Option(None, help="Output folder (default casepacks/<app>/<caseId>)."),
) -> None:
    """Build one case pack from a dataset case, using the dataset's own labels."""
    try:
        path = build_from_spec(spec.resolve(), out.resolve() if out else None)
    except (SpecError, ValueError, FileNotFoundError) as e:
        typer.secho(f"build failed: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e
    typer.secho(f"wrote {path}", fg=typer.colors.GREEN)


@app.command()
def toothfairy2(
    case_dir: Path = typer.Argument(..., exists=True, file_okay=False, help="Folder with image.mha + label.mha."),
    case_id: str = typer.Option(..., help="Case id, e.g. tf2-f001."),
    title: str = typer.Option(..., help="Title shown in the viewer."),
    dataset_json: Path = typer.Option(..., exists=True, dir_okay=False, help="ToothFairy2 dataset.json."),
    specs: Path = typer.Option(Path("pipeline/specs/dental"), help="Where the generated spec is saved."),
    max_faces: int = typer.Option(2_500_000, help="Total face budget across all layers."),
) -> None:
    """Generate a build spec for one ToothFairy2 case and build its case pack (casepacks/dental/<id>)."""
    from .toothfairy2 import make_spec

    specs.mkdir(parents=True, exist_ok=True)
    spec_path = (specs / f"{case_id}.json").resolve()
    spec = make_spec(case_dir, dataset_json, spec_path, case_id, title, max_faces)
    spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    try:
        path = build_from_spec(spec_path)
    except (SpecError, ValueError, FileNotFoundError) as e:
        typer.secho(f"build failed: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e
    typer.secho(f"wrote {path} ({len(spec['layers'])} layers)", fg=typer.colors.GREEN)
@app.command()
def isbi2015(
    raw: Path = typer.Option(Path("data/raw/isbi2015"), help="Unpacked training_final_v4.zip (git-ignored)."),
    subject: list[str] = typer.Option([], help="Subject id, e.g. training01 (repeatable). Default: all."),
    out_root: Path = typer.Option(Path("casepacks/neuroview"), help="Case packs go to <out-root>/isbi2015-<subject>."),
    findings_mask: str = typer.Option("consensus", help="consensus (both raters), rater1 or rater2."),
    min_voxels: int = typer.Option(TrackParams.min_voxels, help="Smallest lesion cluster reported."),
    enlarge_ratio: float = typer.Option(TrackParams.enlarge_ratio, help="Enlarged: relative growth at least this."),
    enlarge_min_mm3: float = typer.Option(TrackParams.enlarge_min_mm3, help="Enlarged: absolute growth at least this."),
    brain_faces: int = typer.Option(60_000, help="Triangle budget for the brain surface."),
    lesion_faces: int = typer.Option(6_000, help="Triangle budget per lesion mesh (one per rater per visit)."),
) -> None:
    """ISBI 2015 longitudinal MS lesion training data -> NeuroView case packs (one per subject)."""
    params = TrackParams(min_voxels, enlarge_ratio, enlarge_min_mm3)
    try:
        subjects = subject or find_subjects(raw.resolve())
        for s in subjects:
            r = ingest_subject(raw.resolve(), s, out_root.resolve(), params, findings_mask, brain_faces, lesion_faces)
            kinds = [f["kind"] for f in r.findings]
            typer.secho(
                f"wrote {r.out}  ({r.timepoints} visits, {len(r.findings)} findings: "
                f"{kinds.count('new')} new, {kinds.count('enlarged')} enlarged; {sum(r.faces.values())} triangles)",
                fg=typer.colors.GREEN,
            )
            for name, series in r.lesion_volumes_mm3.items():
                typer.echo(f"  {name:<9} " + "  ".join(f"{k}: {v:g} mm³" for k, v in series.items()))
            for w in r.warnings:
                typer.secho(f"  warning: {w}", fg=typer.colors.YELLOW)
    except (DatasetError, ValueError, FileNotFoundError) as e:
        typer.secho(f"isbi2015 failed: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e


@app.command()
def validate(dirs: list[Path] = typer.Argument(..., help="Case pack folders.")) -> None:
    """Validate case packs against the shared CasePackManifest schema."""
    bad = 0
    for d in dirs:
        errors = casepack.validate_case_dir(d.resolve())
        if errors:
            bad += 1
            typer.secho(f"INVALID {d}", fg=typer.colors.RED)
            for e in errors:
                typer.echo(f"  - {e}")
        else:
            typer.secho(f"ok      {d}", fg=typer.colors.GREEN)
    raise typer.Exit(1 if bad else 0)


@app.command()
def inspect(path: Path = typer.Argument(..., exists=True, help="NIfTI file or DICOM folder.")) -> None:
    """Print shape, spacing, RAS orientation and (for label maps) label values + voxel counts."""
    import nibabel as nib

    v = load_volume(path)
    typer.echo(f"shape    {v.data.shape}  dtype {v.data.dtype}")
    typer.echo(f"spacing  {np.round(v.spacing, 3).tolist()} mm")
    typer.echo(f"axes     {''.join(nib.aff2axcodes(v.affine))} (after canonical reorientation)")
    typer.echo(f"origin   {np.round(v.affine[:3, 3], 2).tolist()} mm")
    data = np.asarray(v.data)
    if np.issubdtype(data.dtype, np.integer) or np.allclose(data, np.round(data)):
        vals, counts = np.unique(data.astype(np.int64), return_counts=True)
        if len(vals) <= 64:
            typer.echo("labels   value: voxels (mL)")
            for val, c in zip(vals, counts, strict=True):
                typer.echo(f"         {val:>5}: {c:>10}  ({c * v.voxel_volume_mm3 / 1000:.2f} mL)")
            return
    typer.echo(f"range    {float(data.min()):.2f} .. {float(data.max()):.2f}")


if __name__ == "__main__":
    app()
