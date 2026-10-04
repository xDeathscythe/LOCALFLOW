"""Downloads are explicit; unavailable or failed choices never change the saved model."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import sys, os
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import model_downloads as downloads
import worker
from huggingface_hub.errors import LocalEntryNotFoundError

with TemporaryDirectory() as folder, patch('faster_whisper.utils.download_model') as fetch:
    fetch.side_effect = LocalEntryNotFoundError('not cached')
    assert not downloads.model_available('small', folder, folder)
    assert fetch.call_args.kwargs['local_files_only'] is True
    fetch.reset_mock(); fetch.side_effect = None
    fetch.return_value = folder
    assert not downloads.model_available('small', folder, folder), 'Incomplete cached models must not trigger implicit tokenizer downloads'
    fetch.reset_mock()
    downloads.resolve_model('small', folder, folder, download=True)
    assert fetch.call_args.kwargs == {'output_dir': str(Path(folder)/'small')}
    fetch.reset_mock()
    model=Path(folder)/'large-v3'; model.mkdir()
    for name in ('model.bin','config.json','tokenizer.json'): (model/name).touch()
    assert downloads.model_available('large-v3',folder,folder)
    fetch.assert_not_called()
    try: downloads.resolve_model('auto',folder,folder,download=True)
    except ValueError: pass
    else: raise AssertionError('Automatic model selection must be removed')

with patch.dict(os.environ, {'LOCALFLOW_WHISPER_MODEL':'large-v3'}), patch.object(worker,'warmup_model',side_effect=RuntimeError('load failed')):
    try: worker.configure_model('test',{'model':'small'})
    except RuntimeError: pass
    else: raise AssertionError('failure ignored')
    assert os.environ['LOCALFLOW_WHISPER_MODEL']=='large-v3'
print('EXPLICIT_DOWNLOAD_OFFLINE_CACHE_AND_FAILED_SELECTION_OK')
