/**
 * 小程序「会被打进上传包的文件」清单：按 project.config.json 的 packOptions.ignore 排除，
 * 按 app.json subpackages[].root 归包。check:main-package-size 与 check:subpackage-size 共用，
 * 两条守卫的入包口径必须一致。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'miniprogram_npm'])

export function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function isIgnored(rel, ignoreRules) {
  const norm = String(rel || '').replace(/\\/g, '/')
  for (const rule of ignoreRules) {
    const v = String(rule.value || '').replace(/^\//, '').replace(/\\/g, '/')
    if (rule.type === 'folder') {
      if (norm === v || norm.startsWith(`${v}/`)) return true
    } else if (rule.type === 'file') {
      if (norm === v || norm.split('/').pop() === v) return true
    } else if (rule.type === 'suffix') {
      if (norm.endsWith(v)) return true
    } else if (rule.type === 'prefix') {
      const base = norm.split('/').pop() || ''
      if (base.startsWith(v) || norm.includes(`/${v}`)) return true
    }
  }
  return false
}

export function walkPacked(mpRoot, ignoreRules, dir = mpRoot, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue
    const full = join(dir, e.name)
    const rel = relative(mpRoot, full).replace(/\\/g, '/')
    if (isIgnored(rel, ignoreRules)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkPacked(mpRoot, ignoreRules, full, out)
    else if (st.isFile()) out.push(rel)
  }
  return out
}

export function packageOf(rel, subRoots) {
  const r = String(rel || '').replace(/^\//, '')
  for (const s of subRoots) {
    if (r === s || r.startsWith(`${s}/`)) return s
  }
  return 'main'
}

/** 读工程配置 → { appJson, ignoreRules, subRoots, packed } */
export function loadPackedProject(mpRoot) {
  const appJson = loadJson(join(mpRoot, 'app.json'))
  const projectConfig = loadJson(join(mpRoot, 'project.config.json'))
  const ignoreRules = (projectConfig.packOptions && projectConfig.packOptions.ignore) || []
  const subRoots = (appJson.subpackages || appJson.subPackages || []).map((s) => String(s.root || '').replace(/\/$/, ''))
  const packed = walkPacked(mpRoot, ignoreRules)
  return { appJson, ignoreRules, subRoots, packed }
}

/** 各分包源码原始字节（不含主包） */
export function subpackageRawBytes(mpRoot, subRoots, packed) {
  const out = Object.fromEntries(subRoots.map((s) => [s, 0]))
  for (const f of packed) {
    const p = packageOf(f, subRoots)
    if (p === 'main') continue
    try {
      out[p] += statSync(join(mpRoot, f)).size
    } catch {
      /* vanished — skip */
    }
  }
  return out
}
