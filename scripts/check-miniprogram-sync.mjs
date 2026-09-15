#!/usr/bin/env node
/**
 * 检查「代码主库」与「微信开发者工具打开的目录」是否一致。
 *
 * 为什么需要：DevTools 编译/上传的是 shanchuanspecimens，而唯一代码主库是
 * monorepo 的 miniprogram/。两者靠手工 cp 同步，一旦漏同步，**开发者工具里跑的
 * 就是旧代码**——曾经就因此让一整轮 toast 修复（icon:success → none）没有生效，
 * 而且本地静态检查全绿、完全看不出来。
 *
 * 唯一允许不同：project.miniapp.json（开发仓专有，含本地 DevTools 配置）。
 *
 * 用法：
 *   node scripts/check-miniprogram-sync.mjs             # 检查
 *   node scripts/check-miniprogram-sync.mjs --fix       # 不一致时从主库覆盖到开发仓
 * 退出码：不一致为 1（--fix 修复成功则为 0）。
 */
import { readFileSync, readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(ROOT, 'shanchuanzaowu', 'miniprogram')
const DST = join(ROOT, 'WeChatProjects', 'shanchuanspecimens')

/** 允许两仓不同（开发仓专有配置） */
const ALLOW_DIFF = new Set(['project.miniapp.json'])
const IGNORE_DIRS = new Set(['node_modules', '.git', 'miniprogram_npm'])
const IGNORE_FILES = new Set(['.DS_Store'])

function walk(base, dir = '', out = []) {
  const abs = join(base, dir)
  for (const name of readdirSync(abs)) {
    if (IGNORE_DIRS.has(name) || IGNORE_FILES.has(name)) continue
    const rel = dir ? `${dir}/${name}` : name
    if (statSync(join(abs, name)).isDirectory()) walk(base, rel, out)
    else out.push(rel)
  }
  return out
}

function main() {
  const fix = process.argv.includes('--fix')

  if (!existsSync(SRC) || !existsSync(DST)) {
    console.error(`✗ 找不到目录：\n  主库  ${SRC}\n  开发仓 ${DST}`)
    process.exit(1)
  }

  const srcFiles = new Set(walk(SRC))
  const dstFiles = new Set(walk(DST))
  const problems = []

  for (const rel of srcFiles) {
    const a = join(SRC, rel)
    const b = join(DST, rel)
    if (!existsSync(b)) {
      problems.push({ rel, kind: '开发仓缺失' })
    } else if (!readFileSync(a).equals(readFileSync(b))) {
      problems.push({ rel, kind: ALLOW_DIFF.has(rel) ? '允许差异' : '内容不一致' })
    }
  }
  for (const rel of dstFiles) {
    if (!srcFiles.has(rel)) problems.push({ rel, kind: '主库缺失（开发仓多出）' })
  }

  const real = problems.filter((p) => p.kind !== '允许差异')
  for (const p of problems) {
    const tag = p.kind === '允许差异' ? '·' : '✗'
    if (p.kind === '允许差异' && !fix) continue
    console.log(`${tag} [${p.kind}] ${p.rel}`)
  }

  if (!real.length) {
    console.log(`✓ 双仓一致（主库 ${srcFiles.size} 个文件；仅 ${[...ALLOW_DIFF].join(', ')} 为开发仓专有）`)
    return
  }

  if (fix) {
    let copied = 0
    for (const p of real) {
      if (p.kind === '主库缺失（开发仓多出）') continue
      const b = join(DST, p.rel)
      mkdirSync(dirname(b), { recursive: true })
      copyFileSync(join(SRC, p.rel), b)
      copied += 1
    }
    console.log(`\n已从主库覆盖 ${copied} 个文件到开发仓；请复跑本脚本确认。`)
    process.exit(0)
  }

  console.error(`\n双仓不一致：${real.length} 处。**开发者工具编译的是开发仓**，请先跑 --fix 再上传。`)
  process.exit(1)
}

main()
