/**
 * 山海有信 · 留言回复卡片的展示视图（只读 support_tickets 原字段，不改库）
 *
 * 顾客端从藏品 / 订单进「联系专员」时，留言框会预填「关于藏品「…」：」+ 换行，顾客在下面写正文；
 * 云函数 trim 后整段存进 message。这里把开头的预填前缀拆成上下文行，剩下的才是正文 ——
 * 正文为空说明顾客只提交了前缀（2026-10-01 真机：message 仅 17 字、无换行）。
 */

const PREFIX_RE = /^关于([^\n：]{1,60})：\s*/
const CLAMP_CHARS = 66
const CLAMP_LINES = 4

/** 与积分 / 储值 / 定金同算法：openid 末 8 位 → MT-XXXX-XXXX（users 没有 memberNo 时的回退） */
function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return ''
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

function splitTicketMessage(message) {
  const raw = String(message || '').trim()
  const m = raw.match(PREFIX_RE)
  if (!m) return { contextLine: '', body: raw }
  return { contextLine: m[1], body: raw.slice(m[0].length).trim() }
}

function pickImages(item) {
  const list = []
  ;[item.images, item.imageList, item.photos].forEach((arr) => {
    if (Array.isArray(arr)) arr.forEach((u) => { if (typeof u === 'string' && u) list.push(u) })
  })
  if (typeof item.image === 'string' && item.image) list.push(item.image)
  return Array.from(new Set(list)).slice(0, 9)
}

function buildTicketView(item, formatTime) {
  const row = item || {}
  const { contextLine, body } = splitTicketMessage(row.message)
  const memberNo = row.memberNo || buildMemberNo(row._openid)
  const nick = row.memberNickName ? String(row.memberNickName) : ''
  const lines = body ? body.split('\n').length : 0
  return {
    ...row,
    contextLine: contextLine || (row.productName ? `藏品「${row.productName}」` : (row.orderNo ? `订单 ${row.orderNo}` : '')),
    body,
    bodyEmpty: !body,
    canExpand: body.length > CLAMP_CHARS || lines > CLAMP_LINES,
    expanded: false,
    images: pickImages(row),
    who: nick && memberNo ? `${nick} · ${memberNo}` : (nick || memberNo || '会员'),
    formatTime: typeof formatTime === 'function' ? formatTime(row.createTime) : ''
  }
}

module.exports = { buildTicketView, splitTicketMessage, buildMemberNo }
