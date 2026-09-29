/**
 * 店长首页金卡「门店｜STORE」：本月线下营收 = 山川造物 + 星宸标本（与每日日报「门店营收」、
 * syncFinanceData 的 REPORT_STORES 同一门店目录）。主数字是合计，下方小字列各店。
 * 每店仍走 storeLedger.sumMonthOffline(storeId, ym)（同一云函数动作，契约不变）。
 */
const OFFLINE_REPORT_STORES = [
  { storeId: 'store_shanhaizaowu', name: '山川造物', short: '山川' },
  { storeId: 'store_xingchen', name: '星宸标本', short: '星宸' },
]

const round2 = (n) => Math.round(n * 100) / 100

/**
 * @param {{ storeId: string, total: number, ok: boolean }[]} parts
 * @param {(n: number) => string} formatMoney
 * @returns {{ total: number, stores: object[], splitText: string, failedNames: string[] }}
 *   total = Σ 取数成功的各店；取数失败的店不当成 ¥0，而是在 splitText 里写「未取到」
 */
function summarizeOfflineStores (parts, formatMoney) {
  const fmt = typeof formatMoney === 'function' ? formatMoney : (n) => Number(n).toFixed(2)
  const byId = {}
  ;(parts || []).forEach((p) => { if (p && p.storeId) byId[p.storeId] = p })
  const stores = OFFLINE_REPORT_STORES.map((s) => {
    const p = byId[s.storeId]
    const ok = !!(p && p.ok)
    const total = ok ? round2(Number(p.total) || 0) : 0
    return { storeId: s.storeId, name: s.name, short: s.short, ok, total, totalText: ok ? fmt(total) : '' }
  })
  const total = round2(stores.reduce((a, s) => a + s.total, 0))
  const splitText = stores.map((s) => `${s.short} ${s.ok ? '¥' + s.totalText : '未取到'}`).join(' · ')
  return { total, stores, splitText, failedNames: stores.filter((s) => !s.ok).map((s) => s.name) }
}

/**
 * @param {(storeId: string, yearMonth?: string) => Promise<{ total: number }>} sumMonthOffline
 * @param {string} [yearMonth] YYYY-MM；缺省本月
 */
async function sumOfflineByStore (sumMonthOffline, yearMonth, formatMoney) {
  const parts = await Promise.all(OFFLINE_REPORT_STORES.map((s) =>
    Promise.resolve()
      .then(() => sumMonthOffline(s.storeId, yearMonth))
      .then(
        (r) => ({ storeId: s.storeId, total: Number(r && r.total) || 0, ok: true }),
        (e) => {
          console.warn('sumOfflineByStore', s.storeId, e)
          return { storeId: s.storeId, total: 0, ok: false }
        },
      )))
  return summarizeOfflineStores(parts, formatMoney)
}

module.exports = {
  OFFLINE_REPORT_STORES,
  summarizeOfflineStores,
  sumOfflineByStore,
}
