/**
 * 钱包枢纽导航：钱包储值页 ↔ 券夹
 * 有可用券时可优先落券夹；深链仍可直达 /coupons、/stored-value、/points。
 */
const { fetchMyCoupons } = require('./couponService')

const WALLET_URL = '/subpackages/feature/user/stored-value/index'
const COUPONS_URL = '/subpackages/business/coupons/index'
const POINTS_URL = '/subpackages/business/points/index'
const REWARDS_URL = '/subpackages/business/rewards/index'

function resolveTab(preferred) {
  const t = String(preferred || '').toLowerCase()
  if (t === 'coupons' || t === 'coupon' || t === 'voucher') return 'coupons'
  if (t === 'wallet' || t === 'stored' || t === 'storedvalue') return 'wallet'
  // 兼容旧「积分与券」入口：points 改指向独立积分，不再作为本枢纽默认
  if (t === 'points' || t === 'point') return 'points'
  return 'auto'
}

function urlForTab(tab) {
  if (tab === 'coupons') return COUPONS_URL
  if (tab === 'points') return POINTS_URL
  return WALLET_URL
}

/**
 * @param {{ tab?: string, couponCount?: number }} options
 * @returns {Promise<'wallet'|'coupons'|'points'>}
 */
async function pickWalletTab(options = {}) {
  const preferred = resolveTab(options.tab)
  if (preferred === 'wallet' || preferred === 'coupons' || preferred === 'points') {
    return preferred
  }

  const known = Number(options.couponCount)
  if (Number.isFinite(known) && known > 0) return 'coupons'

  try {
    const pack = await fetchMyCoupons({ usableOnly: true })
    if (pack && pack.ok && (pack.list || []).length > 0) return 'coupons'
  } catch (e) { /* fall through */ }
  return 'wallet'
}

/** @deprecated 旧名；行为改为钱包|券夹分流 */
async function pickRewardsTab(options = {}) {
  return pickWalletTab(options)
}

/**
 * @param {{ tab?: string, couponCount?: number, navigate?: 'navigateTo'|'redirectTo' }} options
 */
async function openWalletHub(options = {}) {
  const tab = await pickWalletTab(options)
  const url = urlForTab(tab)
  const nav = options.navigate === 'redirectTo' ? wx.redirectTo : wx.navigateTo
  return new Promise((resolve) => {
    nav({
      url,
      success: () => resolve({ ok: true, tab, url }),
      fail: (err) => {
        console.error('[walletNav] open failed', url, err)
        wx.showToast({ title: '页面暂不可用', icon: 'none' })
        resolve({ ok: false, tab, url, err })
      }
    })
  })
}

/** @deprecated 旧名 */
async function openRewards(options = {}) {
  return openWalletHub(options)
}

module.exports = {
  WALLET_URL,
  COUPONS_URL,
  POINTS_URL,
  REWARDS_URL,
  resolveTab,
  urlForTab,
  pickWalletTab,
  pickRewardsTab,
  openWalletHub,
  openRewards
}
