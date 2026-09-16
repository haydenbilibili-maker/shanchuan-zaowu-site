#!/bin/bash
# 同物种去重键（speciesDedupKey.js）副本一致性守卫。
#
# 为什么需要：判定逻辑被**运行时**（identifySpecimen 建记录 / 命中查询）与
# **回填脚本**（backfill-species-dedup.mjs → 云函数 action）共用；
# 若两份漂移，会出现「回填写进去的键与线上判定不一致」→ 去重静默失效。
# 真源：cloudfunctions/identifySpecimen/speciesDedupKey.js
#
# 用法：
#   bash miniprogram/scripts/sync-species-dedup.sh          # 同步
#   bash miniprogram/scripts/sync-species-dedup.sh --check  # 只检查
set -e
cd "$(dirname "$0")/.."
SRC="cloudfunctions/identifySpecimen/speciesDedupKey.js"
DIRS="identifySpecimen"
CHECK=0
[ "$1" = "--check" ] && CHECK=1
[ -f "$SRC" ] || { echo "✗ 缺少真源 $SRC"; exit 1; }

n=0; drift=""
for d in $DIRS; do
  dst="cloudfunctions/$d/speciesDedupKey.js"
  [ -d "cloudfunctions/$d" ] || continue
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
  # 行为断言：防止把判定改坏（例如把「非标本不参与去重」删掉）
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
  echo "✓ speciesDedupKey.js 副本与真源一致"
  exit 0
fi
echo "speciesDedupKey.js 已同步 $n 份"
