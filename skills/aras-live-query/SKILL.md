---
name: aras-live-query
description: Use when 需要對正式區 Aras（Innovator 11.0 SP12）做唯讀查詢、實查資料、查單據狀態或計數、驗證假設、寫一次性 AML 查詢腳本，或查詢結果「意外地多／空／欄位讀不到」時。
---

# 正式區 Aras 唯讀查詢

工具位置：本外掛根目錄的 `tools/...`（本 skill 目錄往上兩層）。以下 `tools/` 都指那裡。

先確認連線：`node tools/aras.mjs check`（會印出帳號、密碼來自環境變數或設定檔）。失敗時請使用者自己在終端機跑 setup，並給他**含絕對路徑、可直接貼上的指令**：外掛根目錄＝本 skill 基底目錄往上兩層，寫成 `node "<外掛根目錄絕對路徑>/tools/aras.mjs" setup`（不要給相對路徑的 `node tools/aras.mjs setup`，使用者的終端機不在外掛目錄裡）。**Claude 不詢問、不接收、不輸入密碼**（詳見 `aras-plm-overview`）。

## 兩種用法

| 情境 | 做法 |
|---|---|
| 單一查詢 | 把 AML（含 `<AML>…</AML>`）存成檔案，`node tools/aras.mjs aml query.xml`；或從標準輸入 `node tools/aras.mjs aml -`。輸出是 JSON 陣列，查無資料是 `[]`。非 `get` 的 action 會被拒絕（要 `--write`，見 `aras-live-write`） |
| 批次掃描、多步串查、要自己加工結果 | 寫一次性 `.mjs` 腳本，見下 |

### 一次性 `.mjs` 腳本

純 ESM，不需要 vite-node、也不用 `npm install`。`<外掛根目錄>` 換成本外掛的實際路徑：

```js
// q.mjs
import { applyAml, text, itemId, relationships, chunk, inList } from '<外掛根目錄>/tools/lib/aras.mjs';

const rows = await applyAml(`<AML>
  <Item type="Part" action="get" select="item_number,state,major_rev">
    <item_number>PART-0001</item_number>
  </Item>
</AML>`);

for (const r of rows) {
  console.log(text(r, 'item_number'), text(r, 'state'), text(r, 'major_rev'));
}
```

執行：`node q.mjs`。

- 一次性腳本預設只能讀；`applyAml` 遇到寫入動作會拒絕。寫入只走 `aras.mjs aml <檔> --write`，或在腳本中明確傳 `{ write: true }`——兩者都必須先完成 aras-live-write 六步流程。
- 腳本放 scratchpad 或暫存資料夾，**用完即刪**，不要留在外掛目錄裡。
- 帳密由 `applyAml` 自己從環境變數或 `~/.aras-plm/config` 讀取。**不要**在腳本、命令列、輸出裡出現密碼，也不要去讀那個設定檔。
- `tools/lib/aras.mjs` 的匯出：
  - `applyAml(aml, {timeout, write})`：送 AML（要含 `<AML>` 外層），回 `<Result>` 底下的元素陣列。查無資料回 `[]`，其他 Fault 丟例外。AML 含任何非 `get` 的 action（巢狀也算）而沒傳 `write: true` 時，連線前就丟例外。
  - `text(el, tag)`：直接子欄位的文字。`child(el, tag)`：直接子元素。
  - `itemId(el, tag)`：item 屬性的 GUID，同時處理扁平與展開的巢狀 `<Item>`。`keyedName(el, tag)`：該屬性的 `keyed_name`。
  - `i18nLabel(el, 'zt')`：多語系標籤（`language="zt"` 時中文在 `<i18n:label>`）。
  - `relationships(el, type?)`：只取 `<Relationships>` 的直接子 Item。`getElementsByTagName('Item')` 會把展開的 `related_id` 也抓進來，不要用。
  - `chunk(arr, 150)` 與 `inList(ids)`：把 id 切批，組成 `condition="in"` 的清單字串（`'id1','id2'`）。**清單是空的就跳過那支查詢、不要送**：空的 `condition="in"` 會變成 SQL `in ()`，回語法錯誤（Fault），不是 `[]`。
  - `toJson(el)`：把 Item 轉成 JSON（CLI 輸出就是它）。`props` 是直接子欄位文字（展開的 item 屬性取 id）；帶 `xml:lang` 的欄位以 `欄位@語言` 為鍵，例如 `label@en`、`i18n:label@zt`、`i18n:label@zc`。
- 端點由設定檔的 `ARAS_SERVER` 決定，通常形如 `http://<host>/<InnovatorServer 虛擬目錄>/Server/InnovatorServer.aspx`（注意大寫 `Server`）。ICMP 可能被擋，ping 不通不代表連不上，要判斷能不能連就發 HTTP 請求（`check`）。
- 大型掃描先用 `maxRecords="3"` 確認形狀，再全量跑。分頁要 `page` 與 `pagesize` 一起寫（`page="1" pagesize="500"`）；只寫 `pagesize` 會被靜默忽略、回傳全部。全庫掃描用 `created_on` 分頁。
- 只要欄位定義或某 Method 原始碼：先查 `aras-schema` 的快照，不用連線。

## 常用查詢鏈（已在正式區驗證）

**單據 → 簽核紀錄（誰被派、投了什麼）**：AML 不支援子查詢，要分三步。

```xml
<!-- 1. 單據的流程（Workflow 關聯 related_id = Workflow Process） -->
<Item type="ECN" action="get" select="item_number"><item_number>ECN-0001</item_number>
  <Relationships><Item type="Workflow" action="get" select="related_id"/></Relationships></Item>
<!-- 2. 流程的關卡 -->
<Item type="Workflow Process Activity" action="get" select="related_id"><source_id>{processId}</source_id></Item>
<!-- 3. 關卡的指派與投票（source_id = Activity，keyed_name 是關卡名稱；path = 投票選項名稱） -->
<Item type="Activity Assignment" action="get" select="source_id(name,state),related_id,closed_on,path">
  <source_id condition="in">{activityIds}</source_id></Item>
```

各步驟的 `{…}` 換成上一步查到的 id，每步包在自己的 `<AML>…</AML>` 送出。

**變更單 → 受影響物件 → 料號**：ECN 用關聯 `ECN Affected Item`（其他單據的關聯名稱查 `aras-schema` 的 `references/itemtypes/<單據>.md`）→ `related_id` 是 `Affected Item`，讀它的 `affected_id`（舊版）、`new_item_id`（新版）→ 再用 `id condition="in"` 查 Part 的 `state`、`major_rev`、`generation`。

## 讀取陷阱（都實際踩過）

完整說明（現象 → 原因 → 做法）在 `aras-plm-overview` 的 `references/gotchas.md`。速查：

| 現象 | 原因／做法 |
|---|---|
| 條件好像沒作用，回傳一大堆 | 欄位名稱打錯或不存在時，**條件與 select 都被靜默忽略**，沒有錯誤，所以「沒報錯」不等於「欄位對」。例：SavedSearch 的 ItemType 名稱欄是 `itname`，不是 `itemname`。先用 `aras-schema` 確認欄位名稱 |
| item 屬性讀到空字串或整段文字 | 用巢狀 `<Item>` 當條件、`select="prop(keyed_name)"`、Relationships 的 `related_id`，都會讓屬性**展開成巢狀 Item**。用 `itemId()` |
| 中文標籤讀成英文 | `language="zt"` 的中文在 `i18n:label`，不在 `label`；腳本用 `i18nLabel()`，CLI 看 `i18n:label@zt`／`i18n:label@zc` |
| `pagesize` 沒作用、逾時 | `pagesize` 要搭配 `page`；大型關聯表一定要帶 `source_id` 條件，否則全表掃描逾時 |
| 布林永遠為真 | OData 回傳字串 `"0"`／`"1"`，要明確轉型 |
| 查詢 48 秒逾時 | 大表跨欄位 `<OR>` 不走索引。拆成多支 `condition="in"` 查詢，自己合併去重 |
| `condition="in"` 回 SQL 語法錯誤 | 清單是空的（變成 `in ()`）。清單空就**跳過那支查詢、不要送**，結果直接當作查無 |
| 依 config_id 只查到一個版本 | Part 的所有版本要加 `<generation condition="gt">0</generation>` |
| 某時點的值查不到 | versionable 物件各世代的 `created_on` 都一樣，要看 `modified_on`；目前版本用 `is_current=1`（Activity 例外：`is_current` 全是 1，當前關卡要看 `state='Active'`） |
| 讀 Predecessor 等關聯回空 | 用 `<Relationships><Item type="X" action="get"/>`，不要用計算屬性的展開形式 |
| state 比對不到 | `state` 存的是 Life Cycle State 的 **name**（`Closed`），不是畫面上的 label（`close`）。2026-11-01 正式區實查：各 ItemType 實際的 state 名稱以其生命週期為準，先查 `Life Cycle State`，不要憑畫面標籤猜 |
| list 欄位 get 回來的是標籤 | 部分 list 欄位回人類標籤而不是代碼，先讀一筆確認是哪一種 |
| 回 `ItemNotFoundException` + Property 0000… | ItemType 定義壞了（data_source 是全 0 GUID），不是權限問題 |
| 計數多算了 | 查無時的 Fault 會帶查詢原文（含 `<Item type=`）；`applyAml` 已轉成 `[]`，自己呼叫其他方式時計數前先排除 |
| `can_update` 永遠是 `"0"` | `get_permissions` 不回權限欄位，不要拿它判斷能不能編輯 |
| OData 查 `source_id` 回 400／501／500 | 多型導覽屬性的 OData 只支援 `$filter=source_id eq '<guid>'`；要批次查改用 AML 的 `condition="in"` |
| Server Event 沒作用 | `server_event` 為空 = 該事件被停用；有些系統會用自訂屬性記錄原本綁的事件名，先看 Server Event 有沒有這類欄位 |

## 下結論前

- 結果是「零例外」時，**先跑對照組**（例如全庫分頁掃描）證明偵測方法真的抓得到，再說沒問題。只查主單就宣告沒有重複可能是錯的：流程有時掛在子項而不是主單。
- 實查得到的新事實，告訴使用者，建議補進 `aras-plm-overview` 的 `references/gotchas.md`。

寫入請改看 `aras-live-write`。
