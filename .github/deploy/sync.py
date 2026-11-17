#!/usr/bin/python3 -I
"""Mirror-verified, delta-first Stormarium release synchronizer."""
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

API = 'https://api.github.com/repos/stormwhip/Stormarium'
SITE = Path('/www/wwwroot/stormwhip.com')
VERSION = SITE / 'stormarium-version.txt'
RECEIVE = '/usr/local/libexec/stormarium-release'
DEFAULT_MIRRORS = 'https://ghproxy.net/,https://ghfast.top/'
CURL = ('/usr/bin/curl', '-fsSL', '--proto', '=https',
        '--proto-redir', '=https', '--connect-timeout', '12')
ROOTS = {'assets', 'notes', 'subjects', 'tools', '学科', '工具', '笔记'}
ROOT_FILES = {'index.html', '404.html', 'search.html', 'robots.txt',
              'sitemap.xml', 'stormarium-version.txt'}


def log(*items):
    print('[sync]', *items, flush=True)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def valid_name(name):
    if not isinstance(name, str):
        return False
    parts = PurePosixPath(name).parts
    if not parts or PurePosixPath(name).is_absolute() or '..' in parts \
            or any(part.startswith('.') or any(ord(c) < 32 for c in part) for part in parts):
        return False
    return (len(parts) == 1 and parts[0] in ROOT_FILES) or \
           (len(parts) > 1 and parts[0] in ROOTS)


def mirror_urls(asset):
    original = asset.get('browser_download_url', '')
    expected = 'https://github.com/stormwhip/Stormarium/releases/download/site-'
    if not original.startswith(expected):
        raise RuntimeError('发布资源地址不属于 Stormarium')
    mirrors = os.environ.get('STORMARIUM_RELEASE_MIRRORS', DEFAULT_MIRRORS).split(',')
    for mirror in mirrors:
        mirror = mirror.strip()
        parts = urlsplit(mirror)
        if parts.scheme != 'https' or not parts.netloc or parts.username or parts.password \
                or parts.query or parts.fragment or not mirror.endswith('/'):
            raise RuntimeError('镜像前缀必须是以 / 结尾的 HTTPS 地址')
        yield mirror + original


def get(asset, path):
    size = asset.get('size')
    digest = asset.get('digest', '')
    if not isinstance(size, int) or not 0 < size <= 130 * 1024 * 1024 \
            or not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise RuntimeError('GitHub 资源大小或 SHA-256 信息无效')
    for url in mirror_urls(asset):
        start = time.monotonic()
        try:
            subprocess.run([*CURL, '--max-time', '900', '--max-filesize', str(size),
                            '-o', str(path), url], check=True,
                           stdout=subprocess.DEVNULL)
            if path.stat().st_size != size or sha(path) != digest[7:]:
                raise RuntimeError('镜像下载校验失败')
            log('镜像下载成功', asset['name'], str(size) + 'B',
                '耗时', round(time.monotonic() - start, 2), '秒',
                '来源', urlsplit(url).netloc)
            return
        except (subprocess.CalledProcessError, OSError, RuntimeError) as exc:
            if path.exists():
                path.unlink()
            log('镜像失败', asset['name'], urlsplit(url).netloc, str(exc)[:150])
    raise RuntimeError('所有镜像均下载失败：' + asset['name'])


def load_release():
    started = time.monotonic()
    response = subprocess.run([*CURL, '--max-time', '30', API + '/releases/latest'],
                              stdout=subprocess.PIPE, check=True)
    release = json.loads(response.stdout.decode('utf-8'))
    tag = re.fullmatch(r'site-([0-9a-f]{40})', release['tag_name'])
    if not tag:
        raise RuntimeError('最新 Release 标签无效')
    assets = {asset['name']: asset for asset in release['assets']
              if asset.get('state') == 'uploaded'}
    log('检查 GitHub Release', round(time.monotonic() - started, 2), '秒')
    return tag.group(1), assets


def need(assets, name):
    if name not in assets:
        raise RuntimeError('Release 缺少资源：' + name)
    return assets[name]


def load_manifest(assets, tmp, expected):
    if 'site-manifest.json' not in assets:
        return None
    path = tmp / 'site-manifest.json'
    get(need(assets, 'site-manifest.json'), path)
    data = json.loads(path.read_text(encoding='utf-8'))
    files = data.get('files')
    if data.get('version') != expected or not isinstance(files, dict) \
            or not 0 < len(files) <= 10000 \
            or any(not valid_name(name) or not isinstance(digest, str)
                   or not re.fullmatch(r'[0-9a-f]{64}', digest)
                   for name, digest in files.items()):
        raise RuntimeError('增量发布清单不合法')
    return data


def install_delta(assets, tmp, manifest, local_version, expected):
    target = tmp / 'site-delta.tar.gz'
    get(need(assets, 'site-delta.tar.gz'), target)
    old = manifest.get('base')
    if old != local_version:
        raise RuntimeError('增量基线与已部署版本不一致')
    changed = tmp / 'changed'
    changed.mkdir()
    paths = manifest['files']
    changed_files = set()
    service_count = 0
    with tarfile.open(target, 'r:gz') as source:
        for member in source:
            path = PurePosixPath(member.name)
            if member.isdir():
                continue
            if not member.isfile() or path.is_absolute() or '..' in path.parts:
                raise RuntimeError('增量压缩包包含非法成员')
            if path.parts[0] == 'site':
                name = '/'.join(path.parts[1:])
                if not valid_name(name) or name not in paths or name in changed_files:
                    raise RuntimeError('增量资源路径重复或非法')
                changed_files.add(name)
            elif path.parts[0] == 'service' and len(path.parts) > 1:
                name = '/'.join(path.parts)
                service_count += 1
            else:
                raise RuntimeError('增量压缩包包含未知资源')
            destination = changed.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as output:
                shutil.copyfileobj(source.extractfile(member), output)
            if path.parts[0] == 'site' and sha(destination) != paths[name]:
                raise RuntimeError('增量文件 SHA-256 校验失败：' + name)
    if not (changed / 'service/requirements.txt').is_file() or service_count < 2:
        raise RuntimeError('缺失服务文件')
    unchanged = 0
    for name, digest in paths.items():
        if name in changed_files:
            continue
        existing = SITE.joinpath(*PurePosixPath(name).parts)
        if not existing.is_file() or existing.is_symlink() or sha(existing) != digest:
            raise RuntimeError('增量基线文件缺失或内容不一致：' + name)
        unchanged += 1
    log('增量复用', unchanged, '个文件，变化', len(changed_files), '个文件')
    output = tmp / 'release.tar.gz'
    with tarfile.open(output, 'w:gz', compresslevel=1) as archive:
        archive.add(changed / 'service', arcname='service')
        for name in sorted(paths):
            source = changed / 'site' / name if name in changed_files else SITE / name
            archive.add(source, arcname='site/' + name, recursive=False)
    return output


def install_full(assets, tmp):
    log('执行完整兼容部署')
    files_json = tmp / 'files.json'
    get(need(assets, 'files.json'), files_json)
    large = json.loads(files_json.read_text(encoding='utf-8'))
    if not isinstance(large, dict) or len(large) > 1000 or any(
            not valid_name(name) or not re.fullmatch(r'[0-9a-f]{64}', digest)
            for name, digest in large.items()):
        raise RuntimeError('完整发布资源清单不合法')
    core_path = tmp / 'core.tar.gz'
    get(need(assets, 'stormarium.tar.gz'), core_path)
    sources = {}
    pending = {}
    for name, digest in large.items():
        existing = SITE / name
        if existing.is_file() and not existing.is_symlink() and sha(existing) == digest:
            sources[name] = existing
        else:
            path = tmp / (digest + '.bin')
            sources[name] = path
            if not path.exists():
                pending[digest] = (need(assets, digest + '.bin'), path)
    log('完整包复用', len(sources) - len(pending), '个大文件，下载', len(pending), '个')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        tasks = [executor.submit(get, asset, path) for asset, path in pending.values()]
        for task in concurrent.futures.as_completed(tasks):
            task.result()
    output = tmp / 'release.tar.gz'
    with tarfile.open(core_path, 'r:gz') as core, \
            tarfile.open(output, 'w:gz', compresslevel=1) as archive:
        for member in core:
            archive.addfile(member, core.extractfile(member) if member.isfile() else None)
        for name, digest in large.items():
            source = sources[name]
            if sha(source) != digest:
                raise RuntimeError('完整包资源损坏：' + name)
            archive.add(source, arcname='site/' + name, recursive=False)
    return output


def main():
    started = time.monotonic()
    expected, assets = load_release()
    local_version = VERSION.read_text(encoding='ascii').strip() if VERSION.is_file() else ''
    if local_version == expected:
        log('已是最新版本', expected[:12])
        return
    log('目标版本', expected[:12], '当前版本', local_version[:12])
    with tempfile.TemporaryDirectory() as directory:
        tmp = Path(directory)
        manifest = load_manifest(assets, tmp, expected)
        if manifest and manifest.get('base') == local_version and \
                'site-delta.tar.gz' in assets:
            payload = install_delta(assets, tmp, manifest, local_version, expected)
        else:
            payload = install_full(assets, tmp)
        log('资源准备完成，总耗时', round(time.monotonic() - started, 2), '秒')
        with payload.open('rb') as source:
            subprocess.run([RECEIVE, expected], stdin=source, check=True)
    deployed = VERSION.read_text(encoding='ascii').strip()
    if deployed != expected:
        raise RuntimeError('服务器安装结果与目标版本不一致')
    log('发布成功', expected, '总耗时', round(time.monotonic() - started, 2), '秒')


if __name__ == '__main__':
    main()
