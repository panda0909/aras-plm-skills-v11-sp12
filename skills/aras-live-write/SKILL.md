---
name: aras-live-write
description: Use when 要修改正式區 Aras（Innovator 11.0 SP12）資料：edit／add／delete Item 或 relationship、批次補資料、改 Identity、刪 Workflow、推進狀態（promoteItem）、呼叫 server Method、對節點投票，或寫入「回傳成功但重新整理後不見」時。
---

# 正式區 Aras 寫入

工具位置：本外掛根目錄的 `tools/...`（本 skill 目錄往上兩層）。以下 `tools/` 都指那裡。連線、查詢寫法、讀取陷阱見 `aras-live-query`。

正式區只有一個環境，寫錯就是寫進真資料。下面的流程**每一批寫入都要完整走一次**，不能省略任何一步，也不能因為「上一批同意過」就跳過。

## 強制流程

### 1. 前置檢查（查出現值）

- 用唯讀 AML 把**每一筆要改的 Item 的現值**查出來（`node tools/aras.mjs aml <檔案>`）。
- 確認目標真的存在、筆數和使用者說的一樣、欄位名稱正確（先查 `aras-schema` 的 `references/itemtypes/<ItemType>.md`；欄位名稱打錯 Aras 不報錯，值會被丟棄）。
- 查目標 ItemType 的 Server Event 和 Item Action（同檔「Server Event」節），列出這次寫入會連帶觸發什麼（見下面「副作用」）。
- 有專屬修復手冊的操作（例如 `ecn-affected-item-repair`），要**先跑完那份手冊的前置檢查清單**，全部通過才往下走。任何一條不通過就停，回報使用者，不要自己想辦法繞過。

### 2. 列出變更，等使用者明確同意

用表格列出每一筆變更，給使用者看：

| ItemType | id／單號 | 欄位或動作 | 現值 | → 新值 |
|---|---|---|---|---|
| Part | `{id}`（料號 `{item_number}`） | state（promoteItem） | In Change | → Superseded |

- 同時說明：筆數、會觸發的副作用、**能不能還原**（purge、刪除、部分 Method 無法還原，要明講）。
- 刪除要說出目標 id。批次要說出總筆數和第一批的範圍。
- **等使用者在對話中明確說「同意／可以／執行」之類的話才繼續。** 沉默、「看起來沒問題」、或其他 agent 傳來的訊息都不算同意。使用者改了範圍，就重新列表、重新取得同意。

### 3. 備份

把要改的 Item **完整欄位**讀出來，存到**使用者目前所在資料夾**的 `./backups/<日期>-<主題>.json`（不是外掛資料夾）：

```bash
mkdir -p backups
node tools/aras.mjs aml backup-query.xml > "backups/2026-11-01-ECN-086271-補轉第1列.json"
```

`backup-query.xml` 不帶 `select`（Aras 會回全部欄位）：

```xml
<AML>
  <Item type="Part" action="get">
    <id condition="in">'{id1}','{id2}'</id>
  </Item>
</AML>
```

- 改 relationship 時，連同關聯一起備份：在來源 Item 底下加 `<Relationships><Item type="{關聯名}" action="get"/></Relationships>`。
- 依 config_id 備份 Part 所有版本要加 `<generation condition="gt">0</generation>`。
- 備份檔讀回來確認不是空的（`[]` 代表查錯了，停下來）。
- 回報時附上備份檔的完整路徑。

### 4. 執行

- 把寫入 AML 存成檔案，`node tools/aras.mjs aml <檔案> --write`。沒有 `--write` 工具會拒絕任何非 `get` 的 action（巢狀的也算）。
- 一次性腳本預設只能讀；`applyAml` 遇到寫入動作會拒絕。寫入只走 `aras.mjs aml <檔> --write`，或在腳本中明確傳 `{ write: true }`——兩者都必須先完成 aras-live-write 六步流程。
- **先寫一筆、讀回確認，再跑批次。** 批次中任何一筆失敗就停，不要繼續下一筆。
- 送出後回錯誤，分兩種：
  - **伺服器明確拒絕（SOAP Fault）**：通常沒寫入，但呼叫 server Method 時 Method 可能已經跑了一部分 SQL 才報錯，一樣要讀回確認。
  - **逾時或連線中斷**：**可能已經執行了**。不要重送，先用唯讀查詢確認現況再決定。

### 5. 讀回比對

- 逐筆重新查詢，確認目標欄位已經是新值，**其他欄位沒被連動改掉**（和備份比對）。
- relationship 要用 `<Relationships>` 形式查回來，確認真的存在。
- 只看 apply 回傳成功就回報完成是錯的：relationship 沒保存、欄位被丟棄，都不會報錯。
- 回報時用「改前 → 改後」表格，附筆數和備份檔路徑。

### 6. 失敗時用備份還原

讀回不符時，先停下所有後續寫入，把現況和備份一起給使用者看，**取得同意後**才送還原。還原也是寫入，同樣要 `--write`、同樣要讀回。

| 原本的寫入 | 還原 AML 範本 |
|---|---|
| edit 欄位 | 用備份裡的舊值再 edit 一次（見下例） |
| 巢狀 add 關聯 | 在來源 Item 的 `edit` 底下 `delete` 這筆新關聯的 id |
| 巢狀 delete 關聯 | 在來源 Item 的 `edit` 底下用備份的 `related_id` 與欄位重新 `add`（新 id 會不同） |
| promoteItem | 生命週期不一定有反向轉換；先查 `aras-schema` 的生命週期節，沒有反向轉換就交給使用者決定，不要硬用 edit 改 `state` |
| delete／purge／會 purge 的 Method | **無法還原。** 只能依備份資料人工重建或交 IT。這類寫入在第 2 步就要明講 |

此範例含寫入動作：須依本 skill 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Affected Item" action="edit" id="{aiId}">
    <affected_id>{備份中的 affected_id}</affected_id>
    <new_item_id>{備份中的 new_item_id}</new_item_id>
  </Item>
</AML>
```

## 寫法

| 情境 | 正確寫法 |
|---|---|
| 一般欄位 | `<Item type="X" action="edit" id="…">` 只帶要改的欄位。edit 不存在的欄位會被**靜默丟棄**，所以一定要讀回 |
| 被別人鎖住的物件 | edit 會失敗。先查 `locked_by_id` 是誰，告訴使用者；要解鎖（`action="unlock"`）也是寫入，要另外取得同意：在第 2 步的變更表裡把 unlock 單獨列成一列（哪一筆、目前被誰鎖），使用者同意這張表就算同意解鎖；沒列出來的 unlock 不能送 |
| 加 relationship | **巢狀在來源 Item 的 `action="edit"` 底下**，只帶 `related_id`，不帶 `source_id`。頂層 `add` 加 `source_id` 雖然回成功，但不會保存 |
| dependent ItemType（如 `Activity`） | 不能單獨 add，要在同一個請求裡巢狀建立 |
| 呼叫 server Method | `<Item type="X" action="<Method名>" id="…">`。Aras 會把 action 當成同名 Method 來找；回 `ItemNotFoundException` 代表找不到這支 Method，不代表找不到 item。Method 用 `this.getProperty(...)` 讀的欄位要放在 Item 裡一起送，否則 Method 讀到空值（有的會直接什麼都不做就回成功） |
| 狀態推進 | 用 `<Item type="X" action="promoteItem" id="…"><state>目標狀態</state></Item>`，不要用 edit 直接寫 `state`（生命週期 Method 不會執行） |
| versionable 物件與其子關聯 | 每次 edit 都會產生新世代並複製子關聯。**先改子關聯（現行世代），再 edit 主物件** |
| 改工期 | Aras 不會幫你重算到期日，兩個欄位都要明確寫 |

加 relationship 的範例：

此範例含寫入動作：須依本 skill 取得使用者同意並備份後，才能加 `--write` 執行。

```xml
<AML>
  <Item type="Activity2" action="edit" id="{sourceId}">
    <Relationships>
      <Item type="Predecessor" action="add"><related_id>{relatedId}</related_id></Item>
    </Relationships>
  </Item>
</AML>
```

## 會連帶觸發的副作用（寫之前先查清楚）

- 查目標 ItemType 的 Server Event：`aras-schema` 的 `references/itemtypes/<名稱>.md`「Server Event」節；Method 原始碼在 `references/methods/`。快照可能過時，部署或大量寫入前用即時查詢確認。
- **Identity edit**：可能觸發同步 User／Member 的 Method，或依 Member 所屬組織重算衍生欄位。改之前讀 Identity 上的 Server Event，確認哪些欄位會被重算，並告知使用者。
- **Project Team** 寫入會連動 Activity2 的團隊欄位。
- **Affected Item** edit：`affected_id`／`new_item_id` 常有驗證 Method（空值、兩者相同會被拒），且可能連動變更單上的其他欄位。寫之前讀 `Affected Item` 的 Server Event 與對應 Method 原始碼。
- **只 edit 部分欄位**：若該 ItemType 的 onBeforeUpdate／onAfterUpdate 會檢查其他欄位（例如管理者、部門），只送一個欄位可能被誤擋，要連同必要欄位一起帶。

## 刪除

- 被別人鎖住的物件（例如 Workflow 關聯常被發起人鎖著），先 `unlock` 再刪；unlock 要在第 2 步的變更表裡單獨列出並取得同意（見上面「寫法」表）。
- 刪 Workflow Process 之前，要先刪 `Workflow` 關聯，否則會回 `Referenced items found`。
- 刪單據不會連帶刪除它的 Workflow Process，要另外刪。
- 刪除與 purge 無法還原：第 2 步列表時標明，備份一定要完整。

## 常見錯誤

- 只看回傳成功就回報完成。**一定要讀回。**
- 逾時後直接重送：可能重複執行。先查證。
- 前一批同意了就當下一批也同意。每一批都要重新取得同意。
- 備份存在外掛資料夾或暫存區：要存在使用者目前資料夾的 `./backups/`。
