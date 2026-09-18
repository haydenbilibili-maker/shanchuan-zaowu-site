#!/bin/bash
# 同物种去重键（speciesDedupKey.js）副本一致性守卫。
#
# 为什么需要：判定逻辑被**运行时**（identifySpecimen 建记录 / 命中查询）与
# **回填脚本**（backfill-species-dedup.mjs → 云函数 action）共用；
# 若两份漂移，会出现「回填写进去的键与线上判定不一致」→ 去重静默失效。
# 真源：cloudfunctions/identifySpecimen/speciesDedupKey.js
#
# 用法：
#   bash miniprogram/scripts/sync-species-dedup.sh            # 同步
#   bash miniprogram/scripts/sync-species-dedup.sh --check    # 只检查
#   bash miniprogram/scripts/sync-species-dedup.sh --selftest # 注入回归 → 必须检出 → 按字节还原
#
# 2026-09-18（P0-4）两点修正：
#   ① 补 --selftest。此前本守卫挂在 check:admin 链上却没有自检，而 run-guards.mjs:126
#      把「缺自检」计为失败 → CI 的 guards-can-fail job 在每个 PR 上恒红。
#   ② **如实报告**：真源目录自己也在 DIRS 里，`cmp -s src src` 恒真 —— 那不是「副本一致」
#      而是空转。本模块当前**只有 1 份**（identifySpecimen 内即真源），所以此前那句
#      「✓ 副本与真源一致」是空头承诺。现在单副本家族会被明确标注，真正扛活的
#      是下面的**行为断言**（11 条）。
set -e

# 自检要递归调用自己，而脚本开头会 cd → 先取绝对路径
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."
SRC="cloudfunctions/identifySpecimen/speciesDedupKey.js"
DIRS="identifySpecimen"
CHECK=0; SELFTEST=0
[ "$1" = "--check" ] && CHECK=1
[ "$1" = "--selftest" ] && SELFTEST=1
[ -f "$SRC" ] || { echo "✗ 缺少真源 $SRC"; exit 1; }

n=0; drift=""

# 行为断言：防止把判定改坏（例如把「非标本不参与去重」删掉）
run_behavior() {
  node -e '
    const { buildSpeciesDedupKey } = require("./cloudfunctions/identifySpecimen/speciesDedupKey.js");
    const cases = [
      [{ species_name_latin: "Morpho menelaus", species_name_zh: "大蓝闪蝶" }, "morpho menelaus", "学名优先"],
      [{ species_name_latin: "Morpho   Menelaus" }, "morpho menelaus", "归一化"],
      [{ species_name_latin: "Morpho menelaus", species_name_zh: "蓝闪蝶" }, "morpho menelaus", "中文别名同键"],
      [{ species_name_zh: "大蓝闪蝶" }, "大蓝闪蝶", "学名缺失回落中文"],
      [{ is_specimen: false, species_name_latin: "Morpho menelaus" }, "", "非标本不参与"],
      [{ species_name_zh: "未知物种" }, "", "占位名不参与"],
      [{ species_name_zh: "蝴蝶" }, "", "★仅泛称中文不参与（否则不同物种会并成一条）"],
      [{ species_name_zh: "甲虫" }, "", "★泛称「甲虫」不参与"],
      [{ species_name_latin: "Morpho menelaus", species_name_zh: "蝴蝶" }, "morpho menelaus", "有学名时泛称中文不影响"],
      [{ species_name_zh: "大蓝闪蝶" }, "大蓝闪蝶", "具体中文名仍参与"],
      [{}, "", "空信息不参与"]
    ];
    let bad = 0;
    for (const [input, want, desc] of cases) {
      const got = buildSpeciesDedupKey(input);
      if (got !== want) { bad++; console.error(`  ✗ ${desc}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
    }
    if (bad) { console.error(`✗ speciesDedupKey 行为断言失败 ${bad}/${cases.length}`); process.exit(1); }
    console.log(`✓ speciesDedupKey 行为断言通过（${cases.length}/${cases.length}）`);
  '
}

# ── 自检：注入回归 → 必须检出 → 按字节还原 ──────────────────────────────────
ST_TMP=""; ST_MANIFEST=""
_restore_all() {
  [ -n "$ST_MANIFEST" ] && [ -f "$ST_MANIFEST" ] || return 0
  while IFS="$(printf '\t')" read -r b t; do
    [ -n "$t" ] && [ -f "$b" ] && cp -p "$b" "$t"
  done < "$ST_MANIFEST"
}
_backup() {
  local t="$1" b
  b="$ST_TMP/$(printf '%s' "$t" | tr '/' '_')"
  cp -p "$t" "$b"
  printf '%s\t%s\n' "$b" "$t" >> "$ST_MANIFEST"
}
run_check() { bash "$SELF" --check >/dev/null 2>&1; }

selftest() {
  local bad=0 out="" backup_of_src=""
  # mktemp -d = 唯一临时目录（发版审计 N5：固定临时目录互删会造成并发假失败）
  ST_TMP="$(mktemp -d)"
  ST_MANIFEST="$ST_TMP/manifest"; : > "$ST_MANIFEST"
  trap '_restore_all; rm -rf "$ST_TMP"' EXIT

  st() { if [ "$1" = "0" ]; then echo "✓ $2"; else echo "✗ $2"; bad=$((bad+1)); fi }

  # ① 基线必须通过
  if run_check; then st 0 "基线：行为断言 + 副本检查通过"; else st 1 "基线：行为断言 + 副本检查通过"; fi

  backup_of_src="$ST_TMP/$(printf '%s' "$SRC" | tr '/' '_')"
  _backup "$SRC"

  # ② 注入「判定被放宽」：学名/中文原样返回、不再排除泛称与非标本 → 必须检出
  printf 'module.exports = { buildSpeciesDedupKey: (i) => (i && (i.species_name_latin || i.species_name_zh)) || "" };\n' > "$SRC"
  if run_check; then
    st 1 "★ 被检出：判定被放宽（泛称/非标本不再排除）"
  else st 0 "★ 被检出：判定被放宽（泛称/非标本不再排除）"; fi
  _restore_all
  if cmp -s "$backup_of_src" "$SRC"; then st 0 "★ 按字节还原（不是 git checkout）"; else st 1 "★ 按字节还原（不是 git checkout）"; fi

  # ③ 注入「判定被收紧」：一律返回空 → 必须检出（证明断言两个方向都拦得住）
  printf 'module.exports = { buildSpeciesDedupKey: () => "" };\n' > "$SRC"
  if run_check; then
    st 1 "★ 被检出：判定被收紧（一律返回空键）"
  else st 0 "★ 被检出：判定被收紧（一律返回空键）"; fi
  _restore_all
  if cmp -s "$backup_of_src" "$SRC"; then st 0 "★ 二次还原字节一致"; else st 1 "★ 二次还原字节一致"; fi

  # ④ 还原后必须恢复通过
  if run_check; then st 0 "★ 还原后守卫恢复通过"; else st 1 "★ 还原后守卫恢复通过"; fi

  # ⑤ 单副本家族必须被如实标注，不许冒充「一致性通过」
  out="$(bash "$SELF" --check 2>&1 || true)"
  if printf '%s' "$out" | grep -q "单副本家族"; then
    st 0 "★ 单副本家族被如实标注（不冒充一致性通过）"
  else st 1 "★ 单副本家族被如实标注（不冒充一致性通过）"; fi

  if [ "$bad" != "0" ]; then echo; echo "自检失败 $bad 项——守卫不可信"; exit 1; fi
  echo; echo "自检通过：2 个回归注入全部被检出，且按字节还原"
}

if [ "$SELFTEST" = "1" ]; then selftest; exit 0; fi

# ── 主流程 ──────────────────────────────────────────────────────────────
# 排除真源自己（自比恒真）；把真正的副本数单独计数，好让 --check 如实报告
TARGETS=0
for d in $DIRS; do
  [ -d "cloudfunctions/$d" ] || continue
  dst="cloudfunctions/$d/speciesDedupKey.js"
  [ "$dst" = "$SRC" ] && continue
  TARGETS=$((TARGETS+1))
  if [ -f "$dst" ] && cmp -s "$SRC" "$dst"; then continue; fi
  if [ "$CHECK" = "1" ]; then drift="$drift $d"; continue; fi
  cp "$SRC" "$dst"; n=$((n+1)); echo "  同步 → $dst"
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ speciesDedupKey.js 与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-species-dedup.sh"
    exit 1
  fi
  if [ "$TARGETS" = "0" ]; then
    echo "· speciesDedupKey.js：单副本家族（真源即唯一副本，无同步目标）——本行**不是**「一致性通过」"
  else
    echo "✓ speciesDedupKey.js 全部 $TARGETS 份副本与真源一致"
  fi
  run_behavior
  exit 0
fi
echo "speciesDedupKey.js 已同步 $n 份"
