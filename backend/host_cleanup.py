"""Cleanup replies share the worker pipe; preserve any commands queued meanwhile."""
import json
import sys
from collections import deque
from uuid import uuid4

pending_commands = deque()


def next_command():
    return pending_commands.popleft() if pending_commands else sys.stdin.readline()


def clean_with_host(prompt, timeout):
    request_id = str(uuid4())
    print(json.dumps({"type": "cleanup-request", "id": request_id, "prompt": prompt, "timeout": timeout}, ensure_ascii=False), flush=True)
    while True:
        line = sys.stdin.readline()
        if not line:
            raise RuntimeError("LocalFlow cleanup connection closed")
        message = json.loads(line)
        if message.get("type") == "cleanup-result" and message.get("id") == request_id:
            if not message.get("ok"):
                raise RuntimeError(message.get("error") or "Live1 cleanup failed")
            return message["data"]
        pending_commands.append(line)
