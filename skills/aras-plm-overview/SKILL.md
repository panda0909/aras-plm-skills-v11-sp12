---
name: aras-plm-overview
description: Use when 使用者提到 Aras Innovator（11.0 SP12）、PLM 的料號（Part）、ECR／ECN 變更單、專案、流程簽核，或任何 Aras 單據出問題、要查資料、要修正資料、要查欄位或 Method、要部署 Method 時，先讀這個入口 skill 決定該用哪個 skill。
---

# Aras PLM（Innovator 11.0 SP12）管理入口

本外掛給 Aras 管理員用，讓 Claude 能**實查**正式區、診斷單據問題，並在你同意後修正資料、部署 Method。

工具位置：本外掛根目錄的 `tools/...`（本 skill 目錄往上兩層）。以下 `tools/` 都指那裡。

## 第一次使用

1. 跑 `node tools/aras.mjs check`。成功會印出登入者、資料庫名稱，以及帳號、密碼各自的來源（`環境變數` 或 `設定檔（~/.aras-plm/config）`，只印來源不印值）。
2. 失敗（缺設定或登入失敗）→ **請使用者自己在自己的終端機**跑 setup，依序輸入伺服器網址、資料庫名稱、Aras 帳號與密碼（輸入密碼時看不到字元）。設定存在 `~/.aras-plm/config`。
   - 給使用者**可直接貼上的完整指令**：用本 skill 的基底目錄（base directory）往上兩層算出外掛根目錄的**絕對路徑**，整段加引號：`node "<外掛根目錄絕對路徑>/tools/aras.mjs" setup`。
   - **不要**給相對路徑的 `node tools/aras.mjs setup`：使用者的終端機不在外掛目錄裡。
   - setup 後 `check` 仍失敗、且來源顯示 `環境變數`：使用者的 shell 可能留著舊的 `ARAS_*` 變數，它們優先於設定檔。請使用者自己 `unset` 後重試。
3. **Claude 絕不詢問、接收或輸入密碼。** 不要請使用者把密碼貼進對話，也不要自己去讀 `~/.aras-plm/config`。
4. 登入失敗最常見原因：輸入的是 AD／Windows 密碼，而這裡要的是 **Aras 原生密碼**。
5. 只有 MD5 雜湊也可以：setup 時直接貼上雜湊，回答 Y 就存成 `ARAS_AUTH_PASSWORD_MD5`，不再重算。

## 原則

- **一律先查證再下結論。** 不要憑記憶、憑畫面或使用者的描述推測；用唯讀查詢看正式區實際資料。
- 「查不到」「零筆」「沒有重複」都要懷疑查詢本身：欄位名稱打錯 Aras 不會報錯，只會靜默忽略（見 `references/gotchas.md`）。零例外的結論要跑對照組。
- **寫入正式區的規則見 `aras-live-write`**：使用者在對話中明確同意、先備份、讀回驗證。工具也有 `--write` 閘門。
- 單據操作要用的料號、單號、專案編號，以使用者提供的為準；不確定就先問。

## 問題類型 → 該用的 skill

| 問題 | skill |
|---|---|
| 想知道欄位名稱、型別、關聯、生命週期、Server Event 綁了什麼、某 Method 原始碼 | `aras-schema` |
| 唯讀實查：單據狀態、計數、驗證假設、一次性查詢腳本、查詢結果怪怪的 | `aras-live-query` |
| 要修改正式區資料（edit／add／delete、補欄位、改 Identity、刪流程、推進狀態） | `aras-live-write` |
| 要部署 Server Method（C#）、新增 Property、綁 Server Event／Action，或部署後功能半殘 | `aras-deploy-server-method` |

不確定屬於哪一類時，先用 `aras-live-query` 把事實查清楚，再選 skill。

## 標準 ItemType 地圖

| 領域 | ItemType | 說明 |
|---|---|---|
| 料號與文件 | `Part`、`Document`、`CAD` | Part 有多個世代（`generation`、`is_current`） |
| 變更單 | `ECR`、`ECN`、`Express DCO`、`Simple ECO` | 各自有受影響物件關聯；`Affected Item` 的 `affected_id`＝舊版、`new_item_id`＝新版 |
| 專案 | `Project`、`WBS Element`、`Activity2` | 樹的順序靠 `prev_item` 鏈；關聯有 `Sub WBS`、`WBS Activity2`、`Predecessor`、`Project Team` |
| 人員 | `User`、`Identity`、`Member` | 簽核、負責人、擁有者多半指向 Identity，不是 User |
| 流程 | `Workflow Process`、`Workflow Process Activity`、`Activity Assignment`、`Workflow` 關聯 | 單據 →（`Workflow` 關聯）→ 流程 → 關卡 → 指派與投票 |
| 系統定義 | `ItemType`、`Property`、`RelationshipType`、`Method`、`Server Event`、`List`／`Value`、`Life Cycle Map` | 結構與行為都存在這些 Item 裡，可用 AML 查 |

自訂的 ItemType 與欄位因系統而異，一律查 `aras-schema`，不要憑這張表推測欄位名稱。

## 實戰陷阱

欄位靜默忽略、屬性展開成巢狀 Item、OR 查詢逾時、多語標籤在 `i18n:label`、關聯寫入必須巢狀、狀態值與畫面不同…整理在 `references/gotchas.md`。查詢結果怪怪的時先翻它。
