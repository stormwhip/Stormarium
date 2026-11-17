# Stormarium

[Stormarium](https://stormwhip.com/) 是一个个人学习笔记网站。这里收录预科各科的笔记和资料，可以搜索知识点、在线阅读 PDF，也可以使用重点总结器、英语课助手、光学干涉实验室和原子轨道可视化。

## 在 GitHub 上更新网站

打开仓库中文件的页面，点击铅笔编辑。新增或替换 PDF、插图时，在对应目录选择 **Add file → Upload files**。一篇笔记的正文、插图和附件可以放在同一次提交中。

提交到 `main` 后，[发布网站](https://github.com/stormwhip/Stormarium/actions/workflows/publish.yml) 会自动生成网站发布包，阿里云服务器每两分钟检查并上线新版本。进入 **Actions → 发布网站** 查看进度，也可以用 **Run workflow** 手动发布。Actions 完成后，等服务器取回发布包，再到 [stormwhip.com](https://stormwhip.com/) 查看更新；网页和附件可能按 CDN 的缓存时间陆续刷新。

| 要改什么 | 到哪里改 |
| --- | --- |
| 笔记正文 | `内容/<学科>/<笔记名>/markdown/` |
| PDF、LaTeX 源码、插图 | 同一篇笔记下的 `pdf/`、`latex/`、`图片/` |
| 学科与笔记的排序 | `内容/_学科顺序.txt` 和各学科目录的 `_顺序.txt` |
| 站名、简介和页脚 | `站点配置.json` |
| 图标和背景 | [站点素材](站点素材/图片素材规格.md) |
| 网页样式、搜索和工具页面 | `工具/模板/` |
| AI 工具提示词 | `服务/prompts/` |

笔记页的 Markdown、PDF、LaTeX 下载直接从 GitHub 上对应提交读取；源码与插图 ZIP 从对应 GitHub Release 下载。网站构建使用固定提交版本，保证同一版网页与下载的内容一致。发布流程逐篇校验下载链接和文件内容。

每次发布的源码版本可在 [Releases](https://github.com/stormwhip/Stormarium/releases) 查看，当前上线版本可在[线上版本页](https://stormwhip.com/stormarium-version.txt)核对。

## 本地预览

安装 Node.js 24，在仓库根目录运行：

```sh
node 工具/build.js
```

打开生成的 `网站/index.html` 浏览。构建会同时生成搜索索引。AI 工具的接口由线上 Python 服务提供。

## 发布维护

GitHub 保存源码并触发发布；访客通过阿里云 CDN 访问网站。服务器上线时会检查首页和 AI 服务，服务器上的运行配置、API 密钥和用户生成文件单独保存。后端依赖清单变更时，需要先由服务器管理员更新运行环境，再重新运行发布。
