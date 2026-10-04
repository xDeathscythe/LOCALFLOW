"""Extract a Notion archive without executing its contents or escaping its directory."""
import pathlib
import shutil
import stat
import sys
import zipfile

archive, destination = sys.argv[1:3]
root = pathlib.Path(destination).resolve()
root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as source:
    entries = source.infolist()
    total = sum(entry.file_size for entry in entries)
    if len(entries) > 100_000 or total > 20_000_000_000:
        raise ValueError('Notion export exceeds import limits.')
    if shutil.disk_usage(root).free < total + 100_000_000:
        raise OSError('Not enough free space for this export. Choose a different import location.')
    targets = []
    for entry in entries:
        name = pathlib.PurePosixPath(entry.filename)
        target = root.joinpath(*name.parts).resolve()
        if name.is_absolute() or '..' in name.parts or ':' in entry.filename or '\\' in entry.filename or not target.is_relative_to(root) or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError('Unsafe archive path.')
        targets.append((entry, target))
    for entry, target in targets:
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as incoming, target.open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
print('NOTION_ARCHIVE_EXTRACTED')
