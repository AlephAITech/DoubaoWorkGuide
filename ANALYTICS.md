# 豆包私有访问统计

当前工作在 `codex/private-analytics`。**用户确认前不得合并 main、修改 doubaowork.homes 路由或替换正式部署。**

## 先在本地验收

需要 Node.js 22.17+（支持 node:sqlite）和 Google Chrome。

```sh
npm ci
npm run analytics:setup
npm run analytics:dev
```

访问 `http://localhost:8787/admin/analytics`。管理员账号密码在 `.secrets/local-login.txt`，不要将此文件上传或放入公开截图。

本地运行真实 Workers runtime、D1/SQLite 和 Durable Object；本地环回地址才允许跳过 Turnstile。这个跳过开关在任何公开域名都不生效。浏览页面会采集本地数据，登录管理员后不再统计自身访问。

```sh
npm run analytics:test
npm run analytics:build
npm run analytics:browser  # 保持本地 analytics:dev 运行；会产生本地测试数据
```

现有网站回归需要在另一个终端运行 `npm run serve`，再运行 `npm test` 和 `npm run audit`。静态界面审计使用浏览器 GPC 退出采集，保留原有错误检查；独立浏览器测试连接完整 Worker 验证采集与故障下的阅读。这些验证不代表云端部署通过。

## 给 Cloudflare 账户所有者的预览部署步骤

网站维护者没有 Cloudflare 账户凭据。可由账户所有者执行以下步骤，或邀请维护者的独立账户并授予必要权限；不要共享账户密码。账户所有者具有底层数据/代码管理权限，网页登录只限管理员并不能限制托管账户所有者。如需此级别隔离，应把统计服务放在维护者自己的账户。

1. 获取 `codex/private-analytics` 分支（仓库 `https://github.com/AlephAITech/DoubaoWorkGuide`），运行 `npm ci`。执行 `npx wrangler login` 登录账户。**不切换或合并 main。**
2. 在 Workers & Pages 确认自己的 Workers 子域名。本次 Worker 固定命名 `doubao-analytics-preview`，预览主机形式为 `doubao-analytics-preview.你的子域名.workers.dev`，不绑定正式域名。
3. 新建独立 D1，记录输出的 database ID。若同名已存在，核实是否属于本次预览；不要删除或覆盖既有数据：

```sh
npx wrangler d1 create doubao-analytics-preview --location apac
```

4. 在 Cloudflare Turnstile 创建 Managed widget，**只允许上述预览主机**。记录公开 site key 和私密 secret key。这个组件用于管理员登录和可疑访问的验证，不使用测试密钥。
5. 用账户 ID、独立 D1 ID、预览主机及公开 site key 生成专用配置（替换下面四个值）：

```sh
node tools/analytics/configure-preview.mjs --account-id ACCOUNT_ID --database-id DATABASE_ID --host doubao-analytics-preview.SUBDOMAIN.workers.dev --site-key TURNSTILE_SITE_KEY
npm run analytics:prepare
npx wrangler d1 migrations apply DB --remote --config wrangler.analytics.preview.json
```

6. 由统计后台的使用者运行 `node tools/analytics/credentials.mjs --preview`，自己保留 `.secrets/preview-login.txt` 中的密码。将 `.secrets/preview-secrets.json` 通过私有渠道交给部署者；文件含密码哈希及服务端密钥，不含明文登录密码，**不得提交到 Git、放入公开下载包或群聊**。已有文件不会被工具覆盖。
7. 部署预览代码、导入 Secrets，然后交互式输入 Turnstile secret key。初次部署在秘密配置齐全前会拒绝采集和登录，不会公开后台：

```sh
npx wrangler deploy --config wrangler.analytics.preview.json
npx wrangler secret bulk .secrets/preview-secrets.json --config wrangler.analytics.preview.json
npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.analytics.preview.json
```

8. 打开输出预览 URL，完成真实 Turnstile 登录。确认 `/api/admin/report` 和 `/api/admin/export` 未登录返回 401、已登录可读、退出后旧会话不可用；用另一个浏览器访问首页及两篇文章，确认后台增加对应的 PV，UV/IP 正确去重。测试只是该预览库的数据，不会影响正式站。
9. 将预览 URL 发给网站维护者验收。**到这里停止；不得合并 main 或配置正式路由。**

部署会上传约 450 MB 的当前公开站点资源；原有页面仍由静态资源服务直接处理，仅 `/api/*`、`/admin*`、`/privacy*` 进入 Worker。为预览单独添加 noindex。云端 Worker、D1、Durable Objects 配额均按账户计算；代码的请求/事件预算不是账单的硬上限，不会自动购买付费方案。

## 数据口径与保护

- PV = 服务端接受的有效格式页面事件（含标记可疑）；一个浏览器同一 event ID 重试只计一次。计数通过 D1 唯一键和 SQL 触发器原子更新，禁止先读后写计数。
- 有效 PV、UV、独立 IP 排除标记可疑事件。匿名访客 Cookie 由服务端签名，IP 仅采用 Cloudflare `CF-Connecting-IP`；IPv6 规范化，HMAC 去重，原始 IP AES-GCM 加密。若账户启用 Pseudo IPv4 Overwrite Headers，需显式配置 `PSEUDO_IPV4=overwrite`。
- UV 是浏览器估计，IP 是网络出口；Cookie 清理/设备切换/IP 池仍会影响数值，不能当自然人数或保证无机器人。
- 北京时间日界线（包括每日采集预算）。近 90 天可任意选择区间，UV/IP 对整个区间去重，不累加日值。首页/文章切换从前端成功渲染采集，图片、JSON、脚本请求不算 PV。Global Privacy Control 用户和在 `/privacy` 主动退出的浏览器不采集。
- 事件明细/去重标识 90 天，日汇总 12 个月，累计 PV 单独保存；IP 访问明细严格限制为最近 7×24 小时且默认脱敏，更早事件不会因同一 IP 再次访问而重新关联完整 IP。每天北京时间 03:25 清理，API 即使尚未清理也拒绝查看超过 7 天的完整 IP。
- 管理员随机 256-bit 密码；PBKDF2-SHA256 100,000 次（Workers Web Crypto 上限）。会话服务端保存、8 小时过期、退出撤销，Cookie 为 Secure/HttpOnly/SameSite。没有注册、弱密码设置或公开统计 API。
- Turnstile 在服务端验证 hostname/action；令牌不可重放。管理员和采集使用不同 action。生产/预览缺失密钥、DB 或限流绑定时拒绝访问，不降级成免登录。
- 所有上报经过全局 Durable Object。默认全站每分钟请求上限 1200；放行事件上限每分钟 300、每天 5000；单访客每分钟超过 30 次触发挑战，超过 90 次拒绝；全站事件达到分钟预算一半时新未验证流量触发挑战。阈值是首版保护值，正式上线按实际访问基线调整，预算包含允许到数据库的重试。
- 挑战/拒绝请求不消耗日事件预算；计数器饱和后停止重复写入，异常日志每原因每分钟采样一次。到达 Worker/DO 的拒绝请求仍可能产生请求和读取费用，边缘 WAF 是另一层必要保护。
- 网站请求总量、WAF 已拦截请求和安全事件目前**未接入**本数据库。后台提供 Cloudflare 面板入口，不用零值伪装已接入。静态正文为公开 JSON，限流不代表防复制。

## 合并批准之后的正式部署

正式部署由账户所有者配置独立 Worker、D1、管理员密钥和正式域名 Turnstile widget，不能复用预览数据或测试开关。先核对域名代理和现有 Pages/Worker 路由，然后仅为 `/api/analytics/*`、`/api/admin/*`、`/admin*`、`/privacy*` 添加对应 Worker 路由；普通页面和资源继续走原有 Pages。正式域名默认入口必须禁用或同等鉴权，预览域名使用隔离环境。

在账户可用套餐内为登录/采集接口配置边缘请求限流，对公开内容的高频读取另外设置规则；单 IP 不能代替跨会话行为监测。Bot Management 高级评分、完整边缘日志和高级计数维度依套餐而定，不在免费版中假定存在。先观察误伤和实际额度再调整，不直接全站启用高强度挑战。

只有管理员确认预览后，才合并并让 Pages 发布前端采集脚本。上线前后都回读新版本和真实统计；后台接口不可用时正文仍正常显示。回滚前端时保留 D1 数据，移除新增路由可恢复原有静态入口。
