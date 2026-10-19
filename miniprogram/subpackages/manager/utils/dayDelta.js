/**
 * 店长看板「今日 · 较昨日」（2026-10-18 方向池 ★★）：从 7 日趋势（_lastTrendDays，旧→新，末位 = 今天）现算，
 * 不另打云端。昨日为 0 时不给百分比（除以 0 没有意义），只写「昨日无营收」。
 * nowHour（可选，0–23）：传入且早于 EARLY_HOUR 时，今天只过了一部分、拿半天比全天必然「↓」，
 * 改为只报「昨日全天 ¥X」作参照；不传则保持原口径（R42-8 守卫按两参调用）。
 */
const EARLY_HOUR = 20;
function dayVsYesterday(days, formatMoney, nowHour) {
  const list = Array.isArray(days) ? days : [];
  const fmt = typeof formatMoney === 'function' ? formatMoney : (n) => String(n);
  if (list.length < 2) return { todayFmt: '', dayDeltaText: '', dayDeltaClass: 'flat' };
  const today = Number(list[list.length - 1].total) || 0;
  const yest = Number(list[list.length - 2].total) || 0;
  if (yest <= 0) {
    return { todayFmt: fmt(today), dayDeltaText: today > 0 ? '昨日无营收' : '', dayDeltaClass: 'flat' };
  }
  if (typeof nowHour === 'number' && nowHour >= 0 && nowHour < EARLY_HOUR) {
    return { todayFmt: fmt(today), dayDeltaText: `昨日全天 ¥${fmt(yest)}`, dayDeltaClass: 'flat' };
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
