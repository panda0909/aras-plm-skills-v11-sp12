---
name: aras-schema
description: Use when 需要知道 Aras（Innovator 11.0 SP12）ItemType 的欄位名稱、型別、標籤、list 選項、RelationshipType、生命週期狀態與權限、Server Event、Item Action 綁了哪些 Method、某 Method 的原始碼，或要重新抓取系統快照時。
---

# Aras Schema 探索

本 skill 提供 Aras 的結構探索方法：欄位、關聯、生命週期、事件與 Method 原始碼。**先查快照（不用連線），快照沒有或懷疑過時才即時查。**

工具位置：本外掛根目錄的 `tools/...`（本 skill 目錄往上兩層）。以下 `tools/` 都指那裡。

## 1. 先查快照（若已抓取）

本外掛**不附快照**（每套 Aras 的自訂欄位與 Method 都不同）。第一次使用先在使用者同意後抓一份（只讀 Aras，寫入本外掛的 `references/`）：

```bash
node tools/snapshot.mjs itemtypes     # 先跑 itemtypes
node tools/snapshot.mjs methods       # 再跑 methods（順序不能反）
```

抓完後先讀 `references/SNAPSHOT.md` 看**抓取日期**。快照只是那一天的樣子，日期很舊、或查到的結果和使用者描述不符，就改用第 2 節即時查。`references/` 不存在或沒有 `SNAPSHOT.md` = 還沒抓過，直接即時查。

| 想知道 | 位置 |
|---|---|
| 欄位名稱、型別、標籤、list 名稱、必填 | `references/itemtypes/<ItemType>.md` 的「欄位表」 |
| 關聯（RelationshipType） | 同檔「RelationshipType」 |
| 生命週期狀態與轉換 | 同檔「生命週期」 |
| Server Event、Item Action 綁了哪些 Method | 同檔「Server Event」「Item Action」 |
| Method 原始碼 | `references/methods/<name>.<副檔名>`（C#／VB／JavaScript／Internal） |
| 哪個 Method 綁在哪個事件 | `references/methods/INDEX.md` 的 boundTo 欄，或 `grep -l "<Method名>" references/itemtypes/*.md` |

注意：

- 預設只涵蓋 `tools/snapshot.mjs` 的 `DEFAULT_ITEMTYPES`（約 66 個常用 ItemType，全系統有上千個）；要加自己的自訂 ItemType，用 `--only <名稱>` 或改那份清單。
- 檔名是 ItemType 的 name，含空格（例如 `Affected Item.md`）。
- `data_type = list` 的選項值不在快照裡，要查 `List`／`Value`。
- **Server Event 的「event」欄是空的 = 該事件被停用。** 有些系統會用自訂屬性記錄原本綁的事件名，先看 Server Event 有沒有這類欄位。
- Method 快照包含 Aras 內建 Method；自訂 Method 通常有統一的命名前綴。Method 是快照，**部署或修改前一定要讀正式區現行版本**（第 2 節 Method 範本）。

## 2. 即時 AML 查詢

用本外掛的工具執行（唯讀，不需 `--write`）：

```bash
node tools/aras.mjs aml query.xml        # 或：node tools/aras.mjs aml -  從標準輸入
```

先 `node tools/aras.mjs check` 確認連線與帳密設定（缺什麼鍵會告訴你）。查無資料會得到 `[]`。以下範本全部是唯讀（`action="get"`），把 `ECR` 換成目標名稱。

**ItemType 基本資料**（`language="zt"` 才有中文標籤）

```xml
<AML>
  <Item type="ItemType" action="get" language="zt" select="id,name,label">
    <name>ECR</name>
  </Item>
</AML>
```

**Property（欄位、型別、標籤、list 名稱）**

```xml
<AML>
  <Item type="Property" action="get" language="zt" select="name,label,data_type,data_source,is_required,sort_order">
    <source_id>
      <Item type="ItemType" action="get"><name>ECR</name></Item>
    </source_id>
  </Item>
</AML>
```

`data_source` 對 item／list／foreign 欄位是被指向的 ItemType／List／來源屬性（可能是 GUID，要再查 name）。

**RelationshipType（這個 ItemType 有哪些關聯）**

```xml
<AML>
  <Item type="ItemType" action="get" select="name">
    <name>ECR</name>
    <Relationships>
      <Item type="RelationshipType" action="get" select="name,relationship_id(name),related_id(name)"/>
    </Relationships>
  </Item>
</AML>
```

**Life Cycle Map（先找 Map，再取狀態與轉換）**

```xml
<AML>
  <Item type="ItemType" action="get" select="name">
    <name>ECR</name>
    <Relationships>
      <Item type="ItemType Life Cycle" action="get" select="related_id(name)"/>
    </Relationships>
  </Item>
</AML>
```

拿到 Map 的 id 後：

```xml
<AML>
  <Item type="Life Cycle Map" action="get" id="MAP_ID_HERE" select="name">
    <Relationships>
      <Item type="Life Cycle State" action="get" language="zt" select="name,label,sort_order,state_permission_id(name)"/>
      <Item type="Life Cycle Transition" action="get" select="from_state(name),to_state(name),role(name)"/>
    </Relationships>
  </Item>
</AML>
```

每個狀態的權限看 `state_permission_id` 指到的 Permission，再查其 `Access`（can_get／can_update／can_delete）與 Identity。權限的判斷方式：查 Permission 的 `Access` 關聯。

**Server Event（`server_event` 空 = 停用）**

```xml
<AML>
  <Item type="ItemType" action="get" select="name">
    <name>ECR</name>
    <Relationships>
      <Item type="Server Event" action="get" select="server_event,sort_order,related_id(name)"/>
    </Relationships>
  </Item>
</AML>
```

**Item Action（按鈕／選單動作綁的 Method）**

```xml
<AML>
  <Item type="ItemType" action="get" select="name">
    <name>ECR</name>
    <Relationships>
      <Item type="Item Action" action="get" select="related_id">
        <related_id>
          <Item type="Action" action="get" language="zt" select="name,label,method"/>
        </related_id>
      </Item>
    </Relationships>
  </Item>
</AML>
```

**反查：某個 Method 綁在哪些 ItemType 的哪個事件**

```xml
<AML>
  <Item type="Server Event" action="get" select="server_event,source_id(name)">
    <related_id>
      <Item type="Method" action="get"><name>MyMethod</name></Item>
    </related_id>
  </Item>
</AML>
```

**反查：哪些 ItemType 的屬性指向目標 ItemType**（先用 ItemType 範本取目標 id）

```xml
<AML>
  <Item type="Property" action="get" select="name,label,data_type,source_id(name)">
    <data_source>TARGET_ITEMTYPE_ID_HERE</data_source>
  </Item>
</AML>
```

**Method 現行原始碼**

```xml
<AML>
  <Item type="Method" action="get" select="name,method_type,method_code,comments">
    <name>MyMethod</name>
  </Item>
</AML>
```

**SQL 物件定義**（View／Function／Procedure）

```xml
<AML>
  <Item type="SQL" action="get" select="name,type,sqlserver_body">
    <name>MyOtherMethod</name>
  </Item>
</AML>
```

## 3. 讀取陷阱

- **欄位名拼錯不會報錯**：`select` 與條件裡不存在的屬性會被靜默忽略（條件失效 = 回傳全部），結果「看起來成功」。先用 Property 範本確認欄位名。
- **item 屬性可能是展開的**：只要有巢狀 `<Item>` 條件或 `select="x(name)"`，Aras 會把該屬性回成巢狀 `<Item>` 而不是平的 GUID；解析時兩種都要處理。
- **中文標籤**：要加 `language="zt"`；簡體是 `zc`。沒指定語言可能只有英文或空白。
- **布林值是字串** `"0"`／`"1"`，不要直接當 true/false 判斷。
- **`<OR>` 條件很慢**：大表上可能逾時，拆成兩支查詢再合併。
- **大量資料要分頁**：`page`／`pagesize`；Method 全量用快照工具，不要一次查。
- **Relationship 查詢用 Relationships 巢狀**：從來源 Item 往下巢狀取，不要用各種「便利屬性」。

## 4. 重新快照

```bash
node tools/snapshot.mjs itemtypes            # 先跑 itemtypes
node tools/snapshot.mjs methods              # 再跑 methods（boundTo 欄由 itemtypes 快照反查，所以順序不能反）
node tools/snapshot.mjs itemtypes --only ECR # 只重抓單一 ItemType（想新增快照範圍的 ItemType 也用這招）
node tools/snapshot.mjs methods --only MyMethod   # 只重抓單一 Method；不會更新 methods/INDEX.md
```

會覆寫 `references/itemtypes/`、`references/methods/`（全量時先清空再寫）與 `references/SNAPSHOT.md`（完整抓取時抓取日期更新為當天；`--only` 不動抓取日期，只更新「部分更新」行，記下該項目與日期）。重新快照只讀取、不寫入 Aras。預設的 ItemType 清單在 `tools/snapshot.mjs`。

**在已安裝的外掛上重新快照，只會更新本機的外掛快取**：下次外掛更新時會被覆蓋，其他管理員也看不到。要讓所有人都拿到新快照，請外掛維護者在外掛的原始 repo 重新快照、跑 `npm test` 與 `npm run check`，再重新發布。

## 5. 查完之後

- 要修改資料或部署 Method：遵守寫入規則，需要使用者在對話中明確同意後才可加 `--write`。
- 引用快照內容給使用者時，註明快照日期；涉及「現在正式區是什麼」的結論，用即時查詢確認。
