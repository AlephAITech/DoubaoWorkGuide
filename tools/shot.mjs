/**
 * 本地预览截图与自检脚本（开发用，不属于站点内容）
 *
 *   node tools/shot.mjs                     # 默认几个页面 + 视口
 *   node tools/shot.mjs "#/p/xxxx" 430      # 指定路由与宽度
 */

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";
const OUT = "tools/shots";

const targets = process.argv[2]
  ? [{ name: "custom", hash: process.argv[2], width: Number(process.argv[3] || 1440) }]
  : [
      { name: "home-desktop", hash: "#/", width: 1440 },
      { name: "doc-desktop", hash: "#/p/c9b3e7336132c19a", width: 1440 },
      { name: "toc-desktop", hash: "#/toc", width: 1440 },
      { name: "home-mobile", hash: "#/", width: 430 },
      { name: "doc-mobile", hash: "#/p/46d9abfe47e97b62", width: 430 },
    ];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});

const report = [];

for (const target of targets) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewport({ width: target.width, height: target.width < 700 ? 930 : 1000 });
  await page.goto(`${ORIGIN}/${target.hash}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#app:not([hidden])", { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  const audit = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowing = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > de.clientWidth + 1;
      })
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 46) || "",
        right: Math.round(el.getBoundingClientRect().right),
      }));
    return {
      viewport: de.clientWidth,
      scrollWidth: de.scrollWidth,
      overflowing,
    };
  });

  await page.screenshot({ path: `${OUT}/${target.name}.png` });
  report.push({ name: target.name, errors, ...audit });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
