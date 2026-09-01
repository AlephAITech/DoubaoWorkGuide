/* 书封下方落地版块自检（开发用）：node tools/check-lp.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));

console.log(
  await page.evaluate(() => ({
    tasks: document.querySelectorAll(".lp__task").length,
    files: document.querySelectorAll(".lp__file").length,
    cta: !!document.querySelector(".lp__cta"),
  }))
);

// 滚到推荐任务
await page.evaluate(() => document.querySelector(".lp__grid--tasks").scrollIntoView({ block: "center" }));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "tools/shots/lp-tasks.png" });

// 滚到 INDEX 档案卡
await page.evaluate(() => document.querySelector(".lp__grid--files").scrollIntoView({ block: "center" }));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "tools/shots/lp-files.png" });

// 底部 CTA
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "tools/shots/lp-cta.png" });

// 点任务卡应直接跳文章（不在书封内，无翻页动画）
const href = await page.evaluate(() => document.querySelector(".lp__task").getAttribute("href"));
await page.click(".lp__task");
await new Promise((r) => setTimeout(r, 500));
console.log("task href:", href, "→ hash:", await page.evaluate(() => location.hash));

await browser.close();
