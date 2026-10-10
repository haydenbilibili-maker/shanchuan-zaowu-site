// AI 鉴定失败弹窗文案：区分「识别服务异常」与「没认出来」
// error_type 与云函数 identifySpecimen/aiModels.js 的 AI_SERVICE_ERROR 同值；
// 旧版云函数不带该字段时，超时 / 未配密钥 / 调用失败也按服务异常处理。
const AI_SERVICE_ERROR = 'ai_service'

const SERVICE_COPY = {
  title: '鉴定服务暂时繁忙',
  content: '这次不是照片的问题，不用重拍。鉴定服务暂时有些忙，请稍后再试一次。'
}

const NOT_RECOGNIZED_COPY = {
  title: '这是还没被记录过的影子',
  content: '镜头没有认出这一次。换一束光，或换一个角度。它还在那里。'
}

function isServiceFailure(err) {
  if (err && err.errorType === AI_SERVICE_ERROR) return true
  const raw = String((err && (err.message || err.errMsg)) || '')
  return /504003|FUNCTIONS_TIME_LIMIT_EXCEEDED|timed? ?out|callFunction:fail|未配置 AI 密钥|DASHSCOPE/i.test(raw)
}

function identifyFailureCopy(err) {
  return isServiceFailure(err) ? SERVICE_COPY : NOT_RECOGNIZED_COPY
}

module.exports = {
  AI_SERVICE_ERROR,
  SERVICE_COPY,
  NOT_RECOGNIZED_COPY,
  isServiceFailure,
  identifyFailureCopy
}
