import io
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import host_cleanup
import worker

value = {'action': 'dictate', 'target_language': None, 'text': '今日は良い天気です。'}
queued = json.dumps({'id': 'next', 'action': 'configure', 'params': {'cleanupModel': 'gpt-6-astra'}}) + '\n'
reply = json.dumps({'type': 'cleanup-result', 'id': 'cleanup', 'ok': True, 'data': value}) + '\n'
with patch.object(host_cleanup, 'uuid4', return_value='cleanup'), patch('sys.stdin', io.StringIO(queued + reply)), patch('sys.stdout', new_callable=io.StringIO) as output:
    assert host_cleanup.clean_with_host('日本語の入力', 30) == value
    assert json.loads(output.getvalue())['prompt'] == '日本語の入力'
    assert host_cleanup.next_command() == queued
    assert host_cleanup.next_command() == ''
with patch('sys.stdin', io.StringIO('')), patch('sys.stdout', io.StringIO()):
    try:
        host_cleanup.clean_with_host('test', 10)
        raise AssertionError('EOF must fail')
    except RuntimeError:
        pass
for model, host in [('gpt-live-1-codex', True), ('gpt-6-astra', False)]:
    with patch.dict(os.environ, {'LOCALFLOW_CLEANUP_MODEL': model, 'LOCALFLOW_WHISPER_LANGUAGE': 'auto'}), patch.object(worker, 'emit'), patch.object(worker, 'clean_with_host', return_value=value) as realtime, patch.object(worker, 'clean_transcript', return_value=value) as text:
        assert worker.polish_transcript('id', '今日は良い天気です', {'cleanupLevel': 'light'}, 'ja') == value['text']
        assert realtime.called == host and text.called != host
print('HOST_CLEANUP_OK: Live1 routing, text routing, Unicode and queued commands preserved')
