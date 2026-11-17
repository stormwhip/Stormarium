import hashlib
import json
import re
import shutil
import sys
import tarfile
from pathlib import Path

version = sys.argv[1]
assert re.fullmatch(r'[0-9a-f]{40}', version)
site, service, output = (Path(arg) for arg in sys.argv[2:5])
previous_path = Path(sys.argv[5]) if len(sys.argv) > 5 else None
(site / 'stormarium-version.txt').write_text(version + '\n', encoding='ascii')
output.mkdir()

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

files = {
    p.relative_to(site).as_posix(): sha(p)
    for p in sorted(site.rglob('*')) if p.is_file()
}
previous = None
if previous_path and previous_path.is_file():
    candidate = json.loads(previous_path.read_text(encoding='utf-8'))
    if isinstance(candidate, dict) and re.fullmatch(r'[0-9a-f]{40}', candidate.get('version', '')) \
            and isinstance(candidate.get('files'), dict) \
            and all(isinstance(k, str) and isinstance(v, str)
                    and re.fullmatch(r'[0-9a-f]{64}', v)
                    for k, v in candidate['files'].items()):
        previous = candidate

(output / 'site-manifest.json').write_text(json.dumps({
    'version': version,
    'base': previous['version'] if previous else None,
    'files': files,
}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

if previous:
    changed = [name for name, digest in files.items()
               if previous['files'].get(name) != digest]
    with tarfile.open(output / 'site-delta.tar.gz', 'w:gz', compresslevel=6) as bundle:
        bundle.add(service, arcname='service')
        for name in changed:
            bundle.add(site / name, arcname='site/' + name, recursive=False)
    print('增量发布：基于', previous['version'][:12], '变化文件', len(changed),
          '删除文件', len(set(previous['files']) - set(files)), flush=True)
else:
    print('首次启用增量清单：保留完整包用于兼容部署', flush=True)

large = {}
with tarfile.open(output / 'stormarium.tar.gz', 'w:gz', compresslevel=6) as bundle:
    bundle.add(service, arcname='service')
    for p in sorted(site.rglob('*')):
        if not p.is_file():
            continue
        name = p.relative_to(site).as_posix()
        if name.startswith('assets/file/') and p.name.endswith('-源码与插图.zip'):
            asset_name = 'source-' + hashlib.sha1(p.read_bytes()).hexdigest()[:24] + '.zip'
            asset = output / asset_name
            if not asset.exists():
                shutil.copyfile(p, asset)
        if p.suffix.lower() in {'.html', '.js', '.css', '.xml', '.json', '.txt', '.md', '.tex', '.svg'} or p.stat().st_size < 128 * 1024:
            bundle.add(p, arcname='site/' + name)
            continue
        digest = files[name]
        large[name] = digest
        asset = output / (digest + '.bin')
        if not asset.exists():
            shutil.copyfile(p, asset)
(output / 'files.json').write_text(json.dumps(large, ensure_ascii=False), encoding='utf-8')
