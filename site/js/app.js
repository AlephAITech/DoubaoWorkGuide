/* ============================================================
   app.js — 内容加载、路由、页面渲染与阅读交互

   页面结构刻意极简：单列、左对齐、大留白。
   导航靠页眉右上的胶囊、目录页，以及每篇文末的下一节链接。
   ============================================================ */

import { renderMarkdown, escapeHtml, plainText } from "./markdown.js?v=20260901-2";

const READ_KEY = "dwg.read";
const RESUME_KEY = "dwg.resume";
const RAIL_KEY = "dwg.rail"; /* 左侧章节目录："1" 固定展开，其余（含首次）收起悬浮 */
const ASSET_VERSION =
  document.querySelector('meta[name="dwg-assets-version"]')?.content || "20260901-2";
const versionedAsset = (path) => `${path}?v=${encodeURIComponent(ASSET_VERSION)}`;

const dom = {
  app: document.getElementById("app"),
  chipCount: document.getElementById("chip-count"),
  search: document.getElementById("search"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  searchHint: document.getElementById("search-hint"),
};

const state = {
  docs: [],
  parts: [],
  flat: [],
  route: { name: "home" },
  read: new Set(),
  resume: null, // { token, y } 上次读到哪
  resumePending: false, // 点了「继续阅读」，渲染后要恢复滚动位置
  index: [], // 全文搜索索引
  keyboardNav: false,
  cleanup: [],
};

/* ------------------------------------------------------------
   已读记录
   ------------------------------------------------------------ */

function loadRead() {
  try {
    const list = JSON.parse(localStorage.getItem(READ_KEY) || "[]");
    if (Array.isArray(list)) state.read = new Set(list);
  } catch (e) {}
}

function markRead(token) {
  if (!token || state.read.has(token)) return;
  state.read.add(token);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...state.read]));
  } catch (e) {}
}

/* ------------------------------------------------------------
   继续阅读：记住最后停留的篇目与滚动位置
   ------------------------------------------------------------ */

function loadResume() {
  try {
    const saved = JSON.parse(localStorage.getItem(RESUME_KEY) || "null");
    if (saved && saved.token) state.resume = saved;
  } catch (e) {}
}

function saveResume(token, y) {
  state.resume = { token, y };
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(state.resume));
  } catch (e) {}
}

/* 封面与目录页共用的「继续阅读」一行；只有真的读过才出现 */
function resumeLine() {
  if (!state.resume) return "";
  const entry = state.flat.find((item) => item.doc.nodeToken === state.resume.token);
  if (!entry || isSection(entry.doc)) return "";
  return `上次读到<a class="resume__link" href="${docHref(entry.doc)}" data-resume>《${escapeHtml(
    entry.doc.title
  )}》</a>，可以从停下的地方继续。`;
}

/* ------------------------------------------------------------
   内容模型
   ------------------------------------------------------------ */

const shortId = (token) => String(token || "").replace(/^doc-/, "");
const isSection = (doc) => Boolean(doc.hasChild);
const docHref = (doc) => `#/p/${shortId(doc.nodeToken)}`;

function buildModel(payload) {
  const docs = (payload.documents || []).slice();
  state.docs = docs;

  const childrenOf = (token) =>
    docs.filter((doc) => doc.parentToken === token).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const root = docs.find((doc) => doc.depth === 0) || null;
  state.parts = root ? childrenOf(root.nodeToken) : [];

  state.parts.forEach((part) => {
    part.children = childrenOf(part.nodeToken);
    part.children.forEach((child) => {
      child.children = child.hasChild ? childrenOf(child.nodeToken) : [];
      child.children.forEach((leaf) => (leaf.children = []));
    });
  });

  const flat = [];
  const walk = (node, part, group) => {
    flat.push({ doc: node, part, group });
    const nextGroup = node !== part && node.hasChild ? node : group;
    (node.children || []).forEach((child) => walk(child, part, nextGroup));
  };
  state.parts.forEach((part) => walk(part, part, null));
  state.flat = flat;

  state.leafOrder = new Map();
  flat
    .filter((entry) => !entry.doc.hasChild)
    .forEach((entry, i) => state.leafOrder.set(entry.doc.nodeToken, i + 1));

  state.counts = {
    docs: state.leafOrder.size,
    images: docs.reduce((sum, doc) => sum + (doc.images?.length || 0), 0),
    videos: docs.reduce((sum, doc) => sum + (doc.videos?.length || 0), 0),
    chars: docs.reduce((sum, doc) => sum + (doc.content?.length || 0), 0),
  };

  buildSearchIndex();
}

/* ------------------------------------------------------------
   全文搜索：内容一共十几万字，直接在内存里全文扫，不需要倒排索引
   ------------------------------------------------------------ */

function buildSearchIndex() {
  state.index = state.flat.map(({ doc, part }) => {
    // 去掉块级 Markdown 语法后再走行内清理，得到可检索、可做摘要的纯文本
    const text = plainText(
      (doc.content || "")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^[-*]\s+/gm, "")
        .replace(/^:{3,}.*$/gm, "")
        .replace(/^`{3,}.*$/gm, "")
        .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, " "))
    );
    return {
      token: doc.nodeToken,
      title: doc.title,
      titleLower: doc.title.toLowerCase(),
      part: part && part !== doc ? part.title : "",
      text,
      textLower: text.toLowerCase(),
    };
  });
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* 摘要与标题里的命中词加 <mark>；先按命中切段、逐段转义再拼回 */
function highlight(text, terms) {
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text
    .split(pattern)
    .map((piece, i) => (i % 2 ? `<mark>${escapeHtml(piece)}</mark>` : escapeHtml(piece)))
    .join("");
}

function searchDocs(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const results = [];
  state.index.forEach((entry) => {
    let score = 0;
    let firstHit = -1;
    for (const term of terms) {
      const inTitle = entry.titleLower.includes(term);
      const at = entry.textLower.indexOf(term);
      if (!inTitle && at < 0) return; // 每个词都必须命中
      if (inTitle) score += 20;
      if (at >= 0) {
        score += 1;
        if (firstHit < 0 || at < firstHit) firstHit = at;
      }
    }
    let snippet = "";
    if (firstHit >= 0) {
      const start = Math.max(0, firstHit - 24);
      snippet =
        (start > 0 ? "…" : "") +
        entry.text.slice(start, firstHit + 96) +
        (firstHit + 96 < entry.text.length ? "…" : "");
    }
    results.push({ entry, score, snippet });
  });

  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

function countLeaves(node) {
  let total = 0;
  const walk = (item) => {
    (item.children || []).forEach((child) => {
      if (child.hasChild) walk(child);
      else total += 1;
    });
  };
  walk(node);
  return total;
}

/* 某个章节/分组下已读的篇数 */
function countRead(node) {
  let total = 0;
  const walk = (item) => {
    (item.children || []).forEach((child) => {
      if (child.hasChild) walk(child);
      else if (state.read.has(child.nodeToken)) total += 1;
    });
  };
  walk(node);
  return total;
}

function docMeta(doc) {
  const bits = [];
  if (doc.images?.length) bits.push(`${doc.images.length} 图`);
  if (doc.videos?.length) bits.push(`${doc.videos.length} 视频`);
  return bits.join(" · ");
}

/* ------------------------------------------------------------
   路由
   ------------------------------------------------------------ */

function parseHash() {
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "intro") return { name: "intro" };
  if (parts[0] === "reading-guide") return { name: "intro" };
  if (parts[0] === "toc") return { name: "toc" };
  if (parts[0] === "p" && parts[1]) return { name: "doc", id: parts[1] };
  if (parts[0] === "doc" && parts[1]) {
    return { name: "doc", id: parts[1].replace(/^doc-/, "") };
  }
  return { name: "notfound" };
}

function navigate(hash, viaKeyboard = false) {
  state.keyboardNav = viaKeyboard;
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ------------------------------------------------------------
   首页书封：满屏品牌蓝的独立一页，「开始阅读」跳转内页封面（#/intro）
   ------------------------------------------------------------ */

/* 书封网格上的场景词注记：都是书里真实任务的影子，位置避开中央标题区。
   [文字, left%, top%] */
const COVER_NOTES = [
  ["塞满的收件箱", 10, 24],
  ["今天写什么", 27, 13],
  ["一张产品原图", 8, 62],
  ["随手收藏的以后", 20, 80],
  ["五分钟跑通第一个任务", 46, 16],
  ["开盘前的研究清单", 74, 11],
  ["出门也能盯任务", 85, 28],
  ["定时任务准点交", 82, 60],
  ["一支多 Agent 小队", 68, 82],
];

function viewLanding() {
  const { counts } = state;
  const resumeEntry = state.resume
    ? state.flat.find((item) => item.doc.nodeToken === state.resume.token)
    : null;
  const wan = (counts.chars / 10000).toFixed(1);
  // 底部图例栏：49 篇标题滚动播报（每条可点击），复制一份做无缝循环
  const tickerText = state.flat
    .filter((entry) => !isSection(entry.doc))
    .map(
      (entry) =>
        `<a class="bookcover__ticker-link" href="${docHref(entry.doc)}">${escapeHtml(entry.doc.title)}</a>`
    )
    .join("　◦　");

  // 推荐任务：每类场景挑第一篇，最多四张卡
  const scenePart = state.parts.find((part) => (part.children || []).some(isSection));
  const sceneGroups = scenePart ? scenePart.children.filter(isSection) : [];
  const picks = sceneGroups
    .map((group) => ({ group, doc: (group.children || [])[0] }))
    .filter((pick) => pick.doc)
    .slice(0, 4);

  const taskCards = picks
    .map(({ group, doc }, i) => {
      const excerpt = plainText((doc.content || "").replace(/^#.*$/m, "")).slice(0, 72);
      const minutes = Math.max(1, Math.round((doc.content || "").length / 380));
      return `
        <a class="lp__card lp__task" href="${docHref(doc)}">
          <span class="lp__tape" aria-hidden="true"></span>
          <span class="lp__stamp" aria-hidden="true">0${i + 1}</span>
          <p class="lp__tag">${escapeHtml(group.title)}</p>
          <h3 class="lp__task-title">${escapeHtml(doc.title)}</h3>
          <p class="lp__task-desc">${escapeHtml(excerpt)}…</p>
          <p class="lp__task-foot"><span>约 ${minutes} 分钟 · 可照做</span><span class="lp__arrow" aria-hidden="true">→</span></p>
        </a>`;
    })
    .join("");

  // 三个部分：FILE 档案卡
  const fileCards = state.parts
    .map((part, i) => {
      const [short, rest] = part.title.split(/[｜|]/).map((s) => s.trim());
      let desc = plainText((part.content || "").replace(/^#.*$/m, "")).slice(0, 56);
      if (!desc)
        desc = (part.children || [])
          .slice(0, 3)
          .map((child) => child.title.split(/[｜|]/)[0].trim())
          .join("、");
      return `
        <a class="lp__card lp__file" href="${docHref(part)}" data-n="0${i + 1}">
          <p class="lp__tag lp__tag--file">FILE / 0${i + 1}</p>
          <span class="lp__rule" aria-hidden="true"></span>
          <h3 class="lp__file-title">${escapeHtml(short)}</h3>
          <p class="lp__file-desc">${escapeHtml(rest ? `${rest}。${desc}` : desc)}…</p>
          <p class="lp__task-foot"><span>${countLeaves(part)} 篇</span><span class="lp__arrow" aria-hidden="true">→</span></p>
        </a>`;
    })
    .join("");

  return `
    <div class="view">
      <section class="bookcover">
        <div class="bookcover__grid" aria-hidden="true"></div>
        <div class="bookcover__lamp" aria-hidden="true"></div>
        <div class="bookcover__notes" aria-hidden="true">${COVER_NOTES.map(
          ([text, x, y], i) =>
            `<span class="bc-note" style="left:${x}%;top:${y}%;--i:${i}">${escapeHtml(text)}</span>`
        ).join("")}</div>
        <div class="bookcover__spine" aria-hidden="true"><span>豆包工作蓝皮书 · 第一版 · 2026</span></div>
        <span class="bookcover__reg bookcover__reg--tl" aria-hidden="true"></span>
        <span class="bookcover__reg bookcover__reg--tr" aria-hidden="true"></span>
        <span class="bookcover__reg bookcover__reg--bl" aria-hidden="true"></span>
        <span class="bookcover__reg bookcover__reg--br" aria-hidden="true"></span>
        <div class="bookcover__bar">
          <span class="bookcover__brand">DOUBAO WORK<span class="bookcover__brand-ext"> · FIELD MANUAL</span></span>
          <span class="bookcover__nav">
            <button class="chip chip--ghost" type="button" data-search>搜索</button>
            <a class="chip chip--ghost" href="#/toc">目录</a>
            <button class="chip chip--ghost" type="button" data-group>交流群</button>
          </span>
        </div>

        <div class="bookcover__center">
          <p class="bookcover__kicker"><span class="bookcover__dimline" aria-hidden="true"></span><span class="bookcover__kicker-text">豆包工作 · 系统化中文实践</span><span class="bookcover__dimline" aria-hidden="true"></span></p>
          <h1 class="bookcover__title">豆包工作蓝皮书</h1>
          <p class="bookcover__sub">把豆包工作用起来，从第一个能验收的任务开始。</p>
          <div class="bookcover__actions">
            <a class="bcbtn bcbtn--solid" href="#/intro">开始阅读</a>
            <a class="bcbtn bcbtn--ghost" href="#/toc">查看目录</a>
          </div>
          ${
            resumeEntry && !isSection(resumeEntry.doc)
              ? `<a class="bookcover__resume" href="${docHref(resumeEntry.doc)}" data-resume>继续读《${escapeHtml(
                  resumeEntry.doc.title
                )}》</a>`
              : ""
          }
        </div>

        <div class="bookcover__ticker" aria-label="全部篇目速览">
          <div class="bookcover__ticker-track"><span>${tickerText}　◦　</span><span aria-hidden="true">${tickerText}　◦　</span></div>
        </div>

        <div class="bookcover__foot">
          <span class="bookcover__hint" aria-hidden="true">↓ 往下翻</span>
          <p class="bookcover__stats">
            <span class="bc-num" data-n="${counts.docs}">${counts.docs}</span> 篇 · 约
            <span class="bc-num" data-n="${wan}">${wan}</span> 万字 ·
            <span class="bc-num" data-n="${counts.images}">${counts.images}</span> 张实测截图 ·
            <span class="bc-num" data-n="${counts.videos}">${counts.videos}</span> 段演示视频
          </p>
        </div>
      </section>

      <div class="lp">
        <span class="lp__side" aria-hidden="true">DOUBAO WORK · FIELD MANUAL · 2026</span>
        <section class="lp__section">
          <header class="lp__head">
            <div class="lp__index-row">
              <span class="lp__index">PICKS / 01–0${picks.length}</span>
              <a class="lp__more" href="#/toc">全部 ${counts.docs} 篇 →</a>
            </div>
            <div class="lp__head-row">
              <h2 class="lp__h2">从一个真实任务进来</h2>
              <p class="lp__lede">每类场景挑了一篇能直接照做的任务，打开就是提示词、实测截图和验收方法。</p>
            </div>
          </header>
          <div class="lp__grid lp__grid--tasks">${taskCards}</div>
        </section>

        <div class="lp__hatch" aria-hidden="true"></div>

        <section class="lp__section">
          <header class="lp__head">
            <div class="lp__index-row">
              <span class="lp__index">INDEX / 01–0${state.parts.length}</span>
              <a class="lp__more" href="#/toc">完整目录 →</a>
            </div>
            <div class="lp__head-row">
              <h2 class="lp__h2">不必从第一页开始</h2>
              <p class="lp__lede">不必按页码顺序读。想先跑通安装、先完成一件小事，或者直接进入手上的场景，都有各自的入口。</p>
            </div>
          </header>
          <div class="lp__grid lp__grid--files">${fileCards}</div>
        </section>

        <section class="lp__cta">
          <div class="lp__cta-box">
            <p class="lp__cta-kicker">EDITION 01 · 2026</p>
            <p class="lp__cta-title">把豆包工作用起来，从第一个能验收的任务开始。</p>
            <div class="lp__cta-actions">
              <a class="bcbtn bcbtn--solid" href="#/intro">开始阅读</a>
              <a class="bcbtn bcbtn--ghost" href="#/toc">查看目录</a>
            </div>
          </div>
        </section>

        <footer class="lp__foot">
          <p class="lp__foot-sig">DOUBAO WORK · FIELD MANUAL</p>
          <nav class="lp__foot-links" aria-label="站外链接">
            <a href="${FOOT_LINKS.contact}" target="_blank" rel="noopener noreferrer">联系我们</a>
            <a class="lp__foot-git" href="${FOOT_LINKS.repo}" target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库">${GITHUB_ICON}</a>
            <a href="${FOOT_LINKS.community}" target="_blank" rel="noopener noreferrer">加入 Agentwork 社区</a>
          </nav>
          <p class="lp__foot-copy">© 豆包工作蓝皮书</p>
          <nav class="lp__foot-friends" aria-label="友情链接">
            <span class="lp__foot-friends-label">友情链接</span>
            ${friendLinksHtml()}
          </nav>
        </footer>
      </div>
    </div>`;
}

/* 书封动效：标题逐字升起、网格指针视差、点入口时 3D 翻开封面再跳转 */
function initLanding() {
  const cover = dom.app.querySelector(".bookcover");
  if (!cover) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hydrated = cover.classList.contains("bookcover--hydrated");

  // 标题逐字：每字包一层 overflow hidden 遮罩，60ms 间隔升起
  const title = cover.querySelector(".bookcover__title");
  if (title && !hydrated) {
    title.innerHTML = [...title.textContent]
      .map(
        (ch, i) =>
          `<span class="bc-m"><span class="bc-ch" style="animation-delay:${160 + i * 60}ms">${escapeHtml(ch)}</span></span>`
      )
      .join("");
  }

  // 网格视差 + 台灯光斑：同一个惯性循环里更新，只在精确指针设备上。
  // 指针是目标位置，实际位置每帧向目标靠 14%，光斑像有重量地跟过来
  const grid = cover.querySelector(".bookcover__grid");
  const lamp = cover.querySelector(".bookcover__lamp");
  if (!reduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    // 场景词注记的中心点：入场后量一次，台灯扫过时按距离点亮
    let noteBoxes = [];
    const measureNotes = () => {
      noteBoxes = [...cover.querySelectorAll(".bc-note")].map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    };
    measureNotes();
    window.addEventListener("resize", measureNotes);
    state.cleanup.push(() => window.removeEventListener("resize", measureNotes));

    let raf = 0;
    let cx = window.innerWidth / 2;
    let cy = window.innerHeight / 2;
    let tx = cx;
    let ty = cy;
    const loop = () => {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      if (grid)
        grid.style.transform = `translate3d(${((cx / window.innerWidth - 0.5) * -20).toFixed(1)}px, ${(
          (cy / window.innerHeight - 0.5) *
          -20
        ).toFixed(1)}px, 0)`;
      if (lamp) lamp.style.transform = `translate3d(${(cx - 320).toFixed(1)}px, ${(cy - 320).toFixed(1)}px, 0)`;
      // 灯到词 260px 内线性点亮：15% 基础亮度 → 最高 70%
      noteBoxes.forEach((note) => {
        const p = Math.max(0, 1 - Math.hypot(cx - note.x, cy - note.y) / 260);
        note.el.style.color = `rgba(255,255,255,${(0.15 + p * 0.55).toFixed(3)})`;
      });
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.5 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (event) => {
      tx = event.clientX;
      ty = event.clientY;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    cover.addEventListener("pointermove", onMove);
    state.cleanup.push(() => {
      cover.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    });
  }

  // 跑马灯周期跟内容长度走，保持大致恒定的线速度
  const track = cover.querySelector(".bookcover__ticker-track");
  if (track) {
    const docsCount = state.flat.filter((entry) => !isSection(entry.doc)).length;
    track.style.animationDuration = `${Math.max(60, docsCount * 2.4)}s`;
  }

  // 统计行数字滚动：与页脚淡入（820ms）衔接，1s 内滚到位
  const nums = cover.querySelectorAll(".bc-num");
  if (nums.length && !reduced && !hydrated) {
    const start = performance.now() + 700;
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      nums.forEach((el) => {
        const target = parseFloat(el.dataset.n);
        const decimals = el.dataset.n.includes(".") ? 1 : 0;
        el.textContent = (target * eased).toFixed(decimals);
      });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    state.cleanup.push(() => cancelAnimationFrame(raf));
  }

  // 书封下方版块：滚进视口再升起（reduced motion 或无 IO 时直接可见）
  const lp = dom.app.querySelector(".lp");
  if (lp && !reduced && "IntersectionObserver" in window) {
    lp.classList.add("lp--animate");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((item) => {
          if (!item.isIntersecting) return;
          item.target.classList.add("lp-in");
          io.unobserve(item.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    lp.querySelectorAll(".lp__head, .lp__card, .lp__cta-box").forEach((el) => io.observe(el));
    state.cleanup.push(() => io.disconnect());
  }

  // 翻开封面：拦截站内链接，先播放开书动画再改路由。
  // data-resume 的标记由 initAnchors 的全局监听负责，这里不重复处理
  let opening = false;
  cover.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#/"]');
    if (!link || reduced) return;
    event.preventDefault();
    if (opening) return;
    opening = true;
    cover.classList.add("bookcover--open");
    setTimeout(() => {
      location.hash = link.getAttribute("href").slice(1);
    }, 600);
  });
}

/* ------------------------------------------------------------
   内页封面（导读）
   ------------------------------------------------------------ */

function viewIntro() {
  const { counts, parts } = state;
  const scenePart = parts.find((part) => (part.children || []).some(isSection));
  const sceneGroups = scenePart ? scenePart.children.filter(isSection) : [];
  const firstDoc = state.flat.find((entry) => !entry.doc.hasChild)?.doc;

  const partEntries = parts
    .map((part) => {
      const total = countLeaves(part);
      const read = countRead(part);
      const pct = total ? Math.round((read / total) * 100) : 0;
      return `
        <li>
          <a class="entry" href="${docHref(part)}">
            <span class="entry__main">
              <span class="entry__title">${escapeHtml(part.title)}</span>
            </span>
            <span class="entry__meta">
              ${read ? `<span class="entry__read">已读 ${read}</span>` : ""}
              <span class="entry__n">${total} 篇</span>
              <span class="entry__arrow" aria-hidden="true">→</span>
            </span>
            ${read ? `<span class="entry__bar" style="width:${pct}%" aria-hidden="true"></span>` : ""}
          </a>
        </li>`;
    })
    .join("");

  const sceneEntries = sceneGroups
    .map((group) => {
      const firstLeaf = (group.children || []).find((child) => !isSection(child));
      const read = countRead(group);
      return `
        <li>
          <a class="entry" href="${docHref(group)}">
            <span class="entry__main">
              <span class="entry__title">${escapeHtml(group.title)}</span>
              ${firstLeaf ? `<span class="entry__hint">${escapeHtml(firstLeaf.title)}</span>` : ""}
            </span>
            <span class="entry__meta">
              ${read ? `<span class="entry__read">已读 ${read}</span>` : ""}
              <span class="entry__n">${(group.children || []).length} 个任务</span>
              <span class="entry__arrow" aria-hidden="true">→</span>
            </span>
          </a>
        </li>`;
    })
    .join("");

  const resumeEntry = state.resume
    ? state.flat.find((item) => item.doc.nodeToken === state.resume.token)
    : null;
  const resumeDoc = resumeEntry && !isSection(resumeEntry.doc) ? resumeEntry.doc : null;

  return `
    <div class="view">
      <div class="page cover">
        <div class="essay">
          <p class="caption essay__kicker">导读</p>
          <p class="display">
            把豆包工作用起来，从第一个能验收的任务开始。<img
              class="mark"
              src="assets/brand/doubao-mark-512.png"
              alt=""
              aria-hidden="true"
            />
            <span class="faded reveal reveal--blue">这是一本面向豆包工作的系统化中文实践蓝皮书。</span>
          </p>

          <p class="display reveal">
            从下载安装讲到连接器、Skill、API、定时任务和多 Agent 工作小队，再用 <span class="numem">${
              counts.docs
            }</span> 篇真实任务演示怎么把材料、要求和工具组织成可检查、可交付、可复用的结果。
          </p>

          <p class="display reveal">不用从头读，直接跳到和你手上任务最接近的那一篇。</p>

          <div>
            <p class="caption entries__label">三个部分</p>
            <ul class="entries">${partEntries}</ul>
          </div>

          ${
            sceneEntries
              ? `<div>
                   <p class="caption entries__label">${sceneGroups.length} 类场景</p>
                   <ul class="entries">${sceneEntries}</ul>
                 </div>`
              : ""
          }

          <p class="display">
            全书 <span class="numem">${counts.docs}</span> 篇，约 <span class="numem">${(
    counts.chars / 10000
  ).toFixed(1)}</span> 万字。
            <span class="faded"><span class="numem">${counts.images}</span> 张实测截图，<span class="numem">${
    counts.videos
  }</span> 段演示视频，全部来自真实任务。</span>
          </p>

          <div class="nextsteps">
            <p class="caption entries__label">下一步</p>
            <div class="nextsteps__row">
              ${
                resumeDoc
                  ? `<a class="pill" href="${docHref(resumeDoc)}" data-resume>继续读《${escapeHtml(
                      resumeDoc.title
                    )}》</a>`
                  : ""
              }
              ${
                firstDoc
                  ? `<a class="pill${resumeDoc ? " pill--ghost" : ""}" href="${docHref(
                      firstDoc
                    )}">从第一篇开始</a>`
                  : ""
              }
              <a class="pill pill--ghost" href="#/toc">查看完整目录</a>
            </div>
          </div>
        </div>
      </div>
      ${footer(true)}
    </div>`;
}

/* ------------------------------------------------------------
   目录
   ------------------------------------------------------------ */

function viewToc() {
  const readCount = state.flat.filter(
    ({ doc }) => !isSection(doc) && state.read.has(doc.nodeToken)
  ).length;

  const rows = (items) =>
    `<ul class="toc__list">${items
      .map(
        (doc, index) => `
          <li>
            <a class="toc__row" href="${docHref(doc)}">
              <span class="toc__row-idx">${String(index + 1).padStart(2, "0")}</span>
              <span class="toc__row-title">${escapeHtml(doc.title)}</span>
              <span class="toc__row-meta">${[docMeta(doc), state.read.has(doc.nodeToken) ? "已读" : ""]
                .filter(Boolean)
                .join(" · ")}</span>
            </a>
          </li>`
      )
      .join("")}</ul>`;

  const body = state.parts
    .map((part) => {
      const groups = (part.children || []).filter(isSection);
      const leaves = (part.children || []).filter((child) => !isSection(child));
      return `
        <section class="toc__part">
          <h2 class="display toc__part-title">
            <a class="link-display" href="${docHref(part)}">${escapeHtml(part.title)}</a>
          </h2>
          ${leaves.length ? rows(leaves) : ""}
          ${groups
            .map(
              (group) => `
                <h3 class="toc__group">${escapeHtml(group.title)}</h3>
                ${rows(group.children || [])}`
            )
            .join("")}
        </section>`;
    })
    .join("");

  return `
    <div class="view">
      <div class="page toc">
        <h1 class="display">目录</h1>
        <p class="body-text" style="margin-top:var(--s-16)">
          全书 ${state.counts.docs} 篇，按三个部分与五类场景分组。${
    readCount ? `已读 ${readCount} 篇。` : ""
  }${resumeLine()}
        </p>
        <div style="margin-top:var(--s-section)">${body}</div>
      </div>
      ${footer(true)}
    </div>`;
}

/* ------------------------------------------------------------
   正文
   ------------------------------------------------------------ */

/* 左侧章节目录的一个部分：details 折叠，当前链路展开、其余自动收起 */
function railPartHtml(partNode, entry) {
  const cur = entry.doc;
  const short = partNode.title.split(/[｜|]/)[0].trim();
  const leaves = (partNode.children || []).filter((child) => !isSection(child));
  const groups = (partNode.children || []).filter(isSection);
  const inPart = entry.part === partNode || partNode === cur;
  const link = (d) =>
    `<a class="rail__link${d === cur ? " is-current" : ""}" href="${docHref(d)}">${escapeHtml(d.title)}</a>`;

  return `
    <details class="rail__part"${inPart ? " open" : ""}>
      <summary class="rail__sum">
        <span class="rail__sum-text">${escapeHtml(short)}</span>
        <span class="rail__meta"><span class="rail__count">${countLeaves(partNode)}</span><span class="rail__chev" aria-hidden="true">▸</span></span>
      </summary>
      ${leaves.length ? `<div class="rail__list">${leaves.map(link).join("")}</div>` : ""}
      ${groups
        .map(
          (g) => `
            <details class="rail__group"${entry.group === g || g === cur ? " open" : ""}>
              <summary class="rail__sum rail__sum--group">
                <span class="rail__sum-text">${escapeHtml(g.title)}</span>
                <span class="rail__meta"><span class="rail__chev" aria-hidden="true">▸</span></span>
              </summary>
              <div class="rail__list rail__list--group">${(g.children || []).map(link).join("")}</div>
            </details>`
        )
        .join("")}
    </details>`;
}

function viewDoc(entry) {
  const { doc, part, group } = entry;
  const index = state.flat.findIndex((item) => item.doc.nodeToken === doc.nodeToken);
  const next = state.flat[index + 1];
  const prev = state.flat[index - 1];

  /* 默认收起成悬浮小签；只有用户主动固定展开过（"1"）才保持展开 */
  let railCollapsed = true;
  try {
    railCollapsed = localStorage.getItem(RAIL_KEY) !== "1";
  } catch (e) {}

  const rail = `
    <nav class="rail${railCollapsed ? " is-collapsed" : ""}" aria-label="全书目录">
      <button class="rail__fab" type="button" data-rail-pin aria-label="展开目录" title="展开目录">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>
        <span>目录</span>
      </button>
      <div class="rail__panel">
        <div class="rail__top">
          <a class="rail__home" href="#/toc">全书目录</a>
          <button class="rail__toggle" type="button" data-rail-collapse aria-label="收起目录" title="收起目录">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 4 5 8l4 4M13 4 9 8l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </button>
        </div>
        ${state.parts.map((p) => railPartHtml(p, entry)).join("")}
      </div>
    </nav>`;

  const where = [
    `<a href="#/">封面</a>`,
    part && part !== doc ? `<a href="${docHref(part)}">${escapeHtml(part.title)}</a>` : "",
    group && group !== doc ? `<a href="${docHref(group)}">${escapeHtml(group.title)}</a>` : "",
  ]
    .filter(Boolean)
    .join(' <span aria-hidden="true">/</span> ');

  let body;

  if (isSection(doc)) {
    const intro = plainText((doc.content || "").replace(/^#.*$/m, ""));
    body = `
      ${intro ? `<p class="overview__intro">${escapeHtml(intro)}</p>` : ""}
      <ul class="toc__list">
        ${(doc.children || [])
          .map(
            (child, i) => `
              <li>
                <a class="toc__row" href="${docHref(child)}">
                  <span class="toc__row-idx">${String(i + 1).padStart(2, "0")}</span>
                  <span class="toc__row-title">${escapeHtml(child.title)}</span>
                  <span class="toc__row-meta">${[
                    child.hasChild ? `${(child.children || []).length} 个任务` : docMeta(child),
                    !child.hasChild && state.read.has(child.nodeToken) ? "已读" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}</span>
                </a>
              </li>`
          )
          .join("")}
      </ul>`;
  } else {
    const rendered = renderMarkdown(doc.content || "", doc.title);
    const sections = rendered.toc.filter((item) => item.level === 2);
    const tocLinks = sections
      .map((item) => `<li><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`)
      .join("");
    // 同一份小节列表两种形态：窄屏是页首的「本页」列表，
    // 宽屏是悬浮在正文右侧、滚动跟随高亮的侧边目录（CSS 按视口切换）
    const pagetoc =
      sections.length >= 3
        ? `<nav class="pagetoc" aria-label="本页目录">
             <p class="pagetoc__label">本页</p>
             <ol class="pagetoc__list">${tocLinks}</ol>
           </nav>`
        : "";
    const sidetoc =
      sections.length >= 3
        ? `<nav class="sidetoc" aria-label="本页目录">
             <p class="sidetoc__label">本页</p>
             <ol class="sidetoc__list">${tocLinks}</ol>
           </nav>`
        : "";
    body = `${sidetoc}${pagetoc}<div class="prose">${rendered.html}</div>`;
  }

  const meta = [
    isSection(doc)
      ? `${(doc.children || []).length} 个子章节`
      : `第 ${state.leafOrder.get(doc.nodeToken)} / ${state.counts.docs} 篇`,
    doc.images?.length ? `${doc.images.length} 张截图` : "",
    doc.videos?.length ? `${doc.videos.length} 段视频` : "",
    !isSection(doc) && doc.content
      ? `约 ${Math.max(1, Math.round(doc.content.length / 380))} 分钟`
      : "",
  ]
    .filter(Boolean)
    .join("　·　");

  return `
    <div class="view">
      <div class="readbar" aria-hidden="true"><span class="readbar__fill"></span></div>
      ${rail}
      <article class="page article">
        <p class="article__where">${where}</p>
        <h1 class="display article__title">${escapeHtml(doc.title)}</h1>
        <p class="article__meta">${escapeHtml(meta)}</p>
        ${body}
        <nav class="article__next" aria-label="继续阅读">
          ${
            next
              ? `<p class="article__next-label">下一节</p>
                 <a class="nextlink" href="${docHref(next.doc)}">${escapeHtml(
                  next.doc.title
                )}</a>`
              : `<p class="article__next-label">已经是最后一节</p>
                 <a class="nextlink" href="#/toc">回到目录</a>`
          }
          <p class="article__tail">
            ${
              prev
                ? `<a class="link" href="${docHref(prev.doc)}">上一节：${escapeHtml(
                    prev.doc.title
                  )}</a>`
                : ""
            }
            <a class="link" href="#/toc">目录</a>
            <button class="link" type="button" data-share>分享本篇</button>
          </p>
        </nav>
      </article>
      ${footer(true)}
    </div>`;
}

/* ------------------------------------------------------------
   页脚与状态页
   ------------------------------------------------------------ */

/* 页脚外链集中在这里改 */
const FOOT_LINKS = {
  repo: "https://github.com/AlephAITech/DoubaoWorkGuide",
  contact: "https://github.com/AlephAITech/DoubaoWorkGuide/issues",
  community: "https://github.com/AlephAITech", // TODO: 换成 Agentwork 社区的真实入口
};

/* 页脚友链 */
const FRIEND_LINKS = [
  ["WorkBuddy 蓝皮书", "https://workbuddy.homes/"],
  ["观猹", "https://watcha.cn/"],
  ["CodexGuide", "https://codexguide.ai/"],
];

function friendLinksHtml() {
  return FRIEND_LINKS.map(
    ([name, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`
  ).join("");
}

/* GitHub 官方标志（octocat mark） */
const GITHUB_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;

function footer(tight = false) {
  return `
    <footer class="foot${tight ? " foot--tight" : ""}">
      <div class="foot__row">
        <p class="foot__sig">DOUBAO WORK · FIELD MANUAL</p>
        <nav class="foot__links" aria-label="站外链接">
          <a href="${FOOT_LINKS.contact}" target="_blank" rel="noopener noreferrer">联系我们</a>
          <a class="foot__git" href="${FOOT_LINKS.repo}" target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库">${GITHUB_ICON}</a>
          <a href="${FOOT_LINKS.community}" target="_blank" rel="noopener noreferrer">加入 Agentwork 社区</a>
        </nav>
        <p class="foot__copy">© 豆包工作蓝皮书</p>
      </div>
      <nav class="foot__friends" aria-label="友情链接">
        <span class="foot__friends-label">友情链接</span>
        ${friendLinksHtml()}
      </nav>
    </footer>`;
}

function viewNotFound() {
  return `
    <div class="view">
      <div class="state">
        <h1 class="display">没有找到这一页</h1>
        <p class="state__text">链接可能已经变化。可以回到封面，或从目录重新进入。</p>
        <p class="state__actions"><a class="pill" href="#/">回到封面</a></p>
      </div>
    </div>`;
}

function showLoadError(error) {
  document.body.classList.remove("is-home", "is-booting");
  dom.app.hidden = false;
  dom.app.innerHTML = `
    <div class="state">
    <h1 class="display">内容没有载入成功</h1>
    <p class="state__text">
      页面需要通过本地服务器打开：直接双击 index.html 时，浏览器会拦截内容文件的读取。
      在项目根目录执行下面的命令，然后访问 http://127.0.0.1:4173/。
    </p>
    <code class="state__code">python3 -m http.server 4173 --bind 127.0.0.1 --directory site</code>
    <p class="state__text">${escapeHtml(error?.message || error || "")}</p>
    </div>`;
}

/* ------------------------------------------------------------
   渲染
   ------------------------------------------------------------ */

function render() {
  state.cleanup.forEach((fn) => fn());
  state.cleanup = [];

  const route = parseHash();
  state.route = route;

  let html;
  let doc = null;

  if (route.name === "doc") {
    const entry = state.flat.find((item) => shortId(item.doc.nodeToken) === route.id);
    if (entry) {
      doc = entry.doc;
      html = viewDoc(entry);
    } else {
      html = viewNotFound();
    }
  } else if (route.name === "toc") {
    html = viewToc();
  } else if (route.name === "intro") {
    html = viewIntro();
  } else if (route.name === "home") {
    html = viewLanding();
  } else {
    html = viewNotFound();
  }

  dom.app.innerHTML = html;

  // 首页有自己的蓝色书封（自带品牌行与入口），隐藏白底页眉
  document.body.classList.toggle("is-home", route.name === "home");

  // 键盘触发的翻页不加过场动画
  if (state.keyboardNav) {
    dom.app.querySelector(".view")?.style.setProperty("animation", "none");
    state.keyboardNav = false;
  }

  document.title = doc
    ? `${doc.title} · 豆包工作蓝皮书`
    : route.name === "toc"
    ? "目录 · 豆包工作蓝皮书"
    : route.name === "intro"
    ? "导读 · 豆包工作蓝皮书"
    : "豆包工作蓝皮书";

  // 点了「继续阅读」就回到上次的滚动位置，否则回顶
  if (doc && state.resumePending && state.resume?.token === doc.nodeToken) {
    window.scrollTo({ top: state.resume.y || 0, behavior: "auto" });
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  state.resumePending = false;
  hidePinbar();

  if (doc) {
    markRead(doc.nodeToken);
    if (!isSection(doc)) trackResume(doc);
  }
  bindPage();
  dom.app.querySelectorAll(".display").forEach(phraseWrap);
  if (route.name === "intro") initReveal();
  if (route.name === "home") initLanding();
  if (route.name === "doc") {
    initSidetoc();
    initRail();
    initReadbar();
  }
}

/* 停留在正文页时，每次滚动都低频地记下位置 */
function trackResume(doc) {
  saveResume(doc.nodeToken, window.scrollY);
  let timer = 0;
  const onScroll = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      saveResume(doc.nodeToken, window.scrollY);
    }, 600);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  state.cleanup.push(() => {
    window.removeEventListener("scroll", onScroll);
    if (timer) clearTimeout(timer);
  });
}

function bindPage() {
  const scope = dom.app;

  scope.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".codecard")?.querySelector("code");
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent || "");
      } catch (e) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("copy");
        selection.removeAllRanges();
      }
      button.dataset.done = "true";
      button.textContent = "已复制";
      setTimeout(() => {
        button.dataset.done = "false";
        button.textContent = "复制";
      }, 1600);
    });
  });

  scope.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(button.dataset.zoom, button.dataset.alt));
  });

  // 分享：弹出这一篇的专属卡片图
  scope.querySelectorAll("[data-share]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.flat.find((item) => shortId(item.doc.nodeToken) === state.route.id);
      if (entry) openShareBox(entry.doc);
    });
  });
}

/* ------------------------------------------------------------
   分享卡片：用站点的设计语言在 canvas 上画出这一篇的 1200×630 卡片，
   弹层里可以下载、复制链接，手机上还能走系统分享面板
   ------------------------------------------------------------ */

let sharebox = null;
let shareCard = { url: "", name: "" };
let logoPromise = null;

function loadLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = "assets/brand/doubao-mark-512.png";
    });
  }
  return logoPromise;
}

/* 按字折行，最多 maxLines 行，超出的在行尾加省略号 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + "…";
  return lines;
}

/* 在 canvas 上画二维码（qrcode-generator 提供矩阵，这里只管铺方块） */
function drawQR(ctx, text, x, y, size) {
  if (typeof qrcode !== "function") return false;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  ctx.fillStyle = "#232323";
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.5, cell + 0.5);
    }
  }
  return true;
}

async function drawShareCard(doc) {
  await document.fonts.ready;
  const logo = await loadLogo().catch(() => null);

  // A5 竖版（148:210），840×1188 ≈ A5 @144dpi，再 2x 导出保证清晰
  const W = 840;
  const H = 1188;
  const PAD = 72;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const font = (spec) => `${spec} Inter, "PingFang SC", "Hiragino Sans GB", sans-serif`;
  const textWidth = W - PAD * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // 字标
  ctx.textBaseline = "middle";
  if (logo) ctx.drawImage(logo, PAD, 64, 40, 40);
  ctx.fillStyle = "#232323";
  ctx.font = font("600 24px");
  ctx.fillText("豆包工作蓝皮书", PAD + (logo ? 56 : 0), 64 + 21);

  // 标题：46px/500 charcoal，最多三行
  ctx.font = font("500 46px");
  const titleLines = wrapText(ctx, doc.title, textWidth, 3);
  const titleTop = 212;
  const titleLineHeight = 70;
  ctx.fillStyle = "#232323";
  titleLines.forEach((text, i) => ctx.fillText(text, PAD, titleTop + i * titleLineHeight));

  // 摘录区：24px/400 灰（soft graphite），行数按剩余空间算，尽量填满。
  // 正文页摘正文；章节页没有正文，改列子章节目录
  const ruleY = H - 268;
  ctx.font = font("400 24px");
  ctx.fillStyle = "#a7a7a7";
  const excerptTop = titleTop + titleLines.length * titleLineHeight + 30;
  const maxLines = Math.floor((ruleY - 48 - excerptTop) / 44);
  let excerptLines = [];
  if (isSection(doc)) {
    excerptLines = (doc.children || [])
      .slice(0, maxLines)
      .map((child, i) => wrapText(ctx, `${String(i + 1).padStart(2, "0")}　${child.title}`, textWidth, 1)[0]);
  } else {
    // 索引文本以文内首个标题开头，多数就是篇名，别在卡片里重复一遍
    let excerpt = state.index.find((entry) => entry.token === doc.nodeToken)?.text || "";
    if (excerpt.startsWith(doc.title)) excerpt = excerpt.slice(doc.title.length).trim();
    if (excerpt) excerptLines = wrapText(ctx, excerpt, textWidth, maxLines);
  }
  excerptLines.forEach((text, i) => ctx.fillText(text, PAD, excerptTop + i * 44));

  // 底部：发丝线，左边是「扫码阅读」与篇目信息，右边是二维码
  ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, ruleY);
  ctx.lineTo(W - PAD, ruleY);
  ctx.stroke();

  const qrSize = 148;
  const qrX = W - PAD - qrSize;
  const qrY = ruleY + 48;
  const hasQR = drawQR(ctx, location.href, qrX, qrY, qrSize);

  const meta = isSection(doc)
    ? `${(doc.children || []).length} 个子章节`
    : [
        `第 ${state.leafOrder.get(doc.nodeToken)} / ${state.counts.docs} 篇`,
        doc.content ? `约 ${Math.max(1, Math.round(doc.content.length / 380))} 分钟` : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const infoMid = qrY + qrSize / 2;
  ctx.fillStyle = "#232323";
  ctx.font = font("500 26px");
  ctx.fillText(hasQR ? "扫码阅读本篇" : "豆包工作蓝皮书", PAD, infoMid - 24);
  ctx.fillStyle = "#a7a7a7";
  ctx.font = font("400 22px");
  ctx.fillText(`豆包工作蓝皮书 · ${meta}`, PAD, infoMid + 24);

  return canvas;
}

async function openShareBox(doc) {
  if (!sharebox) {
    sharebox = document.createElement("div");
    sharebox.className = "sharebox";
    sharebox.dataset.open = "false";
    sharebox.innerHTML = `
      <div class="sharebox__panel">
        <img class="sharebox__img" alt="分享卡片" />
        <div class="sharebox__row">
          <p class="sharebox__hint">也可以右键 / 长按图片直接拷贝</p>
          <span class="sharebox__actions">
            <button class="chip" type="button" data-card-download>下载卡片</button>
            <button class="chip" type="button" data-card-link>复制链接</button>
          </span>
        </div>
      </div>`;

    sharebox.addEventListener("click", (event) => {
      if (!event.target.closest(".sharebox__panel")) closeShareBox();
    });

    sharebox.querySelector("[data-card-download]").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = shareCard.url;
      a.download = shareCard.name;
      a.click();
    });

    sharebox.querySelector("[data-card-link]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(location.href);
        button.textContent = "已复制";
      } catch (e) {
        button.textContent = "复制失败";
      }
      setTimeout(() => (button.textContent = "复制链接"), 1600);
    });

    document.body.appendChild(sharebox);
  }

  const canvas = await drawShareCard(doc);
  shareCard = { url: canvas.toDataURL("image/png"), name: `${doc.title} · 豆包工作蓝皮书.png` };
  sharebox.querySelector(".sharebox__img").src = shareCard.url;
  sharebox.__prevFocus = document.activeElement;
  sharebox.dataset.open = "true";
  document.body.classList.add("is-locked");
  sharebox.querySelector("[data-card-download]")?.focus();

  // 手机上补一颗「系统分享」，把卡片图连标题一起交给系统面板
  const actions = sharebox.querySelector(".sharebox__actions");
  actions.querySelector("[data-card-share]")?.remove();
  if (matchMedia("(pointer: coarse)").matches && navigator.share) {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.dataset.cardShare = "true";
    button.textContent = "系统分享";
    button.addEventListener("click", async () => {
      const blob = await (await fetch(shareCard.url)).blob();
      const file = new File([blob], shareCard.name, { type: "image/png" });
      const payload = navigator.canShare?.({ files: [file] })
        ? { files: [file], title: document.title }
        : { title: document.title, url: location.href };
      try {
        await navigator.share(payload);
      } catch (e) {}
    });
    actions.prepend(button);
  }
}

function closeShareBox() {
  if (!sharebox || sharebox.dataset.open !== "true") return;
  sharebox.dataset.open = "false";
  document.body.classList.remove("is-locked");
  if (sharebox.__prevFocus?.isConnected) sharebox.__prevFocus.focus();
}

/* ------------------------------------------------------------
   交流群悬浮二维码：贴近触发按钮出现，不遮页面、不锁滚动。
   ------------------------------------------------------------ */

let groupbox = null;
let groupboxTrigger = null;

function positionGroupBox(trigger) {
  if (!groupbox || !trigger?.isConnected) {
    closeGroupBox();
    return;
  }

  const anchor = trigger.getBoundingClientRect();
  const box = groupbox.getBoundingClientRect();
  const margin = 12;
  const compact = window.innerWidth <= 720;
  let left = compact ? (window.innerWidth - box.width) / 2 : anchor.right - box.width;
  let top = anchor.bottom + margin;

  left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, left));
  if (top + box.height > window.innerHeight - margin) {
    top = Math.max(margin, anchor.top - box.height - margin);
  }

  groupbox.style.left = `${Math.round(left)}px`;
  groupbox.style.top = `${Math.round(top)}px`;
}

function openGroupBox(trigger) {
  if (!groupbox) {
    groupbox = document.createElement("div");
    groupbox.className = "groupbox";
    groupbox.dataset.open = "false";
    groupbox.setAttribute("role", "dialog");
    groupbox.setAttribute("aria-label", "加入交流群");
    groupbox.innerHTML = `<img src="${versionedAsset(
      "assets/qr-group.png"
    )}" alt="豆包工作交流群二维码" />`;

    document.body.appendChild(groupbox);
  }

  if (groupboxTrigger && groupboxTrigger !== trigger) {
    groupboxTrigger.setAttribute("aria-expanded", "false");
  }
  groupboxTrigger = trigger;
  groupboxTrigger?.setAttribute("aria-expanded", "true");
  groupbox.dataset.open = "true";
  positionGroupBox(trigger);
}

function closeGroupBox() {
  if (!groupbox || groupbox.dataset.open !== "true") return;
  groupbox.dataset.open = "false";
  groupboxTrigger?.setAttribute("aria-expanded", "false");
  groupboxTrigger = null;
}

/* ------------------------------------------------------------
   展示级文字按词组断行：CSS 的 word-break: auto-phrase 目前只认日文，
   中文分词用 Intl.Segmenter（自带中文词典）——把每个词包进 nowrap 的
   span，标点并入前一个词，40px 的大字就不会在「验收」中间折行。
   只处理展示级文字；正文 16px 行内断字是中文排版的常规，不动。
   ------------------------------------------------------------ */

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("zh-Hans", { granularity: "word" })
    : null;

function phraseWrap(root) {
  if (!segmenter) return;
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent.trim()) return;
        const groups = [];
        for (const item of segmenter.segment(child.textContent)) {
          if (item.isWordLike || !groups.length) groups.push(item.segment);
          else groups[groups.length - 1] += item.segment; // 标点跟着前一个词
        }
        const fragment = document.createDocumentFragment();
        groups.forEach((group) => {
          const span = document.createElement("span");
          span.className = "pw";
          span.textContent = group;
          fragment.appendChild(span);
        });
        child.replaceWith(fragment);
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains("pill")) {
        walk(child);
      }
    });
  };
  walk(root);
}

/* ------------------------------------------------------------
   滚动逐字点亮（签名交互，只用在封面）

   每个词一个带颜色过渡的 span，随滚动逐个变深。
   中文没有词间空格，就按字切；拉丁字母和数字保持整词。
   ------------------------------------------------------------ */

function splitChunks(root) {
  const chunks = [];
  const makeChunk = (text) => {
    const span = document.createElement("span");
    span.className = "rv";
    span.textContent = text;
    chunks.push(span);
    return span;
  };

  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        let latin = "";
        const flush = () => {
          if (latin) {
            fragment.appendChild(makeChunk(latin));
            latin = "";
          }
        };
        for (const ch of child.textContent) {
          if (/\s/.test(ch)) {
            flush();
            fragment.appendChild(document.createTextNode(ch));
          } else if (/[a-zA-Z0-9@#&%$._\-+/]/.test(ch)) {
            latin += ch;
          } else {
            flush();
            fragment.appendChild(makeChunk(ch));
          }
        }
        flush();
        child.replaceWith(fragment);
      } else if (
        child.nodeType === Node.ELEMENT_NODE &&
        !child.classList.contains("pill") &&
        !child.classList.contains("mark")
      ) {
        walk(child);
      }
    });
  };

  walk(root);
  return chunks;
}

/* 阅读进度条：页面滚动比例映射到顶部 2px 蓝条的 scaleX */
function initReadbar() {
  const fill = dom.app.querySelector(".readbar__fill");
  if (!fill) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    fill.style.transform = `scaleX(${p.toFixed(4)})`;
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  update();
  state.cleanup.push(() => {
    window.removeEventListener("scroll", onScroll);
    if (raf) cancelAnimationFrame(raf);
  });
}

/* 左侧章节目录：把当前篇滚到栏内可见位置（只滚栏本身，不动页面），
   并接管「收起成悬浮小签 / 固定展开」的切换，状态记在本地 */
function initRail() {
  const rail = dom.app.querySelector(".rail");
  if (!rail) return;
  const panel = rail.querySelector(".rail__panel");

  const scrollToCurrent = () => {
    const current = rail.querySelector(".is-current");
    if (!panel || !current || !panel.clientHeight) return;
    const offset =
      current.getBoundingClientRect().top -
      panel.getBoundingClientRect().top -
      panel.clientHeight / 3;
    if (offset > 0) panel.scrollTop += offset;
  };

  const store = (open) => {
    try {
      localStorage.setItem(RAIL_KEY, open ? "1" : "0");
    } catch (e) {}
  };

  if (rail.classList.contains("is-collapsed")) {
    /* 收起态下悬停临时展开时，第一次再对位 */
    rail.addEventListener("mouseenter", () => requestAnimationFrame(scrollToCurrent), { once: true });
  } else {
    scrollToCurrent();
  }

  /* 标题栏按钮双向切换：展开态点击收起，收起态（悬停浮层里）点击固定展开 */
  const toggle = rail.querySelector("[data-rail-collapse]");
  const syncToggle = () => {
    const collapsed = rail.classList.contains("is-collapsed");
    const label = collapsed ? "固定展开目录" : "收起目录";
    toggle?.setAttribute("aria-label", label);
    toggle?.setAttribute("title", label);
  };
  syncToggle();
  toggle?.addEventListener("click", () => {
    const collapsed = rail.classList.toggle("is-collapsed");
    store(!collapsed);
    syncToggle();
    if (!collapsed) requestAnimationFrame(scrollToCurrent);
  });
  rail.querySelector("[data-rail-pin]")?.addEventListener("click", () => {
    rail.classList.remove("is-collapsed");
    store(true);
    syncToggle();
    requestAnimationFrame(scrollToCurrent);
  });
}

/* 侧边目录的滚动跟随：阅读线（视口顶部下 160px）扫过哪个小节，就点亮哪条 */
function initSidetoc() {
  const side = dom.app.querySelector(".sidetoc");
  if (!side) return;
  const links = [...side.querySelectorAll("a")];
  const heads = links
    .map((a) => document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))))
    .filter(Boolean);
  if (heads.length !== links.length || !heads.length) return;

  let raf = 0;
  const update = () => {
    raf = 0;
    const line = 160;
    let active = -1;
    heads.forEach((head, i) => {
      if (head.getBoundingClientRect().top <= line) active = i;
    });
    links.forEach((a, i) => a.classList.toggle("is-active", i === active));
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  update();
  state.cleanup.push(() => {
    window.removeEventListener("scroll", onScroll);
    if (raf) cancelAnimationFrame(raf);
  });
}

function initReveal() {
  if (
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    matchMedia("(max-width: 720px), (pointer: coarse)").matches
  )
    return;

  const blocks = [...dom.app.querySelectorAll(".reveal")].map((el) => ({
    el,
    chunks: splitChunks(el),
    lit: 0,
  }));
  if (!blocks.length) return;

  let raf = 0;

  const update = () => {
    raf = 0;
    const vh = window.innerHeight;
    blocks.forEach((block) => {
      const top = block.el.getBoundingClientRect().top;
      const docTop = top + window.scrollY;
      // 首屏第一句走得快：一滚就开始，约 1/3 屏的距离全亮；
      // 折叠线以下的块维持原节奏：越过视口 92% 处开始，55% 屏距走完
      const fast = block.el.classList.contains("reveal--blue");
      const progress =
        docTop <= vh
          ? window.scrollY / (vh * (fast ? 0.3 : 0.55))
          : (vh * 0.92 - top) / (vh * 0.55);
      const lit = Math.round(Math.min(1, Math.max(0, progress)) * block.chunks.length);
      if (lit === block.lit) return;
      if (lit > block.lit) {
        for (let i = block.lit; i < lit; i += 1) block.chunks[i].classList.add("lit");
      } else {
        for (let i = lit; i < block.lit; i += 1) block.chunks[i].classList.remove("lit");
      }
      block.lit = lit;
    });
  };

  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();

  state.cleanup.push(() => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    if (raf) cancelAnimationFrame(raf);
  });
}

/* ------------------------------------------------------------
   回流条：页眉随页面滚走后，向上滚动时从顶部滑入
   ------------------------------------------------------------ */

const pinbar = document.getElementById("pinbar");

function hidePinbar() {
  if (pinbar) pinbar.dataset.show = "false";
}

function initPinbar() {
  if (!pinbar) return;
  let lastY = window.scrollY;
  let raf = 0;

  const update = () => {
    raf = 0;
    const y = window.scrollY;
    const delta = y - lastY;
    if (Math.abs(delta) < 6) return;
    lastY = y;
    if (y < 480 || delta > 0) hidePinbar();
    else pinbar.dataset.show = "true";
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!raf) raf = requestAnimationFrame(update);
    },
    { passive: true }
  );
}

/* ------------------------------------------------------------
   页内锚点：hash 被路由占用，标题锚点与本页目录改为拦截滚动
   ------------------------------------------------------------ */

function initAnchors() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    if ("resume" in link.dataset) state.resumePending = true; // 渲染后恢复滚动位置
    const href = link.getAttribute("href");
    if (href.startsWith("#/")) return; // 交给路由
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

/* ------------------------------------------------------------
   搜索浮层
   ------------------------------------------------------------ */

const searchState = { active: 0, results: [] };

function openSearch() {
  if (!dom.search) return;
  dom.search.__prevFocus = document.activeElement;
  dom.search.dataset.open = "true";
  document.body.classList.add("is-locked");
  dom.searchInput.value = "";
  renderSearchResults([]);
  dom.searchInput.focus();
}

function closeSearch() {
  if (!dom.search || dom.search.dataset.open !== "true") return;
  dom.search.dataset.open = "false";
  document.body.classList.remove("is-locked");
  dom.searchInput.blur();
  if (dom.search.__prevFocus?.isConnected) dom.search.__prevFocus.focus();
}

function isSearchOpen() {
  return dom.search?.dataset.open === "true";
}

function renderSearchResults(results, terms = []) {
  searchState.results = results;
  searchState.active = 0;

  dom.searchResults.innerHTML = results
    .map(
      ({ entry, snippet }, i) => `
        <li class="search__item" role="option" aria-selected="${i === 0}" data-token="${entry.token}">
          <p class="search__item-title">
            ${highlight(entry.title, terms)}${
        entry.part ? `<span class="search__item-part">${escapeHtml(entry.part)}</span>` : ""
      }
          </p>
          ${snippet ? `<p class="search__item-snippet">${highlight(snippet, terms)}</p>` : ""}
        </li>`
    )
    .join("");

  const query = dom.searchInput.value.trim();
  dom.searchHint.textContent = !query
    ? `↑↓ 选择 · 回车打开 · 共 ${state.counts?.docs ?? ""} 篇可检索`
    : results.length
    ? `${results.length} 条结果${results.length === 20 ? "（只显示前 20 条）" : ""}`
    : "没有找到，换个关键词试试";
}

function setActiveResult(next) {
  const items = [...dom.searchResults.children];
  if (!items.length) return;
  searchState.active = (next + items.length) % items.length;
  items.forEach((item, i) => item.setAttribute("aria-selected", String(i === searchState.active)));
  items[searchState.active].scrollIntoView({ block: "nearest" });
}

function openResult(index) {
  const item = dom.searchResults.children[index];
  if (!item) return;
  closeSearch();
  navigate(`#/p/${shortId(item.dataset.token)}`);
}

function initSearch() {
  if (!dom.search) return;

  // 事件委托：书封上的搜索按钮是随路由重渲染的
  document.addEventListener("click", (event) => {
    if (event.target.closest("#btn-search, [data-search]")) openSearch();
  });

  // 点面板外关闭
  dom.search.addEventListener("mousedown", (event) => {
    if (!event.target.closest(".search__panel")) closeSearch();
  });

  dom.searchInput.addEventListener("input", () => {
    const query = dom.searchInput.value;
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    renderSearchResults(terms.length ? searchDocs(query) : [], terms);
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult(searchState.active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult(searchState.active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openResult(searchState.active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  });

  dom.searchResults.addEventListener("click", (event) => {
    const item = event.target.closest(".search__item");
    if (item) openResult([...dom.searchResults.children].indexOf(item));
  });

  // ⌘K / Ctrl+K 全局呼出
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      isSearchOpen() ? closeSearch() : openSearch();
    }
  });
}

/* ------------------------------------------------------------
   图片放大
   ------------------------------------------------------------ */

let lightbox = null;

function openLightbox(src, alt) {
  if (!src) return;
  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.innerHTML = `<img alt="" /><p class="lightbox__cap"></p>`;
    lightbox.addEventListener("click", closeLightbox);
    document.body.appendChild(lightbox);
  }
  const image = lightbox.querySelector("img");
  image.src = src;
  image.alt = alt || "";
  lightbox.querySelector(".lightbox__cap").textContent = alt || "";
  lightbox.dataset.open = "true";
  document.body.classList.add("is-locked");
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.dataset.open = "false";
  document.body.classList.remove("is-locked");
}

/* ------------------------------------------------------------
   键盘
   ------------------------------------------------------------ */

function initKeyboard() {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (event.key === "Escape") {
      closeLightbox();
      closeSearch();
      closeShareBox();
      closeGroupBox();
      return;
    }

    if (state.route.name !== "doc") return;
    const index = state.flat.findIndex((item) => shortId(item.doc.nodeToken) === state.route.id);
    if (index < 0) return;

    if (event.key === "[" || event.key === "ArrowLeft") {
      const prev = state.flat[index - 1];
      if (prev) {
        event.preventDefault();
        navigate(docHref(prev.doc), true);
      }
    } else if (event.key === "]" || event.key === "ArrowRight") {
      const next = state.flat[index + 1];
      if (next) {
        event.preventDefault();
        navigate(docHref(next.doc), true);
      }
    }
  });
}

/* ------------------------------------------------------------
   启动
   ------------------------------------------------------------ */

async function boot() {
  loadRead();
  loadResume();
  initKeyboard();
  initPinbar();
  initAnchors();
  initSearch();

  // 交流群入口：悬浮在当前按钮附近；再次点击、点空白或按 Esc 均关闭
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-group]");
    if (trigger) {
      event.preventDefault();
      if (groupbox?.dataset.open === "true" && groupboxTrigger === trigger) closeGroupBox();
      else openGroupBox(trigger);
      return;
    }
    if (groupbox?.dataset.open === "true" && !event.target.closest(".groupbox")) closeGroupBox();
  });
  window.addEventListener("resize", () => positionGroupBox(groupboxTrigger));
  window.addEventListener("scroll", () => positionGroupBox(groupboxTrigger), { passive: true });

  try {
    const response = await fetch(versionedAsset("content/site-content.json"), {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buildModel(await response.json());
  } catch (error) {
    showLoadError(error);
    return;
  }

  if (dom.chipCount) dom.chipCount.textContent = `${state.counts.docs} 篇`;
  if (dom.searchHint)
    dom.searchHint.textContent = `↑↓ 选择 · 回车打开 · 共 ${state.counts.docs} 篇可检索`;

  window.addEventListener("hashchange", render);
  render();
  dom.app.hidden = false;
  document.body.classList.remove("is-booting");
}

boot();
