/**
 * 店长/超管后台本地信任会话
 * 同一 openid + 本设备首次输入口令后，在有效期内免重复验证
 *
 * 口令只是 UI 门帘；进入前会用 manageStaff.whoami 校验工作台角色。
 * 店员即便口令正确也不得进入 manager 页。
 */
const STORAGE_KEY = 'manager_auth_trust_v3';
const DEVICE_KEY = 'manager_device_id_v1';
const TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MANAGER_PATH = '/subpackages/manager/manager/index';
const STAFF_PATH = '/subpackages/extra/staff/index';
const ARTISAN_PATH = '/subpackages/extra/artisan/index';
const SUPPLIER_PATH = '/subpackages/extra/supplier/index';
const LIVE_BROADCAST_PATH = '/subpackages/extra/live/broadcast/index';
const LIVE_STUDIO_PATH = '/subpackages/extra/live/studio/index';
const INVESTOR_PATH = '/subpackages/extra/investor/index';
const SHAREHOLDER_PATH = '/subpackages/extra/shareholder/index';

const WORKSPACE_KIND_MAP = {
  super_admin: { title: '超管验证', go: () => goManagerPage('super_admin') },
  manager: { title: '店长验证', go: () => goManagerPage('store_manager') },
  staff: { title: '店员验证', go: goStaffPage },
  artisan: { title: '标本师验证', go: goArtisanPage },
  supplier: { title: 'B2B工作台验证', go: goSupplierPage },
  live_host: { title: '主播验证', go: goLiveHostStudioPage },
  investor: { title: '投资人验证', go: goInvestorPage },
  shareholder: { title: '股东验证', go: goShareholderPage }
};

function getAppSafe() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function getOpenid() {
  const app = getAppSafe();
  return (app && app.globalData && app.globalData.openid) || '';
}

function getDeviceId() {
  try {
    let id = wx.getStorageSync(DEVICE_KEY);
    if (id) return id;
    id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    wx.setStorageSync(DEVICE_KEY, id);
    return id;
  } catch (e) {
    return 'unknown_device';
  }
}

function readTrust() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || null;
  } catch (e) {
    return null;
  }
}

function writeTrust(record) {
  try {
    wx.setStorageSync(STORAGE_KEY, record);
  } catch (e) {}
}

function isRecordValid(record, openid) {
  if (!record || !openid) return false;
  if (record.openid !== openid) return false;
  if (record.deviceId !== getDeviceId()) return false;
  if (!record.expiresAt || Date.now() > record.expiresAt) return false;
  return true;
}

function isManagerTrusted(openid) {
  const id = openid || getOpenid();
  return isRecordValid(readTrust(), id);
}

function saveManagerTrust(openid) {
  const id = openid || getOpenid();
  if (!id) return;
  const now = Date.now();
  writeTrust({
    openid: id,
    deviceId: getDeviceId(),
    verifiedAt: now,
    expiresAt: now + TRUST_TTL_MS
  });
}

function touchManagerTrust(openid) {
  const id = openid || getOpenid();
  if (!id || !isManagerTrusted(id)) return;
  saveManagerTrust(id);
}

function clearManagerTrust() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {}
}

/**
 * 客户端不再保存明文口令。口令在云函数 manageStaff.verifyUiGate 校验
 *（环境变量 MANAGER_UI_PASSWORD / MANAGER_UI_PASSWORD_HASH）。
 * 任何后台写操作的真实权限都由云函数的 staffGuard.js 独立校验。
 */
async function verifyPasswordRemote(input) {
  const password = String(input || '').trim()
  if (!password) {
    return { ok: false, msg: '请输入访问口令' }
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'manageStaff',
      data: { action: 'verifyUiGate', password }
    })
    const result = (res && res.result) || {}
    if (result.success || result.ok) return { ok: true }
    return { ok: false, msg: result.msg || '口令错误', code: result.code || '' }
  } catch (e) {
    console.warn('verifyPasswordRemote', e)
    return { ok: false, msg: '口令校验失败，请稍后重试' }
  }
}

function goManagerPage(workspaceRole) {
  const wr = String(workspaceRole || '').trim();
  const q = wr ? `?workspace=${encodeURIComponent(wr)}` : '';
  wx.navigateTo({
    url: `${MANAGER_PATH}${q}`,
    fail: () => wx.showToast({ title: '工作台暂不可用', icon: 'none' })
  });
}

function goArtisanPage() {
  wx.navigateTo({
    url: ARTISAN_PATH,
    fail: () => wx.showToast({ title: '标本师工作台暂不可用', icon: 'none' })
  });
}

/**
 * 供应商工作台（Phase 1 旁路 Hub）
 * ⚠️ 刻意不写 fail toast：dialog-ratchet 只许降；页路径由 check:page-paths 保证。
 */
function goSupplierPage() {
  wx.navigateTo({ url: SUPPLIER_PATH });
}

function goLiveBroadcastPage() {
  wx.navigateTo({
    url: LIVE_BROADCAST_PATH,
    fail: () => wx.showToast({ title: '开播控制台暂不可用', icon: 'none' })
  });
}

function goLiveHostStudioPage() {
  wx.navigateTo({
    url: LIVE_STUDIO_PATH,
    fail: () => wx.showToast({ title: '主播工作台暂不可用', icon: 'none' })
  });
}

function goInvestorPage() {
  wx.navigateTo({
    url: INVESTOR_PATH,
    fail: () => wx.showToast({ title: '投资观测台暂不可用', icon: 'none' })
  });
}

function goShareholderPage() {
  wx.navigateTo({
    url: SHAREHOLDER_PATH,
    fail: () => wx.showToast({ title: '股东观测台暂不可用', icon: 'none' })
  });
}

function goStaffPage() {
  wx.navigateTo({
    url: STAFF_PATH,
    fail: () => wx.showToast({ title: '店员工作台暂不可用', icon: 'none' })
  });
}

/**
 * 轻量 whoami：失败时返回空角色，不抛错（避免白屏）
 */
async function peekWorkspaceRole() {
  try {
    const { resolveWorkspaceRole } = require('./workspaceRoles');
    const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'whoami' } });
    const result = (res && res.result) || {};
    return resolveWorkspaceRole(result) || '';
  } catch (e) {
    console.warn('peekWorkspaceRole', e);
    return '';
  }
}

async function peekWhoami() {
  try {
    const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'whoami' } });
    return (res && res.result) || {};
  } catch (e) {
    console.warn('peekWhoami', e);
    return {};
  }
}

/**
 * 进入指定工作台：先角色、再口令（同一设备信任会话）
 * @param {'super_admin'|'manager'|'staff'|'artisan'|'supplier'|'live_host'|'investor'|'shareholder'} kind
 * @param {string} [workspaceHint] manager 页菜单视角（super_admin | store_manager）
 */
function promptStaffOrderSubscribeSync() {
  try {
    const { requestStaffOrderSubscribe } = require('./staffOrderSubscribe');
    // 必须在用户 tap 同步栈内发起；不要 await 其它网络请求后再调
    return requestStaffOrderSubscribe({ showTip: false });
  } catch (e) {
    return Promise.resolve({ skipped: true });
  }
}

async function requestWorkspaceAccess(kind, workspaceHint) {
  const target = String(kind || '').trim();
  const meta = WORKSPACE_KIND_MAP[target];
  if (!meta) {
    wx.showToast({ title: '入口无效', icon: 'none' });
    return;
  }

  const wantsOrderSubscribe = target === 'super_admin' || target === 'manager';
  const openid = getOpenid();
  const trusted = !!(openid && isManagerTrusted(openid));

  // 已信任进入：在点击栈内同步发起订阅（勿先 await 网络，否则微信会拒弹窗）
  let subscribePromise = null;
  if (wantsOrderSubscribe && trusted) {
    subscribePromise = promptStaffOrderSubscribeSync();
  }

  wx.showLoading({ title: '校验中', mask: !subscribePromise });
  let whoami = {};
  try {
    whoami = await peekWhoami();
  } finally {
    wx.hideLoading();
  }

  const roles = Array.isArray(whoami.roles) ? whoami.roles : [];
  const allowed =
    (target === 'super_admin' && (roles.indexOf('super_admin') !== -1 || whoami.isSuperAdmin)) ||
    (target === 'manager' && (roles.indexOf('manager') !== -1 || roles.indexOf('super_admin') !== -1)) ||
    (target === 'staff' && (roles.indexOf('staff') !== -1 || roles.indexOf('manager') !== -1 || roles.indexOf('super_admin') !== -1)) ||
    (target === 'artisan' && (roles.indexOf('specimen_artisan') !== -1 || roles.indexOf('super_admin') !== -1)) ||
    (target === 'supplier' &&
      (roles.indexOf('super_admin') !== -1 ||
        whoami.isSuperAdmin ||
        roles.indexOf('supplier') !== -1 ||
        roles.indexOf('buyer') !== -1 ||
        roles.indexOf('franchisee') !== -1 ||
        roles.indexOf('channel') !== -1)) ||
    (target === 'live_host' && (roles.indexOf('live_host') !== -1 || roles.indexOf('super_admin') !== -1)) ||
    (target === 'investor' && (roles.indexOf('investor') !== -1 || roles.indexOf('super_admin') !== -1)) ||
    (target === 'shareholder' && (roles.indexOf('shareholder') !== -1 || roles.indexOf('super_admin') !== -1 || whoami.isShareholder));

  if (!allowed) {
    try {
      const { isSuperAdminOpenid } = require('./workspaceRoles');
      if (target === 'super_admin' && isSuperAdminOpenid(openid)) {
        // 白名单兜底
      } else {
        wx.showToast({ title: '暂无该工作台权限', icon: 'none' });
        return;
      }
    } catch (e) {
      wx.showToast({ title: '暂无该工作台权限', icon: 'none' });
      return;
    }
  }

  const go =
    (target === 'super_admin' || target === 'manager') && workspaceHint
      ? () => goManagerPage(String(workspaceHint))
      : meta.go;
  if (trusted) {
    touchManagerTrust(openid);
    if (subscribePromise) {
      await subscribePromise.catch(() => null);
    }
    go();
    return;
  }

  wx.showModal({
    title: meta.title,
    editable: true,
    placeholderText: '输入访问口令',
    confirmColor: '#C4A76C',
    success: async (res) => {
      if (!res.confirm) return
      // showModal 确认也算用户手势，再攒一次额度（等用户选完再校验口令）
      let subP = null
      if (wantsOrderSubscribe) {
        subP = promptStaffOrderSubscribeSync()
      }
      if (subP) {
        await subP.catch(() => null)
      }
      wx.showLoading({ title: '校验口令', mask: true })
      let gate = { ok: false, msg: '口令错误' }
      try {
        gate = await verifyPasswordRemote(res.content)
      } finally {
        wx.hideLoading()
      }
      if (!gate.ok) {
        wx.showToast({ title: gate.msg || '口令错误', icon: 'none' })
        return
      }
      const currentOpenid = getOpenid()
      if (currentOpenid) saveManagerTrust(currentOpenid)
      go()
    }
  })
}

/**
 * 进入店长/超管工作台：先角色、再口令。店员引导至店员工作台。
 * @deprecated 多角色请用 requestWorkspaceAccess(kind)
 */
async function requestManagerAccess() {
  const openid = getOpenid();
  wx.showLoading({ title: '校验中', mask: true });
  let whoami = {};
  try {
    whoami = await peekWhoami();
  } finally {
    wx.hideLoading();
  }

  const roles = Array.isArray(whoami.roles) ? whoami.roles : [];
  if (roles.indexOf('super_admin') !== -1 || whoami.isSuperAdmin) {
    return requestWorkspaceAccess('super_admin');
  }
  if (roles.indexOf('manager') !== -1 || whoami.isManager) {
    return requestWorkspaceAccess('manager');
  }
  if (roles.indexOf('specimen_artisan') !== -1 || whoami.isArtisan) {
    return requestWorkspaceAccess('artisan');
  }
  if (roles.indexOf('live_host') !== -1) {
    return requestWorkspaceAccess('live_host');
  }
  if (roles.indexOf('investor') !== -1 || whoami.isInvestor) {
    return requestWorkspaceAccess('investor');
  }
  if (roles.indexOf('shareholder') !== -1 || whoami.isShareholder) {
    return requestWorkspaceAccess('shareholder');
  }
  if (roles.indexOf('staff') !== -1) {
    wx.showToast({ title: '请使用店员工作台', icon: 'none' });
    setTimeout(() => goStaffPage(), 400);
    return;
  }

  try {
    const { resolveWorkspaceRole, isSuperAdminOpenid, WORKSPACE_SUPER_ADMIN } = require('./workspaceRoles');
    let workspaceRole = resolveWorkspaceRole(whoami) || '';
    if (!workspaceRole && isSuperAdminOpenid(openid)) workspaceRole = WORKSPACE_SUPER_ADMIN;
    if (workspaceRole === 'store_staff') {
      wx.showToast({ title: '请使用店员工作台', icon: 'none' });
      setTimeout(() => goStaffPage(), 400);
      return;
    }
    if (workspaceRole === WORKSPACE_SUPER_ADMIN) return requestWorkspaceAccess('super_admin');
    if (workspaceRole === 'store_manager') return requestWorkspaceAccess('manager');
    if (workspaceRole === 'specimen_artisan') return requestWorkspaceAccess('artisan');
    if (workspaceRole === 'live_host') return requestWorkspaceAccess('live_host');
    if (workspaceRole === 'investor') return requestWorkspaceAccess('investor');
    if (workspaceRole === 'shareholder') return requestWorkspaceAccess('shareholder');
  } catch (e) { /* ignore */ }

  wx.showToast({ title: '暂无工作台权限', icon: 'none' });
}

/**
 * 店长页 onLoad 守卫：防止未验证 deep link；失败 toast 并返回，不抛错。
 */
function guardManagerPage() {
  try {
    const openid = getOpenid();
    if (openid && isManagerTrusted(openid)) {
      touchManagerTrust(openid);
      return true;
    }
    wx.showToast({ title: '请先完成店长验证', icon: 'none' });
    setTimeout(() => {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) });
    }, 400);
    return false;
  } catch (e) {
    console.warn('guardManagerPage', e);
    wx.showToast({ title: '入口校验失败', icon: 'none' });
    setTimeout(() => {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) });
    }, 400);
    return false;
  }
}

module.exports = {
  MANAGER_PATH,
  ARTISAN_PATH,
  SUPPLIER_PATH,
  LIVE_BROADCAST_PATH,
  LIVE_STUDIO_PATH,
  INVESTOR_PATH,
  isManagerTrusted,
  saveManagerTrust,
  touchManagerTrust,
  clearManagerTrust,
  verifyPasswordRemote,
  requestManagerAccess,
  requestWorkspaceAccess,
  guardManagerPage,
  goManagerPage,
  goArtisanPage,
  goSupplierPage,
  goLiveBroadcastPage,
  goLiveHostStudioPage,
  goInvestorPage,
  goStaffPage,
  getDeviceId,
  peekWorkspaceRole
};
