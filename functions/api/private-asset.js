/**
 * Cloudflare Pages Function · /api/private-asset?name=<文件名>
 *
 * 超管登录后可看的内部资料（资本架构沙盘 / 启动成本模型 / 合伙人命理中心）。
 * 白名单与响应头见 functions/_lib/privateAsset.mjs；内容以文本模块打进 Function 包，
 * 源文件在 admin/public/governance-assets/erp-embeds/（构建后剔除，不在公开 dist 里）。
 */
import { guardAdminRequest } from '../_lib/proxySession.mjs'
import { privateJson, servePrivateAsset } from '../_lib/privateAsset.mjs'
import capitalSandbox from '../../admin/public/governance-assets/erp-embeds/shanhai-capital-architecture-sandbox.html'
import startupCostModel from '../../admin/public/governance-assets/erp-embeds/shanhai-studio-startup-cost-model.html'
import partnerDestiny from '../../admin/public/governance-assets/erp-embeds/partner-destiny-center.html'

const ASSETS = {
  'shanhai-capital-architecture-sandbox.html': capitalSandbox,
  'shanhai-studio-startup-cost-model.html': startupCostModel,
  'partner-destiny-center.html': partnerDestiny,
}

export async function onRequest(context) {
  const { request, env } = context
  const gate = await guardAdminRequest(request, env)
  if (!gate.ok) return privateJson(gate.body, gate.status)
  return servePrivateAsset(request, ASSETS)
}
