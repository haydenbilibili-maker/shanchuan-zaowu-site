/**
 * 腾讯云 CSS / 云直播推拉流地址（鉴权 txSecret）
 * 环境变量见 docs/live-streaming.md
 */
const crypto = require('crypto')

function readConfig() {
  return {
    pushDomain: String(process.env.LIVE_PUSH_DOMAIN || '').trim(),
    playDomain: String(process.env.LIVE_PLAY_DOMAIN || '').trim(),
    appName: String(process.env.LIVE_APP_NAME || 'live').trim() || 'live',
    authKey: String(process.env.LIVE_AUTH_KEY || '').trim(),
    authExpireSec: Math.max(300, Number(process.env.LIVE_AUTH_EXPIRE_SEC) || 86400)
  }
}

function isConfigured(cfg) {
  return !!(cfg.pushDomain && cfg.playDomain)
}

function buildAuthQuery(streamName, authKey, expireSec) {
  if (!authKey) return ''
  const txTime = Math.floor(Date.now() / 1000 + expireSec).toString(16).toUpperCase()
  const txSecret = crypto
    .createHash('md5')
    .update(String(authKey) + String(streamName) + txTime)
    .digest('hex')
  return `txSecret=${txSecret}&txTime=${txTime}`
}

function buildStreamUrls(streamName, cfgInput) {
  const cfg = cfgInput || readConfig()
  const name = String(streamName || '').trim()
  if (!name) {
    return { configured: false, pushUrl: '', pullUrl: '', pullUrlRtmp: '', msg: '缺少 streamName' }
  }
  if (!isConfigured(cfg)) {
    return {
      configured: false,
      pushUrl: '',
      pullUrl: '',
      pullUrlRtmp: '',
      msg: '未配置 LIVE_PUSH_DOMAIN / LIVE_PLAY_DOMAIN'
    }
  }
  const q = buildAuthQuery(name, cfg.authKey, cfg.authExpireSec)
  const suffix = q ? `?${q}` : ''
  const app = cfg.appName
  return {
    configured: true,
    pushUrl: `rtmp://${cfg.pushDomain}/${app}/${name}${suffix}`,
    // live-player 优先 HTTPS-FLV
    pullUrl: `https://${cfg.playDomain}/${app}/${name}.flv${suffix}`,
    pullUrlRtmp: `rtmp://${cfg.playDomain}/${app}/${name}${suffix}`,
    msg: ''
  }
}

function makeStreamName() {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `sh_${ts}_${rand}`
}

module.exports = {
  readConfig,
  isConfigured,
  buildStreamUrls,
  makeStreamName
}
