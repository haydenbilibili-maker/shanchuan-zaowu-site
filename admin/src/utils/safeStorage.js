/**
 * 「可忽略但应留痕」的统一处理。
 *
 * 背景（2026-09-16 ERP 审计 P1）：
 * 全仓一度有 151 处 `.catch(() => {})` / `catch (e) {}`。其中确实有一批**注定可忽略**
 * （图表实例 destroy、卸载时清理定时器、localStorage 在隐私模式下抛错……），
 * 但它们静默会掩盖真实问题：图表没渲染出来、偏好没保存，界面上一片安静。
 *
 * 而直接 `console.warn` 又会在高频路径（每次重渲染都 destroy 一次）刷爆控制台。
 * 所以这里做**去重告警**：同一个 label 只打印一次，既能留痕又不刷屏。
 */

const warnedLabels = new Set()

/** 去重告警：同一 label 只输出一次 */
export function safeWarn(label, err) {
  const key = String(label || 'unknown')
  if (warnedLabels.has(key)) return
  warnedLabels.add(key)
  console.warn(`[已忽略] ${key}`, (err && (err.message || err)) || '')
}

/** 供测试/重载使用：清空去重表 */
export function resetSafeWarn() {
  warnedLabels.clear()
}

/** localStorage 写入：隐私模式 / 配额满 / 被禁用时会抛错，可忽略但需留痕 */
export function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    safeWarn(`localStorage 写入失败：${key}`, e)
  }
}

/** localStorage 读取：解析失败也归入同一处理 */
export function safeLocalGet(key) {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    safeWarn(`localStorage 读取失败：${key}`, e)
    return null
  }
}

/** localStorage 删除 */
export function safeLocalRemove(key) {
  try {
    localStorage.removeItem(key)
  } catch (e) {
    safeWarn(`localStorage 删除失败：${key}`, e)
  }
}

/** 包一层可忽略调用（如 chart.destroy()、clearTimers()） */
export function safeCall(label, fn) {
  try {
    return fn()
  } catch (e) {
    safeWarn(label, e)
    return undefined
  }
}
