/** 埋点模块分类 — 与 PRD / 看板维度对齐 */
const MODULE = {
  SYSTEM: 'system',
  EXPLORE: 'explore',
  ENCYCLOPEDIA: 'encyclopedia',
  COMMERCE: 'commerce',
  STORE: 'store',
  BOOKING: 'booking',
  IDENTIFY: 'identify',
  CUSTOM: 'custom',
  CARE: 'care',
  MESSAGE: 'message',
  SUPPORT: 'support',
  COMMUNITY: 'community',
  USER: 'user'
}

/** action 前缀 → module 推断 */
const ACTION_PREFIX_MODULE = [
  ['page_', MODULE.SYSTEM],
  ['tab_', MODULE.SYSTEM],
  ['app_', MODULE.SYSTEM],
  ['explore_', MODULE.EXPLORE],
  ['encyclopedia_', MODULE.ENCYCLOPEDIA],
  ['wiki_', MODULE.ENCYCLOPEDIA],
  ['product_', MODULE.COMMERCE],
  ['cart_', MODULE.COMMERCE],
  ['order_', MODULE.COMMERCE],
  ['search_', MODULE.COMMERCE],
  ['store_', MODULE.STORE],
  ['booking_', MODULE.BOOKING],
  ['identify_', MODULE.IDENTIFY],
  ['custom_', MODULE.CUSTOM],
  ['pet_', MODULE.CUSTOM],
  ['care_', MODULE.CARE],
  ['message_', MODULE.MESSAGE],
  ['support_', MODULE.SUPPORT],
  ['community_', MODULE.COMMUNITY],
  ['user_', MODULE.USER]
]

function inferModule(action) {
  if (!action || typeof action !== 'string') return MODULE.SYSTEM
  for (let i = 0; i < ACTION_PREFIX_MODULE.length; i++) {
    const [prefix, mod] = ACTION_PREFIX_MODULE[i]
    if (action.startsWith(prefix)) return mod
  }
  return MODULE.SYSTEM
}

module.exports = { MODULE, inferModule }
