"""Bundle the isolated preview into one offline HTML file using the standard library."""
import base64
from pathlib import Path
import re

root = Path(__file__).resolve().parent
html = (root / "index.html").read_text(encoding="utf-8")


def embed_stylesheet(match):
    path = root / match[1]
    css = path.read_text(encoding="utf-8")

    def embed_asset(asset):
        file = (path.parent / asset[1]).resolve()
        mime = {".woff2": "font/woff2", ".png": "image/png"}[file.suffix]
        return f"url('data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}')"

    css = re.sub(r"url\(['\"]?([^)'\"]+)['\"]?\)", embed_asset, css)
    return f"<style>\n{css}\n</style>"


html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', embed_stylesheet, html)
script = (root / "prototype.js").read_text(encoding="utf-8")
html = html.replace('<script src="prototype.js"></script>', f"<script>\n{script}\n</script>")
# ponytail: one build-time check keeps the portable preview truly self-contained.
assert all(asset.startswith('data:') for asset in re.findall(r'<(?:link\b[^>]*href|script\b[^>]*src)="([^"]+)"', html))
assert all(asset.startswith('data:') for asset in re.findall(r"url\(['\"]?([^)'\"]+)", html))
assert all(f'data-theme="{theme}"' in html for theme in ('dark', 'light', 'static-black', 'static-white'))
(root / "localflow-niwa.html").write_text(html, encoding="utf-8")
print("Built offline localflow-niwa.html")
