/* 搜索与继续阅读的交互自检（开发用）：node tools/check-features.mjs */

import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await page.waitForSelector("#app:not([hidden])");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. ⌘K 打开搜索，输入关键词
await page.keyboard.down("Meta");
await page.keyboard.press("k");
await page.keyboard.up("Meta");
await wait(200);
console.log("搜索打开:", await page.$eval("#search", (el) => el.dataset.open));

await page.type("#search-input", "定时任务");
await wait(200);
const results = await page.$$eval("#search-results .search__item", (items) =>
  items.slice(0, 3).map((item) => item.querySelector(".search__item-title")?.textContent.trim())
);
console.log("结果条数与前三条:", results.length ? results : "无");
console.log("提示行:", await page.$eval("#search-hint", (el) => el.textContent));

// 2. 方向键 + 回车打开第二条
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await wait(500);
console.log("回车后路由:", await page.evaluate(() => location.hash));
console.log("搜索已关:", await page.$eval("#search", (el) => el.dataset.open));

// 3. 滚一段距离，回封面看「继续阅读」
await page.evaluate(() => window.scrollTo(0, 1800));
await wait(900); // 等 600ms 的记录节流
const saved = await page.evaluate(() => localStorage.getItem("dwg.resume"));
console.log("记录的位置:", saved);

await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await wait(300);
const resume = await page.$eval(".resume__link", (el) => el.textContent).catch(() => "（没有出现）");
console.log("封面继续阅读:", resume);

// 4. 点继续阅读，验证滚动位置恢复
await page.click(".resume__link");
await wait(600);
console.log("恢复后 scrollY:", await page.evaluate(() => window.scrollY));

// 5. 目录页进度行
await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
await wait(300);
console.log("目录页首行:", await page.$eval(".toc .body-text", (el) => el.textContent.replace(/\s+/g, " ").trim()));

await browser.close();
