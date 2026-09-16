/**
 * 成本率解析（纯函数，零依赖 —— 便于 Node 直接单测）
 *
 * 单独成文件的理由：`storeData.js` 的依赖链会摸到 `localStorage`（storeStorage），
 * 在 Node 里 import 不了 → 这个判定就写不出测试。而它恰恰是「毛利用的是不是用户设置的值」
 * 这条业务语义的落点，必须有测试守着。
 */

/** 兜底成本率：**只有**没拿到财务设置时才会用到。凡用到它，展示文案必须写明是「默认值」。 */
export const DEFAULT_COST_RATE = 0.25

export function normalizeCostRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COST_RATE
  return n > 1 ? n / 100 : n
}

/**
 * 成本率**带出处**：财务设置里确实配了 → `source:'setting'`；没配（键缺失/非法）→ 回落默认值。
 *
 * 为什么要出处：原本文案一律写「按财务设置成本率 X% 估算」，但在「本机没有财务设置」的设备上
 * X 其实是默认 25% —— 用户读到一个自己从未设置过、却被称作「财务设置」的数字。
 * 实测：配置 60% 的设备毛利 ¥820.07；清空 localStorage 的设备按 25% 算出 ¥1,537.63（差近一倍）。
 */
export function resolveCostRate(settings) {
  const raw = settings?.costRate ?? settings?.setCostRate
  const n = Number(raw)
  if (raw == null || raw === '' || !Number.isFinite(n) || n < 0) {
    return { rate: DEFAULT_COST_RATE, source: 'default' }
  }
  return { rate: n > 1 ? n / 100 : n, source: 'setting' }
}
