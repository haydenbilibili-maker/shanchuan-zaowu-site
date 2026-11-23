#!/usr/bin/env node
/**
 * 博物君 · 图鉴摘要生成（2026-11-23）
 * 源：cloudfunctions/manageAtlas/catalog.js（云函数之间不能互相 require）
 * 产物：cloudfunctions/askMuseumGuide/atlasDigest.js —— 只留博物君讲解要用的字段
 *
 *   node miniprogram/scripts/build-museum-guide-atlas.mjs          写产物
 *   node miniprogram/scripts/build-museum-guide-atlas.mjs --check  只比对（test:museum-guide 也会比对）
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(MP, 'cloudfunctions/manageAtlas/catalog.js')
export const OUT = join(MP, 'cloudfunctions/askMuseumGuide/atlasDigest.js')

export function buildAtlasDigest() {
  const require = createRequire(import.meta.url)
  delete require.cache[SRC]
  const c = require(SRC)
  const seriesName = new Map(c.ATLAS_SERIES.map((s) => [s.id, s.name]))
  const species = c.ATLAS_SPECIES.map((s) => ({
    no: s.no,
    zh: s.nameZh,
    latin: s.nameLatin,
    category: s.category,
    origin: s.origin || '',
    habit: s.habit || '',
    essay: s.essay || '',
    series: (s.seriesIds || []).map((id) => seriesName.get(id)).filter(Boolean),
    aliases: Array.from(new Set([s.nameZh, s.nameLatin].concat(s.aliases || []).filter((a) => a && String(a).length >= 2)))
  }))
  const series = c.ATLAS_SERIES.map((s) => ({ name: s.name, count: s.speciesIds.length, blurb: s.blurb || '' }))
  return '/**\n * 博物君 · 山海图鉴摘要 —— 由 miniprogram/scripts/build-museum-guide-atlas.mjs 从 manageAtlas/catalog.js 生成，勿手改。\n' +
    ' * 图鉴改了之后重跑生成脚本；test:museum-guide 会比对是否过期。\n */\n' +
    `module.exports = ${JSON.stringify({ series, species }, null, 2)}\n`
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const next = buildAtlasDigest()
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (cur !== next) { console.error('✗ atlasDigest.js 已过期：重跑 node miniprogram/scripts/build-museum-guide-atlas.mjs'); process.exit(1) }
    console.log('✓ atlasDigest.js 与图鉴目录一致')
  } else {
    writeFileSync(OUT, next)
    console.log('✓ 已写 ' + OUT)
  }
}
