# Aras 實戰陷阱

每條格式：**現象 → 原因 → 正確做法**。查詢結果「意外地多／空／欄位讀不到」時先翻這份。

讀取類 AML 範例可存成檔案後用 `node tools/aras.mjs aml <檔案>` 執行。含寫入動作的範例會特別標註，不可直接執行。

目錄：[讀取](#讀取) ・ [寫入](#寫入) ・ [關聯](#關聯) ・ [多語系](#多語系) ・ [流程](#流程) ・ [檔案](#檔案) ・ [連線](#連線)

---

## 讀取

### 1. 欄位名稱打錯，Aras 不報錯

- **現象**：`select` 或查詢條件裡的欄位寫錯，沒有任何錯誤。條件整個失效，查詢結果比預期寬很多（例：SavedSearch 想過濾 ItemType，卻回傳全部紀錄）。
- **原因**：Aras 對 ItemType 上不存在的 property **靜默忽略**。`select` 裡寫錯的欄位直接不回；criteria 裡寫錯的條件直接當作沒寫；`edit`／`add` 裡寫錯的欄位，值被丟棄，其餘欄位照常寫入，還回成功。所以「沒報錯」不等於「欄位對」。
- **正確做法**：
  - 查詢前先用 `aras-schema` skill 確認欄位名稱。常見易錯：SavedSearch 過濾 ItemType 用 `itname`（不是 `itemname`）。
  - 先小量查（`maxRecords="3"`）看回傳形狀，再全量。
  - 部署會用到新欄位的 Method 前，先檢核 Property 都存在、數量對得上：

```xml
<AML>
  <Item type="Property" action="get" select="name">
    <source_id>ITEMTYPE_ID_HERE</source_id>
    <name condition="in">'欄位A','欄位B','欄位C'</name>
  </Item>
</AML>
```

  - 守門條件不可假設「欄位不存在會報錯」。曾發生加簽功能先部署 Method、欄位沒建齊，結果守門條件失效，症狀是誤擋而不是爆錯。

### 2. item 型別屬性讀到空字串或整段文字

- **現象**：讀 `source_id`、`owned_by_id`、`related_id` 之類的 item 屬性，拿到空字串，或一大串子元素的文字。
- **原因**：下面三種情況，Aras 會把該屬性**展開成巢狀 `<Item id="GUID">`**，而不是扁平的 `<prop>GUID</prop>`：
  1. 用巢狀 `<Item>` 當條件，例如 `<source_id><Item type="User"><login_name>…</login_name></Item></source_id>`；
  2. `select` 裡寫 `prop(keyed_name)`，即使只選 `keyed_name` 也一樣會展開；
  3. `<Relationships>` 裡讀到的 `related_id`。
  只認扁平格式的解析方式會默默得到空值。
- **正確做法**：解析時兩種形式都要處理。用本外掛 `tools/lib/aras.mjs` 的 `itemId(el, 'prop')`（先看有沒有巢狀 `Item` 取其 `id`，沒有才取文字）。展開後屬性本身只有 `keyed_name`／`type` 屬性，**GUID 在巢狀 `Item` 的 `id` 上**。
- Project 的 `managed_by_id`、`owned_by_id` 指向的是 **Identity**，不是 User；要比對使用者時用該使用者對應的 Identity id。

### 3. 大表 `<OR>` 查詢逾時

- **現象**：`Affected Item` 兩欄 `<OR>` 查詢跑 48 秒才回，超過逾時。
- **原因**：`<OR>` 跨欄位讓 SQL 用不到欄位索引，大表整表掃描。
- **正確做法**：拆成多支各自 `condition="in"` 的查詢，結果自己合併去重。實測拆開後每支約 1.7 秒。

```xml
<!-- 慢（48 秒）：-->
<Item type="Affected Item" action="get" select="id">
  <OR>
    <affected_id condition="in">'ID1','ID2'</affected_id>
    <new_item_id condition="in">'ID1','ID2'</new_item_id>
  </OR>
</Item>
<!-- 快（各約 1.7 秒）：拆成兩支，各只放一個 condition="in" -->
```

### 4. 布林欄位永遠為真

- **現象**：ItemType 的 `is_relationship`、`is_versionable` 這類欄位，判斷式恒為「是」。
- **原因**：OData 回傳的布林是**字串** `"0"`／`"1"`。JavaScript 的字串 `"0"` 是 truthy。
- **正確做法**：明確轉型再判斷，例如 `v === true || v === 1 || v === '1'`。不要直接放進三元式或 `if`。AML 回來的文字同理，都是字串。

### 5. 查無資料是 Fault，不是空集合

- **現象**：`action="get"` 零筆時 Aras 回 SOAP Fault `No items of type X found`；計數時若沒排除，會把 Fault 的文字（含查詢原文 `<Item type=`）算進去。
- **原因**：Aras 的設計。
- **正確做法**：本外掛的 `applyAml` 已經把這一種 Fault 轉成 `[]`，其他 Fault 一律拋例外。自己寫其他呼叫方式時要只吞這一種，其餘照拋。
- 另一個零筆陷阱：往上走的查詢（例：用 `related_id` 反查根節點的 `Sub WBS`）到頂端沒有上層，會回這個 Fault，要當成「走到頂了」。

### 6. 其他讀取行為

| 現象 | 原因／做法 |
|---|---|
| 依 `config_id` 只查到一個版本 | Part 全部版本要加 `<generation condition="gt">0</generation>` |
| 某時點的值查不到 | versionable 物件各世代的 `created_on` 都一樣，要看 `modified_on`；目前版本用 `is_current=1`（Activity 例外：`is_current` 全是 1，當前關卡看 `state='Active'`） |
| `state` 比對不到 | `state` 存的是 Life Cycle State 的 **name**（`Closed`），不是畫面上的 label（`close`）。查詢與寫入一律用 name |
| list 欄位 `get` 回來是標籤 | 部分 list 欄位回人類標籤而不是代碼，先讀一筆確認 |
| 回 `ItemNotFoundException` + Property 0000… | ItemType 定義壞了（data_source 是全 0 GUID），不是權限問題 |
| `action="某名稱"` 回 `ItemNotFoundException` | 該 action 名稱沒有同名 Method；Aras 以 action 名稱找同名 Method。`ItemNotFoundException` 指「找不到這個 action」，不是找不到單據（單據不存在是 `No items of type X found`） |
| `can_update` 永遠是 `"0"` | `get_permissions="1"` 實測不回權限欄位，不要用它判斷能不能編輯；實際去寫，失敗再回報 |
| OData 查 `source_id` 回 400／501／500 | `source_id` 是多型導覽屬性，OData 只支援 `$filter=source_id eq '<guid>'`；要批次查改用 AML 的 `condition="in"` |
| `pagesize` 沒作用，回傳上千筆或逾時 | **`pagesize` 一定要和 `page` 一起用**（例如 `page="1" pagesize="500"`）；只寫 `pagesize` 會被靜默忽略、回傳全部。大型關聯表一定要帶 `source_id` 條件，沒帶可能逾時 |
| `Item` 的 `condition="in"` 清單 | GUID 清單**不加引號**也實測可用；`chunk()` 預設每批 150 個（只是預設值，不是實測上限） |
| 空的 `condition="in"` 清單 | **不要送**：空清單會變成 SQL `in ()`，回語法錯誤（Fault），不是 `[]`。清單空就跳過那支查詢，結果直接當作查無 |


---

## 寫入

（寫入的同意、備份、讀回流程見 `aras-live-write` skill；這裡只放行為陷阱。）

### 7. 寫入「成功」但沒存進去

- **現象**：`edit`／`add` 回成功，欄位或關聯重新整理後不見。
- **原因**：多半是欄位名稱不存在（見讀取 #1，值被靜默丟棄），或是 relationship 沒有巢狀（見下面關聯 #9）。
- **正確做法**：寫入後一律**讀回驗證**。


### 8. 名稱要照系統既有的拼字（包括錯字）

- **現象**：把看起來拼錯的名稱「修正」後再寫，回成功但什麼都沒發生。
- **原因**：自訂的 ItemType、關聯、欄位名稱可能本身就拼錯，而 Aras 對不存在的名稱多半靜默忽略。
- **正確做法**：名稱一律從 `aras-schema` 快照或即時查詢複製，不要自己改拼字。

---

## 關聯

### 9. 新增 relationship 必須巢狀在來源 Item 的 `edit` 之下

- **現象**：獨立一個頂層 `<Item type="Rel" action="add"><source_id>…</source_id><related_id>…</related_id></Item>`，回成功、沒有 Fault，但資料根本沒存。
- **原因**：Aras 只有在 `action="add"` 巢狀於**來源 Item 的 `action="edit"`** 時才可靠地寫入關聯，且巢狀內只放 `<related_id>`（不放 `source_id`）。
- **正確做法**：

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Activity2" action="edit" id="SOURCE_ID">
    <Relationships>
      <Item type="Predecessor" action="add"><related_id>RELATED_ID</related_id></Item>
      <Item type="Predecessor" action="delete" id="EXISTING_REL_ID"/>
    </Relationships>
  </Item>
</AML>
```

### 10. 讀關聯用 Relationships，不要用計算屬性展開

- **現象**：讀 Activity2 的前置任務，用 `predecessors` 屬性展開（`<predecessors select="…"/>`）什麼都沒回，即使關聯資料確實存在。
- **原因**：該計算屬性展開實測回空。
- **正確做法**：

```xml
<AML>
  <Item type="Activity2" action="get" id="ACTIVITY_ID" select="id">
    <Relationships>
      <Item type="Predecessor" action="get" select="id,related_id,lead_lag,precedence_type"/>
    </Relationships>
  </Item>
</AML>
```

  回來的 `related_id` 會展開成巢狀 Item，GUID 在巢狀 `Item` 的 `id` 屬性上，用 `itemId()` 取。

### 11. 解析 Relationships 只取直接子 Item

- `getElementsByTagName('Item')` 會把展開的 `related_id` 底下的 Item 也抓進來。要用 `tools/lib/aras.mjs` 的 `relationships(el, type)`，只取 `<Relationships>` 的直接子層。

### 12. Workflow 關聯的 `source_id` 查詢

- `Workflow` 關聯的 `source_id` 是單據 id。批次偵測用 AML 才有扁平 `source_id`：

```xml
<AML>
  <Item type="Workflow" action="get" select="id,source_id,related_id,created_on">
    <source_id condition="in">'id1','id2'</source_id>
  </Item>
</AML>
```

  `related_id` 會自動展開成巢狀 Workflow Process。


---

## 多語系

### 13. 中文標籤讀成英文

- **現象**：`Value`／`Filter Value`／`Life Cycle State` 等的標籤讀出來是英文。
- **原因**：`language="zt"` 時回傳 `<label xml:lang="en">` **加上** `<i18n:label xml:lang="zt">`。中文在 `i18n:label` 元素裡，`label` 元素仍是英文。
- **正確做法**：查詢加 `language="zt"`，讀取用 `i18nLabel(el)`（先取 `i18n:label`，沒有才退回 `label`）。解析 XML 時標籤名稱帶冒號，要用完整標籤名比對。簡體標籤是 `zc`。CLI（`node tools/aras.mjs aml`）的 JSON 會把帶 `xml:lang` 的欄位依語言分開：`label@en`、`i18n:label@zt`、`i18n:label@zc`。
- **寫入多語系標籤**（Property、List 的 Value、Action 等 `ml_string` 欄位）：英文寫 `<label xml:lang="en">`，中文寫 `<i18n:label xml:lang="zt" xmlns:i18n="http://www.aras.com/I18N">`（繁體）與 `xml:lang="zc"`（簡體）。資料庫裡對應的欄位是 `label`（英文）、`label_zt`（繁體）、`label_zc`（簡體），直接查 SQL 時用這三欄。新欄位、新選項三語都要給，**`zc` 必備**（使用者要求）。範本見 `aras-deploy-server-method`。

---
## 流程

## 流程

### 20. 流程相關的操作行為

- `cancelWorkflow` **不是 AML action**：送 `action="cancelWorkflow"` 回的 `ItemNotFoundException` 指「找不到這個 action」。取消流程要靠包一支同名 Method。
- 不要用 `EvaluateActivity` 走 `To Cancel` 路徑取消流程，那會把單據本身推成 Cancelled（可能包含已 Released 的單據）。
- 刪 Workflow Process 前要先刪 Workflow 關聯，否則 `PurgeItemEx2` 回 `Referenced items found`。
- Workflow 關聯常被發起人殘留的鎖住；刪除前一律先 unlock（unlock 要列進表格取得同意，見 `aras-live-write`）。
- 判斷「還活著的流程」要看 Active 或 Closed（正常結案），Cancelled 不算。
- 已取消的流程無法復原；重新發起要先清掉子單所有 Workflow 關聯與 Process（含已取消的）。

---

## 檔案

### 22. 從瀏覽器端上傳檔案到 vault

- vault 的 `vault.CommitTransaction`（multipart body）內嵌一段由 **vault 伺服器端**代發給 Innovator 的請求（`POST <url>File HTTP/1.1`）。這個 URL 若用相對路徑（如 `/<虛擬目錄>/server/odata/File`），vault 端解析不了，**回 500**。必須用**絕對**的 Innovator OData 網址 `http://<host>/<InnovatorServer 虛擬目錄>/Server/odata/File`。
- 流程：`BeginTransaction` → `UploadFile`（分塊）→ `CommitTransaction`；成功後取得 32 碼的 File GUID。

### 23. Image 型別屬性要存 `vault:///?fileId=<id>`

- **現象**：把 File 的純 GUID 寫進 Image 屬性（如 CAD_Auto／CAD_Auto_Part 的 `view_file`「縮圖」），圖片破圖。
- **原因**：Image 屬性需要 vault 路徑格式，純 GUID 組不出圖片 URL。
- **正確做法**：寫入值是 `vault:///?fileId=862FE44560C942B294800520496122DE`（換成實際 File id）。診斷法：在 Aras 表單手動上傳同一屬性能正常顯示，代表算圖沒問題，問題在寫入值格式。

---
## 連線

### 24. ping 不通不代表連不上

- Aras 伺服器的 ICMP 可能被擋，ping 100% 遺失不代表伺服器不可用。判斷能否連線要發 HTTP 請求（`node tools/aras.mjs check`）。
