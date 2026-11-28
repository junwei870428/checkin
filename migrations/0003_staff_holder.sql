-- 報到帳號的使用人姓名；掃描時把當下的使用人存進紀錄，之後換人不會改到舊紀錄
ALTER TABLE staff_accounts ADD COLUMN holder TEXT NOT NULL DEFAULT '';
ALTER TABLE scans ADD COLUMN by_holder TEXT NOT NULL DEFAULT '';
