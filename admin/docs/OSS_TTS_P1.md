# 开源 TTS P1（CosyVoice 风格）· 「马上有」

最小侵入接入：与阿里云 NLS **平行**，不改坏现有路径。上游未启动时安静降级。

## 播报优先级

1. **开源 TTS**（`/api/oss-tts/*`，本机 CosyVoice 或生产网关）
2. **阿里云 NLS**（`/api/aliyun-nls/*`）
3. **Web Speech**（浏览器）

取消逻辑仍用 `companionSpeakSeq` + `haltCompanionTtsPlaybackNoSeqBump`（含 PCM 伪 Audio 的 `pause()`）。

## P1 形态说明

- LLM 仍整段返回；前端 **按句切分** → 多次 `synthesize` → **顺序播放**。
- 上游若返回 `audio/wav` / `audio/mpeg`：`<audio>` 播放（主路径）。
- 上游若返回 `audio/pcm` / `audio/L16`：`AudioContext` 队列播放。
- 可选先试 `/api/oss-tts/stream`，失败回落 `synthesize`。
- **未假设本机已跑 CosyVoice**：`GET /api/oss-tts/status` 报告 `unavailable` 时前端直接降级，不打断对话。

## 环境变量

| 变量 | 用途 |
|------|------|
| `OSS_TTS_ENABLED=1` | Dev 启用 Vite 代理 |
| `OSS_TTS_UPSTREAM` | 上游根地址，如 `http://127.0.0.1:50000` |
| `OSS_TTS_MOCK=1` | 不连上游，返回极短静音 WAV（接线验证） |
| `OSS_TTS_API_STYLE` | `auto`（先 OpenAI 再 SFT）/ `sft` / `openai` |
| `OSS_TTS_SFT_PATH` | 默认 `/inference_sft` |
| `OSS_TTS_OPENAI_PATH` | 默认 `/v1/audio/speech` |
| `OSS_TTS_VOICE` | 默认发音人 / `spk_id` |
| `OSS_TTS_PROBE_PATH` | status 探测路径（可选） |
| `VITE_OSS_TTS_API_BASE` | 生产同源网关前缀（无末尾斜杠） |
| `VITE_OSS_TTS_VOICE` | 前端透传 voice |
| `VITE_OSS_TTS_SAMPLE_RATE` | PCM 采样率，默认 22050 |

写入 `admin/.env`（参考 `.env.example`），重启 `npm run dev:admin`。

## 同源 API

- `GET /api/oss-tts/status` → `{ ok, mode, upstream, message? }`
- `POST /api/oss-tts/synthesize` body `{ text, voice? }` → `audio/wav` | `audio/mpeg` | PCM
- `POST /api/oss-tts/stream` 同上（上游支持时）；否则 502，前端回落 synthesize

## 对接 CosyVoice HTTP

常见两种（由 `OSS_TTS_API_STYLE` 选择）：

### 1) OpenAI-compatible

```http
POST {UPSTREAM}/v1/audio/speech
Content-Type: application/json

{ "model": "cosyvoice", "input": "你好", "voice": "中文女", "response_format": "wav" }
```

### 2) SFT 推理

```http
POST {UPSTREAM}/inference_sft
Content-Type: application/json

{ "tts_text": "你好", "spk_id": "中文女" }
```

代理会把前端的 `{ text, voice }` 映射到上述字段。路径可用 `OSS_TTS_SFT_PATH` / `OSS_TTS_OPENAI_PATH` 覆盖。

### 本机启动（示例）

以你实际部署的 CosyVoice HTTP 服务为准（官方 demo / 社区 FastAPI 包装均可），保证 `OSS_TTS_UPSTREAM` 可访问后：

```bash
# admin/.env
OSS_TTS_ENABLED=1
OSS_TTS_UPSTREAM=http://127.0.0.1:50000
OSS_TTS_API_STYLE=auto
```

无 GPU / 未部署时用 mock 验接线：

```bash
OSS_TTS_MOCK=1
```

然后打开经营助理播报一句；Network 应出现 `/api/oss-tts/status`（ok）与 `/api/oss-tts/synthesize`（audio/wav）。关掉 mock、上游未启动时，status 为 unavailable，自动走 NLS/Web Speech。

## 代码位置

| 文件 | 角色 |
|------|------|
| `admin/scripts/viteOssTtsPlugin.mjs` | Dev/Preview 代理 + mock |
| `admin/src/utils/ossCompanionTts.js` | 前端客户端 |
| `admin/src/components/CompanionRobot.vue` | `speakTextEnhanced` 优先级 |
| `admin/src/utils/aliyunCompanionTts.js` | 阿里云路径（未改破坏性逻辑） |

## 已知限制

- 非真·token 流式 LLM；P1 是句级分块 TTS。
- CosyVoice 部署差异大，需按实际 API 调 `API_STYLE` / path。
- 生产静态托管需自建网关转发 `/api/oss-tts/*`，并设 `VITE_OSS_TTS_API_BASE`。
- Mock 只有静音，用于验证路由而非听感。
