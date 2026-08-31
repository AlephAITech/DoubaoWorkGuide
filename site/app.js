const main = document.querySelector("#main-content");
const searchDialog = document.querySelector(".search-dialog");
const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector(".search-results");
const imageDialog = document.querySelector(".image-dialog");
const menuToggle = document.querySelector(".menu-toggle");
const sidebarScrim = document.querySelector(".sidebar-scrim");
const progressBar = document.querySelector(".reading-progress span");

const state = {
  data: null,
  docs: [],
  byToken: new Map(),
  children: new Map(),
  searchable: [],
  searchSelection: 0,
  observer: null,
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function safeUrl(value = "") {
  try {
    const url = new URL(value, window.location.origin);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return "#";
    return escapeHtml(url.href);
  } catch {
    return value.startsWith("/") || value.startsWith("#") ? escapeHtml(value) : "#";
  }
}

function textOnly(markdown = "") {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/::video\[([^\]]*)\]\([^)]+\)/g, (_, title) => `${decodeURIComponent(title)} `)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1 ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<\/?(?:grid|column)(?:\s+[^>]*)?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleParts(title) {
  const parts = title.split("｜").map((part) => part.trim()).filter(Boolean);
  return { label: parts[0] || title, detail: parts[1] || "从真实任务开始，边做边学" };
}

function descendants(token) {
  const result = [];
  const visit = (parent) => {
    for (const child of state.children.get(parent) || []) {
      result.push(child);
      visit(child.nodeToken);
    }
  };
  visit(token);
  return result;
}

function ancestors(doc) {
  const result = [];
  let cursor = doc;
  while (cursor?.parentToken) {
    cursor = state.byToken.get(cursor.parentToken);
    if (cursor) result.unshift(cursor);
  }
  return result;
}

function firstReadable(token) {
  return descendants(token).find((doc) => doc.content && doc.content.trim().length > 20) || state.byToken.get(token);
}

function readingDocuments() {
  return state.docs.filter((doc) => doc.depth >= 2 && doc.content && doc.content.trim().length > 20);
}

function formatDate(value, full = false) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: full ? "long" : "2-digit",
    day: "2-digit",
    ...(full ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function iconArrow() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`;
}

function rootDocument() {
  return state.docs.find((doc) => !doc.parentToken) || state.docs[0];
}

function renderHome() {
  document.body.classList.remove("reader-mode");
  document.body.classList.add("home-mode");
  closeMobileSidebar();
  progressBar.style.width = "0";
  document.title = "豆包工作指南";

  const root = rootDocument();
  const sections = state.children.get(root.nodeToken) || [];
  const start = firstReadable(sections[0]?.nodeToken || root.nodeToken);
  const visuals = state.docs.reduce((sum, doc) =>
    sum + (doc.images?.length || 0) + (doc.videos?.length || 0), 0);
  const sectionDescriptions = [
    "下载、界面、任务、Skill、连接器与自动化。先跑通一个能验收的小任务。",
    "从 Word、Excel、文件整理和每日简报这些小事开始，建立手感。",
    "把豆包工作放进个人提效、内容、知识管理、业务与研究场景。",
  ];

  const pathCards = sections.map((section, index) => {
    const part = titleParts(section.title);
    const direct = state.children.get(section.nodeToken) || [];
    const samples = descendants(section.nodeToken).filter((doc) => !doc.hasChild).slice(0, 3);
    const target = firstReadable(section.nodeToken);
    return `
      <a class="path-card" href="#/doc/${target.nodeToken}">
        <span class="path-index">FILE / ${String(index + 1).padStart(2, "0")}</span>
        <h3>${escapeHtml(part.label)}</h3>
        <p>${escapeHtml(sectionDescriptions[index] || part.detail)}</p>
        <ul class="path-samples">${samples.map((doc) => `<li>${escapeHtml(doc.title)}</li>`).join("")}</ul>
        <span class="path-count">${direct.length} 个入口 · ${descendants(section.nodeToken).length} 篇内容 <b>→</b></span>
      </a>`;
  }).join("");

  const pathTabs = sections.map((section, index) => {
    const target = firstReadable(section.nodeToken);
    return `
      <a class="binder-tab tab-${index + 1}" href="#/doc/${target.nodeToken}">
        <strong>${String(index + 1).padStart(2, "0")}</strong>
        <span>${escapeHtml(titleParts(section.title).label.replace(/篇$/, ""))}</span>
      </a>`;
  }).join("");

  const taskSpecs = [
    ["文档交付", /Word|材料.*PPT|排版交付/],
    ["数据处理", /Excel|数据分析/],
    ["会议协作", /一场会议/],
    ["远程执行", /手机.*电脑|出门以后/],
    ["自动化", /定时任务|每天早上自动/],
    ["知识沉淀", /真正能搜|知识库变成/],
  ];
  const leafDocs = state.docs.filter((doc) => !doc.hasChild && doc.depth >= 2);
  const used = new Set();
  const tasks = taskSpecs.map(([tag, pattern]) => {
    const doc = leafDocs.find((item) => !used.has(item.nodeToken) && pattern.test(item.title));
    if (doc) used.add(doc.nodeToken);
    return doc ? { tag, doc } : null;
  }).filter(Boolean);

  const taskCards = tasks.map(({ tag, doc }, index) => `
    <a class="task-card" href="#/doc/${doc.nodeToken}">
      <span class="task-tag">${String(index + 1).padStart(2, "0")} · ${escapeHtml(tag)}</span>
      <h3>${escapeHtml(doc.title)}</h3>
      <span class="task-arrow" aria-hidden="true">↗</span>
    </a>`).join("");

  const heroTaskSpecs = [
    { label: "文档与表格", symbol: "DOC", pattern: /Word|Excel|文档|表格/ },
    { label: "研究与分析", symbol: "LAB", pattern: /研究|调研|分析|洞察/ },
    { label: "内容与创作", symbol: "INK", pattern: /内容|写作|文章|公众号|创作/ },
  ];
  const heroTasks = heroTaskSpecs.map((spec, index) => {
    const doc = leafDocs.find((item) => spec.pattern.test(item.title)) || tasks[index]?.doc || start;
    return `
      <a class="task-slip slip-${index + 1}" href="#/doc/${doc.nodeToken}">
        <span class="slip-head"><small>TASK</small><b>${String(index + 1).padStart(2, "0")}</b></span>
        <span class="slip-body"><i aria-hidden="true">${spec.symbol}</i><strong>${spec.label}</strong></span>
        <span class="eyelet" aria-hidden="true"></span>
      </a>`;
  }).join("");

  const latestCards = tasks.slice(0, 2).map(({ tag, doc }, index) => `
    <a class="update-card update-${index + 1}" href="#/doc/${doc.nodeToken}">
      <span class="paperclip" aria-hidden="true"></span>
      <span class="update-kicker">推荐任务 · ${escapeHtml(tag)}</span>
      <h3>${escapeHtml(doc.title)}</h3>
      <p>${escapeHtml(textOnly(doc.content).slice(0, 76))}${textOnly(doc.content).length > 76 ? "…" : ""}</p>
      <span class="update-foot"><small>REV.${escapeHtml(doc.revisionId)}</small><b>→</b></span>
    </a>`).join("");

  const scenarioSection = sections.find((section) => section.title.includes("场景篇")) || sections.at(-1);
  const scenarios = state.children.get(scenarioSection?.nodeToken) || [];
  const scenarioList = scenarios.map((scenario, index) => {
    const target = firstReadable(scenario.nodeToken);
    const count = descendants(scenario.nodeToken).filter((doc) => !doc.hasChild).length;
    const sample = descendants(scenario.nodeToken).find((doc) => !doc.hasChild);
    return `
      <a class="scenario-item" href="#/doc/${target.nodeToken}">
        <span class="scenario-no">S${String(index + 1).padStart(2, "0")}</span>
        <span><h3>${escapeHtml(scenario.title)}</h3><p>${escapeHtml(sample?.title || "查看这一组实战任务")}</p></span>
        <b>${count} 篇 →</b>
      </a>`;
  }).join("");

  main.innerHTML = `
    <div class="home">
      <section class="hero" aria-labelledby="hero-title">
        <div class="desk-scene">
          <div class="left-tabs">${pathTabs}</div>
          <div class="paper-stack" aria-hidden="true"><i></i><i></i></div>
          <div class="manual-cover">
            <span class="binder-clip" aria-hidden="true"><i></i></span>
            <span class="registration-mark" aria-hidden="true"></span>
            <div class="cover-rule" aria-hidden="true"></div>
            <div class="cover-copy">
              <p class="eyebrow">DOUBAO WORK · FIELD MANUAL</p>
              <h1 id="hero-title">豆包工作<span>指南</span></h1>
              <p class="hero-lede">带着一个真实问题进来<br />完成任务，再把方法留下来</p>
              <div class="cover-meta">
                <span>FIELD MANUAL</span>
                <span>DB-GUIDE / LIVE</span>
                <b>${state.data.nodeCount} NODES · ${visuals} VISUALS</b>
              </div>
            </div>
            <div class="cover-toolkit" aria-hidden="true">
              <span class="toolkit-caption">FIELD KIT / 04</span>
              <span class="tool-sticker tool-prompt">
                <svg viewBox="0 0 64 64">
                  <path d="M10 12h38v28H27L16 49v-9h-6z" />
                  <path d="M19 22h20M19 30h13" />
                  <path d="M49 8v8M45 12h8" />
                </svg>
                <b>PROMPT</b>
              </span>
              <span class="tool-sticker tool-deliver">
                <svg viewBox="0 0 64 64">
                  <path d="M15 8h24l10 10v34H15z" />
                  <path d="M39 8v11h10M23 29h18M23 37h12" />
                  <path d="m37 47 6 6 10-12" />
                </svg>
                <b>DELIVER</b>
              </span>
              <span class="tool-sticker tool-flow">
                <svg viewBox="0 0 64 64">
                  <rect x="7" y="9" width="16" height="13" />
                  <rect x="41" y="42" width="16" height="13" />
                  <path d="M23 15h11c8 0 14 6 14 14v4M41 49H30c-8 0-14-6-14-14v-4" />
                  <path d="m42 28 6 6 6-6M22 36l-6-6-6 6" />
                </svg>
                <b>FLOW</b>
              </span>
              <span class="tool-sticker tool-insight">
                <svg viewBox="0 0 64 64">
                  <path d="M11 46V30M21 46V20M31 46V34" />
                  <path d="M7 48h30" />
                  <circle cx="43" cy="29" r="11" />
                  <path d="m51 37 8 8M39 29l4-5 5 3" />
                </svg>
                <b>INSIGHT</b>
              </span>
              <span class="toolkit-note">ASK · MAKE · LOOP · CHECK</span>
            </div>
            <a class="ribbon-cta" href="#/doc/${start.nodeToken}">
              <span>开始阅读</span>${iconArrow()}
            </a>
            <span class="fold-corner" aria-hidden="true"></span>
          </div>
          <div class="right-slips">${heroTasks}</div>
          <figure class="proof-photo">
            <img src="/assets/intro_doubao_work_task.png" alt="豆包工作执行真实任务的界面" />
            <figcaption>REAL TASK / 01</figcaption>
          </figure>
        </div>
      </section>

      <section class="updates" aria-label="推荐阅读">${latestCards}</section>

      <section class="home-section" id="paths">
        <p class="section-kicker">INDEX / 01—03</p>
        <div class="section-heading">
          <h2>不必从第一页开始</h2>
          <p>不用从第一页顺序读。想先上手、先完成一件小事，或直接进入岗位场景，都有对应入口。</p>
        </div>
        <div class="path-grid">${pathCards}</div>
      </section>

      <section class="task-band" aria-labelledby="task-title">
        <p class="section-kicker">TASK DRAWER / 01—06</p>
        <div class="section-heading">
          <h2 id="task-title">你今天想把哪件事交出去？</h2>
          <p>先选一个有明确输入和输出的任务。做成一次，再把方法沉淀下来。</p>
        </div>
        <div class="task-grid">${taskCards}</div>
      </section>

      <section class="home-section scenario-layout" id="scenarios">
        <div class="scenario-sticky">
          <p class="section-kicker">SCENARIO ARCHIVE</p>
          <h2>把 AI 放进真实工作，而不是停在聊天框</h2>
          <p>每个场景都从实际材料、明确边界和可验收交付物出发。选择离你最近的一组任务。</p>
        </div>
        <div class="scenario-list">${scenarioList}</div>
      </section>

      <footer class="sync-strip">
        <span><strong>持续更新</strong> · 从真实任务出发，把方法留下来</span>
        <span>最近更新于 ${formatDate(state.data.fetchedAt, true)} · 共 ${state.docs.length} 个内容节点</span>
      </footer>
    </div>`;
}

function sidebarHtml(activeDoc) {
  const root = rootDocument();
  const sections = state.children.get(root.nodeToken) || [];
  const activeAncestors = new Set(ancestors(activeDoc).map((doc) => doc.nodeToken));

  return `
    <aside class="doc-sidebar" aria-label="章节目录">
      <p class="sidebar-label">FIELD MANUAL INDEX</p>
      <a class="sidebar-home" href="#/"><span aria-hidden="true">⌂</span> 指南首页</a>
      ${sections.map((section) => {
        const expanded = activeAncestors.has(section.nodeToken) || activeDoc.nodeToken === section.nodeToken;
        const links = descendants(section.nodeToken).map((doc) => {
          const relativeDepth = Math.max(0, doc.depth - section.depth - 1);
          return `<a class="sidebar-link ${doc.nodeToken === activeDoc.nodeToken ? "active" : ""}" style="--depth:${Math.min(relativeDepth, 2)}" href="#/doc/${doc.nodeToken}" ${doc.nodeToken === activeDoc.nodeToken ? 'aria-current="page"' : ""}>${escapeHtml(doc.title)}</a>`;
        }).join("");
        return `
          <section class="sidebar-group ${expanded ? "" : "collapsed"}">
            <button class="sidebar-group-title" type="button" aria-expanded="${expanded}">
              <span>${escapeHtml(titleParts(section.title).label)}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
            </button>
            <div class="sidebar-links">${links}</div>
          </section>`;
      }).join("")}
    </aside>`;
}

function slugify(value, index) {
  const base = textOnly(value).toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
  return base || `section-${index}`;
}

function renderInline(source = "") {
  const tokens = [];
  const keep = (html) => {
    const key = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return key;
  };

  let text = source
    .replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => keep(`<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
      const safe = safeUrl(url);
      const external = /^https?:/i.test(url) ? ' target="_blank" rel="noreferrer"' : "";
      return keep(`<a href="${safe}"${external}>${escapeHtml(label)}</a>`);
    });

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$|[，。！？])/g, "$1<em>$2</em>");

  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function renderMarkdown(markdown, pageTitle) {
  let source = (markdown || "").replaceAll("\r\n", "\n").trim();
  const firstHeading = source.match(/^#\s+(.+)\n?/);
  if (firstHeading && textOnly(firstHeading[1]) === textOnly(pageTitle)) source = source.slice(firstHeading[0].length).trimStart();

  const codeBlocks = [];
  source = source.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim() || "TEXT", code: code.replace(/\n$/, "") });
    return `\n@@CODE_${index}@@\n`;
  });

  const lines = source.split("\n");
  const html = [];
  const toc = [];
  const usedIds = new Set();
  let headingIndex = 0;

  const makeId = (text) => {
    let id = slugify(text, ++headingIndex);
    const base = id;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return id;
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const layoutTag = line.trim();
    if (/^<grid\s*>$/i.test(layoutTag)) {
      html.push('<div class="article-media-grid">');
      index += 1;
      continue;
    }

    const columnOpen = layoutTag.match(/^<column\b([^>]*)>$/i);
    if (columnOpen) {
      const ratioMatch = columnOpen[1].match(/width-ratio\s*=\s*["']?([0-9.]+)/i);
      const parsedRatio = Number(ratioMatch?.[1]);
      const ratio = Number.isFinite(parsedRatio) && parsedRatio > 0 && parsedRatio <= 1 ? parsedRatio : 1;
      html.push(`<div class="article-media-column" style="--column-ratio:${ratio}">`);
      index += 1;
      continue;
    }

    if (/^<\/(?:grid|column)\s*>$/i.test(layoutTag)) {
      html.push("</div>");
      index += 1;
      continue;
    }

    const codeMatch = line.trim().match(/^@@CODE_(\d+)@@$/);
    if (codeMatch) {
      const block = codeBlocks[Number(codeMatch[1])];
      html.push(`<section class="code-block"><div class="code-head"><span>${escapeHtml(block.lang.toUpperCase())}</span><button class="copy-code" type="button">复制</button></div><pre><code>${escapeHtml(block.code)}</code></pre></section>`);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const id = makeId(heading[2]);
      if (level === 2 || level === 3) toc.push({ level, id, text: textOnly(heading[2]) });
      html.push(`<h${level} id="${escapeHtml(id)}">${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    const image = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (image) {
      html.push(`<figure class="article-figure"><img src="${safeUrl(image[2])}" alt="${escapeHtml(image[1] || "豆包工作实战截图")}" loading="lazy" decoding="async" />${image[1] ? `<figcaption>${escapeHtml(image[1])}</figcaption>` : ""}</figure>`);
      index += 1;
      continue;
    }

    const video = line.trim().match(/^::video\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (video) {
      const title = decodeURIComponent(video[1] || "实战演示视频");
      html.push(`<figure class="article-video"><video src="${safeUrl(video[2])}" controls preload="metadata" playsinline aria-label="${escapeHtml(title)}"></video><figcaption>${escapeHtml(title)}</figcaption></figure>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1]?.trim().match(/^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?$/)) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      html.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      html.push("<hr />");
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index];
      const startsBlock = /^(#{1,6})\s+/.test(next) || /^@@CODE_\d+@@$/.test(next.trim()) ||
        /^!\[[^\]]*\]\([^)]+\)$/.test(next.trim()) || /^>\s?/.test(next) ||
        /^::video\[[^\]]*\]\([^)]+\)$/.test(next.trim()) ||
        /^<\/?(?:grid|column)(?:\s+[^>]*)?>$/i.test(next.trim()) ||
        /^\s*([-+*]|\d+[.)])\s+/.test(next) ||
        (next.includes("|") && lines[index + 1]?.trim().match(/^\|?\s*:?-{1,}:?/));
      if (startsBlock) break;
      paragraph.push(next.trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return { html: html.join("\n"), toc };
}

function renderReader(doc) {
  document.body.classList.add("reader-mode");
  document.body.classList.remove("home-mode");
  document.title = `${doc.title} · 豆包工作指南`;
  closeMobileSidebar();

  const trail = ancestors(doc).filter((item) => item.depth > 0);
  const rendered = renderMarkdown(doc.content, doc.title);
  const plain = textOnly(doc.content);
  const minutes = Math.max(1, Math.ceil(plain.length / 450));
  const sequence = readingDocuments();
  const position = sequence.findIndex((item) => item.nodeToken === doc.nodeToken);
  const previous = position > 0 ? sequence[position - 1] : null;
  const next = position >= 0 && position < sequence.length - 1 ? sequence[position + 1] : null;
  const tocHtml = rendered.toc.length ? rendered.toc.map((item) => `<a class="depth-${item.level}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>`).join("") : `<span class="sidebar-label">本页没有二级标题</span>`;

  main.innerHTML = `
    <div class="reader-shell">
      ${sidebarHtml(doc)}
      <article class="article">
        <nav class="breadcrumbs" aria-label="面包屑">
          <a href="#/">首页</a><span>/</span>
          ${trail.map((item) => `<a href="#/doc/${item.nodeToken}">${escapeHtml(titleParts(item.title).label)}</a><span>/</span>`).join("")}
          <span>${escapeHtml(doc.title)}</span>
        </nav>
        <header class="article-header">
          <p class="overline">DOUBAO WORK · FIELD NOTE</p>
          <h1>${escapeHtml(doc.title)}</h1>
          <div class="article-meta">
            <span>约 ${minutes} 分钟阅读</span>
            <span>修订版本 ${doc.revisionId}</span>
            <span>${doc.images?.length || 0} 张图片${doc.videos?.length ? ` · ${doc.videos.length} 段视频` : ""}</span>
          </div>
        </header>
        <div class="article-body">${rendered.html || "<p>这个章节正在补充内容。</p>"}</div>
        <nav class="article-nav" aria-label="上一篇和下一篇">
          ${previous ? `<a href="#/doc/${previous.nodeToken}"><small>← 上一篇</small><b>${escapeHtml(previous.title)}</b></a>` : "<span></span>"}
          ${next ? `<a class="next" href="#/doc/${next.nodeToken}"><small>下一篇 →</small><b>${escapeHtml(next.title)}</b></a>` : ""}
        </nav>
      </article>
      <aside class="toc" aria-label="本页目录"><p class="toc-title">本页目录</p>${tocHtml}</aside>
    </div>`;

  bindReaderEvents();
}

function bindReaderEvents() {
  document.querySelectorAll(".sidebar-group-title").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".sidebar-group");
      group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!group.classList.contains("collapsed")));
    });
  });

  document.querySelectorAll(".sidebar-link").forEach((link) => link.addEventListener("click", closeMobileSidebar));
  document.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block").querySelector("code").textContent;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "已复制";
      } catch {
        button.textContent = "复制失败";
      }
      window.setTimeout(() => { button.textContent = "复制"; }, 1600);
    });
  });

  document.querySelectorAll(".article-figure img").forEach((image) => {
    image.addEventListener("click", () => {
      imageDialog.querySelector("img").src = image.currentSrc || image.src;
      imageDialog.querySelector("img").alt = image.alt;
      imageDialog.querySelector("figcaption").textContent = image.alt;
      imageDialog.showModal();
    });
  });

  if (state.observer) state.observer.disconnect();
  const tocLinks = [...document.querySelectorAll(".toc a")];
  const headings = tocLinks.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1)))).filter(Boolean);
  if (headings.length) {
    state.observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      tocLinks.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
    }, { rootMargin: "-90px 0px -72% 0px", threshold: [0, 1] });
    headings.forEach((heading) => state.observer.observe(heading));
  }
}

function route() {
  if (!state.data) return;
  const hash = window.location.hash || "#/";
  const docMatch = hash.match(/^#\/doc\/([^/?#]+)/);
  if (docMatch) {
    const doc = state.byToken.get(docMatch[1]);
    if (doc) renderReader(doc);
    else renderNotFound();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  const inPageTarget = hash.startsWith("#") && !hash.startsWith("#/")
    ? document.getElementById(hash.slice(1))
    : null;
  if (inPageTarget && main.querySelector(".reader-shell")) {
    inPageTarget.scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (!main.querySelector(".home")) renderHome();
  const targetId = hash.startsWith("#") && !hash.startsWith("#/") ? hash.slice(1) : "";
  if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" }));
  else window.scrollTo({ top: 0, behavior: "instant" });
}

function renderNotFound() {
  document.body.classList.remove("reader-mode");
  main.innerHTML = `<section class="error-state"><h1>这一页暂时找不到</h1><p>内容目录可能刚刚调整过层级。</p><a href="#/">返回指南首页</a></section>`;
}

function openSearch() {
  state.searchSelection = 0;
  searchInput.value = "";
  renderSearchResults("");
  searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

function scoreSearch(item, query) {
  const title = item.title.toLowerCase();
  const text = item.text.toLowerCase();
  if (!query) return item.depth >= 2 ? 1 : 0;
  let score = 0;
  if (title === query) score += 100;
  if (title.includes(query)) score += 40;
  const occurrences = text.split(query).length - 1;
  score += Math.min(occurrences, 8) * 4;
  for (const term of query.split(/\s+/).filter(Boolean)) {
    if (title.includes(term)) score += 12;
    if (text.includes(term)) score += 2;
  }
  return score;
}

function excerptFor(text, query) {
  if (!query) return text.slice(0, 90);
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, index - 35);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 100)}${start + 100 < text.length ? "…" : ""}`;
}

function renderSearchResults(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  const matches = state.searchable
    .map((item) => ({ ...item, score: scoreSearch(item, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 10);

  state.searchSelection = Math.min(state.searchSelection, Math.max(0, matches.length - 1));
  searchResults.innerHTML = matches.length ? matches.map((item, index) => `
    <button class="search-result ${index === state.searchSelection ? "selected" : ""}" type="button" role="option" data-token="${item.token}" aria-selected="${index === state.searchSelection}">
      <span class="result-index">${String(index + 1).padStart(2, "0")}</span>
      <span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(excerptFor(item.text, query))}</p></span>
    </button>`).join("") : `<div class="search-empty">没有找到相关章节，换一个任务或工具名称试试。</div>`;

  searchResults.querySelectorAll(".search-result").forEach((button) => {
    button.addEventListener("click", () => {
      searchDialog.close();
      window.location.hash = `#/doc/${button.dataset.token}`;
    });
  });
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = current;
  localStorage.setItem("doubao-guide-theme", current);
}

function setupTheme() {
  document.documentElement.dataset.theme = "light";
}

function openMobileSidebar() {
  const sidebar = document.querySelector(".doc-sidebar");
  if (!sidebar) return;
  sidebar.classList.add("open");
  sidebarScrim.hidden = false;
  menuToggle.setAttribute("aria-expanded", "true");
}

function closeMobileSidebar() {
  document.querySelector(".doc-sidebar")?.classList.remove("open");
  sidebarScrim.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
}

function updateReadingProgress() {
  const article = document.querySelector(".article");
  if (!article) { progressBar.style.width = "0"; return; }
  const start = article.offsetTop - 90;
  const total = Math.max(1, article.scrollHeight - window.innerHeight + 130);
  const progress = Math.min(1, Math.max(0, (window.scrollY - start) / total));
  progressBar.style.width = `${progress * 100}%`;
}

async function init() {
  setupTheme();
  try {
    const response = await fetch(`/content/site-content.json?fresh=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.docs = state.data.documents;
    state.docs.forEach((doc) => {
      state.byToken.set(doc.nodeToken, doc);
      if (!state.children.has(doc.parentToken)) state.children.set(doc.parentToken, []);
      state.children.get(doc.parentToken).push(doc);
    });
    state.searchable = state.docs.filter((doc) => doc.depth >= 2).map((doc, index) => ({
      token: doc.nodeToken,
      title: doc.title,
      text: textOnly(doc.content),
      depth: doc.depth,
      index,
    }));
    route();
  } catch (error) {
    console.error(error);
    main.innerHTML = `<section class="error-state"><h1>内容没有加载成功</h1><p>请确认本地服务从 site 目录启动，并且内容数据已经生成。</p></section>`;
  }
}

document.querySelectorAll(".search-trigger").forEach((button) => button.addEventListener("click", openSearch));
document.querySelector(".search-close").addEventListener("click", () => searchDialog.close());
document.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
document.querySelector(".image-close").addEventListener("click", () => imageDialog.close());
menuToggle.addEventListener("click", () => document.querySelector(".doc-sidebar")?.classList.contains("open") ? closeMobileSidebar() : openMobileSidebar());
sidebarScrim.addEventListener("click", closeMobileSidebar);
searchDialog.addEventListener("click", (event) => { if (event.target === searchDialog) searchDialog.close(); });
imageDialog.addEventListener("click", (event) => { if (event.target === imageDialog) imageDialog.close(); });
searchInput.addEventListener("input", () => { state.searchSelection = 0; renderSearchResults(searchInput.value); });
searchInput.addEventListener("keydown", (event) => {
  const results = [...searchResults.querySelectorAll(".search-result")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    state.searchSelection = (state.searchSelection + delta + results.length) % Math.max(1, results.length);
    renderSearchResults(searchInput.value);
    searchResults.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && results.length) {
    event.preventDefault();
    results[state.searchSelection]?.click();
  }
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearch();
  }
});
window.addEventListener("hashchange", route);
window.addEventListener("scroll", updateReadingProgress, { passive: true });

init();
