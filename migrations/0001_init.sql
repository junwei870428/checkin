-- 規劃書第 6 節的 schema

-- 系統管理員與承辦人
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','organizer')),
  pwd_salt    TEXT NOT NULL,
  pwd_hash    TEXT NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0,
  fails       INTEGER NOT NULL DEFAULT 0,
  lock_until  INTEGER NOT NULL DEFAULT 0,
  session_ver INTEGER NOT NULL DEFAULT 0,  -- 重設密碼或停用時 +1，讓舊 Cookie 失效
  created_at  INTEGER NOT NULL
);

-- 員工主檔（Excel 匯入）
CREATE TABLE employees (
  emp_no     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dept       TEXT NOT NULL,
  plant      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_employees_active ON employees(active, plant, dept);

CREATE TABLE import_logs (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  added       INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  deactivated INTEGER NOT NULL
);

CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  code         TEXT NOT NULL UNIQUE,      -- 報到帳號前綴，2-8 碼大寫英數
  owner_id     TEXT NOT NULL REFERENCES users(id),
  start_at     INTEGER NOT NULL,
  end_at       INTEGER NOT NULL,
  rehearsal    INTEGER NOT NULL DEFAULT 0, -- 演練模式；只在 start_at 之前有效
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('all','plants','depts','list')),
  scope_values TEXT NOT NULL DEFAULT '[]', -- JSON：plants 為廠別字串陣列；depts 為 [廠別, 部門] 配對陣列
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_events_end ON events(end_at);

-- scope_type = 'list' 時的名單
CREATE TABLE event_members (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  emp_no   TEXT NOT NULL,
  PRIMARY KEY (event_id, emp_no)
);

CREATE TABLE stations (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('checkin','gift')),
  require_checkin INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  passed_count    INTEGER NOT NULL DEFAULT 0  -- 正式紀錄人數快取，維護方式見規劃書第 4 節「人數計算」
);
CREATE INDEX idx_stations_event ON stations(event_id);

CREATE TABLE staff_accounts (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account     TEXT NOT NULL UNIQUE,        -- 一律存大寫，例如 XMAS-01
  pin_salt    TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0,
  fails       INTEGER NOT NULL DEFAULT 0,
  lock_until  INTEGER NOT NULL DEFAULT 0,
  session_ver INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_staff_event ON staff_accounts(event_id);

CREATE TABLE scans (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  station_id  TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  emp_no      TEXT NOT NULL,
  rehearsal   INTEGER NOT NULL DEFAULT 0,  -- 1 = 演練紀錄
  scanned_at  INTEGER NOT NULL,
  by_account  TEXT NOT NULL,
  device      TEXT NOT NULL,              -- 'mobile' | 'desktop'
  manual      INTEGER NOT NULL DEFAULT 0,
  voided_at   INTEGER,
  voided_by   TEXT
);
-- 防止重複通過的核心：同一關卡同一人，正式與演練各只能有一筆未撤銷紀錄
CREATE UNIQUE INDEX ux_scans_active ON scans(station_id, emp_no, rehearsal) WHERE voided_at IS NULL;
CREATE INDEX idx_scans_event ON scans(event_id, station_id, rehearsal);

-- 新增正式紀錄時累加 passed_count；撤銷等其他情況由程式重新計算
CREATE TRIGGER trg_scans_insert AFTER INSERT ON scans
  WHEN NEW.voided_at IS NULL AND NEW.rehearsal = 0
BEGIN
  UPDATE stations SET passed_count = passed_count + 1 WHERE id = NEW.station_id;
END;
