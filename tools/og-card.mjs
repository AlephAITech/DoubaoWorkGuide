/* 生成分享卡片（Open Graph 1200×630）：
   用站点自己的设计语言排一张卡，headless 截图存为 site/assets/og-cover.png。
   改文案后重跑：node tools/og-card.mjs */

import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = path.join(root, "site/assets/brand/doubao-mark-512.png");
const out = path.join(root, "site/assets/og-cover.png");

// setContent 的页面没有 file:// 源，本地图片会被拦，转成 data URL 内联
const logoData = `data:image/png;base64,${(await readFile(logo)).toString("base64")}`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 88px 96px 72px;
    background: #ffffff;
    font-family: Inter, "PingFang SC", "Hiragino Sans GB", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wordmark { display: flex; align-items: center; gap: 18px; }
  .wordmark img { width: 52px; height: 52px; }
  .wordmark span { font-size: 30px; font-weight: 600; color: #232323; letter-spacing: 0.01em; }
  .display {
    font-size: 74px; font-weight: 500; line-height: 1.42;
    letter-spacing: -0.01em; color: #232323;
  }
  .foot {
    display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid rgba(0, 0, 0, 0.1); padding-top: 28px;
    font-size: 24px; color: #a7a7a7; white-space: nowrap;
  }
</style></head>
<body>
  <div class="wordmark"><img src="${logoData}" alt=""><span>豆包工作蓝皮书</span></div>
  <p class="display">把豆包工作用起来，<br>从第一个能验收的任务开始。</p>
  <div class="foot">
    <span>49 篇真实任务 · 约 16.4 万字</span>
    <span>连接器 · Skill · API · 定时任务 · 多 Agent</span>
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle0" });
await page.screenshot({ path: out });
await browser.close();
console.log(`分享卡片 → ${out}`);
