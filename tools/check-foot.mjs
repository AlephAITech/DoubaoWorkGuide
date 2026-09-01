/* 内页结尾与页脚的截图自检（开发用）：node tools/check-foot.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

// 内页封面拉到底
await page.goto(`${ORIGIN}/#/intro`, { waitUntil: "networkidle0" });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: "tools/shots/intro-foot.png" });

// 正文页页脚
await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: "tools/shots/toc-foot.png" });

await browser.close();
console.log("done");
