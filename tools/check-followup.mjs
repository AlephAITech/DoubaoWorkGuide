/** 分享反馈、文末换行与首页页脚回归：node tools/check-followup.mjs */
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:4173";
const ARTICLE = `${ORIGIN}/#/p/5828287b3f6d6835`;

function parseColor(value) {
  const parts = value.match(/[\d.]+/g).map(Number);
  if (value.startsWith("color(srgb")) {
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts[3] ?? 1 };
  }
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function composite(foreground, background) {
  return ["r", "g", "b"].map((key) =>
    Math.round(foreground[key] * foreground.a + background[key] * (1 - foreground.a))
  );
}

function luminance(rgb) {
  const channels = rgb.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--hide-scrollbars", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  // Static UI regression opts out of collection; analytics has its own runtime tests.
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    requests.push(pathname);
    if (pathname.endsWith("/js/vendor/qrcode.js")) {
      setTimeout(() => request.continue(), 1400);
      return;
    }
    request.continue();
  });

  await page.goto(ARTICLE, { waitUntil: "networkidle0" });
  await page.click("[data-share]");
  await new Promise((resolve) => setTimeout(resolve, 120));

  const immediateShare = await page.evaluate(() => ({
    exists: Boolean(document.querySelector(".sharebox")),
    open: document.querySelector(".sharebox")?.dataset.open,
    state: document.querySelector(".sharebox")?.dataset.state,
    status: document.querySelector(".sharebox__status")?.textContent.trim(),
    bodyLocked: document.body.classList.contains("is-locked"),
  }));
  assert.deepEqual(
    immediateShare,
    {
      exists: true,
      open: "true",
      state: "loading",
      status: "正在生成分享卡片与二维码…",
      bodyLocked: true,
    },
    "点击分享后应立即打开弹层并显示二维码生成状态"
  );

  await page.waitForFunction(
    () => document.querySelector(".sharebox")?.dataset.state === "ready",
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () => document.querySelector(".sharebox__img")?.complete && document.querySelector(".sharebox__img")?.naturalWidth > 0,
    { timeout: 3000 }
  );
  const readyShare = await page.evaluate(() => ({
    state: document.querySelector(".sharebox")?.dataset.state,
    status: document.querySelector(".sharebox__status")?.textContent.trim(),
    imageWidth: document.querySelector(".sharebox__img")?.naturalWidth,
    imageSrc: document.querySelector(".sharebox__img")?.src.slice(0, 22),
    downloadDisabled: document.querySelector("[data-card-download]")?.disabled,
  }));
  assert.equal(readyShare.state, "ready", "二维码与分享卡片生成后应进入完成状态");
  assert.match(readyShare.status || "", /二维码已生成/, "完成状态应明确告知二维码已经生成");
  assert.ok(readyShare.imageWidth > 0, "分享卡片图片应成功解码并可见");
  assert.equal(readyShare.imageSrc, "data:image/png;base64,", "分享卡片应为可发送的 PNG 图片");
  assert.equal(readyShare.downloadDisabled, false, "卡片生成后应恢复下载按钮");
  assert.ok(requests.includes("/js/vendor/qrcode.js"), "首次分享应加载二维码组件");
  assert.deepEqual(errors, [], "分享流程不得产生控制台错误");
  await page.keyboard.press("Escape");

  const articleTail = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {
      next: rect(".nextlink"),
      previous: rect(".article__previous"),
      actions: rect(".article__tail-actions"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  assert.ok(articleTail.previous && articleTail.actions, "文末应分别提供上一节行和目录/分享操作行");
  assert.ok(
    articleTail.previous.top >= articleTail.next.bottom + 24,
    "上一节应在下一节标题之后另起一行"
  );
  assert.ok(
    articleTail.actions.top >= articleTail.previous.bottom + 12,
    "目录与分享应在上一节之后另起一行"
  );
  assert.equal(articleTail.overflow, false, "文末换行后移动端不得横向溢出");

  await page.goto(`${ORIGIN}/#/`, { waitUntil: "networkidle0" });
  const homeFooter = await page.evaluate(() => {
    const footer = document.querySelector(".lp__foot");
    const community = [...document.querySelectorAll(".lp__foot-links a")].find((item) =>
      item.textContent.includes("AgentWork")
    );
    const style = getComputedStyle(footer);
    return {
      communityText: community?.textContent.trim(),
      communityHref: community?.href,
      communityColor: getComputedStyle(community).color,
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });
  assert.equal(homeFooter.communityText, "加入 AgentWork 社区", "首页页脚必须保留 AgentWork 社区入口");
  assert.ok(homeFooter.communityHref, "AgentWork 社区入口必须有可访问链接");
  assert.notEqual(homeFooter.backgroundImage, "none", "首页页脚应继续使用首页品牌蓝渐变和网格色系");
  const linkColor = parseColor(homeFooter.communityColor);
  const gradientEndpoints = homeFooter.backgroundImage.match(/(?:rgba?|color)\([^)]+\)/g)?.slice(-3) || [];
  assert.equal(gradientEndpoints.length, 3, "首页页脚应提供可验证的三个品牌蓝渐变色标");
  for (const background of gradientEndpoints) {
    const backgroundColor = parseColor(background);
    assert.ok(
      contrast(composite(linkColor, backgroundColor), [backgroundColor.r, backgroundColor.g, backgroundColor.b]) >= 4.5,
      "AgentWork 社区入口在首页渐变两端都应达到 4.5:1 对比度"
    );
  }

  await page.goto(`${ORIGIN}/#/toc`, { waitUntil: "networkidle0" });
  const regularCommunity = await page.$eval(".foot__links", (element) =>
    [...element.querySelectorAll("a")].find((item) => item.textContent.includes("AgentWork"))?.textContent.trim()
  );
  assert.equal(regularCommunity, "加入 AgentWork 社区", "普通页面页脚也必须保留 AgentWork 社区入口");

  console.log(
    JSON.stringify({ status: "PASS", immediateShare, readyShare, articleTail, homeFooter }, null, 2)
  );
} finally {
  await browser.close();
}
