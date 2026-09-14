import test from "node:test";
import { strict as assert } from "node:assert";

global.document = { baseURI: "http://localhost/" };

const { safeUrl, renderMarkdown, escapeHtml } = await import("../site/js/markdown.js");

test("safeUrl allows http(s), protocol-relative, root, and relative paths", () => {
  const cases = [
    "https://github.com",
    "http://example.com",
    "//example.com",
    "/docs/test",
    "/foo/bar",
    "./image.png",
    "../image.png",
    "relative/path",
    "foo/bar",
    "foo.md",
    "image/test.png",
  ];
  for (const url of cases) {
    assert.equal(safeUrl(url), url);
  }
});

test("safeUrl rejects dangerous URL schemes", () => {
  const cases = [
    "javascript:hello",
    "data:text/html,<script>hello</script>",
    "vbscript:hello",
    "file:///etc/passwd",
    "blob:https://example.com/xxxx",
    "about:blank",
  ];
  for (const url of cases) {
    assert.equal(safeUrl(url), "", url);
  }
});

test("safeUrl rejects dangerous schemes with case variations", () => {
  const cases = [
    "JAVASCRIPT:hello",
    "JaVaScRiPt:hello",
    "DaTa:text/html,hello",
    "VBScript:hello",
    "Blob:https://example.com/xxxx",
    "AbOuT:blank",
  ];
  for (const url of cases) {
    assert.equal(safeUrl(url), "", url);
  }
});

test("safeUrl rejects dangerous schemes with whitespace and percent-encoding bypasses", () => {
  const cases = [
    " javascript:hello",
    "javascript:hello ",
    "javascript%3Ahello",
    "%6A%61%76%61%73%63%72%69%70%74%3Ahello",
  ];
  for (const url of cases) {
    assert.equal(safeUrl(url), "", url);
  }
});

test("renderMarkdown does not emit dangerous href from links", () => {
  const html = renderMarkdown("[x](javascript:hello)").html;
  assert.ok(!/<a href="javascript:/i.test(html), html);
  assert.ok(!/<a href="data:/i.test(html), html);
  assert.ok(!/<a href="vbscript:/i.test(html), html);
  assert.ok(!/<a href="file:/i.test(html), html);
  assert.ok(!/<a href="blob:/i.test(html), html);
  assert.ok(!/<a href="about:/i.test(html), html);
});

test("renderMarkdown does not emit dangerous src from images", () => {
  const html = renderMarkdown("![x](data:image/hello)").html;
  assert.ok(!/<img src="data:/i.test(html), html);
});

test("renderMarkdown does not emit dangerous src from video blocks", () => {
  const html = renderMarkdown("::video[v](javascript:hello)").html;
  assert.ok(!/<video src="javascript:/i.test(html), html);
});

test("renderMarkdown keeps dangerous URLs out of href, src and data-zoom", () => {
  const dangerous = [
    "javascript:alert",
    "JavaScript:alert",
    "JAVASCRIPT:alert",
    "data:text/html,hello",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "blob:https://example.com/x",
    "about:blank",
  ];
  const sink = /(?:href|src|data-zoom)="(?:javascript|data|vbscript|file|blob|about):/i;
  for (const url of dangerous) {
    for (const md of [`[x](${url})`, `![x](${url})`, `::video[v](${url})`]) {
      const html = renderMarkdown(md).html;
      assert.ok(!sink.test(html), `${md} leaked into a URL attribute: ${html}`);
    }
  }
});

test("renderMarkdown still renders normal links and images", () => {
  const link = renderMarkdown("[docs](https://github.com)").html;
  assert.match(link, /<a href="https:\/\/github\.com"/);
  const image = renderMarkdown("![shot](./image.png)").html;
  assert.match(image, /data-zoom="\.\/image\.png"/);
  assert.match(image, /<img src="\.\/image\.png"/);
});

test("safeUrl tolerates malformed percent-encoding without throwing", () => {
  const cases = ["%", "%2", "%ZZ", "%GG", "%3", "%3A", "%25253A", "foo%ZZ"];
  for (const url of cases) {
    assert.doesNotThrow(() => safeUrl(url), url);
  }
});

test("safeUrl applies the URL policy to malformed and encoded values", () => {
  // Values that do not start with a permitted URL character are rejected outright,
  // including stray or double-encoded percent escapes.
  for (const url of ["%", "%2", "%ZZ", "%GG", "%3", "%3A", "%25253A"]) {
    assert.equal(safeUrl(url), "", url);
  }
  // A malformed escape inside an otherwise relative path is preserved (HTML-escaped),
  // not silently dropped.
  assert.equal(safeUrl("foo%ZZ"), "foo%ZZ");
  assert.equal(safeUrl("foo/bar"), "foo/bar");
  // A percent-encoded dangerous scheme is still rejected once decoded.
  assert.equal(safeUrl("javascript%3Aalert(1)"), "");
});

test("renderMarkdown does not emit dangerous href from percent-encoded links", () => {
  const html = renderMarkdown("[x](javascript%3Aalert)").html;
  assert.ok(!/<a\b/i.test(html), html);
  assert.ok(!/href=/i.test(html), html);
});
