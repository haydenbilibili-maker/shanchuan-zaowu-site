/**
 * 店长看板「今日 · 较昨日」（2026-10-18 方向池 ★★）：从 7 日趋势（_lastTrendDays，旧→新，末位 = 今天）现算，
 * 不另打云端。昨日为 0 时不给百分比（除以 0 没有意义），只写「昨日无营收」。
 */
function dayVsYesterday(days, formatMoney) {
  const list = Array.isArray(days) ? days : [];
  const fmt = typeof formatMoney === 'function' ? formatMoney : (n) => String(n);
  if (list.length < 2) return { todayFmt: '', dayDeltaText: '', dayDeltaClass: 'flat' };
  const today = Number(list[list.length - 1].total) || 0;
  const yest = Number(list[list.length - 2].total) || 0;
  if (yest <= 0) {
    return { todayFmt: fmt(today), dayDeltaText: today > 0 ? '昨日无营收' : '', dayDeltaClass: 'flat' };
  }
  const pct = Math.round(((today - yest) / yest) * 100);
  if (pct === 0) return { todayFmt: fmt(today), dayDeltaText: '较昨日持平', dayDeltaClass: 'flat' };
  return {
    todayFmt: fmt(today),
    dayDeltaText: `较昨日 ${pct > 0 ? '↑' : '↓'}${Math.abs(pct)}%`,
    dayDeltaClass: pct > 0 ? 'up' : 'down'
  };
}

module.exports = { dayVsYesterday };
