/**
 * 极简 glob 匹配（零依赖）—— `scripts/check-workstream-ownership.mjs` 与 `scripts/worktree.mjs` 共用。
 *
 * 为什么抽成共享模块：这个匹配器一旦被复制成第二份，两份必然漂移 ——
 * 而"多副本漂移"正是本仓反复出问题的那一类（见 `docs/AI施工错题本.md` 与治理基线附录 B）。
 * 新增本文件时按 `docs` 的规矩登记，不要在两个脚本里各写一份。
 *
 * 支持：`**`（跨目录，含 0 层）、`*`（单层）、`?`（单字符）；`!` 前缀在 `owns()` 里表示排除。
 */
const CACHE = new Map()

/** glob → RegExp */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** 单条 glob 是否命中 file（带缓存） */
export function hit(glob, file) {
  if (!CACHE.has(glob)) CACHE.set(glob, globToRegExp(glob))
  return CACHE.get(glob).test(file)
}

/** 正向 glob 命中，且不被任何 `!` 否定项命中 */
export function owns(allPatterns, file) {
  const pos = []
  const neg = []
  for (const p of allPatterns || []) (p.startsWith('!') ? neg : pos).push(p.startsWith('!') ? p.slice(1) : p)
  if (neg.some((g) => hit(g, file))) return false
  return pos.some((g) => hit(g, file))
}

/** 一批 glob 里任意一条命中 file */
export const hitAny = (globs, file) => (globs || []).some((g) => hit(g, file))
