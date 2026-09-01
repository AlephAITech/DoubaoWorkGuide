/* 移动端导航、横溢与低对比文字回归测试：node tools/check-mobile.mjs */
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";
const ARTICLE = "#/p/c9b3e7336132c19a";

function luminance([r, g, b]) {
  const channels = [r, g, b].map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastOnWhite(rgb) {
  return 1.05 / (luminance(rgb) + 0.05);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});

try {
  for (const width of [360, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: true });
    await page.goto(`${ORIGIN}/${ARTICLE}`, { waitUntil: "networkidle0" });

    const audit = await page.evaluate(() => {
      const rgb = (selector) => {
        const value = getComputedStyle(document.querySelector(selector)).color;
        return value.match(/\d+/g).slice(0, 3).map(Number);
      };
      const nav = document.querySelector(".masthead__chips").getBoundingClientRect();
      const chipHeights = [...document.querySelectorAll(".masthead__chips .chip")].map(
        (el) => Math.round(el.getBoundingClientRect().height)
      );
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        navRight: Math.ceil(nav.right),
        wordmarkTextDisplay: getComputedStyle(document.querySelector(".masthead .wordmark__name"))
          .display,
        chipHeights,
        where: rgb(".article__where"),
        meta: rgb(".article__meta"),
        toc: rgb(".pagetoc__list a"),
      };
    });

    console.log(JSON.stringify({ width, audit }, null, 2));

    assert.equal(audit.scrollWidth, audit.viewport, `${width}px 页面不应横向溢出`);
    assert.ok(audit.navRight <= audit.viewport, `${width}px 导航应完整留在视口内`);
    assert.equal(audit.wordmarkTextDisplay, "none", `${width}px 应只保留品牌图标`);
    assert.ok(audit.chipHeights.every((height) => height <= 44), `${width}px 导航文字不应换行`);
    for (const [name, rgb] of Object.entries({
      articleWhere: audit.where,
      articleMeta: audit.meta,
      pageToc: audit.toc,
    })) {
      assert.ok(contrastOnWhite(rgb) >= 3, `${width}px ${name} 对比度应至少达到 3:1`);
    }

    await page.evaluate(() => window.scrollTo(0, 1400));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.evaluate(() => window.scrollTo(0, 800));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const pinbar = await page.evaluate(() => {
      const bar = document.querySelector(".pinbar");
      const rect = bar.getBoundingClientRect();
      return {
        shown: bar.dataset.show,
        right: Math.ceil(rect.right),
        wordmarkTextDisplay: getComputedStyle(bar.querySelector(".wordmark__name")).display,
        chipHeights: [...bar.querySelectorAll(".chip")].map((el) =>
          Math.round(el.getBoundingClientRect().height)
        ),
      };
    });
    assert.equal(pinbar.shown, "true", `${width}px 向上滚动时应显示快捷导航`);
    assert.ok(pinbar.right <= audit.viewport, `${width}px 快捷导航应留在视口内`);
    assert.equal(pinbar.wordmarkTextDisplay, "none", `${width}px 快捷导航应只保留品牌图标`);
    assert.ok(pinbar.chipHeights.every((height) => height <= 44), `${width}px 快捷导航文字不应换行`);

    await page.goto(`${ORIGIN}/#/intro`, { waitUntil: "networkidle0" });
    const reveal = await page.evaluate(() => ({
      chunks: document.querySelectorAll(".reveal .rv").length,
      color: getComputedStyle(document.querySelector(".reveal--blue")).color,
    }));
    assert.equal(reveal.chunks, 0, `${width}px 不应启用逐字点亮拆分`);
    assert.notEqual(reveal.color, "rgb(200, 200, 200)", `${width}px 导读文字不应保持浅灰`);

    await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
    const cover = await page.evaluate(() => {
      const title = document.querySelector(".bookcover__title").getBoundingClientRect();
      const nav = document.querySelector(".bookcover__nav").getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        titleLeft: Math.floor(title.left),
        titleRight: Math.ceil(title.right),
        navRight: Math.ceil(nav.right),
      };
    });
    assert.equal(cover.scrollWidth, cover.viewport, `${width}px 首页不应横向溢出`);
    assert.ok(cover.titleLeft >= 0 && cover.titleRight <= cover.viewport, `${width}px 首页标题应完整显示`);
    assert.ok(cover.navRight <= cover.viewport, `${width}px 首页导航应完整显示`);

    console.log(JSON.stringify({ width, audit, pinbar, reveal, cover }, null, 2));
    await page.close();
  }
  console.log(JSON.stringify({ status: "PASS" }));
} finally {
  await browser.close();
}
