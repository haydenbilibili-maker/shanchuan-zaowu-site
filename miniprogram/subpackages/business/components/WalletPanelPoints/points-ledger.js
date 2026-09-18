/**
 * 积分明细的**纯展示派生**（无 wx API、无副作用，便于单测）
 *
 * 为什么单独成模块（2026-09-18，需求 8「优化积分明细展示方案」）：
 *   与储值账单同一类问题 ——「算错了看不出来」：
 *     · 云函数回包的 `createTime` 可能是 `{ $date: … }`（本仓已有多处按此兼容），
 *       旧实现直接 `new Date(raw)` → **每一行时间静默变空**，页面照常渲染；
 *     · 分页边界上的那一天还没加载完，照样给它算「当日净额」就是谎报；
 *     · 合计若按「已加载」当「全部」，就是更严重的谎报 —— 所以口径文案必须区分。
 *   日期解析/格式化**复用**储值账单的 `wallet-ledger.js`（同一份 `$date` 兼容逻辑只有一个出处）。
 *
 * 数据来源：云函数 `getPointRecords`（`createTime` 倒序；支持 page/pageSize/type，回包含 total/hasMore）
 */

const {
  DAY_MS,
  ledgerTimeMs,
  dayKeyOf,
  monthKeyOf,
  dayLabel,
  weekdayLabel,
  monthLabel,
  formatClock,
  formatDateTime
} = require('../WalletPanelWallet/wallet-ledger');

/** 单行派生：字段名尽量与旧实现一致（pointsText / timeText 仍在），额外给展示用字段 */
function mapPointRow(row, nowMs) {
  const ms = ledgerTimeMs(row && row.createTime);
  const points = Number((row && row.points) || 0);
  const status = String((row && row.status) || 'done');
  const isPlus = points > 0;
  const isMinus = points < 0;
  return {
    ...row,
    timeMs: ms,
    clockText: ms ? formatClock(ms) : '',
    timeText: ms ? formatDateTime(ms) : '',
    points,
    pointsText: isPlus ? `+${points}` : String(points),
    toneClass: isPlus ? 'is-plus' : isMinus ? 'is-minus' : 'is-flat',
    statusText: status === 'pending' ? '处理中' : '',
    /** 处理中的记录不计入当日净额（钱/分还没真正到账） */
    pending: status === 'pending',
    balanceText: row && row.balanceAfter != null ? `余 ${row.balanceAfter}` : ''
  };
}

/**
 * 时间轴派生：月带 + 日组（组头给当日净积分）
 *
 * @param {object[]} rows 已加载明细（createTime 倒序）
 * @param {{ hasMore?: boolean, now?: number }} options
 *        hasMore=true 表示还有更早的没加载 → 最早那天可能不完整，不给它算净额（不谎报）
 */
function buildPointsTimeline(rows, options = {}) {
  const nowMs = Number(options.now) || Date.now();
  const hasMore = !!options.hasMore;
  const list = (rows || []).filter(Boolean).map((row) => mapPointRow(row, nowMs));

  const buckets = [];
  const byKey = new Map();
  let earn = 0;
  let spend = 0;
  let pendingCount = 0;

  list.forEach((row) => {
    if (row.pending) pendingCount += 1;
    else if (row.points > 0) earn += row.points;
    else if (row.points < 0) spend += Math.abs(row.points);

    const key = dayKeyOf(row.timeMs) || '__unknown__';
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        ms: row.timeMs,
        label: dayLabel(row.timeMs, nowMs),
        week: weekdayLabel(row.timeMs),
        monthKey: monthKeyOf(row.timeMs),
        rows: [],
        net: 0
      };
      byKey.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.rows.push(row);
    if (!row.pending) bucket.net += row.points;
  });

  // 最早的一天 = 列表末尾（倒序输入）；分页未完时不给它算净额
  const openKey = hasMore && buckets.length ? buckets[buckets.length - 1].key : '';

  const timeline = [];
  let lastMonth = '';
  buckets.forEach((bucket) => {
    if (bucket.monthKey && bucket.monthKey !== lastMonth) {
      lastMonth = bucket.monthKey;
      timeline.push({ kind: 'month', key: `m-${bucket.monthKey}`, label: monthLabel(bucket.ms) });
    }
    const complete = bucket.key !== openKey && bucket.key !== '__unknown__';
    const rowCount = bucket.rows.length;
    timeline.push({
      kind: 'day',
      key: `d-${bucket.key}`,
      label: bucket.label,
      week: bucket.key === '__unknown__' ? '' : bucket.week,
      count: rowCount,
      complete,
      netText: complete && bucket.net !== 0 ? signedPointsText(bucket.net) : '',
      netTone: bucket.net > 0 ? 'is-plus' : bucket.net < 0 ? 'is-minus' : 'is-flat',
      rows: bucket.rows
    });
  });

  return {
    timeline,
    count: list.length,
    earn,
    spend,
    pendingCount
  };
}

/** 分值带符号；0 不显示符号 */
function signedPointsText(points) {
  const n = Number(points) || 0;
  if (n > 0) return `+${n}`;
  if (n < 0) return `-${Math.abs(n)}`;
  return '0';
}

/**
 * 口径文案：绝不用「已加载」冒充「全部」
 * @param {number} count 已加载条数
 * @param {boolean} hasMore 是否还有更早的
 * @param {number} total 服务端总数（未知时传 0）
 */
function pointsCapText(count, hasMore, total) {
  const n = Number(count) || 0;
  const t = Number(total) || 0;
  if (!n) return '';
  if (hasMore) return t > n ? `已加载 ${n} / 共 ${t} 笔` : `已加载 ${n} 笔`;
  return t > n ? `共 ${t} 笔` : `共 ${n} 笔`;
}

module.exports = {
  DAY_MS,
  mapPointRow,
  buildPointsTimeline,
  signedPointsText,
  pointsCapText,
  ledgerTimeMs,
  dayKeyOf,
  dayLabel,
  formatClock
};
