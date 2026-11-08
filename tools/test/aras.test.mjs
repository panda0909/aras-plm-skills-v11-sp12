import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml } from '../lib/xml.mjs';
import {
  applyAml, child, text, itemId, relationships, i18nLabel, writeActions, toJson, chunk, inList, keyedName,
} from '../lib/aras.mjs';

const config = { user: 'tester', passwordHash: 'deadbeefcafe0123', server: 'http://x/Server/I.aspx', database: 'DB1' };
const el = (xml) => parseXml(xml).documentElement;
const resp = (body) => async () => ({ text: async () => body });

test('sends SOAP envelope with auth headers', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { text: async () => '<r><Result/></r>' }; };
  await applyAml('<AML><Item type="Part" action="get"/></AML>', { fetchImpl, config });
  assert.equal(seen.url, config.server);
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.AUTHUSER, 'tester');
  assert.equal(seen.opts.headers.AUTHPASSWORD, config.passwordHash);
  assert.equal(seen.opts.headers.DATABASE, 'DB1');
  assert.equal(seen.opts.headers.SOAPACTION, 'ApplyAML');
  assert.match(seen.opts.body, /<ApplyAML>/);
});

test('returns Result child elements', async () => {
  const xml = '<E><B><Result><Item id="1"/>text<Item id="2"/></Result></B></E>';
  const rows = await applyAml('<AML/>', { fetchImpl: resp(xml), config });
  assert.deepEqual(rows.map((r) => r.getAttribute('id')), ['1', '2']);
});

test('No items of type fault → []', async () => {
  const xml = '<E><B><Fault><faultstring>No items of type Part found.</faultstring></Fault></B></E>';
  assert.deepEqual(await applyAml('<AML/>', { fetchImpl: resp(xml), config }), []);
});

test('other fault → throws faultstring', async () => {
  const xml = '<E><B><Fault><faultstring>boom bad</faultstring></Fault></B></E>';
  await assert.rejects(applyAml('<AML/>', { fetchImpl: resp(xml), config }), /boom bad/);
});

test('network error message excludes password', async () => {
  const fetchImpl = async () => {
    const e = new Error(`failed headers AUTHPASSWORD=${config.passwordHash}`);
    e.config = { headers: { AUTHPASSWORD: config.passwordHash } };
    e.cause = { secret: config.passwordHash };
    throw e;
  };
  await assert.rejects(applyAml('<AML/>', { fetchImpl, config }), (e) => {
    assert.ok(!e.message.includes(config.passwordHash));
    assert.match(e.message, /Aras 請求失敗/);
    assert.equal(e.cause, undefined);
    assert.equal(e.config, undefined);
    return true;
  });
});

test('itemId handles flat and expanded item property', () => {
  assert.equal(itemId(el('<Item><owned_by_id keyed_name="K">G1</owned_by_id></Item>'), 'owned_by_id'), 'G1');
  assert.equal(itemId(el('<Item><owned_by_id><Item id="G2"><x>y</x></Item></owned_by_id></Item>'), 'owned_by_id'), 'G2');
  assert.equal(itemId(el('<Item/>'), 'owned_by_id'), '');
  assert.equal(keyedName(el('<Item><o keyed_name="K"/></Item>'), 'o'), 'K');
});

test('child and text only look at direct children', () => {
  const item = el('<Item><a><name>deep</name></a><name>top</name></Item>');
  assert.equal(text(item, 'name'), 'top');
  assert.equal(child(item, 'zzz'), undefined);
  assert.equal(text(item, 'zzz'), '');
});

test('relationships ignores nested related_id Items', () => {
  const item = el('<Item><Relationships><Item type="A" id="r1"><related_id><Item id="n"/></related_id></Item><Item type="B" id="r2"/></Relationships></Item>');
  assert.deepEqual(relationships(item).map((r) => r.getAttribute('id')), ['r1', 'r2']);
  assert.deepEqual(relationships(item, 'B').map((r) => r.getAttribute('id')), ['r2']);
  assert.deepEqual(relationships(el('<Item/>')), []);
});

test('i18nLabel falls back to label', () => {
  const a = el('<Item><label>L</label><i18n:label xml:lang="zt">中</i18n:label><i18n:label xml:lang="en">E</i18n:label></Item>');
  assert.equal(i18nLabel(a), '中');
  assert.equal(i18nLabel(a, 'en'), 'E');
  assert.equal(i18nLabel(el('<Item><label>L</label></Item>')), 'L');
});

test('writeActions finds nested non-get actions', () => {
  assert.deepEqual(writeActions('<AML><Item type="P" action="get"><Relationships><Item action="delete"/></Relationships></Item></AML>'), ['delete']);
});

test('writeActions ignores get-only AML', () => {
  assert.deepEqual(writeActions('<AML><Item type="P" action="get"><Relationships><Item type="Q" action="get"/></Relationships></Item></AML>'), []);
  assert.deepEqual(writeActions('<AML><Item type="P"/></AML>'), []);
});

test('toJson flattens props and relationships', () => {
  const item = el('<Item type="P" id="I1"><a>1</a><Relationships><Item type="R" id="R1"><b>2</b></Item></Relationships></Item>');
  assert.deepEqual(toJson(item), {
    type: 'P', id: 'I1', props: { a: '1' },
    relationships: [{ type: 'R', id: 'R1', props: { b: '2' } }],
  });
  assert.equal(toJson(el('<Item type="P" id="I1"><a>1</a></Item>')).relationships, undefined);
});

test('toJson keys language-tagged props by xml:lang', () => {
  const item = el('<Item type="Property" id="P1"><name>x</name><label xml:lang="en">DN Qty</label>'
    + '<i18n:label xml:lang="zt" xmlns:i18n="http://www.aras.com/I18N">近兩年出貨數量</i18n:label>'
    + '<i18n:label xml:lang="en" xmlns:i18n="http://www.aras.com/I18N">DN Qty EN</i18n:label></Item>');
  assert.deepEqual(toJson(item).props, {
    name: 'x', 'label@en': 'DN Qty', 'i18n:label@zt': '近兩年出貨數量', 'i18n:label@en': 'DN Qty EN',
  });
});

test('chunk and inList', () => {
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(inList(['a', "b'c"]), "'a','b''c'");
});

test('HTML 500 response throws with status', async () => {
  const fetchImpl = async () => ({ status: 500, text: async () => '<html><body>500 Internal</body></html>' });
  await assert.rejects(applyAml('<AML/>', { fetchImpl, config }), /500/);
});

test('empty and plain-text bodies throw with status', async () => {
  for (const body of ['', 'plain text <<<']) {
    const fetchImpl = async () => ({ status: 502, text: async () => body });
    await assert.rejects(applyAml('<AML/>', { fetchImpl, config }), /502/);
  }
});

test('library write gate: refuses write AML without write:true, before fetch or config', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { text: async () => '<r><Result/></r>' }; };
  const aml = '<AML><Item type="P" action="get"><Relationships><Item type="Q" action="edit" id="1"/></Relationships></Item><Item type="P" action="delete" id="2"/></AML>';
  // 不傳 config：若閘門在 loadConfig 之後才檢查，會先因缺設定而丟別的錯
  await assert.rejects(applyAml(aml, { fetchImpl }), (e) => {
    assert.match(e.message, /拒絕執行/);
    assert.match(e.message, /edit/);
    assert.match(e.message, /delete/);
    return true;
  });
  await assert.rejects(applyAml(aml, { fetchImpl, config, write: 'yes' }), /拒絕執行/);
  assert.equal(called, false);
});

test('library write gate: allows write AML with write:true', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { text: async () => '<r><Result><Item id="2"/></Result></r>' }; };
  const rows = await applyAml('<AML><Item type="P" action="edit" id="2"/></AML>', { fetchImpl, config, write: true });
  assert.equal(called, true);
  assert.equal(rows.length, 1);
});
