import hashlib
import json
import re
import shutil
import sys
import tarfile
from pathlib import Path

version = sys.argv[1]
assert re.fullmatch(r'[0-9a-f]{40}', version)
site, service, output = (Path(arg) for arg in sys.argv[2:])
(site / 'stormarium-version.txt').write_text(version + '\n', encoding='ascii')
output.mkdir()
large = {}
with tarfile.open(output / 'stormarium.tar.gz', 'w:gz', compresslevel=6) as bundle:
    bundle.add(service, arcname='service')
    for p in sorted(site.rglob('*')):
        if not p.is_file():
            continue
        name = p.relative_to(site).as_posix()
        if p.suffix.lower() in {'.html', '.js', '.css', '.xml', '.json', '.txt', '.md', '.tex', '.svg'} or p.stat().st_size < 128 * 1024:
            bundle.add(p, arcname='site/' + name)
            continue
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        large[name] = sha
        asset = output / (sha + '.bin')
        if not asset.exists():
            shutil.copyfile(p, asset)
(output / 'files.json').write_text(json.dumps(large, ensure_ascii=False), encoding='utf-8')
