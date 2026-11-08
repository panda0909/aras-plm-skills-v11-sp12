import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml } from '../lib/xml.mjs';

test('parses nested elements, attributes, text', () => {
  const doc = parseXml('<Result><Item type="Part" id="A1"><item_number>P-1</item_number></Item></Result>');
  const item = doc.getElementsByTagName('Item')[0];
  assert.equal(item.getAttribute('id'), 'A1');
  assert.equal(item.getAttribute('type'), 'Part');
  assert.equal(item.getAttribute('nope'), null);
  const num = item.getElementsByTagName('item_number')[0];
  assert.equal(num.textContent, 'P-1');
  assert.equal(num.nodeType, 1);
  assert.equal(num.tagName, 'item_number');
  assert.equal(num.childNodes[0].nodeType, 3);
  assert.equal(num.childNodes[0].textContent, 'P-1');
});

test('decodes entities and CDATA', () => {
  const doc = parseXml('<r a="&lt;&amp;&quot;">&lt;&gt;&amp;&quot;&apos;&#20013;&#x6587;</r>');
  const r = doc.getElementsByTagName('r')[0];
  assert.equal(r.textContent, '<>&"\'中文');
  assert.equal(r.getAttribute('a'), '<&"');
  const d2 = parseXml('<r><![CDATA[a<b]]></r>');
  assert.equal(d2.getElementsByTagName('r')[0].textContent, 'a<b');
});

test('keeps prefixed tag names', () => {
  const doc = parseXml('<r><i18n:label xml:lang="zt">料號</i18n:label></r>');
  const l = doc.getElementsByTagName('i18n:label')[0];
  assert.equal(l.tagName, 'i18n:label');
  assert.equal(l.getAttribute('xml:lang'), 'zt');
  assert.equal(l.textContent, '料號');
});

test('self-closing and empty elements', () => {
  const doc = parseXml('<r><a/><b></b></r>');
  for (const t of ['a', 'b']) {
    const e = doc.getElementsByTagName(t)[0];
    assert.equal(e.textContent, '');
    assert.equal(e.childNodes.length, 0);
  }
});

test('skips XML declaration and comments', () => {
  const doc = parseXml('<?xml version="1.0" encoding="utf-8"?><!-- hi --><r><!-- c -->x</r>');
  assert.equal(doc.documentElement.tagName, 'r');
  assert.equal(doc.textContent, 'x');
});

test('getElementsByTagName finds faultstring inside SOAP envelope', () => {
  const xml = '<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>1</faultcode><faultstring><![CDATA[No items of type Part found.]]></faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>';
  const doc = parseXml(xml);
  assert.equal(doc.getElementsByTagName('faultstring')[0].textContent, 'No items of type Part found.');
  assert.equal(doc.getElementsByTagName('SOAP-ENV:Fault').length, 1);
});

test('getElementsByTagName is depth-first over all descendants', () => {
  const doc = parseXml('<r><a><a/></a><a/></r>');
  assert.equal(doc.getElementsByTagName('a').length, 3);
});

test('throws on malformed XML', () => {
  assert.throws(() => parseXml('<a><b></a>'));
  assert.throws(() => parseXml('<a>'));
  assert.throws(() => parseXml(''));
});
