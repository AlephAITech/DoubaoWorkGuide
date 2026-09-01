/* 左侧章节目录 + 落地版块升级自检（开发用）：node tools/check-rail.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

// ---- 1. 内页左侧目录 ----
await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
const href = await page.evaluate(
  () => document.querySelector('.toc__row[href^="#/p/"]')?.getAttribute("href")
);
await page.goto(`${ORIGIN}/${href}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));
console.log("测试文章:", href);
console.log(
  await page.evaluate(() => {
    const rail = document.querySelector(".rail");
    return {
      railVisible: rail && getComputedStyle(rail).display !== "none",
      parts: document.querySelectorAll(".rail__part").length,
      openParts: document.querySelectorAll(".rail__part[open]").length,
      openGroups: document.querySelectorAll(".rail__group[open]").length,
      current: rail?.querySelector(".is-current")?.textContent?.trim(),
      links: document.querySelectorAll(".rail__link").length,
    };
  })
);
await page.screenshot({ path: "tools/shots/rail-doc.png" });

// 点开一个收起的部分，再点其中一篇，确认路由与自动展开切换
const jumped = await page.evaluate(() => {
  const closed = [...document.querySelectorAll(".rail__part:not([open])")][0];
  if (!closed) return null;
  closed.querySelector(".rail__sum").click();
  const link = closed.querySelector(".rail__link");
  const target = link?.getAttribute("href");
  link?.click();
  return target;
});
await new Promise((r) => setTimeout(r, 500));
console.log("跳转到:", jumped, "| 当前 hash:", await page.evaluate(() => location.hash));
console.log(
  "跳转后自动展开:",
  await page.evaluate(() => ({
    openParts: document.querySelectorAll(".rail__part[open]").length,
    current: document.querySelector(".rail .is-current")?.textContent?.trim(),
  }))
);
await page.screenshot({ path: "tools/shots/rail-doc-2.png" });

// 窄屏：rail 隐藏
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 300));
console.log(
  "1200px rail 隐藏:",
  await page.evaluate(
    () => getComputedStyle(document.querySelector(".rail")).display === "none"
  )
);

// ---- 2. 落地版块升级 ----
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await page.evaluate(() => {
  document.querySelector(".lp__section").scrollIntoView();
});
await new Promise((r) => setTimeout(r, 900));
console.log(
  await page.evaluate(() => ({
    stamps: document.querySelectorAll(".lp__stamp").length,
    hatch: !!document.querySelector(".lp__hatch"),
    side: !!document.querySelector(".lp__side"),
    fileN: document.querySelector(".lp__file")?.dataset.n,
    ctaKicker: !!document.querySelector(".lp__cta-kicker"),
    taskCols: getComputedStyle(document.querySelector(".lp__grid--tasks")).gridTemplateColumns.split(" ").length,
  }))
);
await page.screenshot({ path: "tools/shots/lp-tasks.png" });
await page.evaluate(() => document.querySelector(".lp__grid--files").scrollIntoView({ block: "center" }));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "tools/shots/lp-files.png" });

await browser.close();
