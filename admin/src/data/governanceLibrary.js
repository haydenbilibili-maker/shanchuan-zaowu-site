/**
 * 公司治理 · 资料库清单
 * 物理文件位于 public/governance-assets/{brand|ip|social-media|franchise|investment-equity|hr-compliance}/
 * 来源归档：0428.zip（按业务子域分门别类）；人事类单文件另行挂载。
 */

export const governanceModules = [
  {
    id: 'brand',
    label: '品牌管理中心',
    en: 'BRAND',
    summary: '视觉识别、品牌叙事、展陈与门店体验、命名与合规相关沉淀。',
    icon: '🏛️',
    files: [
      { file: '山海造物-马上有-品牌说明文件.docx', blurb: '「马上有」子品牌说明' },
      { file: '山海造物-品牌说明文件.docx', blurb: '主品牌说明' },
      { file: '山海造物-品牌视觉识别手册v2.0.docx', blurb: 'VI 手册 v2' },
      { file: '山海造物-品牌视觉识别手册v1.0.docx', blurb: 'VI 手册 v1' },
      { file: '山海造物-品牌数字化运营能力说明书.docx', blurb: '数字化运营能力表述' },
      { file: '山海造物-跨门店命名方法论.docx', blurb: '跨店命名方法论' },
      { file: '会话备份-20260416-命名方法论与合规危机.md', blurb: '命名与合规讨论纪要' },
      { file: '山海造物-马上有-展陈施工方案.docx', blurb: '展陈施工完整方案' },
      { file: '山海造物-马上有-展陈施工方案Lite版.docx', blurb: '展陈施工精简版' },
      { file: '山海造物-马上有-愿望卡与纸鹤设计.docx', blurb: '互动物料设计' },
      { file: '[DEPRECATED]山海造物-跨门店神兽图鉴体系.docx', blurb: '已废弃图鉴体系（仅留档）' },
      { file: 'cursor-rules.md', blurb: 'Cursor 协作规则（工程侧）' },
      { file: 'mountain-river-operations-manual.jsx', blurb: '经营手册 JSX 源（可对接经营手册模块）' }
    ]
  },
  {
    id: 'ip',
    label: 'IP管理中心',
    en: 'IP',
    summary: 'IP 定位、投资叙事、造型规范与故事线资产。',
    icon: '🦄',
    files: [
      { file: '山海造物-IP战略投资文档.docx', blurb: 'IP 战略与投资要点' },
      { file: '山海造物-IP战略投资叙事.pptx', blurb: 'IP 投资叙事演示' },
      { file: '山海造物-马上有IP说明书.docx', blurb: '马上有 IP 说明书' },
      { file: '山海造物-马上有-IP造型设计规范.docx', blurb: '造型与延展规范' },
      { file: '马上有-一只黑马的故事.docx', blurb: 'IP 故事文案' }
    ]
  },
  {
    id: 'social-media',
    label: '自媒体管理中心',
    en: 'SOCIAL',
    summary: '公众号首发内容、增长与飞轮参考页等自媒体相关资产。',
    icon: '📣',
    files: [
      { file: '公众号首发-我们给黑马起了个名字叫马上有.md', blurb: '公众号首发稿（Markdown）' },
      { file: 'scrw_pangdonglai_flywheel_model.html', blurb: '飞轮模型参考页（HTML）' }
    ]
  },
  {
    id: 'franchise',
    label: '招商加盟管理中心',
    en: 'FRANCHISE',
    summary: '加盟政策、面向加盟商说明与综合对外说明材料。',
    icon: '🤝',
    files: [
      { file: '山海造物-加盟合作说明书.docx', blurb: '加盟合作条款与流程' },
      { file: '山海造物-加盟商说明文件.docx', blurb: '面向加盟商说明' },
      { file: '山海造物-马上有-完整说明文件.docx', blurb: '综合完整说明' }
    ]
  },
  {
    id: 'investment-equity',
    label: '投资与股权管理中心',
    en: 'CAPITAL',
    summary: '融资路演、投资说明、BP 章节与公司化股权架构；与「招商加盟」文档分列，便于合规分发。',
    icon: '📈',
    files: [
      { file: '山海造物-投资说明文件.docx', blurb: '投资说明总览' },
      { file: '山海造物-投资人详细说明文件.docx', blurb: '投资人深度材料' },
      { file: '山海造物-投资人路演文档v2.docx', blurb: '路演文档 v2' },
      { file: '山海造物-投资人路演BP.pptx', blurb: '路演 BP 演示稿' },
      { file: '山海造物-BP第四章-马上有案例版.docx', blurb: 'BP 第四章案例版' },
      { file: '山海造物-公司化股权架构方案.docx', blurb: '股权架构初版' },
      { file: '山海造物-公司化股权架构方案（终版）.docx', blurb: '股权架构终版' }
    ]
  },
  {
    id: 'hr-compliance',
    label: '人事与劳动合规',
    en: 'HR',
    summary: '劳动合同、保密与竞业附件、用工规范等人事法务类模板与定稿；与招商/投资材料分域存放，便于内部分发与权限管理。',
    icon: '📋',
    files: [
      { file: '山海造物-劳动合同书.docx', blurb: '山海造物劳动合同模板（定稿查阅请以下载原件为准）' },
      {
        file: '山海造物-劳动合同附件（保密协议+竞业限制协议）.docx',
        blurb: '劳动合同附件：保密协议与竞业限制协议（定稿以本地下载为准）',
      },
      { file: '山海造物-新员工迎新手册.docx', blurb: '新员工迎新手册（入职流程、规范与常见问题）' },
    ]
  }
]

/** public 下的目录名（与解压脚本一致） */
export const governanceFolder = (moduleId) => {
  const map = {
    brand: 'brand',
    ip: 'ip',
    'social-media': 'social-media',
    franchise: 'franchise',
    'investment-equity': 'investment-equity',
    'hr-compliance': 'hr-compliance'
  }
  return map[moduleId] || moduleId
}

export function governanceAssetUrl(moduleId, fileName) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const folder = governanceFolder(moduleId)
  return `${base}governance-assets/${folder}/${encodeURIComponent(fileName)}`
}

export function fileExt(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
