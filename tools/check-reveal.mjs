/**
 * 验证封面逐字点亮与回流条（开发用）
 *
 *   node tools/check-reveal.mjs
 */

import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle2" });
await page.waitForSelector("#app:not([hidden])");
await new Promise((r) => setTimeout(r, 400));

const read = () =>
  page.evaluate(() => ({
    chunks: document.querySelectorAll(".rv").length,
    lit: document.querySelectorAll(".rv.lit").length,
    pinbar: document.getElementById("pinbar")?.dataset.show,
  }));

const scroll = async (y) => {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await new Promise((r) => setTimeout(r, 350));
};

console.log("top      ", JSON.stringify(await read()));
await scroll(600);
console.log("y=600    ", JSON.stringify(await read()));
await scroll(1400);
console.log("y=1400   ", JSON.stringify(await read()));
await scroll(900); // 往回滚，回流条应出现
console.log("back=900 ", JSON.stringify(await read()));
await scroll(1500); // 再往下，回流条应收起
console.log("down=1500", JSON.stringify(await read()));

await browser.close();
