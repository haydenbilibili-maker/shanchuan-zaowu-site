/**
 * 统一站内信发送（山海有信）— 兼容层，优先走 dispatchMessage
 *
 * 鉴权：小程序客户端直调须店员及以上；云函数嵌套放行。
 */
const cloud = require('wx-server-sdk');
const { assertStaff: _assertStaff, ROLE_STAFF } = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}
;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
// 来源判定统一真源：修正「合并串（如 wx_client,scf）被当作非客户端 → 跳过店员权限校验」的绕过
const { isClientSource } = require('./sourceOrigin');

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const wxContext = cloud.getWXContext();
  if (isClientSource()) {
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
