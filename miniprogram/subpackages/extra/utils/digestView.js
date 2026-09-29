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

/**
 * 给店长/管理者看的一句大白话（按指标 id）。集合名、字段、单位、口径辩护只留在云函数
 * reportCatalog 的 source/caveat（开发侧），payload 里仍带着，但展示层不渲染。
 */
const USER_NOTES = {
  mini_page_view: '凌晨 0–8 点的浏览计入前一天。',
  order_created: '含之后取消的订单。',
  order_refunded_yuan: '退款金额以门店账本为准，这里仅供参考。',
  store_revenue_yuan: '门店当天没录入时显示「未取到」，不是 0。',
  store_ledger_offline_orders: '门店自己记的单数，不含小程序订单。',
  store_online_income_yuan: '门店录入的线上收入，和小程序订单分开统计。',
  studio_shipments: '出货单可以补录，数字可能随之变化。'
};

/** 门店营收段：指标 id → storeBreakdown 行字段（按门店逐项展示） */
const STORE_METRIC_KEYS = {
  store_revenue_yuan: 'revenueYuan',
  store_ledger_pos_yuan: 'posYuan',
  store_ledger_offline_orders: 'orderCount',
  store_refund_yuan: 'refundYuan',
  store_online_income_yuan: 'onlineYuan',
  studio_shipments: 'shipmentCount'
};

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
    summary: total ? `共 ${total} 项` : '定时快照'
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
  return {
    id: m.id,
    label: m.label,
    valueText: fail ? '取数失败' : formatDigestValue(m),
    missing: !fail && isMissing(m),
    failed: !!fail,
    failedText: fail ? '这一项没取到数，数字可能不准，请稍后再看或联系技术。' : '',
    // 原始报错只进「复制失败项」（给技术排查），不直接展示
    failedError: fail ? String(fail.error || '原因未回传') : '',
    note: USER_NOTES[m.id] || ''
  };
}

/** 门店营收段每个指标下的各店数值；有 POS 却记 0 单 = 门店没报单数 →「未记单数」 */
function storeSplitFor (id, raw) {
  const key = id === 'cash' ? 'cashBalanceYuan' : STORE_METRIC_KEYS[id];
  if (!key || !raw || !Array.isArray(raw.rows) || !raw.rows.length) return null;
  const unit = key === 'orderCount' || key === 'shipmentCount' ? 'order' : 'yuan';
  return raw.rows.map((r) => {
    const v = r && r[key];
    const noOrders = key === 'orderCount' && v === 0 && toNumber(r.posYuan) > 0;
    return {
      storeId: String((r && r.storeId) || ''),
      name: String((r && r.name) || ''),
      valueText: noOrders || (v == null && key === 'orderCount') ? '未记单数' : formatStoreCell(unit, v)
    };
  });
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

/** 门店营收按店分行的格子文字：null = 该店当日该来源无数据（区别于 0） */
function formatStoreCell (unit, v) {
  if (v == null) return unit === 'order' ? '单数未记' : '—';
  if (unit === 'order') return `${Math.round(toNumber(v))} 单`;
  return `¥${toNumber(v).toFixed(2)}`;
}

/**
 * payload.storeBreakdown → 按店分行视图（每店一行 + 合计行）。
 * 合计行用云端给的 total；另在本地复算 Σ 各店，对不上就给出 balanceWarn（不静默吞掉）。
 * 旧日报没有 storeBreakdown → null。
 */
function buildStoreBreakdownView (raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows) || !raw.rows.length) return null;
  const toRow = (r, isTotal) => ({
    storeId: String((r && r.storeId) || ''),
    name: String((r && r.name) || ''),
    isTotal: !!isTotal,
    revenueText: formatStoreCell('yuan', r && r.revenueYuan),
    posText: formatStoreCell('yuan', r && r.posYuan),
    // 有 POS 收款却记 0 单 = 门店日报没报单数，显示「单数未记」而不是「0 单」
    orderText: formatStoreCell('order', r && r.orderCount === 0 && toNumber(r.posYuan) > 0 ? null : r && r.orderCount),
    cashText: formatStoreCell('yuan', r && r.cashBalanceYuan),
    extraText: [
      r && r.refundYuan ? `退款 ${formatStoreCell('yuan', r.refundYuan)}` : '',
      r && r.onlineYuan ? `线上 ${formatStoreCell('yuan', r.onlineYuan)}` : ''
    ].filter(Boolean).join(' · ')
  });
  const rows = raw.rows.map((r) => toRow(r, false));
  const total = raw.total ? toRow(raw.total, true) : null;
  const warn = [];
  ['revenueYuan', 'posYuan', 'orderCount', 'cashBalanceYuan'].forEach((k) => {
    const vals = raw.rows.map((r) => r && r[k]).filter((v) => v != null);
    if (!raw.total || !vals.length) return;
    const sum = vals.reduce((a, b) => a + toNumber(b), 0);
    if (raw.total[k] == null || Math.abs(sum - toNumber(raw.total[k])) > 0.005) warn.push(k);
  });
  const mismatches = Array.isArray(raw.mismatches) ? raw.mismatches.filter(Boolean) : [];
  const failed = Array.isArray(raw.failedCollections) ? raw.failedCollections.filter(Boolean) : [];
  return {
    rows,
    total,
    storeCount: rows.length,
    note: '在手现金是门店现金余额，不算进营收。',
    balanceWarn: warn.length || mismatches.length
      ? '各门店加起来和总数对不上，请核对门店录入。'
      : '',
    failedNote: failed.length ? '部分门店数据没取到，对应位置显示「—」。' : ''
  };
}

function storeBreakdownCopyLines (bd) {
  if (!bd) return [];
  const line = (r) => `- ${r.name}：营收 ${r.revenueText} · POS ${r.posText} · ${r.orderText} · 在手现金 ${r.cashText}${r.extraText ? ' · ' + r.extraText : ''}`;
  const out = ['按门店：'];
  bd.rows.forEach((r) => out.push(line(r)));
  if (bd.total) out.push(line(bd.total));
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
      storeBreakdownCopyLines(sec.storeBreakdown).forEach((l) => lines.push(l));
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
      lines.push(`- [${sec.label}] ${m.label}：取数失败 ${m.failedError || ''}`.trim());
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
  const storeBreakdown = buildStoreBreakdownView(payload.storeBreakdown);

  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((s) => {
    const isStore = String(s && s.key || '') === 'store';
    const rows = (Array.isArray(s && s.ids) ? s.ids : [])
      .map((id) => byId[id])
      .filter(Boolean)
      .map((m) => mapMetricRow(m, failedById));
    if (!rows.length) return null;
    if (isStore && storeBreakdown) {
      rows.forEach((r) => { if (!r.failed) r.stores = storeSplitFor(r.id, payload.storeBreakdown); });
      const cashTotal = payload.storeBreakdown.total && payload.storeBreakdown.total.cashBalanceYuan;
      if (cashTotal != null) {
        rows.push({
          id: 'store_cash_balance',
          label: '在手现金',
          valueText: formatStoreCell('yuan', cashTotal),
          missing: false,
          failed: false,
          note: '门店现金余额，不算进营收。',
          stores: storeSplitFor('cash', payload.storeBreakdown),
          extra: true
        });
      }
    }
    const metricRows = rows.filter((r) => !r.extra);
    const secFailed = metricRows.filter((r) => r.failed).length;
    const secMissing = metricRows.filter((r) => r.missing).length;
    const secOk = metricRows.length - secFailed - secMissing;
    const secHealth = resolveHealth(secFailed, secMissing, metricRows.length);
    // 正常分组默认收起，异常/部分无数据展开 —— 降噪且失败一眼可见
    const startCollapsed = secHealth.tone === 'ok' && rows.length >= 2 &&
      !(String(s && s.key || '') === 'store' && storeBreakdown);
    return {
      key: String(s && s.key || ''),
      label: String(s && s.label || ''),
      metrics: rows,
      metricCount: metricRows.length,
      failedCount: secFailed,
      missingCount: secMissing,
      okCount: secOk,
      healthTone: secHealth.tone,
      healthLabel: secHealth.label,
      countText: `${metricRows.length} 项` + (secFailed ? ` · ${secFailed} 失败` : '') + (secMissing ? ` · ${secMissing} 无数据` : ''),
      startCollapsed,
      collapsedHint: startCollapsed ? `已收起 · 点开查看 ${metricRows.length} 项` : '',
      storeBreakdown: isStore ? storeBreakdown : null,
      storeNotice: !isStore ? '' : (storeBreakdown
        ? (storeBreakdown.balanceWarn || storeBreakdown.failedNote)
        : '这期日报生成时还没有按门店拆分，之后的日报会分门店显示。')
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
  buildStoreBreakdownView,
  describeDayKey,
  resolveHealth,
  buildDigestListCard,
  buildDigestView
};
