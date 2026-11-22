/**
 * 证书打印动画的收尾时机（2026-11-22 产品负责人「动画很好但是时间特别快，还没看清楚就跳到证书页」）
 *
 * 纸张动画 cp-feed（index.wxss）一圈 3200ms：0→68% 从出纸口吐出，68→88% 整张停住，88→100% 淡出换下一张。
 * 证书好了也要等到「整张纸停住」的那一段再收尾 —— 否则要么一闪而过，要么纸吐到一半被硬切。
 * 收尾 = 纸定格 + 「打印完成」停 PRINT_HOLD_MS，再翻到证书。纯函数，守卫在内存里求值。
 */
const FEED_CYCLE_MS = 3200
const FEED_REST_FROM = 0.68
const FEED_REST_TO = 0.88
const PRINT_HOLD_MS = 900

/**
 * 从动画开始已过 elapsedMs，还要等多久才进入「整张纸停住」的窗口。
 * 第一张纸没吐完之前永远不收尾（最少看完一张）。
 */
function printWaitMs(elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0)
  const from = FEED_CYCLE_MS * FEED_REST_FROM
  const to = FEED_CYCLE_MS * FEED_REST_TO
  const phase = t % FEED_CYCLE_MS
  if (phase >= from && phase < to) return 0
  if (phase < from) return Math.round(from - phase)
  return Math.round(FEED_CYCLE_MS - phase + from)
}

module.exports = { FEED_CYCLE_MS, FEED_REST_FROM, FEED_REST_TO, PRINT_HOLD_MS, printWaitMs }
