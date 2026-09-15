#!/bin/bash
# 把 canonical contentSecurity.js 同步到所有接入函数
set -e
cd "$(dirname "$0")"
SRC="cloudfunctions/submitCommunityPost/contentSecurity.js"
for fn in submitComment upsertUserProfile identifySpecimen; do
  cp "$SRC" "cloudfunctions/$fn/contentSecurity.js"
done
echo "contentSecurity.js 已同步"
