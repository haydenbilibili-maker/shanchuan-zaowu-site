/**
 * 发票管理（店长）— 一期半自动开票申请处理
 * 列表 / 详情 / 标记已开具 / 驳回
 */
const { guardStaffPage } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');

const STATUS_OPTIONS = ['全部', '待开具', '已开具', '已驳回'];
const STATUS_VALUES = ['', 'pending', 'issued', 'rejected'];
const STATUS_TEXT = {
  pending: '待开具',
  issued: '已开具',
  rejected: '已驳回'
};

const OVERVIEW_TABS = [
  { key: 'pending', label: '待办' },
  { key: 'status', label: '状态' },
  { key: 'type', label: '类型' }
];

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function mapItem(row) {
  return {
    ...row,
    timeText: formatTime(row.createTime),
    handledText: formatTime(row.handledAt),
    statusText: STATUS_TEXT[row.status] || row.statusLabel || row.status
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
  const status = result.status || {};
  const type = result.type || {};
  return {
    definitions: result.definitions || {},
    dataCapped: !!result.dataCapped,
    totalLoaded: result.totalLoaded || 0,
    fetchCap: result.fetchCap || 500,
    pending: {
      count: pending.count || 0,
      company: pending.company || 0,
      personal: pending.personal || 0,
      typeBars: (pending.typeBars || []).map(mapBar)
    },
    status: {
      total: status.total || 0,
      pending: status.pending || 0,
      issued: status.issued || 0,
      rejected: status.rejected || 0,
      bars: (status.bars || []).map(mapBar)
    },
    type: {
      bars: (type.bars || []).map(mapBar)
    }
  };
}

function overviewHintFor(overview, tab) {
  if (!overview) return '';
  let hint = '';
  if (tab === 'pending') hint = (overview.definitions && overview.definitions.pending) || '';
  else if (tab === 'status') hint = (overview.definitions && overview.definitions.status) || '';
  else hint = (overview.definitions && overview.definitions.type) || '';
  if (overview.dataCapped) hint = `${hint} · 采样达上限 ${overview.fetchCap}`;
  return hint;
}

Page({
  data: {
    ready: false,
    list: [],
    loading: false,
    listError: false,
    tipTone: 'info',
    tipText: '',
    formTip: '',
    page: 1,
    hasMore: false,
    total: 0,
    statusOptions: STATUS_OPTIONS,
    statusValues: STATUS_VALUES,
    statusIndex: 1,
    filterStatus: 'pending',

    expandedId: '',

    overviewTabs: OVERVIEW_TABS,
    overviewTab: 'pending',
    overviewTabPending: true,
    overviewTabStatus: false,
    overviewTabType: false,
    overviewLoading: false,
    overviewReady: false,
    overview: null,
    overviewHint: '',

    showIssueModal: false,
    showRejectModal: false,
    actionTarget: null,
    invoiceNo: '',
    staffNote: '',
    rejectReason: '',
    submitting: false
  },

  async onLoad() {
    const role = await guardStaffPage('manager');
    if (!role) return;
    this.setData({ ready: true });
    this.loadList(true);
    this.ensureOverview();
  },

  onPullDownRefresh() {
    const tasks = [this.loadList(true)];
    if (this.data.overviewReady || this.data.overviewLoading) {
      tasks.push(this.loadOverview(true));
    }
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
  },

  switchOverviewTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'pending');
    if (!OVERVIEW_TABS.some((t) => t.key === key)) return;
    if (this.data.overviewTab !== key) {
      this.setData({
        overviewTab: key,
        overviewTabPending: key === 'pending',
        overviewTabStatus: key === 'status',
        overviewTabType: key === 'type',
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
      const res = await wx.cloud.callFunction({
        name: 'manageInvoiceRequests',
        data: { action: 'overview' }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          overviewLoading: false,
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '概览加载失败')
        });
        return;
      }
      const overview = mapOverview(result);
      this.setData({
        overviewLoading: false,
        overviewReady: true,
        overview,
        overviewHint: overviewHintFor(overview, this.data.overviewTab)
      });
    } catch (e) {
      this.setData({
        overviewLoading: false,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '概览加载失败')
      });
    }
  },

  onStatusChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    this.setData({
      statusIndex: index,
      filterStatus: this.data.statusValues[index]
    });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({
      loading: true,
      listError: false,
      tipText: reset ? '' : this.data.tipText
    });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageInvoiceRequests',
        data: {
          action: 'list',
          status: this.data.filterStatus,
          page,
          pageSize: 20
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          loading: false,
          listError: true,
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '加载失败')
        });
        return;
      }
      const list = (result.list || []).map(mapItem);
      this.setData({
        loading: false,
        listError: false,
        page,
        hasMore: !!result.hasMore,
        total: result.total || 0,
        list: reset ? list : this.data.list.concat(list)
      });
    } catch (e) {
      this.setData({
        loading: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '加载失败')
      });
    }
  },

  onRetryList() {
    this.loadList(true);
  },

  loadMore() {
    if (this.data.hasMore) this.loadList(false);
  },

  toggleExpand(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  findItem(id) {
    return (this.data.list || []).find((row) => row._id === id) || null;
  },

  openIssue(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    const item = this.findItem(id);
    if (!item || item.status !== 'pending') return;
    this.setData({
      showIssueModal: true,
      actionTarget: item,
      invoiceNo: '',
      staffNote: '',
      formTip: ''
    });
  },

  openReject(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    const item = this.findItem(id);
    if (!item || item.status !== 'pending') return;
    this.setData({
      showRejectModal: true,
      actionTarget: item,
      rejectReason: '',
      formTip: ''
    });
  },

  closeModals() {
    this.setData({
      showIssueModal: false,
      showRejectModal: false,
      actionTarget: null,
      submitting: false
    });
  },

  onInvoiceNoInput(e) {
    this.setData({ invoiceNo: e.detail.value });
  },

  onStaffNoteInput(e) {
    this.setData({ staffNote: e.detail.value });
  },

  onRejectReasonInput(e) {
    this.setData({ rejectReason: e.detail.value });
  },

  async confirmIssue() {
    if (this.data.submitting || !this.data.actionTarget) return;
    this.setData({ submitting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageInvoiceRequests',
        data: {
          action: 'markIssued',
          id: this.data.actionTarget._id,
          invoiceNo: this.data.invoiceNo,
          staffNote: this.data.staffNote
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          submitting: false,
          formTip: formatCloudFnError(result, result.msg || '操作失败')
        });
        return;
      }
      this.closeModals();
      this.setData({
        tipTone: 'info',
        tipText: result.pendingApproval ? (result.msg || '已提交超管审核') : '已标记开具'
      });
      this.loadList(true);
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (e) {
      this.setData({
        submitting: false,
        formTip: formatCloudFnError(e, '操作失败')
      });
    }
  },

  async confirmReject() {
    if (this.data.submitting || !this.data.actionTarget) return;
    const reason = String(this.data.rejectReason || '').trim();
    if (!reason) {
      this.setData({ formTip: '请填写驳回原因' });
      return;
    }
    this.setData({ submitting: true, formTip: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageInvoiceRequests',
        data: {
          action: 'reject',
          id: this.data.actionTarget._id,
          rejectReason: reason
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          submitting: false,
          formTip: formatCloudFnError(result, result.msg || '操作失败')
        });
        return;
      }
      this.closeModals();
      this.setData({ tipTone: 'info', tipText: '已驳回' });
      this.loadList(true);
      if (this.data.overviewReady) this.loadOverview(true);
    } catch (e) {
      this.setData({
        submitting: false,
        formTip: formatCloudFnError(e, '操作失败')
      });
    }
  },

  copyText(e) {
    const text = String((e.currentTarget.dataset && e.currentTarget.dataset.text) || '');
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => this.setData({ tipTone: 'info', tipText: '已复制' })
    });
  },

  noop() {}
});
