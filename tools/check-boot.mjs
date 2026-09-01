/* 首屏原子渲染回归测试：node tools/check-boot.mjs */
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
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/content/site-content.json")) {
      setTimeout(() => request.continue(), 1000);
      return;
    }
    request.continue();
  });

  await page.goto(`${ORIGIN}/#/`, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const loading = await page.evaluate(() => ({
    bodyVisibility: getComputedStyle(document.body).visibility,
    booting: document.body.classList.contains("is-booting"),
    coverCount: document.querySelectorAll(".bookcover").length,
    appHidden: document.getElementById("app")?.hidden,
  }));

  assert.equal(loading.booting, true, "JSON 未完成时页面应保持启动状态");
  assert.equal(loading.bodyVisibility, "hidden", "JSON 未完成时整页应隐藏，避免蓝色封面频闪");
  assert.equal(loading.coverCount, 0, "首个 HTML 不应预绘静态蓝色封面");
  assert.equal(loading.appHidden, true, "JSON 未完成时应用内容不应露出");

  await page.waitForFunction(
    () => !document.body.classList.contains("is-booting") && document.querySelectorAll(".bookcover").length === 1,
    { timeout: 5000 }
  );

  const ready = await page.evaluate(() => ({
    bodyVisibility: getComputedStyle(document.body).visibility,
    coverCount: document.querySelectorAll(".bookcover").length,
    appHidden: document.getElementById("app")?.hidden,
    title: document.querySelector(".bookcover__title")?.textContent,
  }));

  assert.equal(ready.bodyVisibility, "visible", "JSON 完成后整页应一次显示");
  assert.equal(ready.coverCount, 1, "完整首页只应存在一个封面");
  assert.equal(ready.appHidden, false, "JSON 完成后应用内容应显示");
  assert.equal(ready.title, "豆包工作蓝皮书", "完整首页标题应正确渲染");

  console.log(JSON.stringify({ status: "PASS", loading, ready }, null, 2));
} finally {
  await browser.close();
}
