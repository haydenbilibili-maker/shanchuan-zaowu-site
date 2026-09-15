#!/usr/bin/env node
/**
 * 礼赠相关云库索引建议（只打印，不自动创建）
 *
 * 原因：索引创建需控制台权限或 CloudBase Manager API，避免脚本误改生产。
 * 环境：cloud1-8gnkty5bfff9f0bf / 集合 orders + products
 *
 * 用法：node scripts/ensure-gift-indexes.cjs
 */

const ORDER_INDEXES = [
  {
    name: 'gift_expire_sweep',
    keys: [
      { field: 'status', direction: 1 },
      { field: 'giftMeta.expireAt', direction: 1 }
    ],
    why: 'expireSweep：paid_awaiting_address + expireAt <= now'
  },
  {
    name: 'gift_share_token',
    keys: [{ field: 'giftMeta.shareToken', direction: 1 }],
    why: '领取链接 getShare / accept / submitAddress'
  },
  {
    name: 'gift_claim_code',
    keys: [{ field: 'giftMeta.claimCode', direction: 1 }],
    why: '自提核销 verifyPickup（GIFT:code）'
  },
  {
    name: 'gift_receiver_openid',
    keys: [{ field: 'giftMeta.receiverOpenid', direction: 1 }],
    why: 'listMine：我收到的礼赠'
  },
  {
    name: 'gift_giver_source_paid',
    keys: [
      { field: 'source', direction: 1 },
      { field: '_openid', direction: 1 },
      { field: 'paidTime', direction: -1 }
    ],
    why: 'listMine：我送出的礼赠（source=gift + 本人）'
  },
  {
    name: 'gift_nudge_paid_time',
    keys: [
      { field: 'status', direction: 1 },
      { field: 'paidTime', direction: 1 }
    ],
    why: 'nudgeSweep：按支付日 D+3 / D+6'
  }
]

const CONTACT_INDEXES = [
  {
    name: 'gift_contacts_owner_updated',
    keys: [
      { field: '_openid', direction: 1 },
      { field: 'updatedAt', direction: -1 }
    ],
    why: 'listContacts：本人名册'
  }
]

const DATE_INDEXES = [
  {
    name: 'gift_dates_owner',
    keys: [{ field: '_openid', direction: 1 }],
    why: 'listDates：本人日子'
  },
  {
    name: 'gift_dates_contact',
    keys: [
      { field: '_openid', direction: 1 },
      { field: 'contactId', direction: 1 }
    ],
    why: 'deleteContact 解绑日子'
  }
]

const PRODUCT_INDEXES = [
  {
    name: 'gift_scenes',
    keys: [{ field: 'giftScenes', direction: 1 }],
    why: 'getGiftSceneProducts / manageProducts.list giftScene 过滤（数组包含查询）'
  }
]

function printIndexes(collection, indexes) {
  console.log(`集合: ${collection}\n`)
  indexes.forEach((idx, i) => {
    console.log(`${i + 1}. ${idx.name}`)
    console.log(`   用途: ${idx.why}`)
    console.log(
      `   字段: ${idx.keys.map((k) => `${k.field} ${k.direction === 1 ? '升序' : '降序'}`).join(' + ')}`
    )
    console.log('')
  })
}

function main() {
  console.log('=== 礼赠索引建议（请在云开发控制台手动创建）===\n')
  console.log('环境: cloud1-8gnkty5bfff9f0bf\n')
  printIndexes('orders', ORDER_INDEXES)
  printIndexes('gift_contacts', CONTACT_INDEXES)
  printIndexes('gift_dates', DATE_INDEXES)
  printIndexes('products', PRODUCT_INDEXES)
  console.log('操作：云开发控制台 → 数据库 → 对应集合 → 索引管理 → 添加组合/单字段索引')
  console.log('另：请新建集合 gift_contacts / gift_dates（权限仅创建者可读写，云函数以管理员身份访问）')
  console.log('详见 docs/gift-ops.md')
}

main()
