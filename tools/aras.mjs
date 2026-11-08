#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { loadConfig, writeConfig, credentialSourceLines, CONFIG_PATH } from './lib/config.mjs';
import { applyAml, toJson, writeActions, text } from './lib/aras.mjs';

const USAGE = `用法：
  node tools/aras.mjs check
  node tools/aras.mjs aml <file|-> [--write]
  node tools/aras.mjs setup`;

function ask(rl, prompt, { mute = false } = {}) {
  return new Promise((resolve) => {
    if (mute) {
      const orig = rl._writeToOutput;
      rl._writeToOutput = () => {};
      process.stdout.write(prompt);
      rl.question('', (a) => {
        rl._writeToOutput = orig;
        process.stdout.write('\n');
        resolve(a);
      });
    } else {
      rl.question(prompt, resolve);
    }
  });
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const server = (await ask(rl, 'Aras 伺服器網址（例如 http://host/InnovatorServer/Server/InnovatorServer.aspx）：')).trim();
  const database = (await ask(rl, 'Aras 資料庫名稱：')).trim();
  const user = (await ask(rl, 'Aras 帳號：')).trim();
  const password = await ask(rl, 'Aras 密碼（不顯示；只有 MD5 雜湊也可以直接貼上）：', { mute: true });
  // 32 碼十六進位幾乎不可能是明文密碼；問一次，讓只拿到雜湊的人也能用
  const looksHashed = /^[0-9a-f]{32}$/i.test(password.trim());
  const answer = looksHashed ? (await ask(rl, '這看起來是 MD5 雜湊，要以雜湊存入（不再重算）嗎？[Y/n] ')).trim() : '';
  const asHash = looksHashed && !/^n/i.test(answer);
  rl.close();
  if (!server || !database || !user || !password) throw new Error('伺服器、資料庫、帳號與密碼都必填');
  writeConfig(asHash ? { user, passwordMd5: password.trim(), server, database } : { user, password, server, database });
  console.log(`已寫入 ${CONFIG_PATH}（權限 0600${asHash ? '，以 MD5 雜湊存入' : ''}）`);
}

async function check() {
  const config = loadConfig();
  // 先印來源再連線：登入失敗（例如殘留舊的 export 變數）時使用者最需要看到這幾行
  for (const line of credentialSourceLines(config)) console.log(line);
  const aml = `<AML><Item type="User" action="get" select="keyed_name,login_name" maxRecords="1"><login_name>${config.user
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</login_name></Item></AML>`;
  const rows = await applyAml(aml, { config });
  if (!rows.length) throw new Error('登入失敗或查無此使用者');
  console.log(`登入者：${text(rows[0], 'keyed_name')}`);
  console.log(`資料庫：${config.database}`);
}

async function aml(args) {
  const write = args.includes('--write');
  const src = args.find((a) => a !== '--write');
  if (!src) throw Object.assign(new Error(USAGE), { code: 1 });
  const body = fs.readFileSync(src === '-' ? 0 : src, 'utf8');
  const actions = writeActions(body);
  if (actions.length && !write) {
    console.error(`拒絕執行：AML 含寫入動作（${[...new Set(actions)].join(', ')}），確認後請加 --write`);
    process.exitCode = 2;
    return;
  }
  const rows = await applyAml(body, { write });
  console.log(JSON.stringify(rows.map(toJson), null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'check') await check();
  else if (cmd === 'aml') await aml(rest);
  else if (cmd === 'setup') await setup();
  else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = process.exitCode || e.code || 1;
}
