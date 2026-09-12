/** 全站严格审计：node tools/audit-site.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";
const ROOT = process.cwd();
const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "site/content/site-content.json"), "utf8"));

assert.equal(payload.documents.length, payload.nodeCount, "nodeCount 应与 documents 数量一致");
assert.equal(new Set(payload.documents.map((doc) => doc.nodeToken)).size, payload.documents.length, "节点 token 不得重复");

const tokens = new Set(payload.documents.map((doc) => doc.nodeToken));
const missingParents = payload.documents.filter((doc) => doc.parentToken && !tokens.has(doc.parentToken));
assert.deepEqual(missingParents, [], "所有非根节点都应指向存在的父节点");

const media = payload.documents.flatMap((doc) => [
  ...(doc.images || []).map((item) => ({ title: doc.title, localPath: item.localPath })),
  ...(doc.videos || []).map((item) => ({ title: doc.title, localPath: item.localPath })),
]);
const missingMedia = media.filter((item) => !fs.existsSync(path.join(ROOT, "site", item.localPath)));
assert.deepEqual(missingMedia, [], "正文引用的媒体文件必须全部存在");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});

try {
  const home = await browser.newPage();
  await home.setViewport({ width: 1440, height: 900 });
  const homeRequests = [];
  await home.setRequestInterception(true);
  home.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    homeRequests.push(pathname);
    if (pathname.endsWith("/content/site-content.json")) {
      setTimeout(() => request.continue(), 3000);
      return;
    }
    request.continue();
  });
  await home.goto(`${ORIGIN}/#/`, { waitUntil: "domcontentloaded" });
  await home.waitForSelector("#app:not([hidden])", { timeout: 1800 });
  assert.ok(homeRequests.includes("/content/site-index.json"), "首页应先请求轻量索引");
  assert.ok(!homeRequests.includes("/js/vendor/qrcode.js"), "首页启动不应请求二维码库");
  assert.equal(await home.$eval("#search-input", (input) => input.getAttribute("role")), "combobox", "搜索输入应声明组合框语义");
  assert.equal(await home.$eval("#search-input", (input) => input.getAttribute("aria-controls")), "search-results", "搜索输入应关联结果列表");

  const homeVisibility = await home.evaluate(() => {
    const cards = [...document.querySelectorAll(".lp__card")];
    const offscreen = cards.find((card) => card.getBoundingClientRect().top > innerHeight);
    return {
      offscreenOpacity: offscreen ? getComputedStyle(offscreen).opacity : null,
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(homeVisibility.offscreenOpacity, "1", "视口外首页卡片也必须默认可见");
  assert.equal(homeVisibility.scrollWidth, homeVisibility.viewport, "桌面首页不得横向溢出");

  const article = await browser.newPage();
  // Static UI regression opts out of collection; analytics has its own runtime tests.
  await article.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  await article.setViewport({ width: 1440, height: 900 });
  const errors = [];
  const articleRequests = [];
  article.on("request", (request) => articleRequests.push(new URL(request.url()).pathname));
  article.on("pageerror", (error) => errors.push(error.message));
  article.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await article.goto(`${ORIGIN}/#/p/5828287b3f6d6835`, { waitUntil: "networkidle0" });
  await article.waitForSelector(".article__body-frame");
  const frame = await article.evaluate(() => {
    const element = document.querySelector(".article__body-frame");
    const heading = element.querySelector(".prose h2");
    const style = getComputedStyle(element);
    return {
      borderLeft: style.borderLeftWidth,
      borderRight: style.borderRightWidth,
      headingNumber: heading ? getComputedStyle(heading, "::before").content : "",
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(frame.borderLeft, "1px", "正文图框应有左规线");
  assert.equal(frame.borderRight, "1px", "正文图框应有右规线");
  assert.notEqual(frame.headingNumber, "none", "二级标题应显示章节编号");
  assert.equal(frame.scrollWidth, frame.viewport, "桌面正文不得横向溢出");
  assert.deepEqual(errors, [], "正文路由不得产生控制台错误");

  await article.click("[data-share]");
  await article.waitForSelector('.sharebox[data-open="true"]', { timeout: 5000 });
  assert.ok(articleRequests.includes("/js/vendor/qrcode.js"), "首次生成分享卡片时应按需加载二维码库");
  assert.equal(await article.$$eval("[data-card-link]", (items) => items.length), 1, "分享弹层只应有一个复制链接按钮");
  await article.keyboard.press("Escape");

  const routeResults = [];
  for (const doc of payload.documents.filter((item) => item.depth > 0)) {
    const id = doc.nodeToken.replace(/^doc-/, "");
    await article.evaluate((next) => {
      location.hash = `#/p/${next}`;
    }, id);
    await article.waitForFunction((title) => document.title.startsWith(title), { timeout: 3000 }, doc.title);
    routeResults.push(
      await article.evaluate((title) => ({
        title,
        hasErrorState: document.querySelector(".state") !== null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }), doc.title)
    );
  }
  assert.deepEqual(routeResults.filter((item) => item.hasErrorState), [], "全部内容路由都应可渲染");
  assert.deepEqual(routeResults.filter((item) => item.overflow), [], "全部桌面内容路由都不应横向溢出");

  await article.setViewport({ width: 390, height: 844, isMobile: true });
  await article.goto(`${ORIGIN}/#/p/5828287b3f6d6835`, { waitUntil: "networkidle0" });
  const mobile = await article.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    frame: document.querySelector(".article__body-frame")?.getBoundingClientRect().toJSON(),
  }));
  assert.equal(mobile.scrollWidth, mobile.viewport, "390px 正文不得横向溢出");
  assert.ok(mobile.frame && mobile.frame.left >= 0 && mobile.frame.right <= mobile.viewport, "移动端内容图框应完整留在视口内");

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        nodes: payload.documents.length,
        routes: routeResults.length,
        media: media.length,
        homeRequests,
        homeVisibility,
        frame,
        mobile,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
