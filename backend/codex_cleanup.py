from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from time import monotonic
from pathlib import Path
from typing import Any


SCHEMA_PATH = Path(__file__).with_name("cleanup-output-schema.json")


def resolve_codex() -> str:
    configured = os.environ.get("LOCALFLOW_CODEX_BIN", "").strip()
    if configured:
        return configured

    found = shutil.which("codex")
    if found:
        return found

    app_data = os.environ.get("APPDATA", "").strip()
    candidate = Path(app_data) / "npm" / "codex.cmd" if app_data else None
    if candidate and candidate.exists():
        return str(candidate)

    raise RuntimeError("Codex CLI is not installed or is not available on PATH")


def parse_final_message(stdout: str) -> dict[str, Any]:
    final_message = ""
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item") if isinstance(event, dict) else None
        if event.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") == "agent_message":
            final_message = str(item.get("text") or "")

    if not final_message:
        raise RuntimeError("Codex cleanup returned no final message")

    try:
        result = json.loads(final_message)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Codex cleanup returned invalid JSON") from exc
    if not isinstance(result, dict) or not isinstance(result.get("text"), str):
        raise RuntimeError("Codex cleanup returned an invalid result")
    return result


def clean_transcript(prompt: str, model: str, reasoning_effort: str, timeout: int) -> dict[str, Any]:
    command = [
        resolve_codex(),
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-C",
        tempfile.gettempdir(),
        "-m",
        model,
        "-c",
        f'model_reasoning_effort="{reasoning_effort}"',
        "-s",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        str(SCHEMA_PATH),
        "--json",
        "-",
    ]
    from host_cleanup import check_cancelled
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', errors='replace',
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    deadline, input_text = monotonic() + timeout, prompt
    try:
        while True:
            check_cancelled()
            if monotonic() >= deadline:
                raise RuntimeError(f'Codex cleanup timed out after {timeout} seconds')
            try:
                stdout, stderr = process.communicate(input=input_text, timeout=min(0.1, deadline-monotonic()))
                break
            except subprocess.TimeoutExpired:
                input_text = None
    except BaseException:
        process.kill()
        process.communicate()
        raise
    if process.returncode != 0:
        detail = (stderr or stdout or "unknown Codex error").strip()[-1200:]
        raise RuntimeError(f"Codex cleanup failed: {detail}")
    return parse_final_message(stdout)
