/**
 * 尺寸规范化（ERP 侧）
 *
 * ⚠️ **必须与小程序 `miniprogram/utils/skuSize.js` 的 `trimSizeNumber` / `formatSizeCanonical`
 * 保持同口径** —— 守卫 `npm run check:size-canonical-sync` 会逐例比对两边输出。
 *
 * 为什么单独成模块（2026-09-17）：ERP 原先在保存处手搓
 *   `${sizeL || 0}x${sizeW || 0}x${sizeH || 0} cm`
 * 两个问题：
 *   · 没填的维度被写成 0 → 库里出现 `0x0x0 cm`（C 端曾把它当有效尺寸显示出来）；
 *   · 不去小数尾零 → `21.0` 原样入库并上屏（顾客看到「29.7×21.0×厚度 4.5 厘米」）。
 * 店长端一直走共享工具，只有 ERP 是手搓的 —— 抽成模块才能被守卫逐例盯住。
 */

/** 尺寸数值归一：去掉小数尾零（21.0 → 21、4.50 → 4.5、20.00 → 20）。只处理纯「数字.数字」，A4 这类不动 */
export function trimSizeNumber(value) {
  const s = String(value == null ? '' : value).trim()
  if (!/^\d+\.\d+$/.test(s)) return s
  return s.replace(/\.?0+$/, '') || '0'
}

/** 规范化尺寸串：`LxWxH cm`；空维度不占位，全空给空串（与小程序 formatSizeCanonical 同口径） */
export function buildCanonicalSize(sizeL, sizeW, sizeH) {
  const parts = [sizeL, sizeW, sizeH].map(trimSizeNumber).filter(Boolean)
  if (!parts.length) return ''
  return `${parts.join('x')} cm`
}

/** 从任意形态的尺寸文本里取出三段（厚度/厘米/直径等词与单位先剥掉；与小程序 parseSizeParts 同口径） */
export function parseCanonicalSize(sizeStr) {
  let sizeL = ''
  let sizeW = ''
  let sizeH = ''
  const raw = String(sizeStr || '').trim()
  if (!raw) return { sizeL, sizeW, sizeH }
  const clean = raw
    .replace(/厘米/gi, '')
    .replace(/cm/gi, '')
    .replace(/(直径|高度|厚度|长度|宽度|尺寸|长|宽|高)/g, '')
    .trim()
  const parts = clean.split(/[xX×✕✖*]/).map((p) => String(p || '').trim()).filter(Boolean)
  if (parts.length === 1) {
    sizeL = parts[0]
  } else if (parts.length >= 2) {
    sizeL = parts[0] || ''
    sizeW = parts[1] || ''
    if (parts.length >= 3) sizeH = parts[2] || ''
  }
  return { sizeL, sizeW, sizeH }
}
