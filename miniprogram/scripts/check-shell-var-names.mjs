#!/usr/bin/env node
/**
 * shell 脚本「变量名粘连中文」守卫
 *
 * 为什么需要（2026-09-17 实测，同一个脚本里连炸两次）：
 *   `miniprogram/scripts/deploy-drifted.sh` 在 `set -u` 下用中文写提示语，写成
 *
 *     echo "== 2/3 逐个部署（env=$ENV_ID）=="        # ← 变量名后面直接跟全角「）」
 *     echo "✖ $name 部署失败（rc=$rc）"               # ← 同理
 *
 *   macOS 自带 bash 3.2 把 **≥0x80 的字节当作合法标识符字符**，
 *   于是它去找一个叫 `ENV_ID）`（含全角括号）的变量 → `unbound variable`。
 *
 *   后果特别隐蔽：**失败分支里的报错语句自己先炸了** ——
 *   第 73 行本来要把函数名写进 fail 清单，结果语句没执行，
 *   清单是空的、脚本继续往下跑，看起来「只是报了几行 unbound variable」。
 *   实测一次部署 17 个云函数，6 个因登录失效而失败，却因为这条 bug
 *   连「哪 6 个失败了」都没记下来，只能靠日志逐个人肉比对。
 *
 * 修法固定：`$ENV_ID` → `${ENV_ID}`（花括号把变量名封口）。
 *
 * 用法：
 *   node miniprogram/scripts/check-shell-var-names.mjs
 *   node miniprogram/scripts/check-shell-var-names.mjs --selftest
 * 退出码：存在粘连写法为 1。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'miniprogram_npm', 'public', 'backups'])

/**
 * 纯函数：找出「$VAR 紧跟非 ASCII 字符」的位置。
 * 只报**代码行**；`#` 开头的注释行跳过（注释里写 `$TARGETS：` 不会执行）。
 * @returns {{line:number, name:string, next:string, text:string}[]}
 */
export function findBadVarRefs(src) {
  const out = []
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)([^\x00-\x7F])/g
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#')) return
    let m
    re.lastIndex = 0
    while ((m = re.exec(line))) {
      out.push({ line: i + 1, name: m[1], next: m[2], text: line.trim().slice(0, 90) })
    }
  })
  return out
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.sh')) out.push(p)
  }
  return out
}

/** 扫描给定文件列表；返回 { checked, problems } */
export function scan(files = walk(ROOT)) {
  const problems = []
  let checked = 0
  for (const f of files) {
    checked += 1
    const rel = relative(ROOT, f).replace(/\\/g, '/')
    for (const h of findBadVarRefs(readFileSync(f, 'utf8'))) {
      problems.push(`${rel}:${h.line}  $${h.name} 后面紧跟「${h.next}」→ 应写成 \${${h.name}}\n      ${h.text}`)
    }
  }
  return { checked, problems }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }

  // 纯函数：正例
  t('★ 抓到 $(VAR）粘连全角括号', findBadVarRefs('echo "（env=$ENV_ID）"').length === 1)
  t('★ 抓到 $rc 粘连全角括号', findBadVarRefs('echo "失败（rc=$rc）"').length === 1)
  t('抓到粘连中文冒号', findBadVarRefs('echo "$TARGETS：x"').length === 1)
  // 纯函数：反例（不得误报）
  t('${VAR} 花括号写法不报', findBadVarRefs('echo "（env=${ENV_ID}）"').length === 0)
  t('$VAR 后跟 ASCII 不报', findBadVarRefs('echo "$ENV_ID done"').length === 0)
  t('$VAR 后跟中文但用引号隔开不报', findBadVarRefs('echo "$ENV_ID" "中文"').length === 0)
  t('注释行不报（不会执行）', findBadVarRefs('# 必须带上 $TARGETS：不带函数名…').length === 0)
  t('$1 位置参数不报', findBadVarRefs('echo "$1"').length === 0)

  // 端到端：真的写一个坏脚本，scan() 必须报出来（临时目录，不碰仓库文件）
  const dir = mkdtempSync(join(tmpdir(), 'shell-var-probe-'))
  try {
    const badSh = join(dir, 'bad.sh')
    writeFileSync(badSh, 'set -u\necho "（env=$ENV_ID）"\n')
    const res = scan([badSh])
    t('★ 端到端：坏脚本被 scan() 检出', res.problems.length === 1)
    t('  └ 问题里带行号与修法', /:2\b/.test(res.problems[0]) && res.problems[0].includes('${ENV_ID}'))

    const goodSh = join(dir, 'good.sh')
    writeFileSync(goodSh, 'set -u\necho "（env=${ENV_ID}）"\n')
    t('★ 端到端：好脚本无问题（无假阳性）', scan([goodSh]).problems.length === 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // 仓库自身必须干净
  const repo = scan()
  t(`★ 仓库 ${repo.checked} 个 shell 脚本全部干净`, repo.problems.length === 0)
  if (repo.problems.length) repo.problems.forEach((p) => console.log('      ' + p))

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：粘连检出、注释/花括号/ASCII 不误报、端到端可失败可还原')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems } = scan()
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\nshell 变量名粘连未通过：${problems.length} 处（macOS bash 会把全角括号吃进变量名 → unbound variable）`)
    process.exit(1)
  }
  console.log(`✓ shell 变量名无粘连（${checked} 个脚本）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
