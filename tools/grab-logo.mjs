/**
 * 渲染目标页面并列出其中的图片与 SVG 资源（开发用）
 *
 *   node tools/grab-logo.mjs "https://example.com"
 */

import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.argv[2];

if (!url) {
  console.error("用法：node tools/grab-logo.mjs <url>");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--disable-gpu", "--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => {
  console.error("导航失败：", e.message);
});
await new Promise((r) => setTimeout(r, 2500));

const found = await page.evaluate(() => {
  const images = [...document.querySelectorAll("img")].map((el) => ({
    kind: "img",
    src: el.currentSrc || el.src,
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    alt: el.alt || "",
  }));
  const svgs = [...document.querySelectorAll("svg")].slice(0, 10).map((el) => ({
    kind: "svg",
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    outer: el.outerHTML.slice(0, 300),
  }));
  const backgrounds = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, bg: getComputedStyle(el).backgroundImage }))
    .filter((item) => item.bg && item.bg.includes("url("))
    .slice(0, 12)
    .map((item) => ({
      kind: "bg",
      src: item.bg.match(/url\(["']?([^"')]+)/)?.[1] || "",
      w: Math.round(item.el.getBoundingClientRect().width),
      h: Math.round(item.el.getBoundingClientRect().height),
    }));
  return {
    title: document.title,
    icon: document.querySelector('link[rel~="icon"]')?.href || "",
    ogImage: document.querySelector('meta[property="og:image"]')?.content || "",
    assets: [...images, ...backgrounds, ...svgs],
  };
});

await page.screenshot({ path: "tools/shots/target-page.png" });
await browser.close();

console.log(JSON.stringify(found, null, 2));
