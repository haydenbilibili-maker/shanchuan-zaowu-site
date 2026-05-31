/**
 * 统一站内信发送（山海有信）— 兼容层，优先走 dispatchMessage
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
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
