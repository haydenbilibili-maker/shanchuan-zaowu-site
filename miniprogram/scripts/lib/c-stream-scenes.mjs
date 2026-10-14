/**
 * render-c-stream-preview.mjs 的场景表：结构一律从真 wxml 现读，样例数据只填版式需要的字段。
 * 每轮在这里追加 / 替换本轮要交付的场景。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = process.env.C_STREAM_MP || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(MP, rel), 'utf8')

const HUB = 'subpackages/manager/manager/index.wxml'
const WS = 'subpackages/manager/manager/workspace/index.wxml'
const SUB = 'subpackages/manager/manager/workspace/_subviews.wxml'
const AP = 'subpackages/extra/approvals/index.wxml'
const MGR_CSS = ['subpackages/manager/manager/workspace/index.wxss']
const AP_CSS = ['subpackages/extra/approvals/index.wxss']
const FIELD = 'subpackages/extra/staff/field/index.wxml'
const FIELD_CSS = ['subpackages/extra/staff/field/index.wxss']
const fieldBase = {
  ready: true, storeName: '山海造物', member: null, candidates: [], showMemberPassResult: false, pickupCodeInput: '',
  mineSummary: { count: 0, points: 0, amount: '0.00' }, canRevoke: false
}
const PAYSLIP = 'subpackages/manager/payslip/index.wxml'
const payslipData = {
  ready: true, roleHint: '店员', list: [{ _id: 'p1', month: '2026-09', net: '6,420.00' }, { _id: 'p2', month: '2026-08', net: '6,180.00' }],
  showSalesShare: true,
  salesShare: {
    storeScopeLabel: '山海造物 + 星宸', yearMonth: '2026-09', revenueScopeLabel: '本月营业额', monthRevenueFmt: '238,400.00', mallFeeFmt: '6,840.00',
    mallByStore: [{ storeId: 'a', name: '山海造物', detailText: '营业额 196,400 · 超 17 万部分 × 26%', mallFeeFmt: '6,864.00' }, { storeId: 'b', name: '星宸', detailText: '营业额 42,000 · 未达 17 万', mallFeeFmt: '0.00' }],
    shareBaseFmt: '231,560.00', rateLabel: '1.5%', shareAmountFmt: '3,473.40', formulaNote: '分成 = （营业额 − 商场抽成）× 比例'
  },
  showDetail: true,
  detail: { month: '2026-09', hasItems: true, items: [{ name: '基本工资', amount: '5,000.00', kind: 'add' }, { name: '销售分成', amount: '1,620.00', kind: 'add' }, { name: '社保个人', amount: '200.00', kind: 'deduct' }], grossDisplay: '6,620.00', deductDisplay: '200.00', net: '6,420.00' }
}
// 工资条样式已内联（第 3 轮）：改前对照图用 HEAD~ 的 @import 链临时出，逐像素一致
const PAYSLIP_AFTER_CSS = ['subpackages/manager/payslip/index.wxss']

// 页头（门店 / 今日汇总 / 灯语图例）本轮没动，截图隐藏以聚焦 Tab 内容
const FIELD_FOCUS_CSS = '.header { display: none; }'

function cutBetween(src, start, end) {
  const s = src.indexOf(start)
  if (s < 0) throw new Error(`锚点缺失：${start}`)
  const e = end ? src.indexOf(end, s + start.length) : -1
  return src.slice(s, e < 0 ? undefined : e)
}

function tabBlock(n) {
  const src = read(SUB)
  const start = `<block wx:if="{{curTab===${n}}}">`
  const s = src.indexOf(start)
  if (s < 0) throw new Error(`找不到 curTab===${n}`)
  const e = src.indexOf('<block wx:if="{{curTab===', s + start.length)
  return `<view class="container workspace-leaf"><view class="content-area sub-view">${src.slice(s, e)}</view></view>`
}

const ledgerRow = (day, date, net) => ({
  _id: date, day, date, totalFmt: net, posFmt: '3,120.00', cashBalanceFmt: '860.00', onlineFmt: '0.00',
  refundFmt: '0.00', mpOnlineFmt: '1,288.00', mpRefundFmt: '0.00', pledgeDueFmt: '12.88', mpNetFmt: '1,288.00'
})
const ledgerBase = {
  curTab: 8, isSuperAdmin: true, ledgerMonth: '2026-10', ledgerMonthLabel: '2026年10月',
  ledgerStoreId: 'a', ledgerStoreOptions: [{ storeId: 'a', name: '山海造物' }, { storeId: 'b', name: '星宸标本工作室' }],
  ledgerOverview: { empty: true }, ledgerSyncLampClass: 'lamp-muted'
}

const apItem = (id, title, extra = {}) => ({
  _id: id, title, status: 'pending', statusText: '待审核', actionLabel: '报销', summary: '门店耗材 · ¥128.00',
  metaLine: '店员 小林 · 今天 14:20', canDecide: true, canIgnore: false, detailLines: [], showAttachmentBlock: false, ...extra
})

export const SCENES = [
  /* ── 2026-10-14 藏品库「风险管理」独立 tab（产品负责人：抽象成独立顶部 tab + 丰富能力）──
     ⚠️ 数字是**线上真数据**（2026-10-14 用只读探针 .tmp/probe-risk-tiers.mjs 从 products/categories 实测）：
        全库 255 / 高风险 11（三有 0 · 保护植物 1 · 保护动物 10，全部已下架）/
        中等风险 216（学名属动物界 201 · 按分类兜底 15；在架 204 · 已下架 12）/ 普通 28；
        「收藏证书」244/255 为空，但**高风险 11 件一件不缺**（这 11 件的来源材料是做到位的）。
     上一版这里写的是 highRiskCount 3 / mediumRiskCount 12 —— 那是**版式占位数字**，
     产品负责人真机看到 216 后当场质疑「跟你之前判断的 12 件不符」。
     ⚠️ 教训：**渲染台的样例数字是给产品负责人看的，不许当真实数据用**，所以这一次用实测值。 */
  (() => {
    const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
    const riskRow = (id, title, o) => ({
      _id: id, title, price: o.price || '399', images: [pic],
      riskTier: o.tier, riskTierLabel: o.tierLabel, riskBasisLabel: o.basis || '',
      riskLabel: o.riskLabel || '', isHighRisk: o.tier === 'high',
      inArchive: true, isOneOfAKind: !!o.one, hasSku: false,
      rootCategoryName: o.root, category: o.cat,
      isOffShelf: !!o.off, shelfApprovalStatus: o.st || '',
      shelfWm: o.wm || '', shelfWmClass: o.wmClass || ''
    })
    // 线上实测回包（原样，不做四舍五入也不做美化）
    const overview = {
      scanned: 255, truncated: false, generatedAtMs: Date.now(),
      all: { total: 255, on: 231, pending: 0, rejected: 0, off: 24, missingCert: 244 },
      tiers: {
        high: { total: 11, on: 0, pending: 0, rejected: 0, off: 11, missingCert: 0, byProtection: { sanyou: 0, protected_plant: 1, protected_animal: 10 } },
        medium: { total: 43, on: 37, pending: 0, rejected: 0, off: 6, missingCert: 43, byGroup: [
          { name: '爬行纲', count: 20 }, { name: '哺乳纲', count: 12 }, { name: '鸟纲', count: 7 },
          { name: '两栖纲', count: 2 }, { name: '辐鳍鱼纲', count: 1 }, { name: '头足类', count: 1 }
        ] },
        normal: { total: 201, on: 194, pending: 0, rejected: 0, off: 7, missingCert: 201 }
      }
    }
    return {
      name: 'r10-lib-risk', h: 2100, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'risk', artisanEmbed: false,
        highRiskCount: 11, mediumRiskCount: 43, expiredSeckillCount: 1,
        riskOverview: overview, riskOverviewLoading: false, riskOverviewError: false,
        riskShelfCounts: { all: 255, on: 231, pending: 0, rejected: 0, off: 24 },
        productShelfCounts: { all: 255, on: 231, pending: 0, rejected: 0, off: 24 },
        productArchiveFilter: 'all', productPromoFilter: 'all', productRiskFilter: 'all', productShelfFilter: 'all',
        searchVal: '', productSort: 'new', productPriceSortLabel: '价格',
        productSortOptions: [{ key: 'new', label: '最新' }, { key: 'sales', label: '销量' }, { key: 'price', label: '价格', isPrice: true }],
        bulkRiskRunning: '', riskCopyRunning: false,
        products: [
          riskRow('p1', '暹罗鳄标本 · 树脂封存', { tier: 'high', tierLabel: '高风险', riskLabel: '保护动物', root: '动物馆', cat: '爬行纲', off: true, wm: '已下架', wmClass: 'offshelf' }),
          riskRow('p2', '红豆杉植物标本框', { tier: 'high', tierLabel: '高风险', riskLabel: '保护植物', root: '植物馆', cat: '裸子植物', off: true, wm: '已下架', wmClass: 'offshelf' }),
          // 中等风险只认「动物馆」分类（2026-10-14 收窄）—— 所以样本都是动物馆下的脊椎动物
          riskRow('p3', '鬃狮蜥标本 · 生态框', { tier: 'medium', tierLabel: '中等风险', basis: '所属分类：动物馆', root: '动物馆', cat: '爬行纲', wm: '已上架', wmClass: 'approved' }),
          riskRow('p4', '孔雀标本 · 立姿', { tier: 'medium', tierLabel: '中等风险', basis: '所属分类：动物馆', root: '动物馆', cat: '鸟纲', off: true, wm: '已下架', wmClass: 'offshelf' }),
          riskRow('p5', '侏儒兔标本 · 树脂封存', { tier: 'medium', tierLabel: '中等风险', basis: '所属分类：动物馆', root: '动物馆', cat: '哺乳纲', one: true, wm: '已上架', wmClass: 'approved' }),
          // 对照：昆虫馆的蝴蝶在**旧**口径（动物界）里算中等风险，收窄后归「普通」——
          // 这一行就是「缩小覆盖面」在界面上的样子
          riskRow('p6', '大蓝闪蝶 · 原木框', { tier: 'normal', tierLabel: '普通', root: '昆虫馆', cat: '鳞翅目 · 蝴蝶', wm: '已上架', wmClass: 'approved' })
        ],
        productTotal: 255, productHasMore: true, productListLoading: false, productListError: false
      }
    }
  })(),
  // 切到「中等风险」+ 上架态仍是「全部」：证书风险条的件数、上架态计数都跟着分层走
  (() => {
    const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
    const row = (id, title, o) => ({
      _id: id, title, price: '399', images: [pic],
      riskTier: 'medium', riskTierLabel: '中等风险', riskBasisLabel: o.basis,
      riskLabel: '', isHighRisk: false, inArchive: true, isOneOfAKind: false, hasSku: false,
      rootCategoryName: o.root, category: o.cat, isOffShelf: !!o.off, shelfApprovalStatus: '',
      shelfWm: o.off ? '已下架' : '已上架', shelfWmClass: o.off ? 'offshelf' : 'approved'
    })
    return {
      name: 'r10-lib-risk-medium', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'risk', artisanEmbed: false,
        highRiskCount: 11, mediumRiskCount: 43, expiredSeckillCount: 0,
        riskOverview: {
          scanned: 255, truncated: false,
          all: { total: 255, on: 231, pending: 0, rejected: 0, off: 24, missingCert: 244 },
          tiers: {
            high: { total: 11, on: 0, pending: 0, rejected: 0, off: 11, missingCert: 0, byProtection: { sanyou: 0, protected_plant: 1, protected_animal: 10 } },
            medium: { total: 43, on: 37, pending: 0, rejected: 0, off: 6, missingCert: 43, byGroup: [
              { name: '爬行纲', count: 20 }, { name: '哺乳纲', count: 12 }, { name: '鸟纲', count: 7 },
              { name: '两栖纲', count: 2 }, { name: '辐鳍鱼纲', count: 1 }, { name: '头足类', count: 1 }
            ] },
            normal: { total: 201, on: 194, pending: 0, rejected: 0, off: 7, missingCert: 201 }
          }
        },
        riskOverviewLoading: false, riskOverviewError: false,
        riskShelfCounts: { all: 43, on: 37, pending: 0, rejected: 0, off: 6 },
        productShelfCounts: { all: 255, on: 231, pending: 0, rejected: 0, off: 24 },
        productArchiveFilter: 'all', productPromoFilter: 'all', productRiskFilter: 'medium', productShelfFilter: 'all',
        searchVal: '', productSort: 'new', productPriceSortLabel: '价格',
        productSortOptions: [{ key: 'new', label: '最新' }, { key: 'sales', label: '销量' }, { key: 'price', label: '价格', isPrice: true }],
        bulkRiskRunning: 'medium', riskCopyRunning: true,
        products: [
          row('m1', '鬃狮蜥标本 · 生态框', { basis: '所属分类：动物馆', root: '动物馆', cat: '爬行纲' }),
          row('m2', '孔雀标本 · 立姿', { basis: '所属分类：动物馆', root: '动物馆', cat: '鸟纲' }),
          row('m3', '侏儒兔标本 · 树脂封存', { basis: '所属分类：动物馆', root: '动物馆', cat: '哺乳纲' }),
          row('m4', '水母浸液标本', { basis: '所属分类：动物馆', root: '动物馆', cat: '两栖纲', off: true })
        ],
        productTotal: 43, productHasMore: true, productListLoading: false, productListError: false
      }
    }
  })(),
  // 「藏品明细」：风险工具条与风险 chip 已抽走 —— 这一张就是「没有它们」的证据
  (() => {
    const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
    // ⚠️ 形参顺序 (id, title, price, o)：2026-10-14 改这一版时漏掉了 `price`，结果 `o` 收到的是价格字符串，
    //    于是 on(o.off) / wm(o.wm) / rate(o.rate) 全是 undefined —— 图上"看着正常"（¥ 后面空着、没有水印），
    //    出图不报错、字段也不缺（所以那句「缺字段按空渲染」没提示）。**样例数据的形参错位是静默的**。
    const libRow = (id, title, price, o) => ({
      _id: id, title, price, costPrice: '50', profitRate: o.rate, soldCountDisplay: '0', images: [pic],
      inArchive: true, isOneOfAKind: !!o.one, isHighRisk: !!o.risk, riskLabel: o.riskLabel || '', riskTier: o.risk ? 'high' : '',
      isOffShelf: !!o.off, shelfApprovalStatus: o.st || '', shelfWm: o.wm || '', shelfWmClass: o.wmClass || '',
      craftProcessLabel: '干制标本', craftTypeLabel: '相框', framerName: '阿棋', hasSku: false,
      seckill: { enabled: false }, groupBuying: { enabled: false }
    })
    return {
      name: 'r10-lib-list', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'list', artisanEmbed: false,
        highRiskCount: 11, mediumRiskCount: 43, expiredSeckillCount: 1,
        productShelfCounts: { all: 255, on: 231, pending: 0, rejected: 0, off: 24 },
        riskShelfCounts: { all: 255, on: 231, pending: 0, rejected: 0, off: 24 },
        productArchiveFilter: 'all', productPromoFilter: 'all', productRiskFilter: 'all', productShelfFilter: 'all',
        searchVal: '', productSort: 'new', productPriceSortLabel: '价格',
        productSortOptions: [{ key: 'new', label: '最新' }, { key: 'sales', label: '销量' }, { key: 'price', label: '价格', isPrice: true }],
        products: [
          libRow('p1', '大蓝闪蝶 · 原木框', '399', { rate: '87.5', wm: '已上架', wmClass: 'approved' }),
          libRow('p2', '暹罗鳄标本 · 树脂封存', '1299', { rate: '92.0', risk: true, riskLabel: '保护动物', off: true, wm: '已下架', wmClass: 'offshelf' }),
          libRow('p3', '金裳凤蝶标本框', '899', { rate: '92.0', one: true, st: 'pending', wm: '审核中', wmClass: 'pending' }),
          libRow('p4', '绿尾大蚕蛾标本框', '299', { rate: '83.3', st: 'rejected', wm: '已驳回', wmClass: 'rejected' })
        ],
        productTotal: 255, productHasMore: true, productListLoading: false, productListError: false, bulkRiskRunning: ''
      }
    }
  })(),
  (() => {
    const catTreeView = [
      { _id: 'c1', name: '昆虫馆', enName: 'INSECTA', totalCount: 128, hiddenCount: 0, children: [
        { _id: 'c1a', name: '蝴蝶', productCount: 128, isEmpty: false, latinName: 'Lepidoptera' },
        { _id: 'c1b', name: '甲虫', productCount: 32, isEmpty: false, latinName: 'Coleoptera' }
      ] },
      { _id: 'c2', name: '植物馆', enName: 'PLANTAE', totalCount: 0, hiddenCount: 0, children: [
        { _id: 'c2a', name: '苔藓', productCount: 0, isEmpty: true, latinName: 'Bryophyta' }
      ] }
    ]
    return {
      name: 'r10-lib-category-default', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        // canProductFields: true = 超管（多分区）——**两级页签都在场**才不会漏看"两排长得一样"这个问题
        curTab: 1, productLibTab: 'category', catZone: 'category', canProductFields: true, artisanEmbed: false,
        catKeyword: '', catSortMode: 'default', catOnlyEmpty: false, catEmptyCount: 1,
        catMatchSummary: '', catTreeView, catTreeLoading: false,
        categoryManageTree: catTreeView, catManageRootNames: ['昆虫馆', '植物馆'],
        newCatLevel: 1, newCatName: '', newCatEn: '', newCatParentIndex: 0
      }
    }
  })(),
  (() => {
    const catTreeView = [
      { _id: 'c1', name: '昆虫馆', enName: 'INSECTA', totalCount: 128, hiddenCount: 1, children: [
        { _id: 'c1a', name: '蝴蝶', productCount: 128, isEmpty: false, latinName: 'Lepidoptera' }
      ] },
      { _id: 'c2', name: '植物馆', enName: 'PLANTAE', totalCount: 0, hiddenCount: 0, children: [
        { _id: 'c2a', name: '苔藓', productCount: 0, isEmpty: true, latinName: 'Bryophyta' }
      ] }
    ]
    return {
      name: 'r10-lib-category', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'category', catZone: 'category', canProductFields: false, artisanEmbed: false,
        catKeyword: '馆', catSortMode: 'count', catOnlyEmpty: false, catEmptyCount: 2, catTreeLoading: false,
        catMatchSummary: '匹配 2 个一级 · 1 个二级', catTreeView,
        categoryManageTree: catTreeView, catManageRootNames: ['昆虫馆', '植物馆'],
        newCatLevel: 1, newCatName: '', newCatEn: '', newCatParentIndex: 0
      }
    }
  })(),
  // 分类树「读取中」：**产品负责人 2026-10-14 截图就是这一屏**（当时它写着「暂无分类，可在下方添加」——
  // 分类库明明有 63 条，只是还在等 2 次云端查询）。这一张是那次修复的证据。
  {
    name: 'r10-lib-category-loading', h: 900, wxml: () => tabBlock(1), wxss: MGR_CSS,
    data: {
      curTab: 1, productLibTab: 'category', catZone: 'category', canProductFields: true, artisanEmbed: false,
      catKeyword: '', catSortMode: 'default', catOnlyEmpty: false, catEmptyCount: 0,
      catMatchSummary: '', catTreeView: [],
      // 关键：tree 还空着，但正在读 —— 页面必须说"读取分类中…"，不能谎报"暂无分类"
      catTreeLoading: true,
      categoryManageTree: [], catManageRootNames: [],
      newCatLevel: 1, newCatName: '', newCatEn: '', newCatParentIndex: 0
    }
  },
  {
    name: 'r1-hub-boot',
    h: 900,
    wxml: () => `<view class="container">${cutBetween(read(HUB), '<view class="workbench-boot', '<!-- ==================== 2.')}</view>`,
    wxss: MGR_CSS,
    data: { workspaceReady: false }
  },
  {
    name: 'r1-workspace-boot',
    h: 900,
    wxml: () => `<view class="container workspace-leaf">${cutBetween(read(WS), '<view class="workbench-boot', '<block wx:elif')}</view>`,
    wxss: MGR_CSS,
    data: { workspaceReady: false }
  },
  {
    name: 'r1-ledger-loading',
    h: 1334,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: { ...ledgerBase, ledgerOverviewReady: false, revenues: [ledgerRow('30', '2026-09-30', '4,980.00'), ledgerRow('29', '2026-09-29', '3,406.00')] }
  },
  {
    name: 'r1-ledger-empty',
    h: 1100,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: { ...ledgerBase, ledgerOverviewReady: true, revenues: [] }
  },
  {
    name: 'r1-orders-empty',
    h: 1000,
    wxml: () => tabBlock(2),
    wxss: MGR_CSS,
    data: {
      curTab: 2, subTab: 0, omQuery: '13800', omDays: 0, omSearchHint: '', omPendingCopyCount: 0,
      orders: [], shippedOrders: [], completedOrders: [], refunds: [], pendingPayOrders: [],
      ordersView: [], ordersLoading: false, menu: {}
    }
  },
  {
    name: 'r1-approvals-boot',
    h: 1000,
    wxml: () => read(AP),
    wxss: AP_CSS,
    data: { ready: false }
  },
  {
    name: 'r1-approvals-busy',
    h: 1334,
    wxml: () => read(AP),
    wxss: AP_CSS,
    data: {
      ready: true, canDecideTabs: true, viewMode: 'inbox', hubFlow: false, hubMode: '', overdueCount: 1, slaHours: 24,
      overviewExpanded: false, overviewReady: true, overviewSummary: '待我审 2 · 超时 1',
      auditHub: [{ key: 'points', label: '积分流水' }, { key: 'receipt', label: '小票认领' }],
      statusOptions: ['待审核'], statusIndex: 0, typeOptions: ['全部类型'], typeIndex: 0, total: 2, pendingBadge: 2,
      list: [apItem('a1', '报销 · 门店耗材'), apItem('a2', '请假 · 10 月 3 日', { actionLabel: '请假', summary: '事假 1 天' })],
      deciding: true, approvePendingId: 'a2', ignorePendingId: '', expandedId: '', loading: false, listError: false
    }
  },
  {
    name: 'r2-field-verify-loading',
    h: 1100,
    wxml: () => read(FIELD),
    wxss: FIELD_CSS,
    extraCss: FIELD_FOCUS_CSS,
    data: { ...fieldBase, curTab: 1, canVerifyPickup: true, pickupsLoading: true, bookingsLoading: true, pendingPickups: [], bookings: [] }
  },
  {
    name: 'r2-field-records-empty',
    h: 1000,
    wxml: () => read(FIELD),
    wxss: FIELD_CSS,
    extraCss: FIELD_FOCUS_CSS,
    data: { ...fieldBase, curTab: 2, records: [], recordsLoading: false, recordsError: '' }
  },
  {
    name: 'r3-invoice-loading',
    h: 1200,
    wxml: () => read('subpackages/manager/invoice-requests/index.wxml'),
    wxss: ['subpackages/manager/invoice-requests/index.wxss'],
    data: { ready: true, overviewReady: false, overviewLoading: true, statusOptions: ['全部', '待开具', '已开具', '已驳回'], statusIndex: 0, list: [], loading: true, listError: false, hasMore: false }
  },
  {
    name: 'r3-invoice-empty-filtered',
    h: 1200,
    wxml: () => read('subpackages/manager/invoice-requests/index.wxml'),
    wxss: ['subpackages/manager/invoice-requests/index.wxss'],
    data: { ready: true, overviewReady: false, overviewLoading: false, statusOptions: ['全部', '待开具', '已开具', '已驳回'], statusIndex: 2, list: [], loading: false, listError: false, hasMore: false }
  },
  { name: 'r3-payslip-after', h: 1600, wxml: () => read(PAYSLIP), wxss: PAYSLIP_AFTER_CSS, data: payslipData },
  { name: 'r3-payslip-after-list', h: 1600, wxml: () => read(PAYSLIP), wxss: PAYSLIP_AFTER_CSS, data: { ...payslipData, showDetail: false } },
  {
    name: 'r5-hub-dashboard',
    h: 1900,
    wxml: () => `<view class="container">${cutBetween(read(HUB), '<!-- 核心指标卡片', '<!-- 经营信号')}<view class="dashboard-grid">${cutBetween(read(HUB), '<!-- 数据图表', '<!-- 常用编辑面板')}`,
    wxss: MGR_CSS,
    data: {
      menu: { dashboardKpi: true, products: true }, chartLayout: {}, opsSignals: { mom: 'lamp-green', stock: 'lamp-amber' },
      stats: {
        displayGrand: '238,400', onlineTotal: '42,000', offlineTotal: '196,400', offlineSplitText: '山海 152,400 · 星宸 44,000',
        ratioEmpty: false, donutStyle: 'background: conic-gradient(#C4A76C 0 18%, #2E4A3A 18% 100%);', onlineRatio: 18, offlineRatio: 82,
        orderCountFmt: '126', avgOrderFmt: '¥333', visitCountFmt: '48', dailyAvgFmt: '7,946', momClass: 'up', momLabel: '+12%'
      },
      trendMeta: { empty: false, weekTotalFmt: '55,620', weekOnlineFmt: '9,820', weekOfflineFmt: '45,800', weekOnlineBar: 'width:18%', weekOfflineBar: 'width:82%' },
      trendData: ['25', '26', '27', '28', '29', '30', '01'].map((day, i) => ({
        dateKey: day, day, showVal: true, valShort: `${6 + i}k`, styleOnline: `height:${12 + i * 2}%`, styleOffline: `height:${40 + i * 4}%`
      })),
      dashStock: { ready: true, empty: false, onShelf: 312, offShelf: 46, stockTotal: 1288, topCats: [{ key: 'a', name: '蝴蝶', count: 128, barStyle: 'width:80%' }, { key: 'b', name: '甲虫', count: 96, barStyle: 'width:60%' }] }
    }
  },
  {
    name: 'r5-ledger-overview',
    h: 1700,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: {
      ...ledgerBase, ledgerOverviewReady: true, revenues: [],
      ledgerOverview: {
        empty: false, netFmt: '196,400.00', daysWithData: 30, posFmt: '152,300.00', cashBalanceFmt: '2,860.00', mpOnlineFmt: '42,000.00',
        mpRefundFmt: '0.00', pledgeDueFmt: '420.00', refundFmt: '320.00', dailyRevFmt: '6,546', dailyOrdersFmt: '4.2',
        totalOrderCountFmt: '126', avgOrderPriceFmt: '333', hasOrderData: true, orderHint: '',
        mall: { thresholdFmt: '170,000', reachedFmt: '196,400', excessFmt: '26,400', feeFmt: '6,864', formulaNote: '超 17 万部分 × 26%' },
        trend: ['25', '26', '27', '28', '29', '30'].map((label, i) => ({ label, barStyle: `height:${40 + i * 8}%` })),
        donutStyle: 'background: conic-gradient(#C4A76C 0 22%, #2E4A3A 22% 100%);',
        channels: [{ name: '刷卡', pct: 78, valueFmt: '152,300', color: '#2E4A3A' }, { name: '小程序', pct: 22, valueFmt: '42,000', color: '#C4A76C' }]
      }
    }
  },
  { name: 'r7-tickets', h: 1500, wxml: () => tabBlock(11), wxss: MGR_CSS, data: { curTab: 11, subTabMessage: 2, supportTickets: ticketRows() } },
  {
    name: 'r7-ticket-reply',
    h: 1334,
    wxml: () => `<view class="container workspace-leaf">${cutBetween(read(SUB), '<!-- 山海有信：留言回复 -->', '\n  <!--')}</view>`,
    wxss: MGR_CSS,
    extraCss: '.modal-mask, .modal-panel { animation: none !important; opacity: 1 !important; transform: none !important; }',
    data: { showTicketReplyModal: true, tempTicketReply: { ...ticketRows()[1], content: '' } }
  },
  {
    name: 'r8-support-images',
    h: 1400,
    wxml: () => `<view class="container">${cutBetween(read('subpackages/extra/user/support/index.wxml'), '<!-- 留言表单 -->', '<!-- 常见问题')}</view>`,
    wxss: ['subpackages/extra/user/support/index.wxss'],
    data: { messageText: '关于藏品「大蓝闪蝶 · 原木框」：\n框角这里有一道裂痕，附了照片', contactPhone: '', submitting: false, ...ticketImageData() }
  },
  {
    name: 'r8-feedback-images',
    h: 1700,
    wxml: () => read('subpackages/extra/user/feedback/index.wxml'),
    wxss: ['subpackages/extra/user/feedback/index.wxss'],
    data: { navPaddingRight: 16, headerBlockPx: 88, scrollHeightPx: 1450, categories: [{ id: 'feature', label: '功能建议' }, { id: 'experience', label: '体验问题' }, { id: 'content', label: '内容纠错' }, { id: 'other', label: '其他' }], activeCategory: 'experience', messageText: '订单页的物流信息刷新很慢，截了两张图', contactPhone: '', submitting: false, ...ticketImageData(true) }
  }
]

/** 附图三态样例：已上传 / 上传中 / 失败（done=true 时全部传完，按钮可点） */
function ticketImageData(done) {
  const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
  const list = done
    ? [{ key: 'a', local: pic, fileID: 'cloud://x/support-tickets/a.jpg', status: 'done' }, { key: 'b', local: pic, fileID: 'cloud://x/support-tickets/b.jpg', status: 'done' }]
    : [{ key: 'a', local: pic, fileID: 'cloud://x/support-tickets/a.jpg', status: 'done' }, { key: 'b', local: pic, fileID: '', status: 'uploading' }, { key: 'c', local: pic, fileID: '', status: 'failed' }]
  const failed = list.filter((x) => x.status === 'failed').length
  return { ticketImages: list, maxTicketImages: 3, ticketImgFailed: failed, ticketImgBusy: failed > 0 || list.some((x) => x.status === 'uploading') }
}

/** 第 1 条 = 2026-10-01 20:06:11 真实工单原样（message 只有预填前缀）；其余为写了正文 / 附图的样例 */
function ticketRows() {
  const mod = { exports: {} }
  new Function('module', 'exports', read('subpackages/manager/utils/supportTicketView.js'))(mod, mod.exports)
  const { buildTicketView } = mod.exports
  const fmt = (t) => t
  const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
  return [
    { _id: 't1', _openid: 'oa22s5xxxxxxxxxxxxxx3005E033', topicLabel: '藏品鉴赏', message: '关于藏品「忘忧尾蛱蝶植物标本框」：', productName: '忘忧尾蛱蝶植物标本框', createTime: '2026/10/1 20:06:11' },
    { _id: 't2', _openid: 'oXyz000000000000000000AB12CD34', memberNickName: '林小满', memberNo: 'MT-AB12-CD34', topicLabel: '藏品鉴赏', contactPhone: '13800001234', createTime: '2026/10/1 21:12:40',
      message: '关于藏品「大蓝闪蝶 · 原木框」：\n想送给父亲做生日礼物，框子能换成胡桃木的吗？\n另外礼盒能不能加一张手写卡，周六前能寄到上海吗？如果来不及我也可以到店自提，麻烦告诉我门店地址和营业时间，谢谢。' },
    { _id: 't3', _openid: 'oQwe000000000000000000EF56GH78', memberNickName: '', memberNo: '', topicLabel: '标本养护', createTime: '2026/10/1 21:30:02', message: '标本框玻璃里面起雾了，附了照片，请帮忙看看要怎么处理', images: [pic, pic] }
  ].map((r) => buildTicketView(r, fmt))
}
