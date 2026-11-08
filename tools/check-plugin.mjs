#!/usr/bin/env node
// 外掛內容檢查：frontmatter、ArasQuickVue 路徑依賴、疑似秘密、backups/ deploy/ 資料夾。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
// 正式區備份與部署暫存不得隨外掛發布：資料夾存在即報錯（不跳過）
const FORBIDDEN_DIRS = new Set(['backups', 'deploy']);
const METHODS_DIR = 'skills/aras-schema/references/methods/';
const PATH_RE = /\b(src|scripts)\/[\w./-]+|\.agent\/|\.claude\/skills\//;
const QUICKVUE_RE = /QuickVue\s*(工具)?頁/;
const AUTHPW_RE = /AUTHPASSWORD\s*[:=]\s*['"][^'"$]/;
const HEX32_RE = /\b[0-9a-fA-F]{32}\b/;
const PW_WORD_RE = /password|passwd|AUTHPASSWORD|hash/i;
const MAX_LISTED = 500;

function walk(dir, root, out, forbidden) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (FORBIDDEN_DIRS.has(e.name)) {
        forbidden.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
        continue;
      }
      walk(path.join(dir, e.name), root, out, forbidden);
    } else if (e.isFile()) {
      out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  }
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return fm;
}

export function checkPlugin(root) {
  const errors = [];
  const warnings = [];
  const files = [];
  const forbidden = [];
  walk(root, root, files, forbidden);
  for (const d of forbidden) errors.push(`${d}/: 不得包含 backups/ 或 deploy/ 資料夾（正式區備份不可隨外掛發布）`);

  for (const rel of files) {
    const base = rel.split('/').pop();
    if (/^\.env/.test(base)) errors.push(`${rel}: 不得包含 .env 檔案`);

    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }

    const inMethods = rel.startsWith(METHODS_DIR);
    const inSkills = rel.startsWith('skills/');

    if (/^skills\/[^/]+\/SKILL\.md$/.test(rel)) {
      const folder = rel.split('/')[1];
      const fm = frontmatter(text);
      if (!fm || !fm.name) errors.push(`${rel}: frontmatter 缺少 name`);
      else if (fm.name !== folder) errors.push(`${rel}: name「${fm.name}」與資料夾「${folder}」不符`);
      if (!fm || !fm.description) errors.push(`${rel}: frontmatter 缺少 description`);
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      if (inSkills && !inMethods) {
        const pm = line.match(PATH_RE);
        if (pm) errors.push(`${where}: 出現 ArasQuickVue 路徑「${pm[0]}」`);
        if (QUICKVUE_RE.test(line)) errors.push(`${where}: 出現「QuickVue 頁」字樣`);
      }
      if (AUTHPW_RE.test(line)) errors.push(`${where}: 疑似寫死的 AUTHPASSWORD`);
      if (HEX32_RE.test(line) && PW_WORD_RE.test(line)) {
        const msg = `${where}: password/hash 附近出現 32 位 hex，疑似秘密`;
        (inMethods ? warnings : errors).push(msg);
      }
    });
  }

  if (files.length > MAX_LISTED) {
    warnings.push(`檔案總數 ${files.length} 超過 ${MAX_LISTED}（PublishPlugin 介面只列前 ${MAX_LISTED} 筆）`);
  }
  return { errors, warnings, fileCount: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] || '.');
  const r = checkPlugin(root);
  for (const w of r.warnings) console.warn(`警告 ${w}`);
  for (const e of r.errors) console.error(`錯誤 ${e}`);
  console.log(`檢查 ${r.fileCount} 個檔案：${r.errors.length} 錯誤、${r.warnings.length} 警告`);
  process.exit(r.errors.length ? 1 : 0);
}
