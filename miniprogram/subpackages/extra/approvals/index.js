/**
 * 统一审批中心
 * 审核区：积分流水 → 小票认领 → 外部订单
 * 待我审 / 已办 / 我发起的；SLA；详情展开；敏感驳回必填
 */
const { guardStaffPage } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog');
const { displayStoreName } = require('../../../utils/storeName');
const { getPreferredStoreId } = require('../../../utils/storeHelper');
const { reasonsFor, composeReason } = require('./rejectReasons');
const {
  REVOKE_REASONS,
  PURCHASE_STATUS_TEXT,
  IDENTIFY_METHOD_TEXT
} = require('../utils/storePoints');

const STATUS_OPTIONS_INBOX = ['待审核'];
const STATUS_VALUES_INBOX = ['pending'];
const STATUS_OPTIONS_DONE = ['全部', '已通过', '已驳回'];
const STATUS_VALUES_DONE = ['all', 'approved', 'rejected'];
const STATUS_OPTIONS_MINE = ['全部', '待审核', '已通过', '已驳回'];
const STATUS_VALUES_MINE = ['all', 'pending', 'approved', 'rejected'];

/** 审核区快捷入口（顺序固定） */
const AUDIT_HUB = [
  { key: 'flow', label: '积分流水' },
  { key: 'receipt', label: '小票认领', actionType: 'points_receipt_claim' },
  { key: 'bind', label: '外部订单', actionType: 'points_platform_bind' }
];

const TYPE_OPTIONS = [
  '全部类型', '积分赠分', '小票认领', '外部订单', '积分撤销', '藏品上架',
  '订单退款', '敏感发货', '发票开具', '核销冲正', '积分规则'
];
const TYPE_VALUES = [
  '',
  'points_store_grant',
  'points_receipt_claim',
  'points_platform_bind',
  'points_store_revoke',
  'product_shelf_on',
  'order_refund',
  'order_ship_sensitive',
  'invoice_issue',
  'booking_verify_reverse',
  'store_point_rules'
];

function typeIndexForAction(actionType) {
  const idx = TYPE_VALUES.indexOf(String(actionType || ''));
  return idx >= 0 ? idx : 0;
}

function formatFlowTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消'
};

const OVERVIEW_TABS = [
  { key: 'pending', label: '待办' },
  { key: 'byType', label: '类型' },
  { key: 'throughput', label: '吞吐' }
];

const SENSITIVE_TYPES = {
  product_shelf_on: true,
  order_refund: true,
  order_ship_sensitive: true,
  invoice_issue: true,
  booking_verify_reverse: true,
  store_point_rules: true,
  points_store_revoke: true
};

function formatTime(value) {
  if (!value) return '';
  const d = new Date(typeof value === 'number' ? value : value);
  if (Number.isNaN(d.getTime()) && value) {
    const ms = value.createTimeMs || Date.parse(value);
    if (Number.isFinite(ms)) return formatTime(new Date(ms));
    return '';
  }
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

function payloadLines(row) {
  const p = row.payload || {};
  const lines = [];
  if (p.price != null) lines.push(`标价 ¥${p.price}`);
  if (p.refund != null) lines.push(`退款 ¥${p.refund}${p.deduct > 0 ? `（扣损 ¥${p.deduct}）` : ''}`);
  if (p.trackingNumber) lines.push(`${p.carrier || '快递'} ${p.trackingNumber}`);
  if (p.totalPrice != null && row.actionType === 'order_ship_sensitive') {
    lines.push(`订单金额 ¥${p.totalPrice}`);
  }
  if (p.invoiceNo) lines.push(`发票号 ${p.invoiceNo}`);
  if (p.revokeAmount != null) lines.push(`撤销 ${p.revokeAmount} 分`);
  if (p.revokeReason) lines.push(`原因 ${p.revokeReason}`);
  if (p.amount != null && !p.refund) lines.push(`金额 ¥${p.amount}`);
  if (p.orderNo) lines.push(`单号 ${p.orderNo}`);
  if (p.title && row.actionType === 'product_shelf_on') lines.push(String(p.title));
  return lines.slice(0, 6);
}

/** 申请人 · 审级 · 时间 合成一行 */
function buildMetaLine(row, timeText) {
  const parts = [];
  const name = String(row.applicantName || row.applicantRole || '').trim();
  if (name) parts.push(name);
  if (row.approverLabel) parts.push(`${row.approverLabel}审`);
  if (timeText) parts.push(timeText);
  return parts.join(' · ');
}

/** 已办办理人：无姓名时用「本人」，无时间则整段隐藏 */
function buildDecidedLine(row, decidedText) {
  if (!decidedText) return '';
  const name = String(row.decidedByName || '').trim();
  return name ? `${name} · ${decidedText}` : `本人 · ${decidedText}`;
}

function mapItem(row) {
  const ms = row.createTimeMs || row.createTime;
  const decidedMs = row.decidedAtMs || row.decidedAt;
  const requireReason = row.requireRejectReason || !!SENSITIVE_TYPES[row.actionType];
  const timeText = formatTime(ms);
  const decidedText = decidedMs ? formatTime(decidedMs) : '';
  let overdueText = '';
  if (row.overdue) {
    overdueText = `已超时 ${row.ageHours || ''}h`;
  } else if (row.status === 'pending' && row.slaLeftHours != null) {
    overdueText = `剩余 ${row.slaLeftHours}h`;
  }
  const attachmentImages = Array.isArray(row.attachmentImages)
    ? row.attachmentImages.filter(Boolean)
    : [];
  const isReceiptClaim = row.actionType === 'points_receipt_claim';
  const isStoreGrant = row.actionType === 'points_store_grant';
  const showAttachmentBlock = isReceiptClaim || isStoreGrant || attachmentImages.length > 0;
  return {
    ...row,
    timeText,
    decidedText,
    metaLine: buildMetaLine(row, timeText),
    decidedLine: buildDecidedLine(row, decidedText),
    statusText: STATUS_TEXT[row.status] || row.status,
    actionLabel: row.actionLabel || row.actionType || '',
    overdueText,
    requireRejectReason: requireReason,
    detailLines: payloadLines(row),
    canNudge: row.status === 'pending',
    isRejected: row.status === 'rejected',
    isApproved: row.status === 'approved',
    isReceiptClaim,
    canIgnore: isReceiptClaim && row.status === 'pending' && !!row.canDecide,
    attachmentImages,
    hasAttachments: attachmentImages.length > 0,
    showAttachmentBlock
  };
}

function statusConfigForMode(viewMode) {
  if (viewMode === 'done') {
    return {
      statusOptions: STATUS_OPTIONS_DONE,
      statusValues: STATUS_VALUES_DONE,
      statusIndex: 0,
      filterStatus: 'all'
    };
  }
  if (viewMode === 'mine') {
    return {
      statusOptions: STATUS_OPTIONS_MINE,
      statusValues: STATUS_VALUES_MINE,
      statusIndex: 0,
      filterStatus: 'all'
    };
  }
  return {
    statusOptions: STATUS_OPTIONS_INBOX,
    statusValues: STATUS_VALUES_INBOX,
    statusIndex: 0,
    filterStatus: 'pending'
  };
}

function mapBar(row) {
  return {
    ...row,
    barStyle: `width: ${Math.min(100, Number(row.pct) || 0)}%;`
  };
}

function mapOverview(result) {
  const pending = result.pending || {};
  const byType = result.byType || {};
  const throughput = result.throughput || {};
  return {
    definitions: result.definitions || {},
    dataCapped: !!result.dataCapped,
    totalLoaded: result.totalLoaded || 0,
    fetchCap: result.fetchCap || 500,
    slaHours: result.slaHours || 48,
    pending: {
      count: pending.count || 0,
      overdue: pending.overdue || 0,
      withinSla: pending.withinSla || 0,
      ageBars: (pending.ageBars || []).map(mapBar)
    },
    byType: {
      bars: (byType.bars || []).map(mapBar)
    },
    throughput: {
      days: throughput.days || 7,
      approved: throughput.approved || 0,
      rejected: throughput.rejected || 0,
      minePending: throughput.minePending || 0,
      bars: (throughput.bars || []).map(mapBar)
    }
  };
}

function overviewHintFor(overview, tab) {
  if (!overview) return '';
  let hint = '';
  if (tab === 'pending') hint = (overview.definitions && overview.definitions.pending) || '';
  else if (tab === 'byType') hint = (overview.definitions && overview.definitions.byType) || '';
  else hint = (overview.definitions && overview.definitions.throughput) || '';
  if (overview.dataCapped) hint = `${hint} · 采样达上限 ${overview.fetchCap}`;
  return hint;
}

/** 收起态一行摘要：待我审 / 超时 / 采样 */
function overviewSummaryFor(overview) {
  if (!overview) return '';
  const pending = overview.pending || {};
  const parts = [`待我审 ${pending.count || 0}`];
  if (pending.overdue) parts.push(`超时 ${pending.overdue}`);
  const sample = `采样 ${overview.totalLoaded || 0} 条`;
  parts.push(overview.dataCapped ? `${sample}（已截断）` : sample);
  return parts.join(' · ');
}

Page({
  data: {
    ready: false,
    loading: false,
    listError: false,
    flowError: false,
    tipTone: 'info',
    tipText: '',
    formTip: '',
    list: [],
    page: 1,
    hasMore: false,
    total: 0,
    viewMode: 'inbox',
    canDecideTabs: true,
    statusOptions: STATUS_OPTIONS_INBOX,
    statusValues: STATUS_VALUES_INBOX,
    statusIndex: 0,
    filterStatus: 'pending',
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    filterActionType: '',
    scope: '',
    scopeHint: '',
    workspaceRole: '',
    deciding: false,
    // 正在处理的那一条与动作：只用于让被点的卡显示「处理中…」，不参与任何判断
    decidingId: '',
    decidingAction: '',
    approvePendingId: '',
    ignorePendingId: '',
    slaHours: 48,
    overdueCount: 0,
    pendingBadge: 0,
    expandedId: '',
    emptyTitle: '暂无待审单据',
    emptyHint: '新的审批到达后会出现在这里',

    overviewTabs: OVERVIEW_TABS,
    overviewTab: 'pending',
    overviewTabPending: true,
    overviewTabByType: false,
    overviewTabThroughput: false,
    overviewLoading: false,
    overviewReady: false,
    overviewExpanded: false,
    overview: null,
    overviewHint: '',
    overviewSummary: '',

    // 审核区：积分流水 / 小票认领 / 外部订单
    auditHub: AUDIT_HUB,
    hubMode: '',
    hubFlow: false,
    storeNames: [],
    storeOptions: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    flowRecords: [],
    flowLoading: false,
    flowPage: 1,
    flowHasMore: false,
    flowStatusOptions: ['全部', '待审核', '已赠分', '部分撤销', '已撤销', '已驳回'],
    flowStatusValues: ['', 'pending_approval', 'granted', 'partial_revoked', 'revoked', 'rejected'],
    flowStatusIndex: 0,
    flowFilterStatus: '',
    showRevokeModal: false,
    sessionDecided: 0,
    rejectSheet: { show: false, id: '', title: '', requireReason: false, reasons: [], picked: [], note: '', preview: '', tip: '' },
    revokeTarget: null,
    revokeReasons: REVOKE_REASONS,
    revokeReasonLabels: REVOKE_REASONS.map((r) => r.label),
    revokeReasonIndex: 0,
    revokeAmount: ''
  },

  async onLoad(options) {
    const role = await guardStaffPage('staff');
    if (!role) return;
    if (!role.isManager && !role.isStaff) return;

    const isSuper = !!role.isSuperAdmin;
    const canDecideTabs = !!role.isManager;
    let viewMode = 'inbox';
    if (options && options.mine === '1') viewMode = 'mine';
    else if (options && options.done === '1') viewMode = 'done';
    if (!canDecideTabs) viewMode = 'mine';

    const statusCfg = statusConfigForMode(viewMode);
    let hubMode = String((options && options.hub) || '').trim();
    if (hubMode && !AUDIT_HUB.some((h) => h.key === hubMode)) hubMode = '';
    if (hubMode && !canDecideTabs) hubMode = '';

    let typeIndex = 0;
    let filterActionType = '';
    const typeQ = String((options && options.type) || '').trim();
    if (typeQ && TYPE_VALUES.includes(typeQ)) {
      typeIndex = typeIndexForAction(typeQ);
      filterActionType = typeQ;
    } else if (hubMode === 'receipt' || hubMode === 'bind') {
      const hub = AUDIT_HUB.find((h) => h.key === hubMode);
      filterActionType = (hub && hub.actionType) || '';
      typeIndex = typeIndexForAction(filterActionType);
    }

    this.setData({
      ready: true,
      workspaceRole: role.workspaceRole || '',
      canDecideTabs,
      viewMode,
      hubMode,
      hubFlow: hubMode === 'flow',
      typeIndex,
      filterActionType,
      ...statusCfg,
      scopeHint: isSuper
        ? '全站可见 · 上架 / 退款 / 积分等'
        : role.isManager
          ? '积分流水 · 小票 · 外部订单 · 待我审'
          : '跟踪你发起的审批进度'
    });

    if (canDecideTabs) {
      await this.ensureStoreCatalog();
      this.refreshPendingBadge();
      this.ensureOverview();
    }

    if (hubMode === 'flow') this.loadFlowRecords(true);
    else this.loadList(true);
  },

  onPullDownRefresh() {
    const tasks = [];
    if (this.data.hubFlow) {
      tasks.push(this.loadFlowRecords(true));
    } else {
      tasks.push(this.loadList(true));
    }
    if (this.data.canDecideTabs) {
      tasks.push(this.refreshPendingBadge());
      if (this.data.overviewReady || this.data.overviewLoading) {
        tasks.push(this.loadOverview(true));
      } else {
        tasks.push(this.ensureOverview());
      }
    }
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
  },

  noop() {},

  async ensureStoreCatalog() {
    if ((this.data.storeOptions || []).length) return;
    try {
      const catalog = await fetchStoreCatalog();
      const options = mapStoreOptions(catalog);
      const preferred = getPreferredStoreId();
      const index = Math.max(0, options.findIndex((s) => s.storeId === preferred));
      this.setData({
        storeOptions: options,
        storeNames: options.map((s) => s.name),
        storeIndex: index,
        storeId: (options[index] && options[index].storeId) || '',
        storeName: displayStoreName(options[index])
      });
    } catch (e) {
      console.warn('ensureStoreCatalog', e);
    }
  },

  switchHub(e) {
    if (!this.data.canDecideTabs) return;
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim();
    if (!AUDIT_HUB.some((h) => h.key === key)) return;
    const next = this.data.hubMode === key ? '' : key;
    wx.vibrateShort({ type: 'light' });

    if (next === 'flow') {
      this.setData({
        hubMode: 'flow',
        hubFlow: true,
        typeIndex: 0,
        filterActionType: ''
      });
      this.ensureStoreCatalog().then(() => this.loadFlowRecords(true));
      return;
    }

    let typeIndex = 0;
    let filterActionType = '';
    if (next === 'receipt' || next === 'bind') {
      const hub = AUDIT_HUB.find((h) => h.key === next);
      filterActionType = (hub && hub.actionType) || '';
      typeIndex = typeIndexForAction(filterActionType);
      if (this.data.viewMode !== 'inbox' && this.data.canDecideTabs) {
        const statusCfg = statusConfigForMode('inbox');
        this.setData({ viewMode: 'inbox', ...statusCfg });
      }
    }

    this.setData({
      hubMode: next,
      hubFlow: false,
      typeIndex,
      filterActionType,
      expandedId: ''
    });
    this.loadList(true);
    if (!this.data.overviewReady) this.ensureOverview();
  },

  onFlowStoreChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    const store = this.data.storeOptions[index];
    if (!store) return;
    this.setData({
      storeIndex: index,
      storeId: store.storeId,
      storeName: displayStoreName(store)
    });
    this.loadFlowRecords(true);
  },

  onFlowStatusChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    this.setData({
      flowStatusIndex: index,
      flowFilterStatus: this.data.flowStatusValues[index] || ''
    });
    this.loadFlowRecords(true);
  },

  async loadFlowRecords(reset) {
    if (this.data.flowLoading) return;
    const page = reset ? 1 : this.data.flowPage + 1;
    this.setData({ flowLoading: true, flowError: false, tipText: reset ? '' : this.data.tipText });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: {
          action: 'listRecords',
          storeId: this.data.storeId,
          status: this.data.flowFilterStatus,
          page,
          pageSize: 20
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          flowLoading: false,
          flowError: true,
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '流水加载失败')
        });
        return;
      }
      const list = (result.list || []).map((row) => ({
        ...row,
        timeText: formatFlowTime(row.createTime),
        statusText: PURCHASE_STATUS_TEXT[row.status] || row.status,
        methodText: IDENTIFY_METHOD_TEXT[row.identifyMethod] || '',
        attachmentImages: row.attachmentImages || [],
        canRevoke: result.canRevoke
          && row.status !== 'revoked'
          && row.status !== 'pending_approval'
          && row.status !== 'rejected',
        // 待审统一走审批列表，流水页只展示 + 撤销
        pendingHint: row.status === 'pending_approval'
      }));
      this.setData({
        flowLoading: false,
        flowError: false,
        tipText: reset ? '' : this.data.tipText,
        flowPage: page,
        flowHasMore: !!result.hasMore,
        flowRecords: reset ? list : this.data.flowRecords.concat(list)
      });
    } catch (e) {
      this.setData({
        flowLoading: false,
        flowError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '流水加载失败')
      });
    }
  },

  loadMoreFlow() {
    if (this.data.flowHasMore) this.loadFlowRecords(false);
  },

  previewFlowImages(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const item = (this.data.flowRecords || []).find((row) => row._id === id);
    const urls = (item && item.attachmentImages) || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[0], urls });
  },

  openRevoke(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const item = (this.data.flowRecords || []).find((row) => row._id === id);
    if (!item) return;
    const remain = Math.round((Number(item.amount) - Number(item.revokedAmount || 0)) * 100) / 100;
    this.setData({
      showRevokeModal: true,
      revokeTarget: { ...item, remainAmount: remain },
      revokeReasonIndex: 0,
      revokeAmount: String(remain),
      formTip: ''
    });
  },

  closeRevoke() {
    this.setData({ showRevokeModal: false, revokeTarget: null });
  },

  onRevokeReasonTap(e) {
    const index = parseInt(e.currentTarget.dataset.idx, 10);
    if (Number.isNaN(index)) return;
    this.setData({ revokeReasonIndex: index });
  },

  onRevokeAmountInput(e) {
    this.setData({ revokeAmount: e.detail.value });
  },

  async confirmRevoke() {
    const target = this.data.revokeTarget;
    if (!target) return;
    const amount = Number(this.data.revokeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.setData({ formTip: '请输入撤销金额' });
      return;
    }
    const reason = this.data.revokeReasons[this.data.revokeReasonIndex];
    this.setData({ formTip: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: {
          action: 'revoke',
          purchaseId: target._id,
          revokeReason: reason.value,
          revokeAmount: amount
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          formTip: formatCloudFnError(result, result.msg || '请稍后重试')
        });
        return;
      }
      this.closeRevoke();
      this.setData({ tipTone: 'info', tipText: result.msg || '已撤销' });
      this.loadFlowRecords(true);
      this.refreshPendingBadge();
    } catch (e) {
      this.setData({ formTip: formatCloudFnError(e, '撤销失败') });
    }
  },

  jumpPendingGrant() {
    this.setData({
      hubMode: '',
      hubFlow: false,
      viewMode: 'inbox',
      typeIndex: typeIndexForAction('points_store_grant'),
      filterActionType: 'points_store_grant',
      ...statusConfigForMode('inbox')
    });
    this.loadList(true);
  },

  switchOverviewTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'pending');
    if (!OVERVIEW_TABS.some((t) => t.key === key)) return;
    if (this.data.overviewTab !== key) {
      this.setData({
        overviewTab: key,
        overviewTabPending: key === 'pending',
        overviewTabByType: key === 'byType',
        overviewTabThroughput: key === 'throughput',
        overviewHint: overviewHintFor(this.data.overview, key)
      });
    }
    this.ensureOverview();
  },

  ensureOverview() {
    if (!this.data.canDecideTabs) return;
    if (this.data.overviewReady || this.data.overviewLoading) return;
    this.loadOverview(false);
  },

  toggleOverview() {
    const next = !this.data.overviewExpanded;
    this.setData({ overviewExpanded: next });
    if (next) this.ensureOverview();
  },

  onRefreshOverview() {
    this.loadOverview(true);
  },

  async loadOverview(force) {
    if (!this.data.canDecideTabs) return;
    if (this.data.overviewLoading) return;
    if (this.data.overviewReady && !force) return;
    this.setData({ overviewLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'overview' }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          overviewLoading: false,
          tipTone: 'warn',
          tipText: result.msg || '概览加载失败'
        });
        return;
      }
      const overview = mapOverview(result);
      this.setData({
        overviewLoading: false,
        overviewReady: true,
        overview,
        overviewHint: overviewHintFor(overview, this.data.overviewTab),
        overviewSummary: overviewSummaryFor(overview),
        pendingBadge: overview.pending.count || this.data.pendingBadge
      });
    } catch (e) {
      this.setData({
        overviewLoading: false,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '概览加载失败')
      });
    }
  },

  async refreshPendingBadge() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'countPending' }
      });
      const result = (res && res.result) || {};
      if (result.success) {
        this.setData({ pendingBadge: result.count || 0 });
      }
    } catch (e) { /* ignore */ }
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.viewMode) return;
    if ((mode === 'inbox' || mode === 'done') && !this.data.canDecideTabs) return;
    const statusCfg = statusConfigForMode(mode);
    const prevHub = this.data.hubMode;
    const clearingFlow = prevHub === 'flow';
    this.setData({
      viewMode: mode,
      page: 1,
      expandedId: '',
      hubFlow: false,
      hubMode: clearingFlow ? '' : prevHub,
      ...(clearingFlow ? { typeIndex: 0, filterActionType: '' } : {}),
      ...statusCfg
    });
    this.loadList(true);
  },

  onStatusChange(e) {
    const idx = Number(e.detail.value) || 0;
    const values = this.data.statusValues || [];
    this.setData({
      statusIndex: idx,
      filterStatus: values[idx] || 'all'
    });
    this.loadList(true);
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value) || 0;
    const actionType = TYPE_VALUES[idx] || '';
    let hubMode = '';
    if (actionType === 'points_receipt_claim') hubMode = 'receipt';
    else if (actionType === 'points_platform_bind') hubMode = 'bind';
    this.setData({
      typeIndex: idx,
      filterActionType: actionType,
      hubMode,
      hubFlow: false
    });
    this.loadList(true);
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  previewAttachment(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const current = String((e.currentTarget.dataset && e.currentTarget.dataset.url) || '').trim();
    if (!id) return;
    const item = (this.data.list || []).find((row) => row._id === id);
    const urls = (item && item.attachmentImages) || [];
    if (!urls.length) return;
    wx.previewImage({
      current: current || urls[0],
      urls
    });
  },

  emptyCopy(viewMode, filterStatus) {
    const isSuper = this.data.workspaceRole === 'super_admin';
    if (viewMode === 'inbox') {
      return {
        emptyTitle: '暂无待审单据',
        emptyHint: isSuper
          ? '全站待审会出现在这里（含积分、小票、外部订单、上架退款等）'
          : '积分赠分、小票认领、外部订单、上架退款等会出现在这里'
      };
    }
    if (viewMode === 'done') {
      return {
        emptyTitle: isSuper ? '暂无已办结记录' : '暂无已办记录',
        emptyHint: isSuper
          ? '全站通过或驳回的单据会沉淀在此'
          : '你通过或驳回的单据会沉淀在此'
      };
    }
    if (filterStatus === 'pending') {
      return {
        emptyTitle: '暂无待审申请',
        emptyHint: '发起赠分、冲正、开票等后可在此跟踪'
      };
    }
    return {
      emptyTitle: '暂无我发起的单据',
      emptyHint: '你提交的审批进度与结果会出现在这里'
    };
  },

  async loadList(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({
      loading: true,
      listError: false,
      tipText: reset ? '' : this.data.tipText,
      approvePendingId: '',
      ignorePendingId: ''
    });
    const mode = this.data.viewMode;
    const action = mode === 'mine'
      ? 'listMine'
      : (mode === 'done' ? 'listDecided' : 'listPending');
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: {
          action,
          status: this.data.filterStatus,
          actionType: this.data.filterActionType || undefined,
          page,
          pageSize: 20
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          listError: true,
          tipTone: 'warn',
          tipText: result.msg || '加载失败'
        });
        return;
      }
      const rows = (result.list || []).map(mapItem);
      const empty = this.emptyCopy(mode, this.data.filterStatus);
      this.setData({
        listError: false,
        list: reset ? rows : this.data.list.concat(rows),
        page: page + 1,
        hasMore: !!result.hasMore,
        total: result.total || 0,
        scope: result.scope || '',
        slaHours: result.slaHours || 48,
        overdueCount: result.overdueCount || 0,
        ...empty
      });
      if (mode === 'inbox' && reset) {
        this.setData({ pendingBadge: result.total || 0 });
      }
    } catch (err) {
      this.setData({
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(err, '加载失败')
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadList(false);
  },

  onRetryList() {
    this.loadList(true);
  },

  onRetryFlow() {
    this.loadFlowRecords(true);
  },

  async approveItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.deciding) return;
    if (this.data.approvePendingId !== id) {
      this.setData({
        approvePendingId: id,
        ignorePendingId: '',
        tipTone: 'warn',
        tipText: '再点一次「通过」将执行原业务写入（上架 / 退款 / 发积分等）'
      });
      return;
    }

    this.setData({ deciding: true, decidingId: id, decidingAction: 'approve', approvePendingId: '', tipTone: 'info', tipText: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'approve', approvalId: id }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ tipTone: 'warn', tipText: result.msg || '通过失败' });
        return;
      }
      this.setData({ expandedId: '', sessionDecided: this.data.sessionDecided + 1, tipTone: 'info', tipText: result.msg || '已通过' });
      this.loadList(true);
      this.refreshPendingBadge();
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '通过失败') });
    } finally {
      this.setData({ deciding: false, decidingId: '', decidingAction: '' });
    }
  },

  // 驳回：自绘面板（常用原因快选 + 补充说明），取代系统 editable 弹窗；提交口径不变（rejectReason 字符串）
  rejectItem(e) {
    const id = e.currentTarget.dataset.id;
    const requireReason = !!(e.currentTarget.dataset.require === '1' || e.currentTarget.dataset.require === true);
    if (!id || this.data.deciding) return;
    const item = (this.data.list || []).find((row) => row._id === id) || {};
    this.setData({
      approvePendingId: '',
      ignorePendingId: '',
      rejectSheet: {
        show: true,
        id,
        title: item.title || item.actionLabel || '',
        typeLabel: item.actionLabel || '',
        requireReason,
        reasons: reasonsFor(item.actionType).map((label) => ({ label, on: false })),
        picked: [],
        note: '',
        preview: '',
        tip: ''
      }
    });
  },

  closeRejectSheet() {
    this.setData({ 'rejectSheet.show': false });
  },

  onRejectReasonTap(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const sheet = this.data.rejectSheet;
    const target = sheet.reasons[idx];
    if (!target) return;
    const picked = target.on ? sheet.picked.filter((label) => label !== target.label) : sheet.picked.concat(target.label);
    this.setData({
      [`rejectSheet.reasons[${idx}].on`]: !target.on,
      'rejectSheet.picked': picked,
      'rejectSheet.preview': composeReason(picked, sheet.note),
      'rejectSheet.tip': ''
    });
  },

  onRejectNoteInput(e) {
    const note = e.detail.value;
    this.setData({
      'rejectSheet.note': note,
      'rejectSheet.preview': composeReason(this.data.rejectSheet.picked, note),
      'rejectSheet.tip': ''
    });
  },

  confirmReject() {
    const sheet = this.data.rejectSheet;
    if (!sheet.show || this.data.deciding) return;
    const reason = composeReason(sheet.picked, sheet.note);
    if (sheet.requireReason && reason.length < 2) {
      this.setData({ 'rejectSheet.tip': '这类审批需写明驳回原因：点选一条常用原因，或补充至少 2 个字' });
      return;
    }
    this.setData({ 'rejectSheet.show': false });
    this.submitReject(sheet.id, reason);
  },

  async submitReject(id, reason) {
    this.setData({ deciding: true, decidingId: id, decidingAction: 'reject', tipTone: 'info', tipText: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: {
          action: 'reject',
          approvalId: id,
          rejectReason: reason || '已驳回'
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ tipTone: 'warn', tipText: result.msg || '驳回失败' });
        return;
      }
      this.setData({ expandedId: '', sessionDecided: this.data.sessionDecided + 1, tipTone: 'info', tipText: '已驳回' });
      this.loadList(true);
      this.refreshPendingBadge();
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '驳回失败') });
    } finally {
      this.setData({ deciding: false, decidingId: '', decidingAction: '' });
    }
  },

  async ignoreItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.deciding) return;
    if (this.data.ignorePendingId !== id) {
      this.setData({
        ignorePendingId: id,
        approvePendingId: '',
        tipTone: 'warn',
        tipText: '再点一次「忽略」：不入账并关掉该小票申请'
      });
      return;
    }

    this.setData({ deciding: true, decidingId: id, decidingAction: 'ignore', ignorePendingId: '', tipTone: 'info', tipText: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'ignore', approvalId: id }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ tipTone: 'warn', tipText: result.msg || '忽略失败' });
        return;
      }
      this.setData({ expandedId: '', sessionDecided: this.data.sessionDecided + 1, tipTone: 'info', tipText: result.msg || '已忽略' });
      this.loadList(true);
      this.refreshPendingBadge();
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '忽略失败') });
    } finally {
      this.setData({ deciding: false, decidingId: '', decidingAction: '' });
    }
  },

  async nudgeItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.deciding) return;
    this.setData({ deciding: true, decidingId: id, decidingAction: 'nudge', tipTone: 'info', tipText: '催办中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'nudge', approvalId: id }
      });
      const result = (res && res.result) || {};
      this.setData({
        tipTone: result.success ? 'info' : 'warn',
        tipText: result.msg || (result.success ? '已催办' : '催办失败')
      });
      if (result.success) this.loadList(true);
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '催办失败') });
    } finally {
      this.setData({ deciding: false, decidingId: '', decidingAction: '' });
    }
  }
});
