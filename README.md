# Stormarium

[Stormarium](https://stormwhip.com/) 是一个个人学习笔记网站。这里收录预科各科的笔记和资料，可以搜索知识点、在线阅读 PDF，也可以使用重点总结器、英语课助手、光学干涉实验室和原子轨道可视化。

## 在 GitHub 上更新网站

打开仓库中文件的页面，点击铅笔编辑。新增或替换 PDF、插图时，在对应目录选择 **Add file → Upload files**。一篇笔记的正文、插图和附件可以放在同一次提交中。

提交到 `main` 后，[发布网站](https://github.com/stormwhip/Stormarium/actions/workflows/publish.yml) 自动生成 Release，随后 GitHub Actions 通过受限 SSH 触发阿里云同步，并检查服务器返回的提交编号。**只有构建与部署两个任务均成功才代表上线完成。** 首次配置前保留原定时同步作为兼容方案。

| 要改什么 | 到哪里改 |
| --- | --- |
| 笔记正文 | `内容/<学科>/<笔记名>/markdown/` |
| PDF、LaTeX 源码、插图 | 同一篇笔记下的 `pdf/`、`latex/`、`图片/` |
| 学科与笔记的排序 | `内容/_学科顺序.txt` 和各学科目录的 `_顺序.txt` |
| 站名、简介和页脚 | `站点配置.json` |
| 图标和背景 | [站点素材](站点素材/图片素材规格.md) |
| 网页样式、搜索和工具页面 | `工具/模板/` |
| AI 工具提示词 | `服务/prompts/` |

笔记页的 Markdown、PDF、LaTeX 和源码 ZIP 从本站 assets/file/ 同源静态镜像下载，经过阿里云 CDN 分发。下载 URL 按文件内容附加版本号，发布时逐篇检查镜像内容与源码的 SHA-256 一致。构建使用固定 GitHub 提交版本。

每次发布的源码版本可在 [Releases](https://github.com/stormwhip/Stormarium/releases) 查看，当前上线版本可在[线上版本页](https://stormwhip.com/stormarium-version.txt)核对。

## 本地预览

安装 Node.js 24，在仓库根目录运行：

```sh
node 工具/build.js
```

打开生成的 `网站/index.html` 浏览。构建会同时生成搜索索引。AI 工具的接口由线上 Python 服务提供。

## 发布维护

GitHub 保存源码并触发发布；访客通过阿里云 CDN 访问网站。服务器从 GitHub Release 镜像下载经过 SHA-256 校验的发布文件，优先按相邻版本增量安装，基线不匹配时回退至兼容完整包。服务器上线时检查首页和 AI 服务，运行配置、密钥及用户数据独立保存。后端依赖清单变更时，需要先由服务器管理员更新运行环境，再重新运行发布。


## GitHub 更新后立即部署：一次性配置

新发布链路包含：变更文件增量包、镜像下载、GitHub Actions 事件触发、服务器版本核对。首次验证事件驱动部署成功前，请保留现有的 systemd 定时同步作为回退通道。

### 安装服务器端程序

从已经检查过的最新 Stormarium 仓库工作树内执行：

    sudo install -o root -g root -m 0755 .github/deploy/sync.py /usr/local/libexec/stormarium-sync
    sudo install -o root -g root -m 0755 .github/deploy/trigger.sh /usr/local/libexec/stormarium-trigger
    sudo install -o root -g root -m 0644 .github/deploy/stormarium-sync.service /etc/systemd/system/stormarium-sync.service
    sudo systemctl daemon-reload

受保护的 /usr/local/libexec/stormarium-release 继续使用现有部署程序。文件内容默认使用 https://ghproxy.net/ 与 https://ghfast.top/ 镜像下载，逐个使用 GitHub 官方 Release 元数据中的 SHA-256 校验；GitHub API 仅获取小体量的版本元数据。如需指定镜像，可通过 systemd 环境变量 STORMARIUM_RELEASE_MIRRORS 传入以英文逗号分隔、以斜杠结尾的 HTTPS 镜像前缀。

### 建立最小权限 SSH 部署用户

在阿里云执行：

    sudo useradd --system --create-home --shell /bin/bash stormdeploy
    sudo install -d -m 700 -o stormdeploy -g stormdeploy /home/stormdeploy/.ssh
    echo 'stormdeploy ALL=(root) NOPASSWD: /usr/bin/systemctl start stormarium-sync.service' | sudo tee /etc/sudoers.d/stormarium-deploy >/dev/null
    sudo chmod 440 /etc/sudoers.d/stormarium-deploy
    sudo visudo -cf /etc/sudoers.d/stormarium-deploy

在管理员本机生成一个专用 SSH Ed25519 密钥对。将公钥放入 /home/stormdeploy/.ssh/authorized_keys，公钥前加 restrict,command="/usr/local/libexec/stormarium-trigger" ，两者用空格分隔，须写在同一行。该文件的所有者必须是 stormdeploy:stormdeploy，权限为 600。服务器只允许这把密钥触发指定的同步服务。

### GitHub Actions Secrets

在仓库 Settings → Secrets and variables → Actions 中设置：

| 名称 | 用途 |
| --- | --- |
| STORMARIUM_DEPLOY_HOST | 阿里云公网地址 |
| STORMARIUM_DEPLOY_USER | stormdeploy |
| STORMARIUM_DEPLOY_KEY | 发布专用 SSH 私钥的完整内容 |
| STORMARIUM_DEPLOY_KNOWN_HOSTS | 已验证指纹的服务器 SSH known_hosts 内容 |
| STORMARIUM_DEPLOY_PORT | 可选，默认 22 |

服务器主机指纹以 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 核对；管理员本机可用 ssh-keyscan -t ed25519 服务器地址 获取 known_hosts 条目，并验证其指纹。SSH 私钥只存放在 GitHub Secrets 中。

### 验证与关闭旧定时器

进入 Actions → 发布网站 → Run workflow。确认「构建并发布」和「通知阿里云部署并核对版本」两个任务均成功，第二个任务打印 STORMARIUM_DEPLOYED_SHA=后跟与提交一致的 40 位 SHA。随后在阿里云执行：

    sudo systemctl disable --now stormarium-sync.timer

若需恢复轮询：sudo systemctl enable --now stormarium-sync.timer。同步器会为每个阶段打印下载镜像、资源文件个数以及耗时。

### 增量发布规则

每次 Release 包含 site-manifest.json，记录全部网站文件的 SHA-256。若存在上一版本的清单，还会包含 site-delta.tar.gz，收录相对上个版本发生变化的文件及服务代码。阿里云仅下载增量包，并从现有目录复用 SHA-256 匹配的文件；不匹配时使用完整兼容包进行恢复。浏览器端 MD、TeX、PDF 和源码 ZIP 下载均走本站同源的 CDN 静态镜像。
