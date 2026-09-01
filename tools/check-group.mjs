/* 交流群悬浮二维码回归测试：node tools/check-group.mjs */
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});
const page = await browser.newPage();

try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });

  const trigger = await page.$(".bookcover [data-group]");
  assert.ok(trigger, "页面应提供交流群入口");
  await trigger.click();
  await page.waitForSelector('.groupbox[data-open="true"]');
  await page.waitForFunction(
    () => document.querySelector(".groupbox img")?.naturalWidth > 0
  );

  const opened = await page.evaluate(() => {
    const box = document.querySelector(".groupbox");
    const image = box?.querySelector("img");
    const rect = box?.getBoundingClientRect();
    return {
      bodyLocked: document.body.classList.contains("is-locked"),
      ariaModal: box?.getAttribute("aria-modal"),
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0),
      imageVisible: !!image && !image.hidden && image.complete && image.naturalWidth > 0,
      imageSrc: image?.getAttribute("src"),
    };
  });

  assert.equal(opened.bodyLocked, false, "悬浮二维码不应锁定页面滚动");
  assert.notEqual(opened.ariaModal, "true", "悬浮二维码不应声明为模态弹层");
  assert.ok(opened.width <= 280 && opened.height <= 280, "悬浮层不应覆盖整个视口");
  assert.equal(opened.imageVisible, true, "二维码图片应成功显示");
  assert.match(
    opened.imageSrc || "",
    /^assets\/qr-group\.png\?v=.+/,
    "二维码应使用带版本号的站内资源，避免内置浏览器继续显示旧缓存"
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector(".groupbox")?.dataset.open === "false"
  );

  await trigger.click();
  await page.waitForSelector('.groupbox[data-open="true"]');
  await page.mouse.click(60, 420);
  await page.waitForFunction(
    () => document.querySelector(".groupbox")?.dataset.open === "false"
  );

  console.log(JSON.stringify({ status: "PASS", opened }, null, 2));
} finally {
  await browser.close();
}
