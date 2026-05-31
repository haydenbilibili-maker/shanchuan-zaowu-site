/**
 * 店长后台本地信任会话
 * 同一 openid + 本设备首次输入口令后，在有效期内免重复验证
 */
const STORAGE_KEY = 'manager_auth_trust_v1';
const DEVICE_KEY = 'manager_device_id_v1';
const TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MANAGER_PATH = '/subpackages/business/manager/index';

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

function verifyPassword(input) {
  return String(input || '').trim() === 'admin888';
}

function goManagerPage() {
  wx.navigateTo({ url: MANAGER_PATH });
}

/**
 * 进入店长后台：已信任则直达，否则弹出口令框
 */
function requestManagerAccess() {
  const openid = getOpenid();

  if (openid && isManagerTrusted(openid)) {
    touchManagerTrust(openid);
    goManagerPage();
    return;
  }

  wx.showModal({
    title: '馆长验证',
    editable: true,
    placeholderText: '输入访问口令',
    confirmColor: '#C4A76C',
    success: (res) => {
      if (!res.confirm) return;
      if (!verifyPassword(res.content)) {
        wx.showToast({ title: '口令错误', icon: 'error' });
        return;
      }
      const currentOpenid = getOpenid();
      if (currentOpenid) {
        saveManagerTrust(currentOpenid);
      }
      goManagerPage();
    }
  });
}

/**
 * 店长页 onLoad 守卫：防止未验证 deep link
 */
function guardManagerPage() {
  const openid = getOpenid();
  if (openid && isManagerTrusted(openid)) {
    touchManagerTrust(openid);
    return true;
  }
  wx.showToast({ title: '请先完成馆长验证', icon: 'none' });
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) });
  }, 400);
  return false;
}

module.exports = {
  isManagerTrusted,
  saveManagerTrust,
  touchManagerTrust,
  clearManagerTrust,
  verifyPassword,
  requestManagerAccess,
  guardManagerPage,
  getDeviceId
};
