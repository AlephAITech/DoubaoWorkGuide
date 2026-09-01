/**
 * 指定路由滚到指定位置截图（开发用）
 *
 *   node tools/peek.mjs "#/" 300 cover-mid [up]
 */

import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const [hash = "#/", yArg = "0", name = "peek", upFlag] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${ORIGIN}/${hash}`, { waitUntil: "networkidle2" });
await page.waitForSelector("#app:not([hidden])");
await new Promise((r) => setTimeout(r, 500));

const y = Number(yArg);
if (upFlag === "up") {
  await page.evaluate((v) => window.scrollTo(0, v + 600), y);
  await new Promise((r) => setTimeout(r, 250));
}
await page.evaluate((v) => window.scrollTo(0, v), y);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `tools/shots/${name}.png` });
await browser.close();
console.log("saved", name);
