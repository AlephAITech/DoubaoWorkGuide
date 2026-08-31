<p align="center">
  <img src="./assets/readme-home.png" alt="豆包工作指南网站首页" width="100%">
</p>

<h1 align="center">豆包工作指南</h1>

<p align="center"><strong>从零到一掌握豆包工作，把真实任务整理成可复用的工作方法</strong></p>

<p align="center">
  <a href="#在线阅读">在线阅读</a> ·
  <a href="#项目简介">项目简介</a> ·
  <a href="#内容地图">内容地图</a> ·
  <a href="#本地运行">本地运行</a> ·
  <a href="#参与完善">参与完善</a>
</p>

## 项目简介

DoubaoWork Guide 是一份面向豆包工作的系统化中文实践指南。项目为新用户提供从下载安装到完成首个可验收任务的完整上手路径，并继续覆盖连接器、Skill、API、定时任务、多 Agent 工作小队等核心能力。

基础能力之外，指南从个人提效、自媒体、知识管理、电商和金融研究五类工作场景出发，通过 31 个真实任务展示如何把材料、要求和工具组织为可检查、可交付、可复用的工作成果。

当前项目收录 49 篇指南与案例，并提供全文搜索、章节导航、场景任务速达、图片与视频展示、明暗主题切换及移动端适配。内容与网站展示层相互独立，后续扩充章节时可以保持稳定的阅读架构。

## 在线阅读

推荐访问 [doubaowork.homes](https://doubaowork.homes/) 阅读完整内容。在线版提供完整章节目录、全文搜索、场景任务速达、图片与视频展示、明暗主题切换和移动端适配。

GitHub 适合查看项目结构和参与完善，连续阅读请使用在线版。

- [从第一篇开始](https://doubaowork.homes/#/doc/doc-21b54541198d4915)
- [查看阅读指南](https://doubaowork.homes/#/reading-guide)

## 适合谁阅读

- 第一次使用豆包工作，希望快速跑通完整流程的个人用户
- 已经有明确任务，希望找到相近案例和可执行方法的职场人
- 需要把一次成功经验整理成稳定工作流的团队与内容维护者
- 关注 AI 在内容、知识、电商和研究场景中实际落地方式的实践者

## 内容地图

| 部分 | 规模 | 主要内容 |
| --- | --- | --- |
| 使用篇 | 12 篇 | 安装登录、界面与任务、第一个任务、连接器、Skill、工作伙伴、手机控制、API、定时任务、多 Agent 和指令模板 |
| 入门篇 | 6 篇 | Office 文档、协作、文件整理、远程任务、生活事务和自动资讯简报 |
| 场景篇 | 5 类场景，31 个任务 | 个人提效、自媒体、知识管理、电商和金融研究 |

五类场景覆盖以下问题。

- **个人提效**　邮件处理、会议待办、文档交付、数据分析、调研报告、日报、阅读学习与个人网站
- **自媒体**　选题、公众号写作、多平台改写、口播分镜、音视频处理、评论复盘、GEO 体检与短视频生产
- **知识管理**　资料收藏、重复文件、项目归档、知识检索、提示词分类与过期内容治理
- **电商**　从产品原图出发，完成参考拆解、视觉策划与成套主图生产
- **金融研究**　市场复盘、财报分析、公司研究、估值比较、治理分析、研报审计与投研评审

## 网站能力

- 独立章节页面、前后篇导航和页内目录
- 全文搜索与场景任务快速访问
- 图片画廊、组合排版和本地视频播放
- 桌面端与移动端响应式布局
- 明暗主题切换与本地偏好保存
- 内容数据、媒体资源与界面逻辑分层维护

## 本地运行

网站采用纯静态结构，无需安装前端依赖。在项目根目录运行以下命令。

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory site
```

浏览器访问以下地址。

```text
http://127.0.0.1:4173/
```

其他进程占用 `4173` 时，可替换为任意可用端口。

## 内容维护

公开内容由结构化数据和本地媒体资源驱动。

- `site/content/site-content.json` 保存章节结构与正文
- `site/media/` 保存公开页面引用的图片和视频
- `site/app.js` 负责路由、搜索、正文渲染和页面交互
- `site/styles.css` 负责视觉系统、响应式布局与明暗主题
- `site/index.html` 提供站点入口和全局导航

内容更新应保留现有节点关系与公开媒体路径。界面调整应优先在展示层完成，避免把章节内容直接写入页面模板。

## 目录结构

```text
doubaowork-guide/
├── assets/
│   ├── authors/                 # 作者名片
│   └── readme-home.png          # README 首页预览
├── site/
│   ├── assets/                  # 网站界面素材
│   ├── content/                 # 公开内容数据
│   ├── media/                   # 公开图片与视频
│   ├── app.js                   # 路由、渲染、搜索与交互
│   ├── styles.css               # 视觉与响应式样式
│   └── index.html               # 网站入口
├── .gitignore
└── README.md
```

## 发布方式

站点发布目录为 `site`，无需额外构建步骤。主分支保存线上版本，当前网站由 Cloudflare 托管并使用独立域名访问。

- 在线网站 [doubaowork.homes](https://doubaowork.homes/)
- GitHub 仓库 [AlephAITech/DoubaoWorkGuide](https://github.com/AlephAITech/DoubaoWorkGuide)

## 参与完善

欢迎通过 Issue 或 Pull Request 补充案例、修正文案和改进阅读体验。新增案例建议包含清晰的任务背景、输入材料、执行过程、交付结果和验收依据。提交图片或视频前，请确认素材拥有公开使用权限，并移除账号、联系方式和业务数据等敏感信息。

## 作者们

感谢以下作者共同参与《豆包工作指南》的创作与维护。点击名片可查看原图并扫描二维码。

<p align="center">
  <a href="./assets/authors/jia-mu-wei-lai-pai.png"><img src="./assets/authors/jia-mu-wei-lai-pai.png" alt="甲木未来派" width="48%"></a>
  <a href="./assets/authors/mo-yu-xiao-li.png"><img src="./assets/authors/mo-yu-xiao-li.png" alt="摸鱼小李" width="48%"></a>
</p>

<p align="center">
  <a href="./assets/authors/dai-shu-di-ai-ke-zhan.png"><img src="./assets/authors/dai-shu-di-ai-ke-zhan.png" alt="袋鼠帝AI客栈" width="48%"></a>
  <a href="./assets/authors/cang-he.png"><img src="./assets/authors/cang-he.png" alt="苍何" width="48%"></a>
</p>

<p align="center">
  <a href="./assets/authors/liu-cong-nlp.png"><img src="./assets/authors/liu-cong-nlp.png" alt="刘聪NLP" width="48%"></a>
</p>

## 声明

本项目由社区作者共同维护，属于豆包工作的非官方实践指南。产品功能、界面、价格、权限和可用范围可能调整，涉及具体操作时请以产品当前版本及官方说明为准。
