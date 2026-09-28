// pages/booking/index.js
const app = getApp();
const db = wx.cloud.database();
const { buildPreviewSummary, buildDraftTitle } = require('../utils/customHelper');
const { buildSummaryLines } = require('../utils/petMemorialHelper');
const { findStore, getPreferredStoreId, getWorkshopStore, enrichStore } = require('../../../utils/storeHelper');
const { trackBehavior } = require('../../../utils/trackBehavior');
const { withAppModal } = require('../../../utils/appModal');
const { drawMemberQr } = require('../utils/qrCanvas');
const { todayKey, isActivityExpired } = require('../../../utils/activityExpiry');
const { requestBookingSubscribe } = require('../utils/bookingSubscribe');

const BOOKING_TYPE_CN = {
  museum_visit: '到店参观',
  handcraft_course: '手作课程',
  course: '手作课程',
  special_activity: '特别活动',
  pet_intake: '伴宠交接',
  custom_confirm: '定制确认'
};

/** 拆出 month / day 供票根左栏展示，与 my-bookings 的 decorateBooking 口径一致 */
function splitBookingDate(dateStr) {
  const s = String(dateStr || '');
  const matched = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (matched) {
    return { month: `${parseInt(matched[2], 10)}月`, day: String(parseInt(matched[3], 10)) };
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return { month: `${d.getMonth() + 1}月`, day: String(d.getDate()) };
  }
  return { month: '', day: '' };
}

function decorateBookingRow(item) {
  return {
    ...item,
    ...splitBookingDate(item.date),
    title: item.title || BOOKING_TYPE_CN[item.type] || '到店参观',
    _id_short: (item.ticketCode && String(item.ticketCode).trim())
      || (item._id ? String(item._id).slice(-6).toUpperCase() : '')
  };
}

Page(withAppModal({
  data: {
    statusBarHeight: 10,
    currentTab: 0, 
    bookingHistoryTab: 0, // 预约历史Tab：0-待参加，1-历史记录
    
    // 预约历史数据
    upcomingBookings: [],
    historyBookings: [],
    loadingBookings: false,
    
    // 日期时间相关
    weekDays: [],
    selectedDateIndex: 0,
    timeSlots: [],
    selectedTimeIndex: -1,
    
    // 日历视图相关
    showCalendar: false, // 是否显示日历视图
    selectedCalendarDate: '', // 日历选中的日期
    unavailableDates: [], // 不可预约的日期
    fullDates: [], // 已满的日期
    
    // 表单数据
    bookCount: 1,
    contactName: '',
    contactPhone: '',
    
    // 活动列表
    activities: [],
    courses: [],    // 手作课程
    selectedActivityId: null,  // 选中的活动/课程ID
    selectedActivityType: null, // 选中的类型：course 或 activity
    
    // 票据预览信息
    ticketYear: new Date().getFullYear(),
    ticketInfo: {
      dateStr: '--.--',
      timeStr: '--:--',
      typeStr: 'MUSEUM VISIT'
    },

    // 翻转状态
    isFlipped: false,

    // 门票铸造动画状态
    showMintModal: false,
    mintAnimation: false,
    mintFinished: false,
    newTicketCode: 'LOADING...',

    // 定制方案到店确认
    isCustomBooking: false,
    customDraftId: '',
    customPlanTitle: '',
    customPlanLines: [],

    // 伴宠遗体交接预约
    isPetIntakeBooking: false,
    petMemorialOrderId: '',
    petPlanTitle: '',
    petPlanLines: [],

    storeId: '',
    storeName: '',
    storeLocationLabel: '',
    storeVisitTips: [],
    storeLocked: false,
    storePickerOpen: false,
    storeList: []
  },

  async loadStoreCatalog(preferredStoreId) {
    const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog')
    const { displayStoreName } = require('../../../utils/storeName')
    try {
      const stores = await fetchStoreCatalog()
      const list = stores.map((s) => enrichStore(s))
      const currentId = preferredStoreId || this.data.storeId
      const store = findCatalogStore(currentId, list) || list[0]
      if (!store) {
        this.setData({ storeList: list })
        return
      }
      this.setData({
        storeList: list,
        storeId: store.storeId,
        storeName: displayStoreName(store),
        storeLocationLabel: store.locationLabel || store.floor || '',
        storeVisitTips: store.visitTips || this.data.storeVisitTips || []
      })
    } catch (e) {
      console.warn('loadStoreCatalog', e)
    }
  },

  onLoad(options) {
    const sys = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    // 与胶囊顶对齐，避免 menu.bottom + 额外 px 造成大块留白
    const headerPaddingTop = (menu && menu.top > 0)
      ? menu.top
      : (sys.statusBarHeight || 20);

    this.setData({ statusBarHeight: headerPaddingTop });

    let storeId = options.storeId || getPreferredStoreId()
    const fromWorkshop = options.from === 'pet' || options.from === 'custom'
    if (fromWorkshop && !options.storeId) {
      const workshop = getWorkshopStore()
      storeId = (workshop && workshop.storeId) || storeId
    }
    const storeLocked = fromWorkshop
    const { displayStoreName } = require('../../../utils/storeName')
    const seedStore = enrichStore(findStore(storeId))
    const patch = {
      storeId: seedStore.storeId,
      storeName: displayStoreName(seedStore),
      storeLocationLabel: seedStore.locationLabel || '',
      storeVisitTips: seedStore.visitTips || [],
      storeLocked,
      storeList: []
    }
    if (options.from === 'custom') {
      if (!options.draftId) {
        wx.showToast({ title: '定制方案缺失', icon: 'none' })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/atelier/index' }) })
        }, 1200)
      } else {
        patch.isCustomBooking = true
        patch.customDraftId = options.draftId
        patch.currentTab = 0
      }
    }
    if (options.from === 'pet') {
      if (!options.orderId) {
        wx.showToast({ title: '工单信息缺失', icon: 'none' })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/atelier/index' }) })
        }, 1200)
      } else {
        patch.isPetIntakeBooking = true
        patch.petMemorialOrderId = options.orderId
        patch.currentTab = 0
        patch.bookCount = 1
      }
    }
    this.setData(patch)
    this.loadStoreCatalog(storeId)

    const weekDays = this.initDate()
    this.loadActivities()
    this.loadBookingAvailability()
    this.loadTimeSlotsForDate(weekDays[0] && weekDays[0].fullDate)

    if (options.from === 'custom' && options.draftId) {
      this.loadCustomDraftForBooking(options.draftId)
      this.setData({ 'ticketInfo.typeStr': 'CUSTOM ATELIER' })
    }
    if (options.from === 'pet' && options.orderId) {
      this.loadPetOrderForBooking(options.orderId)
      this.setData({ 'ticketInfo.typeStr': 'PET INTAKE' })
    }

    trackBehavior('booking_page_enter', 'booking', storeId, {
      from: options.from || 'direct',
      tab: options.tab || '0'
    })

    if (options.tab) {
      const tabIndex = parseInt(options.tab, 10);
      const patchTab = { currentTab: tabIndex };
      if (options.historyTab != null && options.historyTab !== '') {
        const histIdx = parseInt(options.historyTab, 10);
        if (!isNaN(histIdx) && histIdx >= 0 && histIdx <= 1) {
          patchTab.bookingHistoryTab = histIdx;
        }
      }
      this.setData(patchTab);
      if (tabIndex === 3) {
        this.loadBookingHistory();
      }
      this.updateTicketType();
    }
    this.updateTicketDate(0);
  },

  toggleStorePicker() {
    if (this.data.storeLocked) return
    this.setData({ storePickerOpen: !this.data.storePickerOpen })
  },

  closeStorePicker() {
    this.setData({ storePickerOpen: false })
  },

  async selectBookingStore(e) {
    const storeId = e.currentTarget.dataset.id
    if (!storeId || storeId === this.data.storeId || this.data.storeLocked) {
      this.closeStorePicker()
      return
    }
    const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog')
    const { displayStoreName } = require('../../../utils/storeName')
    const stores = this.data.storeList || []
    const raw = stores.find((s) => s.storeId === storeId) || findCatalogStore(storeId, stores) || findStore(storeId)
    const store = enrichStore(raw)
    this.setData({
      storeId: store.storeId,
      storeName: displayStoreName(store),
      storeLocationLabel: store.locationLabel || '',
      storeVisitTips: store.visitTips || [],
      storePickerOpen: false,
      selectedActivityId: null,
      selectedActivityType: null
    })
    await this.loadActivities()
    await this.loadBookingAvailability()
    const day = this.data.weekDays[this.data.selectedDateIndex]
    if (day) await this.loadTimeSlotsForDate(day.fullDate)
    trackBehavior('booking_store_switch', 'store', storeId, { from: this.data.storeId })
  },

  async loadTimeSlotsForDate(dateStr) {
    if (!dateStr || !this.data.storeId) {
      this.initTimeSlots()
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBookingAvailability',
        data: {
          storeId: this.data.storeId,
          date: dateStr,
          type: this.data.isPetIntakeBooking
            ? 'pet_intake'
            : this.data.isCustomBooking
              ? 'custom_confirm'
              : 'museum_visit'
        }
      })
      const r = res.result
      if (r && r.success && r.data) {
        if (r.data.closed || r.data.dayFull) {
          this.setData({ timeSlots: [], selectedTimeIndex: -1 })
          this.updateTicketTime(-1)
          return
        }
        this.setData({
          timeSlots: (r.data.slots || []).map((s) => ({
            time: s.time,
            status: s.status,
            remain: s.remain
          })),
          selectedTimeIndex: -1
        })
        this.updateTicketTime(-1)
        return
      }
    } catch (e) {
      console.warn('loadTimeSlotsForDate', e)
    }
    this.initTimeSlots()
  },

  onShow() {
    try {
      const pending = wx.getStorageSync('bookingPendingTab');
      if (pending !== '' && pending != null && pending !== undefined) {
        wx.removeStorageSync('bookingPendingTab');
        const tabIndex = parseInt(pending, 10);
        if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex <= 3) {
          this.setData({ currentTab: tabIndex });
          this.updateTicketType(tabIndex);
        }
      }
    } catch (e) {}
    if (this.data.currentTab === 3) {
      this.loadBookingHistory();
    }
  },

  flipTicket() {
    wx.vibrateShort({ type: 'light' }); 
    this.setData({ isFlipped: !this.data.isFlipped });
  },

  async loadActivities() {
    try {
      const storeId = this.data.storeId
      let all = []
      try {
        const res = await db
          .collection('activities')
          .where({ status: 'open', storeId, date: db.command.gte(todayKey()) })
          .orderBy('date', 'asc')
          .get()
        all = res.data || []
      } catch (err) {
        const res = await db.collection('activities').where({ status: 'open', date: db.command.gte(todayKey()) }).orderBy('date', 'asc').get()
        all = (res.data || []).filter((item) => !item.storeId || item.storeId === storeId)
      }
      // 名额以 createBooking 原子扣减后的 remain 为准；maxPeople 为 0 = 不限
      all = all.filter((a) => !isActivityExpired(a)).map((a) => {
        const max = parseInt(a.maxPeople, 10) || 0
        const left = Number(a.remain)
        const full = max > 0 && Number.isFinite(left) && left <= 0
        return { ...a, _full: full, _seat: full ? '已满' : max > 0 && Number.isFinite(left) ? `余 ${left} 位` : '' }
      })
      const courses = all.filter(item => item.type === 'handcraft_course' || item.type === 'course');
      const events = all.filter(item => item.type === 'special_activity');
      
      this.setData({ courses: courses, activities: events });
    } catch (err) { console.error('加载活动失败', err); }
  },
  
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  async loadCustomDraftForBooking(draftId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'customDraft',
        data: { action: 'get', draftId }
      });
      const draft = res.result && res.result.draft;
      if (!draft || !draft.customMeta) {
        wx.showToast({ title: '定制方案不存在', icon: 'none' });
        return;
      }
      this._customMeta = draft.customMeta;
      this.setData({
        customPlanTitle: draft.title || buildDraftTitle(draft.customMeta),
        customPlanLines: buildPreviewSummary(draft.customMeta, { hidePrice: true })
      });
    } catch (e) {
      console.error('loadCustomDraftForBooking', e);
      wx.showToast({ title: '方案加载失败', icon: 'none' });
    }
  },

  async loadPetOrderForBooking(orderId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'petMemorialOrder',
        data: { action: 'get', orderId }
      });
      const order = res.result && res.result.order;
      if (!order) {
        wx.showToast({ title: '工单不存在', icon: 'none' });
        return;
      }
      const pet = order.pet || {};
      const craft = order.craft || {};
      const contact = order.contact || {};
      this.setData({
        petPlanTitle: `${pet.name || '伴宠'} · ${craft.craftName || '藏品制作'}`,
        petPlanLines: buildSummaryLines(order),
        contactName: contact.name || this.data.contactName,
        contactPhone: contact.phone || this.data.contactPhone
      });
    } catch (e) {
      console.error('loadPetOrderForBooking', e);
      wx.showToast({ title: '工单加载失败', icon: 'none' });
    }
  },

  // 🟢 1. 通用预约提交 (Tab 0)
  async submitBooking() {
    const dateObj = this.data.weekDays[this.data.selectedDateIndex];
    const dateStr = dateObj && dateObj.fullDate;
    if (dateStr && (this.data.unavailableDates || []).indexOf(dateStr) >= 0) {
      wx.showToast({ title: '该日店休，暂不可预约', icon: 'none' });
      return;
    }
    if (this.data.selectedTimeIndex === -1) return wx.showToast({ title: '请选择时间', icon: 'none' });
    const { requirePhone } = require('../../../utils/userSession');
    const phoneOk = await requirePhone(getApp(), {
      content: '授权手机号即可预约；若尚未注册，将同步领取新客礼包。',
      from: 'booking',
      returnMode: 'back',
      direct: true
    });
    if (!phoneOk) return;
    if (!this.data.contactName || !this.data.contactPhone) return wx.showToast({ title: '请完善信息', icon: 'none' });
    if (String(this.data.contactPhone || '').length < 11) return wx.showToast({ title: '手机号格式误', icon: 'none' });

    wx.vibrateShort({ type: 'heavy' }); 
    wx.showLoading({ title: '请柬制作中…', mask: true });

    try {
      const dateObj = this.data.weekDays[this.data.selectedDateIndex];
      const timeObj = this.data.timeSlots[this.data.selectedTimeIndex];
      if (!dateObj || !dateObj.fullDate || !timeObj || !timeObj.time) {
        wx.hideLoading();
        wx.showToast({ title: '请重新选择日期时段', icon: 'none' });
        return;
      }
      
      // 默认是参观预约；定制方案 / 伴宠交接
      let bookingType = 'museum_visit';
      let bookingTitle = '入店参观预约';
      if (this.data.isPetIntakeBooking) {
        bookingType = 'pet_intake';
        bookingTitle = '伴宠遗体交接';
      } else if (this.data.isCustomBooking) {
        bookingType = 'custom_confirm';
        bookingTitle = '定制方案到店确认';
      }

      const bookingData = {
        type: bookingType,
        title: bookingTitle,
        date: dateObj.fullDate,
        week: dateObj.week,
        time: timeObj.time,
        people: this.data.bookCount,
        price: 0,
        name: this.data.contactName,
        phone: this.data.contactPhone,
        storeId: this.data.storeId,
        storeName: this.data.storeName
      };

      if (this.data.isCustomBooking && this.data.customDraftId) {
        bookingData.customDraftId = this.data.customDraftId;
        bookingData.customMeta = this._customMeta || null;
      }
      if (this.data.isPetIntakeBooking && this.data.petMemorialOrderId) {
        bookingData.petMemorialOrderId = this.data.petMemorialOrderId;
      }

      const res = await wx.cloud.callFunction({ name: 'createBooking', data: bookingData });
      wx.hideLoading();

      const result = (res && res.result) || {};
      if (result.success) {
        trackBehavior('booking_submit', 'booking', result.bookingId || bookingData.date, {
          storeId: bookingData.storeId,
          type: bookingType,
          from: this.data.isPetIntakeBooking ? 'pet' : (this.data.isCustomBooking ? 'custom' : 'visit')
        });
        // 🟢 发送预约成功提醒
        this.sendBookingReminder('success', result.bookingId, bookingData);

        if (this.data.isPetIntakeBooking && this.data.petMemorialOrderId) {
          wx.showToast({ title: '交接预约成功', icon: 'success' });
          setTimeout(() => {
            wx.redirectTo({
              url: `/subpackages/feature/custom/pet/status/index?id=${this.data.petMemorialOrderId}`
            });
          }, 1200);
          return;
        }
        
        this.startMintAnimation(result.ticketCode);
        this.setData({ selectedTimeIndex: -1 });
        this.updateTicketTime(-1);
      } else {
        wx.showToast({ title: result.msg || '预约失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 🟢 2. 选择活动/课程 (Tab 1 & 2)
  selectActivity(e) {
    const { id, status, type } = e.currentTarget.dataset;
    if (status !== 'open') {
      wx.showToast({ title: status === 'full' ? '名额已满' : '该活动已关闭', icon: 'none' });
      return;
    }
    
    wx.vibrateShort({ type: 'light' });
    this.setData({ 
      selectedActivityId: id,
      selectedActivityType: type
    });
  },

  // 🟢 3. 提交活动/课程报名 (底部按钮)
  async submitActivityBooking() {
    if (!this.data.selectedActivityId) {
      wx.showToast({ title: '请选择活动或课程', icon: 'none' });
      return;
    }
    
    if (!this.data.contactName || !this.data.contactPhone) {
      wx.showToast({ title: '请完善联系信息', icon: 'none' });
      return;
    }
    
    if (this.data.contactPhone.length < 11) {
      wx.showToast({ title: '手机号格式错误', icon: 'none' });
      return;
    }

    // 查找选中的活动/课程
    const list = this.data.selectedActivityType === 'course' ? this.data.courses : this.data.activities;
    const item = list.find(i => i._id === this.data.selectedActivityId);
    
    if (!item) {
      wx.showToast({ title: '活动不存在', icon: 'none' });
      return;
    }

    if (item.status !== 'open' || item._full) {
      wx.showToast({ title: item._full ? '名额已满' : '该活动已关闭', icon: 'none' });
      return;
    }

    wx.vibrateShort({ type: 'heavy' });
    
    // 先在点击同步栈里请求「预约取消通知」订阅（拒绝也继续），再弹支付确认
    requestBookingSubscribe(() => this.modal({
      title: '确认报名',
      overline: 'CONFIRM BOOKING',
      content: `项目：${item.title}\n时间：${item.date} ${item.time || item.location}\n价格：¥${item.price}`,
      confirmText: '支付'
    }).then((res) => {
      if (res.confirm) {
        this.doBookActivity(item);
      }
    }));
  },

  // 🟢 4. 执行活动报名
  async doBookActivity(item) {
    wx.showLoading({ title: '支付处理中…' });
    
    try {
      const bookingData = {
        type: item.type || 'handcraft_course',
        title: item.title,
        date: item.date,
        week: item.week || '',
        time: item.time || '',
        people: 1,
        price: Number(item.price) || 0,
        name: this.data.contactName,
        phone: this.data.contactPhone,
        storeId: this.data.storeId,
        storeName: this.data.storeName,
        activityId: item._id
      };

      const res = await wx.cloud.callFunction({
          name: 'createBooking',
          data: bookingData
      });

      wx.hideLoading();
      const result = (res && res.result) || {};
      this.loadActivities();
      if (result.success) {
          // 🟢 发送预约成功提醒
          this.sendBookingReminder('success', result.bookingId, bookingData);
          
          // 🟢 成功：触发动画
          this.startMintAnimation(result.ticketCode);
      } else {
          wx.showToast({ title: result.msg || '报名失败', icon: 'none' });
      }
    } catch (err) { 
      wx.hideLoading(); 
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 启动动画
  startMintAnimation(code) {
    this.setData({ 
      showMintModal: true,
      newTicketCode: code,
      mintAnimation: false,
      mintFinished: false
    }, () => {
      // 本地绘制核销码，避免依赖 api.qrserver.com
      setTimeout(() => {
        drawMemberQr('#mintQrCanvas', String(code || ''), this, 120).catch(() => {});
      }, 80);
    });

    setTimeout(() => {
      this.setData({ mintAnimation: true });
      wx.vibrateLong(); 
    }, 100);

    setTimeout(() => {
      this.setData({ mintFinished: true });
      wx.vibrateShort();
    }, 2600);
  },

  goToMyBookings() {
    this.closeMintModal();
    this.setData({ currentTab: 3, bookingHistoryTab: 0 });
    this.updateTicketType(3);
    this.loadBookingHistory();
  },

  switchHistoryTab(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (isNaN(idx)) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({ bookingHistoryTab: idx });
  },

  goToBookingDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '预约信息缺失', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/ticket/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开票据', icon: 'none' })
    });
  },

  /** 预约历史（Tab 3）：confirmed 归「待参加」，其余归「历史记录」 */
  async loadBookingHistory() {
    if (this.data.loadingBookings) return;
    this.setData({ loadingBookings: true });
    try {
      const res = await db.collection('bookings')
        .orderBy('date', 'desc')
        .orderBy('time', 'asc')
        .get();

      const upcoming = [];
      const history = [];
      (res.data || []).forEach((raw) => {
        const item = decorateBookingRow(raw);
        if (item.status === 'confirmed') upcoming.push(item);
        else history.push(item);
      });

      this.setData({ upcomingBookings: upcoming, historyBookings: history });
    } catch (err) {
      console.error('加载预约历史失败', err);
      this.setData({ upcomingBookings: [], historyBookings: [] });
      wx.showToast({ title: '预约记录加载失败', icon: 'none' });
    } finally {
      this.setData({ loadingBookings: false });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) });
  },

  closeMintModal() {
    this.setData({ showMintModal: false });
  },

  initDate() {
    const days = [];
    const weekMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      const y = date.getFullYear();
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const monthEn = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getMonth()];
      days.push({ week: i === 0 ? 'TODAY' : weekMap[date.getDay()], day: d, month: monthEn, fullDate: `${y}-${m}-${d}` });
    }
    this.setData({ weekDays: days });
    return days;
  },

  initTimeSlots() {
    this.setData({
      timeSlots: [
        { time: '10:00', status: 'available', remain: 8 },
        { time: '11:00', status: 'available', remain: 8 },
        { time: '13:00', status: 'available', remain: 8 },
        { time: '14:00', status: 'available', remain: 8 },
        { time: '15:00', status: 'available', remain: 8 },
        { time: '16:00', status: 'available', remain: 8 }
      ]
    });
  },

  switchTab(e) { 
    wx.vibrateShort({ type: 'light' });
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ 
      currentTab: idx, 
      bookCount: 1, 
      selectedTimeIndex: -1,
      selectedActivityId: null,  // 切换tab时清空选中
      selectedActivityType: null
    });
    this.updateTicketType(idx);
    this.updateTicketTime(-1);
    if (idx === 3) this.loadBookingHistory();
  },

  selectDate(e) { 
    wx.vibrateShort({ type: 'light' });
    const idx = e.currentTarget.dataset.index;
    this.setData({ selectedDateIndex: idx }); 
    this.updateTicketDate(idx);
    const day = this.data.weekDays[idx]
    if (day) this.loadTimeSlotsForDate(day.fullDate)
  },

  selectTime(e) { 
    const { index, status } = e.currentTarget.dataset; 
    if (status === 'full') { wx.vibrateShort({ type: 'medium' }); return; }
    wx.vibrateShort({ type: 'light' });
    this.setData({ selectedTimeIndex: index }); 
    this.updateTicketTime(index);
  },

  changeCount(e) { 
    wx.vibrateShort({ type: 'light' });
    const type = e.currentTarget.dataset.type; 
    let count = this.data.bookCount; 
    if (type === 'minus' && count > 1) count--; 
    if (type === 'add' && count < 10) count++; 
    this.setData({ bookCount: count }); 
  },

  updateTicketDate(idx) {
    const day = this.data.weekDays[idx];
    if(day) this.setData({ 'ticketInfo.dateStr': `${day.month} ${day.day}` });
  },
  updateTicketTime(idx) {
    this.setData({ 'ticketInfo.timeStr': idx === -1 ? '--:--' : this.data.timeSlots[idx].time });
  },
  updateTicketType(tabIdx = this.data.currentTab) {
    if (this.data.isPetIntakeBooking && tabIdx === 0) {
      this.setData({ 'ticketInfo.typeStr': 'PET INTAKE' });
      return;
    }
    if (this.data.isCustomBooking && tabIdx === 0) {
      this.setData({ 'ticketInfo.typeStr': 'CUSTOM ATELIER' });
      return;
    }
    const types = ['MUSEUM VISIT', 'HANDCRAFT', 'SPECIAL EVENT'];
    this.setData({ 'ticketInfo.typeStr': types[tabIdx] || 'TICKET' });
  },

  // 🟢 切换日历视图
  toggleCalendarView() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showCalendar: !this.data.showCalendar });
  },

  // 🟢 日历选择日期
  onCalendarSelect(e) {
    const { date } = e.detail;
    this.setData({ selectedCalendarDate: date });
    
    const index = this.data.weekDays.findIndex(day => day.fullDate === date);
    if (index !== -1) {
      this.setData({ selectedDateIndex: index });
      this.updateTicketDate(index);
    }
    this.loadTimeSlotsForDate(date)
  },

  async loadBookingAvailability() {
    try {
      const storeId = this.data.storeId
      if (!storeId) return

      const unavailableDates = []
      const fullDates = []
      const today = new Date()

      for (let i = 0; i < 14; i++) {
        const date = new Date(today)
        date.setDate(today.getDate() + i)
        const dateStr = this.formatDate(date)
        try {
          const res = await wx.cloud.callFunction({
            name: 'getBookingAvailability',
            data: { storeId, date: dateStr, type: 'museum_visit' }
          })
          const d = res.result && res.result.data
          if (d && d.closed) unavailableDates.push(dateStr)
          else if (d && d.dayFull) fullDates.push(dateStr)
        } catch (e) {
          // 可用性查询失败时不默认把周末标为店休（门店全年营业）
        }
      }

      this.setData({ fullDates, unavailableDates });
    } catch (err) {
      console.error('加载预约可用性失败:', err);
    }
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 🟢 加入候补列表
  async addToWaitlist() {
    if (this.data.selectedTimeIndex === -1) {
      wx.showToast({ title: '请先选择时间段', icon: 'none' });
      return;
    }

    if (!this.data.contactName || !this.data.contactPhone) {
      wx.showToast({ title: '请完善联系信息', icon: 'none' });
      return;
    }

    const dateObj = this.data.weekDays[this.data.selectedDateIndex];
    const timeObj = this.data.timeSlots[this.data.selectedTimeIndex];
    if (!dateObj || !dateObj.fullDate || !timeObj || !timeObj.time) {
      wx.showToast({ title: '请重新选择日期时段', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '加入候补…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'addToWaitlist',
        data: {
          date: dateObj.fullDate,
          time: timeObj.time,
          name: this.data.contactName,
          phone: this.data.contactPhone
        }
      });

      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.success) {
        this.modal({
          title: '加入成功',
          overline: 'WAITLISTED',
          content: result.msg || '已加入候补',
          showCancel: false
        });
      } else {
        wx.showToast({ title: result.msg || '加入失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 🟢 发送预约提醒
  async sendBookingReminder(type, bookingId, bookingData) {
    try {
      // 请求订阅消息授权
      const tmplIds = [
        'booking_success',      // 预约成功
        'booking_reminder_day', // 预约前1天提醒
        'booking_reminder_hour' // 预约前2小时提醒
      ];

      // 仅在首次预约时请求授权
      if (type === 'success') {
        await wx.requestSubscribeMessage({
          tmplIds: tmplIds,
          success: (res) => {
            console.log('订阅消息授权结果:', res);
          },
          fail: (err) => {
            console.log('订阅消息授权失败:', err);
          }
        });
      }

      // 调用云函数发送提醒
      await wx.cloud.callFunction({
        name: 'sendBookingReminder',
        data: {
          type: type,
          bookingId: bookingId,
          bookingData: bookingData
        }
      });
    } catch (err) {
      console.error('发送提醒失败:', err);
      // 不阻塞主流程，静默失败
    }
  }
}));