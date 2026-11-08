import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, md5, writeConfig, CONFIG_PATH } from '../lib/config.mjs';

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aras-cfg-'));
  const p = path.join(dir, 'config');
  if (content !== undefined) fs.writeFileSync(p, content, { mode: 0o600 });
  return p;
}

test('CONFIG_PATH is under home', () => {
  assert.equal(CONFIG_PATH, path.join(os.homedir(), '.aras-plm', 'config'));
});

test('md5 is lowercase hex matching node:crypto', () => {
  assert.equal(md5('abc'), createHash('md5').update('abc').digest('hex'));
});

test('env overrides file', () => {
  const p = tmpFile('ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=x\n');
  const c = loadConfig({ env: { ARAS_AUTH_USER: 'b' }, path: p });
  assert.equal(c.user, 'b');
});

test('hashes plaintext password', () => {
  const p = tmpFile('ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=innovator\n');
  const c = loadConfig({ env: {}, path: p });
  assert.equal(c.passwordHash, createHash('md5').update('innovator').digest('hex'));
  assert.notEqual(c.passwordHash, 'innovator');
});

test('server and database are required', () => {
  const p = tmpFile('ARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=x\n');
  assert.throws(() => loadConfig({ env: {}, path: p }), /ARAS_SERVER.*ARAS_DATABASE/);
});

test('reads server and database', () => {
  const p = tmpFile('ARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=x\nARAS_SERVER=http://h/s\nARAS_DATABASE=D\n');
  const c = loadConfig({ env: {}, path: p });
  assert.equal(c.server, 'http://h/s');
  assert.equal(c.database, 'D');
});

test('missing key error names key and path', () => {
  const p = tmpFile('ARAS_AUTH_USER=a\n');
  assert.throws(() => loadConfig({ env: {}, path: p }), (e) => {
    assert.match(e.message, /ARAS_AUTH_PASSWORD/);
    assert.ok(e.message.includes(p));
    return true;
  });
});

test('missing file with no env → same helpful error', () => {
  const p = tmpFile();
  assert.throws(() => loadConfig({ env: {}, path: p }), (e) => {
    assert.match(e.message, /ARAS_AUTH_USER/);
    assert.ok(e.message.includes(p));
    return true;
  });
});

test('writeConfig writes 0600 file in 0700 dir', { skip: process.platform === 'win32' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aras-cfg-'));
  const p = path.join(base, 'sub', 'config');
  writeConfig({ user: 'u1', password: 'pw1', server: 'http://h/s', database: 'D' }, p);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(p)).mode & 0o777, 0o700);
  const c = loadConfig({ env: {}, path: p });
  assert.equal(c.user, 'u1');
  assert.equal(c.passwordHash, md5('pw1'));
});

test('writeConfig round-trips tricky values', () => {
  for (const pw of ['a#b', 'x"y', "q'r", ' sp ', 'a"b\'c`d'.replace('`', '')]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aras-cfg-'));
    const p = path.join(base, 'config');
    writeConfig({ user: 'u#1', password: pw, server: 'http://h/s', database: 'D' }, p);
    const c = loadConfig({ env: {}, path: p });
    assert.equal(c.user, 'u#1');
    assert.equal(c.passwordHash, md5(pw), JSON.stringify(pw));
  }
});

test('writeConfig rejects newline and all-three-quotes values', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aras-cfg-')), 'config');
  assert.throws(() => writeConfig({ user: 'u', password: 'a\nb' }, p), /換行|newline/i);
  assert.throws(() => writeConfig({ user: 'u', password: 'a\'b"c`d' }, p), /引號|quote/i);
});

test('writeConfig tightens a pre-existing 0644 file', { skip: process.platform === 'win32' }, () => {
  const p = tmpFile('ARAS_AUTH_USER=old\n');
  fs.chmodSync(p, 0o644);
  writeConfig({ user: 'u', password: 'p', server: 'http://h/s', database: 'D' }, p);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  assert.equal(loadConfig({ env: {}, path: p }).user, 'u');
});

test('source reports 環境變數 vs 設定檔 without values', () => {
  const p = tmpFile('ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=secretpw\n');
  const fromFile = loadConfig({ env: {}, path: p });
  assert.match(fromFile.source.user, /設定檔/);
  assert.match(fromFile.source.password, /設定檔/);
  const mixed = loadConfig({ env: { ARAS_AUTH_PASSWORD: 'envpw' }, path: p });
  assert.match(mixed.source.user, /設定檔/);
  assert.equal(mixed.source.password, '環境變數');
  assert.ok(!JSON.stringify(mixed.source).includes('envpw'));
  assert.ok(!JSON.stringify(fromFile.source).includes('secretpw'));
});

test('credentialSourceLines: sources only, env reminder', async () => {
  const { credentialSourceLines } = await import('../lib/config.mjs');
  const p = tmpFile('ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=secretpw\n');
  const file = credentialSourceLines(loadConfig({ env: {}, path: p }));
  assert.equal(file.length, 2);
  assert.match(file[0], /^帳號來源：設定檔/);
  const env = credentialSourceLines(loadConfig({ env: { ARAS_AUTH_PASSWORD: 'envpw' }, path: p }));
  assert.equal(env[1], '密碼來源：環境變數');
  assert.match(env[2], /提醒/);
  assert.ok(!env.join('\n').includes('envpw') && !file.join('\n').includes('secretpw'));
});

test('aras.mjs check prints credential source even when the connection fails', { skip: process.platform === 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../aras.mjs', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aras-home-'));
  // 本機 discard 埠：連線被拒，不會碰到任何外部主機
  const env = { PATH: process.env.PATH, HOME: home, ARAS_AUTH_USER: 'u', ARAS_AUTH_PASSWORD: 'testpw-xyz', ARAS_SERVER: 'http://127.0.0.1:9/', ARAS_DATABASE: 'D' };
  const r = spawnSync(process.execPath, [cli, 'check'], { env, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /帳號來源：環境變數/);
  assert.match(r.stdout, /密碼來源：環境變數/);
  assert.ok(!(r.stdout + r.stderr).includes('testpw-xyz'));
});

test('ARAS_AUTH_PASSWORD_MD5 is used as the hash without re-hashing', () => {
  const hash = createHash('md5').update('secret').digest('hex').toUpperCase();
  const p = tmpFile(`ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD_MD5=${hash}\n`);
  const c = loadConfig({ env: {}, path: p });
  assert.equal(c.passwordHash, hash.toLowerCase());
  assert.match(c.source.password, /MD5/);
});

test('plaintext ARAS_AUTH_PASSWORD wins over ARAS_AUTH_PASSWORD_MD5', () => {
  const p = tmpFile(`ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD=pw\nARAS_AUTH_PASSWORD_MD5=${'0'.repeat(32)}\n`);
  assert.equal(loadConfig({ env: {}, path: p }).passwordHash, md5('pw'));
});

test('malformed ARAS_AUTH_PASSWORD_MD5 is rejected without echoing it', () => {
  const p = tmpFile('ARAS_SERVER=http://h/s\nARAS_DATABASE=D\nARAS_AUTH_USER=a\nARAS_AUTH_PASSWORD_MD5=notahash\n');
  assert.throws(() => loadConfig({ env: {}, path: p }), (e) => {
    assert.match(e.message, /ARAS_AUTH_PASSWORD_MD5/);
    assert.ok(!e.message.includes('notahash'));
    return true;
  });
});

test('missing both password keys names both', () => {
  const p = tmpFile('ARAS_AUTH_USER=a\n');
  assert.throws(() => loadConfig({ env: {}, path: p }), /ARAS_AUTH_PASSWORD.*ARAS_AUTH_PASSWORD_MD5|ARAS_AUTH_PASSWORD_MD5.*ARAS_AUTH_PASSWORD/);
});

test('writeConfig stores passwordMd5 under its own key and round-trips', () => {
  const p = tmpFile();
  const hash = md5('secret');
  writeConfig({ user: 'u', passwordMd5: hash.toUpperCase(), server: 'http://h/s', database: 'D' }, p);
  const body = fs.readFileSync(p, 'utf8');
  assert.match(body, /ARAS_AUTH_PASSWORD_MD5=/);
  assert.doesNotMatch(body, /^ARAS_AUTH_PASSWORD=/m);
  assert.equal(loadConfig({ env: {}, path: p }).passwordHash, hash);
});

test('writeConfig rejects a malformed passwordMd5', () => {
  assert.throws(() => writeConfig({ user: 'u', passwordMd5: 'xyz' }, tmpFile()), /MD5/);
});
