# 平行開發計畫（第 2 到第 5 階段）

規格以 `../活動報到系統 規劃書.md`（repo 外上一層）為準，畫面與文字對照雛形 `docs/prototype.html`。本文件只規定分工、共用模組與驗證方式。

## 流程

1. **地基（F）**：單一 worker 在 `main` 上完成，commit 後才開始平行開發。
2. **平行（P2、P3、P4、P5）**：四個 worker 各自在獨立 worktree 與分支開發，只改自己擁有的檔案。
3. **合併**：lead 依 P2 → P3 → P4 → P5 合併回 `main`，每合併一次跑一次檢查。
4. 正式部署（`wrangler deploy`）不在這次範圍。

## 共用模組（F 建立，平行階段唯讀）

| 檔案 | 內容 |
| --- | --- |
| `src/shared/event.ts` | `Scope` 判別聯集、`EventPhase` 與 `eventPhase(e, now)`、`EventDetail`、`StationDetail`、`StationKind` 型別、`RETAIN_MS`。`EventDetail.memberCount` 是 `event_members` 筆數 |
| `src/worker/scope.ts` | `parseScope(type, valuesJson)`、`serializeScope(scope)`、`scopeSql(scope, eventId)` 產生「範圍內在職員工」條件（員工表別名 `e`）、`matchesScope(scope, emp, isMember)` 單人判斷 |
| `src/worker/counts.ts` | `recalcStatements(db, eventId, scope)`：以 COUNT 重算該活動各關卡 `passed_count` 的 statement，可放進 `batch()` |
| `src/worker/access.ts` | `loadEventFor(c, eventId)` 回傳 `{ ok: true, event: EventRecord }` 或 `{ ok: false, response }`（404），用法 `if (!r.ok) return r.response`。系統管理員可看全部，承辦人只能看自己的活動。另有 `EVENT_COLUMNS`、`EventRow`、`toEventRecord(row)` 供列表查詢解析 |
| `src/worker/routes/events.ts` | 只含 `GET /api/events/:id`（回傳 `EventDetail`），P3 接手擴充 |
| `tests/helpers/d1.ts` | 以 `node:sqlite` 模擬 D1（套用 `migrations/`、外鍵、`batch()` 單一交易）。`makeEnv()`、`cookieFor(env, { t, id, ver? })`、`call(env, method, '/api/...', { body?, cookie? })` 回傳 `{ status, json, headers }`；種子資料 `seedUser`、`seedEvent`、`seedEmployees`、`seedStaff`、`seedScan`（`seedUser`、`seedStaff` 回傳可直接用的 `cookie`）。`meta.rows_read` 一律為 0，讀取量要用 wrangler dev 實測 |
| `src/web/excel.ts` | SheetJS 匯入解析 `parseSheet(file, required)`：欄位別名對應、`cell.w` 取工號、數字格式工號計數；`downloadWorkbook(filename, wb)` |
| `src/web/format.ts` | 本地時間顯示 `fmtDT`、`fmtTime`、`fmtDate`，`datetime-local` 輸入 `toLocalInput`、`fromLocalInput` |
| `src/web/components/*` | `ConfirmDialog`、`EventStatusChip`、`Loading`、`notify.tsx` 的 `NotifyProvider`/`useNotify` |
| `src/web/pages/admin/AdminLayout.tsx`、`EventDetailPage.tsx` | 後台外框與活動詳情外框（四個分頁的插槽，分頁元件收 `EventTabProps`：`{ event, reload }`） |

共用模組不夠用時，不要改共用檔案。在自己擁有的檔案內補上，並在回報中列出，由 lead 合併時再收斂。

## 檔案擁有權

| 階段 | 後端 | 前端 | 測試 |
| --- | --- | --- | --- |
| P2 員工與帳號 | `routes/employees.ts`、`routes/users.ts` | `pages/admin/EmployeesPage.tsx`、`pages/admin/AccountsPage.tsx`、`pages/admin/employees/*` | `tests/p2-*.test.ts` |
| P3 活動設定 | `routes/events.ts`、`routes/staff.ts` | `pages/admin/EventsPage.tsx`、`pages/admin/event/SettingsTab.tsx`、`pages/admin/event/StaffTab.tsx`、`pages/admin/event/settings/*` | `tests/p3-*.test.ts` |
| P4 報到端 | `scan.ts`、`routes/checkin.ts` | `pages/checkin/*`、`components/checkin/*` | `tests/p4-*.test.ts` |
| P5 報表與排程 | `routes/reports.ts`、`retention.ts` | `pages/admin/event/OverviewTab.tsx`、`pages/admin/event/RosterTab.tsx`、`src/web/export.ts` | `tests/p5-*.test.ts` |

`src/worker/index.ts`、`src/web/App.tsx`、`package.json` 在 F 就把所有路由與套件接好，平行階段不改。`index.ts` 的 `scheduled()` 已呼叫 `retention.ts` 的 `runRetention(env, now)`，由 P5 實作內容。

後端路由模組都以 `app.route('/', …)` 掛在 `/api` 下，各自寫完整路徑（例如 `/events/:id/staff`）。middleware 只能掛在各路由上（例如 `.get('/users', requireAuth, requireUser(['admin']), …)`），不可在模組內用 `use('*')`：實測它會擋到之後掛上的所有模組。

## 各階段範圍（規劃書編號）

- **P2**：F-EMP-1 到 F-EMP-8、F-ACC-1。匯入寫入用單一 `json_each` 查詢，匯入後對所有未結束活動執行 `recalcStatements`。
- **P3**：F-EVT-1 到 F-EVT-9、F-ACC-2、F-ACC-3，API 為規劃書第 7 節 `/api/events*`（summary、breakdown、roster 除外）與 `/api/staff/*`。修改範圍或名單後執行 `recalcStatements`。
- **P4**：F-CHK-1 到 F-CHK-8，規劃書第 4 節檢核放在 `scan.ts` 純函式並逐一測試每種結果；`/api/checkin/*`；撤銷後執行 `recalcStatements`。
- **P5**：F-RPT-1 到 F-RPT-3、F-RET-1 到 F-RET-3；`summary`、`breakdown`、`roster` 三個 API；`runRetention`。breakdown 與 roster 用 SQL `GROUP BY` 彙總。

## 驗證合約（每個階段都要做完才算完成）

1. `npm run typecheck`、`npm test`、`npm run build` 全部通過。測試要從大寫 `C:\` 路徑執行（Vitest 在小寫磁碟代號下會載入失敗）。
2. 路由測試用 `tests/helpers/d1.ts`，涵蓋成功、驗證失敗、找不到資源、權限不足（承辦人存取別人的活動）。
3. 實機：在自己的 worktree 建 `.dev.vars`、`npm run db:migrate:local`、`npm run build`，用指定埠跑 `npx wrangler dev --port <埠>`，以 curl 打過本階段每支 API 並記錄狀態碼。P2 用 8802、P3 用 8803、P4 用 8804、P5 用 8805。結束後停掉 wrangler。
4. 涉及 D1 查詢的 API，在實機回應或 log 中確認 `meta.rows_read` 與規劃書第 9 節估算同一量級。
5. 在自己的分支 commit（訊息格式見下），回報：做了什麼、測試結果、實機 curl 結果摘要、共用模組不足之處、未完成項目。

Commit 訊息：繁體中文單行主旨，`type(scope): subject`，空一行後加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
