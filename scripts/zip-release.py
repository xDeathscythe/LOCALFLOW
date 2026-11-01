"""Create a ZIP64 package atomically; npm files can have pre-1980 timestamps."""
import os
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

directory = Path(sys.argv[1]).resolve(strict=True)
target = directory.with_name(directory.name + ".zip")
temporary = target.with_name(target.name + f".stage-{os.getpid()}")
try:
    with ZipFile(temporary, "w", ZIP_DEFLATED, strict_timestamps=False) as archive:
        for file in directory.rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(directory.parent))
    os.replace(temporary, target)
finally:
    temporary.unlink(missing_ok=True)
