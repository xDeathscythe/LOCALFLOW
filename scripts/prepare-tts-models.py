from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import urllib.request
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(path: Path, expected: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    actual = sha256(path)
    if actual.lower() != expected.lower():
        raise RuntimeError(f"SHA-256 mismatch for {path}: {actual}")


def download(url: str, target: Path, expected: str) -> None:
    if target.is_file():
        try:
            require_hash(target, expected)
            return
        except RuntimeError:
            target.unlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f"{target.name}.download")
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "LocalFlow-TTS-Installer/1"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        append = offset > 0 and response.status == 206
        with partial.open("ab" if append else "wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    require_hash(partial, expected)
    os.replace(partial, target)


def snapshot_dir(cache: Path, repo: str, revision: str) -> Path:
    return cache / f"models--{repo.replace('/', '--')}" / "snapshots" / revision


def prepare_files(root: Path, files: list[dict[str, str]], verify_only: bool) -> None:
    for item in files:
        target = root / Path(item["path"])
        if not verify_only:
            download(item["url"], target, item["sha256"])
        require_hash(target, item["sha256"])


def prepare_omnivoice(root: Path, config: dict[str, Any], verify_only: bool) -> None:
    cache = root / "omnivoice" / "hf_home" / "hub"
    if not verify_only:
        from huggingface_hub import snapshot_download

        for item in config["snapshots"]:
            snapshot_download(
                repo_id=item["repo"],
                revision=item["revision"],
                cache_dir=cache,
            )
    for item in config["snapshots"]:
        require_hash(
            snapshot_dir(cache, item["repo"], item["revision"]) / "config.json",
            item["configSha256"],
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Install or verify LocalFlow TTS model files")
    parser.add_argument("--engine", choices=("piper", "xtts", "omnivoice"), required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    engine = manifest["engines"][args.engine]
    if args.engine == "omnivoice":
        prepare_omnivoice(args.root, engine, args.verify_only)
    else:
        prepare_files(args.root, engine["files"], args.verify_only)
    print(json.dumps({"engine": args.engine, "ready": True, "root": str(args.root)}))


if __name__ == "__main__":
    main()
