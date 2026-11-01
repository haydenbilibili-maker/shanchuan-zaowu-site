#!/usr/bin/env bash
# 用本机微信开发者工具把多端项目打成 iOS IPA。
# 证书、描述文件、p12 密码只从参数或环境变量读取，脚本不打印密码、不把它们写入仓库。
#
# 分发（TestFlight / App Store，本机钥匙串签名）示例：
#   IOS_CERTIFICATE_NAME='Apple Distribution: Example (TEAMID)' \
#   IOS_PROFILE_PATH="$HOME/certs/Shanhai_AppStore.mobileprovision" \
#   miniprogram/scripts/build-ios-ipa.sh /tmp/shanhai-ios
# 远程构建才另外需要 IOS_REMOTE_BUILD=1、IOS_P12_PATH、IOS_P12_PASSWORD。
#
# 未准备签名材料时脚本会退出 2，并打印缺什么。不要把 p12 / mobileprovision 放进 git。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${WECHAT_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
OUT="${1:-${IOS_IPA_OUTPUT:-}}"
DIST="${IOS_DISTRIBUTE:-1}"
REMOTE="${IOS_REMOTE_BUILD:-0}"
CERT_NAME="${IOS_CERTIFICATE_NAME:-}"
PROFILE="${IOS_PROFILE_PATH:-}"
P12="${IOS_P12_PATH:-}"
P12_PASSWORD="${IOS_P12_PASSWORD:-}"
VERSION_NAME="${IOS_VERSION_NAME:-1.0.0}"
VERSION_CODE="${IOS_VERSION_CODE:-100}"
STAGE="$ROOT/miniapp/ios/distribute"
COPIED_PROFILE=""
COPIED_P12=""

cleanup() {
  # 只删除本次复制进来的签名材料，不碰调用方自己放在目录里的文件。
  # 显式 return 0，避免 EXIT trap 的非零状态盖掉脚本自己的退出码。
  if [[ -n "${COPIED_PROFILE:-}" ]]; then
    rm -f "$COPIED_PROFILE"
  fi
  if [[ -n "${COPIED_P12:-}" ]]; then
    rm -f "$COPIED_P12"
  fi
  return 0
}
trap cleanup EXIT

run_cli() {
  local log status
  log="$(mktemp)"
  set +e
  "$CLI" "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  set -e
  if grep -E -q '✖|\[error\]' "$log"; then
    rm -f "$log"
    echo "微信开发者工具报告失败。code 10 Timeout 是拉取多端 AppID 详情超时，可稍后重试。" >&2
    exit 1
  fi
  rm -f "$log"
  if [[ "$status" -ne 0 ]]; then
    exit "$status"
  fi
}

fail_blockers() {
  cat <<'EOF'
无法签名 IPA。TestFlight 需要下面这些材料，本仓库不保存其中任何密钥：

1. Apple Developer Program 会员（公司或个人，年费账号）。建议 Bundle ID：com.shanhaizaowu.app
   在 developer.apple.com → Certificates, Identifiers & Profiles → Identifiers 注册 App IDs（Explicit）。
2. Apple Distribution 证书，已安装进本机「登录」钥匙串。
   钥匙串里要能看到 “Apple Distribution: <团队名> (<TEAMID>)”，证书名原样传给 IOS_CERTIFICATE_NAME。
   只有走微信远程构建（IOS_REMOTE_BUILD=1）时才需要另导出 .p12 和密码。
3. App Store Connect 类型的 Provisioning Profile（.mobileprovision），App ID 与上面的 Bundle ID 一致，并包含该 Distribution 证书。
4. App Store Connect 里新建 App：名称「山海造物」，Bundle ID 与第 1 步相同，SKU 自定。
5. 微信侧（与 Apple 同一 Bundle ID，不能用平台测试号 com.tencent.devtoolssaaademo.db）：
   微信开发者平台 → 多端应用 → 绑定开放平台移动应用，或在未绑定时于多端控制台把 iOS Bundle ID 改成 com.shanhaizaowu.app。
   小程序 AppID：wxf2550373b010b447，原始 ID：gh_232f222c26bf。
6. 上传账号：App Store Connect 用户，外加 app 专用密码或 App Store Connect API 密钥（.p8）。不要写进仓库。

准备好之后：
  IOS_CERTIFICATE_NAME='钥匙串里的证书名' \
  IOS_PROFILE_PATH='/绝对路径/AppStore.mobileprovision' \
  miniprogram/scripts/build-ios-ipa.sh /tmp/shanhai-ios

产物目录里的 .ipa 再用 Transporter 或 xcrun altool --upload-app 传到 App Store Connect，处理完后到 TestFlight 加测试员。
步骤说明：miniprogram/docs/iOS_TestFlight_2026-11-02.md
EOF
  exit 2
}

if [[ ! -x "$CLI" ]]; then
  echo "未找到微信开发者工具 CLI：$CLI" >&2
  exit 1
fi

python3 "$ROOT/scripts/render-ios-app-assets.py" --check

if [[ -z "$OUT" ]]; then
  echo "请传入 IPA 输出目录（绝对路径）。" >&2
  fail_blockers
fi

rel_or_stage() {
  # 微信 CLI 的 profile/p12 路径相对小程序根目录。目录已 gitignore。
  local src="$1" dest_name="$2"
  case "$src" in
    "$ROOT"/*) printf '%s' "${src#"$ROOT"/}"; return ;;
  esac
  mkdir -p "$STAGE"
  cp "$src" "$STAGE/$dest_name"
  printf '%s' "miniapp/ios/distribute/$dest_name"
}

if [[ "$DIST" == "1" || "$DIST" == "true" ]]; then
  if [[ -z "$CERT_NAME" || -z "$PROFILE" || ! -f "$PROFILE" ]]; then
    echo "分发签名参数不齐（需要钥匙串证书名和 App Store mobileprovision）。" >&2
    fail_blockers
  fi
  if [[ "$REMOTE" == "1" || "$REMOTE" == "true" ]]; then
    if [[ -z "$P12" || -z "$P12_PASSWORD" || ! -f "$P12" ]]; then
      echo "远程构建还需要 p12 和 IOS_P12_PASSWORD。" >&2
      fail_blockers
    fi
  fi
  PROFILE_ARG="$(rel_or_stage "$PROFILE" "AppStore.mobileprovision")"
  if [[ "$PROFILE_ARG" == "miniapp/ios/distribute/AppStore.mobileprovision" && "$PROFILE" != "$STAGE/AppStore.mobileprovision" ]]; then
    COPIED_PROFILE="$STAGE/AppStore.mobileprovision"
  fi
  if [[ -n "$P12" ]]; then
    P12_ARG="$(rel_or_stage "$P12" "distribution.p12")"
    if [[ "$P12_ARG" == "miniapp/ios/distribute/distribution.p12" && "$P12" != "$STAGE/distribution.p12" ]]; then
      COPIED_P12="$STAGE/distribution.p12"
    fi
  fi
fi

mkdir -p "$OUT"
run_cli open --project "$ROOT" --lang zh
if [[ "$DIST" == "1" || "$DIST" == "true" ]]; then
  ARGS=(
    build-ipa
    --project "$ROOT"
    --lang zh
    --output "$OUT"
    --isDistribute true
    --profilePath "$PROFILE_ARG"
    --certificateName "$CERT_NAME"
    --isUploadBeta false
    --isUploadResourceBundle false
    --versionName "$VERSION_NAME"
    --versionCode "$VERSION_CODE"
    --versionDesc "山海造物 iOS"
  )
  if [[ "$REMOTE" == "1" || "$REMOTE" == "true" ]]; then
    ARGS+=(--isRemoteBuild true --p12Path "$P12_ARG" --p12Password "$P12_PASSWORD")
  else
    ARGS+=(--isRemoteBuild false)
  fi
  run_cli "${ARGS[@]}"
else
  run_cli build-ipa \
    --project "$ROOT" \
    --lang zh \
    --output "$OUT" \
    --isDistribute false \
    --isRemoteBuild false \
    --isUploadBeta false \
    --isUploadResourceBundle false \
    --versionName "$VERSION_NAME" \
    --versionCode "$VERSION_CODE" \
    --versionDesc "山海造物 iOS dev"
fi

echo "构建命令已结束。请在 $OUT 查看 .ipa"
