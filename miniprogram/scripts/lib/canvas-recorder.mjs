/**
 * 记录 canvas 2d 绘制指令（属性写入 + 方法调用），用于「绘制是否与金样一致」的无浏览器判据。
 * 数值统一保留 3 位小数，避免浮点尾差造成假失败。
 */
const PROPS = new Set([
  'fillStyle', 'strokeStyle', 'font', 'letterSpacing', 'textAlign', 'textBaseline',
  'lineWidth', 'globalAlpha'
])

function norm(v) {
  if (typeof v === 'number') return Math.round(v * 1000) / 1000
  if (v && typeof v === 'object') return v.__img ? `img:${v.src}` : '[obj]'
  return v
}

export function makeRecorderCtx() {
  const ops = []
  const state = {}
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === '__ops') return ops
      if (PROPS.has(key)) return target[key]
      return (...args) => { ops.push([String(key), ...args.map(norm)]) }
    },
    set(target, key, value) {
      target[key] = value
      if (PROPS.has(key)) ops.push([`=${String(key)}`, norm(value)])
      return true
    }
  })
  return { ctx, ops }
}

/** 最小 canvas 桩：createImage 立即 onload，宽高固定 */
export function makeStubCanvas() {
  return {
    createImage() {
      const img = { __img: true, width: 600, height: 400 }
      Object.defineProperty(img, 'src', {
        set(v) { img._src = v; setTimeout(() => img.onload && img.onload(), 0) },
        get() { return img._src }
      })
      return img
    }
  }
}
