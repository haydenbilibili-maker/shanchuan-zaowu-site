/**
 * AI 智能中心 · 事实护栏（2026-11-23 产品负责人：「这种纯编的内容就还是要禁止的」）
 *
 * 真机问题：采购专家回答里出现「云南那家合作三年的蝴蝶场」「账期和破损率承诺」——
 * 资料里根本没有供应商、合作年限、账期、破损率，模型自己编了一段商务细节。
 *
 * 两层拦：
 *   1) 提示词里明确列出「不得编造的类别」（见 staffPersonas 的 STAFF_SYSTEM_SUFFIX）；
 *   2) 回答落库前过一次本文件的正则体检：命中就可能是在编，先让模型**重写一次**，
 *      仍命中则给回答打 `needsVerify`，前端在气泡下提示「含资料未提供的信息，请核实」。
 *
 * 注意：这里只做「可疑」判定，不做删改——删句子会把有用的分析一起删掉，标注 + 重写更稳。
 */
const FABRICATION_RULES = [
  { key: 'supplier', label: '供应商 / 合作方', re: /[\u4e00-\u9fa5A-Za-z]{2,10}(蝴蝶场|养殖场|养殖基地|加工厂|工厂|公司|供应商|作坊|基地)/ },
  { key: 'tenure', label: '合作年限', re: /合作\s*(了)?\s*[0-9一两三四五六七八九十]+\s*(年|个月)/ },
  { key: 'terms', label: '账期', re: /账期/ },
  { key: 'breakage', label: '破损率', re: /破损率/ },
  { key: 'contract', label: '合同 / 协议条款', re: /(签订|签署|续签|合同条款|协议条款)/ },
  { key: 'policy', label: '政策 / 补贴', re: /(政府补贴|税收优惠|专项补贴|政策支持)/ }
]

function detectFabrication(text) {
  const s = String(text || '')
  const hits = []
  for (const r of FABRICATION_RULES) {
    if (r.re.test(s)) hits.push(r.label)
  }
  return hits
}

/** 命中后给模型的纠正指令（只重写一次，避免无限重试） */
const CORRECTION_PROMPT = [
  '纠正：你上一条回答里提到了资料中没有的具体对象或商务条件（供应商 / 合作年限 / 账期 / 破损率 / 合同条款 / 政策等）。',
  '请重写：只能使用我提供的经营数据与常识性方法；任何未提供的具体对象、年限、条款、比例一律不要写出，',
  '确实需要时写成「需核实」，不要给出确定性结论。'
].join('')

module.exports = { FABRICATION_RULES, detectFabrication, CORRECTION_PROMPT }
