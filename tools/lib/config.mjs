import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const CONFIG_PATH = path.join(os.homedir(), '.aras-plm', 'config');
const ARAS_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'aras.mjs');

export function md5(text) {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

const MD5_RE = /^[0-9a-f]{32}$/i;

/**
 * 讀設定：環境變數優先於檔案；不寫回 process.env。
 * 密碼二擇一：`ARAS_AUTH_PASSWORD`（明文，這裡算 MD5）或 `ARAS_AUTH_PASSWORD_MD5`（已是雜湊，直接用）；兩者都有時用明文。
 * `source` 記錄帳號／密碼各來自環境變數或設定檔（不含值）。
 */
export function loadConfig({ env = process.env, path: file = CONFIG_PATH } = {}) {
  let fromFile = {};
  if (fs.existsSync(file)) {
    if (process.platform !== 'win32') {
      const mode = fs.statSync(file).mode;
      if (mode & 0o077) {
        process.stderr.write(`警告：${file} 權限過寬，建議執行 chmod 600 ${file}\n`);
      }
    }
    fromFile = parseEnv(fs.readFileSync(file, 'utf8'));
  }
  const get = (k) => env[k] || fromFile[k] || '';
  const passwordKey = get('ARAS_AUTH_PASSWORD') ? 'ARAS_AUTH_PASSWORD' : get('ARAS_AUTH_PASSWORD_MD5') ? 'ARAS_AUTH_PASSWORD_MD5' : '';
  const missing = [];
  if (!get('ARAS_SERVER')) missing.push('ARAS_SERVER');
  if (!get('ARAS_DATABASE')) missing.push('ARAS_DATABASE');
  if (!get('ARAS_AUTH_USER')) missing.push('ARAS_AUTH_USER');
  if (!passwordKey) missing.push('ARAS_AUTH_PASSWORD（或 ARAS_AUTH_PASSWORD_MD5）');
  if (missing.length) {
    throw new Error(
      `缺少設定：${missing.join('、')}。請在 ${file} 以 KEY=VALUE 格式設定（或用環境變數），` +
        `可在終端機執行 node "${ARAS_CLI}" setup 互動建立。`,
    );
  }
  const isHash = passwordKey === 'ARAS_AUTH_PASSWORD_MD5';
  // 不回顯值：錯誤訊息只講格式
  if (isHash && !MD5_RE.test(get(passwordKey))) throw new Error('ARAS_AUTH_PASSWORD_MD5 必須是 32 碼十六進位的 MD5 雜湊');
  const source = (k) => (env[k] ? '環境變數' : `設定檔（${file}）`);
  return {
    user: get('ARAS_AUTH_USER'),
    passwordHash: isHash ? get(passwordKey).toLowerCase() : md5(get(passwordKey)),
    server: get('ARAS_SERVER'),
    database: get('ARAS_DATABASE'),
    // 只記來源，不含值；給 check 指令顯示「帳密從哪來」
    source: { user: source('ARAS_AUTH_USER'), password: source(passwordKey) + (isHash ? '，MD5 雜湊' : '') },
  };
}

function quoteValue(label, v) {
  if (/[\r\n]/.test(v)) throw new Error(`${label} 不可含換行`);
  for (const q of ["'", '"', '`']) if (!v.includes(q)) return q + v + q;
  throw new Error(`${label} 同時含單引號、雙引號與反引號，無法安全存入設定檔`);
}

/** 寫設定檔：資料夾 0700、檔案 0600（先寫 0600 暫存檔再 rename，避免舊檔權限過寬時洩漏）。密碼給 `password`（明文）或 `passwordMd5`（雜湊）其一。 */
export function writeConfig({ user, password, passwordMd5, server, database }, file = CONFIG_PATH) {
  const dir = path.dirname(file);
  if (passwordMd5 !== undefined && !MD5_RE.test(passwordMd5)) throw new Error('MD5 雜湊必須是 32 碼十六進位');
  let body = `ARAS_AUTH_USER=${quoteValue('帳號', user)}\n`;
  body += passwordMd5 !== undefined
    ? `ARAS_AUTH_PASSWORD_MD5=${passwordMd5.toLowerCase()}\n`
    : `ARAS_AUTH_PASSWORD=${quoteValue('密碼', password)}\n`;
  if (server) body += `ARAS_SERVER=${quoteValue('server', server)}\n`;
  if (database) body += `ARAS_DATABASE=${quoteValue('database', database)}\n`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** check 指令要印的帳密來源行（只有來源，不含值）。在連線之前印，登入失敗時才看得到。 */
export function credentialSourceLines(config) {
  const lines = [`帳號來源：${config.source.user}`, `密碼來源：${config.source.password}`];
  if ([config.source.user, config.source.password].includes('環境變數')) {
    lines.push('提醒：環境變數優先於設定檔；若曾 export 過舊的 ARAS_AUTH_*，會蓋掉設定檔內容。');
  }
  return lines;
}
