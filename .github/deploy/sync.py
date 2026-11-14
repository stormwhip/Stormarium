#!/usr/bin/python3 -I
"""Fetch the latest package from the Stormarium repository."""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

API = 'https://api.github.com/repos/stormwhip/Stormarium'
VERSION = Path('/www/wwwroot/stormwhip.com/stormarium-version.txt')
RECEIVE = '/usr/local/libexec/stormarium-release'
CURL = ('/usr/bin/curl', '-fsSL', '--proto', '=https',
        '--proto-redir', '=https', '--connect-timeout', '12', '--retry', '2')


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
    assets = [asset for asset in release['assets'] if asset['name'] == 'stormarium.tar.gz'
              and asset['state'] == 'uploaded']
    if len(assets) != 1:
        raise RuntimeError('GitHub 发布包缺失')
    asset = assets[0]
    if not isinstance(asset['id'], int) or not 0 < asset['size'] <= 130 * 1024 * 1024:
        raise RuntimeError('GitHub 发布包信息无效')
    url = API + '/releases/assets/' + str(asset['id'])
    with tempfile.TemporaryFile() as payload:
        subprocess.run([*CURL, '--max-time', '180', '--max-filesize', str(asset['size']),
                        '-H', 'Accept: application/octet-stream', url],
                       stdout=payload, check=True)
        if payload.tell() != asset['size']:
            raise RuntimeError('GitHub 发布包大小不一致')
        payload.seek(0)
        subprocess.run([RECEIVE, expected], stdin=payload, check=True)


if __name__ == '__main__':
    main()
