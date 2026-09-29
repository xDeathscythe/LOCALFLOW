import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import recording_overlay as overlay

pill = overlay.RecordingOverlay()
pill.hwnd = 1
with patch.object(pill, "render") as render, patch.object(overlay.user32, "SetTimer") as timer, patch.object(overlay.user32, "KillTimer") as kill, patch.object(overlay.user32, "SetWindowPos"), patch.object(overlay.user32, "ShowWindow"), patch.object(overlay.time, "monotonic", return_value=10):
    pill.show()
    assert timer.call_args.args[2] == 33
    pill.last_tick = 9
    pill.animate()
    assert timer.call_args.args[2] == 90
    frames = render.call_count
    pill.animate()
    assert render.call_count == frames, "Do not repaint identical frames"
    pill.close()
    pill.last_tick = 9
    pill.animate()
    assert not pill.visible
    kill.assert_called_once_with(1, 1)
    pill.show()
    assert pill.visible
    assert timer.call_args.args[2] == 33
print("Overlay timers stop when hidden; frame deduplication and reopen passed")
