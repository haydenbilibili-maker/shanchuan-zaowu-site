/**
 * 在 ESM 仓里加载小程序 / 云函数的 CommonJS 真源（根 package.json 为 "type": "module"，不能直接 require .js）。
 * - 相对路径 require 递归按真源加载（注入能打到被依赖的真实现，而不是门面：错题本 E18-b）；
 * - stubs：按模块名替换（如 'wx-server-sdk'）；
 * - transform(absPath, src)：内存注入（--selftest 用），**不写盘**，共享工作区里跑也不会覆盖别人的在写内容。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function loadCjsModule(absPath, { stubs = {}, transform = null, globals = {} } = {}) {
  const cache = new Map()
  function load(file) {
    const full = file.endsWith('.js') || existsSync(file) ? file : `${file}.js`
    if (cache.has(full)) return cache.get(full).exports
    const mod = { exports: {} }
    cache.set(full, mod)
    let src = readFileSync(full, 'utf8')
    if (transform) src = transform(full, src)
    const localRequire = (name) => {
      if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name]
      if (name.startsWith('.')) return load(resolve(dirname(full), name))
      throw new Error(`cjs-loader: 未提供桩的模块 ${name}（来自 ${full}）`)
    }
    const names = Object.keys(globals)
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', ...names, src)(mod, mod.exports, localRequire, ...names.map((n) => globals[n]))
    return mod.exports
  }
  return load(absPath)
}
