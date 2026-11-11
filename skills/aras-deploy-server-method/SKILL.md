---
name: aras-deploy-server-method
description: Use when 要在正式區 Aras（Innovator 11.0 SP12）新增或修改 Server Method（C#）、新增 Property 欄位或 List 選項、綁 Server Event／Item Action／Activity Template Method，或部署後功能「沒報錯但半殘」時。
---

# 部署 Aras Server Method／Property

工具位置：本外掛根目錄的 `tools/...`（本 skill 目錄往上兩層）。以下 `tools/` 都指那裡。連線與查詢見 `aras-live-query`；寫入流程見 `aras-live-write`；欄位、事件、Method 快照見 `aras-schema`。

正式區只有一個環境，部署就是改正式系統。下面每一個寫入範本都要走 `aras-live-write` 的六步：前置檢查 → 列出變更給使用者確認 → 備份 → 執行 → 讀回 → 失敗復原。

## 鐵則

1. **部署前一定讀正式區現行版本。** 手上的原始碼常常比正式區舊。直接覆蓋會把別人在正式區改過的邏輯蓋掉。
2. **先建 Property，再部署 Method。** Aras 對不存在的欄位**靜默忽略**：edit／add 時值被丟掉、get 時條件失效（等於沒過濾），都不報錯。欄位沒建齊，Method 不會爆錯，而是「半殘」：資料少寫、守門條件誤擋或漏擋。
3. 每個寫入都要能還原：事先備份現行 `method_code` 與綁定，寫好還原步驟。**刪 Property 會連資料庫欄位與資料一起刪，無法還原。**
4. 部署前後都用快照工具更新對應快照（DEP-P5、DEP-V9）。
5. 每一步寫入前，使用者同意之後、送 `--write` 之前的那一刻，重跑該步的前置檢查（DEP-X1）。

## 部署順序

| 步 | 內容 | id |
|---|---|---|
| 1 | 讀正式區現行 Method、比對原始碼 | DEP-P1 |
| 2 | 檢核 Method 用到的欄位都存在（新欄位列為待建） | DEP-P2 |
| 3 | 查目前綁定（Server Event／Item Action／Activity Template Method） | DEP-P3 |
| 4 | 名稱拼字照系統 | DEP-P4 |
| 5 | 部署前更新快照 | DEP-P5 |
| 6 | 列出全部變更給使用者確認 | DEP-K |
| 7 | 同意後、每步寫入前重跑 | DEP-X1 |
| 8 | 備份 | DEP-B |
| 9 | 新增 Property（與 List 選項） → 讀回 | DEP-W1、DEP-W2 → DEP-V1、DEP-V2 |
| 10 | 新增或更新 Method → 讀回 | DEP-W3／DEP-W4 → DEP-V3 |
| 11 | 編譯檢查（先不綁） | DEP-W5 |
| 12 | 綁 Server Event／Item Action／Activity Template Method → 讀回 | DEP-W6～W8 → DEP-V6～V8 |
| 13 | 部署後更新快照、實測 | DEP-V9、DEP-T |

---

## 前置檢查（全部唯讀）

把 `{…}` 換成實際值，存成檔案，`node tools/aras.mjs aml <檔案>` 執行。

### DEP-P1 正式區現行 Method

- **條件**：讀到現行 `method_code`，而且和你這次修改所根據的版本一致。
- **不通過**：
  - 查無 → 這是新增（DEP-W3）；先確認名稱沒打錯（DEP-P4）。
  - 不一致 → 擋下。代表有人在正式區改過；先把差異合進要部署的原始碼，給使用者看合併結果，再重跑本條。
- **AML**：

```xml
<AML>
  <Item type="Method" action="get" select="id,name,method_type,method_code,comments,modified_on,modified_by_id,generation,is_current">
    <name>{Method 名稱}</name>
    <is_current>1</is_current>
  </Item>
</AML>
```

- 回傳多筆 → 停，告訴使用者（名稱的現行世代應該唯一）。Method 是版本化物件，舊世代不算重複；不加 `is_current` 時要看 `generation` 取最新。
- 快照裡也有一份（`aras-schema` 的 `references/methods/<名稱>.<副檔名>`），但快照是抓取當天的樣子，**只能當參考，比對一律用即時查詢的結果**。
- 讀到的 `method_code` 存成備份檔（DEP-B），這就是還原用的版本。

### DEP-P2 Method 用到的欄位都存在

- **條件**：Method 會讀寫、或當查詢條件的每個欄位，在對應 ItemType 上都查得到，**筆數等於預期**。這次要新增的欄位列入 DEP-W1 待建清單；其他欄位必須已存在。
- **不通過**：擋下 Method 部署，直到欄位建好並讀回（DEP-V1）。
- **AML**：

```xml
<AML>
  <Item type="Property" action="get" language="en,zt,zc" select="name,label,data_type,data_source,stored_length,readonly,sort_order">
    <source_id><Item type="ItemType" action="get"><name>{ItemType 名稱}</name></Item></source_id>
    <name condition="in">'{欄位1}','{欄位2}'</name>
  </Item>
</AML>
```

- **例**：加簽功能的 4 個欄位（例如 `add_status`）沒建就上了 Method，守門條件 `add_status='pending'` 失效，退化成「同一關卡曾有任何加簽單就擋」，使用者看到「此關卡已有未完成的加簽」被誤擋。

### DEP-P3 目前的綁定

- **條件**：知道這支 Method 現在綁在哪裡，以及目標 ItemType／關卡上既有的事件與 `sort_order`。
- **AML**：

這支 Method 綁在哪些 Server Event：

```xml
<AML>
  <Item type="Server Event" action="get" select="id,server_event,sort_order,source_id">
    <related_id><Item type="Method" action="get"><name>{Method 名稱}</name></Item></related_id>
  </Item>
</AML>
```

目標 ItemType 既有的 Server Event（決定新事件的 `sort_order`；`server_event` 空 = 停用）：

```xml
<AML>
  <Item type="ItemType" action="get" select="id,name">
    <name>{ItemType 名稱}</name>
    <Relationships>
      <Item type="Server Event" action="get" select="id,server_event,sort_order,related_id(name)"/>
    </Relationships>
  </Item>
</AML>
```

目標 ItemType 的 Item Action：

```xml
<AML>
  <Item type="ItemType" action="get" select="id,name">
    <name>{ItemType 名稱}</name>
    <Relationships>
      <Item type="Item Action" action="get" select="id,sort_order,related_id(name,type,location,target,method)"/>
    </Relationships>
  </Item>
</AML>
```

流程關卡（Activity Template）與它既有的方法：

```xml
<AML>
  <Item type="Workflow Map" action="get" select="id,name,is_current">
    <name>{Workflow Map 名稱}</name>
    <is_current>1</is_current>
    <Relationships>
      <Item type="Workflow Map Activity" action="get" select="related_id">
        <related_id><Item type="Activity Template" action="get" select="id,name"/></related_id>
      </Item>
    </Relationships>
  </Item>
</AML>
```

```xml
<AML>
  <Item type="Activity Template" action="get" select="id,name" id="{activityTemplateId}">
    <Relationships>
      <Item type="Activity Template Method" action="get" select="id,event,sort_order,related_id(name)"/>
    </Relationships>
  </Item>
</AML>
```

### DEP-P4 名稱照系統拼字

- **條件**：ItemType、關聯、欄位、Method 名稱與正式區**逐字相同**，包括系統裡既有的錯字（自訂名稱常有拼錯但已在使用的情況，不要「順手修正」）。
- **不通過**：擋下。名稱打錯 Aras 多半不報錯（見 `aras-plm-overview` 的 gotchas #1、#8）。
- **AML**：DEP-P2（欄位）、DEP-P3（ItemType、Method、關卡）各查一次，回傳的 `name` 和你要用的一致。

### DEP-P5 部署前更新快照

（這是前置檢查裡唯一會寫檔的一步：只讀 Aras，但會覆寫本外掛的快照檔。）把這次會動到的 Method 與 ItemType 快照更新成正式區現況（只讀 Aras，會覆寫本外掛 `aras-schema` 底下對應的檔案）：

```bash
node tools/snapshot.mjs itemtypes --only {ItemType 名稱}
node tools/snapshot.mjs methods --only {Method 名稱}
```

- 快照沒有這個 ItemType 也可以用 `--only` 加進來。`methods --only` 不會更新 `methods/INDEX.md`；`SNAPSHOT.md` 的抓取日期不變，只在「部分更新」行記下這一項與日期。
- 快照檔的變更讓使用者知道（之後可以回報給外掛維護者）。
- 在已安裝的外掛上重新快照，**只會更新本機的外掛快取**：外掛更新時會被覆蓋，其他人也看不到。要分享給所有人，請外掛維護者在外掛的原始 repo 重新快照並重新發布。

### DEP-K 列出變更給使用者確認

一張表列出這次部署的**全部**寫入，**等使用者明確同意**：

| # | 動作 | 對象 | 內容 | 還原方式 |
|---|---|---|---|---|
| 1 | 新增 Property | `Affected Item.my_field` | float、唯讀、三語標籤、sort 950 | 刪 Property（**連資料一起刪，無法還原**） |
| 2 | 更新 Method | `MyMethod` | 原始碼差異摘要（新增／刪除哪些段落） | 用備份的 `method_code` 寫回 |
| 3 | 編譯檢查 | 對不存在的 id 呼叫一次 | 若 Method 會寫自訂 log 表，可能寫一筆 log | 刪那筆 log |
| 4 | 綁 Server Event | `ECR` onAfterUpdate | sort 9000 | 刪這筆 Server Event |

- 同時說明：每一步會觸發什麼（新事件綁上後，**每一次**該 ItemType 存檔都會跑）、只對之後新建的流程有效的項目（Activity Template Method）、實測計畫（DEP-T）。
- 分批部署時，每一批都要重新取得同意。

### DEP-X1 同意後、每步寫入前重跑

- 每一個寫入步驟送 `--write` 之前，重跑它的前置檢查：Method 寫入前重跑 DEP-P1（現行版本沒被別人改）與 DEP-P2（欄位都在）；綁定前重跑 DEP-P3（沒有重複綁）。
- 結果和 DEP-K 給使用者看的不一樣 → 停，重新列表、重新取得同意。

### DEP-B 備份

存到使用者目前資料夾的 `./backups/<日期>-<功能>-部署前.json`：

- DEP-P1 讀到的 Method 完整內容（不帶 `select` 再讀一次也可以）。另外把 `method_code` 存成 `./backups/<日期>-<Method名>.prod.cs`，還原時直接用。
- DEP-P3 讀到的 Server Event、Item Action、Activity Template Method。
- 要改的 Property（新增的不用備份，記下讀回的 id）。

---

## 寫入範本

以下每一個範本都是寫入。**此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。**

### DEP-W1 新增 Property（巢狀在 ItemType 的 edit 底下）

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="ItemType" action="edit" id="{itemTypeId}">
    <Relationships>
      <Item type="Property" action="add">
        <name>{欄位名稱}</name>
        <label xml:lang="en">{英文標籤}</label>
        <i18n:label xml:lang="zt" xmlns:i18n="http://www.aras.com/I18N">{繁體標籤}</i18n:label>
        <i18n:label xml:lang="zc" xmlns:i18n="http://www.aras.com/I18N">{簡體標籤}</i18n:label>
        <data_type>float</data_type>
        <is_hidden>0</is_hidden>
        <is_hidden2>0</is_hidden2>
        <readonly>1</readonly>
        <sort_order>{序號}</sort_order>
      </Item>
    </Relationships>
  </Item>
</AML>
```

- `{itemTypeId}` 用 DEP-P3 讀到的 ItemType id（不要用 `where`，免得比對到別的）。
- 標籤依系統啟用的語言都要給（以下以 `en`／`zt`／`zc` 為例，請依實際啟用的語言調整）。`zt` = 繁體、`zc` = 簡體、`en` = 英文。資料庫裡對應的欄位是 `label`（英文）、`label_zt`、`label_zc`。
- 格式比照同 ItemType 既有的同類欄位（例如 float 欄位比照同表既有的 float 欄位），`data_type`、`stored_length`、`sort_order` 先用 DEP-P2 讀一個既有欄位參考。
- 新增 Property 會在資料庫表加一個欄位。**表單（Form）不會自動出現**，要另外加；關聯格（relationship grid）會顯示。

### DEP-W2 新增 List 選項（Value）

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="List" action="edit" id="{listId}">
    <Relationships>
      <Item type="Value" action="add">
        <value>{代碼}</value>
        <label xml:lang="en">{英文標籤}</label>
        <i18n:label xml:lang="zt" xmlns:i18n="http://www.aras.com/I18N">{繁體標籤}</i18n:label>
        <i18n:label xml:lang="zc" xmlns:i18n="http://www.aras.com/I18N">{簡體標籤}</i18n:label>
        <sort_order>{序號}</sort_order>
      </Item>
    </Relationships>
  </Item>
</AML>
```

- 先用 `<AML><Item type="List" action="get" select="id,name"><name>{List 名稱}</name></Item></AML>` 取 `{listId}`，並讀現有的 Value（`language="en,zt,zc"`）確認代碼沒有重複。
- 部分 list 欄位 get 回來的是標籤不是代碼（見 `aras-live-query` 讀取陷阱），寫 Method 時要確認讀到的是哪一種。

### DEP-W3 新增 Method

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Method" action="add">
    <name>{Method 名稱}</name>
    <method_type>C#</method_type>
    <comments>{用途說明}</comments>
    <method_code><![CDATA[{原始碼全文}]]></method_code>
  </Item>
</AML>
```

- 原始碼放在 `<![CDATA[…]]>` 裡，就不用跳脫 `<`、`&`。原始碼本身含 `]]>` 時，要拆成兩段 CDATA（`]]]]><![CDATA[>`）。
- 從回應讀新 Method 的 id，記到部署紀錄。

### DEP-W4 更新 Method

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Method" action="edit" id="{methodId}">
    <method_code><![CDATA[{原始碼全文}]]></method_code>
  </Item>
</AML>
```

- `{methodId}` 用 DEP-P1 讀到的 id。
- Method **是**版本化物件（2026-11-01 正式區實查：ItemType `Method` 的 `is_versionable` = 1；`Property`、`Identity` 是 0）。`edit` 可能產生新世代、`id` 跟著換，舊世代仍留在資料庫裡。所以：
  - 讀 Method 一律用名稱查**現行世代**（`<name>…</name><is_current>1</is_current>`），不要沿用舊的 id；`{methodId}` 在 DEP-X1 重跑 DEP-P1 時重新取得。
  - 讀回（DEP-V3）比對的是現行世代的 `method_code`；備份與還原以名稱為準，不以 id 為準。
  - 綁定（Server Event、Item Action、Activity Template Method）時用名稱查 Method（範本已這樣寫），不要寫死某一世代的 id。
- **編譯錯誤要等到觸發時才會出現**，所以 DEP-W5 一定要做。

### DEP-W5 編譯檢查（先不綁事件）

對一個不存在的 id 呼叫一次這支 Method，確認回傳正常（回原物件或預期訊息）、沒有編譯錯誤。呼叫 server Method 也是寫入類動作。

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="{ItemType 名稱}" action="{Method 名稱}" id="00000000000000000000000000000000"/>
</AML>
```

- 流程關卡的 on_vote Method 對 `Activity` 呼叫，並帶投票選項：`<Item type="Activity" action="{Method 名稱}" id="00000000000000000000000000000000"><Path>{選項}</Path></Item>`。
- 回 `ItemNotFoundException` 代表**找不到這支 Method**（名稱錯或沒部署成功），不是找不到 item。
- Method 若因此寫了一筆自訂 log，讀出來確認內容後再刪（刪 log 也是寫入，一併列在 DEP-K）。

### DEP-W6 綁 Server Event（巢狀在 ItemType 的 edit 底下）

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="ItemType" action="edit" id="{itemTypeId}">
    <Relationships>
      <Item type="Server Event" action="add">
        <related_id><Item type="Method" action="get"><name>{Method 名稱}</name></Item></related_id>
        <server_event>onAfterUpdate</server_event>
        <sort_order>9000</sort_order>
      </Item>
    </Relationships>
  </Item>
</AML>
```

- `server_event` 用 Aras 的事件名（`onBeforeAdd`、`onAfterAdd`、`onBeforeUpdate`、`onAfterUpdate`、`onBeforeGet`、`onBeforeDelete`…）。`sort_order` 排在既有事件之後（ECR／ECN 既有最大約 3780，2026-10-30 用 9000）。
- 多個 ItemType 要綁就各送一次，或在同一個 `<Relationships>` 底下放兩筆（例如 onAfterAdd + onAfterUpdate）。
- **綁上之後立即生效**：之後每一次該 ItemType 存檔都會跑。

### DEP-W7 綁 Item Action（先建 Action，再掛到 ItemType）

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Action" action="add">
    <name>{Action 名稱}</name>
    <label xml:lang="en">{英文標籤}</label>
    <i18n:label xml:lang="zt" xmlns:i18n="http://www.aras.com/I18N">{繁體標籤}</i18n:label>
    <i18n:label xml:lang="zc" xmlns:i18n="http://www.aras.com/I18N">{簡體標籤}</i18n:label>
    <type>{照既有 Action}</type>
    <location>{照既有 Action}</location>
    <target>{照既有 Action}</target>
    <method><Item type="Method" action="get"><name>{Method 名稱}</name></Item></method>
  </Item>
</AML>
```

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="ItemType" action="edit" id="{itemTypeId}">
    <Relationships>
      <Item type="Item Action" action="add">
        <related_id>{actionId}</related_id>
        <sort_order>{序號}</sort_order>
      </Item>
    </Relationships>
  </Item>
</AML>
```

- `type`／`location`／`target` 的值**照同 ItemType 上一個功能相近的既有 Action 抄**（用 DEP-P3 的 Item Action 查詢讀出來），不要自己猜；伺服器端 Method 與用戶端 JavaScript 的 Action 設定不同。
- `can_execute`（決定誰能按）是另一個欄位；要限制權限時一併確認。
- Item Action 本身沒有 `--write` 之外的保護：一掛上，使用者就看得到、按得到。
- 本外掛沒有實際部署過 Item Action；這個範本依 schema 欄位寫成，第一次用時加強 DEP-V7 的讀回。

### DEP-W8 綁 Activity Template Method（流程關卡）

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Activity Template" action="edit" id="{activityTemplateId}">
    <Relationships>
      <Item type="Activity Template Method" action="add">
        <related_id><Item type="Method" action="get"><name>{Method 名稱}</name></Item></related_id>
        <event>on_vote</event>
        <sort_order>100</sort_order>
      </Item>
    </Relationships>
  </Item>
</AML>
```

- `event`：`on_activate`、`on_vote`、`on_close` 等。`sort_order` 決定同一事件多支方法的順序（2026-10-31 綁 EN 的 on_vote 用 100，排在既有 256 起的方法前面，擋下時其他方法不會先跑）。
- **只對綁定之後新建的流程有效。** 已在流程中的單據用的是建立當下複製出來的 Activity，不會套用。
- on_vote Method 用 `this.getProperty("Path")` 讀投票選項。

---

## 讀回（每一步寫完都要做）

| # | 條件 | AML |
|---|---|---|
| DEP-V1 | Property 存在，`data_type`、`readonly`、`sort_order` 正確，`en`／`zt`／`zc` 三個標籤都對 | DEP-P2 那支（`language="en,zt,zc"`） |
| DEP-V2 | List 新選項存在，代碼與三語標籤正確 | `<AML><Item type="Value" action="get" language="en,zt,zc" select="value,label,sort_order"><source_id>{listId}</source_id><value>{代碼}</value></Item></AML>` |
| DEP-V3 | 讀回的 `method_code` 和要部署的原始碼**完全相同** | DEP-P1 那支 |
| DEP-V6 | 目標 ItemType 多了這筆 Server Event（事件名、`sort_order` 對），沒有重複 | DEP-P3 第二支 |
| DEP-V7 | Action 存在且 `method` 指向這支 Method；目標 ItemType 多了這筆 Item Action | DEP-P3 第三支 |
| DEP-V8 | 關卡多了這筆 Activity Template Method（`event`、`sort_order` 對），沒有重複 | DEP-P3 最後一支 |

DEP-V1、DEP-V2 的標籤怎麼看：CLI 輸出裡，英文在 `label@en`，繁體在 `i18n:label@zt`，簡體在 `i18n:label@zc`（三個鍵都要有值）。用一次性腳本讀時用 `i18nLabel(el, 'zt')`／`i18nLabel(el, 'zc')`、`text(el, 'label')` 取英文。舊版 CLI 會把多個語言疊成同一個鍵、只看得到英文；看到三個語言都一樣時，先確認本外掛的 `tools/` 是最新版本。

DEP-V3 的比對用一次性腳本做，不要用肉眼（比對對象是你要部署的原始碼檔；不要拿 `aras-schema` 快照比，快照可能比上次部署還舊）：

```js
// compare.mjs：node compare.mjs <Method 名稱> <原始碼檔>
import fs from 'node:fs';
import { applyAml, text } from '<外掛根目錄>/tools/lib/aras.mjs';

const [name, file] = process.argv.slice(2);
const rows = await applyAml(`<AML><Item type="Method" action="get" select="name,method_code,modified_on,generation">
  <name>${name}</name><is_current>1</is_current></Item></AML>`);
if (rows.length !== 1) throw new Error(`Method ${name} 查到 ${rows.length} 筆`);
const live = text(rows[0], 'method_code').replace(/\r\n/g, '\n');
const want = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
console.log(live === want ? '一致' : `不一致：正式區 ${live.length} 字、檔案 ${want.length} 字`);
```

- 不通過 → 停，不要往下一步；依「還原」處理。

### DEP-V9 部署後更新快照

```bash
node tools/snapshot.mjs itemtypes --only {ItemType 名稱}
node tools/snapshot.mjs methods --only {Method 名稱}
```

確認快照裡的欄位表、Server Event 表、Method 原始碼都是新的。這份更新同樣只在本機外掛快取（見 DEP-P5）；部署完成後請使用者通知外掛維護者在 repo 重新快照並重新發布。

### DEP-T 實測

- 依事先寫好的測試計畫實測。測試單只能開在正式區，**建立、修改、刪除都是寫入**，要另外取得同意；慣例：測試單標題加明顯前綴（如 `【測試勿簽】`）、只存檔不送出、測完刪除，**刪單不會刪它的 Workflow Process，要另外刪**。
- 測完查 Aras 伺服器端 log 或你系統自訂的 Method log，不應有該 Method 的錯誤紀錄。

---

## 還原

讀回不符或實測失敗時，先停下所有後續步驟，把現況和備份一起給使用者看，**取得同意後**才送還原（還原也是寫入，要 `--write`、要讀回）。

| 原本的寫入 | 還原 |
|---|---|
| 更新 Method（DEP-W4） | 用 DEP-W4 的寫法，`method_code` 換成備份的 `.prod.cs` 全文；DEP-V3 讀回比對 |
| 新增 Method（DEP-W3） | 先解除所有綁定；Method 本身可以保留（沒有綁定就不會執行），要刪另外取得同意 |
| 綁 Server Event／Item Action／Activity Template Method | 在來源（ItemType 或 Activity Template）的 `edit` 底下 `delete` 這筆關聯，例：`<Item type="ItemType" action="edit" id="{itemTypeId}"><Relationships><Item type="Server Event" action="delete" id="{serverEventId}"/></Relationships></Item>` |
| 新增 Property（DEP-W1） | 先還原 Method（否則 Method 寫入失敗會一直寫 log）；刪 Property 會**連資料庫欄位與已寫入的值一起刪，無法還原**，要使用者明確同意 |
| 新增 List 選項 | 已有資料用了這個代碼時不能刪；先查再決定 |

還原 Server Event 的範例：

此範例含寫入動作：須依 `aras-live-write` 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="ItemType" action="edit" id="{itemTypeId}">
    <Relationships>
      <Item type="Server Event" action="delete" id="{serverEventId}"/>
    </Relationships>
  </Item>
</AML>
```

---

## 部署紀錄

每次部署在使用者目前資料夾留一份紀錄（例如 `./deploy/<日期>-<功能>.md`），內容：規格表、檔案清單（原始碼、`.prod.cs` 備份）、實際送出的 AML、讀回結果（時間與 id）、還原步驟、實測紀錄、已知限制。

## 一次要部署多個 AML 檔時

| 需求 | 做法 |
|---|---|
| 送出每個 AML 檔 | 每個檔各自走一次本 skill 的流程，用 `node tools/aras.mjs aml <檔> --write` 送 |
| 決定送出順序 | 依「部署順序」表決定（Property 一定在 Method 之前），列在 DEP-K |
| 記錄哪些已部署、避免重送 | 用「部署紀錄」：每個檔送出時間、結果、讀回的 id；重送前先查正式區現況（DEP-P1～P3），不靠本機紀錄判斷 |
| 判斷成功或失敗 | `tools/aras.mjs` 遇 Fault 會丟出錯誤訊息；回應的 `<Result>` 裡有 `type="error"` 也算失敗。沒報錯不等於成功，一定要讀回（DEP-V） |

不要「一次送完整個資料夾」：每個檔都要有備份、讀回、使用者同意、部署前比對正式區版本。

## C# Method 寫法提醒

- IOM 是 `Item.getID()`（大寫 ID）；寫成 `getId()` 會編譯錯誤 CS1061。
- dependent ItemType（例如 `Activity`）用 `createRelatedItem` 巢狀建立，id 用 `inn.getNewID()` 預先產生。
- 錯誤寫進你系統既有的 Method log 機制（若有），不要擋使用者存檔；部署後追這份 log。
- `onAfterUpdate` 的 `this` 只帶被修改的欄位；要判斷其他欄位就從資料庫重讀。
- on_vote Method 用 `this.getProperty("Path")` 讀投票選項。
- 外部系統查詢請沿用你系統既有的共用 Method，不要在每支 Method 裡另外寫連線。
- 需要提權時照既有寫法：`Aras.Server.Security.Permissions.GrantIdentity(...)`，`finally` 裡 `RevokeIdentity`。

## 常見錯誤

| 錯誤 | 後果 |
|---|---|
| 用手上的副本直接覆蓋 | 把別人在正式區改過的邏輯蓋掉 |
| 先部署 Method 後建欄位 | 守門條件失效，誤擋或漏擋；資料少寫；不報錯 |
| 沒做編譯檢查 | 第一位使用者存檔時才發現編譯錯誤 |
| 綁了事件沒讀回 | 重複綁兩次，同一個事件跑兩遍 |
| 以為 Activity Template Method 對進行中的單據有效 | 只有之後新建的流程會套用 |
| 沒寫還原步驟 | 出事時只能臨時去找舊版 |
| 欄位名稱「修正」系統既有錯字 | 寫到不存在的欄位，值被靜默丟棄 |
