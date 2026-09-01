/* 书封动效自检（开发用）：node tools/check-cover-motion.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

// 1. 进场中段（约 400ms）：标题应正在逐字升起
await page.goto(`${ORIGIN}/#/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".bc-ch");
await new Promise((r) => setTimeout(r, 320));
await page.screenshot({ path: "tools/shots/cover-enter-mid.png" });

// 2. 进场完成
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: "tools/shots/cover-enter-done.png" });
const chars = await page.evaluate(() => document.querySelectorAll(".bc-ch").length);
console.log("title chars:", chars);

// 3. 视差：把指针移到右下角，网格应向左上偏移
await page.mouse.move(1300, 800);
await new Promise((r) => setTimeout(r, 200));
console.log(
  "grid transform:",
  await page.evaluate(() => document.querySelector(".bookcover__grid").style.transform)
);

// 4. 点「开始阅读」→ 翻页中段截一帧，最后确认跳到 #/intro
await page.click(".bcbtn--solid");
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: "tools/shots/cover-open-mid.png" });
await new Promise((r) => setTimeout(r, 700));
console.log("hash after open:", await page.evaluate(() => location.hash));
console.log("essay shown:", await page.evaluate(() => !!document.querySelector(".page.cover")));

await browser.close();
