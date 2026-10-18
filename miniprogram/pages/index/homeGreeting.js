/**
 * 首页馆员问候（2026-10-18 方向池 ★★）：按时段 + 门店营业状态给一句话。
 * 纯前端，只读 loadExploreStore 已拿到的 store.hours（"HH:mm"）与门店名；没有营业时间就只问候、不报营业状态
 * （storeHelper.getOpenStatus 在缺营业时间时默认「营业中」，这里不沿用，免得说错）。
 */
function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function timeWord(hour) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '午后好';
  return '晚上好';
}

/** { word, line }：word = 问候；line = 门店状态（无营业时间时为空串） */
function buildHomeGreeting(store, now) {
  const d = now instanceof Date ? now : new Date();
  const word = timeWord(d.getHours());
  const s = store || {};
  const hours = s.hours || {};
  const open = toMin(hours.open);
  const close = toMin(hours.close);
  const name = String(s.name || s.storeName || '').trim() || '门店';
  if (open == null || close == null) return { word, line: '' };
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < open) return { word, line: `${name} ${hours.open} 开馆，先逛逛线上馆藏` };
  if (mins >= close) return { word, line: `${name}已闭馆，明天 ${hours.open} 见` };
  if (close - mins <= 60) return { word, line: `${name}营业中，${hours.close} 闭馆，还来得及` };
  return { word, line: `${name}营业中，开到 ${hours.close}` };
}

module.exports = { buildHomeGreeting, timeWord };
