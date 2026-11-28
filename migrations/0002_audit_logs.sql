-- 操作紀錄：系統帳號（管理員、承辦人）的登入與修改操作，只增不改
CREATE TABLE audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  actor_id   TEXT NOT NULL,              -- users.id；帳號不會被刪除，顯示時 JOIN 取名稱
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT ''    -- 操作對象的文字快照，活動刪除後仍看得到名稱
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
