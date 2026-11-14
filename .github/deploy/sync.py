#!/usr/bin/python3 -I
"""Fetch the latest package from the Stormarium repository."""
import hashlib
import json
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

API = 'https://api.github.com/repos/stormwhip/Stormarium'
SITE = Path('/www/wwwroot/stormwhip.com')
VERSION = SITE / 'stormarium-version.txt'
RECEIVE = '/usr/local/libexec/stormarium-release'
CURL = ('/usr/bin/curl', '-fsSL', '--proto', '=https',
        '--proto-redir', '=https', '--connect-timeout', '12')


def get(asset, path):
    size, identity = asset['size'], asset['id']
    if not isinstance(identity, int) or not 0 < size <= 130 * 1024 * 1024:
        raise RuntimeError('GitHub 发布包信息无效')
    url = API + '/releases/assets/' + str(identity)
    subprocess.run([*CURL, '--max-time', '1200', '--max-filesize', str(size),
                    '-H', 'Accept: application/octet-stream', '-o', str(path), url], check=True)
    digest = asset.get('digest', '')
    if path.stat().st_size != size or (digest and digest != 'sha256:' + sha(path)):
        raise RuntimeError('GitHub 发布文件校验失败')


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    latest = subprocess.run([*CURL, '--max-time', '20', API + '/releases/latest'],
                            stdout=subprocess.PIPE, check=True)
    release = json.loads(latest.stdout.decode('utf-8'))
    tag = re.fullmatch(r'site-([0-9a-f]{40})', release['tag_name'])
    if not tag:
        return
    expected = tag.group(1)
    if VERSION.is_file() and VERSION.read_text(encoding='ascii').strip() == expected:
        return
    assets = {asset['name']: asset for asset in release['assets'] if asset['state'] == 'uploaded'}
    if 'files.json' not in assets:
        return
    with tempfile.TemporaryDirectory() as directory:
        tmp = Path(directory)
        get(assets['files.json'], tmp / 'files.json')
        large = json.loads((tmp / 'files.json').read_text(encoding='utf-8'))
        if not isinstance(large, dict) or len(large) > 1000:
            raise RuntimeError('资源清单无效')
        get(assets['stormarium.tar.gz'], tmp / 'core.tar.gz')
        with tarfile.open(str(tmp / 'core.tar.gz'), 'r:gz') as core, \
                tarfile.open(str(tmp / 'release.tar.gz'), 'w:gz', compresslevel=1, dereference=True) as payload:
            for member in core:
                payload.addfile(member, core.extractfile(member) if member.isreg() else None)
            for name, digest in large.items():
                relative = PurePosixPath(name)
                if relative.is_absolute() or '..' in relative.parts or not relative.parts \
                        or not re.fullmatch(r'[0-9a-f]{64}', digest):
                    raise RuntimeError('资源路径无效')
                source = SITE / relative
                if not source.is_file() or source.is_symlink() or sha(source) != digest:
                    asset_name = digest + '.bin'
                    source = tmp / asset_name
                    if not source.exists():
                        get(assets[asset_name], source)
                    if sha(source) != digest:
                        raise RuntimeError('资源内容校验失败')
                payload.add(str(source), arcname='site/' + name, recursive=False)
        with (tmp / 'release.tar.gz').open('rb') as payload:
            subprocess.run([RECEIVE, expected], stdin=payload, check=True)


if __name__ == '__main__':
    main()
