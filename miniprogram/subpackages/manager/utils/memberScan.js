/**
 * 会员码扫码解析 —— 店长后台与店员后台共用
 * 会员码由 getMemberPass issue 生成，TTL 60 秒，格式为 JSON 或自定义 scheme URI
 */

const FIELD_PATH = '/subpackages/extra/staff/field/index';
const PENDING_TTL_MS = 60 * 1000;

/** 工作台直扫后交给 field 处理的挂起结果（二维码原文可能含 JSON/特殊字符，不宜塞 URL） */
let _pendingScan = null;

function parseMemberPassScan(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text[0] === '{') {
    try {
      const obj = JSON.parse(text);
      if (obj && obj.token && (obj.v === 1 || obj.memberNo)) {
        return { token: String(obj.token), memberNo: obj.memberNo || '' };
      }
    } catch (e) {
      return null;
    }
  }
  if (/REDEEM:/i.test(text)) return null;
  const uri = text.match(/(?:shanchuan|shanhai):\/\/member\?(?:[^#]*&)?token=([A-Za-z0-9_-]+)/i);
  if (uri) return { token: uri[1] };
  return null;
}

/**
 * 扫码后分流：会员码 / 券码 / 权益核销码 / 预约票
 */
function classifyScan(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty' };
  const member = parseMemberPassScan(text);
  if (member) return { kind: 'member', payload: member };
  const coupon = text.match(/^COUPON:([A-Za-z0-9_-]+)/i);
  if (coupon) return { kind: 'coupon', payload: { userCouponId: coupon[1].trim() } };
  const redeem = text.match(/REDEEM:(.+)/i);
  if (redeem) return { kind: 'redeem', payload: { orderId: redeem[1].trim() } };
  const gift = text.match(/^GIFT:([A-Za-z0-9]+)/i);
  if (gift) return { kind: 'gift', payload: { claimCode: gift[1].trim().toUpperCase() } };
  // 门店自取凭证：PICKUP:{短码}（与礼赠 GIFT: 分流，勿混）
  const pickup = text.match(/^PICKUP:([A-Za-z0-9-]{4,32})/i);
  if (pickup) return { kind: 'pickup', payload: { pickupCode: pickup[1].trim().toUpperCase() } };
  const bookingUri = text.match(/^BOOKING:([^:]+)(?::|$)/i);
  if (bookingUri) return { kind: 'booking', payload: { ticketCode: bookingUri[1].trim() } };
  return { kind: 'booking', payload: { bookingId: text } };
}

function formatCloudFnError(e, fallback) {
  if (e && typeof e === 'object' && !e.errMsg && (e.msg || e.message || e.code)) {
    const code = String(e.code || '');
    if (code === 'FORBIDDEN') return e.msg || '无操作权限';
    if (code === 'ADMIN_UNCONFIGURED') return e.msg || '管理员尚未配置';
    if (code === 'NOT_LOGGED_IN') return '请先登录';
    // 云函数**版本落后于客户端**：新增的 action 在线上那份里还不存在。
    // 这是最隐蔽的一种"变哑巴"——云函数没坏、客户端也没坏，只是两边不是同一版。
    // 实例：点「AI 生成一批心愿」报 "未知 action: staffSeedAi"（线上是旧构建）。
    // 排查/修复：node scripts/check-cloud-functions-sync.cjs <函数名>
    //            bash miniprogram/scripts/deploy-drifted.sh <函数名>
    if (/未知 action/.test(String(e.msg || ''))) {
      console.error('[cloud-fn] 线上云函数缺少该 action（版本过旧）：', e.msg);
      return '云函数版本过旧，请重新部署';
    }
    if (e.msg) return String(e.msg).slice(0, 64);
  }
  const msg = (e && (e.errMsg || e.message)) || '';
  if (/501000|FUNCTION_NOT_FOUND|FunctionName parameter could not be found|FUNCTION_NOT_EXIST/i.test(msg)) {
    return '云函数未部署，请先在开发者工具上传部署';
  }
  if (/504003|timeout|TIMEOUT/i.test(msg)) return '请求超时，请稍后重试';
  return msg.slice(0, 48) || fallback || '操作失败';
}

function setPendingScan(payload) {
  _pendingScan = payload && payload.raw != null
    ? {
        raw: payload.raw,
        purpose: payload.purpose || 'verify',
        createdAt: Date.now()
      }
    : null;
}

function takePendingScan() {
  const pending = _pendingScan;
  _pendingScan = null;
  if (!pending || pending.raw == null) return null;
  if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) return null;
  return pending;
}

function clearPendingScan() {
  _pendingScan = null;
}

/**
 * 工作台主 CTA：立刻拉起相机；成功后再进 field 复用核销/赠分逻辑。
 * 用户取消扫码时不跳转，留在当前工作台。
 *
 * @param {object} [options]
 * @param {string} [options.purpose] verify|grant
 * @param {string} [options.tab] field tab 深链
 * @param {string} [options.storeId]
 * @param {string} [options.storeName]
 * @param {string} [options.fieldPath]
 */
function openWorkspaceMemberScan(options) {
  const opts = options || {};
  const purpose = opts.purpose === 'grant' ? 'grant' : 'verify';
  const tab = opts.tab || (purpose === 'grant' ? 'grant' : 'verify');
  const storeId = opts.storeId || '';
  const storeName = opts.storeName || '';
  const fieldPath = opts.fieldPath || FIELD_PATH;

  wx.scanCode({
    scanType: ['qrCode'],
    success: (res) => {
      setPendingScan({ raw: res && res.result, purpose });
      const qs = [`tab=${encodeURIComponent(tab)}`, 'pendingScan=1'];
      if (storeId) qs.push(`storeId=${encodeURIComponent(storeId)}`);
      if (storeName) qs.push(`storeName=${encodeURIComponent(storeName)}`);
      wx.navigateTo({
        url: `${fieldPath}?${qs.join('&')}`,
        fail: () => {
          clearPendingScan();
          wx.showToast({ title: '现场服务暂不可用', icon: 'none' });
        }
      });
    },
    fail: (err) => {
      const msg = (err && err.errMsg) || '';
      if (msg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: '无法打开扫码，请检查相机权限', icon: 'none' });
    }
  });
}

module.exports = {
  parseMemberPassScan,
  classifyScan,
  formatCloudFnError,
  setPendingScan,
  takePendingScan,
  clearPendingScan,
  openWorkspaceMemberScan
};
