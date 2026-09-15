/**
 * 角标展示口径（Museum Mode）
 * - 0 / 空不展示（调用方配合 wx:if）
 * - 超过 99 显示 99+
 * - 成就角标：较上次进入成就页的「新点亮」数，非已点亮总数
 */
function formatBadgeText(count) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

function shouldShowBadge(count) {
  return (parseInt(count, 10) || 0) > 0;
}

function _achievementSeenKey(openid) {
  const id = String(openid || '').trim() || 'guest';
  return `achievements_seen_unlocked:${id}`;
}

/**
 * 计算成就「新点亮」数。
 * 首次无记录时写入当前已点亮数并返回 0，避免把历史库存当成新提示。
 */
function getAchievementNewCount(unlocked, openid) {
  const current = Math.max(0, parseInt(unlocked, 10) || 0);
  const key = _achievementSeenKey(openid);
  let raw;
  try {
    raw = wx.getStorageSync(key);
  } catch (e) {
    raw = undefined;
  }

  if (raw === '' || raw === undefined || raw === null) {
    try {
      wx.setStorageSync(key, current);
    } catch (e) { /* ignore */ }
    return 0;
  }

  const seen = Math.max(0, parseInt(raw, 10) || 0);
  return Math.max(0, current - seen);
}

/** 进入成就页后清除「新点亮」提示 */
function markAchievementsSeen(unlocked, openid) {
  const current = Math.max(0, parseInt(unlocked, 10) || 0);
  const key = _achievementSeenKey(openid);
  try {
    wx.setStorageSync(key, current);
  } catch (e) { /* ignore */ }
  return current;
}

module.exports = {
  formatBadgeText,
  shouldShowBadge,
  getAchievementNewCount,
  markAchievementsSeen
};
