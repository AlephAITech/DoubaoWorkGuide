/* ============================================================
   markdown.js — 把飞书导出的 Markdown 渲染为阅读页 HTML

   除标准语法外，额外支持内容里出现的这几种块：
   · <title>…</title>            文档标题（与页面标题重复，丢弃）
   · <grid> / <column>           多图并排
   · <callout emoji="…">         提示块
   · ::video[标题](路径)          本地视频
   · <sheet …></sheet>           飞书电子表格（无法离线渲染，给出占位）
   ============================================================ */

const BASE = new URL(".", document.baseURI).pathname;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 只允许站内相对路径与 http(s)，其余一律丢弃 */
export function safeUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value)) return escapeHtml(value);
  if (value.startsWith("/")) return escapeHtml(BASE + value.slice(1));
  if (/^[\w./-]/.test(value)) return escapeHtml(value);
  return "";
}

/** 去掉行内标记，用于目录与摘要 */
export function plainText(md) {
  return String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text, used) {
  const base =
    plainText(text)
      .toLowerCase()
      .replace(/[\s]+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  if (!used) return base;
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}-${i++}`;
  used.add(id);
  return id;
}

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const src = safeUrl(url);
    return src ? `<img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />` : "";
  });
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(label);
    const external = /^https?:/i.test(url);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

/** 中文软换行不该变成空格，西文之间才补空格 */
function joinLines(lines) {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    const a = acc[acc.length - 1];
    const b = line[0];
    return CJK.test(a) || CJK.test(b) ? acc + line : `${acc} ${line}`;
  }, "");
}

function figure(url, alt) {
  const src = safeUrl(url);
  if (!src) return "";
  const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : "";
  return `<figure class="figure"><button class="figure__frame" type="button" data-zoom="${src}" data-alt="${escapeHtml(
    alt || ""
  )}"><img src="${src}" alt="${escapeHtml(alt || "指南截图")}" loading="lazy" decoding="async" /></button>${caption}</figure>`;
}

const CODE_LABELS = {
  text: "提示词",
  plaintext: "提示词",
  "plain text": "提示词",
  markdown: "Markdown",
  json: "JSON",
  html: "HTML",
  python: "Python",
  mermaid: "Mermaid",
};

function codeCard(lang, lines) {
  const key = lang.trim().toLowerCase();
  const label = CODE_LABELS[key] || (key ? lang.trim() : "提示词");
  const isPrompt = label === "提示词";
  const body = escapeHtml(lines.join("\n"));
  return `<div class="codecard${isPrompt ? " codecard--prompt" : ""}">
      <div class="codecard__bar">
        <span class="codecard__label">${escapeHtml(label)}</span>
        <button class="copybtn" type="button" data-copy>复制</button>
      </div>
      <pre><code>${body}</code></pre>
    </div>`;
}

const TABLE_SEP = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?$/;

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * @param {string} markdown 正文
 * @param {string} title    文档标题（用于丢弃重复的一级标题）
 * @returns {{html: string, toc: Array<{level: number, id: string, text: string}>}}
 */
export function renderMarkdown(markdown, title = "") {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  const toc = [];
  const usedIds = new Set();

  // 正文里最浅的标题层级映射为 h2，其余依次下降，最深到 h4
  const levels = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!m) return;
    const isDocTitle = m[1].length === 1 && plainText(m[2]) === plainText(title) && i < 3;
    if (!isDocTitle) levels.push(m[1].length);
  });
  const minLevel = levels.length ? Math.min(...levels) : 1;

  let i = 0;
  let gridCells = null;

  const flushGrid = () => {
    if (!gridCells) return;
    const cells = gridCells.filter(Boolean);
    if (cells.length) {
      const cols = Math.min(cells.length, 3);
      html.push(`<div class="mediagrid" data-cols="${cols}">${cells.join("")}</div>`);
    }
    gridCells = null;
  };

  const push = (chunk) => {
    if (!chunk) return;
    if (gridCells) gridCells.push(chunk);
    else html.push(chunk);
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    // ---- 结构性自定义标签 ----
    if (/^<title>/i.test(line)) {
      i += 1;
      continue;
    }

    if (/^<grid\s*>$/i.test(line)) {
      flushGrid();
      gridCells = [];
      i += 1;
      continue;
    }

    if (/^<\/grid\s*>$/i.test(line)) {
      flushGrid();
      i += 1;
      continue;
    }

    if (/^<\/?column(\s[^>]*)?>$/i.test(line)) {
      i += 1;
      continue;
    }

    if (/^<sheet[\s>]/i.test(line)) {
      push(`<p class="placeholder">此处为飞书电子表格，需在原文档中查看。</p>`);
      i += 1;
      continue;
    }

    const callout = /^<callout(?:\s+emoji="([^"]*)")?\s*>$/i.exec(line);
    if (callout) {
      const inner = [];
      i += 1;
      while (i < lines.length && !/^<\/callout\s*>$/i.test(lines[i].trim())) {
        inner.push(lines[i]);
        i += 1;
      }
      i += 1;
      const icon = callout[1] || "·";
      const body = renderMarkdown(inner.join("\n")).html;
      push(
        `<aside class="callout"><span class="callout__icon" aria-hidden="true">${escapeHtml(
          icon
        )}</span><div class="callout__body">${body}</div></aside>`
      );
      continue;
    }

    // ---- 代码块 ----
    const fence = /^```+\s*(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1] || "";
      const body = [];
      i += 1;
      while (i < lines.length && !/^```+\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      push(codeCard(lang, body));
      continue;
    }

    // ---- 标题 ----
    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      const isDocTitle =
        heading[1].length === 1 && plainText(heading[2]) === plainText(title) && i < 3;
      if (isDocTitle) {
        i += 1;
        continue;
      }
      const level = Math.min(4, 2 + (heading[1].length - minLevel));
      const text = heading[2];
      const id = slugify(text, usedIds);
      if (level <= 3) toc.push({ level, id, text: plainText(text) });
      push(
        `<h${level} id="${id}">${renderInline(text)}<a class="anchor" href="#${id}" aria-label="链接到本节">#</a></h${level}>`
      );
      i += 1;
      continue;
    }

    // ---- 视频 ----
    const video = /^::video\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (video) {
      const src = safeUrl(video[2]);
      if (src) {
        let name = video[1] || "演示视频";
        try {
          name = decodeURIComponent(name);
        } catch (e) {}
        push(
          `<figure class="videocard"><video src="${src}" controls preload="metadata" playsinline></video><figcaption>${escapeHtml(
            name
          )}</figcaption></figure>`
        );
      }
      i += 1;
      continue;
    }

    // ---- 独立图片 ----
    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(line);
    if (image) {
      push(figure(image[2], image[1]));
      i += 1;
      continue;
    }

    // ---- 分隔线 ----
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      push("<hr />");
      i += 1;
      continue;
    }

    // ---- 表格 ----
    if (line.includes("|") && TABLE_SEP.test((lines[i + 1] || "").trim())) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const thead = head.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      const tbody = rows
        .map(
          (row) =>
            `<tr>${head
              .map((_, index) => `<td>${renderInline(row[index] ?? "")}</td>`)
              .join("")}</tr>`
        )
        .join("");
      push(
        `<div class="tablewrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`
      );
      continue;
    }

    // ---- 引用 ----
    if (line.startsWith(">")) {
      const inner = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        inner.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      push(`<blockquote>${renderMarkdown(inner.join("\n")).html}</blockquote>`);
      continue;
    }

    // ---- 列表 ----
    const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (listItem) {
      const [block, next] = collectList(lines, i);
      push(block);
      i = next;
      continue;
    }

    // ---- 段落 ----
    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i];
      const trimmed = current.trim();
      if (
        !trimmed ||
        /^(#{1,6}\s|```|>|::video\[|<\/?(?:grid|column|callout|title|sheet))/i.test(trimmed) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
        /^!\[[^\]]*\]\([^)\s]+\)$/.test(trimmed) ||
        /^(\s*)([-*+]|\d+[.)])\s+/.test(current) ||
        (trimmed.includes("|") && TABLE_SEP.test((lines[i + 1] || "").trim()))
      ) {
        break;
      }
      paragraph.push(trimmed);
      i += 1;
    }
    if (paragraph.length) push(`<p>${renderInline(joinLines(paragraph))}</p>`);
  }

  flushGrid();

  return { html: html.join("\n"), toc };
}

/** 解析（可嵌套的）列表，返回 [html, 下一行索引] */
function collectList(lines, start) {
  const first = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) {
      const following = lines[i + 1] || "";
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(following)) {
        i += 1;
        continue;
      }
      break;
    }
    const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (!match) {
      // 列表项的续行
      if (items.length && raw.search(/\S/) > baseIndent) {
        items[items.length - 1].lines.push(raw.trim());
        i += 1;
        continue;
      }
      break;
    }
    const indent = match[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const [nested, next] = collectList(lines, i);
      if (items.length) items[items.length - 1].children.push(nested);
      i = next;
      continue;
    }
    items.push({ lines: [match[3]], children: [] });
    i += 1;
  }

  const tag = ordered ? "ol" : "ul";
  const body = items
    .map((item) => `<li>${renderInline(joinLines(item.lines))}${item.children.join("")}</li>`)
    .join("");
  return [`<${tag}>${body}</${tag}>`, i];
}
