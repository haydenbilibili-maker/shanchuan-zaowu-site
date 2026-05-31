/**
 * 快递单号：扫码解析与输入规范化（business 分包专用）
 */
function parseTrackingFromScan(raw) {
  if (!raw) return ''
  let s = String(raw).trim()

  const queryMatch = s.match(/[?&](?:billNo|mailNo|trackingNumber|waybillNo|waybill|code)=([^&]+)/i)
  if (queryMatch) {
    try {
      s = decodeURIComponent(queryMatch[1])
    } catch (e) {
      s = queryMatch[1]
    }
  }

  const cleaned = s.replace(/\s/g, '')
  const segments = cleaned.match(/[A-Z0-9]{8,24}/gi)
  if (segments && segments.length) {
    return segments.sort((a, b) => b.length - a.length)[0].toUpperCase()
  }

  return cleaned.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function normalizeTrackingInput(val) {
  return String(val || '').trim().replace(/\s/g, '')
}

module.exports = {
  parseTrackingFromScan,
  normalizeTrackingInput
}
