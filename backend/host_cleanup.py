"""One pipe reader routes queued jobs, cancellation and cleanup replies independently."""
import json
import sys
from queue import Queue, Empty
from threading import Thread
from uuid import uuid4

commands = Queue()
replies = Queue()
cancelled = set()
queued = set()
reader = None
active_job = None


def check_cancelled(request_id=None):
    if (request_id or active_job) in cancelled:
        raise RuntimeError("Transcription cancelled")


def begin_job(request_id):
    global active_job
    active_job = request_id
    check_cancelled()


def end_job(request_id):
    global active_job
    cancelled.discard(request_id)
    queued.discard(request_id)
    active_job = None


def read_pipe():
    try:
        for line in sys.stdin:
            try:
                message = json.loads(line)
            except ValueError:
                commands.put(line)
                continue
            if not isinstance(message, dict):
                commands.put(line)
            elif message.get('action') == 'cancel':
                request_id = str(message.get('id') or '')
                if request_id in queued:
                    cancelled.add(request_id)
            elif message.get('type') == 'cleanup-result':
                replies.put(message)
            else:
                queued.add(str(message.get('id') or ''))
                commands.put(line)
    finally:
        commands.put('')
        replies.put(None)


def next_command():
    global reader
    if reader is None:
        reader = Thread(target=read_pipe, daemon=True)
        reader.start()
    return commands.get()


def clean_with_host(prompt, timeout):
    request_id = str(uuid4())
    print(json.dumps({'type': 'cleanup-request', 'id': request_id, 'jobId': active_job, 'prompt': prompt, 'timeout': timeout}, ensure_ascii=False), flush=True)
    while True:
        check_cancelled()
        try:
            message = replies.get(timeout=0.1)
        except Empty:
            continue
        if message is None:
            raise RuntimeError('LocalFlow cleanup connection closed')
        if message.get('id') == request_id:
            if not message.get('ok'):
                raise RuntimeError(message.get('error') or 'Live1 cleanup failed')
            return message['data']
