"""offhand-pipeline CLI.

  offhand-pipeline testpattern --out casepacks/test-pattern/tp-001
  offhand-pipeline build --spec path/to/spec.json [--out casepacks/<app>/<caseId>]
  offhand-pipeline validate casepacks/<app>/<caseId> [more dirs...]
  offhand-pipeline inspect path/to/labels.nii.gz      # label values, voxel counts, orientation
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import typer

from . import casepack
from .build import SpecError, build_from_spec
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
