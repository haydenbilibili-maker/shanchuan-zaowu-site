/**
 * 左缘右滑返回 — 与店长工作台 onEdgeTouch* 阈值一致。
 * 用于 custom 导航 + 全屏 scroll-view 遮挡系统侧滑时。
 */
const EDGE_MAX_X = 40
const SWIPE_MIN_DX = 48
const SWIPE_DY_RATIO = 1.35

function edgeTouchStart(stateHolder, e) {
  const t = e.touches && e.touches[0]
  if (!t) {
    stateHolder._edgeSwipe = null
    return
  }
  stateHolder._edgeSwipe = {
    x: t.clientX,
    y: t.clientY,
    active: t.clientX <= EDGE_MAX_X,
    triggered: false
  }
}

function edgeTouchMove(stateHolder, e, onBack) {
  const state = stateHolder._edgeSwipe
  if (!state || !state.active || state.triggered) return
  const t = e.touches && e.touches[0]
  if (!t) return
  const dx = t.clientX - state.x
  const dy = t.clientY - state.y
  if (dx > SWIPE_MIN_DX && Math.abs(dx) > Math.abs(dy) * SWIPE_DY_RATIO) {
    state.triggered = true
    if (typeof onBack === 'function') onBack.call(stateHolder)
  }
}

function edgeTouchEnd(stateHolder) {
  stateHolder._edgeSwipe = null
}

module.exports = {
  EDGE_MAX_X,
  SWIPE_MIN_DX,
  SWIPE_DY_RATIO,
  edgeTouchStart,
  edgeTouchMove,
  edgeTouchEnd
}
