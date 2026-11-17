#!/usr/bin/env python3
"""Offline regression test for Stormarium's incremental package format."""
import importlib.util
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
A = 'a' * 40
B = 'b' * 40


def make_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def run_pack(version, site, service, release, previous=None):
    command = [sys.executable, str(HERE / 'pack.py'), version, str(site),
               str(service), str(release)]
    if previous:
        command.append(str(previous))
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return json.loads((release / 'site-manifest.json').read_text(encoding='utf-8'))


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        site1, site2 = root / 'site1', root / 'site2'
        service = root / 'service'
        make_file(site1 / 'index.html', b'<html>same</html>')
        make_file(site1 / 'assets/file/note.md', b'old text')
        make_file(site1 / 'assets/img/large.bin', b'Z' * 150000)
        make_file(site1 / 'robots.txt', b'old robot')
        make_file(service / 'requirements.txt', b'flask==1\n')
        make_file(service / 'app.py', b'print("hello")\n')
        first = run_pack(A, site1, service, root / 'release1')
        assert first['version'] == A and first['base'] is None
        assert not (root / 'release1/site-delta.tar.gz').exists()

        shutil.copytree(site1, site2)
        make_file(site2 / 'assets/file/note.md', b'new text')
        make_file(site2 / 'notes/new.html', b'<html>new</html>')
        (site2 / 'robots.txt').unlink()
        second = run_pack(B, site2, service, root / 'release2',
                          root / 'release1/site-manifest.json')
        assert second['base'] == A and second['version'] == B
        diff = {name for name, digest in second['files'].items()
                if first['files'].get(name) != digest}
        assert diff == {'assets/file/note.md', 'notes/new.html', 'stormarium-version.txt'}, diff
        with tarfile.open(root / 'release2/site-delta.tar.gz', 'r:gz') as archive:
            packed = {member.name.removeprefix('site/')
                      for member in archive if member.isfile()
                      and member.name.startswith('site/')}
        assert packed == diff, (packed, diff)

        spec = importlib.util.spec_from_file_location('stormarium_sync', HERE / 'sync.py')
        sync = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sync)
        sync.SITE = site1
        payload = root / 'release2/site-delta.tar.gz'

        def fake_get(asset, target):
            shutil.copyfile(payload, target)

        sync.get = fake_get
        staged = root / 'staged'
        staged.mkdir()
        restored = sync.install_delta(
            {'site-delta.tar.gz': {'name': 'site-delta.tar.gz'}},
            staged, second, A, B)
        with tarfile.open(restored, 'r:gz') as archive:
            files = {member.name.removeprefix('site/'): archive.extractfile(member).read()
                     for member in archive if member.isfile()
                     and member.name.startswith('site/')}
        assert set(files) == set(second['files'])
        for name, data in files.items():
            assert data == (site2 / name).read_bytes(), name
    print('增量包测试通过：修改、添加、删除、未变资源复用与完整还原')


if __name__ == '__main__':
    main()
