// 輕量 HTML 消毒（無外部相依）——防止儲存型 XSS。
//
// 用途：文件中心內文、許願池描述等 contentEditable 富文字，會被 dangerouslySetInnerHTML
//   渲染。若不消毒，任何使用者可貼入 <script>、<img onerror>、javascript: 連結等，
//   在其他人（含管理者）已登入的瀏覽器執行。
//
// 作法：用瀏覽器內建 DOMParser 解析成 DOM，再依白名單保留標籤/屬性，
//   丟掉 script/style/事件處理器(onXXX)/危險 URL。採後序處理，被展開的節點也會先被清。
//
// 註：理想上改用 DOMPurify（更完整、對付各種繞過），但那需要新增相依與更新 lock；
//   此版本涵蓋主要向量，作為內部系統的務實加固。若日後加 DOMPurify，替換此函式即可。

const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "span", "div", "a",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
  "code", "hr", "table", "thead", "tbody", "tr", "th", "td", "img",
]);

const ALLOWED_ATTR: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  span: new Set(["style"]),
  div: new Set(["style"]),
  p: new Set(["style"]),
  td: new Set(["colspan", "rowspan", "style"]),
  th: new Set(["colspan", "rowspan", "style"]),
};
const GLOBAL_ATTR = new Set(["class"]);

// 允許的 URL 開頭：http(s)/mailto/tel/file、站內相對、錨點、以及 base64 圖片。
const SAFE_URL = /^(https?:|mailto:|tel:|file:|\/|#|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;

function cleanAttrs(el: Element, tag: string) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value ?? "";
    if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; } // 事件處理器一律拿掉
    const allowed = GLOBAL_ATTR.has(name) || (ALLOWED_ATTR[tag]?.has(name) ?? false);
    if (!allowed) { el.removeAttribute(attr.name); continue; }
    if ((name === "href" || name === "src") && !SAFE_URL.test(value.trim())) { el.removeAttribute(attr.name); continue; }
    if (name === "style" && /(expression|javascript:|url\s*\()/i.test(value)) { el.removeAttribute(attr.name); continue; }
  }
  if (tag === "a") el.setAttribute("rel", "noreferrer noopener");
}

function walk(el: Element) {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      walk(child); // 先清子樹，確保被提升上來的孫節點也已消毒
      child.replaceWith(...Array.from(child.childNodes)); // 保留文字內容、丟掉不允許的標籤
      continue;
    }
    cleanAttrs(child, tag);
    walk(child);
  }
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(String(dirty), "text/html");
  walk(doc.body);
  return doc.body.innerHTML;
}
