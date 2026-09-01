/* 交流群弹层自检（开发用）：node tools/check-group.mjs */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1200));

// 点「交流群」弹出弹层（当前无二维码图，应显示待配置占位）
await page.click("[data-group]");
await new Promise((r) => setTimeout(r, 600));
console.log(
  await page.evaluate(() => ({
    open: document.querySelector(".groupbox")?.dataset.open,
    emptyShown: !document.querySelector(".groupbox__empty")?.hidden,
    imgHidden: document.querySelector(".groupbox__qr img")?.hidden,
  }))
);
await page.screenshot({ path: "tools/shots/groupbox.png" });

// Esc 关闭
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));
console.log("after esc:", await page.evaluate(() => document.querySelector(".groupbox")?.dataset.open));

// 再开一次，点背景关闭
await page.click("[data-group]");
await new Promise((r) => setTimeout(r, 400));
await page.mouse.click(80, 450);
await new Promise((r) => setTimeout(r, 400));
console.log("after backdrop:", await page.evaluate(() => document.querySelector(".groupbox")?.dataset.open));

await browser.close();
