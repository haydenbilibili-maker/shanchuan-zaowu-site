// 祈福墙（旧页）· 2026-10-17 退场为转跳薄壳（产品负责人：「历史版本本身不满意，需要果断清理」）
// 「马上有 · 心愿签」（subpackages/feature/wish-labels）已替代本页（蓝图 docs/马上有心愿签_重设计蓝图_2026-10-13.md §5 第 4 步）。
// 本路径必须保留：门店已印的小程序码、旧分享卡、横幅都指向这里 —— 参数（含 scene）原样转给新页；
// 旧玩法深链 play=qian 直达今日一签，其余玩法已下线（落到心愿签）。
const { WISH_LABELS_PATH } = require('../../../utils/wishWall')

const QIAN_PATH = '/subpackages/plays/play-qian/index?from=wish_labels'

Page({
  onLoad(options) {
    const opts = options || {}
    const q = Object.keys(opts).filter((k) => opts[k] != null && k !== 'play' && k !== 'legacy')
      .map((k) => `${k}=${encodeURIComponent(String(opts[k]))}`).join('&')
    const url = opts.play === 'qian' ? QIAN_PATH : `${WISH_LABELS_PATH}${q ? '?' + q : ''}`
    wx.redirectTo({ url, fail: () => wx.reLaunch({ url }) })
  }
})
