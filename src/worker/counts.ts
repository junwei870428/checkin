// 以 COUNT 重算 stations.passed_count（規劃書第 4 節「人數計算」）

import type { Scope } from '../shared/event';
import { scopeSql } from './scope';

/**
 * 重算活動各關卡的已通過人數：未撤銷的正式紀錄中，目前仍在參加範圍內且在職的人數。
 * 回傳的語句可直接放進 db.batch()，與撤銷、修改範圍等寫入放在同一批。
 */
export function recalcStatements(db: D1Database, eventId: string, scope: Scope): D1PreparedStatement[] {
  const s = scopeSql(scope, eventId);
  return [
    db.prepare(
      `UPDATE stations SET passed_count = (
         SELECT COUNT(*) FROM scans s JOIN employees e ON e.emp_no = s.emp_no
          WHERE s.station_id = stations.id AND s.rehearsal = 0 AND s.voided_at IS NULL AND ${s.sql}
       ) WHERE event_id = ?`,
    ).bind(...s.binds, eventId),
  ];
}
