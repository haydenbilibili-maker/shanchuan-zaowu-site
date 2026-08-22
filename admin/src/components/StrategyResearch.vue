<template>
  <div ref="containerRef" class="strategy-research-container" :class="{ 'is-fullscreen': isFullscreen }">
    <!-- 内部导航栏 -->
    <aside class="internal-nav" aria-label="战略调研主导航">
      <div class="nav-brand">
        <div class="brand-logo">山</div>
        <div class="brand-text">
          <h1 class="brand-title">山海造物标本艺术馆</h1>
          <p class="brand-subtitle">战略调研看板</p>
        </div>
      </div>
      <nav class="nav-tabs" role="tablist" aria-label="看板视图">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="currentView === tab.value"
          @click="currentView = tab.value"
          :class="['nav-tab', { active: currentView === tab.value }]"
        >
          <span class="nav-tab-icon" aria-hidden="true">{{ tab.icon }}</span>
          <span class="nav-tab-label">{{ tab.label }}</span>
        </button>
      </nav>
      <div class="nav-status">
        <p class="status-text"><strong>调研状态:</strong> {{ researchStatusText }}</p>
        <p class="status-text">最后更新: {{ lastUpdateTime }}</p>
        <div class="nav-actions">
          <button type="button" class="nav-action-btn" @click="refreshBoard" title="刷新图表与数据">刷新看板</button>
          <button type="button" class="nav-action-btn" @click="exportBoardSummary" title="导出看板一页纸摘要">导出摘要</button>
          <button type="button" class="nav-action-btn primary" @click="goToAIStrategyResearch" title="前往 AI 智能中心做战略调研">AI 战略调研</button>
        </div>
      </div>
    </aside>
    
    <!-- 主内容区 -->
    <div class="main-content-area">
    <!-- SECTION: OVERVIEW -->
    <section v-if="currentView === 'overview'" class="view-section sr-view overview-page">
      <div class="overview-strip" aria-label="行业总览定位">
        <span class="overview-strip-badge">行业总览</span>
        <span class="overview-strip-item">宏观与需求侧</span>
        <span class="overview-strip-dot">·</span>
        <span class="overview-strip-item">可下钻至产业链 / 产品 / 渠道</span>
      </div>

      <div class="command-center">
        <div class="command-hero">
          <div class="command-hero-text">
            <p class="eyebrow">战略指挥 · Command</p>
            <h2 class="command-hero-title">战略指挥舱</h2>
            <p class="command-hero-lead">把市场机会、合规风险、AI 用研与下一步动作压缩成经营层可直接决策的一页纸。</p>
          </div>
          <button class="nav-action-btn primary command-hero-cta" type="button" @click="goToAIStrategyResearch('strategic-brain')">
            打开 AI 战略智脑
          </button>
        </div>
        <div class="command-grid">
          <div v-for="card in strategicCommandCards" :key="card.label" class="command-card" :class="card.tone">
            <div class="command-label">{{ card.label }}</div>
            <div class="command-value">{{ card.value }}</div>
            <div class="command-desc">{{ card.desc }}</div>
          </div>
        </div>
        <div class="decision-grid">
          <div class="decision-panel">
            <div class="panel-title">机会 / 风险雷达</div>
            <p class="panel-subtitle">规则化摘要，非实时行情</p>
            <div v-for="item in riskOpportunityCards" :key="item.title" class="decision-item">
              <span class="decision-badge" :class="item.tone">{{ item.badge }}</span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </div>
            </div>
          </div>
          <div class="decision-panel">
            <div class="panel-title">AI 用研同步</div>
            <p class="panel-subtitle">来自 AI 智能中心写入的结论</p>
            <div v-if="latestAIResearch" class="latest-research">
              <strong>{{ latestAIResearch.topic || latestAIResearch.type || '最新用研结论' }}</strong>
              <p>{{ latestAIResearch.summary || getResearchSummary(latestAIResearch.content) }}</p>
              <button class="chart-action-btn" @click="currentView = 'aiResearch'">查看全部 {{ aiResearchList.length }} 条</button>
            </div>
            <div v-else class="latest-research empty">
              <strong>暂无同步结论</strong>
              <p>建议先使用“战略用研AI”生成首轮目标客群、竞品与渠道调研。</p>
              <button class="chart-action-btn" @click="goToAIStrategyResearch('strategy-research')">生成用研</button>
            </div>
          </div>
          <div class="decision-panel">
            <div class="panel-title">下一步动作</div>
            <p class="panel-subtitle">基于当前看板数据的建议清单</p>
            <ol class="next-actions">
              <li v-for="action in nextStrategicActions" :key="action">{{ action }}</li>
            </ol>
          </div>
        </div>
      </div>

      <div class="overview-body-grid">
        <div class="info-card overview-macro-card">
          <h2 class="section-title">标本艺术行业：宏观洞察</h2>
          <p class="section-text">
            <strong>主要发现：</strong> 当前国内标本行业正从传统的"科研/教学"用途向"家居美学"与"自然教育"双轮驱动转型。
            随着"生物亲和性设计 (Biophilic Design)"的流行，以蝴蝶、昆虫、植物为核心的装饰性标本市场需求激增。
            对于"这有山山海造物"而言，机会在于将原标本进行艺术化二次创作，提升附加值，切入中高端文创与礼品市场。
          </p>
          <ul class="overview-macro-bullets">
            <li><strong>需求侧</strong>：家居装饰 + 礼赠 + 研学体验叠加，搜索热度与客单中枢上移。</li>
            <li><strong>供给侧</strong>：产区集中、合规与证据链决定扩张节奏（与合规专栏联动）。</li>
            <li><strong>经营含义</strong>：先验证「引流款跑量 + 利润款提毛利」组合，再放大渠道投放。</li>
          </ul>
        </div>

        <div class="overview-kpi-deck">
          <div class="overview-kpi-deck-head">
            <h3 class="overview-kpi-deck-title">关键指标一览</h3>
            <p class="overview-kpi-deck-sub">与下方趋势图、细分结构同一研判口径（内部估算）</p>
          </div>
      <!-- KPI Cards - 增强版 -->
      <div class="kpi-grid overview-kpi-grid">
        <div class="kpi-card sage">
          <div class="kpi-header">
            <div class="kpi-icon">📊</div>
            <div class="kpi-label">预估文创标本市场规模</div>
          </div>
          <div class="kpi-value">¥ 95 亿+</div>
          <div class="kpi-trend positive">▲ 16.8% CAGR</div>
          <div class="kpi-detail">2025-2028年预测</div>
        </div>
        <div class="kpi-card gold">
          <div class="kpi-header">
            <div class="kpi-icon">👥</div>
            <div class="kpi-label">核心消费人群</div>
          </div>
          <div class="kpi-value">25-40岁</div>
          <div class="kpi-trend">新中产家庭 / 审美Z世代</div>
          <div class="kpi-detail">占比约65%</div>
        </div>
        <div class="kpi-card gray">
          <div class="kpi-header">
            <div class="kpi-icon">🔥</div>
            <div class="kpi-label">热门细分赛道</div>
          </div>
          <div class="kpi-value">装饰画 & 树脂</div>
          <div class="kpi-trend info">“礼赠 + 体验”双场景拉动</div>
          <div class="kpi-detail">近两年增速更稳</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-header">
            <div class="kpi-icon">💰</div>
            <div class="kpi-label">平均客单价</div>
          </div>
          <div class="kpi-value">¥ 720</div>
          <div class="kpi-trend positive">中高端定位</div>
          <div class="kpi-detail">行业均值¥460</div>
        </div>
        <div class="kpi-card purple">
          <div class="kpi-header">
            <div class="kpi-icon">📈</div>
            <div class="kpi-label">线上渗透率</div>
          </div>
          <div class="kpi-value">42%</div>
          <div class="kpi-trend positive">持续上升</div>
          <div class="kpi-detail">预计2028年达62%</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-header">
            <div class="kpi-icon">🎯</div>
            <div class="kpi-label">复购率</div>
          </div>
          <div class="kpi-value">28.4%</div>
          <div class="kpi-trend positive">高于行业平均</div>
          <div class="kpi-detail">行业均值18%</div>
        </div>
      </div>
        </div>
      </div>

      <!-- Trend Chart - 增强版 -->
      <div class="trend-chart-card">
        <div class="chart-header">
          <div class="header-left">
            <h3 class="chart-title">市场关注度趋势</h3>
            <div class="chart-subtitle">2019–2026(E) 自然装饰标本搜索指数与行业对照（含内部预测上沿）</div>
          </div>
          <div class="chart-actions">
            <div class="time-range-selector">
              <button 
                v-for="range in timeRanges" 
                :key="range.value"
                @click="selectedTimeRange = range.value"
                :class="['time-range-btn', { active: selectedTimeRange === range.value }]"
              >
                {{ range.label }}
              </button>
            </div>
            <button class="chart-action-btn" @click="exportTrendData" title="导出数据">📥</button>
            <button class="chart-action-btn" @click="toggleFullscreen" title="全屏查看">🔍</button>
          </div>
        </div>
        
        <!-- 关键指标卡片 -->
        <div class="trend-metrics">
          <div class="trend-metric-card">
            <div class="metric-icon">📊</div>
            <div class="metric-content">
              <div class="metric-label">当前指数</div>
              <div class="metric-value">{{ currentIndex }}</div>
              <div class="metric-change positive">+{{ growthRate }}%</div>
            </div>
          </div>
          <div class="trend-metric-card">
            <div class="metric-icon">📈</div>
            <div class="metric-content">
              <div class="metric-label">年均增长率</div>
              <div class="metric-value">{{ avgGrowthRate }}%</div>
              <div class="metric-change">CAGR</div>
            </div>
          </div>
          <div class="trend-metric-card">
            <div class="metric-icon">🎯</div>
            <div class="metric-content">
              <div class="metric-label">峰值年份</div>
              <div class="metric-value">{{ peakYear }}</div>
              <div class="metric-change">指数: {{ peakValue }}</div>
            </div>
          </div>
          <div class="trend-metric-card">
            <div class="metric-icon">📉</div>
            <div class="metric-content">
              <div class="metric-label">最低年份</div>
              <div class="metric-value">{{ minYear }}</div>
              <div class="metric-change">指数: {{ minValue }}</div>
            </div>
          </div>
        </div>
        
        <div class="chart-container">
          <canvas ref="trendChartCanvas"></canvas>
        </div>
        
        <div class="chart-footer">
          <div class="chart-legend">
            <span class="legend-item">
              <span class="legend-dot" style="background: var(--brand-green-500)"></span>
              <span>自然装饰标本搜索指数</span>
            </span>
            <span class="legend-item">
              <span class="legend-dot" style="background: linear-gradient(135deg, #7B8C7C, #9CAF9C)"></span>
              <span>行业平均增长趋势</span>
            </span>
            <span class="legend-item">
              <span class="legend-dot" style="background: linear-gradient(135deg, #5b8fb9, #8eb4d4)"></span>
              <span>预测上沿（内部估算）</span>
            </span>
          </div>
          <div class="chart-footer-right">
            <p class="chart-note">数据来源：综合电商平台搜索指数与行业报告估算</p>
            <div class="chart-stats">
              <span>数据更新: {{ lastUpdateTime }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 市场细分分析 -->
      <div class="chart-card overview-segments-card">
        <div class="overview-segments-head">
          <h3 class="chart-title">细分市场占比分析</h3>
          <p class="overview-segments-lead">结构占比 + 增速与客单牵引，用于产品线组合与陈列策略对齐。</p>
        </div>
        <div class="market-segments overview-market-segments">
          <div v-for="seg in overviewMarketSegments" :key="seg.name" class="segment-item">
            <div class="segment-header">
              <span class="segment-icon" aria-hidden="true">{{ seg.icon }}</span>
              <span class="segment-name">{{ seg.name }}</span>
              <span class="segment-percent">{{ seg.percent }}%</span>
            </div>
            <div class="segment-bar">
              <div class="segment-fill" :class="seg.fillClass" :style="{ width: seg.percent + '%' }"></div>
            </div>
            <div class="segment-detail">年增长 {{ seg.growth }} | 客单价 {{ seg.aov }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: SUPPLY CHAIN MAP（单区块：避免重复 ref 导致 Chart 绑定错误 / 画布空白） -->
    <section v-if="currentView === 'supply'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">全国标本产业链地图</h2>
        <p class="section-text">
          <strong>调研分析：</strong> 中国标本产业具有极强的地域聚集性。上游采集与初加工主要集中在生物多样性丰富的<strong>云南（昆虫/植物）</strong>与<strong>广西</strong>。
          海洋生物加工集中在<strong>山东</strong>与<strong>福建</strong>。而深加工、树脂工艺品制作与外贸出口则高度集中在<strong>义乌（浙江）</strong>与<strong>深圳（广东）</strong>。
          建议"这有山"在云南建立直采基地以确保原材料（蝴蝶/甲虫）的稀缺性与品质，同时考察义乌的树脂封装工艺以降低标本饰品的生产成本。
        </p>
      </div>

      <div class="supply-grid">
        <div class="supply-controls">
          <div class="control-card">
            <h3 class="control-title">筛选品类</h3>
            <div class="filter-buttons">
              <button
                v-for="type in supplyTypes"
                :key="type.value"
                @click="updateSupplyMap(type.value)"
                :class="['filter-btn', { active: supplyFilter === type.value }]"
              >
                {{ type.label }}
              </button>
            </div>
          </div>
          <div class="insight-card">
            <h4 class="insight-title">💡 供应链洞察</h4>
            <p class="insight-text">{{ currentInsight }}</p>
          </div>
        </div>

        <div class="chart-card">
          <h3 class="chart-title">核心产区产能分布指数</h3>
          <p class="chart-note">横向条形图为各产区「产业聚集度指数」示意，可通过左侧品类筛选切换数据源。</p>
          <div class="chart-container">
            <canvas ref="supplyChartCanvas"></canvas>
          </div>
        </div>
      </div>

      <div class="info-card">
        <h2 class="section-title">全景产业链地图 · 行业规模复合增长率分析</h2>
        <p class="section-text">
          <strong>核心洞察：</strong> 标本艺术产业进入「审美消费 + 研学体验」共同驱动阶段，增长从爆发期转向结构性增长；预计2028年前行业规模仍将保持较高增速。
          产业链上游（原材料采集）集中度高，中游（加工制造）呈现区域集聚，下游（终端零售）呈现多元化趋势。
        </p>
      </div>

      <div class="supply-chain-grid">
        <div class="chart-card full-width">
          <h3 class="chart-title">行业市场规模与复合增长率 (2019-2028E)</h3>
          <div class="chart-container" style="height: 400px;">
            <canvas ref="industryGrowthChartCanvas"></canvas>
          </div>
          <div class="chart-metrics">
            <div class="metric-item"><span class="metric-label">2025市场规模</span><span class="metric-value">¥95亿</span></div>
            <div class="metric-item"><span class="metric-label">CAGR</span><span class="metric-value highlight">16.8%</span></div>
            <div class="metric-item"><span class="metric-label">2028E预测</span><span class="metric-value">¥200亿</span></div>
          </div>
        </div>

        <div class="value-chain-card full-width">
          <h3 class="chart-title">产业链价值分布</h3>
          <div class="value-chain-visual">
            <div class="chain-stage" v-for="stage in valueChainStages" :key="stage.name">
              <div class="stage-header"><span class="stage-icon">{{ stage.icon }}</span><span class="stage-name">{{ stage.name }}</span></div>
              <div class="stage-bar"><div class="stage-fill" :style="{ width: stage.valueShare + '%', backgroundColor: stage.color }"></div></div>
              <div class="stage-metrics"><span>价值占比: {{ stage.valueShare }}%</span><span>利润率: {{ stage.profitMargin }}%</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: PRODUCTS -->
    <!-- 产品金字塔 + 品类评估：单区块，避免重复 ref 导致雷达图不渲染 -->
    <section v-if="currentView === 'products'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">产品品类与开发策略</h2>
        <p class="section-text">
          <strong>策略建议：</strong> 标本产品线可分为三大梯队。
          <strong>引流款（树脂饰品/果壳铃）</strong>：低单价、高复购、易标准化，适合线上起量。
          <strong>利润款（昆虫/蝴蝶装饰画）</strong>：中高客单价，主要体现品牌审美，是目前的营收主力。
          <strong>形象款（大型生态缸/稀有收藏级）</strong>：极高单价，用于镇店展示与高端定制，提升品牌调性。
          下方雷达图对比了不同品类的开发难度与商业回报。
        </p>
      </div>

      <div class="products-grid">
        <div class="chart-card">
          <h3 class="chart-title">品类多维评估模型</h3>
          <p class="chart-note">五维雷达为示意数据，用于对比原蝶画、树脂饰品、海洋摆件等主力方向的相对优劣势。</p>
          <div class="chart-container">
            <canvas ref="productRadarCanvas"></canvas>
          </div>
          <div class="chart-legend">
            <span class="legend-tag">维度说明:</span>
            <span>利润率 (Margin)</span>
            <span>销量潜力 (Volume)</span>
            <span>运输便利性 (Logistics)</span>
            <span>工艺门槛 (Skill)</span>
            <span>供应链稳定性 (Supply)</span>
          </div>
        </div>

        <div class="product-cards">
          <div class="product-card gold-border">
            <div class="product-header">
              <div>
                <h4 class="product-title">🦋 蝴蝶/昆虫原蝶标本画</h4>
                <p class="product-desc">核心优势：视觉冲击力强，符合"新中式/自然风"装修趋势。</p>
              </div>
              <span class="product-badge gold">核心主力</span>
            </div>
            <div class="product-actions">
              <p>• 建议拓展：增加DIY材料包，降低门槛，增加互动性。</p>
              <p>• 供应链：锁定云南大理/西双版纳的一级养殖户。</p>
            </div>
          </div>

          <div class="product-card blue-border">
            <div class="product-header">
              <div>
                <h4 class="product-title">💍 树脂封存/生物饰品</h4>
                <p class="product-desc">核心优势：便携、单价低、适合作为旅游纪念品或小礼物。</p>
              </div>
              <span class="product-badge blue">高频消费</span>
            </div>
            <div class="product-actions">
              <p>• 建议拓展：开发"生日花/生辰石"概念，增加情感连接。</p>
              <p>• 供应链：利用义乌/东莞的成熟树脂模具工艺。</p>
            </div>
          </div>

          <div class="product-card green-border">
            <div class="product-header">
              <div>
                <h4 class="product-title">🦀 海洋/甲壳类摆件</h4>
                <p class="product-desc">核心优势：结构感强，适合男性用户及书房场景。</p>
              </div>
              <span class="product-badge green">男性市场</span>
            </div>
            <div class="product-actions">
              <p>• 建议拓展：蒸汽朋克(Steampunk)风格改造，结合金属零件。</p>
              <p>• 供应链：对接山东青岛/广西北海的渔业副产品。</p>
            </div>
          </div>
        </div>
      </div>

      <div class="info-card">
        <h2 class="section-title">产品金字塔 · 产品分层与策略</h2>
        <p class="section-text">
          <strong>产品策略：</strong> 构建三层产品金字塔，从引流款到利润款再到形象款，实现流量获取、营收增长和品牌提升的平衡。
        </p>
      </div>
      <div class="pyramid-container">
        <div class="pyramid-visual">
          <div class="pyramid-layer" v-for="(layer, index) in productPyramid" :key="layer.name" :style="{ '--layer-index': index }">
            <div class="layer-content">
              <div class="layer-icon">{{ layer.icon }}</div>
              <div class="layer-name">{{ layer.name }}</div>
              <div class="layer-desc">{{ layer.description }}</div>
              <div class="layer-metrics">
                <div class="layer-metric"><span>价格区间</span><span class="metric-value">¥{{ layer.priceRange }}</span></div>
                <div class="layer-metric"><span>目标占比</span><span class="metric-value">{{ layer.targetShare }}%</span></div>
                <div class="layer-metric"><span>毛利率</span><span class="metric-value">{{ layer.margin }}%</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="pyramid-products">
          <div class="product-pyramid-card" v-for="layer in productPyramid" :key="layer.name">
            <div class="pyramid-card-header"><span class="pyramid-layer-badge" :class="layer.type">{{ layer.badge }}</span><h4>{{ layer.name }}</h4></div>
            <div class="pyramid-card-body"><p><strong>定位:</strong> {{ layer.description }}</p><p><strong>代表产品:</strong> {{ layer.products.join(', ') }}</p><p><strong>策略目标:</strong> {{ layer.strategy }}</p></div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 流量漏斗 / 全渠道（单区块：合并原重复 channels，避免双 DOM 与图表异常） -->
    <section v-if="currentView === 'channels'" class="view-section sr-view">
      <div class="info-card sr-hero-card">
        <h2 class="section-title">全渠道拓展蓝图</h2>
        <p class="section-text">
          <strong>行动指南：</strong> 既然"这有山"已具备线下门店基因，下一步应强化<strong>"场域体验"</strong>。
          虽然线上电商（淘宝/抖音）是必争之地，但标本的非标品特性导致线上获客成本高、退货风险大。
          <strong>最佳策略是：</strong> 1. 拓展B端（自然博物馆/学校/亲子机构）的课程包与教具供应；
          2. 进驻高流量的"生活方式集合店"（如KKV, 九木杂物社）做联名专柜；
          3. 线下门店增加"手作体验区"，以服务带动产品销售。
        </p>
      </div>

      <div class="channels-grid">
        <div class="chart-card">
          <h3 class="chart-title">渠道营收潜力预测</h3>
          <p class="chart-note">环形图为示意结构占比，可与下方漏斗、分渠道卡片交叉阅读。</p>
          <div class="chart-container">
            <canvas ref="channelChartCanvas"></canvas>
          </div>
        </div>

        <div class="channels-right">
          <div class="priority-card">
            <h3 class="priority-title">渠道拓展优先级</h3>
            <div class="priority-list">
              <div class="priority-item">
                <div class="priority-header">
                  <span class="priority-name">B端教育/研学机构 (To B)</span>
                  <span class="priority-rating">推荐指数: ⭐⭐⭐⭐⭐</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill sage" style="width: 90%"></div>
                </div>
                <p class="priority-note">竞争较小，单量大，复购稳。针对中小学自然课与周末亲子营。</p>
              </div>

              <div class="priority-item">
                <div class="priority-header">
                  <span class="priority-name">生活方式集合店 (To B2C)</span>
                  <span class="priority-rating">推荐指数: ⭐⭐⭐⭐</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill gold" style="width: 75%"></div>
                </div>
                <p class="priority-note">利用成熟渠道流量，以"寄售"或"专柜"形式入驻商场。</p>
              </div>

              <div class="priority-item">
                <div class="priority-header">
                  <span class="priority-name">抖音/小红书直播 (To C)</span>
                  <span class="priority-rating">推荐指数: ⭐⭐⭐</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill blue" style="width: 60%"></div>
                </div>
                <p class="priority-note">适合展示制作过程引流，但需解决易碎品物流痛点。</p>
              </div>
            </div>
          </div>

          <div class="action-plan-card">
            <h4 class="action-title">🚀 立即行动计划</h4>
            <ul class="action-list">
              <li><strong>本月：</strong> 梳理现有库存，制作"自然教育课程包"样品（标本+手册）。</li>
              <li><strong>Q2目标：</strong> 联络3-5家本地亲子研学机构，提供免费试课与标本教具展示。</li>
              <li><strong>供应链：</strong> 安排团队前往云南大理进行蝴蝶源头考察，建立直采合作。</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="info-card">
        <h2 class="section-title">全域流量漏斗 · 全渠道转化分析</h2>
        <p class="section-text">
          <strong>流量策略：</strong> 构建全域流量矩阵，从公域到私域，从曝光到成交，优化每个环节的转化效率。
        </p>
      </div>
      <div class="funnel-container">
        <div class="chart-card full-width">
          <h3 class="chart-title">全域流量转化漏斗</h3>
          <p class="chart-note">柱状图为示意转化量级；分渠道卡片展示各环节人数与环比转化。</p>
          <div class="chart-container" style="height: min(500px, 50vh)">
            <canvas ref="funnelChartCanvas"></canvas>
          </div>
        </div>
        <div class="channel-comparison-grid">
          <div class="channel-card" v-for="channel in trafficChannels" :key="channel.name">
            <div class="channel-header"><span class="channel-icon">{{ channel.icon }}</span><h4>{{ channel.name }}</h4></div>
            <div class="channel-funnel">
              <div class="funnel-stage" v-for="(stage, index) in channel.funnel" :key="index">
                <div class="stage-label">{{ stage.name }}</div>
                <div class="stage-value">{{ stage.value.toLocaleString() }}</div>
                <div class="stage-conversion" v-if="index > 0">{{ ((stage.value / channel.funnel[index - 1].value) * 100).toFixed(1) }}%</div>
              </div>
            </div>
            <div class="channel-metrics">
              <div class="channel-metric"><span>CAC</span><span>¥{{ channel.cac }}</span></div>
              <div class="channel-metric"><span>ROI</span><span>{{ channel.roi }}x</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="sales-script-section">
        <div class="info-card">
          <h2 class="section-title">🗣️ 金牌销售话术</h2>
          <p class="section-text">
            <strong>功能说明：</strong> 针对转化率低的环节，AI自动生成专业的店员话术SOP，提升销售转化效率。
          </p>
        </div>

        <div class="sales-script-panel">
          <div class="script-controls">
            <div class="control-group">
              <h3 class="control-title">选择渠道</h3>
              <div class="channel-selector">
                <button
                  v-for="channel in trafficChannels"
                  :key="channel.name"
                  @click="selectedChannel = channel.name"
                  :class="['channel-btn', { active: selectedChannel === channel.name }]"
                >
                  <span class="channel-icon-small">{{ channel.icon }}</span>
                  <span>{{ channel.name }}</span>
                </button>
              </div>
            </div>

            <div class="control-group">
              <h3 class="control-title">选择优化环节</h3>
              <div class="stage-selector">
                <select v-model="selectedStage" class="stage-select">
                  <option value="">请选择需要优化的环节</option>
                  <option v-for="(stage, index) in getChannelStages()" :key="index" :value="index">
                    {{ stage.name }} (转化率: {{ getStageConversionRate(index) }}%)
                  </option>
                </select>
              </div>
            </div>

            <div class="control-group">
              <h3 class="control-title">话术类型</h3>
              <div class="script-type-selector">
                <label class="type-radio">
                  <input type="radio" v-model="scriptType" value="opening" />
                  <span>开场话术</span>
                </label>
                <label class="type-radio">
                  <input type="radio" v-model="scriptType" value="objection" />
                  <span>异议处理</span>
                </label>
                <label class="type-radio">
                  <input type="radio" v-model="scriptType" value="closing" />
                  <span>成交话术</span>
                </label>
                <label class="type-radio">
                  <input type="radio" v-model="scriptType" value="complete" />
                  <span>完整SOP</span>
                </label>
              </div>
            </div>

            <button
              @click="generateSalesScript"
              :disabled="isGeneratingScript || !selectedChannel || selectedStage === ''"
              class="generate-script-btn"
            >
              <span v-if="!isGeneratingScript">✨ 生成销售话术</span>
              <span v-else>🔄 正在生成中...</span>
            </button>
          </div>

          <div v-if="isGeneratingScript" class="loading-overlay">
            <div class="loading-spinner"></div>
            <p class="loading-text">AI正在生成专业话术...</p>
          </div>

          <div v-if="salesScript" class="sales-script-result">
            <div class="result-header">
              <h3 class="result-title">{{ salesScript.channel }} - {{ salesScript.stage }} 销售话术</h3>
              <div class="result-actions">
                <button type="button" @click="exportSalesScript" class="export-btn-small">📥 导出</button>
                <button type="button" @click="regenerateSalesScript" class="regenerate-btn-small">🔄 重新生成</button>
              </div>
            </div>

            <div class="script-content">
              <div class="script-section">
                <h4 class="script-section-title">📊 环节分析</h4>
                <div class="script-text">{{ salesScript.analysis }}</div>
              </div>

              <div class="script-section">
                <h4 class="script-section-title">💬 标准话术</h4>
                <div class="script-dialogue">
                  <div v-for="(dialogue, index) in salesScript.dialogues" :key="index" class="dialogue-item">
                    <div class="dialogue-scenario">{{ dialogue.scenario }}</div>
                    <div class="dialogue-script">{{ dialogue.script }}</div>
                    <div class="dialogue-tips" v-if="dialogue.tips">
                      <strong>💡 要点：</strong>{{ dialogue.tips }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="script-section">
                <h4 class="script-section-title">🎯 执行要点</h4>
                <ul class="script-points">
                  <li v-for="(point, index) in salesScript.points" :key="index">{{ point }}</li>
                </ul>
              </div>

              <div class="script-section">
                <h4 class="script-section-title">📈 预期效果</h4>
                <div class="script-text">{{ salesScript.expectedEffect }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 对标研究（宪章三轴三群 + 绿黄红 + 国内竞品） -->
    <section v-if="currentView === 'competitors'" class="view-section sr-view bm-page">
      <div class="bm-hero info-card">
        <p class="bm-eyebrow">{{ BENCHMARK_META.charter }} · {{ BENCHMARK_META.methodology }}</p>
        <h2 class="section-title">对标研究 · 战略坐标系</h2>
        <p class="section-text">
          <strong>原则：</strong>{{ BENCHMARK_META.principle }}
          资料来源归档「{{ BENCHMARK_META.source }}」，当前库内
          <strong>{{ benchmarkStats.done }}/{{ benchmarkStats.total }}</strong> 品牌已有报告沉淀，
          另含 <strong>{{ benchmarkStats.topics }}</strong> 个专题。
        </p>
        <div class="bm-kpi-row">
          <div v-for="g in benchmarkStats.byGroup" :key="g.id" class="bm-kpi" :style="{ '--bm-accent': g.color }">
            <span class="bm-kpi-role">群 {{ g.id }} · {{ g.role }}</span>
            <strong class="bm-kpi-num">{{ g.count }}</strong>
            <span class="bm-kpi-label">对标品牌</span>
          </div>
        </div>
      </div>

      <div class="bm-axes">
        <div v-for="axis in BENCHMARK_AXES" :key="axis.id" class="bm-axis-card chart-card">
          <div class="bm-axis-head">
            <span class="bm-axis-short">{{ axis.short }}</span>
            <h3 class="chart-title">{{ axis.name }}</h3>
          </div>
          <p class="bm-axis-desc">{{ axis.desc }}</p>
          <p class="bm-axis-q">{{ axis.question }}</p>
        </div>
      </div>


      <div class="bm-cloud chart-card">
        <div class="bm-cloud-head">
          <div>
            <p class="bm-eyebrow">CloudBase · benchmark_research_docs</p>
            <h3 class="chart-title">资料库全文检索</h3>
            <p class="bm-cloud-lead">
              动态入库归档 PDF/MD；客户端对 <code>searchableText</code> 做关键词检索。
              云端文档 <strong>{{ cloudDocStats.total }}</strong> 篇，
              可检索 <strong>{{ cloudDocStats.ready }}</strong>，
              PDF 待抽文本 <strong>{{ cloudDocStats.pending }}</strong>。
            </p>
          </div>
          <div class="bm-cloud-actions">
            <button type="button" class="chart-action-btn" :disabled="cloudDocsLoading" @click="refreshCloudBenchmarkDocs">
              {{ cloudDocsLoading ? '同步中…' : '同步云库' }}
            </button>
            <label class="chart-action-btn bm-upload-btn" :class="{ disabled: cloudUploading }">
              {{ cloudUploading ? '入库中…' : '上传 PDF/MD' }}
              <input type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain" hidden :disabled="cloudUploading" @change="onBenchmarkFileUpload" />
            </label>
          </div>
        </div>
        <div class="bm-cloud-search-row">
          <input
            v-model="cloudSearchQuery"
            type="search"
            class="bm-search bm-cloud-search"
            placeholder="全文检索：如 愿景 51% / 盲盒 / 提案型…"
            aria-label="对标资料全文检索"
            @keydown.enter.prevent="runCloudBenchmarkSearch"
          />
          <button type="button" class="chart-action-btn primary" @click="runCloudBenchmarkSearch">检索</button>
        </div>
        <p v-if="cloudDocsError" class="bm-cloud-error">{{ cloudDocsError }}</p>
        <div v-if="cloudSearchResults.length" class="bm-cloud-results">
          <article v-for="hit in cloudSearchResults" :key="hit._id || hit.docKey" class="bm-cloud-hit" @click="openCloudDocHit(hit)">
            <div class="bm-cloud-hit-top">
              <h4>{{ hit.title }}</h4>
              <span class="bm-doc-tag">{{ hit.docType }} · {{ hit.textStatus }}</span>
            </div>
            <p class="bm-cloud-meta">
              <span v-if="hit.brandId">品牌 {{ hit.brandId }}</span>
              <span v-if="hit.group">群 {{ hit.group }}</span>
              <span v-if="hit.era">{{ hit.era }}</span>
              <span>{{ hit.charCount || 0 }} 字</span>
            </p>
            <p class="bm-cloud-snippet">{{ hit._snippet || hit.excerpt }}</p>
          </article>
        </div>
        <p v-else-if="cloudSearchQuery.trim() && !cloudDocsLoading" class="bm-cloud-empty">未命中「{{ cloudSearchQuery }}」。可先上传 PDF 或运行 <code>npm run seed:benchmark</code> 灌入归档 MD。</p>
        <div v-else-if="cloudDocs.length && !cloudSearchQuery.trim()" class="bm-cloud-recent">
          <h4>最近入库</h4>
          <ul>
            <li v-for="d in cloudDocs.slice(0, 8)" :key="d._id || d.docKey">
              <button type="button" class="bm-linkish" @click="openCloudDocHit(d)">{{ d.title }}</button>
              <span class="bm-cloud-meta">{{ d.docType }} · {{ d.textStatus }} · {{ d.brandId || '未挂品牌' }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="bm-toolbar info-card">
        <div class="bm-filters" role="group" aria-label="对标群筛选">
          <button
            type="button"
            class="bm-filter-btn"
            :class="{ active: benchmarkGroupFilter === 'all' }"
            @click="benchmarkGroupFilter = 'all'"
          >全部群</button>
          <button
            v-for="g in BENCHMARK_GROUPS"
            :key="g.id"
            type="button"
            class="bm-filter-btn"
            :class="{ active: benchmarkGroupFilter === g.id }"
            :style="benchmarkGroupFilter === g.id ? { '--bm-accent': g.color } : {}"
            @click="benchmarkGroupFilter = g.id"
          >群 {{ g.id }} · {{ g.role }}</button>
        </div>
        <input
          v-model="benchmarkSearch"
          type="search"
          class="bm-search"
          placeholder="搜索品牌 / 角色 / 启示…"
          aria-label="搜索对标品牌"
        />
      </div>

      <div class="bm-group-panels">
        <div
          v-for="g in filteredBenchmarkGroups"
          :key="g.id"
          class="bm-group-panel"
          :style="{ '--bm-accent': g.color }"
        >
          <header class="bm-group-head">
            <div>
              <h3>{{ g.name }}</h3>
              <p>{{ g.summary }}</p>
            </div>
            <span class="bm-group-count">{{ brandsInGroup(g.id).length }}</span>
          </header>
          <div class="bm-brand-grid">
            <article
              v-for="brand in brandsInGroup(g.id)"
              :key="brand.id"
              class="bm-brand-card"
              :class="{ selected: selectedBenchmarkId === brand.id }"
              @click="selectedBenchmarkId = brand.id"
            >
              <div class="bm-brand-top">
                <h4>{{ brand.name }}</h4>
                <span class="bm-status" :data-status="brand.status">{{ brand.status === 'done' ? '已沉淀' : brand.status }}</span>
              </div>
              <p class="bm-brand-en">{{ brand.nameEn }}</p>
              <p class="bm-brand-role">{{ brand.role }}</p>
              <p class="bm-brand-line">{{ brand.oneLiner }}</p>
              <div class="bm-brand-tags">
                <span v-for="d in brand.docs" :key="d" class="bm-doc-tag">{{ d }}</span>
              </div>
            </article>
          </div>
        </div>
      </div>

      <div v-if="selectedBenchmarkBrand" class="bm-detail chart-card">
        <div class="bm-detail-head">
          <div>
            <p class="bm-eyebrow">群 {{ selectedBenchmarkBrand.group }} · 启动阅读</p>
            <h3 class="chart-title">{{ selectedBenchmarkBrand.name }} <span class="bm-detail-en">{{ selectedBenchmarkBrand.nameEn }}</span></h3>
          </div>
          <button type="button" class="chart-action-btn" @click="selectedBenchmarkId = null">收起</button>
        </div>
        <p class="bm-detail-role">{{ selectedBenchmarkBrand.role }}</p>
        <p class="section-text">{{ selectedBenchmarkBrand.oneLiner }}</p>
        <div class="bm-detail-grid">
          <div class="bm-detail-block learn">
            <h4>可迁移启示</h4>
            <p>{{ selectedBenchmarkBrand.learn }}</p>
          </div>
          <div class="bm-detail-block risk">
            <h4>暗角 / 风险</h4>
            <p>{{ selectedBenchmarkBrand.risk }}</p>
          </div>
        </div>
        <div v-if="selectedBrandCloudDocs.length" class="bm-brand-cloud-docs">
          <h4>云库相关文档</h4>
          <ul>
            <li v-for="d in selectedBrandCloudDocs" :key="d._id || d.docKey">
              <button type="button" class="bm-linkish" @click="openCloudDocHit(d)">{{ d.title }}</button>
              <span class="bm-cloud-meta">{{ d.docType }} · {{ d.textStatus }} · {{ d.charCount || 0 }} 字</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="bm-zones">
        <div v-for="z in BENCHMARK_ZONES" :key="z.id" class="bm-zone-card" :data-zone="z.id">
          <h3>{{ z.name }} · {{ z.meaning }}</h3>
          <p class="bm-zone-rule">{{ z.rule }}</p>
          <ul>
            <li v-for="(s, i) in z.samples" :key="i">{{ s }}</li>
          </ul>
        </div>
      </div>

      <div class="bm-method chart-card">
        <h3 class="chart-title">报告统一骨架（方法论）</h3>
        <ol class="bm-outline">
          <li v-for="step in BENCHMARK_REPORT_OUTLINE" :key="step.step">
            <span class="bm-step-no">{{ step.step }}</span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.desc }}</p>
            </div>
          </li>
        </ol>
        <div class="bm-topics">
          <h4>专题研究</h4>
          <div class="bm-topic-row">
            <div v-for="t in BENCHMARK_SPECIAL_TOPICS" :key="t.id" class="bm-topic-chip">
              <strong>{{ t.title }}</strong>
              <span>{{ t.desc }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="info-card bm-domestic-head">
        <h2 class="section-title">国内市场竞品 · 标本品类近场对照</h2>
        <p class="section-text"><strong>市场格局：</strong>标本艺术市场呈「大市场、小品牌」；近场竞争者分为传统工艺品、新兴文创、专业标本三类。对标体系看「怎么长成」，本区看「怎么抢份额」。</p>
      </div>
      <div class="competitor-grid">
        <div class="chart-card"><h3 class="chart-title">核心竞品多维对比</h3><div class="chart-container" style="height: 400px;"><canvas ref="competitorRadarCanvas"></canvas></div></div>
        <div class="competitor-list">
          <div class="competitor-card" v-for="competitor in competitors" :key="competitor.name">
            <div class="competitor-header"><h4>{{ competitor.name }}</h4><span class="competitor-tag" :class="competitor.category">{{ competitor.categoryText }}</span></div>
            <div class="competitor-metrics">
              <div class="metric-row"><span>市场份额</span><span class="metric-value">{{ competitor.marketShare }}%</span></div>
              <div class="metric-row"><span>客单价</span><span class="metric-value">¥{{ competitor.avgPrice }}</span></div>
              <div class="metric-row"><span>SKU数量</span><span class="metric-value">{{ competitor.skuCount }}</span></div>
            </div>
            <div class="swot-analysis">
              <div class="swot-item strength"><strong>优势:</strong> {{ competitor.strengths }}</div>
              <div class="swot-item weakness"><strong>劣势:</strong> {{ competitor.weaknesses }}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="swot-matrix-card">
        <h3 class="chart-title">山海造物 SWOT 分析矩阵</h3>
        <div class="swot-matrix-container">
          <!-- 象限布局：2x2网格 -->
          <!-- 第一行：优势(左上) | 机会(右上) -->
          <!-- 第二行：劣势(左下) | 威胁(右下) -->
          <div class="swot-matrix-grid">
            <div class="swot-quadrant strength">
              <div class="quadrant-header">
                <div class="quadrant-icon">💪</div>
                <h4>优势 (Strengths)</h4>
                <div class="quadrant-subtitle">内部积极因素</div>
              </div>
              <ul class="quadrant-list">
                <li><span class="list-icon">✓</span>标本艺术化创新，差异化明显</li>
                <li><span class="list-icon">✓</span>门店体验模式已验证</li>
                <li><span class="list-icon">✓</span>手作课程转化率高（28.4%）</li>
                <li><span class="list-icon">✓</span>品牌调性独特，黑金质感</li>
              </ul>
            </div>
            
            <div class="swot-quadrant opportunity">
              <div class="quadrant-header">
                <div class="quadrant-icon">🚀</div>
                <h4>机会 (Opportunities)</h4>
                <div class="quadrant-subtitle">外部积极因素</div>
              </div>
              <ul class="quadrant-list">
                <li><span class="list-icon">⭐</span>Biophilic Design趋势兴起</li>
                <li><span class="list-icon">⭐</span>自然教育市场需求增长</li>
                <li><span class="list-icon">⭐</span>B端教育机构采购需求</li>
                <li><span class="list-icon">⭐</span>内容营销和私域运营红利</li>
              </ul>
            </div>
            
            <div class="swot-quadrant weakness">
              <div class="quadrant-header">
                <div class="quadrant-icon">⚠️</div>
                <h4>劣势 (Weaknesses)</h4>
                <div class="quadrant-subtitle">内部消极因素</div>
              </div>
              <ul class="quadrant-list">
                <li><span class="list-icon">○</span>供应链不稳定，依赖单一产区</li>
                <li><span class="list-icon">○</span>线上获客成本高</li>
                <li><span class="list-icon">○</span>非标品管理难度大</li>
                <li><span class="list-icon">○</span>品牌知名度有限</li>
              </ul>
            </div>
            
            <div class="swot-quadrant threat">
              <div class="quadrant-header">
                <div class="quadrant-icon">⚡</div>
                <h4>威胁 (Threats)</h4>
                <div class="quadrant-subtitle">外部消极因素</div>
              </div>
              <ul class="quadrant-list">
                <li><span class="list-icon">▲</span>原材料价格波动</li>
                <li><span class="list-icon">▲</span>合规风险（野生动物保护）</li>
                <li><span class="list-icon">▲</span>大品牌进入竞争</li>
                <li><span class="list-icon">▲</span>物流成本上升</li>
              </ul>
            </div>
          </div>
          
          <!-- 坐标轴标签 -->
          <div class="swot-axis-labels">
            <div class="axis-label-y">内部因素</div>
            <div class="axis-label-x">外部因素</div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 盈利模拟（升级版：场景预设 + 拆解 + 保本 + 健康度） -->
    <section v-if="currentView === 'profit'" class="view-section profit-page sr-view">
      <div class="profit-hero">
        <p class="profit-eyebrow">财务沙盘 · P&amp;L</p>
        <h2 class="profit-hero-title">盈利模拟实验室</h2>
        <p class="profit-hero-lead">
          基于「订单 × 客单价 − 固定成本 − 变动成本（按毛利率反推）」的简化月损益模型，用于门店/电商经营层快速试算，非审计口径。
        </p>
        <div class="profit-scenarios" role="group" aria-label="场景预设">
          <button
            v-for="s in profitScenarioList"
            :key="s.key"
            type="button"
            class="profit-scenario-btn"
            :class="{ active: profitScenarioKey === s.key }"
            @click="applyProfitScenario(s.key)"
          >
            <span class="ps-name">{{ s.name }}</span>
            <span class="ps-desc">{{ s.hint }}</span>
          </button>
        </div>
        <p v-if="profitScenarioKey === 'custom'" class="profit-scenario-hint">当前为手动调节参数，未套用上方预设。</p>
      </div>

      <div class="profit-layout">
        <aside class="profit-sidebar">
          <div class="profit-panel profit-panel-controls">
            <div class="profit-panel-head">
              <h3 class="profit-panel-title">参数调节</h3>
              <button type="button" class="profit-reset-btn" @click="resetProfitParams">恢复默认</button>
            </div>

            <div class="profit-param" v-for="field in profitParamFields" :key="field.key">
              <div class="profit-param-top">
                <label :for="'pf-' + field.key">{{ field.label }}</label>
                <span class="profit-param-val">{{ field.format(profitParams[field.key]) }}</span>
              </div>
              <input
                :id="'pf-' + field.key"
                v-model.number="profitParams[field.key]"
                type="range"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                class="profit-range"
                @input="onProfitParamAdjust"
              />
              <div class="profit-param-scale">
                <span>{{ field.format(field.min) }}</span>
                <span>{{ field.format(field.max) }}</span>
              </div>
            </div>

            <div class="profit-formula-note">
              <strong>口径说明：</strong>变动成本 = 营收 × (1 − 毛利率)；总成本 = 固定成本 + 变动成本；净利润 = 营收 − 总成本。
            </div>
          </div>

          <div class="profit-panel profit-panel-insight" :class="'level-' + profitHealth.level">
            <h3 class="profit-panel-title">经营信号</h3>
            <p class="profit-health-main">{{ profitHealth.title }}</p>
            <p class="profit-health-sub">{{ profitHealth.detail }}</p>
            <dl class="profit-dl">
              <div><dt>毛利额（估算）</dt><dd>¥{{ profitGrossProfit.toLocaleString() }}</dd></div>
              <div><dt>变动成本</dt><dd>¥{{ profitVariableCost.toLocaleString() }}</dd></div>
              <div><dt>固定成本</dt><dd>¥{{ profitParams.fixedCost.toLocaleString() }}</dd></div>
              <div v-if="profitBreakevenOrders != null">
                <dt>保本订单量</dt>
                <dd>约 <strong>{{ profitBreakevenOrders }}</strong> 单/月（按当前客单价与毛利率）</dd>
              </div>
            </dl>
          </div>
        </aside>

        <div class="profit-main">
          <div class="chart-card profit-chart-card">
            <div class="chart-card-head">
              <h3 class="chart-title">营收 · 成本 · 利润</h3>
              <p class="chart-note">柱状图随左侧参数实时联动；利润为负时柱色标红提示。</p>
            </div>
            <div class="chart-container profit-chart-canvas-wrap">
              <canvas ref="profit3DChartCanvas"></canvas>
            </div>
          </div>

          <div class="profit-waterfall-card">
            <h3 class="profit-waterfall-title">月营收结构（占营收比）</h3>
            <div
              class="profit-stack-bar"
              role="img"
              :aria-label="profitCostMix.loss ? '成本结构（亏损模式）' : '营收占比结构'"
            >
              <div
                class="seg seg-fixed"
                :style="{ width: profitCostMix.fixedPct + '%' }"
                title="固定成本"
              >
                <span v-if="profitCostMix.fixedPct >= 10">固定 {{ profitCostMix.fixedPct.toFixed(0) }}%</span>
              </div>
              <div
                class="seg seg-variable"
                :style="{ width: profitCostMix.variablePct + '%' }"
                title="变动成本"
              >
                <span v-if="profitCostMix.variablePct >= 10">变动 {{ profitCostMix.variablePct.toFixed(0) }}%</span>
              </div>
              <div
                v-if="!profitCostMix.loss"
                class="seg seg-profit"
                :class="{ neg: calculatedProfit <= 0 }"
                :style="{ width: Math.max(0.5, profitCostMix.profitPct) + '%' }"
                title="净利润"
              >
                <span v-if="profitCostMix.profitPct >= 5">净利 {{ profitCostMix.profitPct.toFixed(0) }}%</span>
              </div>
            </div>
            <p v-if="profitCostMix.loss" class="profit-loss-cap">
              亏损模式下展示<strong>成本内部结构</strong>（固定 vs 变动）。相对营收，总成本约高出
              <strong>{{ profitCostMix.lossGapPct.toFixed(1) }}%</strong>。
            </p>
            <ul class="profit-legend">
              <li><i class="dot fixed"></i>{{ profitCostMix.loss ? '固定成本（占成本合计）' : '固定成本占营收' }}</li>
              <li><i class="dot variable"></i>{{ profitCostMix.loss ? '变动成本（占成本合计）' : '变动成本占营收' }}</li>
              <li v-if="!profitCostMix.loss"><i class="dot profit"></i>净利润占营收</li>
            </ul>
          </div>

          <div class="profit-metrics-grid">
            <div class="metric-card revenue">
              <div class="metric-label">月营收</div>
              <div class="metric-large-value">¥{{ calculatedRevenue.toLocaleString() }}</div>
              <div class="metric-trend">订单 × 客单价</div>
            </div>
            <div class="metric-card cost">
              <div class="metric-label">月总成本</div>
              <div class="metric-large-value">¥{{ calculatedCost.toLocaleString() }}</div>
              <div class="metric-trend">含固定与变动</div>
            </div>
            <div class="metric-card muted">
              <div class="metric-label">变动成本</div>
              <div class="metric-large-value">¥{{ profitVariableCost.toLocaleString() }}</div>
              <div class="metric-trend">随毛利率变化</div>
            </div>
            <div class="metric-card muted">
              <div class="metric-label">毛利额</div>
              <div class="metric-large-value">¥{{ profitGrossProfit.toLocaleString() }}</div>
              <div class="metric-trend">营收 − 变动</div>
            </div>
            <div class="metric-card profit">
              <div class="metric-label">月净利润</div>
              <div class="metric-large-value">¥{{ calculatedProfit.toLocaleString() }}</div>
              <div class="metric-trend" :class="{ positive: calculatedProfit > 0, negative: calculatedProfit <= 0 }">
                {{ calculatedProfit > 0 ? '盈利' : '亏损' }}
              </div>
            </div>
            <div class="metric-card margin">
              <div class="metric-label">净利润率</div>
              <div class="metric-large-value">{{ calculatedMargin.toFixed(1) }}%</div>
              <div class="metric-trend">净利 ÷ 营收</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 爆品概念生成器 -->
    <section v-if="currentView === 'productGenerator'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">🎨 爆品概念生成器</h2>
        <p class="section-text">
          <strong>功能说明：</strong> 基于产品金字塔定位，AI自动生成新品SKU方案，包含材质选择、定价策略、核心卖点等完整产品概念。
        </p>
      </div>

      <!-- 生成器控制面板 -->
      <div class="generator-control-panel">
        <div class="control-section">
          <h3 class="control-section-title">选择产品定位</h3>
          <div class="product-type-selector">
            <button 
              v-for="type in productTypes" 
              :key="type.value"
              @click="selectedProductType = type.value"
              :class="['type-select-btn', { active: selectedProductType === type.value }]"
            >
              <span class="type-icon">{{ type.icon }}</span>
              <span class="type-name">{{ type.name }}</span>
              <span class="type-desc">{{ type.desc }}</span>
            </button>
          </div>
        </div>

        <div class="control-section">
          <h3 class="control-section-title">生成选项</h3>
          <div class="generator-options">
            <div class="option-group">
              <label>产品类别</label>
              <select v-model="generatorOptions.category" class="option-select">
                <option value="insect">昆虫/蝴蝶</option>
                <option value="plant">植物</option>
                <option value="marine">海洋生物</option>
                <option value="resin">树脂工艺品</option>
                <option value="mixed">混合类型</option>
              </select>
            </div>
            <div class="option-group">
              <label>创新方向</label>
              <select v-model="generatorOptions.innovation" class="option-select">
                <option value="material">材质创新</option>
                <option value="design">设计创新</option>
                <option value="function">功能创新</option>
                <option value="experience">体验创新</option>
              </select>
            </div>
          </div>
        </div>

        <div class="generate-action">
          <button 
            @click="generateProductConcept" 
            :disabled="isGenerating"
            class="generate-btn"
          >
            <span v-if="!isGenerating">✨ 生成新品方案</span>
            <span v-else>🔄 正在生成中...</span>
          </button>
        </div>
      </div>

          <!-- 加载状态 -->
      <div v-if="isGenerating" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p class="loading-text">AI正在生成中，请稍候...</p>
      </div>

      <!-- 生成结果展示 -->
      <div v-if="generatedConcept" class="generated-concept-card">
        <div class="concept-header">
          <h3 class="concept-title">{{ generatedConcept.name }}</h3>
          <div class="concept-actions">
            <button @click="exportConcept" class="export-btn">📥 导出方案</button>
            <button @click="regenerateConcept" class="regenerate-btn">🔄 重新生成</button>
          </div>
        </div>
        
        <div class="concept-content">
          <div class="concept-section">
            <h4 class="concept-section-title">📦 产品信息</h4>
            <div class="concept-info-grid">
              <div class="info-item">
                <span class="info-label">产品名称</span>
                <span class="info-value">{{ generatedConcept.name }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">产品定位</span>
                <span class="info-value">{{ generatedConcept.position }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">建议定价</span>
                <span class="info-value highlight">¥{{ generatedConcept.price }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">目标毛利率</span>
                <span class="info-value">{{ generatedConcept.margin }}%</span>
              </div>
            </div>
          </div>

          <div class="concept-section">
            <h4 class="concept-section-title">🔬 材质与工艺</h4>
            <div class="concept-text">{{ generatedConcept.materials }}</div>
          </div>

          <div class="concept-section">
            <h4 class="concept-section-title">💡 核心卖点</h4>
            <ul class="selling-points">
              <li v-for="(point, index) in generatedConcept.sellingPoints" :key="index">
                {{ point }}
              </li>
            </ul>
          </div>

          <div class="concept-section">
            <h4 class="concept-section-title">🎯 目标人群</h4>
            <div class="concept-text">{{ generatedConcept.targetAudience }}</div>
          </div>

          <div class="concept-section">
            <h4 class="concept-section-title">📈 市场策略</h4>
            <div class="concept-text">{{ generatedConcept.strategy }}</div>
          </div>
        </div>
      </div>

      <!-- 历史生成记录 -->
      <div v-if="conceptHistory.length > 0" class="concept-history">
        <h3 class="history-title">📚 历史生成记录</h3>
        <div class="history-list">
          <div 
            v-for="(concept, index) in conceptHistory" 
            :key="index"
            class="history-item"
            @click="loadConcept(concept)"
          >
            <div class="history-item-header">
              <span class="history-name">{{ concept.name }}</span>
              <span class="history-type">{{ concept.position }}</span>
            </div>
            <div class="history-item-price">¥{{ concept.price }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 门店设计与热力图 -->
    <section v-if="currentView === 'store'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">门店动线与热力图 · 展陈规划设计</h2>
        <p class="section-text"><strong>门店设计理念：</strong> 以"自然美学"为核心，通过动线设计引导顾客体验，通过热力图优化展陈布局，提升转化率和客单价。</p>
      </div>
      <div class="store-design-grid">
        <div class="chart-card"><h3 class="chart-title">门店动线规划</h3><div class="store-layout-visual"><div class="store-zone" v-for="zone in storeZones" :key="zone.name" :style="zone.style"><div class="zone-label">{{ zone.name }}</div><div class="zone-desc">{{ zone.description }}</div></div><div class="flow-arrow" v-for="(arrow, index) in flowArrows" :key="index" :style="arrow.style">→</div></div></div>
        <div class="chart-card"><h3 class="chart-title">热力图分析</h3><div class="heatmap-container"><canvas ref="heatmapCanvas"></canvas></div><div class="heatmap-legend"><span>低</span><div class="legend-gradient"></div><span>高</span></div></div>
      </div>
      <div class="display-design-card">
        <h3 class="chart-title">展陈设计方案</h3>
        <div class="display-zones">
          <div class="display-zone-card" v-for="display in displayDesigns" :key="display.name">
            <div class="display-header"><h4>{{ display.name }}</h4><span class="display-priority">{{ display.priority }}</span></div>
            <div class="display-content"><p><strong>展陈要点:</strong> {{ display.keyPoints }}</p><p><strong>产品配置:</strong> {{ display.products }}</p><p><strong>交互设计:</strong> {{ display.interaction }}</p></div>
          </div>
        </div>
      </div>

      <!-- 展陈空间设计师 -->
      <div class="spatial-designer-section">
        <div class="info-card">
          <h2 class="section-title">🎨 展陈空间设计师</h2>
          <p class="section-text">
            <strong>功能说明：</strong> 基于门店动线数据和热力图分析，AI自动生成具体的陈列改造方案，优化顾客动线和转化率。
          </p>
        </div>

        <div class="spatial-designer-panel">
          <div class="designer-controls">
            <div class="control-group">
              <h3 class="control-title">选择优化区域</h3>
              <div class="zone-selector">
                <button 
                  v-for="zone in storeZones" 
                  :key="zone.name"
                  @click="selectedZone = zone.name"
                  :class="['zone-btn', { active: selectedZone === zone.name }]"
                >
                  <span>{{ zone.name }}</span>
                  <span class="zone-desc-small">{{ zone.description }}</span>
                </button>
              </div>
            </div>

            <div class="control-group">
              <h3 class="control-title">优化目标</h3>
              <div class="optimization-goals">
                <label class="goal-checkbox">
                  <input type="checkbox" v-model="optimizationGoals.flow" />
                  <span>优化动线</span>
                </label>
                <label class="goal-checkbox">
                  <input type="checkbox" v-model="optimizationGoals.conversion" />
                  <span>提升转化率</span>
                </label>
                <label class="goal-checkbox">
                  <input type="checkbox" v-model="optimizationGoals.experience" />
                  <span>增强体验</span>
                </label>
                <label class="goal-checkbox">
                  <input type="checkbox" v-model="optimizationGoals.display" />
                  <span>优化展陈</span>
                </label>
              </div>
            </div>

            <button 
              @click="generateSpatialDesign" 
              :disabled="isGeneratingSpatial"
              class="generate-design-btn"
            >
              <span v-if="!isGeneratingSpatial">✨ 生成陈列改造方案</span>
              <span v-else>🔄 正在生成中...</span>
            </button>
          </div>

          <!-- 加载状态 -->
          <div v-if="isGeneratingSpatial" class="loading-overlay">
            <div class="loading-spinner"></div>
            <p class="loading-text">AI正在分析并生成方案...</p>
          </div>

          <!-- 生成结果 -->
          <div v-if="spatialDesign" class="spatial-design-result">
            <div class="result-header">
              <h3 class="result-title">{{ spatialDesign.zone }} - 陈列改造方案</h3>
              <div class="result-actions">
                <button @click="exportSpatialDesign" class="export-btn-small">📥 导出</button>
                <button @click="regenerateSpatialDesign" class="regenerate-btn-small">🔄 重新生成</button>
              </div>
            </div>
            
            <div class="design-content">
              <div class="design-section">
                <h4 class="design-section-title">📊 问题分析</h4>
                <div class="design-text">{{ spatialDesign.analysis }}</div>
              </div>

              <div class="design-section">
                <h4 class="design-section-title">💡 改造方案</h4>
                <ul class="design-solutions">
                  <li v-for="(solution, index) in spatialDesign.solutions" :key="index">
                    {{ solution }}
                  </li>
                </ul>
              </div>

              <div class="design-section">
                <h4 class="design-section-title">🎯 预期效果</h4>
                <div class="design-text">{{ spatialDesign.expectedEffect }}</div>
              </div>

              <div class="design-section">
                <h4 class="design-section-title">📋 实施步骤</h4>
                <ol class="design-steps">
                  <li v-for="(step, index) in spatialDesign.steps" :key="index">
                    {{ step }}
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 精细化3年规划 -->
    <section v-if="currentView === 'planning'" class="view-section sr-view planning-page">
      <div class="info-card planning-hero">
        <h2 class="section-title">精细化3年规划 · 战略路线图</h2>
        <p class="section-text">
          <strong>战略目标：</strong> 通过3年精细化规划，实现从单店模型到多店扩张，从区域品牌到全国知名品牌的跨越。下图将<strong>关键指标曲线</strong>、<strong>资本投入结构</strong>与<strong>年度里程碑</strong>放在同一视图中，便于对内对齐与对外路演。
        </p>
      </div>

      <div class="planning-kpi-strip" role="list">
        <div v-for="k in planningKpiStrip" :key="k.label" class="planning-kpi-card" role="listitem">
          <span class="planning-kpi-label">{{ k.label }}</span>
          <span class="planning-kpi-value">{{ k.value }}</span>
          <span class="planning-kpi-sub">{{ k.sub }}</span>
        </div>
      </div>

      <div class="planning-phase-track" aria-label="三年阶段主轴">
        <div v-for="(y, idx) in threeYearPlan" :key="y.year" class="planning-phase-node">
          <span class="planning-phase-idx">{{ idx + 1 }}</span>
          <div class="planning-phase-body">
            <span class="planning-phase-year">{{ y.year }} 年</span>
            <span class="planning-phase-theme">{{ y.theme }}</span>
          </div>
        </div>
      </div>

      <div class="planning-charts-grid">
        <div class="chart-card planning-line-card">
          <div class="planning-chart-head">
            <h3 class="chart-title">关键指标预测 · 双轴曲线</h3>
            <p class="planning-chart-desc">
              左轴为<strong>年营收（万元）</strong>，右轴为<strong>门店数（家）</strong>；末列「2028」为展望口径，可与融资与开店节奏表对齐更新。
            </p>
          </div>
          <div class="chart-container planning-chart-tall">
            <canvas ref="planningChartCanvas"></canvas>
          </div>
          <p class="planning-chart-foot">提示：悬停数据点可查看双指标当年取值。</p>
        </div>
        <div class="chart-card planning-doughnut-card">
          <h3 class="chart-title">三年总投入 · 结构占比</h3>
          <p class="planning-chart-desc compact">大类预算占比（与下方明细表同源）。</p>
          <div class="planning-doughnut-wrap">
            <canvas ref="planningCapexCanvas"></canvas>
          </div>
          <ul class="planning-capex-mini" aria-label="投入大类占比">
            <li v-for="row in planningCapexLegend" :key="row.category">
              <span class="capex-dot" :style="{ background: row.color }"></span>
              <span class="capex-name">{{ row.category }}</span>
              <span class="capex-pct">{{ row.pct }}%</span>
              <span class="capex-amt">¥{{ row.amount.toLocaleString() }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="planning-timeline-block">
        <h3 class="chart-title planning-block-title">年度里程碑路线图</h3>
        <p class="planning-block-lead">按年度拆解可交付成果；每项附带量化牵引指标，便于 OKR 与预算滚动对齐。</p>
        <div class="timeline-container planning-timeline">
          <div class="timeline-year" v-for="year in threeYearPlan" :key="year.year">
            <div class="year-header">
              <h3>{{ year.year }} 年</h3>
              <span class="year-theme">{{ year.theme }}</span>
            </div>
            <div class="year-milestones">
              <div class="milestone-card" v-for="milestone in year.milestones" :key="milestone.name">
                <div class="milestone-dot" aria-hidden="true"></div>
                <div class="milestone-content">
                  <h4>{{ milestone.name }}</h4>
                  <p>{{ milestone.description }}</p>
                  <div class="milestone-metrics">
                    <span v-for="metric in milestone.metrics" :key="metric.label" class="milestone-chip">
                      <em>{{ metric.label }}</em>
                      {{ metric.value }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="resource-allocation-card planning-resource-card">
        <div class="planning-resource-head">
          <h3 class="chart-title">资源配置规划 · 明细拆解</h3>
          <p class="planning-chart-desc compact">
            三年规划池合计约 <strong>¥{{ (planningInvestmentTotal / 10000).toFixed(0) }} 万</strong>（示意，可按实际现金流表替换）。
          </p>
        </div>
        <div class="allocation-grid">
          <div class="allocation-item" v-for="resource in resourceAllocation" :key="resource.category">
            <div class="allocation-header">
              <h4>{{ resource.category }}</h4>
              <span class="allocation-total">总投入 ¥{{ resource.total.toLocaleString() }}</span>
            </div>
            <div class="allocation-breakdown">
              <div class="breakdown-item" v-for="item in resource.breakdown" :key="item.name">
                <div class="breakdown-bar">
                  <div
                    class="breakdown-fill"
                    :style="{ width: (item.amount / resource.total) * 100 + '%' }"
                  ></div>
                </div>
                <div class="breakdown-label">
                  <span>{{ item.name }}</span>
                  <span
                    >¥{{ item.amount.toLocaleString() }}（{{
                      ((item.amount / resource.total) * 100).toFixed(1)
                    }}%）</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: 合规专栏 -->
    <section v-if="currentView === 'compliance'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">合规专栏 · 核心事项管理</h2>
        <p class="section-text">
          <strong>依据：</strong>《中国动植物标本产业链深度调研与“山海造物”品牌拓展战略报告》中的政策法规与合规体系章节。
          在标本行业，合规不仅是底线，更是品牌护城河。此专栏将合规事项结构化为可执行清单、证据链与风险分级，供日常运营与选品审核使用。
        </p>
      </div>

      <div class="compliance-grid">
        <div class="chart-card">
          <h3 class="chart-title">合规覆盖率</h3>
          <div class="compliance-progress">
            <div class="progress-label">
              <span>已完成</span>
              <span class="progress-num">{{ complianceStats.done }}/{{ complianceItems.length }}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: complianceStats.coverage + '%' }"></div>
            </div>
            <div class="progress-hint">覆盖率 {{ complianceStats.coverage.toFixed(0) }}% · 高风险未关闭 {{ complianceStats.highOpen }}</div>
          </div>
        </div>

        <div class="chart-card">
          <h3 class="chart-title">合规红线（绝对禁区）</h3>
          <div class="compliance-cards">
            <div class="compliance-callout danger">
              <div class="callout-title">绝对禁止商业贸易</div>
              <ul>
                <li>犀牛、虎及其制品（任何来源均禁止）</li>
                <li>象牙及其制品（2017 起全面禁止商业性加工销售）</li>
                <li>避免误导性命名：如“象牙果”需明确标注为植物来源</li>
              </ul>
            </div>
            <div class="compliance-callout warning">
              <div class="callout-title">高敏物种与“三有”动态调整</div>
              <ul>
                <li>“三有”名录动态调整：新增/调出会改变审批流程与合规成本</li>
                <li>选品策略：优先使用政策相对宽松的无脊椎与植物；对可调出物种保持持续跟踪</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="chart-card full-width">
          <div class="compliance-toolbar">
            <h3 class="chart-title">物种合规清单</h3>
            <div class="toolbar-right">
              <input v-model="speciesSearch" class="filter-input" placeholder="搜索：物种/别名/备注" />
              <select v-model="speciesTab" class="filter-select">
                <option value="banned">绝对禁止</option>
                <option value="sanyou">三有/敏感</option>
                <option value="protected">保护名录</option>
              </select>
              <button class="chart-action-btn" @click="addSpeciesItem">新增</button>
              <button class="chart-action-btn" @click="saveSpeciesLists">保存</button>
              <button class="chart-action-btn" @click="resetSpeciesLists">重置默认</button>
            </div>
          </div>

          <div class="species-table">
            <div class="st-head">
              <div>名称</div>
              <div>别名/说明</div>
              <div>来源/依据</div>
              <div>备注</div>
              <div></div>
            </div>
            <div v-for="row in filteredSpeciesList" :key="row.id" class="st-row">
              <div><input v-model="row.name" class="cell-input" placeholder="物种/关键词" /></div>
              <div><input v-model="row.alias" class="cell-input" placeholder="别名/识别要点" /></div>
              <div><input v-model="row.basis" class="cell-input" placeholder="依据/链接/内部文档" /></div>
              <div><input v-model="row.note" class="cell-input" placeholder="备注" /></div>
              <div class="st-actions">
                <button class="mini-btn danger" @click="removeSpeciesItem(row.id)">删除</button>
              </div>
            </div>
          </div>

          <div class="compliance-note">
            <strong>使用建议：</strong>该清单用于“选品预审/命名审核/内容审核”的第一层过滤；三有/保护名录可能动态调整，建议每季度复核一次。
          </div>
        </div>

        <div class="chart-card full-width">
          <div class="compliance-toolbar">
            <h3 class="chart-title">合规事项清单（可执行）</h3>
            <div class="toolbar-right">
              <select v-model="complianceFilter.risk" class="filter-select">
                <option value="">全部风险</option>
                <option value="high">高风险</option>
                <option value="medium">中风险</option>
                <option value="low">低风险</option>
              </select>
              <select v-model="complianceFilter.status" class="filter-select">
                <option value="">全部状态</option>
                <option value="open">待处理</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
              </select>
              <button class="chart-action-btn" @click="resetCompliance">重置默认</button>
              <button class="chart-action-btn" @click="saveCompliance">保存</button>
            </div>
          </div>

          <div class="compliance-table">
            <div class="ct-head">
              <div>事项</div>
              <div>风险</div>
              <div>状态</div>
              <div>证据链/材料</div>
              <div>负责人</div>
            </div>
            <div
              v-for="item in filteredComplianceItems"
              :key="item.id"
              class="ct-row"
              :class="['risk-' + item.risk, 'status-' + item.status]"
            >
              <div class="ct-title">
                <div class="t1">{{ item.title }}</div>
                <div class="t2">{{ item.desc }}</div>
              </div>
              <div class="ct-pill">
                <span class="pill" :class="item.risk">{{ riskText[item.risk] }}</span>
              </div>
              <div class="ct-pill">
                <select v-model="item.status" class="cell-select">
                  <option value="open">待处理</option>
                  <option value="doing">进行中</option>
                  <option value="done">已完成</option>
                </select>
              </div>
              <div class="ct-evidence">
                <ul>
                  <li v-for="(e, idx) in item.evidence" :key="idx">{{ e }}</li>
                </ul>
              </div>
              <div class="ct-owner">
                <input v-model="item.owner" class="cell-input" placeholder="负责人" />
              </div>
            </div>
          </div>

          <div class="compliance-note">
            <strong>提示：</strong>涉及国家重点保护野生动物的标本流通需“专用标识”与《标本收藏证》；需警惕以合法手续掩盖非法来源的“洗白”风险。
          </div>
        </div>

        <div class="chart-card full-width">
          <div class="compliance-toolbar">
            <h3 class="chart-title">大型标本台账（录入/核查/风险提示）</h3>
            <div class="toolbar-right">
              <input v-model="specimenSearch" class="filter-input" placeholder="搜索：标本名/物种/供应商/证号/标识号" />
              <select v-model="specimenRiskFilter" class="filter-select">
                <option value="">全部风险</option>
                <option value="high">高风险</option>
                <option value="medium">中风险</option>
                <option value="low">低风险</option>
              </select>
              <button class="chart-action-btn" @click="specimenForm = { id:'', name:'', species:'', category:'large', sourceType:'breeding', protectedLevel:'', hasSpecialTag:false, specialTagCode:'', hasCollectionCert:false, collectionCertNo:'', supplier:'', purchaseId:'', batchNo:'', entryDate:'', storageLocation:'', notes:'' }">
                新增标本
              </button>
              <button class="chart-action-btn" @click="upsertSpecimen(specimenForm)">保存标本</button>
            </div>
          </div>

          <div class="specimen-form">
            <div class="sf-grid">
              <div class="sf-item"><div class="sf-label">标本名称</div><input v-model="specimenForm.name" class="cell-input" placeholder="例如：暹罗鳄头骨标本" /></div>
              <div class="sf-item"><div class="sf-label">物种/关键词</div><input v-model="specimenForm.species" class="cell-input" placeholder="中文/学名/关键词" /></div>
              <div class="sf-item">
                <div class="sf-label">来源类型</div>
                <select v-model="specimenForm.sourceType" class="cell-select">
                  <option value="breeding">人工繁育</option>
                  <option value="import">进口</option>
                  <option value="purchase">采购</option>
                  <option value="consignment">寄售/合作方</option>
                  <option value="unknown">未知</option>
                </select>
              </div>
              <div class="sf-item"><div class="sf-label">保护/三有等级</div><input v-model="specimenForm.protectedLevel" class="cell-input" placeholder="一级/二级/三有/非保护/未知" /></div>
              <div class="sf-item"><div class="sf-label">供应商</div><input v-model="specimenForm.supplier" class="cell-input" placeholder="供应商/养殖场/加工企业" /></div>
              <div class="sf-item"><div class="sf-label">批次号</div><input v-model="specimenForm.batchNo" class="cell-input" placeholder="批次/编号" /></div>
              <div class="sf-item"><div class="sf-label">入库日期</div><input v-model="specimenForm.entryDate" class="cell-input" placeholder="YYYY-MM-DD" /></div>
              <div class="sf-item"><div class="sf-label">存放位置</div><input v-model="specimenForm.storageLocation" class="cell-input" placeholder="库位/展柜/仓位" /></div>
              <div class="sf-item sf-check">
                <label class="check"><input type="checkbox" v-model="specimenForm.hasSpecialTag" /> 专用标识</label>
                <input v-model="specimenForm.specialTagCode" class="cell-input" placeholder="标识号/扫码信息" :disabled="!specimenForm.hasSpecialTag" />
              </div>
              <div class="sf-item sf-check">
                <label class="check"><input type="checkbox" v-model="specimenForm.hasCollectionCert" /> 收藏证</label>
                <input v-model="specimenForm.collectionCertNo" class="cell-input" placeholder="收藏证编号" :disabled="!specimenForm.hasCollectionCert" />
              </div>
              <div class="sf-item sf-wide">
                <div class="sf-label">备注</div>
                <input v-model="specimenForm.notes" class="cell-input" placeholder="补充说明、风险点、处理意见" />
              </div>
            </div>

            <div class="sf-risk" :class="specimenRisk(specimenForm).risk">
              <div class="sf-risk-title">完整度核查与风险提示</div>
              <div v-if="specimenRisk(specimenForm).missing.length > 0" class="sf-risk-line">
                <strong>缺失：</strong>{{ specimenRisk(specimenForm).missing.join('、') }}
              </div>
              <div v-if="specimenRisk(specimenForm).highFlags.length > 0" class="sf-risk-line">
                <strong>高风险：</strong>
                <ul>
                  <li v-for="(x, i) in specimenRisk(specimenForm).highFlags" :key="i">{{ x }}</li>
                </ul>
              </div>
              <div v-if="specimenRisk(specimenForm).missing.length === 0 && specimenRisk(specimenForm).highFlags.length === 0" class="sf-risk-line">
                当前记录完整度良好，未发现明显高风险项。
              </div>
            </div>
          </div>

          <div class="specimen-list">
            <div class="ct-head">
              <div>标本</div>
              <div>风险</div>
              <div>来源/等级</div>
              <div>证据链</div>
              <div>操作</div>
            </div>
            <div v-for="s in filteredSpecimens" :key="s.id" class="ct-row">
              <div class="ct-title">
                <div class="t1">{{ s.name || '未命名标本' }}</div>
                <div class="t2">{{ s.species }} · {{ s.supplier || '未填供应商' }} · 入库 {{ s.entryDate || '-' }} · {{ s.storageLocation || '未填位置' }}</div>
              </div>
              <div class="ct-pill">
                <span class="pill" :class="specimenRisk(s).risk">
                  {{ specimenRisk(s).risk === 'high' ? '高风险' : (specimenRisk(s).risk === 'medium' ? '待完善' : '低风险') }}
                </span>
              </div>
              <div class="ct-evidence">
                <div>来源：{{ s.sourceType }} / {{ s.protectedLevel || '未标注' }}</div>
                <div>批次：{{ s.batchNo || '-' }}</div>
              </div>
              <div class="ct-evidence">
                <div>专用标识：{{ s.hasSpecialTag ? (s.specialTagCode || '已勾选未填') : '无' }}</div>
                <div>收藏证：{{ s.hasCollectionCert ? (s.collectionCertNo || '已勾选未填') : '无' }}</div>
              </div>
              <div class="st-actions">
                <button class="mini-btn" @click="specimenForm = { ...s }">编辑</button>
                <button class="mini-btn danger" @click="removeSpecimen(s.id)">删除</button>
              </div>
            </div>
          </div>
        </div>

        <div class="chart-card full-width">
          <div class="compliance-toolbar">
            <h3 class="chart-title">采购记录录入（证据链）</h3>
            <div class="toolbar-right">
              <button class="chart-action-btn" @click="procurementForm = { id:'', supplier:'', contact:'', date:'', items:'', amount:'', docs:{ contract:false, invoice:false, deliveryNote:false, breedingProof:false, quarantine:false, customs:false, other:false }, notes:'' }">新增采购</button>
              <button class="chart-action-btn" @click="upsertProcurement(procurementForm)">保存采购</button>
            </div>
          </div>

          <div class="proc-form">
            <div class="sf-grid">
              <div class="sf-item"><div class="sf-label">供应商</div><input v-model="procurementForm.supplier" class="cell-input" placeholder="供应商/养殖场/加工厂" /></div>
              <div class="sf-item"><div class="sf-label">联系人</div><input v-model="procurementForm.contact" class="cell-input" placeholder="电话/微信/邮箱" /></div>
              <div class="sf-item"><div class="sf-label">日期</div><input v-model="procurementForm.date" class="cell-input" placeholder="YYYY-MM-DD" /></div>
              <div class="sf-item"><div class="sf-label">金额</div><input v-model="procurementForm.amount" class="cell-input" placeholder="¥" /></div>
              <div class="sf-item sf-wide"><div class="sf-label">采购内容</div><input v-model="procurementForm.items" class="cell-input" placeholder="品类/数量/规格" /></div>
              <div class="sf-item sf-wide">
                <div class="sf-label">证据材料</div>
                <div class="docs">
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.contract" /> 合同</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.invoice" /> 发票</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.deliveryNote" /> 出货/送货单</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.breedingProof" /> 养殖/来源证明</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.quarantine" /> 检疫/检验证明</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.customs" /> 报关/进口资料</label>
                  <label class="check"><input type="checkbox" v-model="procurementForm.docs.other" /> 其他</label>
                </div>
              </div>
              <div class="sf-item sf-wide"><div class="sf-label">备注</div><input v-model="procurementForm.notes" class="cell-input" placeholder="补充说明" /></div>
            </div>
          </div>

          <div class="proc-list">
            <div class="ct-head">
              <div>采购</div>
              <div>材料覆盖</div>
              <div>日期/金额</div>
              <div>内容</div>
              <div>操作</div>
            </div>
            <div v-for="p in procurements" :key="p.id" class="ct-row">
              <div class="ct-title">
                <div class="t1">{{ p.supplier || '未填供应商' }}</div>
                <div class="t2">{{ p.contact || '-' }}</div>
              </div>
              <div class="ct-evidence">
                <div>合同：{{ p.docs?.contract ? '✅' : '—' }} / 出货单：{{ p.docs?.deliveryNote ? '✅' : '—' }} / 来源证明：{{ p.docs?.breedingProof ? '✅' : '—' }}</div>
                <div>发票：{{ p.docs?.invoice ? '✅' : '—' }} / 检疫：{{ p.docs?.quarantine ? '✅' : '—' }} / 报关：{{ p.docs?.customs ? '✅' : '—' }}</div>
              </div>
              <div class="ct-evidence">{{ p.date || '-' }} · {{ p.amount || '-' }}</div>
              <div class="ct-evidence">{{ p.items || '-' }}</div>
              <div class="st-actions">
                <button class="mini-btn" @click="procurementForm = { ...p, docs: { ...p.docs } }">编辑</button>
                <button class="mini-btn danger" @click="removeProcurement(p.id)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION: AI用研结论 -->
    <section v-if="currentView === 'aiResearch'" class="view-section sr-view">
      <div class="info-card">
        <h2 class="section-title">🔬 AI用研结论</h2>
        <p class="section-text">
          <strong>数据来源：</strong> AI智能中心 - 战略用研模块自动同步的调研结论
        </p>
      </div>

      <!-- 筛选和排序 -->
      <div class="research-filters">
        <div class="filter-group">
          <label>调研类型：</label>
          <select v-model="researchFilter.type" class="filter-select">
            <option value="">全部</option>
            <option value="market">市场调研</option>
            <option value="user">用户调研</option>
            <option value="competitor">竞品调研</option>
            <option value="trend">行业趋势</option>
            <option value="product">产品需求</option>
          </select>
        </div>
        <div class="filter-group">
          <label>排序方式：</label>
          <select v-model="researchSort" class="filter-select">
            <option value="newest">最新优先</option>
            <option value="oldest">最早优先</option>
          </select>
        </div>
        <button @click="loadAIResearch" class="refresh-btn">🔄 刷新</button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loadingResearch" class="loading-state">
        <div class="loading-spinner"></div>
        <p>正在加载用研结论...</p>
      </div>

      <!-- 用研结论列表 -->
      <div v-else-if="filteredResearch.length > 0" class="research-list">
        <div
          v-for="item in filteredResearch"
          :key="item._id"
          class="research-card"
          :class="{ expanded: expandedResearchId === item._id }"
        >
          <div class="research-card-header" @click="toggleExpand(item._id)">
            <div class="research-header-left">
              <span class="research-type-badge" :class="`type-${item.type}`">
                {{ getResearchTypeLabel(item.type) }}
              </span>
              <h3 class="research-topic">{{ item.topic }}</h3>
            </div>
            <div class="research-header-right">
              <span class="research-date">{{ formatResearchDate(item.createTime) }}</span>
              <span class="expand-icon">{{ expandedResearchId === item._id ? '▼' : '▶' }}</span>
            </div>
          </div>
          
          <div class="research-summary" v-if="!expandedResearchId || expandedResearchId !== item._id">
            {{ item.summary }}
          </div>

          <div v-if="expandedResearchId === item._id" class="research-content">
            <div v-if="item.objective" class="research-section">
              <h4>调研目标</h4>
              <p>{{ item.objective }}</p>
            </div>

            <div v-if="item.keyFindings && item.keyFindings.length > 0" class="research-section">
              <h4>关键发现</h4>
              <ul class="findings-list">
                <li v-for="(finding, idx) in item.keyFindings" :key="idx">{{ finding }}</li>
              </ul>
            </div>

            <div class="research-section">
              <h4>详细内容</h4>
              <div class="research-detail" v-html="marked.parse(item.content)"></div>
            </div>

            <div class="research-actions">
              <button @click="exportResearch(item)" class="export-btn-small">📥 导出报告</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">🔬</div>
        <h3>暂无用研结论</h3>
        <p>前往 AI智能中心 → 战略用研AI 模块创建调研并同步到看板</p>
      </div>
    </section>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import Chart from 'chart.js/auto'
import { callGeminiAPI, extractJSON } from '../utils/aiHelper'
import { fetchCollectionSorted, COLLECTIONS } from '../cloud'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import {
  BENCHMARK_META,
  BENCHMARK_AXES,
  BENCHMARK_GROUPS,
  BENCHMARK_REPORT_OUTLINE,
  BENCHMARK_ZONES,
  BENCHMARK_BRANDS,
  BENCHMARK_SPECIAL_TOPICS,
  getBenchmarkStats
} from '../data/benchmarkResearchLibrary'
import {
  loadBenchmarkDocs,
  searchBenchmarkDocs,
  ingestUploadFile,
  docsForBrand
} from '../utils/benchmarkResearchCloud'

// -------------------------------------------------
// VI 调色板（与 design-tokens.css 对齐的固定色值）
// Chart.js 不稳定支持 CSS var()，因此图表统一使用 hex 常量
// -------------------------------------------------
const VI = {
  brandGreen: '#2d6a4f',
  brandGreen600: '#245a42',
  gold400: '#c4a55a',
  earth600: '#74603e',
  textSecondary: '#6b665d',
  textTertiary: '#9b968d',
  sage: '#7b8c7c',
  info: '#5b8fb9',
  success: '#52b788',
  error: '#d05450'
}

/** 解析模板 ref 为单个 canvas（历史上重复 ref 会为数组，导致 getContext 失败） */
const resolveRefCanvas = (r) => {
  const v = r?.value
  if (!v) return null
  if (Array.isArray(v)) {
    const c = v.find((el) => el instanceof HTMLCanvasElement)
    return c || (v[0] instanceof HTMLCanvasElement ? v[0] : null)
  }
  return v instanceof HTMLCanvasElement ? v : null
}

const currentView = ref('overview')
const supplyFilter = ref('all')

// AI用研结论相关状态
const aiResearchList = ref([])
const loadingResearch = ref(false)
const expandedResearchId = ref(null)
const researchFilter = ref({ type: '' })
const researchSort = ref('newest')

// ------------------------------
// 合规专栏：事项清单（本地可编辑 + 持久化）
// ------------------------------
const COMPLIANCE_STORAGE_KEY = 'sc_strategy_compliance_items_v1'
const SPECIES_LIST_STORAGE_KEY = 'sc_strategy_compliance_species_lists_v1'
const SPECIES_LIST_VERSION = 1
const SPECIMEN_STORAGE_KEY = 'sc_strategy_compliance_specimens_v1'
const PROCUREMENT_STORAGE_KEY = 'sc_strategy_compliance_procurements_v1'

const riskText = {
  high: '高风险',
  medium: '中风险',
  low: '低风险'
}

const defaultComplianceItems = () => ([
  {
    id: 'c-001',
    title: '绝对禁区物种排除',
    desc: '选品/素材/命名均不得涉及虎、犀牛、象牙等绝对禁区；避免误导性命名。',
    risk: 'high',
    status: 'open',
    evidence: ['选品禁区清单（内部）', '商品命名规范与敏感词库'],
    owner: ''
  },
  {
    id: 'c-002',
    title: '“三有”与保护名录定期复核',
    desc: '对“三有”名录动态调整与保护名录变更保持追踪，评估SKU影响与审批流程变化。',
    risk: 'high',
    status: 'doing',
    evidence: ['名录版本记录（季度）', 'SKU 受影响清单与替代方案'],
    owner: ''
  },
  {
    id: 'c-003',
    title: '白名单/可经营利用物种策略',
    desc: '优先使用可商业经营利用“白名单”物种与政策相对宽松的无脊椎/植物，降低合规成本。',
    risk: 'medium',
    status: 'open',
    evidence: ['白名单物种列表（内部整理）', '供应商资质与出货单样例'],
    owner: ''
  },
  {
    id: 'c-004',
    title: '专用标识与《标本收藏证》闭环',
    desc: '涉及重点保护物种的标本，必须具备专用标识与收藏证，做到可追溯、可核验、可归档。',
    risk: 'high',
    status: 'open',
    evidence: ['专用标识照片/扫码记录', '收藏证扫描件', '入库/出库台账'],
    owner: ''
  },
  {
    id: 'c-005',
    title: '防“洗白”采购制度',
    desc: '对来源模糊、手续不完整、价格异常的货源一票否决；供应商分级管理与抽检机制。',
    risk: 'high',
    status: 'open',
    evidence: ['供应商尽调表', '抽检与复核记录', '拒绝采购记录'],
    owner: ''
  },
  {
    id: 'c-006',
    title: '上游来源证明与证据链标准化',
    desc: '昆虫/贝类/植物等“相对宽松物种”也需保留来源证明（养殖场出货单/采购合同/物流单）。',
    risk: 'medium',
    status: 'doing',
    evidence: ['出货单/采购合同模板', '物流/批次号与照片留存规则'],
    owner: ''
  },
  {
    id: 'c-007',
    title: '跨境/进口合规（如涉及）',
    desc: '涉 CITES/濒危物种、动植物检疫、海关申报等，必须在方案阶段完成合规审查。',
    risk: 'high',
    status: 'open',
    evidence: ['进口许可/检疫证明（如适用）', '报关单/申报要素归档'],
    owner: ''
  },
  {
    id: 'c-008',
    title: '内容与营销合规（平台与公众沟通）',
    desc: '商品详情页与宣发内容避免“野生捕猎/猎奇炫耀”叙事，强调自然教育、可持续与合规来源。',
    risk: 'low',
    status: 'open',
    evidence: ['详情页话术规范', '平台审核敏感点清单'],
    owner: ''
  }
])

const complianceItems = ref([])
const complianceFilter = ref({ risk: '', status: '' })

// ------------------------------
// 物种清单：绝对禁止 / 三有敏感 / 保护名录（本地可编辑 + 持久化）
// ------------------------------
const speciesTab = ref('banned') // banned | sanyou | protected
const speciesSearch = ref('')

const defaultSpeciesLists = () => ({
  version: SPECIES_LIST_VERSION,
  banned: [
    { id: 'b-001', name: '虎', alias: '虎皮/虎骨/虎牙等制品', basis: '红线：绝对禁止商业贸易', note: '' },
    { id: 'b-002', name: '犀牛', alias: '犀牛角/犀牛皮等制品', basis: '红线：绝对禁止商业贸易', note: '' },
    { id: 'b-003', name: '象牙', alias: '象牙制品（雕刻/饰品/摆件）', basis: '2017 起全面禁止商业性加工销售', note: '' }
  ],
  // 提示：PDF 强调“三有”名录动态调整，具体清单需按最新官方名录维护；此处提供占位结构与工作流
  sanyou: [
    { id: 's-001', name: '三有动物（占位）', alias: '按最新“三有名录”维护', basis: '名录动态调整（需季度复核）', note: '在此维护敏感物种与审批提示' }
  ],
  protected: [
    { id: 'p-001', name: '国家重点保护野生动物（占位）', alias: '按最新重点保护名录维护', basis: '涉及专用标识与收藏证制度', note: '建议按一级/二级/附录分类维护' }
  ]
})

const speciesLists = ref(defaultSpeciesLists())

const loadSpeciesLists = () => {
  try {
    const raw = localStorage.getItem(SPECIES_LIST_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.banned || !parsed.sanyou || !parsed.protected) return null
    return parsed
  } catch (_) {
    return null
  }
}

const saveSpeciesLists = () => {
  try {
    localStorage.setItem(SPECIES_LIST_STORAGE_KEY, JSON.stringify(speciesLists.value))
  } catch (_) {}
}

const resetSpeciesLists = () => {
  speciesLists.value = defaultSpeciesLists()
  saveSpeciesLists()
}

const initSpeciesLists = () => {
  const cached = typeof window !== 'undefined' ? loadSpeciesLists() : null
  speciesLists.value = cached || defaultSpeciesLists()
}
initSpeciesLists()

const activeSpeciesList = computed(() => {
  const key = speciesTab.value
  return speciesLists.value?.[key] || []
})

const filteredSpeciesList = computed(() => {
  const q = (speciesSearch.value || '').trim().toLowerCase()
  if (!q) return activeSpeciesList.value
  return activeSpeciesList.value.filter(r => {
    const hay = `${r.name || ''} ${r.alias || ''} ${r.basis || ''} ${r.note || ''}`.toLowerCase()
    return hay.includes(q)
  })
})

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const addSpeciesItem = () => {
  const key = speciesTab.value
  const list = speciesLists.value[key] || []
  list.unshift({ id: newId(key[0] || 'x'), name: '', alias: '', basis: '', note: '' })
  speciesLists.value[key] = list
}

const removeSpeciesItem = (id) => {
  const key = speciesTab.value
  speciesLists.value[key] = (speciesLists.value[key] || []).filter(r => r.id !== id)
  saveSpeciesLists()
}

const loadCompliance = () => {
  try {
    const raw = localStorage.getItem(COMPLIANCE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return null
  } catch (_) {
    return null
  }
}

const saveCompliance = () => {
  try {
    localStorage.setItem(COMPLIANCE_STORAGE_KEY, JSON.stringify(complianceItems.value))
  } catch (_) {}
}

// 保存时顺带保存物种清单（减少漏保存概率）
watch(complianceItems, () => {
  // 避免高频写入：轻量节流到 microtask
  Promise.resolve().then(() => saveCompliance())
}, { deep: true })

watch(speciesLists, () => {
  Promise.resolve().then(() => saveSpeciesLists())
}, { deep: true })

// ------------------------------
// 大型标本台账 + 采购记录（本地可编辑 + 持久化）
// ------------------------------
const specimenSearch = ref('')
const specimenRiskFilter = ref('')

const specimenForm = ref({
  id: '',
  name: '',
  species: '',
  category: 'large', // large | small | parts | other
  sourceType: 'breeding', // breeding | import | purchase | consignment | unknown
  protectedLevel: '', // 一级/二级/三有/非保护/未知（文本）
  hasSpecialTag: false, // 专用标识
  specialTagCode: '',
  hasCollectionCert: false, // 收藏证
  collectionCertNo: '',
  supplier: '',
  purchaseId: '', // 关联采购记录
  batchNo: '',
  entryDate: '',
  storageLocation: '',
  notes: ''
})

const procurementForm = ref({
  id: '',
  supplier: '',
  contact: '',
  date: '',
  items: '',
  amount: '',
  docs: {
    contract: false,
    invoice: false,
    deliveryNote: false,
    breedingProof: false,
    quarantine: false,
    customs: false,
    other: false
  },
  notes: ''
})

const loadJsonArray = (key) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

const saveJsonArray = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (_) {}
}

const specimens = ref(loadJsonArray(SPECIMEN_STORAGE_KEY))
const procurements = ref(loadJsonArray(PROCUREMENT_STORAGE_KEY))

watch(specimens, () => Promise.resolve().then(() => saveJsonArray(SPECIMEN_STORAGE_KEY, specimens.value)), { deep: true })
watch(procurements, () => Promise.resolve().then(() => saveJsonArray(PROCUREMENT_STORAGE_KEY, procurements.value)), { deep: true })

const specimenRisk = (s) => {
  const missing = []
  const highFlags = []

  const protectedText = (s.protectedLevel || '').toLowerCase()
  const sourceType = s.sourceType

  if (!s.species) missing.push('物种/学名/关键词')
  if (!s.supplier) missing.push('供应商')
  if (!s.entryDate) missing.push('入库日期')
  if (!s.storageLocation) missing.push('存放位置')

  // 保护/三有/未知：要求更强证据链
  const isSensitive = protectedText.includes('一级') || protectedText.includes('二级') || protectedText.includes('三有') || protectedText.includes('重点') || protectedText.includes('未知')
  if (isSensitive) {
    if (!s.hasSpecialTag) missing.push('专用标识')
    if (!s.hasCollectionCert) missing.push('收藏证')
  }

  if (protectedText.includes('一级') || protectedText.includes('重点')) {
    highFlags.push('疑似重点保护物种：必须专用标识 + 收藏证 + 完整来源证明')
  }
  if (sourceType === 'unknown') {
    highFlags.push('来源未知：高风险，建议暂停展示/销售并补齐证据链')
  }
  if (isSensitive && (!s.hasSpecialTag || !s.hasCollectionCert)) {
    highFlags.push('敏感物种证据链不完整：存在合规风险')
  }

  const risk = highFlags.length > 0 ? 'high' : (missing.length > 0 ? 'medium' : 'low')
  return { risk, missing, highFlags }
}

const filteredSpecimens = computed(() => {
  const q = (specimenSearch.value || '').trim().toLowerCase()
  let list = specimens.value || []
  if (q) {
    list = list.filter(s => `${s.name || ''} ${s.species || ''} ${s.supplier || ''} ${s.collectionCertNo || ''} ${s.specialTagCode || ''}`.toLowerCase().includes(q))
  }
  if (specimenRiskFilter.value) {
    list = list.filter(s => specimenRisk(s).risk === specimenRiskFilter.value)
  }
  return list
})

const upsertProcurement = (p) => {
  if (!p.id) p.id = newId('pr')
  const idx = procurements.value.findIndex(x => x.id === p.id)
  if (idx >= 0) procurements.value[idx] = { ...p }
  else procurements.value.unshift({ ...p })
}

const upsertSpecimen = (s) => {
  if (!s.id) s.id = newId('sp')
  const idx = specimens.value.findIndex(x => x.id === s.id)
  if (idx >= 0) specimens.value[idx] = { ...s }
  else specimens.value.unshift({ ...s })
}

const removeSpecimen = (id) => {
  specimens.value = specimens.value.filter(s => s.id !== id)
}

const removeProcurement = (id) => {
  procurements.value = procurements.value.filter(p => p.id !== id)
}

const resetCompliance = () => {
  complianceItems.value = defaultComplianceItems()
  saveCompliance()
}

// 初始化（优先读本地缓存）
const initCompliance = () => {
  const cached = typeof window !== 'undefined' ? loadCompliance() : null
  complianceItems.value = cached || defaultComplianceItems()
}
initCompliance()

const filteredComplianceItems = computed(() => {
  let list = complianceItems.value || []
  if (complianceFilter.value.risk) {
    list = list.filter(i => i.risk === complianceFilter.value.risk)
  }
  if (complianceFilter.value.status) {
    list = list.filter(i => i.status === complianceFilter.value.status)
  }
  return list
})

const complianceStats = computed(() => {
  const total = complianceItems.value.length || 0
  const done = complianceItems.value.filter(i => i.status === 'done').length
  const highOpen = complianceItems.value.filter(i => i.risk === 'high' && i.status !== 'done').length
  const coverage = total === 0 ? 0 : (done / total) * 100
  return { total, done, highOpen, coverage }
})

const tabs = [
  { value: 'overview', label: '行业总览', icon: '📊' },
  { value: 'supply', label: '产业链地图', icon: '🗺️' },
  { value: 'products', label: '产品金字塔', icon: '💎' },
  { value: 'productGenerator', label: '爆品生成器', icon: '🎨' },
  { value: 'channels', label: '流量漏斗', icon: '🚀' },
  { value: 'competitors', label: '对标研究', icon: '🧭' },
  { value: 'profit', label: '盈利模拟', icon: '💰' },
  { value: 'store', label: '门店设计', icon: '🏪' },
  { value: 'planning', label: '3年规划', icon: '📅' },
  { value: 'compliance', label: '合规专栏', icon: '🛡️' },
  { value: 'aiResearch', label: 'AI用研结论', icon: '🔬' }
]

const trendChartCanvas = ref(null)
const supplyChartCanvas = ref(null)
const productRadarCanvas = ref(null)
const channelChartCanvas = ref(null)
const industryGrowthChartCanvas = ref(null)
const competitorRadarCanvas = ref(null)
const profit3DChartCanvas = ref(null)
const funnelChartCanvas = ref(null)
const heatmapCanvas = ref(null)
const planningChartCanvas = ref(null)
const planningCapexCanvas = ref(null)

let trendChart = null
let supplyChart = null
let productRadar = null
let channelChart = null
let industryGrowthChart = null
let competitorRadarChart = null
let profit3DChart = null
let funnelChart = null
let heatmapChart = null
let planningChart = null
let planningCapexChart = null

const supplyTypes = [
  { value: 'all', label: '🌍 全品类概览' },
  { value: 'insect', label: '🦋 昆虫/蝴蝶 (云南/广西)' },
  { value: 'marine', label: '🦀 海洋/水生 (山东/福建)' },
  { value: 'craft', label: '💎 加工/树脂 (浙江/广东)' }
]

const reportData = {
  supplyChain: {
    insect: {
      labels: ['云南', '广西', '四川', '海南', '广东'],
      data: [95, 75, 50, 40, 30],
      insight: "云南是绝对的核心，拥有全国最丰富的蝶类与甲虫资源（大理/西双版纳）。广西以奇特昆虫（竹节虫等）为主。四川主要为高山蝶类。建议：必须在云南建立稳固的收购点。"
    },
    marine: {
      labels: ['山东', '福建', '广西', '海南', '辽宁'],
      data: [85, 80, 70, 65, 50],
      insight: "山东（青岛/烟台）与福建（厦门/漳州）是贝壳工艺与海洋标本加工中心。海南主要提供热带珊瑚/贝壳原料（需注意合规性）。广西（北海）有大量珍珠与虾蟹标本资源。"
    },
    craft: {
      labels: ['浙江(义乌)', '广东(深圳)', '福建', '江苏', '山东'],
      data: [98, 90, 60, 50, 45],
      insight: "义乌拥有最成熟的树脂包埋与小商品组装产业链，成本极低。深圳则在高端设计与出口加工方面领先。若要做低价走量产品，义乌是首选代工点。"
    },
    all: {
      labels: ['云南', '浙江', '广东', '山东', '广西'],
      data: [90, 88, 85, 80, 78],
      insight: "全产业链来看，云南掌握生物原料源头，浙江/广东掌握加工制造工艺。理想模式是：云南采购原料 -> 运至广东/浙江精加工 -> 分发全国销售。"
    }
  }
}

const currentInsight = ref(reportData.supplyChain.all.insight)

// 市场关注度趋势相关状态
const selectedTimeRange = ref('all')
const timeRanges = [
  { value: 'all', label: '全部' },
  { value: '3y', label: '近3年' },
  { value: '5y', label: '近5年' }
]

// 趋势数据
const trendData = {
  labels: ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026(E)'],
  // 说明：为内部研判/展示用的指数化序列（非权威口径）
  searchIndex: [120, 150, 210, 350, 480, 610, 690, 760],
  industryAvg: [100, 112, 132, 168, 205, 238, 268, 295],
  /** 与 labels 等长：预测上沿（虚线），前段 null 表示不做外推展示 */
  forecastUpper: [null, null, null, null, null, null, 735, 805]
}

/** 行业总览 · 细分结构（与产品页叙事对齐，可后续接 API） */
const overviewMarketSegments = [
  { icon: '🦋', name: '昆虫/蝴蝶标本', percent: 42, growth: '+22%', aov: '¥680', fillClass: 'segment-fill--primary' },
  { icon: '🌿', name: '植物标本', percent: 28, growth: '+18%', aov: '¥520', fillClass: 'segment-fill--sage' },
  { icon: '🦀', name: '海洋生物标本', percent: 18, growth: '+15%', aov: '¥890', fillClass: 'segment-fill--info' },
  { icon: '💎', name: '树脂工艺品', percent: 12, growth: '+35%', aov: '¥280', fillClass: 'segment-fill--gold' }
]

// 计算关键指标
const currentIndex = computed(() => trendData.searchIndex[trendData.searchIndex.length - 1])
const growthRate = computed(() => {
  const first = trendData.searchIndex[0]
  const last = trendData.searchIndex[trendData.searchIndex.length - 1]
  return ((last - first) / first * 100).toFixed(1)
})
const avgGrowthRate = computed(() => {
  const rates = []
  for (let i = 1; i < trendData.searchIndex.length; i++) {
    const rate = ((trendData.searchIndex[i] - trendData.searchIndex[i-1]) / trendData.searchIndex[i-1] * 100)
    rates.push(rate)
  }
  return (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)
})
const peakValue = computed(() => Math.max(...trendData.searchIndex))
const peakYear = computed(() => {
  const index = trendData.searchIndex.indexOf(peakValue.value)
  return trendData.labels[index]
})
const minValue = computed(() => Math.min(...trendData.searchIndex))
const minYear = computed(() => {
  const index = trendData.searchIndex.indexOf(minValue.value)
  return trendData.labels[index]
})
const lastUpdateTime = computed(() => {
  const now = new Date()
  return now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
})

// 调研状态：有 AI 用研结论时显示已同步条数
const researchStatusText = computed(() => {
  const n = aiResearchList.value.length
  return n > 0 ? `已同步 (${n} 条用研)` : '进行中'
})

const latestAIResearch = computed(() => aiResearchList.value[0] || null)

const strategicCommandCards = computed(() => [
  { label: '市场势能', value: `${growthRate.value}%`, desc: `当前指数 ${currentIndex.value}，峰值 ${peakYear.value}`, tone: 'green' },
  { label: '盈利弹性', value: `${calculatedMargin.value.toFixed(1)}%`, desc: `模拟月净利 ¥${calculatedProfit.value.toLocaleString()}`, tone: 'gold' },
  { label: '合规闭环', value: `${complianceStats.value.coverage.toFixed(0)}%`, desc: `高风险未关闭 ${complianceStats.value.highOpen} 项`, tone: complianceStats.value.highOpen > 0 ? 'red' : 'green' },
  { label: 'AI 用研', value: `${aiResearchList.value.length} 条`, desc: latestAIResearch.value ? '已有同步结论可复盘' : '建议生成首轮战略用研', tone: 'blue' },
])

const riskOpportunityCards = computed(() => [
  {
    badge: '机会',
    title: '自然美学与礼赠场景共振',
    desc: '装饰画、树脂与体验课能同时承接家居审美、亲子教育和礼赠需求。',
    tone: 'opportunity',
  },
  {
    badge: '风险',
    title: '合规证据链决定扩张上限',
    desc: complianceStats.value.highOpen > 0
      ? `仍有 ${complianceStats.value.highOpen} 项高风险事项未关闭，需先完成物种与来源核验。`
      : '高风险事项已关闭，建议保持季度复核与供应商证据链抽检。',
    tone: 'risk',
  },
  {
    badge: '动作',
    title: '用 AI 把调研变成经营议题',
    desc: latestAIResearch.value ? '可基于最新用研进入战略智脑做多角色辩论。' : '先生成目标客群与竞品调研，再回流看板沉淀。',
    tone: 'action',
  },
])

const nextStrategicActions = computed(() => [
  '用战略用研AI补齐目标客群、竞品价格带与渠道验证。',
  complianceStats.value.highOpen > 0 ? '优先关闭高风险合规事项，再推进供应链扩张。' : '将合规清单纳入季度复核与新品立项门槛。',
  '在战略智脑中发起“线上渠道扩张 vs 门店体验投入”董事会辩论。',
])

const getResearchSummary = (content = '') => {
  const text = String(content || '').replace(/[#>*_`-]/g, '').replace(/\s+/g, ' ').trim()
  return text ? `${text.slice(0, 120)}${text.length > 120 ? '...' : ''}` : '暂无摘要'
}

// 刷新看板：重新初始化图表并可选拉取用研
const refreshBoard = () => {
  nextTick(() => {
    initCharts()
    if (currentView.value === 'aiResearch') loadAIResearch()
  })
}

// 导出看板一页纸摘要
const exportBoardSummary = () => {
  const now = new Date().toLocaleString('zh-CN')
  const lines = [
    '# 山海造物标本艺术馆 · 战略调研看板摘要',
    `生成时间：${now}`,
    '',
    '## 行业总览',
    `- 预估文创标本市场规模：¥95亿+，CAGR 16.8%（2025-2028）`,
    `- 核心人群：25-40岁新中产/审美Z世代，占比约65%`,
    `- 热门赛道：装饰画与树脂，家居装饰类近两年增速更稳`,
    `- 市场关注度当前指数：${currentIndex.value}，总增长率 ${growthRate.value}%`,
    '',
    '## 产业链与供应链',
    `- 全品类核心产区：${(reportData.supplyChain.all.labels || []).join('、')}`,
    `- 洞察：${currentInsight.value || reportData.supplyChain.all.insight}`,
    '',
    '## 产品策略',
    '- 引流款：树脂饰品/果壳铃；利润款：昆虫/蝴蝶装饰画；形象款：大型生态缸/稀有收藏级',
    '',
    '## 渠道与盈利',
    '- 渠道优先级：B端教育/研学 > 生活方式集合店 > 抖音/小红书',
    `- 盈利模拟（当前参数）：月营收 ¥${calculatedRevenue.value.toLocaleString()}，月净利润 ¥${calculatedProfit.value.toLocaleString()}，净利润率 ${calculatedMargin.value.toFixed(1)}%`,
    '',
    '## AI 用研结论',
    aiResearchList.value.length > 0
      ? `已同步 ${aiResearchList.value.length} 条用研结论，详见看板「AI用研结论」页。`
      : '暂无同步结论，可前往 AI 智能中心 → 战略用研 生成并同步。',
    '',
    '---',
    `看板最后更新：${lastUpdateTime.value}`
  ]
  const content = lines.join('\n')
  downloadFile(content, `战略调研看板摘要_${new Date().toISOString().slice(0, 10)}.md`)
}

// 前往 AI 智能中心（战略用研/战略智脑入口）
const goToAIStrategyResearch = (featureId = 'strategy-research') => {
  try {
    localStorage.setItem('ai_center_pending_feature', featureId)
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('switch-tab', { detail: '12' }))
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('open-ai-feature', { detail: { featureId } }))
  }, 350)
}

// 下载文件辅助函数
const downloadFile = (content, filename) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

// 导出趋势数据
const exportTrendData = () => {
  const content = `市场关注度趋势数据 (2019-2026)

年份,搜索指数,行业平均,增长率
${trendData.labels.map((label, i) => 
  `${label},${trendData.searchIndex[i]},${trendData.industryAvg[i]},${i > 0 ? ((trendData.searchIndex[i] - trendData.searchIndex[i-1]) / trendData.searchIndex[i-1] * 100).toFixed(1) + '%' : '-'}`
).join('\n')}

关键指标:
- 当前指数: ${currentIndex.value}
- 总增长率: ${growthRate.value}%
- 年均增长率: ${avgGrowthRate.value}%
- 峰值: ${peakYear.value}年 (${peakValue.value})
- 最低: ${minYear.value}年 (${minValue.value})

导出时间: ${new Date().toLocaleString('zh-CN')}
`
  downloadFile(content, '市场关注度趋势数据.csv')
}

// 全屏切换
const containerRef = ref(null)
const isFullscreen = ref(false)
const syncFullscreenState = () => {
  isFullscreen.value = document.fullscreenElement === containerRef.value
}
const toggleFullscreen = async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await containerRef.value?.requestFullscreen?.()
    }
  } catch (error) {
    console.error('全屏切换失败', error)
    ElMessage.warning('当前浏览器或窗口状态不支持全屏切换')
  }
}

// 爆品生成器相关状态
const selectedProductType = ref('profit') // 'profit' | 'traffic' | 'premium'
const generatorOptions = ref({
  category: 'insect',
  innovation: 'design'
})
const isGenerating = ref(false)
const generatedConcept = ref(null)
const conceptHistory = ref([])

// 产品类型选项
const productTypes = [
  {
    value: 'profit',
    name: '利润款',
    icon: '💎',
    desc: '中高客单价，核心营收'
  },
  {
    value: 'traffic',
    name: '引流款',
    icon: '🛍️',
    desc: '低单价，高复购'
  },
  {
    value: 'premium',
    name: '形象款',
    icon: '👑',
    desc: '极高单价，品牌调性'
  }
]

// 使用统一的AI辅助工具（已从 aiHelper.js 导入）

// 显示错误提示的统一函数
const showError = (message) => {
  alert(`❌ ${message}\n\n请稍后重试，或检查网络连接。`)
}

// 生成产品概念
const generateProductConcept = async () => {
  // 防止重复点击
  if (isGenerating.value) {
    console.warn('[生成产品概念] 正在生成中，忽略重复请求')
    return
  }
  
  // 清空上一次的结果，确保生成新方案
  generatedConcept.value = null
  
  isGenerating.value = true
  
  try {
    const productType = productTypes.find(t => t.value === selectedProductType.value)
    if (!productType) {
      throw new Error('请先选择产品定位')
    }
    
    const pyramidData = productPyramid.find(p => p.type === selectedProductType.value)
    if (!pyramidData) {
      throw new Error('未找到对应的产品金字塔数据')
    }
    
    // 添加随机性和时间戳，确保每次生成不同的内容
    const timestamp = Date.now()
    const randomSeed = Math.floor(Math.random() * 10000)
    
    const prompt = `你是山海造物标本艺术馆的产品设计师。请基于以下信息，生成一个全新的、独特的爆品SKU方案（这是第${randomSeed}次生成，请确保每次生成的内容都不同）：

产品定位：${productType.name}（${productType.desc}）
价格区间：¥${pyramidData.priceRange}
目标毛利率：${pyramidData.margin}%
产品类别：${generatorOptions.value.category === 'insect' ? '昆虫/蝴蝶' : generatorOptions.value.category === 'plant' ? '植物' : generatorOptions.value.category === 'marine' ? '海洋生物' : generatorOptions.value.category === 'resin' ? '树脂工艺品' : '混合类型'}
创新方向：${generatorOptions.value.innovation === 'material' ? '材质创新' : generatorOptions.value.innovation === 'design' ? '设计创新' : generatorOptions.value.innovation === 'function' ? '功能创新' : '体验创新'}

重要要求：
1. 必须生成一个全新的、与之前不同的产品方案
2. 产品名称要独特、有创意、有记忆点
3. 所有内容都要原创，不要重复之前生成过的方案

请生成一个完整的产品方案，包含：
1. 产品名称（创意、有记忆点，必须独特）
2. 材质与工艺（详细说明）
3. 核心卖点（3-5个，每个一句话）
4. 目标人群（具体描述）
5. 市场策略（如何推广和销售）
6. 建议定价（具体数字，在${pyramidData.priceRange}范围内）
7. 预期毛利率（百分比，目标${pyramidData.margin}%）

请以JSON格式返回，格式如下：
{
  "name": "产品名称",
  "position": "${productType.name}",
  "price": "具体价格数字",
  "margin": "毛利率百分比",
  "materials": "材质与工艺的详细描述",
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "targetAudience": "目标人群描述",
  "strategy": "市场策略描述"
}`

    console.log('[生成产品概念] 开始生成，时间戳:', timestamp, '随机种子:', randomSeed)
    
    const text = await callGeminiAPI(prompt, {
      temperature: 0.95, // 提高温度以增加随机性和多样性
      maxOutputTokens: 4096,
      usePro: false,
      useCache: false // 禁用缓存，确保每次都是新生成
    })
    
    // 记录响应内容用于调试
    console.log('[生成产品概念] AI响应长度:', text.length)
    console.log('[生成产品概念] AI响应预览:', text.substring(0, 300))
    
    let concept
    try {
      concept = extractJSON(text)
      
      // 验证概念数据的完整性
      if (!concept.name || !concept.position || !concept.price) {
        throw new Error('AI返回的数据不完整，缺少必要字段')
      }
      
      // 添加生成时间戳，用于区分不同的生成结果
      concept.generatedAt = timestamp
      concept.randomSeed = randomSeed
      
    } catch (jsonError) {
      console.error('[生成产品概念] JSON解析失败:', jsonError)
      console.error('[生成产品概念] 原始响应:', text)
      throw new Error(`JSON解析失败: ${jsonError.message}。响应可能被截断，请重试。`)
    }
    
    // 检查是否与历史记录重复
    const isDuplicate = conceptHistory.value.some(h => 
      h.name === concept.name && 
      h.position === concept.position &&
      Math.abs(parseFloat(h.price) - parseFloat(concept.price)) < 1
    )
    
    if (isDuplicate) {
      console.warn('[生成产品概念] 检测到重复方案，将重新生成')
      // 如果重复，等待一小段时间后重新生成
      await new Promise(resolve => setTimeout(resolve, 500))
      // 递归调用，但只允许一次重试
      if (!concept.retryCount) {
        concept.retryCount = 1
        return generateProductConcept()
      }
    }
    
    // 设置新生成的概念
    generatedConcept.value = concept
    
    // 添加到历史记录（只在成功生成后添加，避免重复归档）
    const historyItem = { 
      ...concept, 
      timestamp: timestamp,
      id: `concept_${timestamp}_${randomSeed}` // 添加唯一ID
    }
    
    // 检查历史记录中是否已存在相同的ID
    const existingIndex = conceptHistory.value.findIndex(h => h.id === historyItem.id)
    if (existingIndex === -1) {
      conceptHistory.value.unshift(historyItem)
      // 限制历史记录数量
      if (conceptHistory.value.length > 10) {
        conceptHistory.value = conceptHistory.value.slice(0, 10)
      }
      console.log('[生成产品概念] 已添加到历史记录，当前历史记录数:', conceptHistory.value.length)
    } else {
      console.warn('[生成产品概念] 历史记录中已存在相同ID，跳过添加')
    }
    
  } catch (error) {
    console.error('生成产品概念失败:', error)
    showError(`生成产品概念失败：${error.message}`)
    // 确保失败时也清空状态
    generatedConcept.value = null
  } finally {
    isGenerating.value = false
  }
}

// 重新生成
const regenerateConcept = () => {
  // 清空当前概念
  generatedConcept.value = null
  // 等待一小段时间确保UI更新
  setTimeout(() => {
    generateProductConcept()
  }, 100)
}

// 加载历史概念
const loadConcept = (concept) => {
  if (!concept) return
  // 深拷贝，避免引用问题
  generatedConcept.value = { ...concept }
  console.log('[加载历史概念] 已加载:', concept.name)
}

// 展陈空间设计师相关状态
const selectedZone = ref('入口区')
const optimizationGoals = ref({
  flow: true,
  conversion: true,
  experience: false,
  display: false
})
const isGeneratingSpatial = ref(false)
const spatialDesign = ref(null)

// 生成展陈空间设计方案
const generateSpatialDesign = async () => {
  if (isGeneratingSpatial.value) return
  
  isGeneratingSpatial.value = true
  
  try {
    const zone = storeZones.find(z => z.name === selectedZone.value)
    const goals = Object.entries(optimizationGoals.value)
      .filter(([_, checked]) => checked)
      .map(([key]) => {
        const goalMap = {
          flow: '优化动线',
          conversion: '提升转化率',
          experience: '增强体验',
          display: '优化展陈'
        }
        return goalMap[key]
      })
      .join('、')
    
    // 计算动线数据（模拟）
    const flowData = {
      '入口区': { traffic: 100, conversion: 15, description: '入口流量100%但文创区转化仅15%' },
      '展陈区': { traffic: 85, conversion: 35, description: '展陈区流量85%，转化率35%' },
      '体验区': { traffic: 60, conversion: 50, description: '体验区流量60%，转化率50%' },
      '收银区': { traffic: 45, conversion: 80, description: '收银区流量45%，转化率80%' }
    }
    
    const zoneData = flowData[selectedZone.value] || flowData['入口区']
    
    const prompt = `你是山海造物标本艺术馆的展陈空间设计师。请基于以下门店动线数据，生成具体的陈列改造方案：

优化区域：${selectedZone.value}
区域描述：${zone.description}
动线数据：${zoneData.description}
优化目标：${goals}

请生成一个完整的陈列改造方案，包含：
1. 问题分析（分析当前区域存在的问题）
2. 改造方案（3-5个具体的改造建议，要非常具体，如"建议在入口处设置'会动的机械蝶'装置，拦截视线"）
3. 预期效果（改造后预期的转化率提升、体验改善等）
4. 实施步骤（具体的实施步骤，3-5步）

请以JSON格式返回，格式如下：
{
  "zone": "${selectedZone.value}",
  "analysis": "问题分析文本",
  "solutions": ["方案1", "方案2", "方案3"],
  "expectedEffect": "预期效果描述",
  "steps": ["步骤1", "步骤2", "步骤3"]
}`

    const text = await callGeminiAPI(prompt, {
      temperature: 0.8,
      maxOutputTokens: 4096, // 增加token限制，避免JSON被截断
      usePro: false
    })
    
    console.log('[门店设计] AI响应长度:', text.length)
    
    let design
    try {
      design = extractJSON(text)
    } catch (jsonError) {
      console.error('[门店设计] JSON解析失败:', jsonError)
      console.error('[门店设计] 原始响应:', text)
      throw new Error(`JSON解析失败: ${jsonError.message}。响应可能被截断，请重试。`)
    }
    spatialDesign.value = design
    
  } catch (error) {
    console.error('生成展陈设计方案失败:', error)
    showError(`生成展陈设计方案失败：${error.message}`)
  } finally {
    isGeneratingSpatial.value = false
  }
}

// 重新生成展陈设计方案
const regenerateSpatialDesign = () => {
  spatialDesign.value = null
  generateSpatialDesign()
}

// 金牌销售话术相关状态
const selectedChannel = ref('')
const selectedStage = ref('')
const scriptType = ref('complete')
const isGeneratingScript = ref(false)
const salesScript = ref(null)

// 获取渠道的漏斗阶段
const getChannelStages = () => {
  const channel = trafficChannels.find(c => c.name === selectedChannel.value)
  return channel ? channel.funnel : []
}

// 获取阶段转化率
const getStageConversionRate = (stageIndex) => {
  const channel = trafficChannels.find(c => c.name === selectedChannel.value)
  if (!channel || stageIndex === 0) return 100
  const current = channel.funnel[stageIndex].value
  const previous = channel.funnel[stageIndex - 1].value
  return ((current / previous) * 100).toFixed(1)
}

// 生成销售话术
const generateSalesScript = async () => {
  if (isGeneratingScript.value || !selectedChannel.value || selectedStage.value === '') return
  
  isGeneratingScript.value = true
  
  try {
    const channel = trafficChannels.find(c => c.name === selectedChannel.value)
    const stageIndex = parseInt(selectedStage.value)
    const stage = channel.funnel[stageIndex]
    const prevStage = stageIndex > 0 ? channel.funnel[stageIndex - 1] : null
    
    const conversionRate = prevStage 
      ? ((stage.value / prevStage.value) * 100).toFixed(1)
      : 100
    
    const scriptTypeMap = {
      opening: '开场话术',
      objection: '异议处理',
      closing: '成交话术',
      complete: '完整SOP'
    }
    
    const prompt = `你是山海造物标本艺术馆的销售培训专家。请针对以下转化环节，生成专业的店员话术SOP：

渠道：${selectedChannel.value}
优化环节：${stage.name}
转化率：${conversionRate}%（${prevStage ? `从${prevStage.name}的${prevStage.value.toLocaleString()}人转化到${stage.value.toLocaleString()}人` : '初始环节'}）
话术类型：${scriptTypeMap[scriptType.value]}

请生成一个完整的销售话术方案，包含：
1. 环节分析（分析这个环节转化率低的原因）
2. 标准话术（3-5个具体场景的话术，要非常具体，如"当顾客盯着标本画超过10秒时，店员应该说：'您看这款蝴蝶标本画，每一只都是手工精心制作的，背后还有它的自然故事...'"）
3. 执行要点（3-5个关键执行要点）
4. 预期效果（使用这些话术后预期的转化率提升）

请以JSON格式返回，格式如下：
{
  "channel": "${selectedChannel.value}",
  "stage": "${stage.name}",
  "analysis": "环节分析文本",
  "dialogues": [
    {
      "scenario": "场景描述",
      "script": "具体话术",
      "tips": "话术要点"
    }
  ],
  "points": ["要点1", "要点2", "要点3"],
  "expectedEffect": "预期效果描述"
}`

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 2048
        }
      })
    })

    if (!response.ok) {
      throw new Error(`API错误: ${response.status}`)
    }

    const data = await response.json()
    const text = data.candidates[0].content.parts[0].text
    
    // 提取JSON
    let jsonText = text.trim()
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim()
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim()
    }
    
    const script = JSON.parse(jsonText)
    salesScript.value = script
    
  } catch (error) {
    console.error('生成销售话术失败:', error)
    showError(`生成销售话术失败：${error.message}`)
  } finally {
    isGeneratingScript.value = false
  }
}

// 重新生成销售话术
const regenerateSalesScript = () => {
  salesScript.value = null
  generateSalesScript()
}

// 导出功能
const exportConcept = () => {
  if (!generatedConcept.value) return
  
  const content = `# ${generatedConcept.value.name} - 产品方案

## 产品信息
- **产品名称**: ${generatedConcept.value.name}
- **产品定位**: ${generatedConcept.value.position}
- **建议定价**: ¥${generatedConcept.value.price}
- **目标毛利率**: ${generatedConcept.value.margin}%

## 材质与工艺
${generatedConcept.value.materials}

## 核心卖点
${generatedConcept.value.sellingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 目标人群
${generatedConcept.value.targetAudience}

## 市场策略
${generatedConcept.value.strategy}

---
生成时间: ${new Date().toLocaleString('zh-CN')}
`

  downloadFile(content, `${generatedConcept.value.name}_产品方案.txt`)
}

const exportSpatialDesign = () => {
  if (!spatialDesign.value) return
  
  const content = `# ${spatialDesign.value.zone} - 陈列改造方案

## 问题分析
${spatialDesign.value.analysis}

## 改造方案
${spatialDesign.value.solutions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 预期效果
${spatialDesign.value.expectedEffect}

## 实施步骤
${spatialDesign.value.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

---
生成时间: ${new Date().toLocaleString('zh-CN')}
`

  downloadFile(content, `${spatialDesign.value.zone}_陈列改造方案.txt`)
}

const exportSalesScript = () => {
  if (!salesScript.value) return
  
  const content = `# ${salesScript.value.channel} - ${salesScript.value.stage} 销售话术

## 环节分析
${salesScript.value.analysis}

## 标准话术
${salesScript.value.dialogues.map((d, i) => `
### 场景 ${i + 1}: ${d.scenario}

**话术**: ${d.script}

${d.tips ? `**要点**: ${d.tips}` : ''}
`).join('\n')}

## 执行要点
${salesScript.value.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 预期效果
${salesScript.value.expectedEffect}

---
生成时间: ${new Date().toLocaleString('zh-CN')}
`

  downloadFile(content, `${salesScript.value.channel}_${salesScript.value.stage}_销售话术.txt`)
}

// 产业链价值分布数据
const valueChainStages = [
  { name: '上游-原材料采集', icon: '🌿', valueShare: 15, profitMargin: 25, color: '#a88d42' },
  { name: '中游-加工制造', icon: '🏭', valueShare: 35, profitMargin: 20, color: VI.brandGreen },
  { name: '下游-品牌零售', icon: '🏪', valueShare: 50, profitMargin: 45, color: VI.gold400 }
]

// 对标研究（宪章三轴三群）
const benchmarkStats = getBenchmarkStats()
const benchmarkGroupFilter = ref('all')
const benchmarkSearch = ref('')
const selectedBenchmarkId = ref(null)

const filteredBenchmarkBrands = computed(() => {
  const q = benchmarkSearch.value.trim().toLowerCase()
  return BENCHMARK_BRANDS.filter((b) => {
    if (benchmarkGroupFilter.value !== 'all' && b.group !== benchmarkGroupFilter.value) return false
    if (!q) return true
    const hay = [b.name, b.nameEn, b.role, b.oneLiner, b.learn, b.risk, ...(b.docs || [])]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const filteredBenchmarkGroups = computed(() => {
  if (benchmarkGroupFilter.value === 'all') return BENCHMARK_GROUPS
  return BENCHMARK_GROUPS.filter((g) => g.id === benchmarkGroupFilter.value)
})

const brandsInGroup = (groupId) => filteredBenchmarkBrands.value.filter((b) => b.group === groupId)

const selectedBenchmarkBrand = computed(() =>
  BENCHMARK_BRANDS.find((b) => b.id === selectedBenchmarkId.value) || null
)

// CloudBase 对标文档库
const cloudDocs = ref([])
const cloudDocsLoading = ref(false)
const cloudUploading = ref(false)
const cloudDocsError = ref('')
const cloudSearchQuery = ref('')
const cloudSearchResults = ref([])

const cloudDocStats = computed(() => {
  const total = cloudDocs.value.length
  const ready = cloudDocs.value.filter((d) => d.textStatus === 'ready' && d.searchableText).length
  const pending = cloudDocs.value.filter((d) => d.textStatus === 'pending_pdf').length
  return { total, ready, pending }
})

const selectedBrandCloudDocs = computed(() =>
  docsForBrand(cloudDocs.value, selectedBenchmarkBrand.value?.id)
)

const refreshCloudBenchmarkDocs = async () => {
  cloudDocsLoading.value = true
  cloudDocsError.value = ''
  try {
    cloudDocs.value = await loadBenchmarkDocs({ limit: 400 })
    if (cloudSearchQuery.value.trim()) runCloudBenchmarkSearch()
  } catch (err) {
    cloudDocsError.value = `云库同步失败：${err?.message || err}。请确认已创建集合 benchmark_research_docs 并粘贴权限规则。`
    cloudDocs.value = []
  } finally {
    cloudDocsLoading.value = false
  }
}

const runCloudBenchmarkSearch = () => {
  cloudSearchResults.value = searchBenchmarkDocs(cloudDocs.value, cloudSearchQuery.value)
}

const openCloudDocHit = (hit) => {
  if (!hit) return
  if (hit.brandId) selectedBenchmarkId.value = hit.brandId
  cloudSearchQuery.value = cloudSearchQuery.value || hit.title || ''
  if (!cloudSearchResults.value.some((x) => (x._id || x.docKey) === (hit._id || hit.docKey))) {
    cloudSearchResults.value = [{
      ...hit,
      _snippet: hit._snippet || hit.excerpt || '',
    }]
  }
  ElMessage.info(`已定位：${hit.title}`)
}

const onBenchmarkFileUpload = async (evt) => {
  const file = evt?.target?.files?.[0]
  if (evt?.target) evt.target.value = ''
  if (!file) return
  cloudUploading.value = true
  cloudDocsError.value = ''
  try {
    const payload = await ingestUploadFile(file, { uploadOriginal: true })
    ElMessage.success(`已入库：${payload.title}（${payload.charCount || 0} 字）`)
    await refreshCloudBenchmarkDocs()
    if (payload.brandId) selectedBenchmarkId.value = payload.brandId
    cloudSearchQuery.value = payload.title
    runCloudBenchmarkSearch()
  } catch (err) {
    console.error(err)
    ElMessage.error(`入库失败：${err?.message || err}`)
    cloudDocsError.value = err?.message || String(err)
  } finally {
    cloudUploading.value = false
  }
}

// 国内近场竞品数据
const competitors = [
  {
    name: '自然造物',
    category: 'traditional',
    categoryText: '传统工艺品',
    marketShare: 12,
    avgPrice: 680,
    skuCount: 150,
    strengths: '品牌历史悠久，供应链稳定',
    weaknesses: '设计创新不足，年轻化不够'
  },
  {
    name: '拾野自然',
    category: 'emerging',
    categoryText: '新兴文创',
    marketShare: 8,
    avgPrice: 420,
    skuCount: 80,
    strengths: '线上运营能力强，内容营销出色',
    weaknesses: '线下体验缺失，客单价偏低'
  },
  {
    name: '标本世界',
    category: 'specialized',
    categoryText: '专业标本',
    marketShare: 15,
    avgPrice: 1200,
    skuCount: 200,
    strengths: '专业性高，产品质量稳定',
    weaknesses: '价格偏高，受众面窄'
  }
]

const PROFIT_PARAM_DEFAULTS = {
  orderCount: 150,
  avgPrice: 680,
  margin: 55,
  fixedCost: 80000
}

const profitScenarios = {
  conservative: { orderCount: 90, avgPrice: 520, margin: 48, fixedCost: 95000 },
  baseline: { ...PROFIT_PARAM_DEFAULTS },
  aggressive: { orderCount: 280, avgPrice: 780, margin: 52, fixedCost: 118000 }
}

const profitScenarioKey = ref('baseline')
const profitScenarioList = [
  { key: 'conservative', name: '保守', hint: '订单收缩、成本刚性' },
  { key: 'baseline', name: '基准', hint: '与默认参数一致' },
  { key: 'aggressive', name: '扩张', hint: '冲高订单与客单' }
]

const profitParamFields = [
  {
    key: 'orderCount',
    label: '月均订单数',
    min: 20,
    max: 600,
    step: 10,
    format: (v) => `${v} 单`
  },
  {
    key: 'avgPrice',
    label: '平均客单价',
    min: 150,
    max: 3200,
    step: 50,
    format: (v) => `¥${Number(v).toLocaleString()}`
  },
  {
    key: 'margin',
    label: '毛利率（卖价口径）',
    min: 28,
    max: 78,
    step: 1,
    format: (v) => `${v}%`
  },
  {
    key: 'fixedCost',
    label: '月固定成本',
    min: 25000,
    max: 220000,
    step: 5000,
    format: (v) => `¥${Number(v).toLocaleString()}`
  }
]

// 盈利模拟参数
const profitParams = ref({ ...PROFIT_PARAM_DEFAULTS })

const onProfitParamAdjust = () => {
  profitScenarioKey.value = 'custom'
}

const applyProfitScenario = (key) => {
  const preset = profitScenarios[key]
  if (!preset) return
  profitScenarioKey.value = key
  profitParams.value = { ...preset }
}

const resetProfitParams = () => {
  profitScenarioKey.value = 'baseline'
  profitParams.value = { ...PROFIT_PARAM_DEFAULTS }
}

// 计算盈利指标
const calculatedRevenue = computed(() => profitParams.value.orderCount * profitParams.value.avgPrice)
const profitVariableCost = computed(() =>
  calculatedRevenue.value * (1 - profitParams.value.margin / 100)
)
const profitGrossProfit = computed(() => calculatedRevenue.value - profitVariableCost.value)

const calculatedCost = computed(() => profitParams.value.fixedCost + profitVariableCost.value)
const calculatedProfit = computed(() => calculatedRevenue.value - calculatedCost.value)
const calculatedMargin = computed(() => {
  if (calculatedRevenue.value === 0) return 0
  return (calculatedProfit.value / calculatedRevenue.value) * 100
})

const profitBreakevenOrders = computed(() => {
  const unitCm = profitParams.value.avgPrice * (profitParams.value.margin / 100)
  if (unitCm <= 0) return null
  return Math.ceil(profitParams.value.fixedCost / unitCm)
})

const profitHealth = computed(() => {
  const p = calculatedProfit.value
  const m = calculatedMargin.value
  if (p <= 0) {
    return {
      level: 'bad',
      title: '处于亏损区间',
      detail: '营收未能覆盖固定 + 变动成本，可优先检视客单、毛利率与固定成本结构，或下调固定/提升转化。'
    }
  }
  if (m >= 18) {
    return {
      level: 'good',
      title: '利润表健康度良好',
      detail: '净利润率处于相对安全区，可关注规模扩张与现金流节奏，避免过度加杠杆。'
    }
  }
  if (m >= 8) {
    return {
      level: 'warn',
      title: '利润偏薄，需关注',
      detail: '净利尚可但缓冲有限，建议结合渠道成本与退货损耗再做敏感性试算。'
    }
  }
  return {
    level: 'weak',
    title: '净利偏低',
    detail: '建议优先提升毛利结构或客单价，并评估固定成本是否可阶段性优化。'
  }
})

/** 营收占比条：盈利时三块之和为 100%；亏损时展示成本结构（固定 vs 变动） */
const profitCostMix = computed(() => {
  const rev = calculatedRevenue.value
  const f = profitParams.value.fixedCost
  const v = profitVariableCost.value
  const p = calculatedProfit.value
  if (rev <= 0) {
    return { fixedPct: 0, variablePct: 0, profitPct: 0, loss: true, lossGapPct: 0 }
  }
  if (p >= 0) {
    return {
      fixedPct: (f / rev) * 100,
      variablePct: (v / rev) * 100,
      profitPct: (p / rev) * 100,
      loss: false,
      lossGapPct: 0
    }
  }
  const scale = f + v
  if (scale <= 0) {
    return { fixedPct: 0, variablePct: 0, profitPct: 0, loss: true, lossGapPct: 0 }
  }
  return {
    fixedPct: (f / scale) * 100,
    variablePct: (v / scale) * 100,
    profitPct: 0,
    loss: true,
    lossGapPct: ((f + v - rev) / rev) * 100
  }
})

// 产品金字塔数据
const productPyramid = [
  {
    name: '形象款',
    type: 'premium',
    badge: '镇店之宝',
    icon: '👑',
    description: '极高单价，提升品牌调性',
    priceRange: '2000-10000',
    targetShare: '10',
    margin: '60',
    products: ['大型生态缸', '稀有收藏级标本', '定制作品'],
    strategy: '品牌展示，吸引高端客户，提升品牌溢价'
  },
  {
    name: '利润款',
    type: 'profit',
    badge: '核心主力',
    icon: '💎',
    description: '中高客单价，主要营收来源',
    priceRange: '500-2000',
    targetShare: '40',
    margin: '55',
    products: ['蝴蝶装饰画', '昆虫标本画', '植物标本框'],
    strategy: '核心营收，体现品牌审美，保持高毛利'
  },
  {
    name: '引流款',
    type: 'traffic',
    badge: '高频消费',
    icon: '🛍️',
    description: '低单价，高复购，易标准化',
    priceRange: '50-500',
    targetShare: '50',
    margin: '40',
    products: ['树脂饰品', '果壳铃', '小型标本'],
    strategy: '流量获取，降低购买门槛，提高转化率'
  }
]

// 流量渠道数据
const trafficChannels = [
  {
    name: '线下门店',
    icon: '🏪',
    funnel: [
      { name: '到店人数', value: 3000 },
      { name: '咨询人数', value: 1500 },
      { name: '体验人数', value: 800 },
      { name: '成交人数', value: 450 }
    ],
    cac: 80,
    roi: 3.5
  },
  {
    name: '小红书',
    icon: '📱',
    funnel: [
      { name: '曝光量', value: 50000 },
      { name: '点击量', value: 5000 },
      { name: '加购数', value: 500 },
      { name: '成交数', value: 100 }
    ],
    cac: 120,
    roi: 2.8
  },
  {
    name: '抖音',
    icon: '🎬',
    funnel: [
      { name: '播放量', value: 100000 },
      { name: '关注数', value: 2000 },
      { name: '加购数', value: 300 },
      { name: '成交数', value: 80 }
    ],
    cac: 150,
    roi: 2.2
  },
  {
    name: '私域社群',
    icon: '👥',
    funnel: [
      { name: '社群人数', value: 5000 },
      { name: '活跃人数', value: 2000 },
      { name: '咨询人数', value: 400 },
      { name: '成交人数', value: 200 }
    ],
    cac: 30,
    roi: 5.0
  }
]

// 门店区域数据
const storeZones = [
  {
    name: '入口区',
    description: '品牌展示，第一印象',
    style: { top: '10%', left: '10%', width: '20%', height: '15%' }
  },
  {
    name: '展陈区',
    description: '核心产品展示',
    style: { top: '30%', left: '35%', width: '30%', height: '40%' }
  },
  {
    name: '体验区',
    description: '手作工坊，互动体验',
    style: { top: '50%', left: '10%', width: '25%', height: '35%' }
  },
  {
    name: '收银区',
    description: '交易完成，会员转化',
    style: { top: '75%', left: '70%', width: '20%', height: '15%' }
  }
]

const flowArrows = [
  { style: { top: '25%', left: '25%' } },
  { style: { top: '50%', left: '35%' } },
  { style: { top: '75%', left: '50%' } }
]

// 展陈设计数据
const displayDesigns = [
  {
    name: '主题展区',
    priority: '高优先级',
    keyPoints: '按主题分类展示，如"昆虫世界"、"海洋奇观"等',
    products: '核心产品+形象款',
    interaction: '触摸屏介绍，标本放大镜观察'
  },
  {
    name: '故事墙',
    priority: '中优先级',
    keyPoints: '展示标本背后的自然故事和制作工艺',
    products: '图文并茂的故事板',
    interaction: '扫码观看视频介绍'
  },
  {
    name: '互动体验区',
    priority: '高优先级',
    keyPoints: '手作工坊，DIY体验，知识问答',
    products: '体验套装+教程',
    interaction: '现场教学，即时制作'
  }
]

// 3年规划数据
const threeYearPlan = [
  {
    year: 2025,
    theme: '基础夯实年',
    milestones: [
      {
        name: '单店模型优化',
        description: '完善单店运营SOP，提升盈利能力',
        metrics: [
          { label: '月营收', value: '¥20万+' },
          { label: '净利润率', value: '15%+' }
        ]
      },
      {
        name: '供应链建立',
        description: '在云南建立直采基地，稳定原材料供应',
        metrics: [
          { label: '供应商数量', value: '3-5家' },
          { label: '成本降低', value: '20%' }
        ]
      },
      {
        name: '品牌内容矩阵',
        description: '建立小红书、抖音内容矩阵',
        metrics: [
          { label: '粉丝数', value: '10万+' },
          { label: '月曝光', value: '100万+' }
        ]
      }
    ]
  },
  {
    year: 2026,
    theme: '扩张增长年',
    milestones: [
      {
        name: '多店扩张',
        description: '开设2-3家新店，覆盖核心城市',
        metrics: [
          { label: '门店数', value: '3-4家' },
          { label: '总月营收', value: '¥80万+' }
        ]
      },
      {
        name: 'B端业务启动',
        description: '拓展教育机构、博物馆等B端客户',
        metrics: [
          { label: 'B端客户', value: '20家+' },
          { label: 'B端营收占比', value: '30%' }
        ]
      },
      {
        name: '线上商城上线',
        description: '建立自有线上商城，完善全渠道布局',
        metrics: [
          { label: '线上营收', value: '¥30万+/月' },
          { label: 'SKU数量', value: '200+' }
        ]
      }
    ]
  },
  {
    year: 2027,
    theme: '品牌提升年',
    milestones: [
      {
        name: '全国知名品牌',
        description: '成为标本艺术领域的知名品牌',
        metrics: [
          { label: '品牌知名度', value: '行业TOP3' },
          { label: '年营收', value: '¥2000万+' }
        ]
      },
      {
        name: '产品线拓展',
        description: '开发新产品线，拓展业务边界',
        metrics: [
          { label: '产品线', value: '5条+' },
          { label: 'SKU总数', value: '500+' }
        ]
      },
      {
        name: '资本对接',
        description: '准备A轮融资，支持更大规模扩张',
        metrics: [
          { label: '融资目标', value: '¥2000万' },
          { label: '估值', value: '¥1亿+' }
        ]
      }
    ]
  }
]

// 资源配置数据
const resourceAllocation = [
  {
    category: '门店运营',
    total: 4800000,
    breakdown: [
      { name: '人员成本', amount: 2000000 },
      { name: '租金', amount: 1500000 },
      { name: '装修', amount: 800000 },
      { name: '日常运营', amount: 500000 }
    ]
  },
  {
    category: '营销推广',
    total: 2400000,
    breakdown: [
      { name: '内容营销', amount: 800000 },
      { name: '广告投放', amount: 1000000 },
      { name: '活动策划', amount: 400000 },
      { name: '品牌建设', amount: 200000 }
    ]
  },
  {
    category: '供应链',
    total: 1800000,
    breakdown: [
      { name: '原材料采购', amount: 1200000 },
      { name: '加工制造', amount: 400000 },
      { name: '仓储物流', amount: 200000 }
    ]
  },
  {
    category: '产品研发',
    total: 1000000,
    breakdown: [
      { name: '设计开发', amount: 600000 },
      { name: '样品制作', amount: 200000 },
      { name: '测试优化', amount: 200000 }
    ]
  }
]

/** 三年规划池：各大类投入合计（元） */
const planningInvestmentTotal = computed(() =>
  resourceAllocation.reduce((sum, r) => sum + r.total, 0)
)

/** 顶栏 KPI：与里程碑/投入数据同源 */
const planningKpiStrip = computed(() => {
  const totalYuan = planningInvestmentTotal.value
  const totalWan = Math.round(totalYuan / 10000)
  const milestoneCount = threeYearPlan.reduce((n, y) => n + y.milestones.length, 0)
  const y2027 = threeYearPlan.find((y) => y.year === 2027)
  return [
    {
      label: '三年累计战略投入',
      value: `约 ¥${totalWan.toLocaleString()} 万`,
      sub: '门店运营+营销+供应链+研发（规划池）'
    },
    {
      label: '2027 营收目标',
      value: '¥2000 万+',
      sub: y2027 ? `${y2027.theme} · 与里程碑对齐` : '品牌提升年'
    },
    {
      label: '门店网络目标',
      value: '3–4 家',
      sub: '2026 扩张年 · 多店模型验证'
    },
    {
      label: '里程碑节点',
      value: `${milestoneCount} 项`,
      sub: '可拆季度 OKR 复盘'
    }
  ]
})

const PLANNING_CAPEX_COLORS = [VI.brandGreen, VI.gold400, VI.info, VI.sage]

/** 与环形图一致的图例行（占比 + 金额） */
const planningCapexLegend = computed(() => {
  const sum = planningInvestmentTotal.value || 1
  return resourceAllocation.map((r, i) => ({
    category: r.category,
    amount: r.total,
    pct: ((r.total / sum) * 100).toFixed(1),
    color: PLANNING_CAPEX_COLORS[i % PLANNING_CAPEX_COLORS.length]
  }))
})

// 初始化所有图表
const initCharts = () => {
  // 延迟初始化，确保DOM已渲染
  nextTick(() => {
    setTimeout(() => {
      // 根据当前视图初始化对应的图表
      switch (currentView.value) {
        case 'overview':
          initTrendChart()
          break
        case 'supply':
          initSupplyChart()
          initIndustryGrowthChart()
          break
        case 'products':
        case 'productGenerator':
          initProductRadar()
          break
        case 'channels':
          initFunnelChart()
          break
        case 'competitors':
          initCompetitorRadarChart()
          break
        case 'profit':
          initProfit3DChart()
          break
        case 'store':
          initHeatmapChart()
          break
        case 'planning':
          initPlanningChart()
          initPlanningCapexChart()
          break
      }
    }, 300)
  })
}

// 1. Trend Chart - 行业总览（增强：resolveRefCanvas + 预测上沿 + VI 对齐）
const initTrendChart = () => {
  const canvas = resolveRefCanvas(trendChartCanvas)
  if (!canvas || trendChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  let labels = [...trendData.labels]
  let searchData = [...trendData.searchIndex]
  let industryData = [...trendData.industryAvg]
  let forecastData = [...trendData.forecastUpper]

  if (selectedTimeRange.value === '3y') {
    labels = trendData.labels.slice(-3)
    searchData = trendData.searchIndex.slice(-3)
    industryData = trendData.industryAvg.slice(-3)
    forecastData = trendData.forecastUpper.slice(-3)
  } else if (selectedTimeRange.value === '5y') {
    labels = trendData.labels.slice(-5)
    searchData = trendData.searchIndex.slice(-5)
    industryData = trendData.industryAvg.slice(-5)
    forecastData = trendData.forecastUpper.slice(-5)
  }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '自然装饰标本搜索指数',
          data: searchData,
          borderColor: VI.brandGreen,
          backgroundColor: 'rgba(45, 106, 79, 0.14)',
          fill: true,
          tension: 0.42,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: VI.brandGreen,
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: VI.brandGreen,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          borderWidth: 2.5
        },
        {
          label: '行业平均增长趋势',
          data: industryData,
          borderColor: VI.sage,
          backgroundColor: 'rgba(123, 140, 124, 0.06)',
          fill: true,
          tension: 0.38,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: VI.sage,
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          borderDash: [6, 4]
        },
        {
          label: '预测上沿（内部估算）',
          data: forecastData,
          borderColor: VI.info,
          backgroundColor: 'rgba(91, 143, 185, 0.06)',
          fill: false,
          tension: 0.35,
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: VI.info,
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          borderWidth: 2,
          borderDash: [4, 4]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(26, 24, 21, 0.92)',
          titleColor: '#f5f2ec',
          bodyColor: '#f5f2ec',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            title(ctx) {
              return `${ctx[0].label}`
            },
            label(ctx) {
              const v = ctx.parsed.y
              if (v == null || Number.isNaN(v)) return `${ctx.dataset.label}: —`
              const index = ctx.dataIndex
              const series = ctx.dataset.data
              const prev = index > 0 ? series[index - 1] : null
              if (prev == null || typeof prev !== 'number') {
                return `${ctx.dataset.label}: ${v}`
              }
              const change = (((v - prev) / prev) * 100).toFixed(1)
              const arrow = Number(change) > 0 ? '+' : ''
              return `${ctx.dataset.label}: ${v}（环比 ${arrow}${change}%）`
            },
            afterLabel(ctx) {
              if (ctx.datasetIndex === 0 && ctx.dataIndex > 0) {
                const cur = ctx.parsed.y
                const first = ctx.dataset.data[0]
                if (typeof first === 'number' && first !== 0) {
                  const totalGrowth = (((cur - first) / first) * 100).toFixed(1)
                  return `较首年累计 ${Number(totalGrowth) > 0 ? '+' : ''}${totalGrowth}%`
                }
              }
              return ''
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(26, 24, 21, 0.07)', drawBorder: false },
          ticks: {
            font: { size: 11 },
            color: VI.textSecondary,
            padding: 8
          },
          title: {
            display: true,
            text: '搜索指数',
            color: VI.textTertiary,
            font: { size: 11, weight: '600' },
            padding: { bottom: 8 }
          }
        },
        x: {
          grid: { display: false, drawBorder: false },
          ticks: {
            font: { size: 12, weight: '600' },
            color: VI.textSecondary,
            maxRotation: 45,
            minRotation: 0
          },
          title: {
            display: true,
            text: '年份',
            color: VI.textTertiary,
            font: { size: 11, weight: '600' },
            padding: { top: 8 }
          }
        }
      },
      animation: { duration: 900, easing: 'easeOutQuart' }
    }
  })
  nextTick(() => {
    try {
      trendChart?.resize()
    } catch (_) {}
  })
}

// 监听时间范围变化，重新渲染图表
watch(selectedTimeRange, () => {
  if (trendChart) {
    trendChart.destroy()
    trendChart = null
    setTimeout(() => {
      initTrendChart()
    }, 100)
  }
})

// 2. Supply Chart
const initSupplyChart = () => {
  const canvas = resolveRefCanvas(supplyChartCanvas)
  if (!canvas || supplyChart) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const data = reportData.supplyChain.all
  supplyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: '产业聚集度指数 (0-100)',
        data: data.data,
        backgroundColor: [VI.brandGreen, '#e3cf96', VI.gold400, '#a88d42', VI.earth600],
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 13 },
          borderColor: VI.brandGreen,
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return `聚集度指数: ${context.parsed.x}`
            }
          }
        }
      },
      scales: {
        x: {
          grid: { 
            color: 'rgba(213, 210, 203, 0.55)',
            drawBorder: false
          },
          ticks: {
            font: { size: 12 },
            color: VI.textTertiary
          }
        },
        y: {
          grid: { 
            color: 'rgba(213, 210, 203, 0.55)',
            drawBorder: false
          },
          ticks: {
            font: { size: 12 },
            color: VI.textTertiary
          }
        }
      }
    }
  })
  nextTick(() => {
    try {
      supplyChart?.resize()
    } catch (_) {}
  })
}

// 3. Product Radar
const initProductRadar = () => {
  const canvas = resolveRefCanvas(productRadarCanvas)
  if (!canvas || productRadar) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  productRadar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['利润率', '销量潜力', '运输便利', '工艺门槛', '供应链稳定'],
      datasets: [{
        label: '🦋 原蝶画 (主力)',
        data: [80, 70, 60, 75, 60],
        borderColor: VI.brandGreen,
        backgroundColor: 'rgba(45, 106, 79, 0.2)'
      }, {
        label: '💍 树脂饰品 (引流)',
        data: [40, 90, 95, 30, 90],
        borderColor: VI.gold400,
        backgroundColor: 'rgba(196, 165, 90, 0.18)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: 'rgba(213, 210, 203, 0.65)' },
          grid: { color: 'rgba(213, 210, 203, 0.65)' },
          pointLabels: { font: { size: 12 } }
        }
      }
    }
  })
  nextTick(() => {
    try {
      productRadar?.resize()
    } catch (_) {}
  })
}

// 4. Channel Chart
const initChannelChart = () => {
  const canvas = resolveRefCanvas(channelChartCanvas)
  if (!canvas || channelChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  channelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['线下门店/市集', 'B端教育采购', '线上电商(淘/抖)', '生活集合店分销'],
      datasets: [
        {
          data: [40, 25, 20, 15],
          backgroundColor: [VI.brandGreen, VI.gold400, '#a88d42', '#e3cf96'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 14, font: { size: 11 } }
        },
        title: {
          display: true,
          text: '当前理想营收结构占比（示意）',
          font: { size: 13, weight: '600' },
          color: VI.textSecondary,
          padding: { bottom: 8 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed
              const sum = ctx.dataset.data.reduce((a, b) => a + b, 0)
              const pct = sum ? ((v / sum) * 100).toFixed(1) : '0'
              return ` ${ctx.label}: ${pct}%`
            }
          }
        }
      }
    }
  })
  nextTick(() => {
    try {
      channelChart?.resize()
    } catch (_) {}
  })
}

// 监听盈利参数变化，实时更新图表
watch([() => profitParams.value.orderCount, () => profitParams.value.avgPrice, () => profitParams.value.margin, () => profitParams.value.fixedCost], () => {
  if (profit3DChart && currentView.value === 'profit') {
    updateProfitChart()
  }
}, { deep: true })

// 更新供应链图表
const updateSupplyMap = (type) => {
  supplyFilter.value = type
  const data = reportData.supplyChain[type]
  
  if (supplyChart) {
    supplyChart.data.labels = data.labels
    supplyChart.data.datasets[0].data = data.data
    supplyChart.update()
  }
  
  currentInsight.value = data.insight
}

// 5. 行业规模CAGR图表
const initIndustryGrowthChart = () => {
  const canvas = resolveRefCanvas(industryGrowthChartCanvas)
  if (!canvas || industryGrowthChart) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  industryGrowthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2019', '2020', '2021', '2022', '2023', '2024', '2025E', '2026E', '2027E', '2028E'],
      datasets: [
        {
          label: '市场规模 (亿元)',
          data: [45, 52, 62, 75, 85, 92, 95, 120, 155, 200],
          borderColor: VI.brandGreen,
          backgroundColor: 'rgba(45, 106, 79, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'CAGR (%)',
          data: [null, 15.6, 19.2, 21.0, 13.3, 12.0, 16.8, 18.0, 19.2, 20.1],
          borderColor: VI.gold400,
          backgroundColor: 'rgba(196, 165, 90, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y1',
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { enabled: true }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: '市场规模 (亿元)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'CAGR (%)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  })
  nextTick(() => {
    try {
      industryGrowthChart?.resize()
    } catch (_) {}
  })
}

// 6. 竞品雷达图
const initCompetitorRadarChart = () => {
  const canvas = resolveRefCanvas(competitorRadarCanvas)
  if (!canvas || competitorRadarChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  competitorRadarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['价格优势', '品牌知名度', '产品创新', '渠道覆盖', '用户体验', '供应链'],
      datasets: [
        {
          label: '山海造物',
          data: [75, 50, 90, 60, 85, 65],
          borderColor: VI.brandGreen,
          backgroundColor: 'rgba(45, 106, 79, 0.2)',
          pointBackgroundColor: VI.brandGreen
        },
        {
          label: '自然造物',
          data: [60, 80, 40, 85, 70, 90],
          borderColor: '#a88d42',
          backgroundColor: 'rgba(168, 141, 66, 0.18)',
          pointBackgroundColor: '#a88d42'
        },
        {
          label: '拾野自然',
          data: [90, 70, 85, 90, 75, 50],
          borderColor: VI.gold400,
          backgroundColor: 'rgba(196, 165, 90, 0.18)',
          pointBackgroundColor: VI.gold400
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          angleLines: { color: 'rgba(213, 210, 203, 0.55)' },
          grid: { color: 'rgba(213, 210, 203, 0.45)' },
          pointLabels: { font: { size: 11 }, color: VI.textSecondary }
        }
      }
    }
  })
  nextTick(() => {
    try {
      competitorRadarChart?.resize()
    } catch (_) {}
  })
}

// 7. 盈利模拟柱状图
const initProfit3DChart = () => {
  const canvas = resolveRefCanvas(profit3DChartCanvas)
  if (!canvas || profit3DChart) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  profit3DChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['月营收', '月总成本', '月净利润'],
      datasets: [
        {
          label: '金额 (¥)',
          data: [calculatedRevenue.value, calculatedCost.value, calculatedProfit.value],
          backgroundColor: [
            'rgba(45, 106, 79, 0.78)',
            'rgba(208, 84, 80, 0.55)',
            calculatedProfit.value > 0 ? 'rgba(82, 183, 136, 0.85)' : 'rgba(208, 84, 80, 0.85)'
          ],
          borderColor: [VI.brandGreen, VI.error, calculatedProfit.value > 0 ? VI.success : VI.error],
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 72
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (context) => {
              const y = context.parsed.y
              return ` ${context.dataset.label || '金额'}: ¥${Number(y).toLocaleString()}`
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 12, weight: '600' },
            color: VI.textSecondary
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(213, 210, 203, 0.45)' },
          ticks: {
            font: { size: 11 },
            color: VI.textTertiary,
            callback: (value) => {
              const n = Number(value)
              if (Math.abs(n) >= 1000000) return `¥${(n / 1000000).toFixed(1)}M`
              if (Math.abs(n) >= 1000) return `¥${(n / 1000).toFixed(0)}k`
              return `¥${n}`
            }
          }
        }
      },
      animation: { duration: 520, easing: 'easeOutQuart' }
    }
  })
  nextTick(() => {
    try {
      profit3DChart?.resize()
    } catch (_) {}
  })
}

const updateProfitChart = () => {
  if (!profit3DChart) return
  const p = calculatedProfit.value
  profit3DChart.data.datasets[0].data = [calculatedRevenue.value, calculatedCost.value, p]
  profit3DChart.data.datasets[0].backgroundColor = [
    'rgba(45, 106, 79, 0.78)',
    'rgba(208, 84, 80, 0.55)',
    p > 0 ? 'rgba(82, 183, 136, 0.85)' : 'rgba(208, 84, 80, 0.85)'
  ]
  profit3DChart.data.datasets[0].borderColor = [VI.brandGreen, VI.error, p > 0 ? VI.success : VI.error]
  profit3DChart.update('none')
}

// 8. 流量漏斗图
const initFunnelChart = () => {
  const canvas = resolveRefCanvas(funnelChartCanvas)
  if (!canvas || funnelChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const totalFunnel = {
    labels: ['曝光/到店', '点击/咨询', '加购/体验', '成交'],
    data: [138000, 8500, 1800, 830]
  }

  funnelChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: totalFunnel.labels,
      datasets: [
        {
          label: '数量',
          data: totalFunnel.data,
          backgroundColor: [
            'rgba(45, 106, 79, 0.85)',
            'rgba(196, 165, 90, 0.88)',
            'rgba(168, 141, 66, 0.88)',
            'rgba(82, 183, 136, 0.9)'
          ],
          borderRadius: 6,
          maxBarThickness: 36
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.parsed.x?.toLocaleString?.() ?? c.parsed.x} 人/次`,
            afterLabel: (context) => {
              const index = context.dataIndex
              if (index > 0) {
                const conversion = ((context.parsed.x / totalFunnel.data[index - 1]) * 100).toFixed(1)
                return `环节转化率: ${conversion}%`
              }
              return ''
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(213, 210, 203, 0.4)' },
          ticks: { color: VI.textTertiary, font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: VI.textSecondary, font: { size: 12, weight: '500' } }
        }
      }
    }
  })
  nextTick(() => {
    try {
      funnelChart?.resize()
    } catch (_) {}
  })
}

// 9. 门店热力图（柱状示意）
const initHeatmapChart = () => {
  const canvas = resolveRefCanvas(heatmapCanvas)
  if (!canvas || heatmapChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  heatmapChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['入口区', '展陈区', '体验区', '收银区', '休息区'],
      datasets: [
        {
          label: '访问热度指数',
          data: [95, 88, 75, 65, 45],
          backgroundColor: [
            'rgba(208, 84, 80, 0.75)',
            'rgba(168, 141, 66, 0.8)',
            'rgba(45, 106, 79, 0.82)',
            'rgba(82, 183, 136, 0.8)',
            'rgba(91, 143, 185, 0.78)'
          ],
          borderRadius: 6,
          maxBarThickness: 48
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${c.parsed.y}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: '热度 (0–100)', color: VI.textTertiary, font: { size: 11 } },
          grid: { color: 'rgba(213, 210, 203, 0.4)' }
        },
        x: {
          grid: { display: false },
          ticks: { color: VI.textSecondary, font: { size: 11 } }
        }
      }
    }
  })
  nextTick(() => {
    try {
      heatmapChart?.resize()
    } catch (_) {}
  })
}

// 10. 3年规划：关键指标双轴曲线
const initPlanningChart = () => {
  const canvas = resolveRefCanvas(planningChartCanvas)
  if (!canvas || planningChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  planningChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2025', '2026', '2027', '2028（展望）'],
      datasets: [
        {
          label: '年营收（万元）',
          data: [480, 960, 2000, 2400],
          borderColor: VI.brandGreen,
          backgroundColor: 'rgba(45, 106, 79, 0.14)',
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: VI.brandGreen,
          pointBorderWidth: 2
        },
        {
          label: '门店数（家）',
          data: [1, 3, 4, 6],
          borderColor: VI.gold400,
          backgroundColor: 'rgba(196, 165, 90, 0.06)',
          fill: false,
          tension: 0.35,
          yAxisID: 'y1',
          borderDash: [6, 4],
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: VI.gold400,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: VI.textSecondary, padding: 16, usePointStyle: true, boxWidth: 8 }
        },
        tooltip: {
          backgroundColor: 'rgba(26, 24, 21, 0.92)',
          titleColor: '#f5f2ec',
          bodyColor: '#f5f2ec',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          padding: 12
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(26, 24, 21, 0.06)' },
          ticks: { color: VI.textSecondary, font: { size: 12 } }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: '年营收（万元）',
            color: VI.textTertiary,
            font: { size: 11, weight: '600' }
          },
          grid: { color: 'rgba(26, 24, 21, 0.07)' },
          ticks: { color: VI.textSecondary, font: { size: 11 } }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: '门店数（家）',
            color: VI.textTertiary,
            font: { size: 11, weight: '600' }
          },
          grid: { drawOnChartArea: false },
          ticks: { color: VI.gold400, font: { size: 11 }, stepSize: 1 }
        }
      }
    }
  })
  nextTick(() => {
    try {
      planningChart?.resize()
    } catch (_) {}
  })
}

// 10b. 三年规划：投入结构环形图
const initPlanningCapexChart = () => {
  const canvas = resolveRefCanvas(planningCapexCanvas)
  if (!canvas || planningCapexChart) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const labels = resourceAllocation.map((r) => r.category)
  const data = resourceAllocation.map((r) => r.total)
  const colors = PLANNING_CAPEX_COLORS

  planningCapexChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors.map((c, i) => `${c}bf`),
          borderColor: colors.map((c) => c),
          borderWidth: 2,
          hoverOffset: 10
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(26, 24, 21, 0.92)',
          titleColor: '#f5f2ec',
          bodyColor: '#f5f2ec',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          callbacks: {
            label(ctx) {
              const v = Number(ctx.raw) || 0
              const sum = data.reduce((a, b) => a + b, 0)
              const pct = sum ? ((v / sum) * 100).toFixed(1) : '0'
              return ` ${ctx.label}: ¥${v.toLocaleString()}（${pct}%）`
            }
          }
        }
      }
    }
  })
  nextTick(() => {
    try {
      planningCapexChart?.resize()
    } catch (_) {}
  })
}

// 监听视图变化，延迟初始化图表
watch(currentView, (newView, oldView) => {
  if (oldView === 'overview' && newView !== 'overview') {
    if (trendChart) {
      try {
        trendChart.destroy()
      } catch (_) {}
      trendChart = null
    }
  }
  if (oldView === 'supply' && newView !== 'supply') {
    if (supplyChart) {
      try {
        supplyChart.destroy()
      } catch (_) {}
      supplyChart = null
    }
    if (industryGrowthChart) {
      try {
        industryGrowthChart.destroy()
      } catch (_) {}
      industryGrowthChart = null
    }
  }
  if (oldView === 'products' && newView !== 'products') {
    if (productRadar) {
      try {
        productRadar.destroy()
      } catch (_) {}
      productRadar = null
    }
  }
  if (oldView === 'profit' && newView !== 'profit') {
    if (profit3DChart) {
      try {
        profit3DChart.destroy()
      } catch (_) {}
      profit3DChart = null
    }
  }
  if (oldView === 'channels' && newView !== 'channels') {
    if (channelChart) {
      try {
        channelChart.destroy()
      } catch (_) {}
      channelChart = null
    }
    if (funnelChart) {
      try {
        funnelChart.destroy()
      } catch (_) {}
      funnelChart = null
    }
  }
  if (oldView === 'competitors' && newView !== 'competitors') {
    if (competitorRadarChart) {
      try {
        competitorRadarChart.destroy()
      } catch (_) {}
      competitorRadarChart = null
    }
  }
  if (oldView === 'store' && newView !== 'store') {
    if (heatmapChart) {
      try {
        heatmapChart.destroy()
      } catch (_) {}
      heatmapChart = null
    }
  }
  if (oldView === 'planning' && newView !== 'planning') {
    if (planningChart) {
      try {
        planningChart.destroy()
      } catch (_) {}
      planningChart = null
    }
    if (planningCapexChart) {
      try {
        planningCapexChart.destroy()
      } catch (_) {}
      planningCapexChart = null
    }
  }
  nextTick(() => {
    setTimeout(() => {
      if (newView === 'overview' && !trendChart && resolveRefCanvas(trendChartCanvas)) {
        initTrendChart()
      }
      if (newView === 'supply' && !supplyChart && resolveRefCanvas(supplyChartCanvas)) {
        initSupplyChart()
        if (supplyChart) {
          updateSupplyMap(supplyFilter.value)
        }
      }
      if (newView === 'products' && !productRadar && resolveRefCanvas(productRadarCanvas)) {
        initProductRadar()
      }
      if (newView === 'channels' && !channelChart && resolveRefCanvas(channelChartCanvas)) {
        initChannelChart()
      }
      if (newView === 'supply' && !industryGrowthChart && resolveRefCanvas(industryGrowthChartCanvas)) {
        initIndustryGrowthChart()
      }
      if (newView === 'competitors' && !competitorRadarChart && resolveRefCanvas(competitorRadarCanvas)) {
        initCompetitorRadarChart()
      }
      if (newView === 'competitors' && !cloudDocs.value.length && !cloudDocsLoading.value) {
        refreshCloudBenchmarkDocs()
      }
      if (newView === 'profit' && !profit3DChart && resolveRefCanvas(profit3DChartCanvas)) {
        initProfit3DChart()
      }
      if (newView === 'channels' && !funnelChart && resolveRefCanvas(funnelChartCanvas)) {
        initFunnelChart()
      }
      if (newView === 'store' && !heatmapChart && resolveRefCanvas(heatmapCanvas)) {
        initHeatmapChart()
      }
      if (newView === 'planning' && !planningChart && resolveRefCanvas(planningChartCanvas)) {
        initPlanningChart()
      }
      if (newView === 'planning' && !planningCapexChart && resolveRefCanvas(planningCapexCanvas)) {
        initPlanningCapexChart()
      }
      // 加载AI用研结论
      if (newView === 'aiResearch' && aiResearchList.value.length === 0) {
        loadAIResearch()
      }
    }, 150)
  })
})

// 加载AI用研结论
const loadAIResearch = async () => {
  loadingResearch.value = true
  try {
    aiResearchList.value = await fetchCollectionSorted(COLLECTIONS.STRATEGY_RESEARCH, {
      limit: 200,
      throwOnError: true,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
    })
  } catch (error) {
    console.error('加载用研结论失败:', error)
    aiResearchList.value = []
  } finally {
    loadingResearch.value = false
  }
}

// 过滤和排序用研结论
const filteredResearch = computed(() => {
  let result = [...aiResearchList.value]
  
  // 按类型过滤
  if (researchFilter.value.type) {
    result = result.filter(item => item.type === researchFilter.value.type)
  }
  
  // 排序
  if (researchSort.value === 'oldest') {
    result.sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
  } else {
    result.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
  }
  
  return result
})

const getResearchTypeLabel = (type) => {
  const map = {
    market: '市场调研',
    user: '用户调研',
    competitor: '竞品调研',
    trend: '行业趋势',
    product: '产品需求'
  }
  return map[type] || type
}

const formatResearchDate = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

const toggleExpand = (id) => {
  expandedResearchId.value = expandedResearchId.value === id ? null : id
}

const exportResearch = (item) => {
  const filename = `用研报告_${item.topic}_${formatResearchDate(item.createTime)}.md`
  const content = `# ${item.topic}

**调研类型：** ${getResearchTypeLabel(item.type)}
**调研时间：** ${formatResearchDate(item.createTime)}
${item.objective ? `**调研目标：** ${item.objective}\n` : ''}

${item.content}
`
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreenState)
  // 预加载 AI 用研条数，用于导航栏「调研状态」展示
  loadAIResearch()
  // 默认显示 overview，延迟初始化图表
  nextTick(() => {
    setTimeout(() => {
      if (currentView.value === 'overview') {
        initTrendChart()
      }
      initCharts()
    }, 300)
  })
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  // 销毁所有图表实例
  if (trendChart) trendChart.destroy()
  if (supplyChart) supplyChart.destroy()
  if (productRadar) productRadar.destroy()
  if (channelChart) channelChart.destroy()
  if (industryGrowthChart) industryGrowthChart.destroy()
  if (competitorRadarChart) competitorRadarChart.destroy()
  if (profit3DChart) profit3DChart.destroy()
  if (funnelChart) funnelChart.destroy()
  if (heatmapChart) heatmapChart.destroy()
  if (planningChart) planningChart.destroy()
  if (planningCapexChart) planningCapexChart.destroy()
})
</script>

<style scoped>
.strategy-research-container {
  min-height: 100vh;
  height: 100vh;
  max-height: 100vh;
  background:
    radial-gradient(circle at 20% 50%, rgba(45, 106, 79, 0.04) 0%, transparent 52%),
    radial-gradient(circle at 80% 80%, rgba(168, 141, 66, 0.04) 0%, transparent 48%),
    linear-gradient(165deg, var(--light-bg-primary) 0%, var(--light-bg-secondary) 45%, var(--light-bg-tertiary) 100%);
  color: var(--light-text-primary);
  font-family: var(--font-cn-body), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  display: flex;
  width: 100%;
  overflow: hidden;
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

.strategy-research-container.is-fullscreen {
  background: linear-gradient(135deg, #f8faf7 0%, #eef4ee 100%);
}

.strategy-research-container::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: 
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(45, 106, 79, 0.01) 2px,
      rgba(45, 106, 79, 0.01) 4px
    );
  pointer-events: none;
  z-index: 0;
}

.command-center {
  display: grid;
  gap: 18px;
  margin-bottom: 24px;
}

.command-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  padding: 24px;
  border-radius: 22px;
  color: #fff;
  background:
    radial-gradient(circle at top right, rgba(196, 165, 90, 0.36), transparent 35%),
    linear-gradient(135deg, #173b2d 0%, #2d6a4f 55%, #7b8c7c 100%);
  box-shadow: 0 18px 44px rgba(45, 106, 79, 0.22);
}

.command-hero h2 {
  margin: var(--space-1) 0 var(--space-2);
}

.eyebrow {
  letter-spacing: 0.12em;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--light-text-tertiary);
}

.command-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.command-card {
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(45, 106, 79, 0.1);
  box-shadow: 0 10px 26px rgba(32, 42, 36, 0.08);
}

.command-label {
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
}

.command-value {
  margin: var(--space-2) 0 var(--space-1);
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-variant-numeric: tabular-nums;
}

.command-desc {
  color: var(--light-text-secondary);
  font-size: var(--text-xs);
}

.command-card.green { border-left: 4px solid #52b788; }
.command-card.gold { border-left: 4px solid #c4a55a; }
.command-card.blue { border-left: 4px solid #5b8fb9; }
.command-card.red { border-left: 4px solid #d05450; }

.decision-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 14px;
}

.decision-panel {
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(45, 106, 79, 0.1);
  box-shadow: 0 10px 26px rgba(32, 42, 36, 0.07);
}

.panel-title {
  margin-bottom: var(--space-3);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.decision-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid rgba(45, 106, 79, 0.08);
}

.decision-item:first-of-type {
  border-top: none;
}

.decision-item p,
.latest-research p {
  margin: var(--space-1) 0 0;
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.decision-badge {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.decision-badge.opportunity { background: rgba(82, 183, 136, 0.14); color: #2d6a4f; }
.decision-badge.risk { background: rgba(208, 84, 80, 0.14); color: #a53d39; }
.decision-badge.action { background: rgba(91, 143, 185, 0.14); color: #315f83; }

.latest-research.empty {
  color: #6b665d;
}

.next-actions {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.next-actions li {
  margin-bottom: var(--space-2);
}

/* 内部导航栏 - 指数级增强版 */
.internal-nav {
  width: 280px;
  background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
  border-right: 1px solid var(--light-border-subtle);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  box-shadow: 
    4px 0 20px rgba(0, 0, 0, 0.04),
    inset -1px 0 0 rgba(45, 106, 79, 0.1);
  z-index: 10;
  backdrop-filter: blur(10px);
}

.nav-brand {
  padding: 28px 24px;
  border-bottom: 1px solid var(--light-border-subtle);
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.05) 0%, transparent 100%);
  position: relative;
  overflow: hidden;
}

.nav-brand::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 0.85;
}

.brand-logo {
  width: 40px;
  height: 40px;
  background: var(--brand-green-600);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--light-bg-elevated);
  font-weight: 800;
  font-size: 20px;
  box-shadow: 
    0 4px 12px rgba(45, 106, 79, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  position: relative;
  transition: all 0.3s ease;
}

.brand-logo::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  padding: 2px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0.5;
}

.brand-logo:hover {
  transform: scale(1.05) rotate(5deg);
  box-shadow: 
    0 6px 20px rgba(45, 106, 79, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.brand-text {
  flex: 1;
}

.brand-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--light-text-primary);
  margin: 0;
  line-height: 1.3;
  font-family: inherit;
  letter-spacing: -0.3px;
}

.brand-subtitle {
  font-size: 10px;
  color: var(--light-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 2px;
  margin: 6px 0 0 0;
  font-weight: 600;
  opacity: 0.8;
}

.nav-tabs {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}

.nav-tab {
  width: 100%;
  text-align: left;
  padding: 16px 24px;
  font-size: 14px;
  color: var(--light-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-right: 4px solid transparent;
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  border-radius: 0 12px 12px 0;
  margin-right: 8px;
}

.nav-tab::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 0;
  background: var(--brand-green-500);
  transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px rgba(45, 106, 79, 0.4);
}

.nav-tab::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(45, 106, 79, 0.05) 0%, transparent 100%);
  opacity: 0;
  transition: opacity 0.3s;
  border-radius: 0 12px 12px 0;
}

.nav-tab:hover {
  background: linear-gradient(90deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.02) 100%);
  color: #2d3748;
  transform: translateX(4px);
}

.nav-tab:hover::after {
  opacity: 1;
}

.nav-tab.active {
  background: linear-gradient(90deg, rgba(45, 106, 79, 0.15) 0%, rgba(45, 106, 79, 0.05) 100%);
  border-right-color: #2D6A4F;
  font-weight: 700;
  color: #1a202c;
  box-shadow: 
    inset 4px 0 12px rgba(45, 106, 79, 0.1),
    0 2px 8px rgba(45, 106, 79, 0.05);
}

.nav-tab.active::before {
  height: 70%;
}

.nav-tab.active::after {
  opacity: 1;
}

.nav-status {
  padding: 14px 20px;
  border-top: 1px solid rgba(45, 106, 79, 0.15);
  background: linear-gradient(180deg, #fafbfc 0%, #f5f7fa 100%);
  font-size: 12px;
  color: #5a6c7d;
}

.status-text {
  margin: 2px 0;
}

.status-text strong {
  font-weight: 600;
  color: #2c3e50;
}

.nav-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.nav-action-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(45, 106, 79, 0.3);
  background: #fff;
  color: #5a6c7d;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-action-btn:hover {
  border-color: #2D6A4F;
  background: rgba(45, 106, 79, 0.08);
  color: #9d7a0a;
}

.nav-action-btn.primary {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.2) 0%, rgba(45, 106, 79, 0.1) 100%);
  border-color: #2D6A4F;
  color: #9d7a0a;
}

.nav-action-btn.primary:hover {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.3) 0%, rgba(45, 106, 79, 0.15) 100%);
  color: #7d5c08;
}

/* 主内容区 - 指数级增强版 */
.main-content-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  height: 100vh;
  max-height: 100vh;
  width: calc(100% - 280px);
  min-width: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(45, 106, 79, 0.03) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(168, 141, 66, 0.03) 0%, transparent 50%),
    linear-gradient(165deg, var(--light-bg-primary) 0%, var(--light-bg-secondary) 50%, var(--light-bg-tertiary) 100%);
  position: relative;
  z-index: 1;
  box-sizing: border-box;
}

.main-content-area::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 200px;
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.03) 0%, transparent 100%);
  pointer-events: none;
  z-index: 0;
}

.view-section {
  max-width: min(1600px, 100%);
  margin: 0 auto;
  padding: var(--space-8) var(--space-8);
  animation: fadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  z-index: 1;
}

/* 战略调研各子页：VI 与可视化容器统一（覆盖局部旧样式） */
.strategy-research-container .sr-view .section-title {
  font-family: var(--font-cn-display);
  color: var(--light-text-primary);
  border-left-color: var(--brand-green-500);
  text-shadow: none;
}

.strategy-research-container .sr-view .section-title::after {
  background: linear-gradient(90deg, var(--brand-green-500), var(--gold-400), transparent);
}

.strategy-research-container .sr-view .section-text {
  color: var(--light-text-secondary);
  font-size: var(--text-base);
  line-height: var(--leading-loose);
}

.strategy-research-container .sr-view .section-text strong {
  color: var(--light-text-primary);
}

.strategy-research-container .sr-view .info-card,
.strategy-research-container .sr-view .chart-card,
.strategy-research-container .sr-view .trend-chart-card {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-xl);
}

.strategy-research-container .sr-view .info-card {
  border-top: 3px solid var(--brand-green-500);
}

.strategy-research-container .sr-view .chart-card::before,
.strategy-research-container .sr-view .trend-chart-card::before {
  background: linear-gradient(90deg, var(--brand-green-500), var(--gold-400));
}

.strategy-research-container .sr-view .chart-title {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  background: none;
  -webkit-background-clip: unset;
  -webkit-text-fill-color: unset;
  background-clip: unset;
  letter-spacing: 0.02em;
  border-left: 3px solid var(--brand-green-400);
  padding-left: var(--space-3);
}

.strategy-research-container .sr-view .chart-container,
.strategy-research-container .sr-view .heatmap-container {
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
}

.strategy-research-container .sr-view .chart-container canvas,
.strategy-research-container .sr-view .heatmap-container canvas {
  display: block;
  max-width: 100%;
}

/* ---------- 行业总览（overview）布局与 VI ---------- */
.strategy-research-container .overview-page .overview-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-5);
  padding: var(--space-3) var(--space-4);
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.strategy-research-container .overview-page .overview-strip-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--brand-green-500);
  color: #fff;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
}

.strategy-research-container .overview-page .overview-strip-dot {
  color: var(--light-text-tertiary);
}

.strategy-research-container .overview-page .overview-body-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: var(--space-6);
  margin-bottom: var(--space-6);
  align-items: start;
}

.strategy-research-container .overview-page .overview-macro-card .section-title {
  margin-bottom: var(--space-3);
}

.strategy-research-container .overview-page .overview-macro-bullets {
  margin: var(--space-4) 0 0;
  padding-left: var(--space-5);
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.strategy-research-container .overview-page .overview-macro-bullets li {
  margin-bottom: var(--space-2);
}

.strategy-research-container .overview-page .overview-macro-bullets strong {
  color: var(--brand-green-700);
}

.strategy-research-container .overview-page .overview-kpi-deck {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  box-shadow: var(--shadow-md);
}

.strategy-research-container .overview-page .overview-kpi-deck-head {
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--light-border-subtle);
}

.strategy-research-container .overview-page .overview-kpi-deck-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-family: var(--font-cn-display), sans-serif;
}

.strategy-research-container .overview-page .overview-kpi-deck-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-normal);
}

.strategy-research-container .overview-page .overview-kpi-grid {
  margin-bottom: 0;
}

.strategy-research-container .overview-page .overview-segments-card .overview-segments-head {
  margin-bottom: var(--space-4);
}

.strategy-research-container .overview-page .overview-segments-lead {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
  max-width: 70ch;
}

.strategy-research-container .overview-page .overview-market-segments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.strategy-research-container .overview-page .command-hero .eyebrow {
  color: rgba(255, 255, 255, 0.78);
}

.strategy-research-container .overview-page .decision-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .strategy-research-container .overview-page .overview-body-grid {
    grid-template-columns: 1fr;
  }

  .strategy-research-container .overview-page .decision-grid {
    grid-template-columns: 1fr;
  }

  .strategy-research-container .overview-page .overview-market-segments {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .strategy-research-container .overview-page .trend-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .strategy-research-container .overview-page .trend-metrics {
    grid-template-columns: 1fr;
  }
}

/* ---------- 3年规划页：KPI、双图、时间轴、资源卡 ---------- */
.strategy-research-container .planning-page .planning-kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.strategy-research-container .planning-page .planning-kpi-card {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  box-shadow: var(--shadow-sm);
  border-top: 3px solid var(--gold-400);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.strategy-research-container .planning-page .planning-kpi-label {
  font-size: var(--text-sm);
  color: var(--light-text-tertiary);
}

.strategy-research-container .planning-page .planning-kpi-value {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.strategy-research-container .planning-page .planning-kpi-sub {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
  line-height: var(--leading-normal);
}

.strategy-research-container .planning-page .planning-phase-track {
  display: flex;
  align-items: stretch;
  margin-bottom: var(--space-8);
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: 1px solid var(--light-border-subtle);
  background: var(--light-bg-secondary);
}

.strategy-research-container .planning-page .planning-phase-node {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--viz-surface);
  min-width: 0;
}

.strategy-research-container .planning-page .planning-phase-node + .planning-phase-node {
  border-left: 1px solid var(--light-border-subtle);
}

.strategy-research-container .planning-page .planning-phase-idx {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background: var(--brand-green-500);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  justify-content: center;
}

.strategy-research-container .planning-page .planning-phase-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.strategy-research-container .planning-page .planning-phase-year {
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .planning-page .planning-phase-theme {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.strategy-research-container .planning-page .planning-charts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.85fr);
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}

.strategy-research-container .planning-page .planning-chart-tall {
  height: min(420px, 58vh);
  min-height: 300px;
}

.strategy-research-container .planning-page .planning-doughnut-wrap {
  height: 260px;
  min-height: 200px;
  position: relative;
  margin: var(--space-2) 0 var(--space-4);
}

.strategy-research-container .planning-page .planning-chart-desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.strategy-research-container .planning-page .planning-chart-desc.compact {
  margin-bottom: var(--space-2);
}

.strategy-research-container .planning-page .planning-chart-foot {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.strategy-research-container .planning-page .planning-capex-mini {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.strategy-research-container .planning-page .planning-capex-mini li {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.strategy-research-container .planning-page .capex-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.strategy-research-container .planning-page .capex-pct {
  font-variant-numeric: tabular-nums;
  color: var(--brand-green-600);
  font-weight: var(--weight-semibold);
}

.strategy-research-container .planning-page .capex-amt {
  font-variant-numeric: tabular-nums;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.strategy-research-container .planning-page .planning-timeline-block {
  margin-bottom: var(--space-8);
}

.strategy-research-container .planning-page .planning-block-title {
  margin-bottom: var(--space-2);
}

.strategy-research-container .planning-page .planning-block-lead {
  margin: 0 0 var(--space-5);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  max-width: 72ch;
  line-height: var(--leading-loose);
}

.strategy-research-container .planning-page .planning-timeline.timeline-container {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
  align-items: start;
  background: transparent;
  padding: 0;
  box-shadow: none;
  margin-bottom: 0;
}

.strategy-research-container .planning-page .timeline-year {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border-left: 4px solid var(--brand-green-500);
  padding: var(--space-5);
}

.strategy-research-container .planning-page .year-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--light-border-subtle);
}

.strategy-research-container .planning-page .year-header h3 {
  margin: 0;
  font-size: var(--text-xl);
  color: var(--light-text-primary);
}

.strategy-research-container .planning-page .year-theme {
  font-size: var(--text-sm);
  color: var(--gold-600);
  font-weight: var(--weight-medium);
}

.strategy-research-container .planning-page .milestone-metrics {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-2);
}

.strategy-research-container .planning-page .milestone-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35em;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--brand-green-50);
  border: 1px solid rgba(45, 106, 79, 0.18);
  font-size: var(--text-xs);
  color: var(--light-text-primary);
  margin: 4px 8px 0 0;
}

.strategy-research-container .planning-page .milestone-chip em {
  font-style: normal;
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  font-size: 0.85em;
}

.strategy-research-container .planning-page .planning-resource-card {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
}

.strategy-research-container .planning-page .planning-resource-head .chart-title {
  margin-bottom: var(--space-2);
}

.strategy-research-container .planning-page .allocation-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .strategy-research-container .planning-page .planning-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1024px) {
  .strategy-research-container .planning-page .planning-charts-grid {
    grid-template-columns: 1fr;
  }

  .strategy-research-container .planning-page .planning-timeline.timeline-container {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .strategy-research-container .planning-page .planning-kpi-strip {
    grid-template-columns: 1fr;
  }

  .strategy-research-container .planning-page .planning-phase-track {
    flex-direction: column;
  }

  .strategy-research-container .planning-page .planning-phase-node + .planning-phase-node {
    border-left: none;
    border-top: 1px solid var(--light-border-subtle);
  }

  .strategy-research-container .planning-page .allocation-grid {
    grid-template-columns: 1fr;
  }
}

/* Custom Scrollbar */
:deep(::-webkit-scrollbar) {
  width: 8px;
}
:deep(::-webkit-scrollbar-track) {
  background: #f5f5f5; 
}
:deep(::-webkit-scrollbar-thumb) {
  background: #ccc; 
  border-radius: 4px;
}
:deep(::-webkit-scrollbar-thumb:hover) {
  background: var(--brand-green-500);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.02);
  }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Info Card - 指数级增强版 */
.info-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px 36px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  border: none;
  margin-bottom: 32px;
  border-top: 4px solid var(--brand-green-500);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.info-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.05), transparent);
  transition: left 0.6s;
}

.info-card:hover::before {
  left: 100%;
}

.info-card:hover {
  box-shadow: 
    0 16px 48px rgba(0, 0, 0, 0.12),
    0 8px 24px rgba(45, 106, 79, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  transform: translateY(-2px);
  border-top-color: var(--gold-400);
}

.section-title {
  font-size: 28px;
  font-weight: 900;
  color: var(--light-text-primary);
  margin-bottom: 20px;
  font-family: inherit;
  border-left: 6px solid var(--brand-green-500);
  padding-left: 20px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  position: relative;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.section-title::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 20px;
  width: 60px;
  height: 3px;
  background: linear-gradient(90deg, #2D6A4F, transparent);
  border-radius: 2px;
}

.section-text {
  color: #4a5568;
  line-height: 1.9;
  font-size: 15px;
  margin: 0;
}

.section-text strong {
  color: #333;
  font-weight: 600;
}

/* KPI Grid - 指数级增强版 */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.kpi-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 24px;
  border-radius: 12px;
  border-left: 5px solid;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.06),
    0 1px 4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.kpi-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.5), transparent);
  opacity: 0;
  transition: opacity 0.4s;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
}

.kpi-card::after {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(45, 106, 79, 0.05) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.4s;
  pointer-events: none;
}

.kpi-card:hover::before {
  opacity: 1;
}

.kpi-card:hover::after {
  opacity: 1;
}

.kpi-card:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 4px 16px rgba(45, 106, 79, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  border-left-width: 6px;
}

.kpi-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.kpi-icon {
  font-size: 20px;
  line-height: 1;
}

.kpi-label {
  font-size: 12px;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  flex: 1;
}

.kpi-value {
  font-size: 32px;
  font-weight: 900;
  background: linear-gradient(135deg, #1a202c 0%, #2d3748 50%, #4a5568 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 10px;
  line-height: 1.2;
  letter-spacing: -1px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  position: relative;
}

.kpi-value::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 40px;
  height: 2px;
  background: linear-gradient(90deg, #2D6A4F, transparent);
  opacity: 0.6;
}

.kpi-trend {
  font-size: 13px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.kpi-detail {
  font-size: 11px;
  color: #a0aec0;
  margin-top: 4px;
}
.kpi-card.sage {
  border-left-color: #7B8C7C;
}

.kpi-card.gold {
  border-left-color: #2D6A4F;
}

.kpi-card.gray {
  border-left-color: #718096;
}

.kpi-card.blue {
  border-left-color: #4299E1;
}

.kpi-card.purple {
  border-left-color: var(--cat-minerals-mid);
}

.kpi-card.green {
  border-left-color: #48BB78;
}

.kpi-trend.positive {
  color: #48BB78;
}

.kpi-trend.info {
  color: #4299E1;
}

/* Chart Card */
/* Chart Card - 指数级增强版 */
.chart-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  margin-bottom: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.chart-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.4s;
  box-shadow: 0 2px 12px rgba(45, 106, 79, 0.4);
}

.chart-card:hover {
  transform: translateY(-4px);
  box-shadow: 
    0 16px 48px rgba(0, 0, 0, 0.12),
    0 8px 24px rgba(45, 106, 79, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  border-color: rgba(45, 106, 79, 0.3);
}

.chart-card:hover::before {
  opacity: 1;
}

.chart-card.full-width {
  grid-column: 1 / -1;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 16px;
  position: relative;
}

.chart-header::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 80px;
  height: 2px;
  background: linear-gradient(90deg, #2D6A4F, transparent);
  border-radius: 1px;
}

.chart-title {
  font-size: 22px;
  font-weight: 800;
  background: linear-gradient(135deg, #1a202c 0%, #2d3748 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: -0.3px;
}

.chart-title::before {
  content: '';
  width: 5px;
  height: 24px;
  background: var(--brand-green-500);
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.4);
  flex-shrink: 0;
}

.chart-actions {
  display: flex;
  gap: 8px;
}

.chart-action-btn {
  width: 36px;
  height: 36px;
  border: 1px solid #e2e8f0;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: #718096;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  position: relative;
  overflow: hidden;
}

.chart-action-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1), rgba(232, 200, 86, 0.1));
  opacity: 0;
  transition: opacity 0.3s;
}

.chart-action-btn:hover {
  background: linear-gradient(135deg, #f7fafc 0%, #ffffff 100%);
  border-color: #2D6A4F;
  color: #2D6A4F;
  transform: translateY(-2px) scale(1.05);
  box-shadow: 
    0 4px 12px rgba(45, 106, 79, 0.2),
    0 2px 6px rgba(0, 0, 0, 0.08);
}

.chart-action-btn:hover::before {
  opacity: 1;
}

.chart-action-btn:active {
  transform: translateY(0) scale(0.98);
}

.chart-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--light-border-subtle);
}

/* 市场关注度趋势模块增强样式 */
.trend-chart-card {
  background: var(--light-bg-elevated);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid var(--light-border-subtle);
  margin-bottom: 32px;
  position: relative;
  overflow: hidden;
}

.trend-chart-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--brand-green-500);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.trend-chart-card .chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 2px solid var(--light-border-subtle);
}

.header-left {
  flex: 1;
}

.chart-subtitle {
  font-size: 14px;
  color: var(--light-text-tertiary);
  margin-top: 8px;
  font-weight: 500;
}

.time-range-selector {
  display: flex;
  gap: 8px;
  margin-right: 12px;
}

.time-range-btn {
  padding: 8px 16px;
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--light-text-secondary);
  cursor: pointer;
  transition: all 0.3s;
}

.time-range-btn:hover {
  background: var(--brand-green-50);
  border-color: var(--brand-green-400);
  color: var(--light-text-primary);
}

.time-range-btn.active {
  background: var(--brand-green-600);
  border-color: var(--brand-green-600);
  color: var(--light-bg-elevated);
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
}

.trend-chart-card .chart-action-btn {
  padding: 8px 12px;
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s;
  margin-left: 8px;
}

.trend-chart-card .chart-action-btn:hover {
  background: var(--brand-green-50);
  border-color: var(--brand-green-400);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

/* 关键指标卡片 */
.trend-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.trend-metric-card {
  background: linear-gradient(135deg, #ffffff 0%, #f7fafc 100%);
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.3s;
  position: relative;
  overflow: hidden;
}

.trend-metric-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.3s;
}

.trend-metric-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  border-color: #2D6A4F;
}

.trend-metric-card:hover::before {
  opacity: 1;
}

.metric-icon {
  font-size: 32px;
  line-height: 1;
  flex-shrink: 0;
}

.metric-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 12px;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.metric-value {
  font-size: 24px;
  font-weight: 800;
  color: #1a202c;
  line-height: 1.2;
}

.metric-change {
  font-size: 12px;
  color: #4a5568;
  font-weight: 600;
}

.metric-change.positive {
  color: #27ae60;
}

.metric-change.negative {
  color: #e74c3c;
}

.trend-chart-card .chart-container {
  margin: 24px 0;
  height: 400px;
  position: relative;
}

.trend-chart-card .chart-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
  border-top: 2px solid #e2e8f0;
}

.chart-footer-right {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-stats {
  font-size: 12px;
  color: #a0aec0;
}

.trend-chart-card .chart-legend {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.trend-chart-card .legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4a5568;
  font-weight: 500;
}

.trend-chart-card .legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 响应式优化 */
@media (max-width: 1200px) {
  .trend-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .trend-chart-card .chart-header {
    flex-direction: column;
    gap: 16px;
  }
  
  .trend-chart-card .chart-actions {
    width: 100%;
    display: flex;
    justify-content: space-between;
  }
}

@media (max-width: 768px) {
  .trend-metrics {
    grid-template-columns: 1fr;
  }
  
  .time-range-selector {
    flex-wrap: wrap;
  }
  
  .chart-footer-right {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}

.chart-legend {
  display: flex;
  gap: 16px;
  align-items: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #4a5568;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.chart-container {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  height: 400px;
}

@media (min-width: 1200px) {
  .chart-container {
    height: 450px;
  }
}

@media (max-width: 768px) {
  .chart-container {
    height: 300px;
  }
}

.chart-note {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  margin: 0 0 var(--space-3);
  font-style: normal;
  line-height: var(--leading-normal);
}

/* 市场细分分析样式 */
.market-segments {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.segment-item {
  padding: 20px;
  background: linear-gradient(135deg, #f7fafc 0%, #ffffff 100%);
  border-radius: 12px;
  border-left: 5px solid #e2e8f0;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  position: relative;
  overflow: hidden;
}

.segment-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 5px;
  height: 100%;
  background: var(--brand-green-500);
  transform: scaleY(0);
  transform-origin: bottom;
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 12px rgba(45, 106, 79, 0.4);
}

.segment-item:hover {
  background: linear-gradient(135deg, #ffffff 0%, #f7fafc 100%);
  transform: translateX(6px) scale(1.01);
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 4px 12px rgba(45, 106, 79, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.segment-item:hover::before {
  transform: scaleY(1);
}

.segment-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.segment-icon {
  font-size: 24px;
  line-height: 1;
}

.segment-name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--light-text-primary);
}

.segment-percent {
  font-size: 18px;
  font-weight: 700;
  color: var(--brand-green-600);
}

.segment-bar {
  height: 10px;
  background: linear-gradient(90deg, var(--light-border-subtle) 0%, var(--light-bg-secondary) 100%);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 10px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
  position: relative;
}

.segment-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  pointer-events: none;
}

.segment-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.segment-fill--primary { background: var(--brand-green-500); }
.segment-fill--sage { background: color-mix(in srgb, var(--brand-green-500) 45%, var(--earth-100)); }
.segment-fill--info { background: var(--semantic-info-icon); }
.segment-fill--gold { background: var(--gold-400); }

.segment-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.3), transparent);
  border-radius: 6px;
}

/* ------------------------------ */
/* 合规专栏 */
/* ------------------------------ */
.compliance-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.compliance-progress .progress-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--light-text-secondary);
  font-size: 13px;
  margin-bottom: 10px;
}

.compliance-progress .progress-num {
  font-weight: 700;
  color: var(--light-text-primary);
}

.progress-bar {
  height: 10px;
  border-radius: 999px;
  background: var(--light-bg-tertiary);
  border: 1px solid var(--light-border-subtle);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-green-500), var(--brand-green-300));
}

.progress-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--light-text-tertiary);
}

.compliance-cards {
  display: grid;
  gap: 12px;
}

.compliance-callout {
  border-radius: 12px;
  padding: 14px 16px;
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
}

.compliance-callout .callout-title {
  font-weight: 700;
  color: var(--light-text-primary);
  margin-bottom: 8px;
}

.compliance-callout ul {
  margin: 0;
  padding-left: 18px;
  color: var(--light-text-secondary);
  line-height: 1.7;
  font-size: 13px;
}

.compliance-callout.danger {
  border-color: rgba(208, 84, 80, 0.35);
  background: var(--semantic-error-bg);
}

.compliance-callout.warning {
  border-color: rgba(196, 165, 90, 0.45);
  background: var(--semantic-warning-bg);
}

.compliance-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.toolbar-right {
  display: inline-flex;
  gap: 10px;
  align-items: center;
}

.compliance-table {
  border: 1px solid var(--light-border-default);
  border-radius: 12px;
  overflow: hidden;
  background: var(--light-bg-elevated);
}

.ct-head,
.ct-row {
  display: grid;
  grid-template-columns: 1.4fr 0.5fr 0.7fr 1.5fr 0.6fr;
  gap: 0;
}

.ct-head {
  background: var(--light-bg-secondary);
  color: var(--light-text-secondary);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--light-border-subtle);
}

.ct-head > div,
.ct-row > div {
  padding: 12px 14px;
  border-right: 1px solid var(--light-border-subtle);
}

.ct-head > div:last-child,
.ct-row > div:last-child {
  border-right: none;
}

.ct-row {
  border-bottom: 1px solid var(--light-border-subtle);
}

.ct-row:last-child {
  border-bottom: none;
}

.ct-title .t1 {
  font-weight: 700;
  color: var(--light-text-primary);
  margin-bottom: 4px;
}

.ct-title .t2 {
  font-size: 12px;
  color: var(--light-text-tertiary);
  line-height: 1.6;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  color: var(--light-text-secondary);
  font-weight: 700;
}

.pill.high {
  border-color: rgba(208, 84, 80, 0.35);
  background: var(--semantic-error-bg);
  color: var(--semantic-error-text);
}

.pill.medium {
  border-color: rgba(196, 165, 90, 0.45);
  background: var(--semantic-warning-bg);
  color: var(--semantic-warning-text);
}

.pill.low {
  border-color: rgba(45, 106, 79, 0.22);
  background: var(--semantic-success-bg);
  color: var(--semantic-success-text);
}

.cell-select,
.cell-input {
  width: 100%;
  border: 1px solid var(--light-border-default);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  background: var(--light-bg-elevated);
  color: var(--light-text-primary);
}

.cell-select:focus,
.cell-input:focus {
  outline: none;
  border-color: var(--brand-green-400);
  box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.12);
}

.ct-evidence ul {
  margin: 0;
  padding-left: 18px;
  color: var(--light-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.compliance-note {
  margin-top: 14px;
  font-size: 12px;
  color: var(--light-text-secondary);
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
  border-radius: 12px;
  padding: 12px 14px;
}

.filter-input {
  border: 1px solid var(--light-border-default);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  background: var(--light-bg-elevated);
  color: var(--light-text-primary);
  min-width: 220px;
}

.filter-input:focus {
  outline: none;
  border-color: var(--brand-green-400);
  box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.12);
}

.species-table {
  border: 1px solid var(--light-border-default);
  border-radius: 12px;
  overflow: hidden;
  background: var(--light-bg-elevated);
}

.st-head,
.st-row {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr 1.1fr 1.2fr 0.35fr;
}

.st-head {
  background: var(--light-bg-secondary);
  color: var(--light-text-secondary);
  font-weight: 700;
  font-size: 12px;
  border-bottom: 1px solid var(--light-border-subtle);
}

.st-head > div,
.st-row > div {
  padding: 12px 14px;
  border-right: 1px solid var(--light-border-subtle);
}

.st-head > div:last-child,
.st-row > div:last-child {
  border-right: none;
}

.st-row {
  border-bottom: 1px solid var(--light-border-subtle);
}

.st-row:last-child {
  border-bottom: none;
}

.st-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.mini-btn {
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  color: var(--light-text-secondary);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.mini-btn.danger {
  border-color: rgba(208, 84, 80, 0.35);
  background: var(--semantic-error-bg);
  color: var(--semantic-error-text);
}

.mini-btn:hover {
  filter: brightness(0.98);
}

.specimen-form,
.proc-form {
  margin-top: 14px;
  border: 1px solid var(--light-border-default);
  border-radius: 12px;
  background: var(--light-bg-elevated);
  padding: 14px;
}

.sf-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.sf-item {
  min-width: 0;
}

.sf-wide {
  grid-column: 1 / -1;
}

.sf-label {
  font-size: 12px;
  color: var(--light-text-tertiary);
  margin-bottom: 6px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.sf-check {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--light-text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.docs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--light-border-subtle);
  border-radius: 10px;
  background: var(--light-bg-secondary);
}

.sf-risk {
  margin-top: 12px;
  border-radius: 12px;
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-secondary);
  padding: 12px 14px;
  color: var(--light-text-secondary);
}

.sf-risk.high {
  border-color: rgba(208, 84, 80, 0.35);
  background: var(--semantic-error-bg);
}

.sf-risk.medium {
  border-color: rgba(196, 165, 90, 0.45);
  background: var(--semantic-warning-bg);
}

.sf-risk.low {
  border-color: rgba(45, 106, 79, 0.22);
  background: var(--semantic-success-bg);
}

.sf-risk-title {
  font-weight: 800;
  color: var(--light-text-primary);
  margin-bottom: 8px;
}

.sf-risk-line {
  font-size: 12px;
  line-height: 1.7;
}

.sf-risk ul {
  margin: 6px 0 0 0;
  padding-left: 18px;
}

.specimen-list,
.proc-list {
  margin-top: 14px;
}

@media (max-width: 1200px) {
  .sf-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .sf-grid {
    grid-template-columns: 1fr;
  }
  .sf-check {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1200px) {
  .compliance-grid {
    grid-template-columns: 1fr;
  }
  .ct-head,
  .ct-row {
    grid-template-columns: 1.4fr 0.6fr 0.8fr 1.3fr 0.7fr;
  }
}

@media (max-width: 768px) {
  .ct-head {
    display: none;
  }
  .ct-row {
    grid-template-columns: 1fr;
  }
  .ct-row > div {
    border-right: none;
    border-bottom: 1px solid var(--light-border-subtle);
  }
  .ct-row > div:last-child {
    border-bottom: none;
  }

  .filter-input {
    min-width: 0;
    width: 100%;
  }

  .st-head {
    display: none;
  }

  .st-row {
    grid-template-columns: 1fr;
  }

  .st-row > div {
    border-right: none;
    border-bottom: 1px solid var(--light-border-subtle);
  }

  .st-row > div:last-child {
    border-bottom: none;
  }
}

.segment-detail {
  font-size: 12px;
  color: #718096;
  display: flex;
  gap: 16px;
}

.chart-legend {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  font-size: 12px;
  color: #718096;
}

.legend-tag {
  padding: 4px 12px;
  background: #EDF2F7;
  border-radius: 4px;
  font-weight: 600;
}

/* Supply Chain */
.supply-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 24px;
}

@media (max-width: 1024px) {
  .supply-grid {
    grid-template-columns: 1fr;
  }
}

.supply-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
}

.control-title {
  font-weight: 700;
  color: #333;
  margin-bottom: 12px;
}

.filter-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-btn {
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  border-radius: 6px;
  background: #EDF2F7;
  border: none;
  color: #333;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: #E2E8F0;
}

.filter-btn.active {
  background-color: #2D6A4F;
  color: #000;
  font-weight: 600;
}

.insight-card {
  background: #FDFBF7;
  padding: 20px;
  border-radius: 8px;
  border: none;
  min-height: 200px;
  max-height: 300px;
  overflow-y: auto;
}

.insight-title {
  font-weight: 700;
  color: #2D6A4F;
  margin-bottom: 8px;
}

.insight-text {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}

/* Products */
.products-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 1024px) {
  .products-grid {
    grid-template-columns: 1fr;
  }
}

.product-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.product-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
  border-left: 4px solid;
}

.product-card.gold-border {
  border-left-color: #c4a55a;
}

.product-card.blue-border {
  border-left-color: #c9a02d;
}

.product-card.green-border {
  border-left-color: #48BB78;
}

.product-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.product-title {
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 8px;
}

.product-desc {
  font-size: 14px;
  color: #666;
}

.product-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 4px;
}

.product-badge.gold {
  background: #FDF6E3;
  color: #c4a55a;
}

.product-badge.blue {
  background: #EBF8FF;
  color: #2B6CB0;
}

.product-badge.green {
  background: #F0FFF4;
  color: #2F855A;
}

.product-actions {
  margin-top: 12px;
  font-size: 14px;
  color: #718096;
}

.product-actions p {
  margin: 4px 0;
}

/* Channels */
.channels-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 1024px) {
  .channels-grid {
    grid-template-columns: 1fr;
  }
}

.channels-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.priority-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
}

.priority-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin-bottom: 16px;
}

.priority-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.priority-item {
  margin-bottom: 16px;
}

.priority-header {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  margin-bottom: 8px;
}

.priority-name {
  font-weight: 600;
}

.priority-rating {
  color: #48BB78;
}

.progress-bar {
  width: 100%;
  background: #E2E8F0;
  border-radius: 4px;
  height: 10px;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
}

.progress-fill.sage {
  background: #2D6A4F;
}

.progress-fill.gold {
  background: #c4a55a;
}

.progress-fill.blue {
  background: #4299E1;
}

.priority-note {
  font-size: 12px;
  color: #718096;
}

.action-plan-card {
  background: #EFEFEA;
  padding: 20px;
  border-radius: 8px;
  border: 1px dashed #A0AEC0;
}

.action-title {
  font-weight: 700;
  color: #333;
  margin-bottom: 12px;
}

.action-list {
  list-style: disc;
  list-style-position: inside;
  font-size: 14px;
  color: #333;
  line-height: 1.8;
}

.action-list li {
  margin-bottom: 8px;
}

.action-list strong {
  color: #333;
}

/* ==================== 新功能样式（简化版） ==================== */
.supply-chain-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
.full-width { grid-column: 1 / -1; }
.supply-map-container { display: grid; grid-template-columns: 1fr 2fr; gap: 24px; }
.chart-metrics { display: flex; gap: 24px; justify-content: center; margin-top: 16px; padding: 16px; background: #F7FAFC; border-radius: 8px; }
.metric-item { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.metric-label { font-size: 12px; color: #718096; }
.metric-value { font-size: 20px; font-weight: 700; color: #333; }
.metric-value.highlight { color: #2D6A4F; font-size: 24px; }
.value-chain-card, .competitor-card, .swot-matrix-card, .control-panel, .profit-metrics-grid, .pyramid-container, .funnel-container, .store-design-grid, .display-design-card, .timeline-container, .resource-allocation-card { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05); margin-bottom: 24px; }
.value-chain-visual, .chain-stage, .competitor-grid, .competitor-list, .swot-matrix, .swot-quadrant, .profit-simulation-grid, .pyramid-visual, .pyramid-products, .channel-comparison-grid, .channel-card, .store-layout-visual, .display-zones, .year-milestones, .allocation-grid { display: flex; gap: 16px; }
.competitor-grid, .profit-simulation-grid, .pyramid-container, .store-design-grid, .channel-comparison-grid, .allocation-grid, .display-zones { display: grid; gap: 20px; }
.competitor-grid { grid-template-columns: 1fr 1fr; }
.profit-simulation-grid { grid-template-columns: 300px 1fr; }
.pyramid-container, .store-design-grid { grid-template-columns: 1fr 1fr; }
.channel-comparison-grid, .allocation-grid, .display-zones { grid-template-columns: repeat(2, 1fr); }
.swot-matrix { grid-template-columns: 1fr 1fr; grid-gap: 16px; }
.pyramid-visual,
.pyramid-products,
.value-chain-visual,
.competitor-list,
.year-milestones {
  flex-direction: column;
}

.pyramid-products {
  align-items: stretch;
}

.layer-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.layer-name {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.layer-icon {
  font-size: 1.75rem;
  line-height: 1;
}

.product-pyramid-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}

.pyramid-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.pyramid-card-header h4 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.pyramid-card-body p {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}
.profit-metrics-grid { grid-template-columns: repeat(4, 1fr); }
.metric-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05); text-align: center; border-left: 4px solid; }
.metric-card.revenue { border-left-color: #2D6A4F; }
.metric-card.cost { border-left-color: #E53E3E; }
.metric-card.profit { border-left-color: #38A169; }
.metric-card.margin { border-left-color: #3182CE; }
.metric-large-value { font-size: 28px; font-weight: 700; color: #333; margin: 12px 0; }
.param-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.param-group label { font-size: 13px; color: #666; font-weight: 600; }
.param-group input[type="range"] { width: 100%; }
.param-group span { font-size: 14px; font-weight: 600; color: #2D6A4F; }
.pyramid-layer, .competitor-card, .channel-card, .display-zone-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05); }
.pyramid-layer { border: 2px solid #2D6A4F; }
.competitor-card { border-left: 4px solid #2D6A4F; }
.channel-card { border-left: 4px solid #2D6A4F; }
.display-zone-card { border-left: 4px solid #2D6A4F; }
.store-layout-visual { position: relative; width: 100%; height: 500px; background: #F7FAFC; border-radius: 8px; border: 2px solid #E2E8F0; }
.store-zone { position: absolute; background: white; border: 2px solid #2D6A4F; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); }
.timeline-year { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05); border-left: 5px solid #2D6A4F; }
.milestone-card { display: flex; gap: 16px; position: relative; padding-left: 32px; }
.milestone-dot { position: absolute; left: 0; top: 8px; width: 16px; height: 16px; background: #2D6A4F; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #2D6A4F; }
/* SWOT 四象限矩阵样式 */
.swot-matrix-container {
  position: relative;
  width: 100%;
  padding: 20px 0 60px 60px; /* 为坐标轴标签留出空间 */
}

.swot-matrix-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0;
  border: 3px solid #2d3748;
  border-radius: 12px;
  overflow: hidden;
  background: #f7fafc;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.swot-quadrant {
  padding: 28px 24px;
  position: relative;
  display: flex;
  flex-direction: column;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-right: 2px solid #e2e8f0;
  border-bottom: 2px solid #e2e8f0;
}

.swot-quadrant:nth-child(2n) {
  border-right: none;
}

.swot-quadrant:nth-child(n+3) {
  border-bottom: none;
}

.swot-quadrant:hover {
  transform: scale(1.02);
  z-index: 10;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
}

.quadrant-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(0, 0, 0, 0.1);
}

.quadrant-icon {
  font-size: 32px;
  line-height: 1;
}

.quadrant-header h4 {
  flex: 1;
  font-size: 20px;
  font-weight: 800;
  margin: 0;
  color: #1a202c;
  letter-spacing: -0.5px;
}

.quadrant-subtitle {
  font-size: 12px;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

.quadrant-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}

.quadrant-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: #2d3748;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.quadrant-list li:hover {
  background: rgba(255, 255, 255, 0.9);
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.list-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.8);
}

/* 优势象限 - 绿色系 */
.swot-quadrant.strength {
  background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%);
  border-color: #48bb78;
}

.swot-quadrant.strength .quadrant-header {
  border-bottom-color: rgba(72, 187, 120, 0.3);
}

.swot-quadrant.strength .list-icon {
  background: #48bb78;
  color: white;
}

.swot-quadrant.strength .quadrant-list li {
  border-left-color: #48bb78;
}

/* 劣势象限 - 红色系 */
.swot-quadrant.weakness {
  background: linear-gradient(135deg, #fff5f5 0%, #fed7d7 100%);
  border-color: #fc8181;
}

.swot-quadrant.weakness .quadrant-header {
  border-bottom-color: rgba(252, 129, 129, 0.3);
}

.swot-quadrant.weakness .list-icon {
  background: #fc8181;
  color: white;
}

.swot-quadrant.weakness .quadrant-list li {
  border-left-color: #fc8181;
}

/* 机会象限 - 蓝色系 */
.swot-quadrant.opportunity {
  background: linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%);
  border-color: #63b3ed;
}

.swot-quadrant.opportunity .quadrant-header {
  border-bottom-color: rgba(99, 179, 237, 0.3);
}

.swot-quadrant.opportunity .list-icon {
  background: #63b3ed;
  color: white;
}

.swot-quadrant.opportunity .quadrant-list li {
  border-left-color: #63b3ed;
}

/* 威胁象限 - 黄色系 */
.swot-quadrant.threat {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border-color: #f6e05e;
}

.swot-quadrant.threat .quadrant-header {
  border-bottom-color: rgba(246, 224, 94, 0.3);
}

.swot-quadrant.threat .list-icon {
  background: #f6e05e;
  color: #744210;
}

.swot-quadrant.threat .quadrant-list li {
  border-left-color: #f6e05e;
}

/* 坐标轴标签 */
.swot-axis-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.axis-label-y {
  position: absolute;
  left: -50px;
  top: 50%;
  transform: translateY(-50%) rotate(-90deg);
  font-size: 14px;
  font-weight: 700;
  color: #4a5568;
  letter-spacing: 2px;
  white-space: nowrap;
}

.axis-label-x {
  position: absolute;
  bottom: -40px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  font-weight: 700;
  color: #4a5568;
  letter-spacing: 2px;
}

/* 响应式优化 */
@media (max-width: 1200px) {
  .swot-matrix-container {
    padding: 20px 0 50px 50px;
  }
  
  .swot-quadrant {
    padding: 20px 16px;
  }
  
  .quadrant-header h4 {
    font-size: 18px;
  }
  
  .quadrant-list li {
    font-size: 13px;
    padding: 8px 10px;
  }
}

@media (max-width: 768px) {
  .swot-matrix-grid {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(4, auto);
  }
  
  .swot-quadrant {
    border-right: none;
    border-bottom: 2px solid #e2e8f0;
  }
  
  .swot-quadrant:last-child {
    border-bottom: none;
  }
  
  .swot-matrix-container {
    padding: 20px 0 40px 0;
  }
  
  .axis-label-y {
    display: none;
  }
  
  .axis-label-x {
    display: none;
  }
}
/* 响应式设计 - 增强版 */
@media (max-width: 1400px) {
  .view-section {
    max-width: 100%;
    padding: 24px 20px;
  }
  
  .kpi-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
}

/* 爆品生成器样式 */
.generator-control-panel {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  margin-bottom: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
}

.control-section {
  margin-bottom: 32px;
}

.control-section:last-child {
  margin-bottom: 0;
}

.control-section-title {
  font-size: 18px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-section-title::before {
  content: '';
  width: 4px;
  height: 20px;
  background: var(--brand-green-500);
  border-radius: 2px;
}

.product-type-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.type-select-btn {
  padding: 20px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.type-select-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.05), rgba(232, 200, 86, 0.05));
  opacity: 0;
  transition: opacity 0.3s;
}

.type-select-btn:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(45, 106, 79, 0.15);
  border-color: #2D6A4F;
}

.type-select-btn:hover::before {
  opacity: 1;
}

.type-select-btn.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1), rgba(232, 200, 86, 0.05));
  border-color: #2D6A4F;
  box-shadow: 
    0 8px 24px rgba(45, 106, 79, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.type-icon {
  font-size: 36px;
  line-height: 1;
}

.type-name {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
}

.type-desc {
  font-size: 12px;
  color: #718096;
}

.generator-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-group label {
  font-size: 14px;
  font-weight: 600;
  color: #4a5568;
}

.option-select {
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: white;
  font-size: 14px;
  color: #2d3748;
  cursor: pointer;
  transition: all 0.3s;
}

.option-select:hover {
  border-color: #2D6A4F;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.1);
}

.option-select:focus {
  outline: none;
  border-color: #2D6A4F;
  box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.1);
}

.generate-action {
  display: flex;
  justify-content: center;
  margin-top: 32px;
  padding-top: 32px;
  border-top: 2px solid #e2e8f0;
}

.generate-btn {
  padding: 16px 48px;
  background: var(--brand-green-600);
  border: none;
  border-radius: 12px;
  color: #000;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 
    0 4px 16px rgba(45, 106, 79, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  position: relative;
  overflow: hidden;
}

.generate-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 
    0 8px 32px rgba(45, 106, 79, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.generate-btn:hover:not(:disabled)::before {
  opacity: 1;
}

.generate-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}

.generate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 生成结果卡片 */
.generated-concept-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 40px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  margin-bottom: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  animation: fadeIn 0.5s ease;
}

.concept-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 2px solid #e2e8f0;
}

.concept-title {
  font-size: 28px;
  font-weight: 900;
  background: linear-gradient(135deg, #1a202c 0%, #2d3748 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
}

.regenerate-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #f7fafc 0%, #ffffff 100%);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #4a5568;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.regenerate-btn:hover {
  background: linear-gradient(135deg, #ffffff 0%, #f7fafc 100%);
  border-color: #2D6A4F;
  color: #2D6A4F;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

.concept-content {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.concept-section {
  padding: 24px;
  background: #f7fafc;
  border-radius: 12px;
  border-left: 4px solid #2D6A4F;
}

.concept-section-title {
  font-size: 18px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.concept-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-label {
  font-size: 12px;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.info-value {
  font-size: 18px;
  font-weight: 700;
  color: #2d3748;
}

.info-value.highlight {
  color: #2D6A4F;
  font-size: 24px;
}

.concept-text {
  font-size: 15px;
  line-height: 1.8;
  color: #4a5568;
}

.selling-points {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.selling-points li {
  padding: 12px 16px;
  background: white;
  border-radius: 8px;
  border-left: 3px solid #2D6A4F;
  font-size: 14px;
  color: #2d3748;
  line-height: 1.6;
  position: relative;
  padding-left: 24px;
}

.selling-points li::before {
  content: '✓';
  position: absolute;
  left: 8px;
  color: #2D6A4F;
  font-weight: bold;
}

/* 历史记录 */
.concept-history {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(226, 232, 240, 0.8);
}

.history-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e2e8f0;
}

.history-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.history-item {
  padding: 16px;
  background: #f7fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  cursor: pointer;
  transition: all 0.3s;
}

.history-item:hover {
  background: white;
  border-color: #2D6A4F;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

.history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-name {
  font-size: 15px;
  font-weight: 600;
  color: #2d3748;
}

.history-type {
  font-size: 12px;
  padding: 4px 10px;
  background: rgba(45, 106, 79, 0.1);
  color: #2D6A4F;
  border-radius: 4px;
  font-weight: 600;
}

.history-item-price {
  font-size: 18px;
  font-weight: 700;
  color: #2D6A4F;
}

@media (max-width: 1200px) { 
  .competitor-grid, 
  .profit-simulation-grid, 
  .pyramid-container, 
  .store-design-grid, 
  .channel-comparison-grid, 
  .allocation-grid, 
  .display-zones, 
  .supply-map-container { 
    grid-template-columns: 1fr; 
  }
  
  .internal-nav {
    width: 220px;
  }
  
  .chart-container {
    height: 300px;
  }
  
  .product-type-selector {
    grid-template-columns: 1fr;
  }
  
  .generator-options {
    grid-template-columns: 1fr;
  }
}

/* ---------- 盈利模拟页（升级版布局与组件） ---------- */
.profit-page {
  padding-bottom: var(--space-10);
}

.profit-hero {
  margin-bottom: var(--space-6);
  padding: var(--space-6) var(--space-6);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(196, 165, 90, 0.1) 100%);
  border: 1px solid var(--light-border-subtle);
}

.profit-eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-green-600);
}

.profit-hero-title {
  margin: 0 0 var(--space-2);
  font-size: clamp(var(--text-xl), 2vw, var(--text-3xl));
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
}

.profit-hero-lead {
  margin: 0 0 var(--space-5);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
  max-width: 52rem;
}

.profit-scenarios {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.profit-scenario-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  min-width: 140px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.profit-scenario-btn:hover {
  border-color: var(--brand-green-400);
  box-shadow: var(--shadow-sm);
}

.profit-scenario-btn.active {
  border-color: var(--brand-green-500);
  box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.18);
  background: rgba(45, 106, 79, 0.06);
}

.profit-scenario-btn .ps-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.profit-scenario-btn .ps-desc {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-tight);
}

.profit-scenario-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.profit-layout {
  display: grid;
  grid-template-columns: min(320px, 100%) 1fr;
  gap: var(--space-6);
  align-items: start;
}

.profit-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.profit-panel {
  border-radius: var(--radius-xl);
  border: 1px solid var(--light-border-subtle);
  background: var(--light-bg-elevated);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}

.profit-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.profit-panel-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.profit-reset-btn {
  font-size: var(--text-xs);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-secondary);
  color: var(--light-text-secondary);
  cursor: pointer;
}

.profit-reset-btn:hover {
  border-color: var(--brand-green-400);
  color: var(--brand-green-700);
}

.profit-param {
  margin-bottom: var(--space-4);
}

.profit-param-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--space-2);
}

.profit-param-top label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--light-text-secondary);
}

.profit-param-val {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  font-variant-numeric: tabular-nums;
}

.profit-range {
  width: 100%;
  accent-color: var(--brand-green-500);
}

.profit-param-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.profit-formula-note {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px dashed var(--light-border-default);
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-loose);
}

.profit-panel-insight.level-good {
  border-left: 4px solid var(--semantic-success-icon);
}

.profit-panel-insight.level-warn {
  border-left: 4px solid var(--semantic-warning-icon);
}

.profit-panel-insight.level-weak {
  border-left: 4px solid var(--gold-400);
}

.profit-panel-insight.level-bad {
  border-left: 4px solid var(--semantic-error-icon);
}

.profit-health-main {
  margin: 0 0 var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.profit-health-sub {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.profit-dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.profit-dl > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

.profit-dl dt {
  color: var(--light-text-tertiary);
  font-weight: var(--weight-medium);
}

.profit-dl dd {
  margin: 0;
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-variant-numeric: tabular-nums;
}

.profit-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.profit-chart-card .chart-card-head {
  margin-bottom: var(--space-2);
}

.profit-chart-canvas-wrap {
  height: min(420px, 48vh);
  min-height: 280px;
}

.profit-waterfall-card {
  border-radius: var(--radius-xl);
  border: 1px solid var(--light-border-subtle);
  background: var(--light-bg-elevated);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}

.profit-waterfall-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.profit-stack-bar {
  display: flex;
  height: 40px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--light-bg-tertiary);
}

.profit-stack-bar .seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 var(--space-1);
  transition: width 0.35s var(--ease-out-soft);
}

.profit-stack-bar .seg-fixed {
  background: linear-gradient(90deg, var(--brand-green-600), var(--brand-green-500));
}

.profit-stack-bar .seg-variable {
  background: linear-gradient(90deg, #b8403c, var(--semantic-error-icon));
}

.profit-stack-bar .seg-profit {
  background: linear-gradient(90deg, var(--semantic-success-text), var(--semantic-success-icon));
}

.profit-stack-bar .seg-profit.neg {
  background: var(--light-border-strong);
}

.profit-loss-cap {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.profit-legend {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.profit-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.profit-legend .dot.fixed {
  background: var(--brand-green-500);
}

.profit-legend .dot.variable {
  background: var(--semantic-error-icon);
}

.profit-legend .dot.profit {
  background: var(--semantic-success-icon);
}

.profit-page .profit-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(152px, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  border: none;
}

.profit-page .metric-card.muted {
  border-left-color: var(--light-border-strong);
}

.profit-page .metric-card.muted .metric-large-value {
  color: var(--light-text-primary);
}

@media (max-width: 1100px) {
  .profit-layout {
    grid-template-columns: 1fr;
  }
}

/* 加载动画 */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 16px;
  border: 2px dashed #e2e8f0;
  margin: 32px 0;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #e2e8f0;
  border-top-color: #2D6A4F;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 15px;
  color: #718096;
  font-weight: 600;
  margin: 0;
}

/* 导出按钮样式 */
.concept-actions,
.result-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.export-btn,
.export-btn-small {
  padding: 10px 20px;
  background: linear-gradient(135deg, #f7fafc 0%, #ffffff 100%);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #4a5568;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.export-btn-small {
  padding: 8px 16px;
  font-size: 13px;
}

.export-btn:hover,
.export-btn-small:hover {
  background: linear-gradient(135deg, #ffffff 0%, #f7fafc 100%);
  border-color: #2D6A4F;
  color: #2D6A4F;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.15);
}

/* 展陈空间设计师样式 */
.spatial-designer-section {
  margin-top: 40px;
}

.spatial-designer-panel {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  margin-bottom: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
}

.designer-controls {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
  padding-bottom: 12px;
  border-bottom: 2px solid #e2e8f0;
}

.zone-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.zone-btn {
  padding: 16px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: center;
}

.zone-btn:hover {
  border-color: #2D6A4F;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

.zone-btn.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1), rgba(232, 200, 86, 0.05));
  border-color: #2D6A4F;
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.2);
}

.zone-btn span:first-child {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
}

.zone-desc-small {
  font-size: 12px;
  color: #718096;
}

.optimization-goals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.goal-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f7fafc;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.goal-checkbox:hover {
  background: #edf2f7;
}

.goal-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #2D6A4F;
}

.generate-design-btn {
  padding: 14px 40px;
  background: var(--brand-green-600);
  border: none;
  border-radius: 10px;
  color: #000;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 
    0 4px 16px rgba(45, 106, 79, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  align-self: center;
}

.generate-design-btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 
    0 8px 32px rgba(45, 106, 79, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.generate-design-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spatial-design-result {
  margin-top: 32px;
  padding: 32px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  animation: fadeIn 0.5s ease;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e2e8f0;
}

.result-title {
  font-size: 22px;
  font-weight: 700;
  background: linear-gradient(135deg, #1a202c 0%, #2d3748 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
}

.regenerate-btn-small {
  padding: 8px 16px;
  background: linear-gradient(135deg, #f7fafc 0%, #ffffff 100%);
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #4a5568;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.regenerate-btn-small:hover {
  border-color: #2D6A4F;
  color: #2D6A4F;
  transform: translateY(-1px);
}

.design-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.design-section {
  padding: 20px;
  background: #f7fafc;
  border-radius: 10px;
  border-left: 4px solid #2D6A4F;
}

.design-section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 12px;
}

.design-text {
  font-size: 14px;
  line-height: 1.8;
  color: #4a5568;
}

.design-solutions {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.design-solutions li {
  padding: 12px 16px;
  background: white;
  border-radius: 8px;
  border-left: 3px solid #2D6A4F;
  font-size: 14px;
  color: #2d3748;
  line-height: 1.6;
  position: relative;
  padding-left: 24px;
}

.design-solutions li::before {
  content: '💡';
  position: absolute;
  left: 8px;
}

.design-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: step-counter;
}

.design-steps li {
  counter-increment: step-counter;
  padding: 14px 16px;
  background: white;
  border-radius: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  color: #2d3748;
  line-height: 1.6;
  position: relative;
  padding-left: 48px;
}

.design-steps li::before {
  content: counter(step-counter);
  position: absolute;
  left: 16px;
  width: 24px;
  height: 24px;
  background: var(--brand-green-600);
  color: #000;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
}

/* 金牌销售话术样式 */
.sales-script-section {
  margin-top: 40px;
}

.sales-script-panel {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  margin-bottom: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
}

.script-controls {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.channel-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.channel-btn {
  padding: 14px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.channel-btn:hover {
  border-color: #2D6A4F;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

.channel-btn.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1), rgba(232, 200, 86, 0.05));
  border-color: #2D6A4F;
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.2);
}

.channel-icon-small {
  font-size: 20px;
}

.stage-selector {
  width: 100%;
}

.stage-select {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: white;
  font-size: 14px;
  color: #2d3748;
  cursor: pointer;
  transition: all 0.3s;
}

.stage-select:hover {
  border-color: #2D6A4F;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.1);
}

.stage-select:focus {
  outline: none;
  border-color: #2D6A4F;
  box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.1);
}

.script-type-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.type-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f7fafc;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.type-radio:hover {
  background: #edf2f7;
}

.type-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #2D6A4F;
}

.generate-script-btn {
  padding: 14px 40px;
  background: var(--brand-green-600);
  border: none;
  border-radius: 10px;
  color: #000;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 
    0 4px 16px rgba(45, 106, 79, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  align-self: center;
}

.generate-script-btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 
    0 8px 32px rgba(45, 106, 79, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.generate-script-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sales-script-result {
  margin-top: 32px;
  padding: 32px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  animation: fadeIn 0.5s ease;
}

.script-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.script-section {
  padding: 20px;
  background: #f7fafc;
  border-radius: 10px;
  border-left: 4px solid #2D6A4F;
}

.script-section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 12px;
}

.script-text {
  font-size: 14px;
  line-height: 1.8;
  color: #4a5568;
}

.script-dialogue {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialogue-item {
  padding: 16px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.dialogue-scenario {
  font-size: 13px;
  color: #718096;
  margin-bottom: 8px;
  font-weight: 600;
}

.dialogue-script {
  font-size: 14px;
  line-height: 1.8;
  color: #2d3748;
  padding: 12px;
  background: #f7fafc;
  border-radius: 6px;
  border-left: 3px solid #2D6A4F;
  margin-bottom: 8px;
}

.dialogue-tips {
  font-size: 12px;
  color: #4a5568;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

.script-points {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.script-points li {
  padding: 12px 16px;
  background: white;
  border-radius: 8px;
  border-left: 3px solid #2D6A4F;
  font-size: 14px;
  color: #2d3748;
  line-height: 1.6;
  position: relative;
  padding-left: 32px;
}

.script-points li::before {
  content: '✓';
  position: absolute;
  left: 12px;
  color: #2D6A4F;
  font-weight: bold;
}

@media (max-width: 768px) {
  .strategy-research-container {
    flex-direction: column;
  }
  
  .internal-nav {
    width: 100%;
    height: auto;
    position: relative;
    border-right: none;
    border-bottom: 1px solid #E2E8F0;
  }
  
  .nav-tabs {
    display: flex;
    overflow-x: auto;
    padding: 12px;
    gap: 8px;
  }
  
  .nav-tab {
    white-space: nowrap;
    padding: 10px 16px;
    border-right: none;
    border-bottom: 3px solid transparent;
  }
  
  .nav-tab.active {
    border-right: none;
    border-bottom-color: #2D6A4F;
  }
  
  .view-section {
    padding: 20px 16px;
  }
  
  .kpi-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  .kpi-card {
    padding: 16px;
  }
  
  .chart-card {
    padding: 20px;
  }
  
  .chart-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .chart-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .info-card {
    padding: 20px;
  }
  
  .section-title {
    font-size: 22px;
  }
}

/* AI用研结论样式 */
.research-filters {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  font-size: 14px;
  color: #4a5568;
  font-weight: 500;
}

.filter-select {
  padding: 8px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  color: #2d3748;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-select:hover {
  border-color: #2D6A4F;
}

.filter-select:focus {
  outline: none;
  border-color: #2D6A4F;
  box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.1);
}

.refresh-btn {
  padding: 8px 20px;
  background: var(--brand-green-600);
  color: #000;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.refresh-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.3);
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: #718096;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 4px solid #e2e8f0;
  border-top-color: #2D6A4F;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.research-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.research-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.research-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.research-card.expanded {
  border-color: #2D6A4F;
  box-shadow: 0 4px 20px rgba(45, 106, 79, 0.15);
}

.research-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  cursor: pointer;
  background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%);
}

.research-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.research-type-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.research-type-badge.type-market {
  background: rgba(66, 153, 225, 0.1);
  color: #3182ce;
}

.research-type-badge.type-user {
  background: rgba(72, 187, 120, 0.1);
  color: #2f855a;
}

.research-type-badge.type-competitor {
  background: rgba(245, 101, 101, 0.1);
  color: #c53030;
}

.research-type-badge.type-trend {
  background: rgba(159, 122, 234, 0.1);
  color: #6b46c1;
}

.research-type-badge.type-product {
  background: rgba(45, 106, 79, 0.1);
  color: #b7791f;
}

.research-topic {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1a202c;
  flex: 1;
}

.research-header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.research-date {
  font-size: 13px;
  color: #718096;
}

.expand-icon {
  font-size: 12px;
  color: #718096;
  transition: transform 0.3s;
}

.research-summary {
  padding: 0 20px 20px;
  color: #4a5568;
  line-height: 1.6;
  font-size: 14px;
}

.research-content {
  padding: 0 20px 20px;
  border-top: 1px solid #e2e8f0;
}

.research-section {
  margin-top: 24px;
}

.research-section h4 {
  font-size: 16px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #2D6A4F;
}

.research-section p {
  color: #4a5568;
  line-height: 1.8;
  margin: 0;
}

.findings-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.findings-list li {
  padding: 12px 16px;
  margin-bottom: 8px;
  background: rgba(45, 106, 79, 0.05);
  border-left: 4px solid #2D6A4F;
  border-radius: 4px;
  color: #2d3748;
  line-height: 1.6;
}

.research-detail {
  color: #4a5568;
  line-height: 1.8;
}

.research-detail :deep(h1),
.research-detail :deep(h2),
.research-detail :deep(h3) {
  color: #1a202c;
  margin-top: 24px;
  margin-bottom: 12px;
}

.research-detail :deep(h1) {
  font-size: 24px;
  border-bottom: 2px solid #2D6A4F;
  padding-bottom: 8px;
}

.research-detail :deep(h2) {
  font-size: 20px;
}

.research-detail :deep(h3) {
  font-size: 18px;
}

.research-detail :deep(ul),
.research-detail :deep(ol) {
  padding-left: 24px;
  margin: 12px 0;
}

.research-detail :deep(li) {
  margin-bottom: 8px;
}

.research-detail :deep(p) {
  margin-bottom: 12px;
}

.research-actions {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  gap: 12px;
}

.export-btn-small {
  padding: 8px 16px;
  background: var(--brand-green-600);
  color: #000;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 13px;
}

.export-btn-small:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.3);
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border-radius: 12px;
  border: 2px dashed #e2e8f0;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.empty-state h3 {
  font-size: 20px;
  color: #2d3748;
  margin-bottom: 12px;
}

.empty-state p {
  color: #718096;
  font-size: 14px;
  line-height: 1.6;
}

/* ---------- 战略调研看板 · VI 字号/排版/交互/可视化（覆盖层）---------- */
.strategy-research-container.is-fullscreen {
  background: var(--light-bg-primary);
}

.brand-subtitle {
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  color: var(--light-text-tertiary);
}

.brand-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.nav-tab-icon {
  flex-shrink: 0;
  width: 1.5em;
  text-align: center;
  opacity: 0.92;
}

.nav-tab-label {
  flex: 1;
  min-width: 0;
}

.nav-tab:hover {
  transform: translateX(2px);
}

.nav-tab:focus-visible {
  outline: 2px solid var(--brand-green-500);
  outline-offset: 2px;
}

.nav-action-btn {
  font-size: var(--text-xs);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--light-text-secondary);
}

.nav-action-btn.primary {
  color: var(--brand-green-800);
  font-weight: var(--weight-semibold);
}

.nav-action-btn:focus-visible {
  outline: 2px solid var(--brand-green-500);
  outline-offset: 1px;
}

.command-hero {
  align-items: flex-start;
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-xl);
  color: var(--light-text-primary);
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  box-shadow: var(--shadow-sm);
  border-left: 4px solid var(--gold-400);
  position: relative;
  overflow: hidden;
}

.command-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(45, 106, 79, 0.04) 0%, transparent 42%);
  pointer-events: none;
}

.command-hero-text {
  position: relative;
  z-index: 1;
  max-width: min(52rem, 100%);
}

.command-hero h2.command-hero-title {
  margin: var(--space-1) 0 var(--space-2);
  font-size: clamp(var(--text-xl), 2.2vw, var(--text-3xl));
  font-weight: var(--weight-semibold);
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  color: var(--brand-green-800);
  letter-spacing: -0.02em;
}

.command-hero p.command-hero-lead {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.command-hero .eyebrow {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  color: var(--brand-green-600);
  text-transform: none;
}

.command-hero-cta {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  margin-top: var(--space-1);
}

.command-grid {
  gap: var(--space-3);
}

.command-card {
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

.command-label {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.command-value {
  font-size: clamp(var(--text-xl), 2vw, var(--text-3xl));
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--light-text-primary);
}

.command-desc {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
}

.panel-title {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  margin-bottom: var(--space-1);
}

.panel-subtitle {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-tight);
}

.decision-grid {
  gap: var(--space-3);
}

@media (max-width: 1100px) {
  .decision-grid {
    grid-template-columns: 1fr;
  }
}

.decision-item strong {
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.view-section {
  padding: var(--space-6) var(--space-5);
  max-width: min(1600px, 100%);
}

@media (max-width: 768px) {
  .view-section {
    padding: var(--space-4) var(--space-3);
  }
}

.section-title {
  font-size: clamp(var(--text-xl), 2vw, var(--text-2xl));
  font-weight: var(--weight-semibold);
  margin-bottom: var(--space-4);
  text-shadow: none;
}

.section-text {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.kpi-grid {
  gap: var(--space-4);
}

.kpi-card {
  border-radius: var(--radius-lg);
}

.kpi-card:hover {
  transform: translateY(-2px);
}

.kpi-value {
  font-size: clamp(var(--text-xl), 2.4vw, var(--text-3xl));
  font-weight: var(--weight-semibold);
  -webkit-text-fill-color: unset;
  background: none;
  color: var(--light-text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.kpi-value::after {
  display: none;
}

.kpi-label {
  font-size: var(--text-xs);
  text-transform: none;
  letter-spacing: 0.02em;
  color: var(--light-text-tertiary);
}

.kpi-trend {
  font-size: var(--text-sm);
}

.kpi-detail {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.trend-chart-card {
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}

.trend-chart-card::before {
  animation: none;
  opacity: 0.95;
}

.trend-chart-card .chart-header {
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-start;
}

.trend-chart-card .chart-actions {
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}

.chart-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  -webkit-text-fill-color: unset;
  background: none;
  color: var(--light-text-primary);
}

.chart-subtitle {
  font-size: var(--text-xs);
  margin-top: var(--space-1);
  color: var(--light-text-tertiary);
}

.time-range-btn {
  font-size: var(--text-xs);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}

.time-range-btn:focus-visible {
  outline: 2px solid var(--brand-green-500);
  outline-offset: 2px;
}

.trend-chart-card .chart-action-btn {
  font-size: var(--text-sm);
  min-width: 2.25rem;
}

.trend-metrics {
  gap: var(--space-3);
}

.trend-metric-card {
  border-radius: var(--radius-lg);
  border-color: var(--light-border-subtle);
}

.trend-metric-card:hover {
  transform: translateY(-1px);
}

.metric-label {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--light-text-tertiary);
}

.metric-value {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-change {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
}

.trend-chart-card .chart-container {
  height: min(400px, 52vh);
  min-height: 260px;
  margin: var(--space-4) 0;
}

.trend-chart-card .legend-item {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
}

.chart-stats {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

/* ---------- 各 Tab 共用模块：标题/正文/控件（统一 VI 字号与字族）---------- */
.strategy-research-container .control-title,
.strategy-research-container .chart-card .chart-title {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
}

.strategy-research-container .insight-title {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .insight-text {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.strategy-research-container .filter-btn {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.strategy-research-container .chart-legend,
.strategy-research-container .chart-legend span {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
  line-height: var(--leading-normal);
}

.strategy-research-container .product-title {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .product-desc,
.strategy-research-container .product-actions p {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.strategy-research-container .competitor-header h4 {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .competitor-metrics,
.strategy-research-container .metric-row {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.strategy-research-container .competitor-metrics .metric-value {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-variant-numeric: tabular-nums;
}

.strategy-research-container .swot-item,
.strategy-research-container .quadrant-list li {
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
  color: var(--light-text-secondary);
}

.strategy-research-container .quadrant-header h4 {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .quadrant-subtitle {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.strategy-research-container .axis-label-x,
.strategy-research-container .axis-label-y {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--light-text-tertiary);
  letter-spacing: 0.06em;
}

.strategy-research-container .export-btn-small {
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  color: var(--light-bg-elevated);
}

.strategy-research-container .empty-state h3 {
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.strategy-research-container .empty-state p {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.strategy-research-container .section-text strong {
  color: var(--light-text-primary);
  font-weight: var(--weight-semibold);
}

.strategy-research-container .decision-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
}

.strategy-research-container .command-center {
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.strategy-research-container .eyebrow {
  font-size: var(--text-xs);
}

@media (max-width: 900px) {
  .strategy-research-container .view-section {
    padding: var(--space-5) var(--space-4);
  }
}


/* —— 对标研究页 —— */
.bm-page .bm-eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--light-text-tertiary, #9b968d);
  text-transform: none;
}

.bm-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.bm-kpi {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--bm-accent, #2d6a4f) 28%, transparent);
  background: color-mix(in srgb, var(--bm-accent, #2d6a4f) 8%, white);
}

.bm-kpi-role {
  display: block;
  font-size: 12px;
  color: var(--light-text-secondary, #6b665d);
}

.bm-kpi-num {
  display: block;
  margin-top: 4px;
  font-size: 28px;
  line-height: 1.1;
  color: var(--bm-accent, #2d6a4f);
  font-variant-numeric: tabular-nums;
}

.bm-kpi-label {
  font-size: 12px;
  color: var(--light-text-tertiary, #9b968d);
}

.bm-axes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.bm-axis-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.bm-axis-short {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #2d6a4f;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.bm-axis-card .chart-title {
  margin: 0;
}

.bm-axis-desc,
.bm-axis-q {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--light-text-secondary, #6b665d);
}

.bm-axis-q {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(45, 106, 79, 0.22);
  color: #2d6a4f;
  font-weight: 500;
}

.bm-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.bm-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.bm-filter-btn {
  border: 1px solid rgba(45, 106, 79, 0.2);
  background: #fff;
  color: #6b665d;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.bm-filter-btn.active {
  border-color: var(--bm-accent, #2d6a4f);
  background: color-mix(in srgb, var(--bm-accent, #2d6a4f) 12%, white);
  color: var(--bm-accent, #2d6a4f);
  font-weight: 600;
}

.bm-search {
  min-width: 220px;
  flex: 1;
  max-width: 320px;
  border: 1px solid rgba(45, 106, 79, 0.2);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
}

.bm-group-panels {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 20px;
}

.bm-group-panel {
  border: 1px solid color-mix(in srgb, var(--bm-accent) 24%, transparent);
  border-radius: 12px;
  background: #fff;
  padding: 18px;
}

.bm-group-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.bm-group-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  color: var(--bm-accent);
}

.bm-group-head p {
  margin: 0;
  font-size: 13px;
  color: #6b665d;
  line-height: 1.55;
}

.bm-group-count {
  min-width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bm-accent) 14%, white);
  color: var(--bm-accent);
  font-weight: 700;
}

.bm-brand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.bm-brand-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  background: #fafaf8;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.bm-brand-card:hover,
.bm-brand-card.selected {
  border-color: var(--bm-accent);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--bm-accent) 16%, transparent);
  background: #fff;
}

.bm-brand-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.bm-brand-top h4 {
  margin: 0;
  font-size: 15px;
  color: #2c2a26;
}

.bm-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8f5ee;
  color: #2d6a4f;
}

.bm-brand-en {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9b968d;
}

.bm-brand-role {
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--bm-accent);
}

.bm-brand-line {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: #6b665d;
}

.bm-brand-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.bm-doc-tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(45, 106, 79, 0.08);
  color: #5a564e;
}

.bm-detail {
  margin-bottom: 20px;
}

.bm-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.bm-detail-en {
  font-weight: 400;
  color: #9b968d;
  font-size: 14px;
}

.bm-detail-role {
  margin: 0 0 8px;
  color: #2d6a4f;
  font-weight: 600;
}

.bm-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.bm-detail-block {
  border-radius: 10px;
  padding: 14px;
}

.bm-detail-block h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.bm-detail-block p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #5a564e;
}

.bm-detail-block.learn {
  background: #eef7f1;
}

.bm-detail-block.risk {
  background: #faf1eb;
}

.bm-zones {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.bm-zone-card {
  border-radius: 12px;
  padding: 16px;
  border: 1px solid transparent;
}

.bm-zone-card h3 {
  margin: 0 0 8px;
  font-size: 15px;
}

.bm-zone-rule {
  margin: 0 0 10px;
  font-size: 12px;
  color: #6b665d;
  line-height: 1.5;
}

.bm-zone-card ul {
  margin: 0;
  padding-left: 18px;
}

.bm-zone-card li {
  font-size: 13px;
  line-height: 1.55;
  margin-bottom: 6px;
  color: #4a463e;
}

.bm-zone-card[data-zone='green'] {
  background: #eef7f1;
  border-color: rgba(45, 106, 79, 0.25);
}

.bm-zone-card[data-zone='yellow'] {
  background: #fbf6e9;
  border-color: rgba(196, 165, 90, 0.35);
}

.bm-zone-card[data-zone='red'] {
  background: #faf0ef;
  border-color: rgba(208, 84, 80, 0.28);
}

.bm-outline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.bm-outline li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f7f6f2;
}

.bm-step-no {
  font-size: 12px;
  font-weight: 700;
  color: #2d6a4f;
  min-width: 28px;
}

.bm-outline strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.bm-outline p {
  margin: 0;
  font-size: 12px;
  color: #6b665d;
}

.bm-topics {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.bm-topics h4 {
  margin: 0 0 10px;
  font-size: 14px;
}

.bm-topic-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.bm-topic-chip {
  padding: 12px;
  border-radius: 10px;
  background: #f7f6f2;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bm-topic-chip strong {
  font-size: 13px;
}

.bm-topic-chip span {
  font-size: 12px;
  color: #6b665d;
  line-height: 1.45;
}

.bm-domestic-head {
  margin-top: 8px;
}

@media (max-width: 1100px) {
  .bm-kpi-row,
  .bm-axes,
  .bm-zones,
  .bm-outline,
  .bm-topic-row,
  .bm-detail-grid {
    grid-template-columns: 1fr;
  }
}


.bm-cloud { margin-bottom: 20px; }
.bm-cloud-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.bm-cloud-lead {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #6b665d;
}
.bm-cloud-lead code { font-size: 12px; }
.bm-cloud-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bm-upload-btn { cursor: pointer; display: inline-flex; align-items: center; }
.bm-upload-btn.disabled { opacity: 0.6; pointer-events: none; }
.bm-cloud-search-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  align-items: center;
}
.bm-cloud-search { max-width: none; flex: 1; }
.bm-cloud-error { margin: 10px 0 0; color: #d05450; font-size: 13px; }
.bm-cloud-empty { margin: 12px 0 0; font-size: 13px; color: #6b665d; }
.bm-cloud-results {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.bm-cloud-hit {
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafaf8;
  cursor: pointer;
}
.bm-cloud-hit:hover { border-color: #2d6a4f; background: #fff; }
.bm-cloud-hit-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.bm-cloud-hit-top h4 { margin: 0; font-size: 14px; }
.bm-cloud-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 0;
  font-size: 12px;
  color: #9b968d;
}
.bm-cloud-snippet {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: #5a564e;
}
.bm-cloud-recent { margin-top: 14px; }
.bm-cloud-recent h4, .bm-brand-cloud-docs h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #2d6a4f;
}
.bm-cloud-recent ul, .bm-brand-cloud-docs ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}
.bm-cloud-recent li, .bm-brand-cloud-docs li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.bm-linkish {
  border: none;
  background: none;
  padding: 0;
  color: #2d6a4f;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.bm-linkish:hover { text-decoration: underline; }
.bm-brand-cloud-docs {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(0,0,0,0.06);
}
.chart-action-btn.primary {
  background: #2d6a4f;
  color: #fff;
  border-color: #2d6a4f;
}

</style>

