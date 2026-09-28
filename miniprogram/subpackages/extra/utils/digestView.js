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
 *
 * Phase 2（2026-09-24）：补列表卡 `buildDigestListCard` + 详情关键数/生成时点。
 * Phase 3（2026-09-26）：星期/相对日、健康态、分组小计、口径短文案；
 * **仍不发明新字段**，只从既有 payload 挑展示。
 */

/** 与云函数 dailyDigest/reportCatalog.js 的 message.category 一致 */
const DIGEST_CATEGORY = 'digest';

/**
 * 列表/详情「关键数」优先顺序 —— 必须是 reportCatalog 里已有的 id，
 * 找不到就跳过，绝不编造数字。
 */
const HIGHLIGHT_IDS = [
  'order_paid_fen',
  'store_revenue_yuan',
  'mini_visitors',
  'order_created',
  'order_paid'
];

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

/** 默认折叠时用的短口径（集合名即可，展开再看全量） */
function describeSourcesBrief (metric) {
  const list = Array.isArray(metric && metric.sources) ? metric.sources : [];
  if (!list.length) {
    const src = String((metric && metric.source) || '').trim();
    if (!src) return '';
    return src.length > 28 ? `${src.slice(0, 28)}…` : src;
  }
  const cols = [];
  const seen = {};
  list.forEach((s) => {
    const col = String(s && s.collection || '').trim();
    if (!col || seen[col]) return;
    seen[col] = true;
    cols.push(col);
  });
  return cols.join(' · ');
}

function formatGeneratedAt (iso) {
  const raw = String(iso || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 19);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * dayKey（东八营业日 YYYY-MM-DD）→ 星期 + 相对日。
 * 相对日按**本地日历**与 dayKey 字符串比差（不引入新时区契约）。
 */
function describeDayKey (dayKey) {
  const key = String(dayKey || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) {
    return {
      dayKey: key,
      weekday: '',
      relative: '',
      dayBadge: key || '日报',
      dayLine: key || '日报'
    };
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  const weekday = WEEKDAY_LABELS[date.getDay()] || '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86400000);
  let relative = '';
  if (diffDays === 0) relative = '今天';
  else if (diffDays === 1) relative = '昨天';
  else if (diffDays === 2) relative = '前天';
  else if (diffDays > 2 && diffDays < 7) relative = `${diffDays} 天前`;
  else if (diffDays === -1) relative = '明天';

  const dayBadge = relative || weekday || key;
  const dayLine = [key, weekday, relative].filter(Boolean).join(' · ');
  return { dayKey: key, weekday, relative, dayBadge, dayLine };
}

function resolveHealth (failedCount, missingCount, metricCount) {
  const failed = Math.max(0, Number(failedCount) || 0);
  const missing = Math.max(0, Number(missingCount) || 0);
  const total = Math.max(0, Number(metricCount) || 0);
  if (failed > 0) {
    return {
      tone: 'failed',
      label: '取数异常',
      summary: `${failed} 项失败` + (missing ? ` · ${missing} 项无数据` : '')
    };
  }
  if (missing > 0) {
    return {
      tone: 'partial',
      label: '部分无数据',
      summary: `${missing} 项当日无数据` + (total ? ` · 共 ${total} 项` : '')
    };
  }
  return {
    tone: 'ok',
    label: '快照正常',
    summary: total ? `共 ${total} 项 · 口径可对账` : '定时快照 · 口径可对账'
  };
}

function indexMetrics (payload) {
  const metrics = Array.isArray(payload && payload.metrics) ? payload.metrics : [];
  const byId = {};
  metrics.forEach((m) => { if (m && m.id) byId[m.id] = m; });
  const failedList = (Array.isArray(payload && payload.failed) ? payload.failed : []).filter((f) => f && f.id);
  const failedById = {};
  failedList.forEach((f) => { failedById[f.id] = f; });
  return { metrics, byId, failedList, failedById };
}

function mapMetricRow (m, failedById) {
  const fail = failedById[m.id];
  const sourceText = describeSources(m);
  const sourceBrief = describeSourcesBrief(m);
  return {
    id: m.id,
    label: m.label,
    valueText: fail ? '取数失败' : formatDigestValue(m),
    missing: !fail && isMissing(m),
    failed: !!fail,
    failedText: fail ? `取数失败：${String(fail.error || '原因未回传')}` : '',
    sourceText,
    sourceBrief,
    hasSource: !!(sourceText || sourceBrief),
    caveat: String(m.caveat || '')
  };
}

function pickHighlights (byId, failedById, limit) {
  const out = [];
  const seen = {};
  for (let i = 0; i < HIGHLIGHT_IDS.length && out.length < limit; i++) {
    const id = HIGHLIGHT_IDS[i];
    const m = byId[id];
    if (!m || seen[id]) continue;
    seen[id] = true;
    const row = mapMetricRow(m, failedById);
    // 第一条关键数做视觉主层级（列表/详情放大），不改数字本身
    row.primary = out.length === 0;
    out.push(row);
  }
  return out;
}

function buildCopyText (dayKey, roleLabel, health, highlights, sections) {
  const lines = [];
  lines.push(`山海造物 · ${dayKey || '日报'}${roleLabel ? ` · ${roleLabel}` : ''}`);
  if (health && health.summary) lines.push(`状态：${health.label || ''} ${health.summary}`.trim());
  if (highlights && highlights.length) {
    lines.push('');
    lines.push('【关键】');
    highlights.forEach((h) => {
      if (!h) return;
      lines.push(`${h.label} ${h.valueText}`);
    });
  }
  if (sections && sections.length) {
    sections.forEach((sec) => {
      if (!sec) return;
      lines.push('');
      lines.push(`【${sec.label}】${sec.countText ? ` ${sec.countText}` : ''}`);
      (sec.metrics || []).forEach((m) => {
        if (!m) return;
        lines.push(`- ${m.label} ${m.valueText}`);
      });
    });
  }
  lines.push('');
  lines.push('（定时快照，补录/退款不会回改）');
  return lines.join('\n');
}

function buildCopyFailedText (dayKey, roleLabel, sections) {
  const lines = [];
  lines.push(`${dayKey || '日报'}${roleLabel ? ` · ${roleLabel}` : ''} · 取数失败项`);
  let n = 0;
  (sections || []).forEach((sec) => {
    (sec.metrics || []).forEach((m) => {
      if (!m || !m.failed) return;
      n += 1;
      lines.push(`- [${sec.label}] ${m.label}：${m.failedText || '取数失败'}`);
    });
  });
  if (!n) lines.push('（本期无失败项）');
  return lines.join('\n');
}

/**
 * 列表用紧凑卡：无 payload / 非日报 → null（列表整块不渲染）。
 */
function buildDigestListCard (message) {
  const payload = message && message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const type = String((message && message.type) || '');
  if (type && type !== 'daily_digest') return null;
  const { metrics, byId, failedList, failedById } = indexMetrics(payload);
  if (!metrics.length) return null;

  const dayKey = String(payload.dayKey || '').trim();
  const roleLabel = String(payload.roleLabel || '').trim();
  const dayMeta = describeDayKey(dayKey);
  const highlights = pickHighlights(byId, failedById, 3);
  const failedCount = failedList.length;
  const missingCount = metrics.filter((m) => isMissing(m) && !(m && m.id && failedById[m.id])).length;
  const health = resolveHealth(failedCount, missingCount, metrics.length);

  const headline = dayKey
    ? (roleLabel
      ? `${dayMeta.dayBadge} · ${dayKey}${roleLabel ? ` · ${roleLabel}` : ''}`
      : `${dayMeta.dayBadge} · ${dayKey}`)
    : (roleLabel || '每日日报');

  return {
    dayKey,
    dayLabel: dayMeta.dayLine || dayKey || '日报',
    dayBadge: dayMeta.dayBadge,
    weekday: dayMeta.weekday,
    relative: dayMeta.relative,
    roleLabel,
    headline,
    highlights,
    hasHighlights: highlights.length > 0,
    primaryHighlight: highlights[0] || null,
    failedCount,
    missingCount,
    metricCount: metrics.length,
    healthTone: health.tone,
    healthLabel: health.label,
    statusHint: health.summary,
    copyText: buildCopyText(dayKey, roleLabel, health, highlights, null)
  };
}

/**
 * payload → 视图模型。payload 为空 / 非日报 → 返回 null（详情页据此完全跳过该块）。
 */
function buildDigestView (message) {
  const payload = message && message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const { metrics, byId, failedList, failedById } = indexMetrics(payload);
  if (!metrics.length) return null;

  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((s) => {
    const rows = (Array.isArray(s && s.ids) ? s.ids : [])
      .map((id) => byId[id])
      .filter(Boolean)
      .map((m) => mapMetricRow(m, failedById));
    if (!rows.length) return null;
    const secFailed = rows.filter((r) => r.failed).length;
    const secMissing = rows.filter((r) => r.missing).length;
    const secOk = rows.length - secFailed - secMissing;
    const secHealth = resolveHealth(secFailed, secMissing, rows.length);
    // 正常分组默认收起，异常/部分无数据展开 —— 降噪且失败一眼可见
    const startCollapsed = secHealth.tone === 'ok' && rows.length >= 2;
    return {
      key: String(s && s.key || ''),
      label: String(s && s.label || ''),
      metrics: rows,
      metricCount: rows.length,
      failedCount: secFailed,
      missingCount: secMissing,
      okCount: secOk,
      healthTone: secHealth.tone,
      healthLabel: secHealth.label,
      countText: `${rows.length} 项` + (secFailed ? ` · ${secFailed} 失败` : '') + (secMissing ? ` · ${secMissing} 无数据` : ''),
      startCollapsed,
      collapsedHint: startCollapsed ? `已收起 · 点开查看 ${rows.length} 项` : ''
    };
  }).filter(Boolean);

  if (!sections.length) return null;

  // ⚠️ missingCount 必须排除取数失败项，否则「故障」会被并进「当日无数据」的计数里。
  const missingCount = metrics.filter((m) => isMissing(m) && !(m && m.id && failedById[m.id])).length;
  const failedCount = failedList.length;
  const failedLabels = failedList.map((f) => String(f.label || f.id || '')).filter(Boolean);
  const generatedAt = String(payload.generatedAt || '');
  const generatedAtText = formatGeneratedAt(generatedAt);
  const highlights = pickHighlights(byId, failedById, 3);
  const dayKey = String(payload.dayKey || '');
  const roleLabel = String(payload.roleLabel || '');
  const dayMeta = describeDayKey(dayKey);
  const health = resolveHealth(failedCount, missingCount, metrics.length);
  const okCount = Math.max(0, metrics.length - failedCount - missingCount);

  return {
    title: dayKey ? `${dayKey} 日报` : '日报',
    dayKey,
    dayBadge: dayMeta.dayBadge,
    weekday: dayMeta.weekday,
    relative: dayMeta.relative,
    dayLine: dayMeta.dayLine,
    roleLabel,
    generatedAt,
    generatedAtText,
    highlights,
    hasHighlights: highlights.length > 0,
    sections,
    metricCount: metrics.length,
    okCount,
    missingCount,
    failedCount,
    healthTone: health.tone,
    healthLabel: health.label,
    healthSummary: health.summary,
    // 「读数时点」必须显式展示：日报是**定时快照**，不是实时数
    snapshotNote: '这是一份定时快照：数字取自生成那一刻，之后补录/退款不会回改。',
    generatedNote: generatedAtText ? `生成于 ${generatedAtText}（服务器时点）。` : '',
    failedNote: failedCount
      ? `${failedCount} 项取数失败（不是 0，也不是当日无数据）${failedLabels.length ? '：' + failedLabels.join('、') : ''}。数字可能不准，请联系技术。`
      : '',
    missingNote: missingCount
      ? `${missingCount} 项当日无数据（显示「未取到」），不等于 0。`
      : '',
    countNote: `共 ${metrics.length} 项指标 · ${okCount} 项有数` +
      (failedCount ? ` · ${failedCount} 项失败` : '') +
      (missingCount ? ` · ${missingCount} 项无数据` : ''),
    copyText: buildCopyText(dayKey, roleLabel, health, highlights, sections),
    copyFailedText: buildCopyFailedText(dayKey, roleLabel, sections),
    hasFailedRows: failedCount > 0
  };
}

module.exports = {
  DIGEST_CATEGORY,
  HIGHLIGHT_IDS,
  formatDigestValue,
  describeSources,
  describeSourcesBrief,
  describeDayKey,
  resolveHealth,
  buildDigestListCard,
  buildDigestView
};
