// 零依賴 XML 解析器：只支援 Aras SOAP 回應會出現的子集
// （元素、屬性、文字、實體、CDATA、註解、處理指令/宣告）。不支援 DTD。
// 回傳的節點相容 @xmldom/xmldom 的 DOM 子集。

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        throw new Error(`XML 解析錯誤：無效的字元參照 ${m}`);
      }
    }
    if (e in ENTITIES) return ENTITIES[e];
    throw new Error(`XML 解析錯誤：未知的實體 ${m}`);
  });
}

class XmlText {
  constructor(text) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this.textContent = text;
    this.data = text;
  }
}

export class XmlElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName;
    this.nodeName = tagName;
    this.attributes = {};
    this.childNodes = [];
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  get textContent() {
    let out = '';
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }

  getElementsByTagName(tag) {
    const out = [];
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue;
        if (tag === '*' || c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const NAME = /[^\s/>=]+/y;

export function parseXml(xml) {
  if (typeof xml !== 'string') throw new Error('XML 解析錯誤：輸入必須是字串');
  const stack = [];
  let root = null;
  let i = 0;
  const n = xml.length;
  const fail = (msg) => {
    throw new Error(`XML 解析錯誤：${msg}（位置 ${i}）`);
  };

  while (i < n) {
    if (xml[i] !== '<') {
      const end = xml.indexOf('<', i);
      const raw = xml.slice(i, end === -1 ? n : end);
      if (stack.length) {
        stack[stack.length - 1].childNodes.push(new XmlText(decode(raw)));
      } else if (raw.trim() !== '') {
        fail('根元素之外有文字');
      }
      i = end === -1 ? n : end;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) fail('註解未結束');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) fail('CDATA 未結束');
      if (!stack.length) fail('CDATA 在根元素之外');
      stack[stack.length - 1].childNodes.push(new XmlText(xml.slice(i + 9, end)));
      i = end + 3;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) fail('處理指令未結束');
      i = end + 2;
    } else if (xml.startsWith('<!', i)) {
      fail('不支援 DTD/DOCTYPE');
    } else if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i);
      if (end === -1) fail('結束標籤未結束');
      const name = xml.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.tagName !== name) fail(`結束標籤 </${name}> 不匹配`);
      i = end + 1;
    } else {
      i++;
      NAME.lastIndex = i;
      const m = NAME.exec(xml);
      if (!m) fail('標籤名稱缺失');
      const el = new XmlElement(m[0]);
      i += m[0].length;
      let selfClose = false;
      for (;;) {
        while (i < n && /\s/.test(xml[i])) i++;
        if (i >= n) fail('標籤未結束');
        if (xml[i] === '>') { i++; break; }
        if (xml[i] === '/' && xml[i + 1] === '>') { i += 2; selfClose = true; break; }
        NAME.lastIndex = i;
        const a = NAME.exec(xml);
        if (!a) fail('屬性名稱無效');
        i += a[0].length;
        while (i < n && /\s/.test(xml[i])) i++;
        if (xml[i] !== '=') fail(`屬性 ${a[0]} 缺少 =`);
        i++;
        while (i < n && /\s/.test(xml[i])) i++;
        const q = xml[i];
        if (q !== '"' && q !== "'") fail(`屬性 ${a[0]} 缺少引號`);
        const end = xml.indexOf(q, i + 1);
        if (end === -1) fail('屬性值未結束');
        el.attributes[a[0]] = decode(xml.slice(i + 1, end));
        i = end + 1;
      }
      if (stack.length) stack[stack.length - 1].childNodes.push(el);
      else if (root) fail('多個根元素');
      else root = el;
      if (!selfClose) stack.push(el);
    }
  }
  if (stack.length) fail(`標籤 <${stack[stack.length - 1].tagName}> 未結束`);
  if (!root) fail('沒有根元素');
  // 與 DOM Document 一致：回傳 document 節點，根元素在 documentElement / childNodes[0]，
  // 因此 getElementsByTagName 也找得到根元素本身。
  const doc = new XmlElement('#document');
  doc.nodeType = 9;
  doc.childNodes.push(root);
  doc.documentElement = root;
  return doc;
}
