import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseXml } from '../lib/xml.mjs';
import { methodFileName, methodFile, itemTypeMarkdown, methodIndexMarkdown, parseBindings } from '../lib/snapshot-format.mjs';
import { mapItemType, mapLifecycleMap, mapMethod, methodPageAml, itemTypeAml } from '../lib/snapshot-aml.mjs';
import { run, DEFAULT_ITEMTYPES } from '../snapshot.mjs';

const el = (xml) => parseXml(xml).documentElement;

test('methodFileName sanitizes illegal chars', () => {
  assert.equal(methodFileName('Cust/A:B*', 'C#', new Set()), 'Cust_A_B_.cs');
  assert.equal(methodFileName('x', 'VB', new Set()), 'x.vb');
  assert.equal(methodFileName('x', 'JavaScript', new Set()), 'x.js');
  assert.equal(methodFileName('x', 'Python', new Set()), 'x.txt');
});

test('methodFileName dedupes collisions', () => {
  const taken = new Set();
  assert.equal(methodFileName('a/b', 'C#', taken), 'a_b.cs');
  assert.equal(methodFileName('a:b', 'C#', taken), 'a_b__2.cs');
  assert.equal(methodFileName('a*b', 'C#', taken), 'a_b__3.cs');
});

test('methodFile header for C# and VB', () => {
  const m = { id: 'ID1', name: 'N', methodType: 'C#', comments: 'hi', code: 'return this;' };
  assert.equal(methodFile(m), '// Method: N\n// Type: C#\n// ID: ID1\n// Comments: hi\n\nreturn this;');
  const vb = methodFile({ ...m, methodType: 'VB', comments: '' });
  assert.equal(vb, "' Method: N\n' Type: VB\n' ID: ID1\n\nreturn this;");
});

const sample = {
  name: 'Part', label: '料號', takenAt: '2026-11-01',
  properties: [{ name: 'item_number', label: '料號', dataType: 'string', dataSource: '', required: true }],
  relationshipTypes: [{ name: 'Part BOM', relatedItemType: 'Part' }],
  lifecycles: [{ name: 'Part Map', states: [{ name: 'Released', label: '已發行' }], transitions: [{ from: 'Preliminary', to: 'Released' }] }],
  serverEvents: [{ event: 'onAfterAdd', method: 'Cust_X' }],
  actions: [{ label: '復原', method: 'Cust_Y' }],
};

test('itemTypeMarkdown has all sections and takenAt', () => {
  const md = itemTypeMarkdown(sample);
  for (const h of ['## 基本資料', '## 欄位表', '## RelationshipType', '## 生命週期', '## Server Event', '## Item Action']) assert.ok(md.includes(h), h);
  assert.match(md, /2026-11-01/);
  assert.match(md, /\| item_number \| 料號 \| string \|  \| Y \|/);
  assert.match(md, /Released/);
  assert.match(md, /Preliminary \| Released/);
});

test('methodIndexMarkdown lists boundTo; parseBindings round-trips', () => {
  const md = methodIndexMarkdown([{ name: 'Cust_X', methodType: 'C#', file: 'Cust_X.cs', boundTo: ['Part (Server Event:onAfterAdd)'] }]);
  assert.match(md, /Cust_X\.cs \| Part \(Server Event:onAfterAdd\)/);
  assert.deepEqual(parseBindings(itemTypeMarkdown(sample)), [
    { method: 'Cust_X', via: 'Server Event:onAfterAdd' },
    { method: 'Cust_Y', via: 'Item Action:復原' },
  ]);
});

test('AML builders escape names and paginate', () => {
  assert.match(itemTypeAml('A&B'), /<name>A&amp;B<\/name>/);
  assert.match(methodPageAml(3), /page="3" pagesize="200"/);
});

const ITEMTYPE_XML = `<Item type="ItemType" id="IT1"><name>Part</name><i18n:label xml:lang="zt">料號</i18n:label><Relationships>
<Item type="Property"><name>item_number</name><i18n:label xml:lang="zt">料號編碼</i18n:label><data_type>string</data_type><is_required>1</is_required><sort_order>2</sort_order></Item>
<Item type="Property"><name>state</name><label>State</label><data_type>list</data_type><data_source keyed_name="PartState">L1</data_source><is_required>0</is_required><sort_order>1</sort_order></Item>
<Item type="RelationshipType"><name>Part BOM</name><related_id keyed_name="Part">P1</related_id></Item>
<Item type="Server Event"><server_event>onAfterAdd</server_event><sort_order>128</sort_order><related_id keyed_name="Cust_X">M1</related_id></Item>
<Item type="Item Action"><related_id><Item type="Action" id="A1"><name>act</name><i18n:label xml:lang="zt">復原</i18n:label><method keyed_name="Cust_Y">M2</method></Item></related_id></Item>
<Item type="ItemType Life Cycle"><related_id><Item type="Life Cycle Map" id="LC1"><name>Part Map</name></Item></related_id></Item>
</Relationships></Item>`;

test('mapItemType maps flat and expanded properties', () => {
  const it = mapItemType(el(ITEMTYPE_XML));
  assert.equal(it.label, '料號');
  assert.deepEqual(it.properties.map((p) => [p.name, p.label, p.dataSource, p.required]), [
    ['state', 'State', 'PartState', false],
    ['item_number', '料號編碼', '', true],
  ]);
  assert.deepEqual(it.relationshipTypes, [{ name: 'Part BOM', relatedItemType: 'Part' }]);
  assert.deepEqual(it.serverEvents, [{ event: 'onAfterAdd', method: 'Cust_X' }]);
  assert.deepEqual(it.actions, [{ label: '復原', method: 'Cust_Y' }]);
  assert.deepEqual(it.lifecycleMapIds, ['LC1']);
});

test('mapLifecycleMap resolves state names', () => {
  const m = mapLifecycleMap(el(`<Item type="Life Cycle Map"><name>Part Map</name><Relationships>
<Item type="Life Cycle State" id="S1"><name>Preliminary</name><sort_order>1</sort_order></Item>
<Item type="Life Cycle State" id="S2"><name>Released</name><i18n:label xml:lang="zt">已發行</i18n:label><sort_order>2</sort_order></Item>
<Item type="Life Cycle Transition"><from_state keyed_name="Preliminary">S1</from_state><to_state>S2</to_state></Item>
</Relationships></Item>`));
  assert.deepEqual(m.states.map((s) => s.name), ['Preliminary', 'Released']);
  assert.deepEqual(m.transitions, [{ from: 'Preliminary', to: 'Released' }]);
});

test('mapMethod keeps code with entities and CDATA', () => {
  const m = mapMethod(el('<Item type="Method" id="M1"><name>n</name><method_type>C#</method_type><method_code><![CDATA[if (a < b && c) {}]]></method_code></Item>'));
  assert.equal(m.code, 'if (a < b && c) {}');
  assert.equal(m.id, 'M1');
});

test('DEFAULT_ITEMTYPES has 66 unique entries incl. coverage additions', () => {
  assert.equal(DEFAULT_ITEMTYPES.length, 66);
  assert.equal(new Set(DEFAULT_ITEMTYPES).size, 66);
  for (const n of ['Express DCO', 'Simple ECO', 'Workflow', 'Workflow Process Activity', 'Workflow Process Path', 'SavedSearch', 'Project Team', 'Member']) assert.ok(DEFAULT_ITEMTYPES.includes(n), n);
});

test('overall flow writes itemtypes, paged methods (no overwrite), index and summary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const methodsXml = (n, start) =>
    Array.from({ length: n }, (_, i) => {
      const name = start + i === 0 ? 'a/b' : start + i === 1 ? 'a:b' : `m${start + i}`;
      return el(`<Item type="Method" id="ID${start + i}"><name>${name}</name><method_type>C#</method_type><method_code>code${start + i}</method_code></Item>`);
    });
  const calls = [];
  const applyAml = async (aml) => {
    calls.push(aml);
    if (aml.includes('type="ItemType"')) return [el(ITEMTYPE_XML)];
    if (aml.includes('Life Cycle Map')) return [el('<Item type="Life Cycle Map"><name>Part Map</name><Relationships><Item type="Life Cycle State"><name>Released</name></Item></Relationships></Item>')];
    if (aml.includes('page="1"')) return methodsXml(200, 0);
    if (aml.includes('page="2"')) return methodsXml(3, 200);
    throw new Error('unexpected ' + aml);
  };
  const log = () => {};
  const base = { applyAml, root, now: '2026-11-01', log };
  await run(['itemtypes', '--only', 'Part'], base);
  assert.ok(fs.readFileSync(path.join(root, 'skills/aras-schema/references/itemtypes/Part.md'), 'utf8').includes('Released'));
  const n = await run(['methods'], base);
  assert.equal(n, 203);
  const dir = path.join(root, 'skills/aras-schema/references/methods');
  assert.equal(fs.readFileSync(path.join(dir, 'a_b.cs'), 'utf8').endsWith('code0'), true);
  assert.equal(fs.readFileSync(path.join(dir, 'a_b__2.cs'), 'utf8').endsWith('code1'), true);
  assert.equal(fs.readdirSync(dir).length, 203 + 1);
  assert.match(fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8'), /Cust_X\.cs|m2\.cs/);
  const summary = fs.readFileSync(path.join(root, 'skills/aras-schema/references/SNAPSHOT.md'), 'utf8');
  assert.match(summary, /Method 數量：203/);
  assert.match(summary, /ItemType 數量：1/);
  await assert.rejects(run(['bogus'], base), /用法/);
});

test('--only keeps global 抓取日期 and records 部分更新', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-only-'));
  const applyAml = async (aml) => {
    if (aml.includes('type="ItemType"')) return [el(ITEMTYPE_XML)];
    if (aml.includes('Life Cycle Map')) return [];
    if (aml.includes('type="Method"')) return [el('<Item type="Method" id="M1"><name>Cust_X</name><method_type>C#</method_type><method_code>c</method_code></Item>')];
    throw new Error('unexpected ' + aml);
  };
  const log = () => {};
  const file = path.join(root, 'skills/aras-schema/references/SNAPSHOT.md');
  await run(['itemtypes'], { applyAml, root, now: '2026-11-01', log });
  assert.match(fs.readFileSync(file, 'utf8'), /抓取日期：2026-11-01/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /部分更新/);

  await run(['itemtypes', '--only', 'ECR'], { applyAml, root, now: '2026-11-05', log });
  await run(['methods', '--only', 'Cust_X'], { applyAml, root, now: '2026-11-06', log });
  await run(['itemtypes', '--only', 'ECR'], { applyAml, root, now: '2026-11-07', log });
  let s = fs.readFileSync(file, 'utf8');
  assert.match(s, /抓取日期：2026-11-01/);
  assert.match(s, /部分更新：Method Cust_X（2026-11-06）、ItemType ECR（2026-11-07）/);
  assert.doesNotMatch(s, /2026-11-05/);

  // 完整抓取 ItemType：更新抓取日期，只清掉 ItemType 的部分更新紀錄
  await run(['itemtypes'], { applyAml, root, now: '2026-11-08', log });
  s = fs.readFileSync(file, 'utf8');
  assert.match(s, /抓取日期：2026-11-08/);
  assert.match(s, /部分更新：Method Cust_X（2026-11-06）$/m);
});
