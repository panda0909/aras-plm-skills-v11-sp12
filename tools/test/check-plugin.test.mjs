import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlugin } from '../check-plugin.mjs';

// 測試字串刻意拆開拼接，避免本檔自己被檢查器當成秘密/路徑
const AUTHPW = 'AUTH' + 'PASSWORD';
const GUID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

function mk(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aras-chk-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}
const skill = (name, body = 'body') => `---\nname: ${name}\ndescription: d\n---\n${body}\n`;
const has = (list, s) => list.some((x) => x.includes(s));

test('乾淨外掛 errors 為空', () => {
  const r = checkPlugin(mk({ 'skills/a/SKILL.md': skill('a') }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.fileCount, 1);
});

test('缺 name 報錯', () => {
  const r = checkPlugin(mk({ 'skills/a/SKILL.md': '---\ndescription: d\n---\nx' }));
  assert.ok(has(r.errors, 'name'));
});

test('缺 description 報錯', () => {
  const r = checkPlugin(mk({ 'skills/a/SKILL.md': '---\nname: a\n---\nx' }));
  assert.ok(has(r.errors, 'description'));
});

test('name 與資料夾不符報錯', () => {
  const r = checkPlugin(mk({ 'skills/a/SKILL.md': skill('b') }));
  assert.ok(has(r.errors, 'skills/a/SKILL.md'));
});

test('skills 內出現 src/ 路徑報錯', () => {
  const r = checkPlugin(mk({ 'skills/a/SKILL.md': skill('a', 'see src/views/x.vue') }));
  assert.ok(has(r.errors, 'src/views/x.vue') || has(r.errors, 'skills/a/SKILL.md'));
  assert.ok(r.errors.length > 0);
});

test('.agent/ 與 .claude/skills/ 與 QuickVue 頁 報錯', () => {
  for (const body of ['.agent/skills', '.claude/skills/x', '用 QuickVue 頁面', 'QuickVue 工具頁']) {
    const r = checkPlugin(mk({ 'skills/a/SKILL.md': skill('a', body) }));
    assert.ok(r.errors.length > 0, body);
  }
});

test('含 AUTHPASSWORD 賦值報錯，$變數不報錯', () => {
  const bad = checkPlugin(mk({ 'skills/a/ref.md': `${AUTHPW}: 'abc'` }));
  assert.ok(bad.errors.length > 0);
  const ok = checkPlugin(mk({ 'skills/a/ref.md': `${AUTHPW}: '$X'` }));
  assert.deepEqual(ok.errors, []);
});

test('.env.local 檔名報錯', () => {
  const r = checkPlugin(mk({ '.env.local': 'x' }));
  assert.ok(has(r.errors, '.env.local'));
});

test('methods 底下的 src/ 不報錯', () => {
  const r = checkPlugin(mk({
    'skills/aras-schema/SKILL.md': skill('aras-schema'),
    'skills/aras-schema/references/methods/M.cs': 'var p = "src/views/x"; // .agent/',
  }));
  assert.deepEqual(r.errors, []);
});

test('GUID 與 keyed_name 同行不算秘密', () => {
  const r = checkPlugin(mk({ 'skills/a/ref.md': `keyed_name ${GUID}\nkey ${GUID}` }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('password 行含 32 hex：methods 內為警告、其他為錯誤', () => {
  const inM = checkPlugin(mk({
    'skills/aras-schema/SKILL.md': skill('aras-schema'),
    'skills/aras-schema/references/methods/M.cs': `string password = "${GUID}";`,
  }));
  assert.deepEqual(inM.errors, []);
  assert.ok(inM.warnings.length > 0);
  const out = checkPlugin(mk({ 'skills/a/ref.md': `hash=${GUID}` }));
  assert.ok(out.errors.length > 0);
});

test('methods 內的 AUTHPASSWORD 賦值與 .env 仍為錯誤', () => {
  const r = checkPlugin(mk({
    'skills/aras-schema/references/methods/M.cs': `${AUTHPW} = "abc"`,
    'skills/aras-schema/references/methods/.env': 'x',
  }));
  assert.equal(r.errors.length, 2);
});

test('fileCount 排除 .git、node_modules；超過 500 警告', () => {
  const files = { '.git/x': '1', 'node_modules/y': '1' };
  for (let i = 0; i < 501; i++) files[`f/${i}.txt`] = 'a';
  const r = checkPlugin(mk(files));
  assert.equal(r.fileCount, 501);
  assert.ok(has(r.warnings, '500'));
});

test('backups/ 或 deploy/ 資料夾（任何深度）報錯而非跳過', () => {
  for (const rel of ['backups/z.json', 'deploy/x.cs', 'skills/a/backups/b.json', 'docs/deploy/readme.md']) {
    const r = checkPlugin(mk({ 'skills/a/SKILL.md': skill('a'), [rel]: '1' }));
    const dir = rel.split('/').slice(0, -1).join('/');
    assert.ok(has(r.errors, `${dir}/`), rel);
  }
  const ok = checkPlugin(mk({ 'skills/a/SKILL.md': skill('a'), 'skills/a/deployment.md': '1', 'my-backups.md': '1' }));
  assert.deepEqual(ok.errors, []);
});
