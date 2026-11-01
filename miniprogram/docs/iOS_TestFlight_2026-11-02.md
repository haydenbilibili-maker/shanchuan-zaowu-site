# 山海造物 iOS（TestFlight）

日期：2026-11-02。路线：**继续微信多端（miniapp）**，不改写成别的框架。

微信开发者工具 CLI 已有 `build-ipa`，本机 Xcode 26.6 可用，多端工程也已经标了 `projectArchitecture: multiPlatform`。换框架要重做页面、云开发和支付，到不了更近的 TestFlight。签名材料齐了之后，同一条 `build-ipa` 就能出可上传的 IPA。

## 已在仓库里补上的

| 项 | 位置 |
|---|---|
| 桌面名称 | `project.miniapp.json` 的 `name` 与 `i18n/base.json`：山海造物 |
| 版本 | `1.0.0` / `versionCode` 100 |
| 图标 | `miniapp/ios/icons/` 九张。母图是方寸篆印（`docs/品牌专项/vis3/seal-standard-brass.svg`），颜色对齐 `assets/brand/seal-standard.png`（黄铜底 `#C4A76C`、字 `#4C6971`）。1024 图无透明通道 |
| 启动页 | `miniapp/ios/splash/launch.png`（1125×2436，暖白底，字标与「把山海带回家」） |
| 隐私弹窗 | `miniapp/ios/privacy.json`，`mini-ios.privacy.enable: true` |
| 系统权限文案 | 相机、相册读取、相册写入、麦克风、使用期间定位。文案与小程序内《隐私政策》一致，只声明代码里真会用到的权限 |
| 调试面板 | iOS `enableVConsole` 改为 `close`（原先 `open`，正式包会带 vConsole） |
| 扩展 SDK | iOS 打开 `WeAppMedia`（相机 / 相册 / 录音）和 `WeAppLBS`（门店距离）。`WeAppOpenFuns` 保持打开，留给微信登录、分享、支付 |
| 出口合规 | `customInfoPlist.ITSAppUsesNonExemptEncryption = false`（只用 HTTPS） |
| 重绘 | `python3 miniprogram/scripts/render-ios-app-assets.py`（本机 Chrome）。`--check` 只校验尺寸 |
| 打包 | `miniprogram/scripts/build-ios-ipa.sh` |

`project.config.json` 的 `packOptions.ignore` 已忽略 `miniapp/` 目录，这些图不会打进微信小程序上传包。

建议的正式 Bundle ID：`com.shanhaizaowu.app`。它不写在 `project.miniapp.json` 里。微信文档规定 Bundle ID 来自多端应用控制台（或绑定的开放平台移动应用）。未绑定时工具会用测试号 `com.tencent.devtoolssaaademo.db`，那种 IPA **不能**上架，也不能当作 TestFlight 的正式包。

## 离开微信之后，哪些能力还会动

启动链路没有改。`app.js` 里 `wx.cloud.init` 失败不会抛到启动流程外面；`login` 云函数失败只打日志，不挡首页。下面这些是多端壳上的产品限制，改它们会动稳定期的登录 / 支付契约，这次没有改：

| 能力 | 在 iOS App 里 |
|---|---|
| 云开发 `wx.cloud` | 多端壳可以连同一个云环境 `cloud1-8gnkty5bfff9f0bf`。身份不是小程序里的微信 OpenID，除非用户走微信开放能力登录 |
| `getPhoneNumber` 注册 | 要开放平台移动应用，且 Bundle ID 与苹果侧一致。按钮失败时现有页面只提示，不崩 |
| `wx.requestPayment` | 同上，还要在微信支付里为这个移动应用开通 App 支付。失败已有 toast |
| 定位 / 拍照 / 相册 / 录音 | 依赖上面勾选的扩展 SDK 和系统权限文案。定位仍是「已授权才读」，启动时不弹 |
| 门店名「山川造物」 | 不是 App 名。桌面和启动页用品牌名「山海造物」 |

## 本机这次没能产出 IPA

2026-11-02 在这台 Mac 上执行了：

```bash
cli open --project miniprogram
cli build-ipa --project miniprogram --output /tmp/shanhai-zaowu-ios \
  --isDistribute false --isRemoteBuild false --versionName 1.0.0 --versionCode 100
```

开发者工具已登录（`cli islogin` → `{"login":true}`）。构建停在：

```text
✖ 获取 AppID (wxf2550373b010b447) 详细信息
[error] code: 10  Error: Timeout
```

同一条命令隔了几分钟又跑了一次，仍是 code 10 Timeout，都停在「获取 AppID 详细信息」，没有进入编译。扩展 SDK 和签名因此都还没被这次构建验证。

`/tmp/shanhai-zaowu-ios` 为空，没有 `.ipa`，也没有 `.xcarchive`。命令进程退出码是 0，但日志是失败，不能当成打包成功。`build-ios-ipa.sh` 会把 CLI 输出里的 `✖` / `[error]` 当成失败并返回非 0。

同一台机器上：

- `security find-identity -p codesigning`：0 个有效签名身份
- `~/Library/MobileDevice/Provisioning Profiles`：空
- 环境变量里没有 `APPLE_*` / `ASC_*` / `FASTLANE_*`
- 没有找到 `.p12` 或 `.mobileprovision`
- 因此没有调用 Transporter / `altool`，**没有上传 TestFlight**

## 人还需要做的事

1. **Apple Developer Program** 会员（公司或个人）。在 Certificates, Identifiers & Profiles 注册 Explicit App ID：`com.shanhaizaowu.app`。
2. **Apple Distribution 证书**，装进本机「登录」钥匙串。名字类似 `Apple Distribution: <团队> (<TEAMID>)`。
3. **App Store Connect 描述文件**（`.mobileprovision`），App ID 为 `com.shanhaizaowu.app`，并勾上这张 Distribution 证书。
4. **App Store Connect 新建 App**：名称「山海造物」，Bundle ID 选上面的 ID，SKU 自定（例如 `shanhai-zaowu-ios`）。主语言简体中文。
5. **微信侧改成同一个 Bundle ID**（不要留测试号 `com.tencent.devtoolssaaademo.db`）：
   - 微信开发者平台 → 多端应用（小程序 `wxf2550373b010b447` / `gh_232f222c26bf`）
   - 未绑定移动应用时，在多端详情里把 iOS Bundle ID 改成 `com.shanhaizaowu.app`
   - 要微信登录、手机号、App 支付：再到开放平台创建移动应用，填同一 Bundle ID，审核通过后绑到多端应用
6. **上传身份**：App Store Connect 用户 + app 专用密码，或 API 密钥（Issuer ID、Key ID、`.p8`）。不要放进仓库。

证书齐了之后，在仓库根目录：

```bash
IOS_CERTIFICATE_NAME='Apple Distribution: 团队名 (TEAMID)' \
IOS_PROFILE_PATH="$HOME/certs/Shanhai_AppStore.mobileprovision" \
miniprogram/scripts/build-ios-ipa.sh /tmp/shanhai-ios
```

脚本会先跑图标尺寸校验，再用本机微信 CLI 做**本地**分发签名（`isDistribute true`、`isRemoteBuild false`）。描述文件若在仓库外，会临时复制到 `miniprogram/miniapp/ios/distribute/`（该目录的 p12 / mobileprovision 已 gitignore），构建结束删除复制件。

只有编译机不是这台 Mac、必须走微信云端 Mac 时才加：

```bash
IOS_REMOTE_BUILD=1 IOS_P12_PATH=... IOS_P12_PASSWORD=...
```

密码只留在环境变量里。

上传（处理完后到 App Store Connect → TestFlight 加测试员）：

```bash
xcrun altool --upload-app -f /tmp/shanhai-ios/*.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

或用 Mac App Store 的 Transporter 拖入 IPA。首次构建要在 App Store Connect 回答出口合规；`ITSAppUsesNonExemptEncryption` 已设为 false。隐私营养标签按小程序《隐私政策》填写：账号标识、手机号、照片、精确位置（可选）、音频（礼赠语音）。

## 重绘图标

```bash
python3 miniprogram/scripts/render-ios-app-assets.py
python3 miniprogram/scripts/render-ios-app-assets.py --check
```

需要本机 Google Chrome。只校验已提交的 PNG 时用 `--check`。
