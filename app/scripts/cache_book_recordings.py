"""Copy registered source audio into private app data for use without source PDFs.

Original files and metadata are never changed. All source/destination bytes are
checked before copying; an existing different copy is an error, not overwritten.
Neither recordings nor this private cache belong in Git.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile

APP = Path(__file__).resolve().parents[1]


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cache_recordings(registry, books, destination):
    books, destination = Path(books).resolve(), Path(destination).resolve()
    if registry.get("version") != 1:
        raise ValueError("Unknown recording registry")
    records, identifiers, prepared = registry["recordings"], set(), []
    for entry in records:
        identifier, name = entry["id"], entry["filename"]
        if (not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.mp3", identifier)
                or identifier in identifiers or "\\" in name or ":" in name
                or PurePosixPath(name).is_absolute()
                or any(part in ("", ".", "..") for part in name.split("/"))
                or not name.lower().endswith(".mp3")):
            raise ValueError("Unsafe or repeated recording path")
        identifiers.add(identifier)
        source, target = (books / name).resolve(), (destination / identifier).resolve()
        if not source.is_relative_to(books) or not target.is_relative_to(destination):
            raise ValueError("Recording path escapes its intended directory")
        for path in (source, target) if target.exists() else (source,):
            if (not path.is_file() or path.stat().st_size != entry["bytes"]
                    or digest(path) != entry["sha256"]):
                raise ValueError("Recording bytes differ from registry: " + identifier)
        prepared.append((source, target, entry))
    destination.mkdir(parents=True, exist_ok=True)
    copied = 0
    for source, target, entry in prepared:
        if target.exists():
            continue
        fd, temporary = tempfile.mkstemp(prefix="recording-", suffix=".tmp", dir=destination)
        os.close(fd)
        try:
            shutil.copyfile(source, temporary)
            if Path(temporary).stat().st_size != entry["bytes"] or digest(temporary) != entry["sha256"]:
                raise ValueError("Recording changed during copying: " + entry["id"])
            if target.exists():
                raise ValueError("Destination appeared during copying: " + entry["id"])
            os.replace(temporary, target)
            copied += 1
        finally:
            Path(temporary).unlink(missing_ok=True)
    return {"verified": len(prepared), "copied": copied, "bytes": sum(row[2]["bytes"] for row in prepared),
            "directory": str(destination)}


if __name__ == "__main__":
    registry = json.loads((APP / "content/book-recordings.json").read_text(encoding="utf-8"))
    print(json.dumps(cache_recordings(registry, APP.parent / "книги", APP / "data/book-recordings")))
