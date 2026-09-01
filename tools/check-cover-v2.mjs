/* 书封新元素自检（开发用）：node tools/check-cover-v2.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

// 桌面：入场完成 + 光斑跟随
await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2200));
await page.mouse.move(900, 350);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: "tools/shots/cover-v2.png" });

console.log(
  await page.evaluate(() => ({
    spine: !!document.querySelector(".bookcover__spine"),
    dimlines: document.querySelectorAll(".bookcover__dimline").length,
    tickerDuration: document.querySelector(".bookcover__ticker-track")?.style.animationDuration,
    lampTransform: document.querySelector(".bookcover__lamp")?.style.transform || "(none)",
    statsText: document.querySelector(".bookcover__stats")?.textContent.replace(/\s+/g, " ").trim(),
  }))
);

// 移动端
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: "tools/shots/cover-v2-mobile.png" });

await browser.close();
