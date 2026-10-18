/**
 * 成就「新点亮」射灯（2026-10-18 方向池 ★★）：按成就 id 记本机见过的已点亮项。
 * 本机第一次进页 → 现有已点亮全部记为见过，不播（老成就不该集体扫一遍）；之后新点亮的那枚扫一次射灯。
 * 纯前端：云端不返回点亮时间，只读 unlocked。
 */
const MAX = 300;

function keyOf(openid) {
  return `achv_lit_ids:${openid || 'anon'}`;
}

/** 返回本次应播射灯的 id 列表，并把当前已点亮全部落盘 */
function takeFreshLit(litIds, storage, openid) {
  const ids = (Array.isArray(litIds) ? litIds : []).filter(Boolean);
  let seen = null;
  try {
    const raw = storage.getStorageSync(keyOf(openid));
    seen = Array.isArray(raw) ? raw : null;
  } catch (e) {
    seen = null;
  }
  const fresh = seen === null ? [] : ids.filter((id) => seen.indexOf(id) < 0);
  if (seen === null || fresh.length) {
    try {
      storage.setStorageSync(keyOf(openid), (seen || []).concat(seen === null ? ids : fresh).slice(-MAX));
    } catch (e) {
      console.warn('[成就] 本机记不住已点亮项，下次可能重播射灯', e);
    }
  }
  return fresh;
}

module.exports = { takeFreshLit, keyOf };
