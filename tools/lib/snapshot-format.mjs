// Schema 快照的純函式：檔名、檔頭、Markdown 產生與解析（不碰網路與檔案系統）。

const EXT = { 'c#': '.cs', vb: '.vb', javascript: '.js' };

/** 不合法字元換 `_`、依 method_type 決定副檔名，撞名加 __2、__3。會把結果記入 taken。 */
export function methodFileName(name, methodType, taken = new Set()) {
  const ext = EXT[String(methodType ?? '').toLowerCase()] ?? '.txt';
  const base = String(name).replace(/[\\/:*?"<>|]/g, '_');
  let candidate = base + ext;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}__${n}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** 檔頭沿用現行格式；VB 用 '，其他用 //。程式碼原樣接在檔頭後。 */
export function methodFile({ id, name, methodType, comments, code }) {
  const c = String(methodType ?? '').toLowerCase() === 'vb' ? "'" : '//';
  const header =
    `${c} Method: ${name}\n${c} Type: ${methodType}\n${c} ID: ${id}\n` +
    (comments ? `${c} Comments: ${comments}\n` : '') +
    '\n';
  return header + (code ?? '');
}

const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const table = (head, rows) =>
  rows.length
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
    : '（無）';

export function itemTypeMarkdown({ name, label, properties = [], relationshipTypes = [], lifecycles = [], serverEvents = [], actions = [], takenAt }) {
  const out = [
    `# ${name}`,
    '',
    '## 基本資料',
    '',
    `- name：${name}`,
    `- 中文標籤：${label || '-'}`,
    `- 抓取日期：${takenAt}`,
    '',
    '## 欄位表',
    '',
    table(
      ['name', '中文標籤', 'data_type', 'data_source', 'required'],
      properties.map((p) => [p.name, p.label, p.dataType, p.dataSource, p.required ? 'Y' : '']),
    ),
    '',
    '## RelationshipType',
    '',
    table(['name', 'related ItemType'], relationshipTypes.map((r) => [r.name, r.relatedItemType])),
    '',
    '## 生命週期',
    '',
  ];
  if (!lifecycles.length) out.push('（無）', '');
  for (const lc of lifecycles) {
    out.push(`### Life Cycle Map：${lc.name}`, '', '**States**', '');
    out.push(table(['name', '中文標籤'], (lc.states ?? []).map((s) => [s.name, s.label])), '');
    out.push('**Transitions**', '');
    out.push(table(['from', 'to'], (lc.transitions ?? []).map((t) => [t.from, t.to])), '');
  }
  out.push(
    '## Server Event',
    '',
    table(['event', 'Method'], serverEvents.map((e) => [e.event, e.method])),
    '',
    '## Item Action',
    '',
    table(['label', 'Method'], actions.map((a) => [a.label, a.method])),
    '',
  );
  return out.join('\n');
}

/** 從 itemTypeMarkdown 的輸出讀回 Server Event／Item Action 綁定的 Method 名稱 */
export function parseBindings(md) {
  const found = [];
  let section = '';
  for (const line of md.split(/\r?\n/)) {
    const h = /^## (.+)$/.exec(line);
    if (h) { section = h[1]; continue; }
    if (section !== 'Server Event' && section !== 'Item Action') continue;
    if (!line.startsWith('|') || /^\|-/.test(line) || /^\| (event|label) \|/.test(line)) continue;
    const cols = line.slice(1, -1).split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|'));
    if (cols.length >= 2 && cols[1]) found.push({ method: cols[1], via: `${section === 'Server Event' ? 'Server Event' : 'Item Action'}:${cols[0]}` });
  }
  return found;
}

export function methodIndexMarkdown(rows) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  return [
    '# Method 索引',
    '',
    `共 ${rows.length} 支。boundTo 為 Server Event／Item Action 反查結果（Activity／Property 等其他綁定不在內）。`,
    '',
    table(
      ['name', 'type', 'file', 'boundTo'],
      sorted.map((r) => [r.name, r.methodType, r.file, (r.boundTo ?? []).join('; ')]),
    ),
    '',
  ].join('\n');
}

/**
 * SNAPSHOT.md 內容。`partial` 為 `--only` 部分更新紀錄（[{ label, date }]），有內容時多一行「部分更新」；
 * 全域「抓取日期」只代表最後一次完整抓取。
 */
export function snapshotMarkdown({ takenAt, itemTypes, methods, partial = [] }) {
  return [
    '# Schema 快照',
    '',
    `- 抓取日期：${takenAt}`,
    ...(partial.length ? [`- 部分更新：${partial.map((p) => `${p.label}（${p.date}）`).join('、')}`] : []),
    `- ItemType 數量：${itemTypes}`,
    `- Method 數量：${methods}`,
    '',
    '由本外掛根目錄的 `tools/snapshot.mjs` 產生；先跑 `itemtypes` 再跑 `methods`。',
    '',
  ].join('\n');
}

/** 解析既有 SNAPSHOT.md 的抓取日期與部分更新紀錄（檔案不存在或格式不符時回空值）。 */
export function parseSnapshotMarkdown(text) {
  const takenAt = String(text ?? '').match(/^- 抓取日期：(.*)$/m)?.[1]?.trim() ?? '';
  const line = String(text ?? '').match(/^- 部分更新：(.*)$/m)?.[1] ?? '';
  const partial = [];
  for (const m of line.matchAll(/(.+?)（([^）]*)）(?:、|$)/g)) partial.push({ label: m[1], date: m[2] });
  return { takenAt, partial };
}
