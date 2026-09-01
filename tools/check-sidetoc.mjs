/* 侧边目录自检（开发用）：node tools/check-sidetoc.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

// 找一篇有侧边目录的文章
await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
const hrefs = await page.evaluate(() =>
  [...document.querySelectorAll(".toc__row")].map((a) => a.getAttribute("href"))
);
let found = null;
for (const href of hrefs) {
  await page.goto(`${ORIGIN}/${href}`, { waitUntil: "networkidle0" });
  if (await page.$(".sidetoc")) {
    found = href;
    break;
  }
}
if (!found) {
  console.log("没有找到带侧边目录的文章");
  process.exit(1);
}
console.log("测试文章:", found);

// 顶部：侧边目录可见、页首列表隐藏
console.log(
  await page.evaluate(() => ({
    sideVisible: getComputedStyle(document.querySelector(".sidetoc")).display !== "none",
    pagetocHidden:
      !document.querySelector(".pagetoc") ||
      getComputedStyle(document.querySelector(".pagetoc")).display === "none",
    items: document.querySelectorAll(".sidetoc__list a").length,
  }))
);

// 滚到中部，看高亮
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
await new Promise((r) => setTimeout(r, 400));
console.log(
  "active at 45%:",
  await page.evaluate(() => document.querySelector(".sidetoc__list a.is-active")?.textContent)
);
await page.screenshot({ path: "tools/shots/sidetoc.png" });

// 点最后一条，确认滚过去且高亮跟上
await page.evaluate(() => {
  const links = document.querySelectorAll(".sidetoc__list a");
  links[links.length - 1].click();
});
await new Promise((r) => setTimeout(r, 900));
console.log(
  "after click last:",
  await page.evaluate(() => document.querySelector(".sidetoc__list a.is-active")?.textContent)
);

// 窄屏回退：侧边目录隐藏，页首列表出现
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 300));
console.log(
  await page.evaluate(() => ({
    sideHiddenNarrow: getComputedStyle(document.querySelector(".sidetoc")).display === "none",
    pagetocShownNarrow: getComputedStyle(document.querySelector(".pagetoc")).display !== "none",
  }))
);

await browser.close();
