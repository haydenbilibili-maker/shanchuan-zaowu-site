/**
 * 每日日报 · 展示层视图模型
 *
 * 为什么单独成模块（而不是写在详情页里）：
 *   ① 金额的「分 → 元」与「未取到」的语义只允许有一处实现 ——
 *      日报最容易出的错就是单位（错题本 E18/E21：同名不同单位让汇总正好翻倍）；
 *   ② 守卫 `check:daily-digest` 可以直接 require 本文件**真跑**一遍格式化，
 *      不用去跑小程序页面（页面依赖 wx 全局，跑不起来）。
 *
 * 输入 = 云函数写入 `user_messages.payload`（经 getUserMessages.normalizeDigestPayload 收敛），
 * 输出 = WXML 可直接渲染的结构。
 */

/** 与云函数 dailyDigest/reportCatalog.js 的 message.category 一致 */
const DIGEST_CATEGORY = 'digest';

function toNumber (v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 金额/计数格式化。**唯一口径**：
 *   unit === 'fen'  → ÷100 后两位小数（字段名自带单位，见目录报告）
 *   unit === 'yuan' → 原样两位小数
 *   unit === 'count'/'order' → 整数
 * value == null 表示「当日该来源没有数据」（区别于合计为 0）→ 返回 '未取到'
 */
function formatDigestValue (metric) {
  if (!metric || metric.value == null) return '未取到';
  const n = toNumber(metric.value);
  const unit = String(metric.unit || '');
  if (unit === 'fen') return `¥${(n / 100).toFixed(2)}`;
  if (unit === 'yuan') return `¥${n.toFixed(2)}`;
  if (unit === 'count') return String(Math.round(n));
  return String(Math.round(n));
}

function isMissing (metric) {
  return !metric || metric.value == null;
}

/** 一条口径的单行摘要（给详情页每个数字下面的一行小字） */
function describeSources (metric) {
  const list = Array.isArray(metric && metric.sources) ? metric.sources : [];
  if (!list.length) return String((metric && metric.source) || '');
  return list.map((s) => {
    const col = String(s.collection || '');
    const field = String(s.timeField || '');
    const tz = String(s.tz || '');
    return `${col}.${field}（${tz}）`;
  }).join('；');
}

/**
 * payload → 视图模型。payload 为空 / 非日报 → 返回 null（详情页据此完全跳过该块）。
 */
function buildDigestView (message) {
  const payload = message && message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  if (!metrics.length) return null;

  const byId = {};
  metrics.forEach((m) => { if (m && m.id) byId[m.id] = m; });

  // 取数失败（写侧 dailyDigest 单独回传，带原因）—— 与「当日确实无数据」是**两档**：
  // 读侧若不用它，聚合报错就会被显示成「未取到」，读者以为那天真没生意。
  const failedList = (Array.isArray(payload.failed) ? payload.failed : []).filter((f) => f && f.id);
  const failedById = {};
  failedList.forEach((f) => { failedById[f.id] = f; });
  const failedLabels = failedList.map((f) => String(f.label || f.id || '')).filter(Boolean);

  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((s) => ({
    key: String(s && s.key || ''),
    label: String(s && s.label || ''),
    metrics: (Array.isArray(s && s.ids) ? s.ids : [])
      .map((id) => byId[id])
      .filter(Boolean)
      .map((m) => {
        const fail = failedById[m.id];
        return {
          id: m.id,
          label: m.label,
          // 取数失败不是「未取到」（更不是 0）：文案必须自己说出来。
          valueText: fail ? '取数失败' : formatDigestValue(m),
          missing: !fail && isMissing(m),
          failed: !!fail,
          failedText: fail ? `取数失败：${String(fail.error || '原因未回传')}` : '',
          sourceText: describeSources(m),
          caveat: String(m.caveat || '')
        };
      })
  })).filter((s) => s.metrics.length);

  if (!sections.length) return null;

  // ⚠️ missingCount 必须排除取数失败项，否则「故障」会被并进「当日无数据」的计数里。
  const missingCount = metrics.filter((m) => isMissing(m) && !(m && m.id && failedById[m.id])).length;
  const failedCount = failedList.length;
  return {
    title: `${String(payload.dayKey || '')} 日报`,
    roleLabel: String(payload.roleLabel || ''),
    generatedAt: String(payload.generatedAt || ''),
    sections,
    missingCount,
    failedCount,
    // 「读数时点」必须显式展示：日报是**定时快照**，不是实时数
    snapshotNote: '这是一份定时快照：数字取自生成那一刻，之后补录/退款不会回改。',
    failedNote: failedCount
      ? `${failedCount} 项取数失败（不是 0，也不是当日无数据）${failedLabels.length ? '：' + failedLabels.join('、') : ''}。数字可能不准，请联系技术。`
      : '',
    missingNote: missingCount
      ? `${missingCount} 项当日无数据（显示「未取到」），不等于 0。`
      : ''
  };
}

module.exports = {
  DIGEST_CATEGORY,
  formatDigestValue,
  describeSources,
  buildDigestView
};
