/* 左侧目录收起/悬停展开自检（开发用）：node tools/check-rail2.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
const href = await page.evaluate(
  () => document.querySelector('.toc__row[href^="#/p/"]')?.getAttribute("href")
);
await page.goto(`${ORIGIN}/${href}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));

// 1. 展开态（默认）
console.log(
  "pinned:",
  await page.evaluate(() => ({
    collapsed: document.querySelector(".rail").classList.contains("is-collapsed"),
    counts: [...document.querySelectorAll(".rail__count")].map((el) => el.textContent),
    lists: document.querySelectorAll(".rail__list").length,
  }))
);
await page.screenshot({ path: "tools/shots/rail-pinned.png" });

// 2. 点收起 → 只剩小签
await page.click("[data-rail-collapse]");
await new Promise((r) => setTimeout(r, 300));
console.log(
  "collapsed:",
  await page.evaluate(() => ({
    collapsed: document.querySelector(".rail").classList.contains("is-collapsed"),
    fabVisible: getComputedStyle(document.querySelector(".rail__fab")).display !== "none",
    panelHidden: getComputedStyle(document.querySelector(".rail__panel")).visibility === "hidden",
    stored: localStorage.getItem("dwg.rail"),
  }))
);
await page.screenshot({ path: "tools/shots/rail-collapsed.png" });

// 3. 悬停小签 → 浮层展开
const fab = await page.$(".rail__fab");
const box = await fab.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await new Promise((r) => setTimeout(r, 400));
console.log(
  "hover:",
  await page.evaluate(() => ({
    panelVisible: getComputedStyle(document.querySelector(".rail__panel")).visibility === "visible",
  }))
);
await page.screenshot({ path: "tools/shots/rail-hover.png" });

// 4. 换一篇文章后仍是收起态（持久化）
await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
await page.goto(`${ORIGIN}/${href}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
console.log(
  "persisted:",
  await page.evaluate(() =>
    document.querySelector(".rail").classList.contains("is-collapsed")
  )
);

// 5. 悬停小签唤出浮层，点标题栏切换按钮 → 固定展开
const fab2 = await page.$(".rail__fab");
const box2 = await fab2.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
await new Promise((r) => setTimeout(r, 400));
await page.click("[data-rail-collapse]");
await new Promise((r) => setTimeout(r, 300));
console.log(
  "re-pinned:",
  await page.evaluate(() => ({
    collapsed: document.querySelector(".rail").classList.contains("is-collapsed"),
    stored: localStorage.getItem("dwg.rail"),
    toggleLabel: document.querySelector("[data-rail-collapse]").getAttribute("aria-label"),
  }))
);
await page.screenshot({ path: "tools/shots/rail-repinned.png" });

await browser.close();
