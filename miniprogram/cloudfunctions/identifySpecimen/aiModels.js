/**
 * 鉴定用的大模型清单（阿里云百炼 DashScope）。按顺序尝试：前一个调用失败就换下一个。
 *
 * 2026-10-10 百炼按公告下线 qwen-vl-plus / qwen-turbo，模型名写死在代码里 → 线上全部「Model not exist.」。
 * 所以：模型名可用云函数环境变量覆盖（逗号分隔，排在默认清单前面），默认清单至少两个、互为备用。
 *   IDENTIFY_VISION_MODELS  看图识别（必须是支持图片输入的模型）
 *   IDENTIFY_TEXT_MODELS    科普文案（走 text-generation 接口：qwen3.5/3.6 等新模型在该接口报「url error」，只能放 qwen-flash / qwen-plus 这类纯文本模型）
 * 换模型前先用真实标本图实测能返回合法 JSON；百炼下线公告见 help.aliyun.com/zh/model-studio/model-depreciation
 */
const DEFAULT_VISION_MODELS = ['qwen3.6-flash', 'qwen3.7-plus']
const DEFAULT_TEXT_MODELS = ['qwen-flash', 'qwen-plus']

function modelChain(envValue, defaults) {
  const fromEnv = String(envValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out = []
  fromEnv.concat(defaults).forEach((m) => {
    if (out.indexOf(m) === -1) out.push(m)
  })
  return out
}

function visionModels() {
  return modelChain(process.env.IDENTIFY_VISION_MODELS, DEFAULT_VISION_MODELS)
}

function textModels() {
  return modelChain(process.env.IDENTIFY_TEXT_MODELS, DEFAULT_TEXT_MODELS)
}

/** 模型本身不可用（下线 / 改名 / 账号无权限）：同一模型换图片传法也没用，直接换下一个模型 */
function isModelUnavailable(err) {
  const status = err && err.statusCode
  const code = String((err && err.code) || '')
  const msg = String((err && err.message) || '')
  if (status === 404) return true
  if (/ModelNotFound|Model\.AccessDenied|ModelUnavailable/i.test(code)) return true
  return /Model not exist|model.*(not found|not exist|access denied|unavailable)/i.test(msg)
}

module.exports = {
  DEFAULT_VISION_MODELS,
  DEFAULT_TEXT_MODELS,
  modelChain,
  visionModels,
  textModels,
  isModelUnavailable
}
