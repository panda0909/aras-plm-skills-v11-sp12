# aras-plm-skills-v11-sp12

給 **Aras Innovator 11.0 SP12** 管理員的 Claude 外掛（通用版）：讓 Claude 唯讀實查正式區、診斷單據問題，並在你明確同意後修正資料（先備份、讀回驗證）或部署 Method。

## 需求

- Node.js 22 以上，不需 `npm install`（零依賴）
- 你自己的 **Aras 原生帳號與密碼**（不是 AD／Windows 密碼），已有 Administrators 權限
- 能以 HTTP 連到 Aras 伺服器

## 安裝（本地）

本資料夾是 Claude Code 外掛格式（`.claude-plugin/plugin.json` 加 `skills/`）。

**試用（單次工作階段）**：

```bash
claude --plugin-dir <本資料夾絕對路徑>
```

每次啟動都要帶這個參數，不會改動全域設定。載入後可輸入 `/help` 或問 Claude，確認看得到 5 個 `aras-*` skill。

**長期安裝**：建一個本地 marketplace（內含 `.claude-plugin/marketplace.json` 指向本外掛），再執行 `/plugin marketplace add <marketplace 路徑>` 與 `/plugin install aras-plm-skills-v11-sp12`。

**不要只複製 `skills/`**：skill 會以「skill 目錄往上兩層」找 `tools/aras.mjs`，只複製 skill 會找不到工具。

## 設定

在**你自己的終端機**執行（路徑換成外掛實際位置）：

```bash
node "<外掛根目錄絕對路徑>/tools/aras.mjs" setup   # 互動輸入伺服器網址、資料庫、帳號、密碼
node "<外掛根目錄絕對路徑>/tools/aras.mjs" check   # 驗證連線
```

- 設定存在 `~/.aras-plm/config`（權限 0600）。外掛內不含任何帳密或伺服器位址。
- 也可用環境變數 `ARAS_SERVER`、`ARAS_DATABASE`、`ARAS_AUTH_USER`、`ARAS_AUTH_PASSWORD`（或 `ARAS_AUTH_PASSWORD_MD5`）；環境變數優先於檔案。
- **伺服器網址與資料庫名稱都必填**，沒有預設值。網址通常形如 `http://<host>/<虛擬目錄>/Server/InnovatorServer.aspx`。
- Claude 不會詢問、接收或輸入你的密碼。

## 工具

| 指令 | 用途 |
|---|---|
| `node tools/aras.mjs check` | 驗證連線與帳密 |
| `node tools/aras.mjs aml <檔案或 ->` | 執行 AML，輸出 JSON；含寫入動作要加 `--write` |
| `node tools/aras.mjs setup` | 互動設定 |
| `node tools/snapshot.mjs itemtypes\|methods [--only <名稱>]` | 抓取結構快照（先 itemtypes 再 methods） |
| `npm test` / `npm run check` | 單元測試／外掛內容檢查 |

## Skill

| skill | 用途 |
|---|---|
| `aras-plm-overview` | 入口、標準 ItemType 地圖、實戰陷阱 |
| `aras-schema` | 欄位、關聯、生命週期、Method 原始碼（需先抓快照） |
| `aras-live-query` | 正式區唯讀查詢與一次性腳本 |
| `aras-live-write` | 修改正式區資料（同意、備份、讀回） |
| `aras-deploy-server-method` | 部署 Method、Property、Server Event |

## 第一次使用建議

1. `setup` → `check`
2. 跑 `node tools/snapshot.mjs itemtypes` 與 `methods` 抓取你自己系統的快照（只讀）
3. 有自訂 ItemType 時，加到 `tools/snapshot.mjs` 的 `DEFAULT_ITEMTYPES`，或用 `--only` 補抓
