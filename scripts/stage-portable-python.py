"""Copy a build environment into a relocatable Windows Python distribution."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess


def stage(python: Path, target: Path):
    env = {**os.environ, 'PYTHONPATH': '', 'PYTHONHOME': '', 'PYTHONNOUSERSITE': '1'}
    base, packages = json.loads(subprocess.check_output(
        [str(python), '-c', 'import sys,sysconfig,json; print(json.dumps([sys.base_prefix,sysconfig.get_path("purelib")]))'], env=env, text=True))
    if target.exists():
        raise RuntimeError(f'Staging destination must be new: {target}')
    shutil.copytree(base, target, ignore=shutil.ignore_patterns('site-packages', '__pycache__', '*.pyc'))
    shutil.copytree(packages, target / 'Lib' / 'site-packages', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    # Venv launchers and activation scripts embed build-machine paths. Use the real
    # interpreter and stdlib; native Python discovers both relative to python.exe.
    subprocess.run([str(target / 'python.exe'), '-c', 'import sys; print("Portable Python:",sys.version.split()[0])'], env=env, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('python', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    stage(args.python, args.target)
