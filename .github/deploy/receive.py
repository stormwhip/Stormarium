#!/usr/bin/python3 -I
"""Receive a website release from GitHub. Installed separately as a root-owned file."""
import fcntl
import filecmp
import grp
import os
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath

SITE = Path('/www/wwwroot/stormwhip.com')
APP = Path('/opt/storm-tools')
STATE = Path('/var/lib/stormarium-release')
MANIFEST = STATE / 'site-files.txt'
MAX_COMPRESSED = 130 * 1024 * 1024
MAX_EXPANDED = 300 * 1024 * 1024
STATIC_ROOTS = {'assets', 'notes', 'subjects', 'tools', '学科', '工具', '笔记'}
STATIC_FILES = {'index.html', '404.html', 'search.html', 'robots.txt', 'sitemap.xml',
                'stormarium-version.txt'}
PYTHON_FILE = re.compile(r'[a-zA-Z_][a-zA-Z_0-9]*\.py')
PROMPT_FILE = re.compile(r'[a-zA-Z_][a-zA-Z_0-9]*\.(py|md)')
TEMPLATE_FILE = re.compile(r'[a-zA-Z_][a-zA-Z_0-9]*\.tex')
SYSTEMCTL = '/usr/bin/systemctl'
CURL = '/usr/bin/curl'


def require(condition, problem):
    if not condition:
        raise RuntimeError(problem)


def allowed(parts):
    area, *names = parts
    if not names or any((name.startswith('.') or any(ord(c) < 32 for c in name)) for name in names):
        return False
    first = names[0]
    if area == 'site':
        return first in STATIC_ROOTS if len(names) > 1 else first in STATIC_FILES
    if area == 'service' and len(names) == 1:
        return bool(PYTHON_FILE.fullmatch(first)) or first == 'requirements.txt'
    if area == 'service' and len(names) == 2:
        rule = {'prompts': PROMPT_FILE, 'templates': TEMPLATE_FILE}.get(first)
        return bool(rule and rule.fullmatch(names[1]))
    return False


def receive(stage, expected):
    archive = stage / 'upload.tar.gz'
    remaining = MAX_COMPRESSED
    with archive.open('wb') as output:
        while True:
            block = sys.stdin.buffer.read(1024 * 1024)
            if not block:
                break
            remaining -= len(block)
            require(remaining >= 0, '发布包压缩后超过大小限制')
            output.write(block)
    seen = set()
    remaining = MAX_EXPANDED
    with tarfile.open(str(archive), 'r|gz') as payload:
        for ix, member in enumerate(payload, 1):
            require(ix <= 10000, '发布包文件数量超限')
            name = PurePosixPath(member.name)
            require(not name.is_absolute() and '..' not in name.parts, '发布包路径无效')
            if member.isdir():
                continue
            require(member.isreg() and allowed(name.parts), '发布包含非许可文件')
            require(name not in seen, '发布包包含重复文件')
            seen.add(name)
            remaining -= member.size
            require(remaining >= 0, '发布包解压后超过大小限制')
            destination = stage.joinpath(*name.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as output:
                shutil.copyfileobj(payload.extractfile(member), output)
    for name in ('index.html', 'search.html', 'sitemap.xml', 'tools/english.html',
                 'stormarium-version.txt'):
        require((stage / 'site' / name).stat().st_size > 0, '缺少必要的网站文件')
    require((stage / 'site/stormarium-version.txt').read_bytes() == (expected + '\n').encode('ascii'),
            '提交编号无效')
    require(filecmp.cmp(str(stage / 'service/requirements.txt'),
                        str(APP / 'requirements.txt'), shallow=False),
            '后端依赖有变更，请先由服务器管理员更新运行环境')


def user_ids(user):
    return pwd.getpwnam(user).pw_uid, grp.getgrnam(user).gr_gid


def overlay(source, target, mode, owner):
    fd, filename = tempfile.mkstemp(prefix='.stormarium-', dir=str(target.parent))
    try:
        with os.fdopen(fd, 'wb') as out, source.open('rb') as entry:
            shutil.copyfileobj(entry, out)
            os.fchmod(out.fileno(), mode)
            os.fchown(out.fileno(), *owner)
        os.replace(filename, str(target))
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def probe(*args):
    return subprocess.run([CURL, '-fsS', '--max-time', '5', *args],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def health():
    for _ in range(20):
        if probe('http://127.0.0.1:5000/api/health'):
            return
        time.sleep(1)
    raise RuntimeError('AI 服务健康检查未通过')


def install(stage, staging_site):
    web_owner, service_owner = user_ids('www'), user_ids('storm')
    site_src = stage / 'site'
    service_src = stage / 'service'
    web_files = {p.relative_to(site_src).as_posix(): p
                 for p in site_src.rglob('*') if p.is_file()}
    require(SITE.is_dir() and not SITE.is_symlink(), '站点目录无效')
    require(not any(p.is_symlink() for p in SITE.rglob('*')), '站点目录包含符号链接')
    removed = set()
    if MANIFEST.exists():
        removed = set(MANIFEST.read_text(encoding='utf-8').splitlines()) - web_files.keys()
        for old in removed:
            path = PurePosixPath(old)
            require(not path.is_absolute() and '..' not in path.parts
                    and allowed(('site',) + path.parts), '历史发布清单无效')
    web_changes = {}
    for name, source in sorted(web_files.items()):
        target = SITE / name
        if target.is_file() and filecmp.cmp(str(source), str(target), shallow=False):
            continue
        if target.exists():
            require(target.is_file(), '网页路径与已有目录冲突')
        prepared = staging_site / 'prepared' / name
        prepared.parent.mkdir(parents=True, exist_ok=True)
        overlay(source, prepared, 0o644, web_owner)
        web_changes[name] = prepared
    for name in sorted(removed):
        if (SITE / name).is_file():
            web_changes[name] = None
    pending_manifest = stage / 'site-files.txt'
    pending_manifest.write_text('\n'.join(sorted(web_files)) + '\n', encoding='utf-8')

    require(APP.is_dir() and not APP.is_symlink(), '后端目录无效')
    for sub in ('prompts', 'templates'):
        p = APP / sub
        require(p.is_dir() and not p.is_symlink(), '后端目录无效')
    changed = []
    for source in sorted(service_src.rglob('*')):
        if not source.is_file() or source.name == 'requirements.txt':
            continue
        target = APP / source.relative_to(service_src)
        require(not target.is_symlink(), '后端文件路径无效')
        if source.suffix == '.py':
            with source.open('rb') as code:
                subprocess.run(['/usr/bin/sudo', '-u', 'storm', '--',
                                str(APP / 'venv/bin/python'), '-I', '-c',
                                'import sys; compile(sys.stdin.buffer.read(), sys.argv[1], "exec")',
                                source.name], stdin=code, cwd='/', check=True)
        if not target.is_file() or not filecmp.cmp(str(source), str(target), shallow=False):
            changed.append((source, target))
    backups = {}
    web_backups = {}
    try:
        for source, target in changed:
            backup = None
            if target.exists():
                backup = stage / 'backend-backup' / target.relative_to(APP)
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(str(target), str(backup))
            backups[target] = backup
            overlay(source, target, 0o640, service_owner)
        if changed:
            subprocess.run([SYSTEMCTL, 'restart', 'storm-tools'], check=True)
        health()
        # 先更新资源，再更新页面与版本标记；单个文件通过重命名替换。
        ordered = sorted(web_changes, key=lambda name: (
            name == 'stormarium-version.txt', web_changes[name] is None,
            not name.startswith('assets/'), name))
        for name in ordered:
            target = SITE / name
            prepared = web_changes[name]
            old = None
            if target.exists():
                old = staging_site / 'backup' / name
                old.parent.mkdir(parents=True, exist_ok=True)
                os.link(str(target), str(old))
            web_backups[target] = old
            if prepared is None:
                target.unlink()
                continue
            for directory in (*reversed(target.parent.parents), target.parent):
                if directory == SITE or SITE not in directory.parents:
                    continue
                if not directory.exists():
                    directory.mkdir()
                    os.chmod(str(directory), 0o755)
                    os.chown(str(directory), *web_owner)
            os.replace(str(prepared), str(target))
        require(probe('--resolve', 'stormwhip.com:443:127.0.0.1', 'https://stormwhip.com/'),
                '源站 HTTPS 首页检查未通过')
        deployed = subprocess.check_output([CURL, '-fsS', '--max-time', '10', '--resolve',
                                            'stormwhip.com:443:127.0.0.1',
                                            'https://stormwhip.com/stormarium-version.txt'])
        require(deployed == web_files['stormarium-version.txt'].read_bytes(),
                '源站发布版本与本次提交不一致')
        os.replace(str(pending_manifest), str(MANIFEST))
    except Exception:
        for target, old in reversed(list(web_backups.items())):
            if old is not None:
                os.replace(str(old), str(target))
            elif target.exists():
                target.unlink()
        for target, backup in backups.items():
            if backup is not None:
                overlay(backup, target, 0o640, service_owner)
            elif target.exists():
                target.unlink()
        if backups:
            subprocess.run([SYSTEMCTL, 'restart', 'storm-tools'], check=False)
        raise
    print('发布成功：' + deployed.decode('ascii').strip(), flush=True)


def main():
    require(len(sys.argv) == 2 and re.fullmatch(r'[0-9a-f]{40}', sys.argv[1]),
            '发布入口需要有效的提交编号')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix='payload-', dir=str(STATE)) as data, \
                tempfile.TemporaryDirectory(prefix='.stormarium-', dir=str(SITE.parent)) as web:
            stage = Path(data)
            receive(stage, sys.argv[1])
            install(stage, Path(web) / 'site')


if __name__ == '__main__':
    main()
