/**
 * 会员 CRM（仅超管）— 对齐 Admin CRM.vue
 * manageMemberCrm: list | getDetail | adjustPoints | overview
 */
const { guardStaffPage } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');
const { orderStatusLabel } = require('../utils/orderStatus');

const FN = 'manageMemberCrm';
const TAG_PREVIEW_LIMIT = 8;
const ORDER_DETAIL_PATH = '/subpackages/business/order-detail/index';
const OVERVIEW_TABS = [
  { key: 'total', label: '会员总数' },
  { key: 'active', label: '活跃会员' },
  { key: 'highValue', label: '高价值' }
];

const SHANGHAI_TZ = 'Asia/Shanghai';

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { dateOnly: s };
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    }
    if (value._seconds != null) {
      const sec = Number(value._seconds);
      if (Number.isFinite(sec)) {
        const nano = Number(value._nanoseconds || 0);
        return sec * 1000 + (Number.isFinite(nano) ? Math.floor(nano / 1e6) : 0);
      }
    }
    if (value.$date != null) return parseTimestamp(value.$date);
  }
  return null;
}

function formatDateTimeShanghai(value) {
  const parsed = parseTimestamp(value);
  if (!parsed) return '';
  if (parsed.dateOnly) return `${parsed.dateOnly} 00:00:00`;
  const ms = typeof parsed === 'number' ? parsed : null;
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: SHANGHAI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(d);
    const pick = (type) => {
      const hit = parts.find((p) => p.type === type);
      return hit ? hit.value : '';
    };
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
  } catch (e) {
    const offsetMs = ms + 8 * 3600000;
    const u = new Date(offsetMs);
    const pad = (x) => String(x).padStart(2, '0');
    return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())} ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())}`;
  }
}

function formatMoney(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toLocaleString('zh-CN');
}

function formatRecency(days) {
  if (days == null) return '从未消费';
  return `${days} 天前`;
}

/** 分群文案色 — 对齐 Museum 语义色，不沿用 Admin Material 色 */
const SEGMENT_TONE = {
  champions: '#C4A76C',
  loyal: '#C4A76C',
  potential_loyal: '#52B788',
  new_customers: '#52B788',
  promising: '#52B788',
  need_attention: '#E9A23B',
  about_to_sleep: '#E9A23B',
  at_risk: '#D64045',
  cant_lose: '#D64045',
  hibernating: '#A09A90',
  lost: '#6B6560',
  never_purchased: '#A09A90'
};

/** 与 pushMessage/audience.js 同源 — 推断有信 campaignType */
const CAMPAIGN_RECALL_SEGMENTS = new Set([
  'never_purchased',
  'about_to_sleep',
  'need_attention',
  'at_risk',
  'cant_lose',
  'hibernating',
  'lost'
]);

const CAMPAIGN_CONVERSION_SEGMENTS = new Set([
  'new_customers',
  'promising',
  'potential_loyal',
  'champions',
  'loyal'
]);

function inferCampaignType(segmentKey) {
  const key = String(segmentKey || '');
  if (CAMPAIGN_CONVERSION_SEGMENTS.has(key)) return 'conversion';
  if (CAMPAIGN_RECALL_SEGMENTS.has(key)) return 'recall';
  return 'general';
}

function shouldShowRfmDash(row, segmentKey, rfmRaw) {
  const freq = Number(row && row.frequency) || 0;
  const monetary = Number(row && row.monetary) || 0;
  if (segmentKey === 'never_purchased') return true;
  if (freq === 0 && monetary === 0) return true;
  if (rfmRaw === '000') return true;
  return false;
}

function buildPortraitHint(row) {
  if (!row) return '';
  const parts = [];
  const seg = String(row.segmentName || (row.segmentMeta && row.segmentMeta.name) || '').trim();
  if (seg) parts.push(`分群：${seg}`);
  if (row.isHonorary) parts.push('荣誉馆长');
  else if (row.levelBadgeText) parts.push(String(row.levelBadgeText).replace(/\s+/g, ' '));
  const recency =
    row.recencyDays == null
      ? '从未消费'
      : `${Number(row.recencyDays) || 0} 天未下单`;
  parts.push(`近度：${recency}`);
  parts.push(`频次 ${Number(row.frequency) || 0} 单`);
  const money = Number(row.monetary) || 0;
  parts.push(money >= 10000 ? `累计约 ${(money / 10000).toFixed(1)} 万` : `累计约 ¥${Math.round(money)}`);
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const tagLabels = tags
    .map((t) => (t && t.label) || '')
    .filter(Boolean)
    .slice(0, 3);
  if (tagLabels.length) parts.push(`标签：${tagLabels.join('、')}`);
  const interest = Array.isArray(row.interestTags) ? row.interestTags.filter(Boolean).slice(0, 3) : [];
  if (interest.length) parts.push(`兴趣：${interest.join('、')}`);
  return parts.join('；').slice(0, 200);
}

const SIGNAL_BY_SEGMENT = {
  at_risk: { signalClass: 'signal-danger', signalPulse: true },
  cant_lose: { signalClass: 'signal-danger', signalPulse: true },
  about_to_sleep: { signalClass: 'signal-warning', signalPulse: true },
  need_attention: { signalClass: 'signal-warning', signalPulse: true },
  hibernating: { signalClass: 'signal-warning', signalPulse: false },
  champions: { signalClass: 'signal-brass', signalPulse: true },
  loyal: { signalClass: 'signal-brass', signalPulse: true },
  new_customers: { signalClass: 'signal-active', signalPulse: true },
  promising: { signalClass: 'signal-active', signalPulse: true },
  potential_loyal: { signalClass: 'signal-active', signalPulse: true },
  never_purchased: { signalClass: 'signal-idle', signalPulse: false },
  lost: { signalClass: 'signal-idle', signalPulse: false }
};

function deriveSignal(row) {
  const segment = String((row && row.segment) || 'never_purchased');
  const preset = SIGNAL_BY_SEGMENT[segment];
  if (preset) return preset;
  const rd = row.recencyDays;
  if (rd != null && rd <= 7) {
    return { signalClass: 'signal-active', signalPulse: true };
  }
  return { signalClass: 'signal-idle', signalPulse: false };
}

function stripTagLabel(tag) {
  const raw = String((tag && tag.label) || '').trim();
  // 去掉历史数据里可能残留的 emoji 前缀
  const label = raw
    .replace(/^[\u2600-\u27BF\uFE0F\u200D\uD83C-\uDBFF\uDC00-\uDFFF]+\s*/g, '')
    .trim();
  return {
    type: (tag && tag.type) || '',
    key: (tag && tag.key) || label,
    label: label || raw,
    color: (tag && tag.color) || '#C4A76C'
  };
}

function mapListItem(row) {
  const avatar = String((row && row.avatarUrl) || '').trim();
  const seg = (row && row.segmentMeta) || {};
  const tags = Array.isArray(row.tags) ? row.tags.slice(0, 3).map(stripTagLabel) : [];
  const isHonorary = !!(row && row.isHonorary)
  const level = Number(row && row.level) || 1
  const levelName = String((row && row.levelName) || '').trim()
  const registeredAt = formatDateTimeShanghai(row.createTime)
  const segmentKey = String(row.segment || 'never_purchased')
  const signal = deriveSignal(row)
  const rfmRaw = String(row.rfm || '000')
  const rfmText = shouldShowRfmDash(row, segmentKey, rfmRaw) ? '—' : rfmRaw
  const hasPhone = !!(row && row.hasPhone)
  const phoneMasked = String((row && row.phoneMasked) || '').trim()
  const freq = Number(row.frequency) || 0
  const monetary = Number(row.monetary) || 0
  // 以真实消费指标为准，避免 segment 漂移导致头卡「尚未消费」与明细矛盾
  const metricsSparse = freq === 0 && monetary === 0
  const pointsNum = Number(
    row.availablePoints != null ? row.availablePoints : row.points
  ) || 0
  const pointsDisplay = String(pointsNum)
  return {
    ...row,
    hasAvatar: !!avatar,
    avatarInitial: String((row && row.nickName) || '藏').slice(0, 1),
    monetaryText: `¥${formatMoney(row.monetary)}`,
    recencyText: row.recencyDays == null ? '从未消费' : `${row.recencyDays}天`,
    segmentName: seg.name || '',
    segmentIcon: '',
    segmentColor: seg.color || '#C4A76C',
    segmentTone: SEGMENT_TONE[segmentKey] || '#D5D1C8',
    signalClass: signal.signalClass,
    signalPulse: signal.signalPulse,
    rfmText,
    frequencyDisplay: String(freq),
    points: pointsNum,
    availablePoints: pointsNum,
    pointsDisplay,
    tags,
    createText: registeredAt,
    registerAtText: registeredAt,
    registerLabel: registeredAt ? `注册 ${registeredAt}` : '注册 —',
    levelBadgeText: isHonorary ? '荣誉馆长' : `Lv${level}${levelName ? ` ${levelName}` : ''}`,
    levelLvText: isHonorary ? '荣誉' : `Lv${level}`,
    levelNameText: isHonorary ? '馆长' : levelName || '',
    levelHonorary: isHonorary,
    metricsSparse,
    sparseSummary: metricsSparse ? `尚未消费 · 积分 ${pointsDisplay}` : '',
    hasPhone,
    phoneMasked,
    phoneLine: hasPhone ? phoneMasked : '未留手机',
    phoneCopyable: hasPhone
  };
}

function mapDetail(detail) {
  if (!detail) return null;
  const pointsNum = Number(
    detail.availablePoints != null ? detail.availablePoints : detail.points
  ) || 0;
  const enriched = {
    ...detail,
    points: pointsNum,
    availablePoints: pointsNum
  };
  const base = mapListItem(enriched);
  const allTags = (Array.isArray(detail.tags) ? detail.tags : []).map(stripTagLabel);
  const tagsExpanded = false;
  return {
    ...base,
    createText: base.registerAtText,
    registerAtText: base.registerAtText,
    recencyLabel: formatRecency(detail.recencyDays),
    monetaryText: `¥${formatMoney(detail.monetary)}`,
    heroSpendText: base.metricsSparse ? '尚未消费' : base.monetaryText,
    heroPointsText: base.pointsDisplay,
    heroRecencyText: formatRecency(detail.recencyDays),
    allTags,
    tagsPreview: allTags.slice(0, TAG_PREVIEW_LIMIT),
    tagsOverflow: Math.max(0, allTags.length - TAG_PREVIEW_LIMIT),
    tagsExpanded,
    visibleTags: allTags.slice(0, TAG_PREVIEW_LIMIT),
    suggestions: Array.isArray(detail.suggestions) ? detail.suggestions : [],
    segmentDesc: (detail.segmentMeta && detail.segmentMeta.desc) || '',
    levelLine: detail.isHonorary
      ? `荣誉馆长 · 成长值 ${detail.growthValue || 0}`
      : `Lv${detail.level || 1} ${detail.levelName || ''} · 成长值 ${detail.growthValue || 0}`
  };
}

function mapRecentOrder(o) {
  return {
    ...o,
    statusLabel: o.statusLabel || orderStatusLabel(o.status),
    timeText: formatDateTimeShanghai(o.createTime),
    priceText: `¥${formatMoney(o.totalPrice)}`
  };
}

function mapRankItem(row) {
  const avatar = String((row && row.avatarUrl) || '').trim();
  return {
    ...row,
    hasAvatar: !!avatar,
    avatarInitial: String((row && row.nickName) || '藏').slice(0, 1),
    monetaryText: `¥${formatMoney(row.monetary)}`,
    recencyText: row.recencyDays == null ? '从未' : `${row.recencyDays}d`,
    barStyle: `width: ${Math.min(100, Number(row.pct) || 0)}%;`
  };
}

function mapOverview(result) {
  const total = result.total || {};
  const active = result.active || {};
  const highValue = result.highValue || {};
  const definitions = result.definitions || {};
  return {
    definitions,
    dataCapped: !!result.dataCapped,
    totalLoaded: result.totalLoaded || 0,
    fetchCap: result.fetchCap || 1000,
    total: {
      count: total.count || 0,
      buyerCount: total.buyerCount || 0,
      neverPurchased: total.neverPurchased || 0,
      segmentBars: (total.segmentBars || []).map((s) => ({
        ...s,
        barStyle: `width: ${Math.min(100, Number(s.pct) || 0)}%;`
      }))
    },
    active: {
      count: active.count || 0,
      ratio: active.ratio || 0,
      recencyDays: active.recencyDays || 30,
      buckets: (active.buckets || []).map((b) => ({
        ...b,
        barStyle: `width: ${Math.min(100, Number(b.pct) || 0)}%;`
      }))
    },
    highValue: {
      segmentMemberCount: highValue.segmentMemberCount || 0,
      topN: highValue.topN || 20,
      rank: (highValue.rank || []).map(mapRankItem)
    }
  };
}

function overviewHintFor(overview, tab) {
  if (!overview) return '';
  let hint = '';
  if (tab === 'total') hint = (overview.definitions && overview.definitions.total) || '';
  else if (tab === 'active') hint = (overview.definitions && overview.definitions.active) || '';
  else hint = (overview.definitions && overview.definitions.highValue) || '';
  if (overview.dataCapped) hint = `${hint} · 采样达上限 ${overview.fetchCap}`;
  return hint;
}

Page({
  data: {
    ready: false,
    loading: false,
    keyword: '',
    segment: '',
    topSegments: [],
    list: [],
    totalMatched: 0,
    totalLoaded: 0,
    dataCapped: false,
    footerTip: '',

    overviewTabs: OVERVIEW_TABS,
    overviewTab: 'total',
    overviewTabTotal: true,
    overviewTabActive: false,
    overviewTabHighValue: false,
    overviewLoading: false,
    overviewReady: false,
    overview: null,
    overviewHint: '',

    showDetail: false,
    detailLoading: false,
    detail: null,
    recentOrders: [],
    tagsExpanded: false,

    showAdjust: false,
    adjustAmount: '',
    adjustSubmitting: false,

    showYouxin: false,
    youxinTarget: null,
    youxinCampaignType: 'general',
    youxinTitle: '',
    youxinContent: '',
    youxinAiLoading: false,
    youxinSending: false
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin');
    if (!role) return;
    this.setData({ ready: true });
    this.loadList();
    // 概览懒加载：首屏进入后拉一次，切 Tab 只切视图（同藏品库 stats 缓存）
    this.ensureOverview();
  },

  onPullDownRefresh() {
    const tasks = [this.loadList()];
    if (this.data.overviewReady || this.data.overviewLoading) {
      tasks.push(this.loadOverview(true));
    }
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} });
    const result = (res && res.result) || {};
    if (!result.success) {
      const err = new Error(result.msg || '操作失败');
      err.code = result.code;
      err.msg = result.msg;
      throw err;
    }
    return result;
  },

  switchOverviewTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'total');
    if (!OVERVIEW_TABS.some((t) => t.key === key)) return;
    const same = this.data.overviewTab === key;
    if (!same) {
      this.setData({
        overviewTab: key,
        overviewTabTotal: key === 'total',
        overviewTabActive: key === 'active',
        overviewTabHighValue: key === 'highValue',
        overviewHint: overviewHintFor(this.data.overview, key)
      });
    }
    this.ensureOverview();
  },

  ensureOverview() {
    if (this.data.overviewReady || this.data.overviewLoading) return;
    this.loadOverview(false);
  },

  onRefreshOverview() {
    this.loadOverview(true);
  },

  async loadOverview(force) {
    if (this.data.overviewLoading) return;
    if (this.data.overviewReady && !force) return;
    this.setData({ overviewLoading: true });
    try {
      const result = await this.callFn({ action: 'overview', topN: 20 });
      const overview = mapOverview(result);
      this.setData({
        overviewLoading: false,
        overviewReady: true,
        overview,
        overviewHint: overviewHintFor(overview, this.data.overviewTab)
      });
    } catch (e) {
      this.setData({ overviewLoading: false });
      wx.showToast({ title: formatCloudFnError(e, e.msg || '概览加载失败'), icon: 'none' });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: String((e.detail && e.detail.value) || '') });
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.loadList();
  },

  onSearch() {
    this.loadList();
  },

  onSegmentTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    const next = this.data.segment === key ? '' : key;
    this.setData({ segment: next });
    this.loadList();
  },

  async loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await this.callFn({
        action: 'list',
        keyword: this.data.keyword,
        segment: this.data.segment
      });
      const tip = result.dataCapped
        ? `采样达上限 ${result.fetchCap}，RFM 可能偏低`
        : `算法依据 orders + user_behaviors`;
      const mapped = (result.list || []).map(mapListItem);
      this.setData({
        loading: false,
        list: mapped,
        totalMatched: result.totalMatched || 0,
        totalLoaded: result.totalLoaded || 0,
        dataCapped: !!result.dataCapped,
        topSegments: result.topSegments || [],
        footerTip: `共 ${result.totalMatched || 0} / ${result.totalLoaded || 0} 位 · ${tip}`
      });
    } catch (e) {
      this.setData({ loading: false, list: [] });
      wx.showToast({ title: formatCloudFnError(e, e.msg || '加载失败'), icon: 'none' });
    }
  },

  async openDetail(e) {
    const openid = String((e.currentTarget.dataset && e.currentTarget.dataset.openid) || '');
    const userId = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!openid && !userId) return;
    this.setData({
      showDetail: true,
      detailLoading: true,
      detail: null,
      recentOrders: [],
      tagsExpanded: false
    });
    try {
      const result = await this.callFn({ action: 'getDetail', openid, userId });
      const detail = mapDetail(result.detail);
      const recentOrders = (result.recentOrders || []).map(mapRecentOrder);
      this.setData({
        detailLoading: false,
        detail,
        recentOrders,
        tagsExpanded: false
      });
      this.syncListItemFromDetail(detail);
    } catch (err) {
      this.setData({ detailLoading: false, showDetail: false });
      wx.showToast({ title: formatCloudFnError(err, err.msg || '加载详情失败'), icon: 'none' });
    }
  },

  /** 详情为真源：回写列表头卡，消除「尚未消费 / 积分 0」与明细不一致 */
  syncListItemFromDetail(detail) {
    if (!detail) return;
    const list = (this.data.list || []).slice();
    const idx = list.findIndex(
      (item) =>
        (detail._id && item._id === detail._id) ||
        (detail.openid && item.openid === detail.openid)
    );
    if (idx < 0) return;
    list[idx] = mapListItem({
      ...list[idx],
      ...detail,
      points: detail.availablePoints != null ? detail.availablePoints : detail.points,
      availablePoints: detail.availablePoints != null ? detail.availablePoints : detail.points,
      createTime: detail.createTime,
      segmentMeta: detail.segmentMeta || list[idx].segmentMeta
    });
    this.setData({ list });
  },

  closeDetail() {
    this.setData({
      showDetail: false,
      detail: null,
      recentOrders: [],
      showAdjust: false,
      tagsExpanded: false
    });
  },

  toggleTagsExpand() {
    const detail = this.data.detail;
    if (!detail) return;
    const expanded = !this.data.tagsExpanded;
    const allTags = detail.allTags || [];
    this.setData({
      tagsExpanded: expanded,
      'detail.tagsExpanded': expanded,
      'detail.visibleTags': expanded ? allTags : allTags.slice(0, TAG_PREVIEW_LIMIT)
    });
  },

  openOrderDetail(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    wx.navigateTo({
      url: `${ORDER_DETAIL_PATH}?id=${encodeURIComponent(id)}`,
      fail: () => {
        wx.showToast({ title: '无法打开订单详情', icon: 'none' });
      }
    });
  },

  onCopyOpenid(e) {
    const openid = String((e.currentTarget.dataset && e.currentTarget.dataset.openid) || '');
    if (!openid) return;
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: '已复制 OpenID', icon: 'none' })
    });
  },

  onCopyPhone(e) {
    const phone = String((e.currentTarget.dataset && e.currentTarget.dataset.phone) || '');
    if (!phone) return;
    wx.setClipboardData({
      data: phone,
      success: () => {
        try {
          wx.vibrateShort({ type: 'light' });
        } catch (err) {
          /* 部分基础库不支持 */
        }
        wx.showToast({ title: '已复制手机号', icon: 'none' });
      }
    });
  },

  openYouxinFromCard(e) {
    const idx = Number((e.currentTarget.dataset && e.currentTarget.dataset.index) ?? -1);
    const fromList = idx >= 0 && this.data.list[idx] ? this.data.list[idx] : null;
    const openid = String(
      (e.currentTarget.dataset && e.currentTarget.dataset.openid) ||
        (fromList && fromList.openid) ||
        ''
    );
    const member =
      fromList ||
      (this.data.detail && this.data.detail.openid === openid ? this.data.detail : null);
    if (!member || !openid) return;
    const segmentKey = String(member.segment || 'never_purchased');
    const campaignType = inferCampaignType(segmentKey);
    this.setData({
      showYouxin: true,
      youxinTarget: member,
      youxinCampaignType: campaignType,
      youxinTitle: '',
      youxinContent: '',
      youxinAiLoading: false,
      youxinSending: false
    });
    this.generateYouxinCopyForMember(member, campaignType);
  },

  closeYouxin() {
    this.setData({
      showYouxin: false,
      youxinTarget: null,
      youxinTitle: '',
      youxinContent: '',
      youxinAiLoading: false,
      youxinSending: false
    });
  },

  onYouxinTitleInput(e) {
    this.setData({ youxinTitle: String((e.detail && e.detail.value) || '') });
  },

  onYouxinContentInput(e) {
    this.setData({ youxinContent: String((e.detail && e.detail.value) || '') });
  },

  async generateYouxinCopyForMember(member, campaignTypeOverride) {
    if (!member) return;
    const segmentKey = String(member.segment || 'never_purchased');
    const campaignType = campaignTypeOverride || inferCampaignType(segmentKey);
    const portraitHint = buildPortraitHint(member);
    this.setData({ youxinAiLoading: true, youxinCampaignType: campaignType });
    wx.showLoading({ title: '撰写中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'assistYouxinCopy',
        data: {
          campaignType,
          segment: segmentKey,
          offerHint: '',
          portraitHint
        }
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (!r.success) {
        const msg = r.code === 'FORBIDDEN' || /权限|FORBIDDEN/i.test(String(r.msg || ''))
          ? '无有信权限'
          : r.msg || '撰写失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      this.setData({
        youxinTitle: r.title || '',
        youxinContent: r.content || ''
      });
      wx.showToast({ title: '已生成，可编辑', icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: 'AI 不可用', icon: 'none' });
    } finally {
      this.setData({ youxinAiLoading: false });
    }
  },

  retryYouxinAi() {
    if (this.data.youxinAiLoading || !this.data.youxinTarget) return;
    this.generateYouxinCopyForMember(this.data.youxinTarget, this.data.youxinCampaignType);
  },

  async submitYouxinPush() {
    if (this.data.youxinSending || !this.data.youxinTarget) return;
    const title = String(this.data.youxinTitle || '').trim();
    const content = String(this.data.youxinContent || '').trim();
    const targetOpenid = String(this.data.youxinTarget.openid || '').trim();
    if (!title || !content) {
      wx.showToast({ title: '请填写标题和正文', icon: 'none' });
      return;
    }
    if (!targetOpenid) {
      wx.showToast({ title: '缺少接收用户', icon: 'none' });
      return;
    }
    this.setData({ youxinSending: true });
    wx.showLoading({ title: '发送中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'pushMessage',
        data: {
          action: 'send',
          title,
          content,
          category: 'activity',
          actionUrl: '',
          scope: 'single',
          targetOpenid,
          campaignType: this.data.youxinCampaignType,
          segment: String(this.data.youxinTarget.segment || '')
        }
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (!r.success) {
        const msg = r.code === 'FORBIDDEN' || /权限|FORBIDDEN/i.test(String(r.msg || ''))
          ? '无有信权限'
          : r.msg || '发送失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      wx.showToast({ title: '已发往山海有信', icon: 'none' });
      this.closeYouxin();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      this.setData({ youxinSending: false });
    }
  },

  openAdjust() {
    if (!this.data.detail) return;
    this.setData({ showAdjust: true, adjustAmount: '' });
  },

  closeAdjust() {
    this.setData({ showAdjust: false, adjustAmount: '' });
  },

  onAdjustInput(e) {
    this.setData({ adjustAmount: String((e.detail && e.detail.value) || '') });
  },

  async submitAdjust() {
    if (this.data.adjustSubmitting || !this.data.detail) return;
    const amount = parseInt(this.data.adjustAmount, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      wx.showToast({ title: '请输入非零整数', icon: 'none' });
      return;
    }
    this.setData({ adjustSubmitting: true });
    try {
      const result = await this.callFn({
        action: 'adjustPoints',
        openid: this.data.detail.openid,
        userId: this.data.detail._id,
        amount
      });
      wx.showToast({ title: result.msg || '已调整', icon: 'success' });
      const after = Number(result.afterAvailable) || 0;
      this.setData({
        adjustSubmitting: false,
        showAdjust: false,
        adjustAmount: '',
        'detail.availablePoints': after,
        'detail.points': after,
        'detail.pointsDisplay': String(after),
        'detail.heroPointsText': String(after)
      });
      if (this.data.detail) {
        this.syncListItemFromDetail({
          ...this.data.detail,
          availablePoints: after,
          points: after
        });
      }
      this.loadList();
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (e) {
      this.setData({ adjustSubmitting: false });
      wx.showToast({ title: formatCloudFnError(e, e.msg || '调整失败'), icon: 'none' });
    }
  },

  stopBubble() {}
});
