# 网站素材来源记录

更新时间：2026-09-04。

这份文件记录 `site/assets/` 中网站界面素材的来源与生成方式。正文引用的图片和视频位于 `site/media/`，由公开内容快照统一管理，不在这里逐项重复。

## 豆包品牌标志

`site/assets/brand/doubao-mark-*.png` 是从项目品牌素材目录中的透明版本裁切、居中并缩放得到的站点尺寸。

- 来源页面：<https://bytedance.feishuapp.com/app/app_17bcpgp1v96>
- 完整文件说明、原图地址及处理方式：[`../../assets/brand/README.md`](../../assets/brand/README.md)
- 处理脚本：[`../../tools/logo-prep.py`](../../tools/logo-prep.py)
- 使用提醒：豆包品牌标志版权归字节跳动所有，本项目仅作内容展示与开发参考。

## 交流群二维码

- 文件：`qr-group.png`
- 来源：项目维护者于 2026-09-04 在本次修改中直接提供
- 处理：将用户提供的 396 × 396 JPEG 转为 PNG；未裁切、未缩放、未重绘
- 尺寸：396 × 396
- SHA-256：`2514884991c3b0f5ee66632ae1dc287863c77c9dff3dba31461f7038543d8f73`

二维码可能随群状态变化而失效。替换时应同步更新本节的日期、尺寸和哈希，并在发布后实际扫码验收。

## 作者名片

`site/assets/authors/` 是仓库根目录 `assets/authors/` 中五张作者名片的逐字节副本，用于网站页脚展示。仓库没有记录这些名片的外部下载网址，不补写无法核验的来源。

## Open Graph 分享图

- 文件：`og-cover.png`
- 来源：使用站点自身文字、配色和豆包标志在本地生成，不是外部网页截图
- 生成脚本：[`../../tools/og-card.mjs`](../../tools/og-card.mjs)
- 输出规格：1200 × 630 的两倍像素密度截图

## 正文媒体

`site/media/` 中的公开截图和视频由 `site/content/site-content.json` 以 `localPath` 引用。当前公开快照只保存本地文件路径，没有保留每一项素材的原始远程网址；后续导入流程如需可追溯，应在生成内容快照时另行保存来源 URL、抓取时间和授权状态。
