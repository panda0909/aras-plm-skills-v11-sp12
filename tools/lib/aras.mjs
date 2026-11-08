import { parseXml } from './xml.mjs';
import { loadConfig } from './config.mjs';

const elements = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 1);

/**
 * 送 AML，回傳 <Result> 底下的元素。查無資料回 []，其他 Fault 一律 throw。
 * 寫入閘門：AML 含任何非 get 的 action 時，必須明確傳 `{ write: true }`，否則在連線與讀設定前就拒絕。
 */
export async function applyAml(aml, { timeout = 120000, fetchImpl = fetch, config, write = false } = {}) {
  const actions = writeActions(aml);
  if (actions.length && write !== true) {
    throw new Error(
      `拒絕執行：AML 含寫入動作（${[...new Set(actions)].join(', ')}）。` +
        '寫入請走 aras.mjs aml <檔> --write，或在腳本中明確傳 { write: true }（須先完成 aras-live-write 流程）',
    );
  }
  const cfg = config ?? loadConfig();
  const body =
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>' +
    `<ApplyAML>${aml}</ApplyAML></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  let raw;
  let status;
  try {
    const res = await fetchImpl(cfg.server, {
      method: 'POST',
      headers: {
        DATABASE: cfg.database,
        AUTHUSER: cfg.user,
        AUTHPASSWORD: cfg.passwordHash,
        SOAPACTION: 'ApplyAML',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    // 錯誤物件可能夾帶 headers（含 AUTHPASSWORD）→ 只重拋訊息，並遮掉雜湊
    let msg = String(e?.message ?? e);
    if (cfg.passwordHash) msg = msg.split(cfg.passwordHash).join('***');
    throw new Error(`Aras 請求失敗：${msg}`);
  }
  const bad = () => {
    const snippet = String(raw).replace(/\s+/g, ' ').slice(0, 120);
    return new Error(`Aras 回應不是有效的 SOAP 結果（HTTP ${status}）：${snippet}`);
  };
  let doc;
  try {
    doc = parseXml(raw);
  } catch {
    throw bad();
  }
  const fault = doc.getElementsByTagName('faultstring')[0]?.textContent ?? '';
  if (fault) {
    if (fault.startsWith('No items of type')) return [];
    throw new Error(fault);
  }
  const result = doc.getElementsByTagName('Result')[0];
  if (!result) throw bad();
  return elements(result);
}

/** 直接子元素（不往下找） */
export function child(el, tag) {
  return elements(el).find((n) => n.tagName === tag);
}

export function text(el, tag) {
  return child(el, tag)?.textContent ?? '';
}

/** item 屬性的 GUID：同時處理扁平與展開的巢狀 <Item> */
export function itemId(el, tag) {
  const prop = child(el, tag);
  if (!prop) return '';
  const nested = child(prop, 'Item');
  return nested ? (nested.getAttribute('id') ?? '') : (prop.textContent ?? '');
}

export function keyedName(el, tag) {
  return child(el, tag)?.getAttribute('keyed_name') ?? '';
}

/** 多語系標籤：language="zt" 時中文在 <i18n:label>，不在 <label> */
export function i18nLabel(el, lang = 'zt') {
  const hit = elements(el).find((n) => n.tagName === 'i18n:label' && n.getAttribute('xml:lang') === lang);
  return hit?.textContent ?? text(el, 'label');
}

/** <Relationships> 底下的直接子 Item */
export function relationships(el, type) {
  const rels = child(el, 'Relationships');
  if (!rels) return [];
  return elements(rels).filter((n) => n.tagName === 'Item' && (!type || n.getAttribute('type') === type));
}

export function chunk(arr, size = 150) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function inList(ids) {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
}

/**
 * Item 轉 JSON：props 為直接子欄位文字（展開的 item 屬性取其 id），relationships 遞迴。
 * 帶 xml:lang 的欄位（多語系標籤）以 `${tag}@${lang}` 為鍵，例如 `label@en`、`i18n:label@zt`、`i18n:label@zc`，
 * 避免多個語言互相覆蓋；沒有 xml:lang 的欄位鍵名不變。
 */
export function toJson(el) {
  const props = {};
  for (const n of elements(el)) {
    if (n.tagName === 'Relationships') continue;
    const nested = child(n, 'Item');
    const lang = n.getAttribute('xml:lang');
    const key = lang ? `${n.tagName}@${lang}` : n.tagName;
    props[key] = nested ? (nested.getAttribute('id') ?? '') : n.textContent;
  }
  const out = { type: el.getAttribute('type') ?? '', id: el.getAttribute('id') ?? '', props };
  const rels = relationships(el);
  if (rels.length) out.relationships = rels.map(toJson);
  return out;
}

/** AML 裡所有非 get 的 action（含巢狀） */
export function writeActions(aml) {
  const doc = parseXml(aml);
  const out = [];
  for (const item of doc.getElementsByTagName('Item')) {
    const a = item.getAttribute('action');
    if (a && a !== 'get') out.push(a);
  }
  return out;
}
