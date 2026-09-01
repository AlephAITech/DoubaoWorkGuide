# 品牌素材来源

从「大仙特供｜豆包工作案例库」页面提取，抓取时间 2026-09-01。

来源页面：<https://bytedance.feishuapp.com/app/app_17bcpgp1v96>

| 文件 | 说明 |
| --- | --- |
| `doubao-case-library-logo.png` | 原始 favicon / og:image，400×400，白底不透明 |
| `doubao-logo.svg` | 页面内引用的 `doubao.svg`。名为 SVG，实际只是包了一层 `<image>` 的 432×432 内嵌 PNG，**不是真矢量** |
| `doubao-logo-432.png` | 从上面 SVG 里取出的内嵌位图，本目录最大原始尺寸 |
| `doubao-logo-transparent.png` | 以 432 版为基础去掉白底，环内孔洞一并透明，边缘做过反预乘处理 |
| `doubao-logo-{512,256,128,64,32}.png` | 由透明版等比缩放导出的常用尺寸 |

站点实际使用的是另一套方形版本，输出到 `site/assets/brand/`：

| 文件 | 用在哪里 |
| --- | --- |
| `doubao-mark-512.png` | 封面正文里那颗行内标记（1.6em，跟着字号缩放） |
| `doubao-mark-180.png` | apple-touch-icon、字标的 2x |
| `doubao-mark-64.png` | 页眉字标（22px） |
| `doubao-mark-32.png` | favicon |

原图四周留白不对称——可见区域只有 340×360，落在 432 的画布里偏上偏右。直接缩到 20px 会明显歪，所以这套先裁到可见区域再补成正方形居中。

原始 logo 地址（可能失效）：

- 图标 / og:image：`https://miaoda.feishu.cn/aily/api/v1/files/static/6c621a4c041e20ea82bd0a8c90538c6083994d9e158d72390d5bbb5a6fb0d1b1_ve_miaoda`
- 页面内 `doubao.svg`：`https://lf3-static.bytednsdoc.com/obj/eden-cn/LMfspH/ljhwZthlaukjlkulzlp/miaoda-ui/doubao.svg`

页面头部那张 40×40 的站点 logo 与 favicon 是同一个文件（字节数一致），没有更高清版本。

处理脚本：`tools/logo-prep.py`。改参数后重跑即可重新生成透明版与各尺寸。

## 使用提醒

这是豆包的官方品牌标志，版权归字节跳动所有。本目录仅作本项目开发参考，正式对外发布前请确认使用授权与品牌规范。
