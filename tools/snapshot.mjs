#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyAml as liveApplyAml } from './lib/aras.mjs';
import { itemTypeAml, lifecycleMapAml, methodPageAml, mapItemType, mapLifecycleMap, mapMethod, PAGE_SIZE } from './lib/snapshot-aml.mjs';
import { methodFileName, methodFile, itemTypeMarkdown, methodIndexMarkdown, snapshotMarkdown, parseSnapshotMarkdown, parseBindings } from './lib/snapshot-format.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join('skills', 'aras-schema', 'references');

export const DEFAULT_ITEMTYPES = [
  'Action',
  'Activity',
  'Activity Assignment',
  'Activity2',
  'Affected Item',
  'Allowed Permission',
  'Allowed Workflow',
  'CAD',
  'CAD Structure',
  'Can Add',
  'Client Event',
  'DiscussionTemplate',
  'Document',
  'ECN',
  'ECN Affected Item',
  'ECR',
  'ECR Affected Item',
  'Express DCO',
  'Filter Value',
  'Form',
  'ITPresentationConfiguration',
  'Identity',
  'Implements',
  'Inherited Server Events',
  'Item Action',
  'Item Report',
  'ItemType',
  'ItemType Life Cycle',
  'ItemType_xPropertyDefinition',
  'Life Cycle Map',
  'List',
  'Member',
  'Method',
  'Morphae',
  'Part',
  'Part BOM',
  'Part CAD',
  'Part Document',
  'Permission',
  'PresentationConfiguration',
  'Program',
  'Project',
  'Project Team',
  'Project Tree',
  'Property',
  'RelationshipType',
  'Report',
  'SQL',
  'SavedSearch',
  'Server Event',
  'Simple ECO',
  'Sub WBS',
  'TOC Access',
  'TOC View',
  'User',
  'Value',
  'View',
  'WBS Activity2',
  'WBS Element',
  'Workflow',
  'Workflow Map',
  'Workflow Process',
  'Workflow Process Activity',
  'Workflow Process Path',
  'xItemTypeAllowedProperty',
  'xPropertyDefinition',
];

const USAGE = '用法：node tools/snapshot.mjs methods|itemtypes [--only <name>]';
const safeName = (n) => n.replace(/[\\/:*?"<>|]/g, '_');

/**
 * 更新 SNAPSHOT.md。完整抓取（無 only）改寫抓取日期，並移除同類（ItemType／Method）的部分更新紀錄；
 * `--only` 只更新數量與「部分更新」行（同一項目以新日期取代），不動全域抓取日期。
 */
function writeSnapshotSummary(root, now, kind, only) {
  const count = (dir, keep) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(keep).length : 0);
  const itemTypes = count(path.join(root, REF, 'itemtypes'), (f) => f.endsWith('.md'));
  const methods = count(path.join(root, REF, 'methods'), (f) => f !== 'INDEX.md');
  const file = path.join(root, REF, 'SNAPSHOT.md');
  const prev = parseSnapshotMarkdown(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  let takenAt = now;
  let partial = prev.partial.filter((p) => !p.label.startsWith(`${kind} `));
  if (only) {
    const label = `${kind} ${only}`;
    takenAt = prev.takenAt || '（尚未完整抓取）';
    partial = [...prev.partial.filter((p) => p.label !== label), { label, date: now }];
  }
  fs.writeFileSync(file, snapshotMarkdown({ takenAt, itemTypes, methods, partial }), 'utf8');
}

export async function snapshotItemTypes({ applyAml, root, only, now, log }) {
  const names = only ? [only] : DEFAULT_ITEMTYPES;
  const dir = path.join(root, REF, 'itemtypes');
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;
  for (const name of names) {
    const rows = await applyAml(itemTypeAml(name));
    if (!rows.length) { log(`查無 ItemType：${name}`); continue; }
    const it = mapItemType(rows[0]);
    const lifecycles = [];
    for (const id of it.lifecycleMapIds) {
      const maps = await applyAml(lifecycleMapAml(id));
      if (maps.length) lifecycles.push(mapLifecycleMap(maps[0]));
    }
    fs.writeFileSync(path.join(dir, `${safeName(name)}.md`), itemTypeMarkdown({ ...it, lifecycles, takenAt: now }), 'utf8');
    done++;
    log(`ItemType ${name}：${it.properties.length} 欄位`);
  }
  writeSnapshotSummary(root, now, 'ItemType', only);
  log(`ItemType 快照完成：${done}/${names.length}`);
  return done;
}

export async function snapshotMethods({ applyAml, root, only, now, log }) {
  const dir = path.join(root, REF, 'methods');
  fs.mkdirSync(dir, { recursive: true });
  const all = [];
  for (let page = 1; ; page++) {
    const rows = await applyAml(methodPageAml(page, only));
    all.push(...rows.map(mapMethod));
    if (rows.length < PAGE_SIZE) break;
  }
  if (!only) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const taken = new Set();
  const index = [];
  for (const m of all) {
    const file = methodFileName(m.name, m.methodType, taken);
    fs.writeFileSync(path.join(dir, file), methodFile(m), 'utf8');
    index.push({ name: m.name, methodType: m.methodType, file, boundTo: [] });
  }
  if (!only) {
    const bound = new Map();
    const itDir = path.join(root, REF, 'itemtypes');
    if (fs.existsSync(itDir)) {
      for (const f of fs.readdirSync(itDir).filter((x) => x.endsWith('.md'))) {
        for (const b of parseBindings(fs.readFileSync(path.join(itDir, f), 'utf8'))) {
          const list = bound.get(b.method) ?? [];
          list.push(`${f.slice(0, -3)} (${b.via})`);
          bound.set(b.method, list);
        }
      }
    }
    for (const r of index) r.boundTo = bound.get(r.name) ?? [];
    fs.writeFileSync(path.join(dir, 'INDEX.md'), methodIndexMarkdown(index), 'utf8');
  }
  writeSnapshotSummary(root, now, 'Method', only);
  log(`Method 快照完成：${all.length} 支`);
  return all.length;
}

export async function run(argv, { applyAml = liveApplyAml, root = REPO_ROOT, now = new Date().toISOString().slice(0, 10), log = console.log } = {}) {
  const [cmd, ...rest] = argv;
  const i = rest.indexOf('--only');
  const only = i >= 0 ? rest[i + 1] : undefined;
  if (i >= 0 && !only) throw new Error(USAGE);
  const ctx = { applyAml, root, only, now, log };
  if (cmd === 'itemtypes') return snapshotItemTypes(ctx);
  if (cmd === 'methods') return snapshotMethods(ctx);
  throw new Error(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
