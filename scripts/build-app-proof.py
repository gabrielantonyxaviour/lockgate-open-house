"""Build a local review gallery from completed proof manifests; never publish it."""
import argparse
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "docs/proof"
UX = ROOT / "app/docs/proof/ux"


def relative(path):
    import os
    return html.escape(os.path.relpath(path, PROOF), quote=True)


def card(path, caption):
    source = relative(path)
    title = html.escape(caption)
    posters = {
        'investor': ['investor-requests', 'queued-early-exit-funded'],
        'issuer': ['issuer-controls'],
        'operator': ['operator-controls', 'own-book-reserve-recovered'],
        'partner': ['partner-capital', 'senior-recovery-recapitalized'],
    }
    poster = next((path.parent / f'{name}-1440.png' for name in posters.get(path.stem, [])
                   if (path.parent / f'{name}-1440.png').exists()), None)
    attribute = f' poster="{relative(poster)}"' if poster else ''
    media = (f'<video controls preload="metadata" src="{source}"{attribute}></video>'
             if path.suffix in [".webm", ".mp4"]
             else f'<a href="{source}"><img loading="lazy" src="{source}" alt="{title}"></a>')
    return f'<figure>{media}<figcaption><a href="{source}">{title}</a></figcaption></figure>'


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run', action='append', required=True, help='Completed wallet run directory name; repeat for supplemental proof.')
args = parser.parse_args()
completed = []
for name in args.run:
    if Path(name).name != name:
        raise ValueError('Run must be a directory name under docs/proof/wallet')
    manifest = PROOF / 'wallet' / name / 'manifest.json'
    data = json.loads(manifest.read_text())
    if not data.get('completed'):
        raise ValueError(f'Run is incomplete: {name}')
    completed.append((manifest, data))

wallet_sections = []
for manifest, data in completed:
    artifacts = [manifest.parent / item["file"] for item in data["artifacts"]]
    videos = [path for path in artifacts if path.suffix in [".webm", ".mp4"]]
    images = [path for path in artifacts if path.suffix == ".png"]
    count = sum('browser locally signed' in item['label'] for item in data['receipts'])
    stats = f"{count} browser-signed transactions · {len(data['receipts'])} successful receipts including setup · {len(data['signatures'])} engine signatures"
    wallet_sections.append(f'<section><h2>Signed journey: {manifest.parent.name}</h2>'
        f'<p>{html.escape(data["scope"])}</p><p>{stats}</p><p><a href="{relative(manifest)}">Receipt, signature and recording manifest</a></p>'
        '<div class="grid">' + ''.join(card(path, path.name) for path in videos) + '</div>'
        '<details><summary>Journey screenshots</summary><div class="grid">'
        + ''.join(card(path, path.name) for path in images) + '</div></details></section>')

ux_cards = ''.join(card(path, path.stem) for path in sorted(UX.glob("*.png")))
live_cards = ''.join(card(path, path.stem) for path in sorted(path for path in (PROOF / "live").glob("*.png") if path.name != "public-before.png"))
content = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lockgate verification evidence</title><style>
:root{font-family:system-ui,sans-serif;color:#171719;background:#fafafa}body{max-width:1300px;margin:auto;padding:32px}
h1{font-size:32px;letter-spacing:-1px}p{max-width:900px;line-height:1.6;color:#52525b}a{color:inherit}
section{padding:24px 0;border-top:1px solid #ddd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px}
figure{margin:0;border:1px solid #ddd;border-radius:12px;background:white;overflow:hidden}img,video{width:100%;max-height:550px;object-fit:contain;object-position:top;background:#eee}
video{height:220px;object-fit:contain}figcaption{padding:12px;font-size:13px;overflow-wrap:anywhere}summary{cursor:pointer;margin:20px 0}nav{display:flex;gap:20px;flex-wrap:wrap}
@media(max-width:600px){body{padding:18px}.grid{grid-template-columns:1fr}}
</style><body><h1>Lockgate verification evidence</h1>
<p>Review the app audit, recorded wallet journeys, receipt manifests, and responsive screens. Only the explicitly selected completed signed runs appear here. Layout previews, local fork transactions and public network reads are identified separately.</p>
<nav><a href="../APP_VERIFICATION.md">Verification report</a><a href="integrity.json">Artifact and source integrity checks</a><a href="../CHAIN_AUDIT.md">Contract integration audit</a><a href="../../app/docs/UX_AUDIT.md">UX review</a></nav>
'''
content += ''.join(wallet_sections) or '<p>No completed signed run is available yet.</p>'
content += '<section><h2>Deployed public app</h2><p>Public reads and disconnected browser states on the deployed Open House app. These images do not prove wallet transactions.</p><div class="grid">' + live_cards + '</div></section>'
content += '<section><h2>Responsive UX review</h2><p>375, 768 and 1440px. Most screens are explicitly read-only layout previews. Files containing “live” show public Sepolia reads.</p><div class="grid">' + ux_cards + '</div></section></body></html>'
PROOF.mkdir(parents=True, exist_ok=True)
(PROOF / "index.html").write_text(content)
print(f"Gallery: {len(completed)} completed signed runs; {len(list(UX.glob('*.png')))} UX images")
