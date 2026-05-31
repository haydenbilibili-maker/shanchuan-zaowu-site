/**
 * 公司治理 · 文档内化策略（分批次）
 * - 第一批：Markdown / HTML / JSX 源码直出（fetch + 渲染）
 * - 第二批：Word（.docx）浏览器端抽取为 HTML（mammoth）
 * - 第三批：PPT 等暂以说明 + 可选人工摘录（manualSummaries）渐进补齐
 */

/** @typedef {'markdown-fetch'|'html-iframe'|'jsx-code'|'docx-mammoth'|'pptx-placeholder'|'unsupported'} EmbedStrategy */

/**
 * @param {string} moduleId
 * @param {string} fileName
 * @param {string} ext lowercase extension
 * @returns {{ batch: number, batchLabel: string, strategy: EmbedStrategy }}
 */
export function getEmbedMeta(moduleId, fileName, ext) {
  if (ext === 'md') {
    return {
      batch: 1,
      batchLabel: '第一批 · Markdown 在线渲染',
      strategy: 'markdown-fetch'
    }
  }
  if (ext === 'html') {
    return {
      batch: 1,
      batchLabel: '第一批 · 网页嵌入预览',
      strategy: 'html-iframe'
    }
  }
  if (ext === 'jsx') {
    return {
      batch: 1,
      batchLabel: '第一批 · 源码阅览',
      strategy: 'jsx-code'
    }
  }
  if (ext === 'docx') {
    return {
      batch: 2,
      batchLabel: '第二批 · Word 正文抽取（页面内）',
      strategy: 'docx-mammoth'
    }
  }
  if (ext === 'pptx') {
    return {
      batch: 3,
      batchLabel: '第三批 · 演示稿（摘录逐步补齐）',
      strategy: 'pptx-placeholder'
    }
  }
  return {
    batch: 0,
    batchLabel: '暂不支持页面预览',
    strategy: 'unsupported'
  }
}

/**
 * key: `${moduleId}::${fileName}`
 * 第三批：PPT 等可在此写入 Markdown 摘录，页面内化展示
 */
export const governanceManualSummaries = {
  'ip::山海造物-IP战略投资叙事.pptx': {
    markdown: `### IP 战略投资叙事（PPT）\n\n> 原件为 **PowerPoint**，浏览器无法可靠还原版式。以下为纲要占位，便于对内对齐；详细图表请以下载文件为准。\n\n- **叙事主线**：马上有 IP 与山海造物主品牌的协同\n- **商业化**：授权、联名、门店体验三类触点（待业务填充具体数字）\n\n*摘录将持续迭代。*`
  },
  'investment-equity::山海造物-投资人路演BP.pptx': {
    markdown: `### 投资人路演 BP（PPT）\n\n> 路演幻灯片请在本地打开原件。\n\n**建议内化步骤**：按章节拆解成静态页或导出 PDF 后分批挂载。\n\n*当前为占位说明。*`
  }
}

export function getManualSummaryMarkdown(moduleId, fileName) {
  const key = `${moduleId}::${fileName}`
  return governanceManualSummaries[key]?.markdown || null
}

export function hasInlinePreview(ext) {
  return ['md', 'html', 'jsx', 'docx', 'pptx'].includes(ext)
}
