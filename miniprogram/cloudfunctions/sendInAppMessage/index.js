/**
 * 统一站内信发送（山海有信）— 兼容层，优先走 dispatchMessage
 *
 * 鉴权：小程序客户端直调须店员及以上；云函数嵌套放行。
 */
const cloud = require('wx-server-sdk');
const { assertStaff, ROLE_STAFF } = require('./staffGuard');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function isClientSource(source) {
  const s = String(source || '');
  return s === 'wx_client' || s === 'wx_devtools';
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  if (isClientSource(wxContext.SOURCE)) {
    const operatorOpenid = wxContext.OPENID || '';
    const guard = await assertStaff(db, operatorOpenid, { role: ROLE_STAFF });
    if (!guard.ok) {
      return { success: false, code: guard.code, msg: guard.msg || '无权限' };
    }
  }

  const {
    openid,
    category,
    type = 'system_notice',
    title,
    content,
    relatedId = '',
    actionUrl = '',
    templateCode = '',
    icon = '',
    vars = {},
    skipDedupe = false
  } = event;

  if (!openid) {
    return { success: false, msg: '缺少 openid' };
  }

  const eventType = templateCode || type;

  if (title && !templateCode) {
    try {
      const res = await cloud.callFunction({
        name: 'dispatchMessage',
        data: {
          action: 'dispatch',
          eventType: type,
          openid,
          relatedId,
          title,
          content,
          actionUrl,
          category,
          skipDedupe: true
        }
      });
      return res.result || { success: false };
    } catch (err) {
      console.error('sendInAppMessage legacy error:', err);
      return { success: false, msg: err.message || '发送失败' };
    }
  }

  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType,
        openid,
        relatedId,
        vars: { ...vars, content: content || vars.content, title: title || vars.title },
        content,
        title,
        actionUrl,
        category,
        skipDedupe
      }
    });
    return res.result || { success: false };
  } catch (err) {
    console.error('sendInAppMessage error:', err);
    return { success: false, msg: err.message || '发送失败' };
  }
};
