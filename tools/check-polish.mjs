/* 首页蓝图区 + 全站打磨自检（开发用）：node tools/check-polish.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });

// ---- 1. 首页 LP 区 ----
await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.querySelector(".lp__section").scrollIntoView());
await new Promise((r) => setTimeout(r, 900));
console.log(
  "lp:",
  await page.evaluate(() => {
    const foots = [...document.querySelectorAll(".lp__grid--tasks .lp__task-foot")];
    const bottoms = foots.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().bottom));
    return {
      moreLinks: [...document.querySelectorAll(".lp__more")].map((a) => a.textContent.trim()),
      footTexts: foots.map((el) => el.querySelector("span").textContent).slice(0, 2),
      footAligned: bottoms[0] === bottoms[1],
      tagBordered: getComputedStyle(document.querySelector(".lp__tag")).borderTopWidth === "1px",
      tickerLinks: document.querySelectorAll(".bookcover__ticker-link").length,
      lpFoot: !!document.querySelector(".lp__foot"),
    };
  })
);
await page.screenshot({ path: "tools/shots/polish-lp.png" });

// 蓝页页脚
await page.evaluate(() => document.querySelector(".lp__foot").scrollIntoView({ block: "end" }));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: "tools/shots/polish-lpfoot.png" });

// pinbar：往下滚再往回滚一点
await page.evaluate(() => window.scrollTo(0, 2000));
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => window.scrollTo(0, 1500));
await new Promise((r) => setTimeout(r, 500));
console.log(
  "pinbar on home:",
  await page.evaluate(() => document.getElementById("pinbar").dataset.show)
);

// ticker 链接可点：hover 暂停 + 点击触发翻页动画跳转
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 400));
const ticker = await page.$(".bookcover__ticker");
const tbox = await ticker.boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2); // hover 暂停轨道
await new Promise((r) => setTimeout(r, 300));
const paused = await page.evaluate(
  () => getComputedStyle(document.querySelector(".bookcover__ticker-track")).animationPlayState
);
const tickerHref = await page.evaluate(() => {
  // 找一条当前在视口里的链接点它
  const link = [...document.querySelectorAll(".bookcover__ticker-link")].find((a) => {
    const r = a.getBoundingClientRect();
    return r.left > 0 && r.right < innerWidth;
  });
  const href = link?.getAttribute("href");
  link?.click();
  return href;
});
await new Promise((r) => setTimeout(r, 900));
console.log(
  "ticker paused on hover:",
  paused,
  "| click:",
  tickerHref,
  "→",
  await page.evaluate(() => location.hash)
);

// ---- 2. 内页阅读进度条 ----
await new Promise((r) => setTimeout(r, 400));
console.log(
  "readbar:",
  await page.evaluate(() => {
    const fill = document.querySelector(".readbar__fill");
    if (!fill) return { present: false };
    window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2);
    return new Promise((resolve) =>
      setTimeout(
        () => resolve({ present: true, transform: getComputedStyle(fill).transform }),
        300
      )
    );
  })
);
await page.screenshot({ path: "tools/shots/polish-readbar.png" });

// ---- 3. 页脚签名 / kicker ----
await page.goto(`${ORIGIN}/#/intro`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));
console.log(
  "intro echo:",
  await page.evaluate(() => ({
    kickerSpacing: getComputedStyle(document.querySelector(".essay__kicker")).letterSpacing,
    footSig: document.querySelector(".foot__sig")?.textContent,
  }))
);

// ---- 4. 390px 小屏 LP ----
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.querySelector(".lp__section").scrollIntoView());
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "tools/shots/polish-lp-390.png", fullPage: false });
await page.evaluate(() => document.querySelector(".lp__grid--files").scrollIntoView());
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: "tools/shots/polish-lp-390b.png" });

await browser.close();
