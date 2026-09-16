<template>
  <div class="finance-wrapper">
    
    <div v-if="!isUnlocked" class="security-lock">
        <div class="lock-bg-grid"></div>
        <div class="lock-card">
            <div class="lock-icon">
                <i class="fas fa-shield-halved"></i>
            </div>
            <h2>财务数据保护</h2>
            <p class="lock-sub">SENSITIVE FINANCIAL DATA · SHAREHOLDER ACCESS</p>

            <div class="lock-features">
                <span class="lock-feature"><i class="fas fa-lock"></i> 端到端加密</span>
                <span class="lock-feature"><i class="fas fa-history"></i> 24h 免登</span>
                <span class="lock-feature"><i class="fas fa-user-shield"></i> 合伙人专属</span>
            </div>

            <div class="lock-input-group">
                <i class="fas fa-key lock-input-icon"></i>
                <input
                    type="password"
                    v-model="securityKey"
                    placeholder="请输入股东访问口令"
                    @keyup.enter="handleUnlock"
                    autocomplete="off"
                >
                <button @click="handleUnlock">
                    <i class="fas fa-unlock-alt"></i> 解锁
                </button>
            </div>
            <div class="lock-tip">
                <i class="fas fa-info-circle"></i> 仅限投资合伙人访问 · 验证通过后 24 小时内免重新输入
            </div>
        </div>
    </div>

    <div v-else class="finance-body">
        <div class="finance-container">
        
        <header class="finance-header">
            <div class="finance-header-title">
                <h1><i class="fas fa-chart-line"></i> 财务管理系统</h1>
                <p>双阶段分红 · 投资回报追踪 · 终极运营版</p>
            </div>
            <div class="header-actions">
                <el-button class="finance-header-sandbox-btn" @click="goCapitalSandbox">
                    <i class="fas fa-chess-board" style="margin-right: 6px;"></i> 资本架构沙盘
                </el-button>
                <el-button type="primary" class="finance-header-ai-btn" @click="showFinanceAI = true">
                    <el-icon><MagicStick /></el-icon> AI 财务助手
                </el-button>
                <div class="privacy-toggle" @click="app.togglePrivacy()" :title="isPrivacy ? '点击显示金额' : '点击隐藏金额'">
                    <i :class="['fas', isPrivacy ? 'fa-eye-slash' : 'fa-eye']" id="privacyIcon"></i>
                    <span>{{ isPrivacy ? '已隐藏' : '隐私模式' }}</span>
                </div>
                <el-button class="finance-header-lock-btn" link @click="handleFinanceLogout" title="退出财务模块（清除 24h 免登记忆）">
                    <i class="fas fa-lock" style="margin-right: 4px;"></i> 锁定
                </el-button>
            </div>
        </header>

        <!-- AI财务助手弹窗 -->
        <el-dialog
            v-model="showFinanceAI"
            title="AI 财务助手"
            width="90%"
            :close-on-click-modal="false"
            class="finance-ai-dialog"
            destroy-on-close
        >
            <FinanceAI />
        </el-dialog>

        <div class="card">
            <details class="settings-panel">
                <summary>
                    <span><i class="fas fa-sliders-h"></i> 成本与投资分红模型设置</span>
                    <span style="font-size:var(--text-sm); font-weight:normal; color: var(--light-text-tertiary);">点击配置参数</span>
                </summary>
                <div class="settings-content">
                    <div style="font-size:var(--text-sm); color:#e74c3c; margin-bottom:20px; padding:12px; background:#fffaf0; border-radius:6px; border-left: 4px solid #e67e22;">
                        <i class="fas fa-exclamation-triangle"></i> <strong>分红规则说明：</strong> 系统将自动计算累计净利润。当累计净利润 &lt; 总投资额时，执行“回本前比例”；当累计净利润 &gt;= 总投资额时，超额部分执行“回本后比例”。
                    </div>
                    <div class="grid-4">
                        <div class="form-group"><label class="form-label">月目标营收 (元)</label><input type="number" id="setTarget" class="form-control calc-trigger" value="130000"></div>
                        <div class="form-group"><label class="form-label">货物成本率 (%)</label><input type="number" id="setCostRate" class="form-control calc-trigger" value="25"></div>
                        <div class="form-group"><label class="form-label">总投资额 (元)</label><input type="number" id="setInvest" class="form-control calc-trigger" value="300000"></div>
                        <div class="form-group"><label class="form-label">投资股东人数 (人)</label><input type="number" id="setInvestCount" class="form-control calc-trigger" value="2"></div>
                        <div class="form-group" style="background:#f9f9f9; padding:10px; border-radius:6px;"><label class="form-label" style="color:#2D6A4F;">阶段一：回本前投资人占比 (%)</label><input type="number" id="setEarlyShare" class="form-control calc-trigger" value="80"></div>
                        <div class="form-group" style="background:#f9f9f9; padding:10px; border-radius:6px;"><label class="form-label" style="color:#27ae60;">阶段二：回本后投资人占比 (%)</label><input type="number" id="setLateShare" class="form-control calc-trigger" value="60"></div>
                        <div class="form-group"><label class="form-label">商场保底租金 (元)</label><input type="number" id="setRent" class="form-control calc-trigger" value="30000"></div>
                        <div class="form-group"><label class="form-label">商场抽成阈值 (元)</label><input type="number" id="setMallThreshold" class="form-control calc-trigger" value="170000"></div>
                        <div class="form-group"><label class="form-label">商场超额扣点 (%)</label><input type="number" id="setMallRate" class="form-control calc-trigger" value="15"></div>
                        <div class="form-group"><label class="form-label">月杂费/水电 (元)</label><input type="number" id="setUtility" class="form-control calc-trigger" value="500"></div>
                        <div class="form-group"><label class="form-label">员工人数 (人)</label><input type="number" id="setStaffCount" class="form-control calc-trigger" value="4"></div>
                        <div class="form-group"><label class="form-label">人均月薪含社保 (元)</label><input type="number" id="setStaffSalary" class="form-control calc-trigger" value="3000"></div>
                        <div class="form-group"><label class="form-label">销售提成 (%)</label><input type="number" id="setCommRate" class="form-control calc-trigger" value="1"></div>
                        <div class="form-group"><label class="form-label">综合税率 (%)</label><input type="number" id="setTax" class="form-control calc-trigger" value="0"></div>
                    </div>
                </div>
            </details>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fas fa-edit"></i> 智能日报录入</div>
            </div>
            <div class="form-group finance-store-pick">
                <label class="form-label">关联门店（入账）</label>
                <el-select
                    v-model="financeRecordStoreId"
                    placeholder="不关联门店"
                    clearable
                    filterable
                    style="width: 100%; max-width: 420px;"
                    size="default"
                >
                    <el-option
                        v-for="opt in financeStorePickOptions"
                        :key="opt.value === '' ? '_empty_' : opt.value"
                        :label="opt.label"
                        :value="opt.value"
                    />
                </el-select>
                <p class="finance-store-hint">
                  与「店铺管理」主数据一致（写入 canonical storeId，对齐小程序账本）。粘贴含「山川造物 / 山海造物 / 星宸」时会自动匹配门店；「现金」= 在手现金余额，不计入当日营收。
                </p>
            </div>
            <div class="form-group">
                <textarea id="dailyInput" class="form-control" rows="6" placeholder="请粘贴日报，例如：&#10;山川造物&#10;2026年 9月10日&#10;银联POS收款:1743.3元&#10;订单数:30&#10;线上：0元&#10;退款：0元&#10;现金：985.5元&#10;9月合计：49898.46元"></textarea>
            </div>
            <div style="display:flex; gap:15px;">
                <button class="btn btn-primary" @click="app.parseInput()">
                    <i class="fas fa-magic"></i> 智能识别
                </button>
                <button class="btn btn-gold" id="btnAdd" @click="app.addRecord()" disabled>
                    <i class="fas fa-check-circle"></i> 确认入账 / 更新
                </button>
            </div>
            <div id="parseMsg" class="alert"></div>
            <div v-if="pendingInventoryLines.length > 0" class="inventory-sync-bar">
                <div class="inventory-sync-summary">
                    <i class="fas fa-boxes"></i>
                    <span>已识别 <strong>{{ pendingInventoryLines.length }}</strong> 条库存，可同步到藏品档案库</span>
                </div>
                <div class="inventory-sync-actions">
                    <button
                        type="button"
                        class="btn btn-primary"
                        :disabled="syncInventoryLoading"
                        @click="app.syncInventoryToArchive()"
                    >
                        <i class="fas" :class="syncInventoryLoading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
                        {{ syncInventoryLoading ? '同步中...' : '同步库存到藏品档案库' }}
                    </button>
                </div>
                <div v-if="syncInventoryResult" class="inventory-sync-result">
                    <template v-if="syncInventoryResult.updated > 0">
                        <span class="result-ok"><i class="fas fa-check-circle"></i> 已更新 {{ syncInventoryResult.updated }} 条藏品库存</span>
                        <details v-if="syncInventoryResult.updatedList.length" style="margin-top:6px;">
                            <summary style="cursor:pointer; font-size:var(--text-sm); color: var(--light-text-secondary);">查看明细</summary>
                            <ul style="margin:6px 0 0 0; padding-left:18px; font-size:var(--text-sm); color:#555;">
                                <li v-for="(item, i) in syncInventoryResult.updatedList.slice(0, 15)" :key="i">{{ item.title }} → {{ item.qty }} 件</li>
                                <li v-if="syncInventoryResult.updatedList.length > 15">…共 {{ syncInventoryResult.updatedList.length }} 条</li>
                            </ul>
                        </details>
                    </template>
                    <template v-if="syncInventoryResult.unmatched && syncInventoryResult.unmatched.length > 0">
                        <span class="result-warn" style="margin-left:10px;"><i class="fas fa-exclamation-triangle"></i> 未匹配 {{ syncInventoryResult.unmatched.length }} 条（档案库中无对应藏品名称）</span>
                        <details style="margin-top:6px;">
                            <summary style="cursor:pointer; font-size:var(--text-sm); color: var(--light-text-tertiary);">未匹配列表</summary>
                            <ul style="margin:6px 0 0 0; padding-left:18px; font-size:var(--text-sm); color: var(--light-text-tertiary);">
                                <li v-for="(u, i) in syncInventoryResult.unmatched.slice(0, 20)" :key="i">{{ u.name }} {{ u.qty }}件</li>
                                <li v-if="syncInventoryResult.unmatched.length > 20">…共 {{ syncInventoryResult.unmatched.length }} 条</li>
                            </ul>
                        </details>
                    </template>
                </div>
            </div>
        </div>

        <!-- 快捷经营看板：今日/本周/本月 -->
        <div class="card quick-dashboard-card">
            <div class="card-header">
                <div class="card-title"><i class="fas fa-tachometer-alt"></i> 经营速览</div>
                <span class="quick-dashboard-tip">今日 / 本周 / 本月关键指标</span>
            </div>
            <div class="quick-dashboard-grid">
                <div class="quick-stat today">
                    <div class="quick-stat-label">今日营收</div>
                    <div class="quick-stat-val money-val" id="quickTodayRev">-</div>
                    <div class="quick-stat-sub">今日净利 <span class="money-val" id="quickTodayProfit">-</span></div>
                </div>
                <div class="quick-stat week">
                    <div class="quick-stat-label">本周营收</div>
                    <div class="quick-stat-val money-val" id="quickWeekRev">-</div>
                    <div class="quick-stat-sub">本周净利 <span class="money-val" id="quickWeekProfit">-</span></div>
                </div>
                <div class="quick-stat month">
                    <div class="quick-stat-label">本月营收</div>
                    <div class="quick-stat-val money-val" id="quickMonthRev">-</div>
                    <div class="quick-stat-sub">本月净利 <span class="money-val" id="quickMonthProfit">-</span></div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fas fa-users"></i> 股东权益与回报看板</div>
                <div style="font-size:var(--text-sm); color: var(--light-text-tertiary);">
                    状态: <span id="roiStatusBadge" style="font-weight:bold; padding:4px 8px; border-radius:4px; background:#eee;">计算中...</span>
                </div>
            </div>
            <div class="grid-3">
                <div class="stat-box" style="border-left-color:#2D6A4F;">
                    <div class="stat-label">投资股东 (共<span id="lblInvCount">2</span>人)</div>
                    <div class="stat-val money-val" id="valInvestTotal">-</div>
                    <div class="stat-sub">单人已分红: <span class="money-val" id="valInvestPer">-</span></div>
                    <div class="radar-container">
                        <div class="radar-bar">
                            <div class="radar-profit" id="barInvestRoi" style="width:0%; background:#2D6A4F;"></div>
                        </div>
                        <div class="radar-labels">
                            <span>回本进度</span>
                            <span id="txtInvestRoi">0%</span>
                        </div>
                    </div>
                </div>

                <div class="stat-box finance-stat-team">
                    <div class="stat-label">经营团队收益</div>
                    <div class="stat-val money-val" id="valOpTotal">-</div>
                    <div class="stat-sub finance-stat-team-sub">
                        当前分红比: <span id="lblOpRate">20%</span>
                    </div>
                    <div style="margin-top:10px; font-size:var(--text-sm); color: var(--light-text-secondary);">
                        * 回本前按 <span id="txtEarlyOp">20%</span>，回本后按 <span id="txtLateOp">50%</span>
                    </div>
                </div>

                <div class="stat-box" style="border-left-color:#27ae60;">
                    <div class="stat-label">预计回本时间</div>
                    <div class="stat-val" id="valPaybackDate" style="font-size:var(--text-2xl);">-</div>
                    <div class="stat-sub">
                        剩余需回款: <span class="money-val" id="valLeft">-</span>
                    </div>
                    <div style="margin-top:10px; font-size:var(--text-sm); color: var(--light-text-secondary);">
                        基于近30天日均净利推算
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="flex-wrap:wrap; gap:12px;">
                <div class="card-title"><i class="fas fa-chart-pie"></i> 月度经营看板</div>
                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                    <select id="monthSelect" class="form-control" style="width:auto; font-weight:bold;" @change="app.renderMonthlyView()">
                        <option value="">-- 选择月份 --</option>
                    </select>
                    <el-select
                        v-model="monthlyStoreFilter"
                        placeholder="全部门店"
                        filterable
                        size="default"
                        style="width:220px;"
                        @change="app.renderMonthlyView()"
                    >
                        <el-option
                            v-for="opt in financeStoreLedgerOptions"
                            :key="'m-' + String(opt.value)"
                            :label="opt.label"
                            :value="opt.value"
                        />
                    </el-select>
                </div>
            </div>

            <div class="monthly-dashboard">
                <!-- 核心财务指标 -->
                <div class="dashboard-section">
                    <h3 class="section-title">📊 核心财务指标</h3>
                    <div class="grid-4">
                        <div class="stat-box highlight-box" style="border-left-color: #2D6A4F;">
                            <div class="stat-label">本月总营收</div>
                            <div class="stat-val money-val" id="monthRev">-</div>
                        </div>
                        <div class="stat-box highlight-box" style="border-left-color: #27ae60;">
                            <div class="stat-label">本月净利润</div>
                            <div class="stat-val money-val profit" id="monthProfit">-</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">净利率</div>
                            <div class="stat-val" id="monthMargin">-</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">目标达成率</div>
                            <div class="stat-val" id="monthTarget">-</div>
                        </div>
                    </div>
                </div>

                <!-- 每月财务总结要点：左侧自动生成要点海报图 + 右侧文字 -->
                <div class="dashboard-section monthly-brief-section">
                    <div class="panel-head">
                        <h3 class="section-title section-title--block">📌 每月财务总结要点</h3>
                        <details class="panel-hint-details">
                            <summary>使用说明</summary>
                            <p class="panel-hint-body">
                                海报采用 VI 标本馆风格：<strong>红绸抬头 + 蝴蝶水印</strong>，纸面以品牌<strong>绿 / 白 / 棕</strong>为底，金色用于<strong>金额数值</strong>，红色作为表头与点睛。突出<strong>当月营收</strong>与<strong>预估净利润</strong>，并附目标进度、日营收走势（含日均参考线、峰值标注）、四项核心指标卡与致谢语，底部为<strong>红色印章 + 品牌落款</strong>。可下载 PNG；右侧文字仅保存在本机。
                            </p>
                        </details>
                    </div>
                    <div class="monthly-brief-grid">
                        <div class="monthly-brief-panel monthly-brief-visual">
                            <div class="monthly-brief-panel-title">门店营收成绩单海报（自动绘制）</div>
                            <p class="monthly-brief-chart-caption monthly-brief-caption--top">A4 纵向 · 红绸抬头 · 🦋 蝴蝶水印 · 金色金额 · 红色印章 · 品牌落款 · 朱红走势</p>
                            <div class="monthly-brief-poster-frame">
                                <canvas id="monthlyBriefPoster" class="monthly-brief-poster-canvas"></canvas>
                            </div>
                            <div class="monthly-brief-toolbar">
                                <button type="button" class="btn btn-outline btn-sm" @click="downloadMonthlyBriefPoster">
                                    <i class="fas fa-download"></i> 下载 PNG
                                </button>
                            </div>
                        </div>
                        <div class="monthly-brief-panel monthly-brief-copy">
                            <div class="monthly-brief-panel-title">文字要点</div>
                            <label class="form-label monthly-brief-label">支持粘贴会议纪要或自行编辑；修改会自动暂存到本机。</label>
                            <textarea
                                v-model="monthlyBriefText"
                                class="form-control monthly-brief-textarea"
                                rows="6"
                                placeholder="输入总结要点，或点击下方根据当月数据生成…"
                                @input="schedulePersistMonthlyBrief"
                            ></textarea>
                            <div class="monthly-brief-actions">
                                <button type="button" class="btn btn-primary btn-block-mobile" @click="generateMonthlyBriefFromData">
                                    <i class="fas fa-magic"></i> 根据数据生成要点
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 商场分成：月累计营收超过阈值部分 × 扣点 -->
                <div class="dashboard-section mall-share-section">
                    <div class="panel-head">
                        <h3 class="section-title section-title--block">🏢 商场分成情况</h3>
                        <details class="panel-hint-details">
                            <summary>口径说明</summary>
                            <p class="panel-hint-body">
                                <strong>月累计对赌口径：</strong>{{ FORMULA_NOTE }}
                            </p>
                        </details>
                    </div>
                    <div class="mall-share-grid">
                        <div class="stat-box mall-share-card highlight-box" style="border-left-color: #1B4332;">
                            <div class="stat-label">已达额度（当月营收）</div>
                            <div class="stat-val money-val mall-share-val" id="mallBriefMonthRev">-</div>
                        </div>
                        <div class="stat-box mall-share-card">
                            <div class="stat-label">抽成阈值（月）</div>
                            <div class="stat-val money-val mall-share-val" id="mallBriefThreshold">-</div>
                        </div>
                        <div class="stat-box mall-share-card">
                            <div class="stat-label">超额金额</div>
                            <div class="stat-val money-val mall-share-val" id="mallBriefExcess">-</div>
                        </div>
                        <div class="stat-box mall-share-card highlight-box" style="border-left-color: #c4a55a;">
                            <div class="stat-label">抽成金额</div>
                            <div class="stat-val money-val mall-share-val" id="mallBriefAmount">-</div>
                            <div class="stat-sub mall-share-sub" id="mallBriefRateHint">-</div>
                        </div>
                    </div>
                </div>

                <!-- 订单经营指标 -->
                <div class="dashboard-section">
                    <h3 class="section-title">📦 订单经营指标</h3>
                    <div class="grid-4">
                        <div class="stat-box highlight-box" style="border-left-color: #2D6A4F;">
                            <div class="stat-label">总订单数</div>
                            <div class="stat-val" id="monthOrderCount">-</div>
                        </div>
                        <div class="stat-box highlight-box" style="border-left-color: #1B4332;">
                            <div class="stat-label">订单均价</div>
                            <div class="stat-val money-val" id="monthAvgOrderPrice">-</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">日均订单数</div>
                            <div class="stat-val" id="monthDailyOrders">-</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">日均营收</div>
                            <div class="stat-val money-val" id="monthDailyRev">-</div>
                        </div>
                    </div>
                </div>

                <!-- 财务分析与诊断 -->
                <div class="dashboard-section">
                    <h3 class="section-title">💡 财务分析与诊断</h3>
                    <div class="grid-2">
                        <div class="stat-box" style="border-left-color: var(--accent); flex:1;">
                            <div class="stat-label"><i class="fas fa-user-md"></i> 财务医生诊断</div>
                            <div id="aiDoctor" style="font-size:var(--text-base); color:#555; margin-top:5px; line-height:1.5;">暂无数据...</div>
                        </div>
                        <div class="stat-box" style="border-left-color: #333;">
                            <div class="stat-label">本月盈亏平衡雷达</div>
                            <div class="radar-container">
                                <div class="radar-bar">
                                    <div class="radar-fixed" id="barFixed" style="width:0%"></div>
                                    <div class="radar-profit" id="barProfit" style="width:0%"></div>
                                </div>
                                <div class="radar-labels">
                                    <span>🔴 刚性成本: <span id="lblFixed" class="money-val">-</span></span>
                                    <span>🟢 净利区</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 分日订单报表 -->
            <div class="dashboard-section" id="orderReportArea" style="display:none;">
                <h3 class="section-title">📈 分日订单数据报表</h3>
                <div style="height:350px; position:relative;">
                    <canvas id="orderChart"></canvas>
                </div>
            </div>

            <div class="calendar-wrapper" id="calendarArea" style="display:none;">
                <div class="calendar-header">
                    <div class="calendar-title">
                        <i class="fas fa-calendar-alt"></i>
                        <span>营收热力日历</span>
                        <span class="calendar-subtitle">点击日期可快速编辑</span>
                    </div>
                    <div class="calendar-legend" id="calendarLegend">
                        <div class="legend-item">
                            <span class="legend-dot heat-0-dot"></span>
                            <span class="legend-label">无数据</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-dot heat-1-dot"></span>
                            <span class="legend-label">低</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-dot heat-2-dot"></span>
                            <span class="legend-label">中</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-dot heat-3-dot"></span>
                            <span class="legend-label">高</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-dot heat-4-dot"></span>
                            <span class="legend-label">极高</span>
                        </div>
                    </div>
                </div>
                <div class="calendar-weekdays">
                    <div class="weekday">日</div>
                    <div class="weekday">一</div>
                    <div class="weekday">二</div>
                    <div class="weekday">三</div>
                    <div class="weekday">四</div>
                    <div class="weekday">五</div>
                    <div class="weekday">六</div>
                </div>
                <div class="calendar-grid" id="calGrid"></div>
                <div class="calendar-stats" id="calendarStats"></div>
            </div>
        </div>

        <div class="grid-2">
            <div class="card">
                <div class="card-header"><div class="card-title"><i class="fas fa-university"></i> 全周期累计总览</div></div>
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:15px;">
                    <span style="color: var(--light-text-secondary);">累计总营收</span>
                    <span class="stat-val money-val" style="font-size:var(--text-2xl);" id="totalRev">-</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                    <span style="color: var(--light-text-secondary);">累计总净利</span>
                    <span class="stat-val money-val" style="font-size:var(--text-2xl); color:var(--success);" id="totalProfit">-</span>
                </div>
                <div style="height:150px; position:relative;">
                    <canvas id="equityChart"></canvas>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header"><div class="card-title"><i class="fas fa-chart-bar"></i> 每日盈亏趋势</div></div>
                <div class="trend-chart-container">
                    <canvas id="trendChart"></canvas>
                </div>
            </div>
        </div>

        <!-- 成本明细分析与对比 -->
        <div class="card cost-analysis-card">
            <div class="card-header">
                <div class="card-title">
                    <i class="fas fa-chart-line"></i> 成本明细分析与对比
                </div>
                <div class="card-actions">
                    <select id="analysisMonth" class="form-control month-selector" @change="app.renderCostAnalysis()">
                        <option value="">-- 选择月份 --</option>
                    </select>
                    <button class="btn btn-outline btn-refresh" @click="app.renderCostAnalysis()" title="刷新分析">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>
            
            <div class="analysis-tabs">
                <div class="tab-buttons">
                    <button 
                        class="tab-btn" 
                        :class="{ active: activeAnalysisTab === 'cost-detail' }"
                        @click="activeAnalysisTab = 'cost-detail'"
                    >
                        <i class="fas fa-pie-chart"></i> 
                        <span>成本结构</span>
                    </button>
                    <button 
                        class="tab-btn" 
                        :class="{ active: activeAnalysisTab === 'comparison' }"
                        @click="activeAnalysisTab = 'comparison'"
                    >
                        <i class="fas fa-chart-area"></i> 
                        <span>同比环比</span>
                    </button>
                    <button 
                        class="tab-btn" 
                        :class="{ active: activeAnalysisTab === 'warning' }"
                        @click="activeAnalysisTab = 'warning'"
                    >
                        <i class="fas fa-exclamation-triangle"></i> 
                        <span>财务预警</span>
                    </button>
                </div>

                <!-- 成本结构分析 -->
                <div v-show="activeAnalysisTab === 'cost-detail'" class="tab-content cost-detail-tab">
                    <div class="cost-analysis-container">
                        <!-- 顶部总览卡片 -->
                        <div class="cost-overview-section">
                            <div id="costOverviewCards" class="overview-cards-grid"></div>
                        </div>
                        
                        <!-- 图表区域：双图等高、结构/对比并列 -->
                        <div class="charts-section charts-section--uniform">
                            <div class="chart-card chart-card-primary">
                                <div class="chart-card-header chart-card-header--compact">
                                    <div class="chart-card-title">
                                        <i class="fas fa-chart-pie"></i>
                                        <span>结构</span>
                                    </div>
                                </div>
                                <div class="chart-legend chart-legend--below-title" id="costChartLegend"></div>
                                <div class="chart-card-body chart-card-body--fixed">
                                    <canvas id="costChart"></canvas>
                                </div>
                            </div>

                            <div class="chart-card chart-card-secondary">
                                <div class="chart-card-header chart-card-header--compact">
                                    <div class="chart-card-title">
                                        <i class="fas fa-chart-bar"></i>
                                        <span>对比</span>
                                    </div>
                                </div>
                                <div class="chart-card-body chart-card-body--fixed">
                                    <canvas id="costBarChart"></canvas>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 成本明细列表 -->
                        <div class="cost-details-section cost-details-section--slim" role="region" aria-labelledby="cost-detail-heading">
                            <div class="section-header-modern section-header-modern--slim">
                                <div class="section-title-modern section-title-modern--slim" id="cost-detail-heading">
                                    <i class="fas fa-list-ul" aria-hidden="true"></i>
                                    <span>成本明细</span>
                                </div>
                                <div class="cost-summary-badges" id="costSummaryStats" role="group" aria-label="成本摘要"></div>
                            </div>
                            <div id="costDetailList" class="cost-detail-table-wrap" aria-live="polite" aria-label="各项成本与汇总">
                                <div class="empty-state-modern">
                                    <i class="fas fa-calendar-alt"></i>
                                    <p>请选择月份查看成本分析</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 同比环比分析 -->
                <div v-show="activeAnalysisTab === 'comparison'" class="tab-content comparison-tab">
                    <div class="comparison-layout">
                        <!-- 对比指标卡片 -->
                        <div class="comparison-metrics-section">
                            <div id="comparisonMetrics" class="comparison-metrics-grid"></div>
                        </div>
                        
                        <!-- 图表区域 -->
                        <div class="comparison-charts-section">
                            <div class="chart-card chart-card-primary">
                                <div class="chart-card-header">
                                    <span class="chart-card-title">
                                        <i class="fas fa-chart-bar"></i> 营收对比
                                    </span>
                                </div>
                                <div class="chart-card-body">
                                    <canvas id="comparisonRevenueChart"></canvas>
                                </div>
                            </div>
                            
                            <div class="chart-card chart-card-secondary">
                                <div class="chart-card-header">
                                    <span class="chart-card-title">
                                        <i class="fas fa-chart-line"></i> 利润对比
                                    </span>
                                </div>
                                <div class="chart-card-body">
                                    <canvas id="comparisonProfitChart"></canvas>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 详细对比数据 -->
                        <div class="comparison-details-section">
                            <div class="section-header-modern">
                                <h4 class="section-title-modern">
                                    <i class="fas fa-list-check"></i> 对比详情
                                </h4>
                            </div>
                            <div id="comparisonDetails" class="comparison-details-grid"></div>
                        </div>
                    </div>
                </div>

                <!-- 财务预警 -->
                <div v-show="activeAnalysisTab === 'warning'" class="tab-content warning-tab">
                    <div id="financeWarning" class="warning-container">
                        <div class="empty-state-modern">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>正在分析财务数据...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 新增：财务预测与健康度分析 -->
        <div class="grid-2">
            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="fas fa-crystal-ball"></i> 财务预测分析</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <select id="forecastPeriod" class="form-control" style="width:auto; font-weight:bold;" @change="app.renderForecast()">
                            <option value="7">未来7天</option>
                            <option value="30" selected>未来30天</option>
                            <option value="90">未来90天</option>
                        </select>
                        <button class="btn btn-outline" @click="app.renderForecast()" title="刷新预测">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
                <div id="forecastContent" style="padding:20px;">
                    <div style="text-align:center; color: var(--light-text-tertiary);">正在计算预测数据...</div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="fas fa-heartbeat"></i> 财务健康度评分</div>
                    <button class="btn btn-outline" @click="app.calculateHealthScore()" title="重新计算">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
                <div id="healthScoreContent" style="padding:20px;">
                    <div style="text-align:center; color: var(--light-text-tertiary);">正在计算健康度...</div>
                </div>
            </div>
        </div>

        <!-- 新增：现金流分析与成本优化 -->
        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fas fa-water"></i> 现金流分析与成本优化</div>
            </div>
            <div class="cashflow-tabs">
                <div class="tab-buttons">
                    <button class="tab-btn active" @click="activeCashflowTab = 'cashflow'" :class="{active: activeCashflowTab === 'cashflow'}">
                        <i class="fas fa-chart-line"></i> 现金流分析
                    </button>
                    <button class="tab-btn" @click="activeCashflowTab = 'optimization'" :class="{active: activeCashflowTab === 'optimization'}">
                        <i class="fas fa-lightbulb"></i> 成本优化建议
                    </button>
                    <button class="tab-btn" @click="activeCashflowTab = 'report'" :class="{active: activeCashflowTab === 'report'}">
                        <i class="fas fa-file-alt"></i> 财务报告
                    </button>
                </div>

                <div v-show="activeCashflowTab === 'cashflow'" class="tab-content">
                    <div id="cashflowAnalysis">
                        <div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">正在分析现金流...</div>
                    </div>
                </div>

                <div v-show="activeCashflowTab === 'optimization'" class="tab-content">
                    <div id="costOptimization">
                        <div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">正在生成优化建议...</div>
                    </div>
                </div>

                <div v-show="activeCashflowTab === 'report'" class="tab-content report-tab-content">
                    <div class="report-toolbar">
                        <div class="report-controls">
                            <label>报表类型：</label>
                            <select id="reportType" class="form-control" style="width:auto; min-width:140px;" @change="app.refreshFinanceReport()">
                                <option value="monthly">月度经营报表</option>
                                <option value="shareholder">股东汇报摘要</option>
                                <option value="profit-table">简化利润表</option>
                            </select>
                            <label style="margin-left:12px;">报告周期：</label>
                            <select id="reportPeriod" class="form-control" style="width:auto; min-width:120px;" v-model="reportPeriodSelect" @change="app.refreshFinanceReport()">
                                <option value="current">本月</option>
                                <option value="last">上月</option>
                                <option value="quarter">本季</option>
                                <option value="custom">选择月份</option>
                            </select>
                            <select id="reportCustomMonth" class="form-control" style="width:auto; min-width:120px;" v-show="reportPeriodSelect === 'custom'" @change="app.refreshFinanceReport()">
                                <option value="">-- 选择月份 --</option>
                            </select>
                        </div>
                        <div class="report-actions">
                            <button type="button" class="btn btn-outline" @click="app.downloadReport()" title="下载为文本">
                                <i class="fas fa-download"></i> 下载报告
                            </button>
                            <button type="button" class="btn btn-outline" @click="app.printReport()" title="打印">
                                <i class="fas fa-print"></i> 打印报告
                            </button>
                        </div>
                    </div>
                    <div id="financeReport" class="finance-report-body">
                        <div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">正在生成报告...</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fas fa-book"></i> 账本明细与备份</div>
                <div style="display:flex; gap:10px; flex-wrap: wrap;">
                    <button class="btn btn-primary" @click="handleSync" :disabled="syncing">
                        <i class="fas" :class="syncing ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i> 
                        {{ syncing ? '同步中...' : '同步到云端' }}
                    </button>
                    <button class="btn btn-outline" @click="handleDownload" :disabled="syncing">
                        <i class="fas fa-download"></i> 从云端下载
                    </button>
                    <button class="btn btn-outline" @click="openDuplicateCleanupPreview" :disabled="duplicateCleanupLoading">
                        <i class="fas" :class="duplicateCleanupLoading ? 'fa-spinner fa-spin' : 'fa-broom'"></i>
                        清理重复日账
                    </button>
                    <input type="file" id="importFile" style="display:none;" accept=".xlsx" @change="e => app.importExcel(e.target)">
                    <button class="btn btn-outline" onclick="document.getElementById('importFile').click()">
                        <i class="fas fa-file-import"></i> 导入备份
                    </button>
                    <el-dropdown @command="handleExport" trigger="click">
                        <button class="btn btn-gold">
                            <i class="fas fa-file-export"></i> 导出数据 <i class="fas fa-caret-down" style="margin-left:5px;"></i>
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="excel"><i class="fas fa-file-excel"></i> 导出Excel</el-dropdown-item>
                                <el-dropdown-item command="csv"><i class="fas fa-file-csv"></i> 导出CSV</el-dropdown-item>
                                <el-dropdown-item command="json"><i class="fas fa-file-code"></i> 导出JSON</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>
            <div v-if="syncStatus" style="padding: 10px; margin-top: 10px; border-radius: 4px; background: rgba(45, 106, 79, 0.1); border: 1px solid rgba(45, 106, 79, 0.3);">
                <div style="color: #2D6A4F; font-size: var(--text-xs);">
                    <i class="fas fa-info-circle"></i> {{ syncStatus }}
                </div>
            </div>
            <div v-if="duplicateCleanupStatus" style="padding: 10px; margin-top: 10px; border-radius: 4px; background: rgba(230, 126, 34, 0.08); border: 1px solid rgba(230, 126, 34, 0.25);">
                <div style="color: #b7791f; font-size: var(--text-xs);">
                    <i class="fas fa-broom"></i> {{ duplicateCleanupStatus }}
                </div>
            </div>

            <el-dialog
                v-model="duplicateCleanupVisible"
                title="清理重复日账 · 预览"
                width="720px"
                :close-on-click-modal="false"
                destroy-on-close
            >
                <div v-if="duplicateCleanupPreview">
                    <el-alert
                        type="warning"
                        :closable="false"
                        show-icon
                        style="margin-bottom: 14px;"
                        title="同一 canonical 门店 + 日期存在多条记录时，将保留 canonical storeId → 较新更新时间 → 金额较大的一条；其余删除。"
                    />
                    <p style="margin: 0 0 12px; font-size: 13px; color: var(--light-text-secondary);">
                        检测到 <strong>{{ duplicateCleanupPreview.duplicateDayCount }}</strong> 个重复日 ·
                        拟删除 <strong>{{ duplicateCleanupPreview.removeCount }}</strong> 条 ·
                        虚增约 <strong>¥{{ duplicateCleanupPreview.totalInflatedRevenue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</strong>
                    </p>
                    <el-table
                        v-if="duplicateCleanupPreview.groups.length"
                        :data="duplicateCleanupPreview.groups"
                        size="small"
                        max-height="360"
                        border
                    >
                        <el-table-column prop="date" label="日期" width="110" />
                        <el-table-column prop="storeLabel" label="门店" width="140" />
                        <el-table-column label="保留" min-width="160">
                            <template #default="{ row }">
                                ¥{{ Number(row.keep.revenue || 0).toLocaleString() }}
                                <span style="color:#888;font-size:11px;"> · {{ row.keep.storeId || row.keep.storeCode || '—' }}</span>
                            </template>
                        </el-table-column>
                        <el-table-column label="删除" min-width="160">
                            <template #default="{ row }">
                                <span v-for="(r, i) in row.remove" :key="i">
                                    ¥{{ Number(r.revenue || 0).toLocaleString() }}
                                    <span style="color:#888;font-size:11px;"> · {{ r.storeId || r.storeCode || '—' }}</span>
                                    <br v-if="i < row.remove.length - 1" />
                                </span>
                            </template>
                        </el-table-column>
                        <el-table-column label="虚增" width="90" align="right">
                            <template #default="{ row }">¥{{ Number(row.inflatedRevenue || 0).toLocaleString() }}</template>
                        </el-table-column>
                    </el-table>
                    <el-empty v-else description="未发现重复日账，无需清理" :image-size="64" />
                </div>
                <template #footer>
                    <el-button @click="duplicateCleanupVisible = false">取消</el-button>
                    <el-button
                        type="danger"
                        :disabled="!duplicateCleanupPreview?.removeCount"
                        :loading="duplicateCleanupLoading"
                        @click="confirmDuplicateCleanup"
                    >
                        确认清理（本地 + 云端）
                    </el-button>
                </template>
            </el-dialog>
            
            <!-- 新增：数据筛选和搜索 -->
            <div class="ledger-filters" style="padding:15px; background:#f8f9fa; border-radius:8px; margin-bottom:15px;">
                <div style="display:flex; gap:15px; flex-wrap:wrap; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:200px;">
                        <i class="fas fa-search" style="color: var(--light-text-tertiary);"></i>
                        <input 
                            type="text" 
                            id="ledgerSearch" 
                            class="form-control" 
                            placeholder="搜索日期、营收、凭证..." 
                            style="flex:1;"
                            @input="app.filterLedger()"
                        >
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <label style="font-size:var(--text-sm); color: var(--light-text-secondary); white-space:nowrap;">日期范围:</label>
                        <el-date-picker
                            v-model="dateRange"
                            type="daterange"
                            range-separator="至"
                            start-placeholder="开始日期"
                            end-placeholder="结束日期"
                            format="YYYY-MM-DD"
                            value-format="YYYY-MM-DD"
                            size="small"
                            style="width:240px;"
                            @change="app.filterLedger()"
                        />
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; min-width:200px;">
                        <label style="font-size:var(--text-sm); color: var(--light-text-secondary); white-space:nowrap;">门店:</label>
                        <el-select
                            v-model="ledgerStoreFilter"
                            placeholder="全部门店"
                            clearable
                            filterable
                            size="small"
                            style="width:220px;"
                            @change="app.filterLedger()"
                        >
                            <el-option
                                v-for="opt in financeStoreLedgerOptions"
                                :key="String(opt.value)"
                                :label="opt.label"
                                :value="opt.value"
                            />
                        </el-select>
                    </div>
                    <button class="btn btn-outline" @click="app.resetFilters()" style="white-space:nowrap;">
                        <i class="fas fa-redo"></i> 重置
                    </button>
                </div>
                <div v-if="filteredCount >= 0" style="margin-top:10px; font-size:var(--text-sm); color: var(--light-text-secondary);">
                    <i class="fas fa-info-circle"></i> 共找到 <strong style="color:var(--primary);">{{ filteredCount }}</strong> 条记录
                    <button class="btn btn-outline" @click="app.exportFilteredData()" style="margin-left:15px; padding:4px 10px; font-size:var(--text-sm);">
                        <i class="fas fa-download"></i> 导出筛选结果
                    </button>
                </div>
            </div>
            
            <div class="ledger-wrapper" id="ledgerList">
                <div style="padding:50px; text-align:center; color: var(--light-text-tertiary);">暂无数据，请录入或导入Excel</div>
            </div>
        </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import { safeWarn } from '../utils/safeStorage.js'
import { onMounted, onUnmounted, reactive, ref, nextTick, computed } from 'vue'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'
import { ElMessage, ElMessageBox, ElDropdown, ElDropdownMenu, ElDropdownItem, ElDatePicker, ElSelect, ElOption } from 'element-plus'
import { MagicStick } from '@element-plus/icons-vue'
import FinanceAI from './ai/FinanceAI.vue'
import { autoSyncFinanceData, manualSyncFinanceData, touchLocalFinanceUpdateTime } from '../utils/financeSync'
import { ledgerKey, dedupeFinanceRecords } from '../utils/storeLedgerSync'
import {
  previewDuplicateCleanup,
  cleanupDuplicateFinanceRecords,
} from '../utils/financeDuplicateCleanup'
import { FINANCE_RECORDS_KEY } from '../utils/financeLocalStorageKey'
import { fetchCollectionSorted, cdnUpdate, COLLECTIONS } from '../cloud'
import {
  loadStoreBundle,
  findStoreById,
  findDefaultFinanceStoreId,
  applyDefaultStoreToFinanceRecord,
  ensureDefaultFinanceStoreInLocalBundle,
  resolveFinanceStoreWriteId,
  recordMatchesFinanceStoreFilter,
  matchStoreFromDailyText,
  DEFAULT_FINANCE_STORE_NAME,
} from '../utils/storeStorage'
import { parseDailyFinanceText } from '../utils/financeDailyParse'
import {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  FORMULA_NOTE,
  computeMallCommission,
  computeDailyMallCost,
} from '../utils/mallCommission'

const emit = defineEmits(['switch-tab'])
const goCapitalSandbox = () => emit('switch-tab', '36')

/** 海报用：从账本行解析门店主文案 */
function buildPosterStoreContext(mData) {
    const bundle = loadStoreBundle()
    const rows = (mData || []).filter((r) => r && r.date)
    const map = new Map()
    for (const r of rows) {
        const id = r.storeId ? String(r.storeId) : ''
        const nm = String(r.storeName || '').trim()
        if (!id && !nm) continue
        const key = id || nm
        if (!map.has(key)) {
            map.set(key, { id, name: nm, code: String(r.storeCode || '').trim() })
        }
    }
    if (map.size === 0) {
        const defId = findDefaultFinanceStoreId(bundle)
        const st = defId ? findStoreById(bundle, defId) : null
        return {
            primary: String(st?.name || DEFAULT_FINANCE_STORE_NAME).trim(),
            secondary: st?.code ? `编码 ${st.code}` : '',
            multi: false,
        }
    }
    if (map.size === 1) {
        const v = [...map.values()][0]
        const st = v.id ? findStoreById(bundle, v.id) : null
        const name = String(st?.name || v.name || '未命名门店').trim()
        const code = String(st?.code || v.code || '').trim()
        return {
            primary: name || '未命名门店',
            secondary: code ? `编码 ${code}` : '',
            multi: false,
        }
    }
    const labels = [...map.values()].map((v) => {
        const st = v.id ? findStoreById(bundle, v.id) : null
        return String(st?.name || v.name || '门店').trim()
    })
    const uniq = [...new Set(labels)].filter(Boolean)
    const head = uniq.slice(0, 2).join('、')
    const tail = uniq.length > 2 ? ` 等共 ${uniq.length} 店` : ` · 共 ${uniq.length} 店`
    return {
        primary: '多门店汇总',
        secondary: `${head}${tail}`,
        multi: true,
    }
}

/**
 * 山海造物风格矢量标识：远山近峰、曲水、暖金点缀（无外部图片）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 左上角 x
 * @param {number} y 左上角 y
 * @param {number} box 外框边长
 */
function drawShanchuanBrandLogo(ctx, x, y, box) {
    const s = box / 56
    ctx.save()
    ctx.translate(x, y)
    const rr = Math.min(11 * s, box * 0.22)
    ctx.beginPath()
    ctx.moveTo(rr, 0)
    ctx.arcTo(box, 0, box, box, rr)
    ctx.arcTo(box, box, 0, box, rr)
    ctx.arcTo(0, box, 0, 0, rr)
    ctx.arcTo(0, 0, box, 0, rr)
    ctx.closePath()
    const badgeGrad = ctx.createLinearGradient(0, 0, box, box)
    badgeGrad.addColorStop(0, 'rgba(255,255,255,0.98)')
    badgeGrad.addColorStop(1, 'rgba(237, 247, 241, 0.95)')
    ctx.fillStyle = badgeGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(45, 106, 79, 0.42)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // 远峰（浅）
    ctx.beginPath()
    ctx.moveTo(5 * s, 48 * s)
    ctx.lineTo(20 * s, 22 * s)
    ctx.lineTo(36 * s, 48 * s)
    ctx.closePath()
    ctx.fillStyle = 'rgba(64, 145, 108, 0.55)'
    ctx.fill()

    // 近峰（山海造物主色）
    ctx.beginPath()
    ctx.moveTo(12 * s, 48 * s)
    ctx.lineTo(28 * s, 12 * s)
    ctx.lineTo(48 * s, 48 * s)
    ctx.closePath()
    ctx.fillStyle = '#1B4332'
    ctx.fill()

    // 川流
    ctx.beginPath()
    ctx.moveTo(5 * s, 44 * s)
    ctx.bezierCurveTo(16 * s, 50 * s, 28 * s, 38 * s, 51 * s, 44 * s)
    ctx.strokeStyle = '#52B788'
    ctx.lineWidth = 2.1 * s
    ctx.lineCap = 'round'
    ctx.stroke()

    // 水畔高光
    ctx.beginPath()
    ctx.moveTo(8 * s, 47 * s)
    ctx.bezierCurveTo(20 * s, 51 * s, 32 * s, 43 * s, 46 * s, 47 * s)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 0.9 * s
    ctx.stroke()

    // 造物之光（小圆，寓意日出 / 匠心）
    ctx.beginPath()
    ctx.arc(41 * s, 17 * s, 4.2 * s, 0, Math.PI * 2)
    const sunGrad = ctx.createRadialGradient(39 * s, 15 * s, 0, 41 * s, 17 * s, 6 * s)
    sunGrad.addColorStop(0, '#f0e6c8')
    sunGrad.addColorStop(0.5, '#c4a55a')
    sunGrad.addColorStop(1, '#9a7b3a')
    ctx.fillStyle = sunGrad
    ctx.fill()

    ctx.restore()
}

/** 文本超出宽度时省略 */
function clipPosterText(ctx, text, maxW) {
    const t = String(text || '')
    if (ctx.measureText(t).width <= maxW) return t
    let lo = 0
    let hi = t.length
    let best = '…'
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const sub = t.slice(0, mid) + '…'
        if (ctx.measureText(sub).width <= maxW) {
            best = sub
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return best
}

// --- 🔒 安全逻辑 (Security Layer) ---
const isUnlocked = ref(false)
const securityKey = ref('')
const isPrivacy = ref(false)
const showFinanceAI = ref(false)
const syncing = ref(false)
const syncStatus = ref('')
const duplicateCleanupVisible = ref(false)
const duplicateCleanupLoading = ref(false)
const duplicateCleanupPreview = ref(null)
const duplicateCleanupStatus = ref('')
const activeAnalysisTab = ref('cost-detail')
const activeCashflowTab = ref('cashflow')
const dateRange = ref(null)
const financeRecordStoreId = ref('')
const ledgerStoreFilter = ref('all')
const monthlyStoreFilter = ref('all')
const filteredCount = ref(-1)

const financeStorePickOptions = computed(() => {
  const b = loadStoreBundle()
  const opts = [{ value: '', label: '不关联门店' }]
  ;(b.stores || []).forEach((s) => {
    const value = resolveFinanceStoreWriteId(s) || s.id
    opts.push({ value, label: `${s.code || '—'} · ${s.name}` })
  })
  return opts
})

const financeStoreLedgerOptions = computed(() => {
  const b = loadStoreBundle()
  const opts = [
    { value: 'all', label: '全部门店' },
    { value: '__unassigned__', label: '未关联门店' },
  ]
  ;(b.stores || []).forEach((s) => {
    const value = resolveFinanceStoreWriteId(s) || s.id
    opts.push({ value, label: `${s.code || '—'} · ${s.name}` })
  })
  return opts
})
const reportPeriodSelect = ref('current')
const pendingInventoryLines = ref([])   // 本次识别到的库存，用于同步到藏品档案库
const syncInventoryLoading = ref(false)
const syncInventoryResult = ref(null)   // { updated: number, updatedList: [], unmatched: [] }

/** 每月总结要点：仅文字按 yyyy-MM 存本地（要点图为运行时自动生成） */
const MONTHLY_BRIEF_LS_KEY = 'sc_finance_monthly_brief_v1'
const monthlyBriefText = ref('')
const lastLoadedBriefMonth = ref('')
let monthlyBriefSaveTimer = null

function loadMonthlyBriefForMonth(month) {
    if (!month) return
    try {
        const raw = localStorage.getItem(MONTHLY_BRIEF_LS_KEY)
        const all = raw ? JSON.parse(raw) : {}
        const row = all[month] || {}
        monthlyBriefText.value = typeof row.text === 'string' ? row.text : ''
    } catch {
        monthlyBriefText.value = ''
    }
}

function persistMonthlyBriefFromUI() {
    const month = document.getElementById('monthSelect')?.value
    if (!month) return
    try {
        const raw = localStorage.getItem(MONTHLY_BRIEF_LS_KEY)
        const all = raw ? JSON.parse(raw) : {}
        all[month] = { text: monthlyBriefText.value }
        localStorage.setItem(MONTHLY_BRIEF_LS_KEY, JSON.stringify(all))
    } catch (e) {
        console.warn('保存月度要点失败:', e)
    }
}

function schedulePersistMonthlyBrief() {
    clearTimeout(monthlyBriefSaveTimer)
    monthlyBriefSaveTimer = setTimeout(persistMonthlyBriefFromUI, 400)
}

function downloadMonthlyBriefPoster() {
    const canvas = document.getElementById('monthlyBriefPoster')
    const month = document.getElementById('monthSelect')?.value
    if (!canvas || !month) {
        ElMessage.warning('请先选择月份')
        return
    }
    try {
        const a = document.createElement('a')
        a.download = `门店营收成绩单-${month}.png`
        a.href = canvas.toDataURL('image/png')
        a.click()
        ElMessage.success('已开始下载')
    } catch (e) {
        ElMessage.error('导出失败：' + (e.message || '未知错误'))
    }
}

function generateMonthlyBriefFromData() {
    const month = document.getElementById('monthSelect')?.value
    if (!month) {
        ElMessage.warning('请先选择月份')
        return
    }
    const s = app.getSettings()
    const mData = app.data.filter((r) => r.date.startsWith(month))
    const totalRev = mData.reduce((a, b) => a + (b.revenue || 0), 0)
    const totalProfit = mData.reduce((a, b) => a + (b.profit ?? app.calcProfit(b.revenue || 0, s).net), 0)
    const margin = totalRev ? (totalProfit / totalRev) * 100 : 0
    const targetPct = s.target > 0 ? (totalRev / s.target) * 100 : 0
    const [y, mm] = month.split('-').map(Number)
    const label = `${y}年${mm}月`
    const mall = computeMallCommission(totalRev, s)
    const mallAmt = mall.fee
    const parts = [
        `${label}累计营收 ¥${Math.round(totalRev).toLocaleString()}，`,
        totalProfit >= 0
            ? `净利润 ¥${Math.round(totalProfit).toLocaleString()}（净利率 ${margin.toFixed(1)}%）。`
            : `净亏损 ¥${Math.round(Math.abs(totalProfit)).toLocaleString()}。`,
        `月目标达成 ${Math.round(targetPct)}%。`,
    ]
    if (mallAmt > 0) {
        parts.push(
            `商场月累计超额分成约 ¥${Math.round(mallAmt).toLocaleString()}（月营收超过 ¥${Math.round(mall.threshold).toLocaleString()} 的部分 × ${mall.ratePct}%）。`,
        )
    } else {
        parts.push('本月营收未超过商场抽成阈值，无月累计超额分成。')
    }
    monthlyBriefText.value = parts.join('')
    persistMonthlyBriefFromUI()
    ElMessage.success('已生成要点，可按需修改')
}

// 同步处理函数
const handleSync = async () => {
  syncing.value = true
  syncStatus.value = '正在同步到云端...'
  try {
    const result = await manualSyncFinanceData({ uploadOnly: true })
    if (result.records.success && result.settings.success) {
      syncStatus.value = '✅ 同步成功！数据已上传到云端'
      ElMessage.success('财务数据已同步到云端')
      setTimeout(() => {
        syncStatus.value = ''
      }, 5000)
    } else {
      const errors = []
      if (!result.records.success) errors.push('记录同步失败')
      if (!result.settings.success) errors.push('设置同步失败')
      syncStatus.value = `⚠️ 部分同步失败：${errors.join('，')}`
      ElMessage.warning('部分数据同步失败')
    }
  } catch (error) {
    syncStatus.value = `❌ 同步失败：${error.message}`
    ElMessage.error('同步失败：' + error.message)
  } finally {
    syncing.value = false
  }
}

const handleExport = (command) => {
    if (command === 'excel') {
        app.exportExcel();
    } else if (command === 'csv') {
        app.exportCSV();
    } else if (command === 'json') {
        app.exportJSON();
    }
};

const openDuplicateCleanupPreview = async () => {
  duplicateCleanupLoading.value = true
  duplicateCleanupStatus.value = ''
  try {
    await autoSyncFinanceData({ forceDownload: false })
    const raw = localStorage.getItem(FINANCE_RECORDS_KEY)
    const rows = raw ? JSON.parse(raw) : []
    duplicateCleanupPreview.value = previewDuplicateCleanup(Array.isArray(rows) ? rows : [])
    duplicateCleanupVisible.value = true
  } catch (err) {
    ElMessage.error(`预览失败：${err.message}`)
  } finally {
    duplicateCleanupLoading.value = false
  }
}

const confirmDuplicateCleanup = async () => {
  if (!duplicateCleanupPreview.value?.removeCount) return
  try {
    await ElMessageBox.confirm(
      `将删除 ${duplicateCleanupPreview.value.removeCount} 条重复日账（约虚增 ¥${duplicateCleanupPreview.value.totalInflatedRevenue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}），并同步 CloudBase finance_records。此操作不可撤销，是否继续？`,
      '确认清理重复日账',
      { type: 'warning', confirmButtonText: '确认清理', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  duplicateCleanupLoading.value = true
  try {
    const result = await cleanupDuplicateFinanceRecords({ syncCloud: true })
    if (result.cloudError) {
      duplicateCleanupStatus.value = `本地已清理 ${result.removedCount} 条；云端部分失败：${result.cloudError}（可稍后点「同步到云端」重试）`
      ElMessage.warning(duplicateCleanupStatus.value)
    } else {
      duplicateCleanupStatus.value = `已清理 ${result.removedCount} 条重复日账（本地 ${result.localCount} → ${result.mergedCount}；云端删除 ${result.cloudRemoved || 0} 条）`
      ElMessage.success('重复日账清理完成')
    }
    duplicateCleanupVisible.value = false
    if (window.app?.loadData) await window.app.loadData()
  } catch (err) {
    ElMessage.error(`清理失败：${err.message}`)
  } finally {
    duplicateCleanupLoading.value = false
  }
}

const handleDownload = async () => {
  syncing.value = true
  syncStatus.value = '正在从云端下载数据...'
  try {
    const result = await manualSyncFinanceData({ downloadOnly: true })
    if (result.records.success && result.settings.success) {
      syncStatus.value = '✅ 下载成功！已从云端同步最新数据'
      ElMessage.success('已从云端同步最新数据')
      // 重新加载数据
      await app.loadData()
      await nextTick()
      app.renderAll()
      syncStatus.value = ''
    } else {
      syncStatus.value = '⚠️ 下载失败，请检查网络连接'
      ElMessage.warning('下载失败')
    }
  } catch (error) {
    syncStatus.value = `❌ 下载失败：${error.message}`
    ElMessage.error('下载失败：' + error.message)
  } finally {
    syncing.value = false
  }
}

/** 股东口令：优先读 .env 的 VITE_FINANCE_PASSWORD，缺省时沿用旧值（开发体验不变） */
const FINANCE_SECRET = import.meta.env.VITE_FINANCE_PASSWORD || 'money888'
/** 24 小时免登记忆：通过则后续打开模块直接进入 */
const FINANCE_SESSION_KEY = 'sc_finance_unlocked_until'
const FINANCE_SESSION_TTL = 24 * 60 * 60 * 1000

const restoreFinanceSession = () => {
    try {
        const until = parseInt(localStorage.getItem(FINANCE_SESSION_KEY) || '0', 10)
        if (until && until > Date.now()) {
            isUnlocked.value = true
            return true
        }
    } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    return false
}

const handleUnlock = () => {
    if (securityKey.value === FINANCE_SECRET) {
        isUnlocked.value = true
        try { localStorage.setItem(FINANCE_SESSION_KEY, String(Date.now() + FINANCE_SESSION_TTL)) } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
        ensureDefaultFinanceStoreInLocalBundle()
        financeRecordStoreId.value = findDefaultFinanceStoreId(loadStoreBundle()) || ''
        // 关键：解锁后，DOM才会被渲染，此时再初始化图表和数据
        nextTick(async () => {
            await app.init()
        })
        ElMessage.success('身份验证通过')
    } else {
        ElMessage.error('口令错误，拒绝访问')
        securityKey.value = ''
    }
}

const handleFinanceLogout = () => {
    isUnlocked.value = false
    securityKey.value = ''
    try { app.clearTimers() } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    try { app.destroyAllCharts() } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    try { localStorage.removeItem(FINANCE_SESSION_KEY) } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    ElMessage.info('已退出财务模块')
}

// --- 📊 原始业务逻辑 (保持不变) ---
const app = reactive({
    data: [], 
    tempRecord: null,
    charts: { trend: null, equity: null, order: null, cost: null, costBar: null, forecast: null, cashflow: null, comparisonRevenue: null, comparisonProfit: null },

    // 统一销毁所有图表，防止内存泄漏
    destroyAllCharts() {
        Object.keys(this.charts).forEach(key => {
            if(this.charts[key]) {
                try {
                    this.charts[key].destroy();
                } catch(e) {
                    console.warn(`销毁图表 ${key} 时出错:`, e);
                }
                this.charts[key] = null;
            }
        });
    },

    // 安全获取DOM元素
    safeGetElement(id) {
        const el = document.getElementById(id);
        if(!el) {
            console.warn(`元素 ${id} 不存在`);
        }
        return el;
    },

    _timers: [],
    _setTimer(fn, ms) {
        const id = setTimeout(fn, ms);
        this._timers.push(id);
        return id;
    },
    clearTimers() {
        this._timers.forEach(id => clearTimeout(id));
        this._timers = [];
    },

    async init() {
        await this.loadData();
        this.restoreSettings();
        this.bindEvents();
        await nextTick();
        this._setTimer(() => this.renderAll(), 100);
    },

    bindEvents() {
        let renderTimer;
        document.querySelectorAll('.calc-trigger').forEach(el => {
            el.addEventListener('input', () => {
                clearTimeout(renderTimer);
                renderTimer = this._setTimer(() => {
                    if (!document.getElementById('setTarget')) return;
                    try {
                        const s = this.getSettings();
                        this.persistSettings(s);
                        this.renderAll();
                    } catch(error) {
                        console.error('渲染时出错:', error);
                        ElMessage.error('渲染失败，请刷新页面重试');
                    }
                }, 300);
            });
        });
    },

    async loadData() {
        // 先尝试从云端同步数据
        try {
            await autoSyncFinanceData()
        } catch (error) {
            console.warn('自动同步失败，使用本地数据:', error)
        }

        ensureDefaultFinanceStoreInLocalBundle()
        const bundle = loadStoreBundle()
        const defId = findDefaultFinanceStoreId(bundle)
        const defStore = defId ? findStoreById(bundle, defId) : null

        const str = localStorage.getItem(FINANCE_RECORDS_KEY);
        if(str) this.data = JSON.parse(str);
        else this.data = [];

        const now = Date.now()
        let stamped = false
        this.data = this.data.map((r) => {
            if (r && !r._updateTime) {
                stamped = true
                return { ...r, _updateTime: now }
            }
            return r
        })
        if (stamped) this.saveData({ skipCloudSync: true })

        if (defId && defStore && Array.isArray(this.data) && this.data.length) {
            let patched = false
            this.data = this.data.map((r) => {
                if (r && !r.storeId) {
                    patched = true
                    return {
                        ...r,
                        storeId: defId,
                        storeCode: defStore.code || '',
                        storeName: defStore.name || '',
                    }
                }
                if (r && r.storeId && !r.storeCode) {
                    const st = findStoreById(bundle, r.storeId)
                    if (st?.code) {
                        patched = true
                        return {
                            ...r,
                            storeCode: st.code,
                            storeName: r.storeName || st.name || '',
                        }
                    }
                }
                return r
            })
            if (patched) this.saveData()
        }

        const beforeCount = this.data.length
        this.data = dedupeFinanceRecords(this.data)
        if (this.data.length < beforeCount) {
            this.saveData()
        }

        financeRecordStoreId.value = findDefaultFinanceStoreId(loadStoreBundle()) || ''
    },
    saveData(options = {}) {
        const { skipCloudSync = false } = options
        const now = Date.now()
        this.data = dedupeFinanceRecords(
            this.data.map((r) => ({
                ...r,
                _updateTime: r._updateTime || now,
            })),
        );
        localStorage.setItem(FINANCE_RECORDS_KEY, JSON.stringify(this.data));
        touchLocalFinanceUpdateTime()
        if (!skipCloudSync) {
            autoSyncFinanceData().catch(err => {
                console.warn('自动同步失败:', err);
            });
        }
    },

    getSettings() {
        const raw = {};
        const val = (id) => {
            const el = document.getElementById(id);
            const v = el ? (parseFloat(el.value) || 0) : 0;
            raw[id] = v;
            return v;
        };
        const settings = {
            target: val('setTarget'),
            invest: val('setInvest'),
            investCount: val('setInvestCount') || 1,
            costRate: val('setCostRate') / 100,
            earlyShare: val('setEarlyShare') / 100,
            lateShare: val('setLateShare') / 100,
            rent: val('setRent'),
            mallThreshold: (() => {
                const v = val('setMallThreshold')
                return v > 0 ? v : DEFAULT_MALL_THRESHOLD
            })(),
            mallRate: (() => {
                const v = val('setMallRate')
                if (!v || v < 0) return DEFAULT_MALL_RATE
                return v / 100
            })(),
            utility: val('setUtility'),
            staffCount: val('setStaffCount'),
            staffSalary: val('setStaffSalary'),
            commRate: val('setCommRate') / 100,
            tax: val('setTax') / 100
        };
        settings._raw = raw;
        return settings;
    },

    persistSettings(settings) {
        if (!document.getElementById('setTarget')) return;
        const raw = settings?._raw || this.getSettings()._raw;
        try {
            localStorage.setItem('sc_finance_settings_v1', JSON.stringify(raw));
        } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    },

    restoreSettings() {
        try {
            const raw = localStorage.getItem('sc_finance_settings_v1');
            if (!raw) return;
            const cfg = JSON.parse(raw);
            const values = Object.values(cfg).map(v => parseFloat(v) || 0);
            if (values.length && values.every(v => v === 0)) {
                localStorage.removeItem('sc_finance_settings_v1');
                return;
            }
            Object.entries(cfg).forEach(([id, v]) => {
                const el = document.getElementById(id);
                if (el && v != null && v !== '') el.value = v;
            });
        } catch (e) { console.warn('恢复设置失败', e); }
    },

    calcProfit(revenue, s) {
        // 数据验证
        if(!s || typeof revenue !== 'number' || isNaN(revenue) || revenue < 0) {
            revenue = 0;
        }
        if(!s.rent || s.rent < 0) s.rent = 0;
        if(!s.utility || s.utility < 0) s.utility = 0;
        if(!s.staffCount || s.staffCount < 0) s.staffCount = 0;
        if(!s.staffSalary || s.staffSalary < 0) s.staffSalary = 0;
        if(!s.costRate || s.costRate < 0) s.costRate = 0;
        if(!s.commRate || s.commRate < 0) s.commRate = 0;
        if(!s.mallThreshold || s.mallThreshold < 0) s.mallThreshold = DEFAULT_MALL_THRESHOLD;
        if(!s.mallRate || s.mallRate < 0) s.mallRate = DEFAULT_MALL_RATE;
        if(!s.tax || s.tax < 0) s.tax = 0;
        
        const monthlyFixed = s.rent + s.utility + (s.staffCount * s.staffSalary);
        const dailyFixed = monthlyFixed / 30;
        const cogs = revenue * s.costRate;
        const comm = revenue * s.commRate;
        const mallCost = computeDailyMallCost(revenue, s);

        let opProfit = revenue - cogs - comm - mallCost - dailyFixed;
        if (opProfit > 0) opProfit *= (1 - s.tax);

        return { net: opProfit, fixed: dailyFixed };
    },

    calcDistribution(processedData, s) {
        let totalInvestReturn = 0;
        let totalOpReturn = 0;
        let isPaidBack = false;

        processedData.forEach(r => {
            const p = r.profit;
            if (p <= 0) return; 

            let investorShare = 0;
            let opShare = 0;

            if (!isPaidBack) {
                if (totalInvestReturn + (p * s.earlyShare) >= s.invest) {
                    investorShare = p * s.earlyShare;
                    opShare = p * (1 - s.earlyShare);
                    if(totalInvestReturn + investorShare >= s.invest) isPaidBack = true;
                } else {
                    investorShare = p * s.earlyShare;
                    opShare = p * (1 - s.earlyShare);
                }
            } else {
                investorShare = p * s.lateShare;
                opShare = p * (1 - s.lateShare);
            }

            totalInvestReturn += investorShare;
            totalOpReturn += opShare;
        });

        return { investTotal: totalInvestReturn, opTotal: totalOpReturn, isPaidBack };
    },

    renderAll() {
        if (!document.getElementById('setTarget')) return;
        this.data.sort((a,b) => new Date(a.date) - new Date(b.date));
        const s = this.getSettings();

        const processed = this.data.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return { ...r, profit: res.net, fixedCost: res.fixed };
        });

        const dist = this.calcDistribution(processed, s);

        this.renderMonthSelector();
        this.renderAnalysisMonthSelector();
        this.renderQuickDashboard(processed, s);
        this.renderMonthlyView(processed, s);
        this.renderShareholders(dist, s, processed);
        this.renderCumulative(processed, s);
        this.renderLedger(processed);
        
        // 延迟执行分析功能，确保DOM已渲染
        setTimeout(() => {
            this.renderCostAnalysis();
            this.renderFinanceWarning(processed, s);
            this.renderForecast();
            this.calculateHealthScore();
            this.renderCashflowAnalysis(processed, s);
            this.renderCostOptimization(processed, s);
            this.refreshFinanceReport();
        }, 100);
        
        this.applyPrivacy();
    },

    renderShareholders(dist, s, data) {
        const lblInvCount = this.safeGetElement('lblInvCount');
        if(!lblInvCount) return; // 防止未渲染时报错

        lblInvCount.innerText = s.investCount;
        this.setSafeText('valInvestTotal', '¥' + Math.round(dist.investTotal).toLocaleString());
        this.setSafeText('valInvestPer', '¥' + Math.round(dist.investTotal / s.investCount).toLocaleString());
        
        const roiPct = Math.min(100, (dist.investTotal / s.invest) * 100);
        const barInvestRoi = this.safeGetElement('barInvestRoi');
        const txtInvestRoi = this.safeGetElement('txtInvestRoi');
        if(barInvestRoi) barInvestRoi.style.width = roiPct + '%';
        if(txtInvestRoi) txtInvestRoi.innerText = roiPct.toFixed(1) + '%';
        
        const badge = this.safeGetElement('roiStatusBadge');
        if (dist.isPaidBack) {
            badge.innerText = "🎉 已回本盈利";
            badge.style.background = "#e8f8f5"; badge.style.color = "#27ae60";
        } else {
            badge.innerText = "⏳ 投资回收期";
            badge.style.background = "#fffaf0"; badge.style.color = "#f1948a";
        }

        this.setSafeText('valOpTotal', '¥' + Math.round(dist.opTotal).toLocaleString());
        const lblOpRate = this.safeGetElement('lblOpRate');
        const txtEarlyOp = this.safeGetElement('txtEarlyOp');
        const txtLateOp = this.safeGetElement('txtLateOp');
        if(lblOpRate) lblOpRate.innerText = dist.isPaidBack ? (100 - s.lateShare*100)+'%' : (100 - s.earlyShare*100)+'%';
        if(txtEarlyOp) txtEarlyOp.innerText = (100 - s.earlyShare*100) + '%';
        if(txtLateOp) txtLateOp.innerText = (100 - s.lateShare*100) + '%';

        const left = Math.max(0, s.invest - dist.investTotal);
        this.setSafeText('valLeft', '¥' + Math.round(left).toLocaleString());
        
        if (left <= 0) {
            const valPaybackDate = this.safeGetElement('valPaybackDate');
            if(valPaybackDate) {
                valPaybackDate.innerText = "已完成";
                valPaybackDate.style.color = "var(--success)";
            }
        } else {
            const recent = data.slice(-30);
            if (recent.length > 0) {
                const avgProfit = recent.reduce((a,b)=>a+b.profit,0) / recent.length;
                if (avgProfit > 0) {
                    const dailyShare = avgProfit * s.earlyShare; 
                    const daysLeft = Math.ceil(left / dailyShare);
                    const date = new Date();
                    date.setDate(date.getDate() + daysLeft);
                    const valPaybackDate = this.safeGetElement('valPaybackDate');
                    if(valPaybackDate) valPaybackDate.innerText = date.toISOString().substring(0,10);
                } else {
                    const valPaybackDate = this.safeGetElement('valPaybackDate');
                    if(valPaybackDate) valPaybackDate.innerText = "暂无盈利";
                }
            } else {
                const valPaybackDate = this.safeGetElement('valPaybackDate');
                if(valPaybackDate) valPaybackDate.innerText = "数据不足";
            }
        }
    },

    renderMonthlyView(data, s) {
        if (!data || !s) { this.renderAll(); return; }

        let month = document.getElementById('monthSelect').value;
        if(!month && data.length) {
            month = data[data.length-1].date.substring(0,7);
            document.getElementById('monthSelect').value = month;
        }
        
        const wrapper = document.getElementById('calendarArea');
        if(!month) {
            if(wrapper) wrapper.style.display = 'none';
            this.clearMallBriefDisplay();
            this.renderMonthlyBriefPoster([], '', s, null);
            lastLoadedBriefMonth.value = '';
            return;
        }
        wrapper.style.display = 'block';

        const bundle = loadStoreBundle();
        const msf = monthlyStoreFilter.value || 'all';
        let mData = data.filter(r => r.date && r.date.startsWith(month));
        if (msf !== 'all') {
            mData = mData.filter((r) => recordMatchesFinanceStoreFilter(r, msf, bundle));
        }
        const totalRev = mData.reduce((a,b)=>a+b.revenue,0);
        const totalProfit = mData.reduce((a,b)=>a+b.profit,0);
        
        // 计算订单相关数据
        const validOrderData = mData.filter(r => r.orderCount && r.orderCount > 0);
        const totalOrderCount = validOrderData.reduce((a,b)=>a+(b.orderCount||0),0);
        const avgOrderPrice = totalOrderCount > 0 ? totalRev / totalOrderCount : null;
        const daysWithData = mData.length;
        const dailyOrders = daysWithData > 0 ? (totalOrderCount / daysWithData).toFixed(1) : 0;
        const dailyRev = daysWithData > 0 ? (totalRev / daysWithData) : 0;

        this.setSafeText('monthRev', '¥'+Math.round(totalRev).toLocaleString());
        this.setSafeText('monthProfit', '¥'+Math.round(totalProfit).toLocaleString());
        
        const margin = totalRev ? (totalProfit/totalRev*100).toFixed(1) : 0;
        document.getElementById('monthMargin').innerText = margin + '%';
        const targetPct = s.target > 0 ? (totalRev / s.target) * 100 : 0;
        document.getElementById('monthTarget').innerText = Math.round(targetPct) + '%';
        
        // 显示订单相关数据
        if (totalOrderCount > 0) {
            document.getElementById('monthOrderCount').innerText = totalOrderCount.toLocaleString() + ' 单';
            if (avgOrderPrice) {
                this.setSafeText('monthAvgOrderPrice', '¥'+avgOrderPrice.toFixed(2));
            } else {
                document.getElementById('monthAvgOrderPrice').innerText = '-';
            }
        } else {
            document.getElementById('monthOrderCount').innerText = '-';
            document.getElementById('monthAvgOrderPrice').innerText = '-';
        }
        
        // 显示日均数据
        if (daysWithData > 0) {
            document.getElementById('monthDailyOrders').innerText = dailyOrders + ' 单/天';
            this.setSafeText('monthDailyRev', '¥'+Math.round(dailyRev).toLocaleString());
        } else {
            document.getElementById('monthDailyOrders').innerText = '-';
            document.getElementById('monthDailyRev').innerText = '-';
        }

        this.renderAnalysis(totalRev, totalProfit, margin, mData.length, s);

        // 商场分成（月累计口径：与 mallCommission SSOT 同源）
        const mall = computeMallCommission(totalRev, s);
        this.setSafeText('mallBriefMonthRev', '¥' + Math.round(mall.reached).toLocaleString());
        this.setSafeText('mallBriefThreshold', '¥' + Math.round(mall.threshold).toLocaleString());
        this.setSafeText('mallBriefExcess', '¥' + Math.round(mall.excess).toLocaleString());
        this.setSafeText('mallBriefAmount', '¥' + Math.round(mall.fee).toLocaleString());
        const mallRateHint = this.safeGetElement('mallBriefRateHint');
        if (mallRateHint) {
            mallRateHint.innerText = `扣点 ${mall.ratePct}% · 月累计对赌口径`;
        }

        if (month !== lastLoadedBriefMonth.value) {
            lastLoadedBriefMonth.value = month;
            loadMonthlyBriefForMonth(month);
        }
        this.renderMonthlyBriefPoster(mData, month, s, {
            totalRev,
            totalProfit,
            margin: Number(margin),
            targetPct: Number(targetPct),
            mallMonthCommission: mall.fee,
            daysWithData,
            totalOrderCount,
            avgOrderPrice,
            dailyRev,
            dailyOrdersStr: daysWithData > 0 ? String(dailyOrders) : '',
            targetRevenue: s.target,
            mallThreshold: mall.threshold,
            mallRatePct: mall.ratePct,
        });

        this.renderCalendar(month, mData);
        this.renderOrderChart(mData, month);
    },

    clearMallBriefDisplay() {
        ['mallBriefMonthRev', 'mallBriefThreshold', 'mallBriefExcess', 'mallBriefAmount'].forEach((id) =>
            this.setSafeText(id, '-'),
        );
        const mallRateHint = this.safeGetElement('mallBriefRateHint');
        if (mallRateHint) mallRateHint.innerText = '-';
    },

    /** 月度要点海报（VI 标本馆风格 · 门店营收成绩单）：红绸抬头 · 蝴蝶水印 · 金色金额 */
    renderMonthlyBriefPoster(mData, month, s, meta) {
        const canvas = document.getElementById('monthlyBriefPoster');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // A4 纵向（210×297mm，约 96dpi 等效像素，便于屏幕预览与打印导出）
        const W = 794;
        const H = 1180;
        const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        const roundRectPath = (x, y, w, h, r) => {
            const rr = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            ctx.closePath();
        };

        const fmtYuan = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString();
        const fmtYuan2 = (n) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return '¥0.00';
            return '¥' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        // ----- VI 调色（与 design-tokens.css 对齐） -----
        const VI = {
            paper0: '#fafaf5',
            paper1: '#f5f3ed',
            paper2: '#edebe4',
            cream: '#f5e9c6',
            ink: '#1a1815',
            inkSec: '#6b665d',
            inkTer: '#9b968d',
            green700: '#1b4332',
            green600: '#245a42',
            green500: '#2d6a4f',
            green400: '#3a9d6e',
            green300: '#52b788',
            green200: '#7ecbab',
            gold600: '#8b7534',
            gold500: '#a88d42',
            gold400: '#c4a55a',
            gold300: '#d4b86a',
            gold200: '#e3cf96',
            earth700: '#5c4b30',
            earth600: '#74603e',
            earth500: '#8b6f47',
            earth300: '#bca88e',
            earth100: '#e8dfd2',
            redInk: '#8b2e2e',
            redDeep: '#6b1414',
            redMain: '#7f1d1d',
            redAccent: '#d05450',
        };
        const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif';
        const FONT_MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';
        const FONT_SERIF = '"DM Serif Display", "Songti SC", "STSong", Georgia, serif';
        const FONT_HAND = '"STXingkai", "Xingkai SC", "Kaiti SC", "KaiTi", "STKaiti", serif';
        const PAD = Math.max(36, Math.round(44 * (W / 800)));
        const headerH = Math.round(84 * (H / 980));

        // ----- 蝴蝶水印（标本店主题） -----
        const drawButterfly = (cx, cy, size, opts = {}) => {
            const { rotation = 0, alpha = 0.05, color = VI.earth600 } = opts;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rotation);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            const sz = size;
            // 上左翼
            ctx.beginPath();
            ctx.moveTo(0, -sz * 0.05);
            ctx.bezierCurveTo(-sz * 0.18, -sz * 0.55, -sz * 0.62, -sz * 0.55, -sz * 0.6, -sz * 0.18);
            ctx.bezierCurveTo(-sz * 0.6, sz * 0.06, -sz * 0.32, sz * 0.05, 0, 0);
            ctx.closePath();
            ctx.fill();
            // 上右翼
            ctx.beginPath();
            ctx.moveTo(0, -sz * 0.05);
            ctx.bezierCurveTo(sz * 0.18, -sz * 0.55, sz * 0.62, -sz * 0.55, sz * 0.6, -sz * 0.18);
            ctx.bezierCurveTo(sz * 0.6, sz * 0.06, sz * 0.32, sz * 0.05, 0, 0);
            ctx.closePath();
            ctx.fill();
            // 下左翼
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-sz * 0.32, sz * 0.12, -sz * 0.5, sz * 0.4, -sz * 0.34, sz * 0.56);
            ctx.bezierCurveTo(-sz * 0.18, sz * 0.62, -sz * 0.04, sz * 0.4, 0, sz * 0.1);
            ctx.closePath();
            ctx.fill();
            // 下右翼
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(sz * 0.32, sz * 0.12, sz * 0.5, sz * 0.4, sz * 0.34, sz * 0.56);
            ctx.bezierCurveTo(sz * 0.18, sz * 0.62, sz * 0.04, sz * 0.4, 0, sz * 0.1);
            ctx.closePath();
            ctx.fill();
            // 翅膀眼斑
            ctx.globalAlpha = alpha * 1.4;
            ctx.fillStyle = VI.gold400;
            ctx.beginPath();
            ctx.arc(-sz * 0.4, -sz * 0.22, sz * 0.05, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(sz * 0.4, -sz * 0.22, sz * 0.05, 0, Math.PI * 2);
            ctx.fill();
            // 身体
            ctx.globalAlpha = alpha * 1.6;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(0, sz * 0.15, sz * 0.045, sz * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            // 触角
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(0.6, sz * 0.018);
            ctx.beginPath();
            ctx.moveTo(0, -sz * 0.18);
            ctx.quadraticCurveTo(-sz * 0.1, -sz * 0.4, -sz * 0.18, -sz * 0.46);
            ctx.moveTo(0, -sz * 0.18);
            ctx.quadraticCurveTo(sz * 0.1, -sz * 0.4, sz * 0.18, -sz * 0.46);
            ctx.stroke();
            ctx.restore();
        };

        const drawButterflyWatermark = () => {
            // 按 A4 画布比例分布，避开四角与底部签名区
            const hb = headerH + 8;
            const flock = [
                { x: W * 0.17, y: hb + 48, s: 58, r: -0.3, a: 0.08, c: VI.green500 },
                { x: W * 0.88, y: hb + 28, s: 48, r: 0.22, a: 0.07, c: VI.earth600 },
                { x: W * 0.52, y: hb + 92, s: 34, r: -0.4, a: 0.06, c: VI.gold500 },
                { x: W * 0.06, y: H * 0.45, s: 46, r: 0.28, a: 0.075, c: VI.gold500 },
                { x: W * 0.93, y: H * 0.44, s: 42, r: -0.18, a: 0.07, c: VI.green500 },
                { x: W * 0.08, y: H * 0.62, s: 48, r: 0.18, a: 0.07, c: VI.earth600 },
                { x: W * 0.91, y: H * 0.63, s: 52, r: 0.05, a: 0.07, c: VI.gold500 },
                { x: W * 0.28, y: H * 0.78, s: 34, r: -0.18, a: 0.05, c: VI.earth600 },
                { x: W * 0.58, y: H * 0.8, s: 30, r: 0.22, a: 0.05, c: VI.green500 },
            ];
            flock.forEach((b) => drawButterfly(b.x, b.y, b.s, { rotation: b.r, alpha: b.a, color: b.c }));
        };

        // ----- 纸面背景：暖纸渐变 + 细纤维 + 暖光带 -----
        const drawPaperBackground = () => {
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, VI.paper0);
            g.addColorStop(0.55, VI.paper1);
            g.addColorStop(1, VI.paper2);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            // 细纤维感
            ctx.save();
            ctx.fillStyle = 'rgba(116, 96, 62, 0.07)';
            for (let i = 0; i < 380; i++) {
                const x = (i * 137.508) % W;
                const y = (i * 73.31) % H;
                ctx.fillRect(x, y, 1, 1);
            }
            ctx.fillStyle = 'rgba(45, 106, 79, 0.04)';
            for (let i = 0; i < 220; i++) {
                const x = (i * 191.27) % W;
                const y = (i * 113.41) % H;
                ctx.fillRect(x, y, 1, 1);
            }
            ctx.restore();
            // 暖光纸带 + 微光晕
            ctx.save();
            ctx.globalAlpha = 0.55;
            const sheen = ctx.createLinearGradient(0, 0, 0, H);
            sheen.addColorStop(0, 'rgba(255,255,255,0.45)');
            sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
            sheen.addColorStop(1, 'rgba(232, 223, 210, 0.3)');
            ctx.fillStyle = sheen;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
            // 四角微暗角
            ctx.save();
            const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.7);
            vignette.addColorStop(0, 'rgba(0,0,0,0)');
            vignette.addColorStop(1, 'rgba(92, 75, 48, 0.12)');
            ctx.fillStyle = vignette;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
            // 文档外框
            ctx.strokeStyle = 'rgba(92, 75, 48, 0.32)';
            ctx.lineWidth = 1;
            roundRectPath(10, 10, W - 20, H - 20, 6);
            ctx.stroke();
        };

        drawPaperBackground();
        drawButterflyWatermark();

        // ====== 红绸表头 ======
        const redGrad = ctx.createLinearGradient(0, 0, 0, headerH);
        redGrad.addColorStop(0, VI.redInk);
        redGrad.addColorStop(0.5, VI.redDeep);
        redGrad.addColorStop(1, VI.redMain);
        ctx.fillStyle = redGrad;
        ctx.fillRect(0, 0, W, headerH);
        // 顶部内阴
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, 0, W, 2);
        // 红绸斜纹（金色 0.06 透明）
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.strokeStyle = VI.gold200;
        ctx.lineWidth = 0.8;
        for (let dx = -headerH; dx < W; dx += 16) {
            ctx.beginPath();
            ctx.moveTo(dx, 0);
            ctx.lineTo(dx + headerH, headerH);
            ctx.stroke();
        }
        ctx.restore();
        // 蝴蝶水印（红绸上的金色暗纹）
        drawButterfly(W / 2 + 130, headerH / 2 + 6, 60, { rotation: -0.18, alpha: 0.07, color: VI.gold200 });
        drawButterfly(W / 2 - 150, headerH / 2 - 4, 50, { rotation: 0.22, alpha: 0.06, color: VI.gold200 });
        // 底部金色双线
        ctx.fillStyle = VI.gold500;
        ctx.fillRect(0, headerH - 4, W, 1.5);
        ctx.fillStyle = VI.gold300;
        ctx.fillRect(0, headerH - 1.5, W, 1.5);
        // 中间小金菱形
        ctx.save();
        ctx.translate(W / 2, headerH - 12);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = VI.gold300;
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();

        // 品牌矢量标（随 A4 表头加高略下移）
        drawShanchuanBrandLogo(ctx, 24, 20, 52);
        // 中英品牌名
        ctx.textAlign = 'left';
        ctx.fillStyle = VI.cream;
        ctx.font = `600 17px ${FONT}`;
        ctx.fillText('山海造物', 86, 44);
        ctx.fillStyle = 'rgba(245, 233, 198, 0.72)';
        ctx.font = `600 9px ${FONT}`;
        ctx.fillText("NATURE'S CREATIONS", 86, 62);
        // 右侧：成绩单副标 + 月份
        ctx.textAlign = 'right';
        ctx.fillStyle = VI.gold300;
        ctx.font = `600 9px ${FONT}`;
        ctx.fillText('STORE REVENUE · SCORECARD', W - 22, 36);
        if (month) {
            const [yy, mmRaw] = month.split('-');
            const mm = String(mmRaw).padStart(2, '0');
            ctx.fillStyle = VI.cream;
            ctx.font = `bold 28px ${FONT_SERIF}`;
            ctx.fillText(`${yy}.${mm}`, W - 22, 66);
        }
        ctx.textAlign = 'left';

        if (!month || !meta) {
            ctx.fillStyle = VI.inkTer;
            ctx.font = `15px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText('请选择月份以生成本月要点海报', W / 2, H / 2);
            ctx.textAlign = 'left';
            return;
        }

        const sorted = [...(mData || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const revs = sorted.map((r) => Number(r.revenue) || 0);
        const profits = sorted.map((r) =>
            Number(r.profit ?? this.calcProfit(Number(r.revenue) || 0, s).net) || 0,
        );
        const hasAvg =
            meta.avgOrderPrice != null &&
            Number(meta.avgOrderPrice) > 0 &&
            Number(meta.totalOrderCount) > 0;

        // ====== TITLE（随 A4 增高略放大字号与行距）======
        const [yNum, mNum] = month.split('-').map(Number);
        const titleStr = `${yNum}年${mNum}月 · 门店营收成绩单`;
        const titleSealY = headerH + 40;
        const titleTextY = titleSealY + 22;
        const titleTailY = titleTextY - 6;
        const titleDotY = titleTextY - 5.3;
        const subY = titleSealY + 46;
        // 标题前红色印章式竖条
        ctx.fillStyle = VI.redInk;
        roundRectPath(PAD, titleSealY, 4, 24, 1);
        ctx.fill();
        // 标题主文
        ctx.fillStyle = VI.ink;
        ctx.font = `bold 30px ${FONT}`;
        ctx.fillText(titleStr, PAD + 12, titleTextY);
        // 标题尾部金色双线 + 红点装饰
        const titleTextW = ctx.measureText(titleStr).width;
        const tailX = PAD + 12 + titleTextW + 16;
        ctx.fillStyle = VI.gold400;
        ctx.fillRect(tailX, titleTailY, 66, 1.5);
        ctx.fillStyle = VI.gold200;
        ctx.fillRect(tailX, titleTailY + 4, 40, 1);
        ctx.fillStyle = VI.redAccent;
        ctx.beginPath();
        ctx.arc(tailX + 90, titleDotY, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // 副标：门店 · 周期（合并为一行，去除冗余）
        const storeCtx = buildPosterStoreContext(mData);
        ctx.fillStyle = VI.inkSec;
        ctx.font = `14px ${FONT}`;
        const storeBase = `门店 · ${storeCtx.primary}`;
        const subLineRaw = storeCtx.secondary ? `${storeBase}   ${storeCtx.secondary}` : storeBase;
        ctx.fillText(clipPosterText(ctx, subLineRaw, W - PAD * 2 - 12), PAD + 12, subY);

        // ====== HERO 双主指标卡（A4 加高主卡，数字略放大）======
        const heroX = PAD;
        const heroY = titleSealY + 86;
        const heroW = W - PAD * 2;
        const heroH = 220;
        // 主体白色卡片 + 微阴影
        ctx.save();
        ctx.shadowColor = 'rgba(92, 75, 48, 0.10)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = '#ffffff';
        roundRectPath(heroX, heroY, heroW, heroH, 14);
        ctx.fill();
        ctx.restore();
        // 主边框
        ctx.strokeStyle = 'rgba(116, 96, 62, 0.32)';
        ctx.lineWidth = 1;
        roundRectPath(heroX, heroY, heroW, heroH, 14);
        ctx.stroke();
        // 内描金描线（精致质感）
        ctx.strokeStyle = 'rgba(196, 165, 90, 0.45)';
        ctx.lineWidth = 0.6;
        roundRectPath(heroX + 6, heroY + 6, heroW - 12, heroH - 12, 10);
        ctx.stroke();
        // 顶部红绸饰条（VI 红）
        const topBarH = 4;
        const topGrad = ctx.createLinearGradient(heroX, 0, heroX + heroW, 0);
        topGrad.addColorStop(0, VI.redInk);
        topGrad.addColorStop(0.5, VI.redDeep);
        topGrad.addColorStop(1, VI.redInk);
        ctx.fillStyle = topGrad;
        roundRectPath(heroX, heroY, heroW, topBarH, 14);
        ctx.fill();
        // 红条上的金线（双线感）
        ctx.fillStyle = VI.gold400;
        ctx.fillRect(heroX, heroY + topBarH, heroW, 1);
        // 顶部四角金色花角
        const drawCornerFlourish = (cx, cy, dirX, dirY) => {
            ctx.save();
            ctx.strokeStyle = VI.gold500;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + 14 * dirX, cy);
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx, cy + 14 * dirY);
            ctx.stroke();
            ctx.fillStyle = VI.gold400;
            ctx.beginPath();
            ctx.arc(cx + 14 * dirX, cy, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, cy + 14 * dirY, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };
        drawCornerFlourish(heroX + 12, heroY + 14, 1, 1);
        drawCornerFlourish(heroX + heroW - 12, heroY + 14, -1, 1);
        drawCornerFlourish(heroX + 12, heroY + heroH - 12, 1, -1);
        drawCornerFlourish(heroX + heroW - 12, heroY + heroH - 12, -1, -1);

        // 中央竖分隔（金色 + 棕色虚线感）
        const midX = heroX + heroW / 2;
        ctx.strokeStyle = 'rgba(168, 141, 66, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX, heroY + 30);
        ctx.lineTo(midX, heroY + heroH - 26);
        ctx.stroke();
        // 中央装饰：小金菱形 + 红点
        ctx.save();
        ctx.translate(midX, heroY + heroH / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = VI.gold400;
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
        ctx.fillStyle = VI.redInk;
        ctx.beginPath();
        ctx.arc(midX, heroY + heroH / 2, 1.8, 0, Math.PI * 2);
        ctx.fill();

        const drawHeroNumber = (areaX, areaW, opt) => {
            const labelEn = opt.labelEn;
            const labelCn = opt.labelCn;
            const valueStr = opt.valueStr;
            const sub = opt.sub;
            const innerX = areaX + 28;
            const maxLine = areaW - 56;
            // 英文小标 + 红色装饰短条
            ctx.fillStyle = VI.redInk;
            ctx.fillRect(innerX, heroY + 26, 14, 1.5);
            ctx.fillStyle = VI.earth600;
            ctx.font = `600 10px ${FONT}`;
            ctx.fillText(labelEn, innerX + 22, heroY + 32);
            ctx.fillStyle = VI.ink;
            ctx.font = `600 14px ${FONT}`;
            ctx.fillText(labelCn, innerX, heroY + 56);
            // 大数字（金属金色渐变 / 亏损红 · 自适应字号 · 金色光晕）
            const len = String(valueStr).length;
            const size = len > 14 ? 40 : len > 11 ? 48 : 56;
            ctx.font = `bold ${size}px ${FONT_MONO}`;
            const numY = heroY + 128;
            const useLossRed = !!opt.loss;
            if (useLossRed) {
                ctx.fillStyle = VI.redInk;
            } else {
                const numGrad = ctx.createLinearGradient(innerX, numY - size + 4, innerX, numY + 6);
                numGrad.addColorStop(0, VI.gold500);
                numGrad.addColorStop(0.35, VI.gold300);
                numGrad.addColorStop(0.55, '#f0deaa');
                numGrad.addColorStop(0.78, VI.gold300);
                numGrad.addColorStop(1, VI.gold500);
                ctx.fillStyle = numGrad;
            }
            ctx.save();
            ctx.shadowColor = 'rgba(168, 141, 66, 0.32)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 1;
            ctx.fillText(clipPosterText(ctx, valueStr, maxLine), innerX, numY);
            ctx.restore();
            // 描金边（细线增强金属感）
            if (!useLossRed) {
                ctx.save();
                ctx.strokeStyle = 'rgba(110, 91, 40, 0.4)';
                ctx.lineWidth = 0.6;
                ctx.strokeText(clipPosterText(ctx, valueStr, maxLine), innerX, numY);
                ctx.restore();
            }
            // 副标
            if (sub) {
                ctx.fillStyle = VI.inkSec;
                ctx.font = `11px ${FONT}`;
                ctx.fillText(clipPosterText(ctx, sub, maxLine), innerX, heroY + 154);
            }
            // 进度条（金色填充，棕色底）
            if (opt.progress) {
                const barX = innerX;
                const barY = heroY + 170;
                const barW = areaW - 56;
                const barHv = 6;
                ctx.fillStyle = VI.earth100;
                roundRectPath(barX, barY, barW, barHv, 3);
                ctx.fill();
                const pct = Math.max(0, Math.min(1, Number(opt.progress.value) || 0));
                if (pct > 0) {
                    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                    if (useLossRed) {
                        grad.addColorStop(0, VI.redDeep);
                        grad.addColorStop(1, VI.redAccent);
                    } else {
                        grad.addColorStop(0, VI.gold500);
                        grad.addColorStop(0.6, VI.gold400);
                        grad.addColorStop(1, VI.gold300);
                    }
                    ctx.fillStyle = grad;
                    roundRectPath(barX, barY, Math.max(2, barW * pct), barHv, 3);
                    ctx.fill();
                }
                ctx.fillStyle = VI.earth700;
                ctx.font = `10px ${FONT}`;
                ctx.fillText(opt.progress.right || '', barX, barY + 22);
            }
        };

        const targetPct = Number(meta.targetPct) || 0;
        const targetPctInt = Math.round(targetPct);
        const marginPct = Number(meta.margin) || 0;
        const isLoss = meta.totalProfit < 0;

        drawHeroNumber(heroX, heroW / 2, {
            labelEn: 'MONTHLY REVENUE',
            labelCn: '当月营收',
            valueStr: fmtYuan(meta.totalRev),
            sub: `较月目标 ${fmtYuan(meta.targetRevenue || 0)} · 达成率 ${targetPctInt}%`,
            progress: {
                value: Math.min(1, targetPct / 100),
                right:
                    targetPct >= 100
                        ? `✦ 超额完成 · 已达 ${targetPctInt}%`
                        : `仍差 ${fmtYuan(Math.max(0, (meta.targetRevenue || 0) - meta.totalRev))}`,
            },
        });
        drawHeroNumber(midX, heroW / 2, {
            labelEn: 'EST. NET PROFIT',
            labelCn: '预估净利润',
            valueStr: fmtYuan(meta.totalProfit),
            loss: isLoss,
            sub: isLoss
                ? `本月亏损 · 已扣全部成本`
                : `净利率 ${marginPct.toFixed(1)}% · 已扣全部成本`,
            progress: {
                value: Math.max(0, Math.min(1, marginPct / 40)),
                right: isLoss
                    ? `净利率 ${marginPct.toFixed(1)}%`
                    : `健康区间 0%–40%（参考）`,
            },
        });

        // ====== CHART · 日营收走势（中英分行，避免同一行挤在一起）======
        const chartTitleY = heroY + heroH + 44;
        const chartTitleCnY = chartTitleY;
        const chartTitleEnY = chartTitleCnY + 22;
        const chartTitleBlockBottom = chartTitleEnY + 14;
        // 标题前红色竖条（覆盖双行标题区域）
        const redBarTop = chartTitleCnY - 11;
        const redBarH = chartTitleEnY - redBarTop + 16;
        ctx.fillStyle = VI.redInk;
        roundRectPath(PAD, redBarTop, 3, redBarH, 1.5);
        ctx.fill();
        ctx.fillStyle = VI.ink;
        ctx.font = `bold 15px ${FONT}`;
        ctx.fillText('日营收走势', PAD + 10, chartTitleCnY);
        const cnTitleW = ctx.measureText('日营收走势').width;
        // 标题底装饰：金色双短线（仅衬中文行宽）
        ctx.fillStyle = VI.gold400;
        const cnDecorW = Math.min(cnTitleW + 10, W - PAD * 2 - 24);
        ctx.fillRect(PAD + 10, chartTitleCnY + 8, cnDecorW, 1.5);
        ctx.fillStyle = VI.gold200;
        ctx.fillRect(PAD + 10, chartTitleCnY + 11, Math.max(22, cnDecorW - 8), 1);
        ctx.fillStyle = VI.inkTer;
        ctx.font = `12px ${FONT}`;
        const enLine = `Daily Revenue Trend · ${sorted.length} 天`;
        ctx.fillText(clipPosterText(ctx, enLine, W - PAD * 2 - 24), PAD + 10, chartTitleEnY);

        const plotX0 = PAD;
        const plotY0 = chartTitleBlockBottom;
        const plotW = W - PAD * 2;
        const plotH = 238;
        ctx.fillStyle = '#ffffff';
        roundRectPath(plotX0, plotY0, plotW, plotH, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(116, 96, 62, 0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();

        if (!revs.length) {
            ctx.fillStyle = VI.inkTer;
            ctx.font = `14px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText('本月暂无日流水 · 待录入', plotX0 + plotW / 2, plotY0 + plotH / 2);
            ctx.textAlign = 'left';
        } else {
            const padL = 52;
            const padR = 16;
            const padT = 26;
            const padB = 30;
            const innerX = plotX0 + padL;
            const innerY = plotY0 + padT;
            const innerW = plotW - padL - padR;
            const innerH = plotH - padT - padB;

            const maxR = Math.max(...revs, 1);
            const minR = Math.min(...revs, 0);
            const span = Math.max(maxR - minR, maxR * 0.08, 1);
            const lo = 0;
            const hi = maxR + span * 0.12;
            const n = revs.length;
            const step = n > 1 ? innerW / (n - 1) : 0;
            const gx = (i) => (n === 1 ? innerX + innerW / 2 : innerX + i * step);
            const gy = (v) => innerY + innerH - ((v - lo) / (hi - lo)) * innerH;

            // Y 轴刻度：4 等分（含 0）
            ctx.strokeStyle = 'rgba(116, 96, 62, 0.12)';
            ctx.lineWidth = 1;
            ctx.fillStyle = VI.inkTer;
            ctx.font = `10px ${FONT_MONO}`;
            ctx.textAlign = 'right';
            for (let g = 0; g <= 4; g++) {
                const yy = innerY + (g / 4) * innerH;
                ctx.beginPath();
                ctx.moveTo(innerX, yy);
                ctx.lineTo(innerX + innerW, yy);
                ctx.stroke();
                const val = hi - (g / 4) * (hi - lo);
                ctx.fillText('¥' + Math.round(val).toLocaleString(), innerX - 6, yy + 3);
            }
            ctx.textAlign = 'left';

            // 面积渐变（中式朱红）
            const areaGrad = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
            areaGrad.addColorStop(0, 'rgba(127, 29, 29, 0.32)');
            areaGrad.addColorStop(0.55, 'rgba(168, 58, 58, 0.14)');
            areaGrad.addColorStop(1, 'rgba(208, 84, 80, 0.02)');
            ctx.beginPath();
            ctx.moveTo(gx(0), innerY + innerH);
            for (let i = 0; i < n; i++) ctx.lineTo(gx(i), gy(revs[i]));
            ctx.lineTo(gx(n - 1), innerY + innerH);
            ctx.closePath();
            ctx.fillStyle = areaGrad;
            ctx.fill();

            // 主曲线（朱红）
            ctx.beginPath();
            ctx.moveTo(gx(0), gy(revs[0]));
            for (let i = 1; i < n; i++) ctx.lineTo(gx(i), gy(revs[i]));
            ctx.strokeStyle = VI.redMain;
            ctx.lineWidth = 2.4;
            ctx.lineJoin = 'round';
            ctx.stroke();

            // 日均参考虚线（金棕）
            const dailyAvg = Number(meta.dailyRev) || 0;
            if (dailyAvg > 0 && dailyAvg <= hi) {
                const yAvg = gy(dailyAvg);
                ctx.save();
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = VI.earth600;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(innerX, yAvg);
                ctx.lineTo(innerX + innerW, yAvg);
                ctx.stroke();
                ctx.restore();
                ctx.fillStyle = VI.earth700;
                ctx.font = `10px ${FONT}`;
                ctx.textAlign = 'right';
                ctx.fillText(`日均 ${fmtYuan(dailyAvg)}`, innerX + innerW - 6, yAvg - 6);
                ctx.textAlign = 'left';
            }

            // 数据点（白心 + 朱红环）
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = VI.redDeep;
            ctx.lineWidth = 1.5;
            for (let i = 0; i < n; i++) {
                ctx.beginPath();
                ctx.arc(gx(i), gy(revs[i]), 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            // 峰值点：金色环 + 标签
            let peakIdx = 0;
            for (let i = 1; i < n; i++) if (revs[i] > revs[peakIdx]) peakIdx = i;
            const px = gx(peakIdx);
            const py = gy(revs[peakIdx]);
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = VI.gold400;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            const peakLabel = `峰值 ${fmtYuan(revs[peakIdx])} · ${sorted[peakIdx].date.slice(5).replace('-', '/')}`;
            ctx.font = `600 10px ${FONT}`;
            const labW = ctx.measureText(peakLabel).width + 14;
            const labH = 20;
            const labX = Math.min(innerX + innerW - labW, Math.max(innerX, px - labW / 2));
            const labY = Math.max(innerY + 4, py - labH - 8);
            ctx.fillStyle = '#ffffff';
            roundRectPath(labX, labY, labW, labH, 6);
            ctx.fill();
            ctx.strokeStyle = VI.gold500;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = VI.gold500;
            ctx.fillText(peakLabel, labX + 7, labY + 14);

            // X 轴 ticks（最多 5）
            ctx.fillStyle = VI.inkTer;
            ctx.font = `10px ${FONT}`;
            ctx.textAlign = 'center';
            const tickCount = Math.min(5, n);
            const tickIdx = [];
            for (let t = 0; t < tickCount; t++) {
                tickIdx.push(Math.round((t / Math.max(1, tickCount - 1)) * (n - 1)));
            }
            [...new Set(tickIdx)].forEach((i) => {
                const d = sorted[i].date;
                const short = d.slice(5).replace('-', '/');
                ctx.fillText(short, gx(i), innerY + innerH + 16);
            });
            ctx.textAlign = 'left';
        }

        // ====== KPI 4 卡（日均订单卡内合并展示总订单量）======
        const cardsY = plotY0 + plotH + 30;
        const cardsH = 118;
        const cardsGap = 10;
        const cardsCount = 4;
        const cardW = (W - PAD * 2 - (cardsCount - 1) * cardsGap) / cardsCount;
        const heroAvgStr = hasAvg ? fmtYuan2(meta.avgOrderPrice) : '—';
        const dailyRevStr = Number(meta.daysWithData) > 0 ? fmtYuan(meta.dailyRev) : '—';
        const dailyOrdersStr =
            meta.dailyOrdersStr && String(meta.dailyOrdersStr).length > 0 ? String(meta.dailyOrdersStr) : '—';

        const kpiCards = [
            { en: 'AVG TICKET', cn: '订单均价', val: heroAvgStr, unit: hasAvg ? '元/单' : '本月暂无订单' },
            { en: 'DAILY REVENUE', cn: '日均营收', val: dailyRevStr, unit: '元/天' },
            { en: 'DAILY ORDERS', cn: '日均订单', val: dailyOrdersStr, unit: '单/天', mergeTotalOrders: true },
            { en: 'MALL COMMISSION', cn: '商场提成', val: fmtYuan(meta.mallMonthCommission), unit: `阈值 ${fmtYuan(meta.mallThreshold)} · ${Number(meta.mallRatePct).toFixed(0)}%` },
        ];
        kpiCards.forEach((k, i) => {
            const x = PAD + i * (cardW + cardsGap);
            ctx.save();
            ctx.shadowColor = 'rgba(92, 75, 48, 0.08)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            ctx.fillStyle = '#fdfcf8';
            roundRectPath(x, cardsY, cardW, cardsH, 10);
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = 'rgba(116, 96, 62, 0.32)';
            ctx.lineWidth = 1;
            roundRectPath(x, cardsY, cardW, cardsH, 10);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(196, 165, 90, 0.4)';
            ctx.lineWidth = 0.5;
            roundRectPath(x + 4, cardsY + 4, cardW - 8, cardsH - 8, 7);
            ctx.stroke();
            ctx.fillStyle = VI.redInk;
            ctx.fillRect(x + 12, cardsY + 14, 12, 2);
            ctx.fillStyle = VI.gold400;
            ctx.fillRect(x + 26, cardsY + 14, 22, 1.5);

            ctx.fillStyle = VI.earth700;
            ctx.font = `600 9px ${FONT}`;
            ctx.fillText(k.en, x + 12, cardsY + 34);
            ctx.fillStyle = VI.ink;
            ctx.font = `600 12px ${FONT}`;
            ctx.fillText(k.cn, x + 12, cardsY + 52);

            const valStr = String(k.val);
            const sz = valStr.length > 12 ? 16 : valStr.length > 9 ? 18 : 21;
            ctx.font = `bold ${sz}px ${FONT_MONO}`;
            const numY = cardsY + 74;
            const isAmount = String(valStr).startsWith('¥');
            if (isAmount) {
                const numGrad = ctx.createLinearGradient(x, numY - sz, x, numY + 4);
                numGrad.addColorStop(0, VI.gold500);
                numGrad.addColorStop(0.45, VI.gold300);
                numGrad.addColorStop(0.6, '#f0deaa');
                numGrad.addColorStop(0.8, VI.gold300);
                numGrad.addColorStop(1, VI.gold500);
                ctx.fillStyle = numGrad;
                ctx.save();
                ctx.shadowColor = 'rgba(168, 141, 66, 0.28)';
                ctx.shadowBlur = 2.5;
                ctx.fillText(clipPosterText(ctx, valStr, cardW - 24), x + 12, numY);
                ctx.restore();
                ctx.save();
                ctx.strokeStyle = 'rgba(110, 91, 40, 0.4)';
                ctx.lineWidth = 0.5;
                ctx.strokeText(clipPosterText(ctx, valStr, cardW - 24), x + 12, numY);
                ctx.restore();
            } else {
                ctx.fillStyle = VI.ink;
                ctx.fillText(clipPosterText(ctx, valStr, cardW - 24), x + 12, numY);
            }

            if (k.mergeTotalOrders) {
                ctx.fillStyle = VI.earth700;
                ctx.font = `600 10px ${FONT}`;
                const totLine = `总订单 ${Number(meta.totalOrderCount) || 0} 单`;
                ctx.fillText(clipPosterText(ctx, totLine, cardW - 20), x + 12, cardsY + 92);
                ctx.fillStyle = VI.inkTer;
                ctx.font = `9px ${FONT}`;
                ctx.fillText(clipPosterText(ctx, `日均 · ${k.unit}`, cardW - 20), x + 12, cardsY + 108);
            } else {
                ctx.fillStyle = VI.inkTer;
                ctx.font = `9px ${FONT}`;
                ctx.fillText(clipPosterText(ctx, k.unit, cardW - 20), x + 12, cardsY + 108);
            }
        });

        // ====== 手写体致谢（股东与同仁）======
        const gratitudeLines = [
            '致各位股东与同仁：本月每一份成绩，皆源于各位的信任、坚守与付出。',
            '愿我们继续同心，把山海的美好带给更多人。',
            '谨致谢意，并致以最深的敬意。',
        ];
        let handY = cardsY + cardsH + 40;
        ctx.fillStyle = 'rgba(92, 75, 48, 0.9)';
        ctx.font = `15px ${FONT_HAND}`;
        const handMaxW = W - PAD * 2;
        gratitudeLines.forEach((line) => {
            ctx.fillText(clipPosterText(ctx, line, handMaxW), PAD, handY);
            handY += 26;
        });
        const handBlockBottom = handY + 10;

        const sectionBottom = handBlockBottom + 36;
        const brandSloganH = 46;
        const brandMarginBottom = 14;
        const minBrandY = sectionBottom + 22;
        const maxBrandY = H - brandSloganH - brandMarginBottom;
        let brandY = Math.min(maxBrandY, Math.max(minBrandY, sectionBottom + 30));

        const stampR = Math.round(Math.min(46, W * 0.058));
        const stampEdgeInset = Math.max(PAD - 4, 12);
        const stampX = W - stampEdgeInset - stampR - 2;
        let stampY = brandY - stampR - 26;
        const minStampY = handBlockBottom + stampR + 12;
        if (stampY < minStampY) stampY = minStampY;
        let stampBottom = stampY + stampR + 8;
        if (stampBottom > brandY - 20) {
            brandY = Math.min(maxBrandY, Math.max(minBrandY, stampBottom + 24));
            stampY = Math.max(minStampY, brandY - stampR - 26);
            stampBottom = stampY + stampR + 8;
            if (stampBottom > brandY - 18) {
                brandY = Math.min(maxBrandY, Math.max(minBrandY, stampBottom + 22));
            }
        }

        // ====== 红色印章（仅印章，无目标达成率模块）======
        const stampHash = (n) => ((n * 1103515245 + 12345) >>> 0) / 4294967296;
        ctx.save();
        ctx.translate(stampX, stampY);
        ctx.rotate(-0.065);
        const wash = ctx.createRadialGradient(0, 0, stampR * 0.15, 0, 0, stampR * 1.35);
        wash.addColorStop(0, 'rgba(139, 46, 46, 0.14)');
        wash.addColorStop(0.55, 'rgba(107, 20, 20, 0.07)');
        wash.addColorStop(1, 'rgba(139, 46, 46, 0)');
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.arc(0, 0, stampR + 6, 0, Math.PI * 2);
        ctx.fill();
        for (let p = 0; p < 4; p++) {
            const jitter = (stampHash(p + stampR) - 0.5) * 1.4;
            ctx.strokeStyle = `rgba(${107 + p * 8}, ${20 + p * 4}, ${20 + p * 4}, ${0.62 - p * 0.12})`;
            ctx.lineWidth = p === 0 ? 3 : 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, stampR + jitter * 0.6, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = 'rgba(139, 46, 46, 0.55)';
        ctx.beginPath();
        ctx.arc(0, 0, stampR - 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(139, 46, 46, 0.06)';
        ctx.beginPath();
        ctx.arc(0, 0, stampR - 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(107, 20, 20, 0.12)';
        for (let g = 0; g < 36; g++) {
            const ang = stampHash(g * 7) * Math.PI * 2;
            const rr = stampR * (0.35 + stampHash(g * 13) * 0.55);
            const px = Math.cos(ang) * rr;
            const py = Math.sin(ang) * rr;
            if (px * px + py * py < (stampR - 9) ** 2) {
                ctx.fillRect(px, py, 1, 1);
            }
        }
        const stampButterflySz = Math.round(stampR * 0.88);
        drawButterfly(0, -1, stampButterflySz, { rotation: 0, alpha: 0.9, color: VI.redDeep });
        ctx.fillStyle = 'rgba(107, 20, 20, 0.92)';
        const stampFontPx = Math.max(7, Math.round(stampR * 0.16));
        ctx.font = `600 ${stampFontPx}px ${FONT}`;
        const stampTxtR = stampR - 9;
        const drawStampArcChars = (txt, a0, a1) => {
            const n = txt.length;
            if (!n) return;
            for (let i = 0; i < n; i++) {
                const t = n <= 1 ? 0.5 : i / (n - 1);
                const a = a0 + (a1 - a0) * t;
                const ox = (stampHash(i + 60 + txt.charCodeAt(i)) - 0.5) * 0.45;
                const oy = (stampHash(i + 90) - 0.5) * 0.45;
                ctx.save();
                ctx.translate(Math.cos(a) * stampTxtR + ox, Math.sin(a) * stampTxtR + oy);
                ctx.rotate(a + Math.PI / 2);
                ctx.fillText(txt[i], -3, 2);
                ctx.restore();
            }
        };
        drawStampArcChars('山海造物·', -Math.PI * 0.97, -Math.PI * 0.61);
        drawStampArcChars('把山海带回家', -Math.PI * 0.39, -Math.PI * 0.05);
        ctx.fillStyle = 'rgba(139, 46, 46, 0.95)';
        ctx.beginPath();
        ctx.arc(0, stampR - 8, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ====== 品牌落款（致谢下方留白）======
        ctx.strokeStyle = 'rgba(196, 165, 90, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD, brandY - 16);
        ctx.lineTo(W - PAD - 8, brandY - 16);
        ctx.stroke();
        ctx.fillStyle = VI.gold500;
        ctx.font = `600 15px ${FONT_SERIF}`;
        ctx.fillText(
            clipPosterText(ctx, '山海造物 · 把山海带回家', W - PAD * 2 - 8),
            PAD,
            brandY,
        );
        ctx.fillStyle = VI.earth600;
        ctx.font = `italic 13px ${FONT}`;
        ctx.fillText(
            clipPosterText(ctx, "Nature's Creations · Bring Nature Home", W - PAD * 2 - 8),
            PAD,
            brandY + 22,
        );
    },

    renderOrderChart(mData, month) {
        const orderReportArea = document.getElementById('orderReportArea');
        const ctx = document.getElementById('orderChart');
        
        if (!orderReportArea || !ctx) return;
        
        // 如果没有订单数据，隐藏报表区域
        const hasOrderData = mData.some(r => r.orderCount && r.orderCount > 0);
        if (!hasOrderData) {
            orderReportArea.style.display = 'none';
            return;
        }
        
        orderReportArea.style.display = 'block';
        
        // 按日期排序
        const sortedData = [...mData].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // 准备图表数据
        const labels = sortedData.map(r => {
            const date = new Date(r.date);
            return `${date.getMonth() + 1}/${date.getDate()}`;
        });
        
        const orderCounts = sortedData.map(r => r.orderCount || 0);
        const avgOrderPrices = sortedData.map(r => {
            if (r.orderCount && r.orderCount > 0 && r.revenue > 0) {
                return parseFloat((r.revenue / r.orderCount).toFixed(2));
            }
            return 0;
        });
        
        // 销毁旧图表
        if (this.charts.order) {
            try {
                this.charts.order.destroy();
            } catch(e) {
                console.warn('销毁订单图表时出错:', e);
            }
        }
        
        // 创建新图表
        this.charts.order = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '订单数量',
                        data: orderCounts,
                        backgroundColor: 'rgba(45, 106, 79, 0.7)',
                        borderColor: 'rgba(45, 106, 79, 1)',
                        borderWidth: 1,
                        yAxisID: 'y',
                        order: 2
                    },
                    {
                        label: '日均订单金额 (元)',
                        data: avgOrderPrices,
                        type: 'line',
                        borderColor: '#c4a55a',
                        backgroundColor: 'rgba(196, 165, 90, 0.12)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        yAxisID: 'y1',
                        order: 1,
                        pointRadius: 4,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#a88d42'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: {
                                size: 12,
                                weight: 'bold'
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    if (context.datasetIndex === 0) {
                                        label += context.parsed.y + ' 单';
                                    } else {
                                        label += '¥' + context.parsed.y.toFixed(2);
                                    }
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 11
                            },
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '订单数量 (单)',
                            font: {
                                size: 12,
                                weight: 'bold'
                            }
                        },
                        ticks: {
                            stepSize: 1,
                            callback: function(value) {
                                return value + ' 单';
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: '日均订单金额 (元)',
                            font: {
                                size: 12,
                                weight: 'bold'
                            }
                        },
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toFixed(0);
                            }
                        },
                        grid: {
                            drawOnChartArea: false,
                        }
                    }
                }
            }
        });
    },

    renderAnalysis(rev, profit, margin, days, s) {
        const monthFixed = (s.rent + s.utility + s.staffCount*s.staffSalary);
        const maxVal = Math.max(monthFixed * 1.2, rev);
        const fixPct = Math.min(100, (monthFixed/maxVal)*100);
        const contribution = rev * (1 - s.costRate - s.commRate);
        const profitPct = Math.max(0, ((contribution - monthFixed)/maxVal)*100);

        document.getElementById('barFixed').style.width = fixPct + '%';
        document.getElementById('barProfit').style.width = profitPct + '%';
        this.setSafeText('lblFixed', '¥'+Math.round(monthFixed).toLocaleString());

        const doc = document.getElementById('aiDoctor');
        if(rev === 0) { doc.innerHTML = "本月暂无数据。"; return; }
        
        let html = "";
        const avg = rev / (days || 1);
        const variableRate = s.costRate + s.commRate + (s.mallRate * 0.5);
        const breakEven = (monthFixed/30) / (1 - variableRate);

        if(avg < breakEven) html += `⚠️ 日均 ¥${Math.round(avg)} 低于保本线 (¥${Math.round(breakEven)})。`;
        else html += `✅ 日均 ¥${Math.round(avg)} 已盈利，超保本线 ${(avg/breakEven*100-100).toFixed(0)}%。`;
        
        doc.innerHTML = html;
    },

    renderCalendar(monthStr, records) {
        const grid = this.safeGetElement('calGrid');
        if(!grid) return;
        
        grid.innerHTML = '';
        const [y, m] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const firstDay = new Date(y, m-1, 1).getDay();

        // 计算热力等级阈值（基于当月数据动态调整）
        const revenues = records.map(r => r.revenue).filter(r => r > 0);
        let thresholds = [2000, 5000, 8000]; // 默认阈值
        if(revenues.length > 0) {
            const sorted = [...revenues].sort((a, b) => a - b);
            const q1 = sorted[Math.floor(sorted.length * 0.25)];
            const q2 = sorted[Math.floor(sorted.length * 0.5)];
            const q3 = sorted[Math.floor(sorted.length * 0.75)];
            thresholds = [q1 || 2000, q2 || 5000, q3 || 8000];
        }

        // 填充空白日期
        for(let i=0; i<firstDay; i++) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'cal-day cal-empty';
            grid.appendChild(emptyDiv);
        }

        // 统计信息
        let totalRevenue = 0;
        let daysWithData = 0;
        let maxRevenue = 0;
        let minRevenue = Infinity;

        // 渲染日期
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const rec = records.find(r => r.date === dateStr);
            let html = '', cls = 'cal-day';
            let revenue = 0;
            let profit = 0;
            let orderCount = null;

            if(rec) {
                revenue = rec.revenue || 0;
                profit = rec.profit || 0;
                orderCount = rec.orderCount || null;
                
                // 动态热力等级
                if(revenue > thresholds[2]) cls += ' heat-4';
                else if(revenue > thresholds[1]) cls += ' heat-3';
                else if(revenue > thresholds[0]) cls += ' heat-2';
                else if(revenue > 0) cls += ' heat-1';
                else cls += ' heat-0';
                
                // 构建内容HTML
                html = `
                    <div class="cal-rev money-val">¥${Math.round(revenue)}</div>
                    ${profit !== 0 ? `<div class="cal-profit ${profit > 0 ? 'profit-positive' : 'profit-negative'}">${profit > 0 ? '+' : ''}¥${Math.round(profit)}</div>` : ''}
                    ${orderCount ? `<div class="cal-orders"><i class="fas fa-shopping-bag"></i> ${orderCount}</div>` : ''}
                `;
                
                totalRevenue += revenue;
                daysWithData++;
                if(revenue > maxRevenue) maxRevenue = revenue;
                if(revenue < minRevenue) minRevenue = revenue;
            } else { 
                cls += ' heat-0';
            }

            const div = document.createElement('div');
            div.className = cls;
            div.setAttribute('data-date', dateStr);
            div.innerHTML = `<div class="cal-num">${d}</div>${html}`;
            
            // 添加悬停提示
            if(rec) {
                div.setAttribute('title', `${dateStr}\n营收: ¥${Math.round(revenue)}\n${profit !== 0 ? `利润: ¥${Math.round(profit)}\n` : ''}${orderCount ? `订单: ${orderCount}单` : ''}`);
            }
            
            div.onclick = () => {
                const inputEl = this.safeGetElement('dailyInput');
                if(inputEl) {
                    inputEl.value = rec ? rec.raw : `${dateStr}，银联POS收款：0`;
                    inputEl.focus();
                }
                window.scrollTo({top:0, behavior:'smooth'});
            };
            
            grid.appendChild(div);
        }

        // 更新统计信息
        const statsEl = this.safeGetElement('calendarStats');
        if(statsEl && daysWithData > 0) {
            const avgRevenue = totalRevenue / daysWithData;
            statsEl.innerHTML = `
                <div class="stat-item">
                    <span class="stat-label">有数据天数</span>
                    <span class="stat-value">${daysWithData}/${daysInMonth}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">月总营收</span>
                    <span class="stat-value money-val">¥${Math.round(totalRevenue).toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">日均营收</span>
                    <span class="stat-value money-val">¥${Math.round(avgRevenue).toLocaleString()}</span>
                </div>
                ${maxRevenue > 0 ? `
                <div class="stat-item">
                    <span class="stat-label">最高单日</span>
                    <span class="stat-value money-val">¥${Math.round(maxRevenue).toLocaleString()}</span>
                </div>
                ` : ''}
            `;
        } else if(statsEl) {
            statsEl.innerHTML = '<div class="stat-empty">暂无数据</div>';
        }
    },

    renderCumulative(data, s) {
        const totalRev = data.reduce((a,b)=>a+b.revenue,0);
        const totalProfit = data.reduce((a,b)=>a+b.profit,0);
        
        this.setSafeText('totalRev', '¥'+Math.round(totalRev).toLocaleString());
        this.setSafeText('totalProfit', '¥'+Math.round(totalProfit).toLocaleString());

        const ctx = document.getElementById('trendChart');
        if (ctx) {
            if(this.charts.trend) this.charts.trend.destroy();
            const recent = data.slice(-30);
            
            // 智能处理标签：如果数据点多，只显示部分标签
            const labels = recent.map(r => r.date.substring(5));
            const labelCount = labels.length;
            const maxDisplayLabels = 15; // 最多显示15个标签
            const step = labelCount > maxDisplayLabels ? Math.ceil(labelCount / maxDisplayLabels) : 1;
            
            this.charts.trend = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '净利',
                            data: recent.map(r => r.profit),
                            type: 'line',
                            borderColor: '#52b788',
                            borderWidth: 2,
                            tension: 0.4,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: '#2d6a4f',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            fill: false
                        },
                        {
                            label: '营收',
                            data: recent.map(r => r.revenue),
                            backgroundColor: 'rgba(45, 106, 79, 0.5)',
                            borderRadius: 6,
                            borderSkipped: false
                        }
                    ]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    layout: {
                        padding: {
                            right: 10,
                            left: 10,
                            top: 10,
                            bottom: 5
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                padding: 15,
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                }
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(26, 24, 21, 0.92)',
                            padding: 12,
                            titleFont: {
                                size: 13,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 12
                            },
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += '¥' + Math.round(context.parsed.y).toLocaleString();
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                display: false
                            },
                            ticks: {
                                maxRotation: 45,
                                minRotation: 45,
                                font: {
                                    size: 10
                                },
                                callback: function(value, index) {
                                    const label = labels[index];
                                    if (!label) return '';
                                    // 如果标签太多，智能显示：首尾必须显示，中间按步长显示
                                    if (labelCount > maxDisplayLabels) {
                                        if (index === 0 || index === labels.length - 1) {
                                            return label;
                                        }
                                        if (index % step === 0) {
                                            return label;
                                        }
                                        return ''; // 不显示，Chart.js 会自动跳过
                                    }
                                    return label;
                                },
                                maxTicksLimit: maxDisplayLabels,
                                autoSkip: true,
                                autoSkipPadding: 8,
                                padding: 5
                            },
                            offset: false
                        },
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 11
                                },
                                padding: 8,
                                callback: function(value) {
                                    if (value >= 10000) {
                                        return '¥' + (value / 10000).toFixed(1) + '万';
                                    }
                                    return '¥' + Math.round(value).toLocaleString();
                                }
                            }
                        }
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    animation: {
                        duration: 1000,
                        easing: 'easeInOutQuart'
                    }
                }
            });
        }

        const ctx2 = document.getElementById('equityChart');
        if (ctx2) {
            if(this.charts.equity) {
                try {
                    this.charts.equity.destroy();
                } catch(e) {
                    console.warn('销毁股权图表时出错:', e);
                }
            }
            const dist = this.calcDistribution(data, s);
            this.charts.equity = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: ['投资人收益', '团队收益'],
                    datasets: [{ 
                        data: [dist.investTotal, dist.opTotal], 
                        backgroundColor: ['#2D6A4F', '#c4a55a']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position:'right' } } }
            });
        }
    },

    getFilteredData() {
        const searchText = document.getElementById('ledgerSearch')?.value.toLowerCase() || '';
        const s = this.getSettings();
        const processed = this.data.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return { ...r, profit: res.net };
        });
        let filtered = processed;
        
        if (dateRange.value && dateRange.value.length === 2) {
            const [start, end] = dateRange.value;
            filtered = filtered.filter(r => r.date >= start && r.date <= end);
        }

        const sf = ledgerStoreFilter.value || 'all';
        if (sf !== 'all') {
            const bundle = loadStoreBundle();
            filtered = filtered.filter((r) => recordMatchesFinanceStoreFilter(r, sf, bundle));
        }
        
        if (searchText) {
            filtered = filtered.filter(r => {
                const sn = (r.storeName || '').toLowerCase();
                const sc = (r.storeCode || '').toLowerCase();
                return r.date.includes(searchText) ||
                       r.revenue.toString().includes(searchText) ||
                       Math.round(r.profit).toString().includes(searchText) ||
                       (r.raw && r.raw.toLowerCase().includes(searchText)) ||
                       sn.includes(searchText) ||
                       sc.includes(searchText);
            });
        }
        return filtered;
    },

    filterLedger() {
        const filtered = this.getFilteredData();
        filteredCount.value = filtered.length;
        this.renderLedger(filtered);
    },

    resetFilters() {
        dateRange.value = null;
        ledgerStoreFilter.value = 'all';
        const searchInput = document.getElementById('ledgerSearch');
        if (searchInput) searchInput.value = '';
        filteredCount.value = -1;
        
        const s = this.getSettings();
        const processed = this.data.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return { ...r, profit: res.net };
        });
        this.renderLedger(processed);
    },

    exportFilteredData() {
        const filtered = this.getFilteredData();
        if (!filtered.length) {
            ElMessage.warning('筛选结果为空');
            return;
        }
        const s = this.getSettings();
        const exportData = filtered.map(r => ({
            "日期": r.date,
            "门店编码": r.storeCode || '',
            "门店名称": r.storeName || '',
            "银联POS营收": r.revenue,
            "订单数": r.orderCount || '',
            "订单均价": r.avgOrderPrice || '',
            "客单价": r.customerPrice || '',
            "估算净利": r.profit || this.calcProfit(r.revenue, s).net,
            "原始凭证": r.raw
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "筛选结果");
        
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const fileName = `山海造物_筛选结果_${dateStr}.xlsx`;
        XLSX.writeFile(wb, fileName);
        ElMessage.success(`已导出 ${filtered.length} 条筛选结果`);
    },

    renderLedger(data) {
        const container = document.getElementById('ledgerList');
        if(!data.length) {
            container.innerHTML = '<div style="padding:40px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const months = [...new Set(data.map(r => r.date.substring(0,7)))].sort().reverse();
        
        container.innerHTML = months.map((m, idx) => {
            const recs = data.filter(r => r.date.startsWith(m)).reverse();
            const mTotal = recs.reduce((a,b)=>a+b.revenue,0);
            
            const rows = recs.map(r => {
                const rowKey = ledgerKey(r, r.date)
                const storeCell = r.storeName || r.storeCode
                    ? `<div><span style="color:var(--primary);font-weight:600;">${r.storeCode || ''}</span> ${r.storeName || ''}</div>`
                    : '<span style="color:#bbb;">—</span>';
                return `
                <tr>
                    <td>${r.date}</td>
                    <td style="font-size:var(--text-sm);max-width:160px;">${storeCell}</td>
                    <td class="money-val" style="font-weight:bold; color:var(--primary);">¥${r.revenue}</td>
                    <td class="money-val" style="color:${r.profit>0?'var(--success)':'var(--light-text-tertiary)'}">¥${Math.round(r.profit)}</td>
                    <td><div class="raw-text" title="${r.raw}">${r.raw||'-'}</div></td>
                    <td style="text-align:center;">
                        <button class="btn-delete-record" data-key="${rowKey.replace(/"/g, '&quot;')}" title="删除此条记录">
                            <i class="fas fa-trash-alt"></i> 删除
                        </button>
                    </td>
                </tr>
            `;
            }).join('');

            return `
                <details class="month-group" ${idx===0 ? 'open' : ''}>
                    <summary>
                        <span>${m}</span>
                        <span>月收: <span class="money-val">¥${mTotal}</span></span>
                        <button class="btn-delete-month" data-month="${m}" title="删除此月所有记录">
                            <i class="fas fa-trash-alt"></i> 删除整月
                        </button>
                    </summary>
                    <table class="ledger-table">
                        <thead>
                            <tr>
                                <th>日期</th>
                                <th>门店</th>
                                <th>营收</th>
                                <th>净利</th>
                                <th>原始凭证</th>
                                <th style="text-align:center; width:100px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </details>
            `;
        }).join('');
        
        // 绑定单个记录删除事件
        container.querySelectorAll('.btn-delete-record').forEach(btn => {
            const key = btn.getAttribute('data-key');
            btn.onclick = (e) => {
                e.stopPropagation();
                this.delRecord(key);
            };
        });

        // 绑定整月删除事件
        container.querySelectorAll('.btn-delete-month').forEach(btn => {
            const month = btn.getAttribute('data-month');
            btn.onclick = (e) => {
                e.stopPropagation();
                this.delMonthRecords(month);
            };
        });

        this.applyPrivacy();
    },

    // 从文本中解析库存相关条目（支持山海造物日报格式：编号清单+缩进子项）
    parseInventoryFromText(text) {
        const lines = [];
        const seen = new Set();

        // 仅从分隔线或 "1." 开始的库存区块解析，避免把 订单数:99 等当库存
        const dashIndex = text.indexOf('—');
        const numListIndex = text.search(/\n\s*1[.．]\s*/);
        let inventoryBlock = text;
        if (dashIndex >= 0) {
            inventoryBlock = text.slice(dashIndex);
        } else if (numListIndex >= 0) {
            inventoryBlock = text.slice(numListIndex);
        }

        // 山海造物格式：1.蓝闪蝶 → 下级 戒指 59、手链 单珠 20、三珠24、8.蝴蝶翅膀耳钉20
        let category = null;
        const skipFinancial = /收款|订单数|线上|退款|现金|合计|元\s*$/;
        inventoryBlock.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || skipFinancial.test(trimmed)) return;

            // 编号行带数量：8.蝴蝶翅膀耳钉20
            const numNameQty = line.match(/^\s*\d+[.．]\s*([\u4e00-\u9fa5a-zA-Z]+)(\d+)\s*$/);
            if (numNameQty) {
                const name = (category ? category + '-' : '') + numNameQty[1].trim();
                const qty = parseInt(numNameQty[2], 10);
                if (qty <= 0 || qty > 99999) return;
                const key = name + '|' + qty;
                if (!seen.has(key)) {
                    seen.add(key);
                    lines.push({ name, qty });
                }
                return;
            }

            // 编号行仅类目：1.蓝闪蝶
            const numCategory = line.match(/^\s*\d+[.．]\s*([\u4e00-\u9fa5a-zA-Z\s]+?)\s*$/);
            if (numCategory) {
                category = numCategory[1].replace(/\s+/g, ' ').trim();
                return;
            }

            // 缩进行：名称+空格/制表+数字 或 名称+数字（如 戒指 59、三珠24）
            const withSpace = line.match(/^\s*([\u4e00-\u9fa5a-zA-Z\s]+?)\s+(\d+)\s*$/);
            if (withSpace) {
                const name = (category ? category + '-' : '') + withSpace[1].replace(/\s+/g, ' ').trim();
                const qty = parseInt(withSpace[2], 10);
                if (name.length < 1 || qty <= 0 || qty > 99999) return;
                const key = name + '|' + qty;
                if (!seen.has(key)) {
                    seen.add(key);
                    lines.push({ name, qty });
                }
                return;
            }
            const glued = line.match(/^\s*([\u4e00-\u9fa5a-zA-Z]+)(\d+)\s*$/);
            if (glued) {
                const name = (category ? category + '-' : '') + glued[1].trim();
                const qty = parseInt(glued[2], 10);
                if (qty <= 0 || qty > 99999) return;
                const key = name + '|' + qty;
                if (!seen.has(key)) {
                    seen.add(key);
                    lines.push({ name, qty });
                }
            }
        });

        // 总库存/库存合计
        const totalStockMatch = text.match(/(?:总?库存|库存合计)[:：\s]*(\d+)\s*件?/);
        if (totalStockMatch && !seen.has('总库存')) {
            seen.add('总库存');
            lines.push({ name: '总库存', qty: parseInt(totalStockMatch[1], 10) });
        }

        // 其他常见格式兜底
        const skuPatterns = [
            /(?:商品|SKU|品名|名称|款号)[:：\s]*([^，,\d\n]+?)[,，\s]*(\d+)\s*件/g,
            /([^\d,，\n]+?)[:：\s]*(\d+)\s*件/g,
        ];
        for (const re of skuPatterns) {
            let m;
            while ((m = re.exec(text)) !== null) {
                const name = m[1].replace(/\s+/g, ' ').trim();
                if (name.length < 2 || name.length > 50) continue;
                const qty = parseInt(m[2], 10);
                if (isNaN(qty) || qty < 0 || qty > 99999) continue;
                const key = name + '|' + qty;
                if (seen.has(key)) continue;
                seen.add(key);
                lines.push({ name, qty });
            }
        }

        const inlineRe = /([\u4e00-\u9fa5a-zA-Z0-9_\-\s]{2,30}?)\s*[（(]?\s*(\d+)\s*件\s*[）)]?/g;
        let inlineM;
        while ((inlineM = inlineRe.exec(text)) !== null) {
            const name = inlineM[1].replace(/\s+/g, ' ').trim();
            if (name.length < 2) continue;
            const qty = parseInt(inlineM[2], 10);
            if (isNaN(qty) || qty < 0) continue;
            const key = name + '|' + qty;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push({ name, qty });
        }

        const totalStock = totalStockMatch ? parseInt(totalStockMatch[1], 10) : null;
        return { inventoryLines: lines, totalStock };
    },

    parseInput() {
        const inputEl = this.safeGetElement('dailyInput');
        const msg = this.safeGetElement('parseMsg');
        const btn = this.safeGetElement('btnAdd');
        
        if(!inputEl || !msg || !btn) {
            console.error('解析输入所需的DOM元素不存在');
            return;
        }
        
        const text = inputEl.value.trim();
        if(!text) {
            msg.style.display = 'block';
            msg.className = 'alert alert-warning';
            msg.innerHTML = '⚠️ 请输入日报内容';
            btn.disabled = true;
            return;
        }

        const parsed = parseDailyFinanceText(text);
        const { inventoryLines, totalStock } = this.parseInventoryFromText(text);

        if (!parsed.ok) {
            msg.style.display = 'block';
            msg.className = 'alert alert-error';
            msg.innerHTML = `❌ ${parsed.error || '识别失败，请检查格式。'}`;
            btn.disabled = true;
            return;
        }

        const bundle = loadStoreBundle();
        const matched = matchStoreFromDailyText(text, bundle);
        if (matched) {
            financeRecordStoreId.value = resolveFinanceStoreWriteId(matched) || matched.id;
        }
        const sid =
            financeRecordStoreId.value ||
            findDefaultFinanceStoreId(bundle);
        const st = sid ? findStoreById(bundle, sid) : null;
        const writeId = st ? resolveFinanceStoreWriteId(st) || sid : sid;

        let orderCount = parsed.orderCount;
        let avgOrderPrice = null;
        let customerPrice = null;
        const revenue = parsed.revenue;
        if (orderCount != null && orderCount > 0 && revenue > 0) {
            avgOrderPrice = parseFloat((revenue / orderCount).toFixed(2));
            customerPrice = avgOrderPrice;
        }

        this.tempRecord = {
            date: parsed.date,
            revenue,
            pos: parsed.pos,
            online: parsed.online,
            refund: parsed.refund,
            cash: 0,
            cashIncome: 0,
            cashBalance: parsed.cashBalance,
            monthTotal: parsed.monthTotal,
            raw: text,
            orderCount: orderCount || null,
            avgOrderPrice: avgOrderPrice || null,
            customerPrice: customerPrice || null,
            inventoryLines: inventoryLines.length ? inventoryLines : null,
            totalStock: totalStock ?? null,
            storeId: writeId || undefined,
            storeCode: st ? st.code : '',
            storeName: st ? st.name : (parsed.storeNameHint || ''),
        };
        pendingInventoryLines.value = inventoryLines.length ? [...inventoryLines] : [];
        syncInventoryResult.value = null;

        let successMsg = `✅ 识别成功：<b>${parsed.date}</b> 营收 <b>¥${revenue}</b>（POS+线上−退款）`;
        if (st || parsed.storeNameHint) {
            successMsg += ` | 门店 <b>${st?.name || parsed.storeNameHint}</b>`;
        }
        if (orderCount != null) {
            successMsg += ` | 订单数 <b>${orderCount}</b>`;
            if (avgOrderPrice != null) successMsg += ` | 订单均价 <b>¥${avgOrderPrice}</b>`;
        }
        if (parsed.cashBalance != null) {
            successMsg += ` | 在手现金 <b>¥${Number(parsed.cashBalance).toLocaleString()}</b>`;
        }
        if (parsed.monthTotal != null) {
            successMsg += ` | 月合计 <b>¥${Number(parsed.monthTotal).toLocaleString()}</b>`;
        }
        if (inventoryLines.length > 0) {
            const invPreview = inventoryLines.slice(0, 6).map(i => `${i.name} ${i.qty}件`).join('；');
            successMsg += ` | 库存 <b>${invPreview}</b>${inventoryLines.length > 6 ? '…' : ''}`;
        }
        if (totalStock != null && inventoryLines.length === 0) {
            successMsg += ` | 总库存 <b>${totalStock}</b>件`;
        }
        
        msg.style.display = 'block';
        msg.className = 'alert alert-success';
        msg.innerHTML = successMsg;
        btn.disabled = false;
    },

    addRecord() {
        if(!this.tempRecord) {
            ElMessage.warning('请先识别日报内容');
            return;
        }
        
        try {
            // 数据验证
            if(!this.tempRecord.date || !this.tempRecord.revenue) {
                ElMessage.error('记录数据不完整');
                return;
            }
            
            if(isNaN(this.tempRecord.revenue) || this.tempRecord.revenue < 0) {
                ElMessage.error('营收金额无效');
                return;
            }
            
            const recordKey = ledgerKey(this.tempRecord, this.tempRecord.date)
            const idx = this.data.findIndex(r => ledgerKey(r, r.date) === recordKey);
            this.tempRecord._updateTime = Date.now()
            if(idx >= 0) {
                this.data[idx] = this.tempRecord;
                ElMessage.success('记录已更新');
            } else {
                this.data.push(this.tempRecord);
                ElMessage.success('记录已添加');
            }
            
            this.saveData(); 
            this.renderAll();
            
            const inputEl = this.safeGetElement('dailyInput');
            const msgEl = this.safeGetElement('parseMsg');
            const btnEl = this.safeGetElement('btnAdd');
            
            if(inputEl) inputEl.value = '';
            if(msgEl) msgEl.style.display = 'none';
            if(btnEl) btnEl.disabled = true;
            
            this.tempRecord = null;
            pendingInventoryLines.value = [];
            syncInventoryResult.value = null;
        } catch(error) {
            console.error('添加记录时出错:', error);
            ElMessage.error('添加记录失败：' + (error.message || '未知错误'));
        }
    },

    // 将本次识别的库存同步到藏品档案库（匹配商品标题并更新 stock）
    async syncInventoryToArchive() {
        const lines = pendingInventoryLines.value || [];
        if (!lines.length) {
            ElMessage.warning('当前无库存数据可同步，请先使用智能识别解析日报');
            return;
        }
        syncInventoryLoading.value = true;
        syncInventoryResult.value = null;
        try {
            const products = await fetchCollectionSorted(COLLECTIONS.PRODUCTS, {
                limit: 500,
                throwOnError: true,
                sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
            });
            const normalize = (s) => String(s || '').replace(/\s+/g, '').replace(/[-－—]/g, '').trim();

            const updatedList = [];
            const unmatched = [];

            for (const { name, qty } of lines) {
                const nName = normalize(name);
                if (!nName || qty == null) continue;
                const stockPayload = {
                    stock: Math.max(0, parseInt(qty, 10)),
                    updateTime: Date.now()
                };

                const exact = products.find(p => normalize(p.title) === nName);
                if (exact) {
                    await cdnUpdate(COLLECTIONS.PRODUCTS, exact._id, stockPayload);
                    updatedList.push({ name, qty, title: exact.title, _id: exact._id });
                    continue;
                }
                const partial = products.filter(p => {
                    const nTitle = normalize(p.title);
                    return nTitle && (nTitle.includes(nName) || nName.includes(nTitle));
                });
                if (partial.length === 1) {
                    const p = partial[0];
                    await cdnUpdate(COLLECTIONS.PRODUCTS, p._id, stockPayload);
                    updatedList.push({ name, qty, title: p.title, _id: p._id });
                } else if (partial.length > 1) {
                    const best = partial.sort((a, b) => Math.abs(normalize(a.title).length - nName.length) - Math.abs(normalize(b.title).length - nName.length))[0];
                    await cdnUpdate(COLLECTIONS.PRODUCTS, best._id, stockPayload);
                    updatedList.push({ name, qty, title: best.title, _id: best._id });
                } else {
                    unmatched.push({ name, qty });
                }
            }

            syncInventoryResult.value = { updated: updatedList.length, updatedList, unmatched };
            if (unmatched.length) pendingInventoryLines.value = unmatched.map(u => ({ name: u.name, qty: u.qty }));
            else pendingInventoryLines.value = [];
            ElMessage.success(`已同步 ${updatedList.length} 条库存到藏品档案库${unmatched.length ? `，${unmatched.length} 条未匹配` : ''}`);
        } catch (err) {
            console.error('同步库存到档案库失败:', err);
            ElMessage.error('同步失败：' + (err.message || '未知错误'));
            syncInventoryResult.value = { updated: 0, updatedList: [], unmatched: lines, error: err.message };
        } finally {
            syncInventoryLoading.value = false;
        }
    },

    async delRecord(recordKey) {
        try {
            const record = this.data.find(r => ledgerKey(r, r.date) === recordKey);
            const revenue = record ? `¥${record.revenue}` : '';
            const dateLabel = record?.date || recordKey.split('|')[1] || recordKey;
            await ElMessageBox.confirm(
                `确定要删除 ${dateLabel} 的记录吗？${revenue ? `（营收：${revenue}）` : ''}`,
                '确认删除',
                {
                    confirmButtonText: '确定删除',
                    cancelButtonText: '取消',
                    type: 'warning',
                    confirmButtonClass: 'el-button--danger'
                }
            );
            this.data = this.data.filter(r => ledgerKey(r, r.date) !== recordKey);
            this.saveData(); 
            this.renderAll();
            ElMessage.success('删除成功');
        } catch (error) {
            // 用户取消删除
            if (error !== 'cancel') {
                ElMessage.error('删除失败：' + (error.message || '未知错误'));
            }
        }
    },

    async delMonthRecords(month) {
        try {
            const monthRecords = this.data.filter(r => r.date.startsWith(month));
            const monthTotal = monthRecords.reduce((a, b) => a + b.revenue, 0);
            const count = monthRecords.length;
            await ElMessageBox.confirm(
                `确定要删除 ${month} 的所有记录吗？<br><br>共 ${count} 条记录，总营收：¥${Math.round(monthTotal).toLocaleString()}`,
                '确认删除整月数据',
                {
                    confirmButtonText: '确定删除',
                    cancelButtonText: '取消',
                    type: 'warning',
                    confirmButtonClass: 'el-button--danger',
                    dangerouslyUseHTMLString: true
                }
            );
            this.data = this.data.filter(r => !r.date.startsWith(month));
            this.saveData(); 
            this.renderAll();
            ElMessage.success(`已删除 ${month} 的所有记录（共 ${count} 条）`);
        } catch (error) {
            // 用户取消删除
            if (error !== 'cancel') {
                ElMessage.error('删除失败：' + (error.message || '未知错误'));
            }
        }
    },

    togglePrivacy() {
        isPrivacy.value = !isPrivacy.value;
        this.applyPrivacy();
    },

    applyPrivacy() {
        document.querySelectorAll('.money-val').forEach(el => {
            if(isPrivacy.value) {
                if(!el.dataset.orig) el.dataset.orig = el.innerText;
                el.innerText = '****';
                el.classList.add('blur-text');
            } else {
                if(el.dataset.orig) el.innerText = el.dataset.orig;
                el.classList.remove('blur-text');
            }
        });
    },

    setSafeText(id, txt) {
        const el = document.getElementById(id);
        if(!el) return;
        if(isPrivacy.value) el.dataset.orig = txt;
        else el.innerText = txt;
    },

    renderQuickDashboard(processed, s) {
        const todayStr = new Date().toISOString().split('T')[0];
        const today = new Date();
        const dayOfWeek = today.getDay();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const monthStartStr = todayStr.substring(0, 7) + '-01';

        const todayData = processed.find(r => r.date === todayStr);
        const weekData = processed.filter(r => r.date >= weekStartStr && r.date <= todayStr);
        const monthData = processed.filter(r => r.date >= monthStartStr && r.date <= todayStr);

        const fmt = (v) => v == null || v === '' ? '-' : '¥' + Math.round(v).toLocaleString();
        const todayRev = todayData ? todayData.revenue : null;
        const todayProfit = todayData ? (todayData.profit ?? this.calcProfit(todayData.revenue, s).net) : null;
        const weekRev = weekData.length ? weekData.reduce((a, b) => a + b.revenue, 0) : null;
        const weekProfit = weekData.length ? weekData.reduce((a, b) => a + (b.profit ?? this.calcProfit(b.revenue, s).net), 0) : null;
        const monthRev = monthData.length ? monthData.reduce((a, b) => a + b.revenue, 0) : null;
        const monthProfit = monthData.length ? monthData.reduce((a, b) => a + (b.profit ?? this.calcProfit(b.revenue, s).net), 0) : null;

        this.setSafeText('quickTodayRev', fmt(todayRev));
        this.setSafeText('quickTodayProfit', fmt(todayProfit));
        this.setSafeText('quickWeekRev', fmt(weekRev));
        this.setSafeText('quickWeekProfit', fmt(weekProfit));
        this.setSafeText('quickMonthRev', fmt(monthRev));
        this.setSafeText('quickMonthProfit', fmt(monthProfit));
    },

    renderMonthSelector() {
        const sel = document.getElementById('monthSelect');
        if(!sel) return;
        const cur = sel.value;
        const months = [...new Set(this.data.map(r => r.date.substring(0,7)))].sort().reverse();
        sel.innerHTML = '<option value="">-- 选择月份 --</option>';
        months.forEach(m => sel.add(new Option(m, m)));
        if(cur && months.includes(cur)) sel.value = cur;

        const reportCustomSel = document.getElementById('reportCustomMonth');
        if(reportCustomSel) {
            const customCur = reportCustomSel.value;
            reportCustomSel.innerHTML = '<option value="">-- 选择月份 --</option>';
            months.forEach(m => reportCustomSel.add(new Option(m, m)));
            if(customCur && months.includes(customCur)) reportCustomSel.value = customCur;
            else if(months.length > 0 && !customCur) reportCustomSel.value = months[0];
        }
    },

    renderAnalysisMonthSelector() {
        const sel = document.getElementById('analysisMonth');
        if(!sel) return;
        const cur = sel.value;
        const months = [...new Set(this.data.map(r => r.date.substring(0,7)))].sort().reverse();
        sel.innerHTML = '<option value="">-- 选择月份 --</option>';
        months.forEach(m => sel.add(new Option(m, m)));
        if(cur && months.includes(cur)) sel.value = cur;
        else if(months.length > 0 && !cur) {
            sel.value = months[0]; // 默认选择最新月份
        }
    },

    renderCostAnalysis() {
        const tearDownCostCharts = () => {
            if(this.charts.cost) {
                try {
                    this.charts.cost.destroy();
                } catch(e) {
                    console.warn('销毁成本饼图:', e);
                }
                this.charts.cost = null;
            }
            if(this.charts.costBar) {
                try {
                    this.charts.costBar.destroy();
                } catch(e) {
                    console.warn('销毁成本柱状图:', e);
                }
                this.charts.costBar = null;
            }
            const leg = document.getElementById('costChartLegend');
            if(leg) leg.innerHTML = '';
            const pieBody = document.getElementById('costChart')?.closest('.chart-card-body');
            pieBody?.querySelector('.chart-center-info')?.remove();
        };

        const month = document.getElementById('analysisMonth')?.value;
        if(!month || !this.data.length) {
            tearDownCostCharts();
            const container = document.getElementById('costDetailList');
            const overviewCards = document.getElementById('costOverviewCards');
            const summaryEl = document.getElementById('costSummaryStats');
            if(container) {
                container.innerHTML = '<div class="empty-state-modern"><i class="fas fa-calendar-alt"></i><p>请选择月份查看成本分析</p></div>';
            }
            if(overviewCards) {
                overviewCards.innerHTML = '';
            }
            if(summaryEl) summaryEl.innerHTML = '';
            return;
        }

        const s = this.getSettings();
        const monthData = this.data.filter(r => r.date.startsWith(month));
        if(!monthData.length) {
            tearDownCostCharts();
            const oc = document.getElementById('costOverviewCards');
            if(oc) oc.innerHTML = '';
            const summaryEl = document.getElementById('costSummaryStats');
            if(summaryEl) summaryEl.innerHTML = '';
            const cdl = document.getElementById('costDetailList');
            if(cdl) cdl.innerHTML = '<div class="empty-state-modern"><i class="fas fa-inbox"></i><p>该月份暂无数据</p></div>';
            return;
        }

        const totalRevenue = monthData.reduce((a,b)=>a+b.revenue,0);
        const days = monthData.length;
        
        // 计算各类成本
        const cogs = totalRevenue * s.costRate; // 货物成本
        const comm = totalRevenue * s.commRate; // 销售提成
        const rent = s.rent; // 租金（月度）
        const utility = s.utility; // 水电杂费（月度）
        const staffCost = s.staffCount * s.staffSalary; // 人力成本（月度）
        
        // 商场抽成
        const dailyThreshold = s.mallThreshold / 30;
        let mallCost = 0;
        monthData.forEach(r => {
            if(r.revenue > dailyThreshold) {
                mallCost += (r.revenue - dailyThreshold) * s.mallRate;
            }
        });

        const totalCost = cogs + comm + rent + utility + staffCost + mallCost;
        const totalProfit = totalRevenue - totalCost;
        const netProfit = totalProfit > 0 ? totalProfit * (1 - s.tax) : totalProfit;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0;
        const costMargin = totalRevenue > 0 ? (totalCost / totalRevenue * 100) : 0;

        // 渲染顶部总览卡片
        const overviewContainer = document.getElementById('costOverviewCards');
        if(overviewContainer) {
            overviewContainer.innerHTML = `
                <div class="overview-card revenue-card">
                    <div class="overview-icon"><i class="fas fa-arrow-trend-up"></i></div>
                    <div class="overview-content">
                        <div class="overview-label">总营收</div>
                        <div class="overview-value">¥${Math.round(totalRevenue).toLocaleString()}</div>
                        <div class="overview-sub">日均 ¥${Math.round(totalRevenue / days).toLocaleString()}</div>
                    </div>
                </div>
                <div class="overview-card cost-card">
                    <div class="overview-icon"><i class="fas fa-coins"></i></div>
                    <div class="overview-content">
                        <div class="overview-label">总成本 · 占营收</div>
                        <div class="overview-value">¥${Math.round(totalCost).toLocaleString()}</div>
                        <div class="overview-sub">${costMargin.toFixed(1)}% · 目标 &lt; ${(s.costRate * 100 + 50).toFixed(0)}%</div>
                    </div>
                </div>
                <div class="overview-card profit-card">
                    <div class="overview-icon"><i class="fas ${netProfit > 0 ? 'fa-check-circle' : 'fa-times-circle'}"></i></div>
                    <div class="overview-content">
                        <div class="overview-label">净利润</div>
                        <div class="overview-value" style="color: ${netProfit > 0 ? '#27ae60' : '#e74c3c'}">¥${Math.round(netProfit).toLocaleString()}</div>
                        <div class="overview-sub">利润率 ${profitMargin.toFixed(1)}%</div>
                    </div>
                </div>
            `;
        }

        // 准备成本数据（不包括总营收和总成本）
        const costCategories = [
            { name: '货物成本', value: cogs, color: '#2D6A4F', icon: 'fa-box' },
            { name: '人力成本', value: staffCost, color: '#e74c3c', icon: 'fa-users' },
            { name: '租金', value: rent, color: '#f39c12', icon: 'fa-building' },
            { name: '商场抽成', value: mallCost, color: '#1B4332', icon: 'fa-store' },
            { name: '销售提成', value: comm, color: '#f1948a', icon: 'fa-percent' },
            { name: '水电杂费', value: utility, color: '#52B788', icon: 'fa-bolt' }
        ].filter(item => item.value > 0);

        // 渲染成本结构饼图（增强版）
        const ctx = document.getElementById('costChart');
        if(ctx) {
            if(this.charts.cost) {
                try {
                    this.charts.cost.destroy();
                } catch(e) {
                    console.warn('销毁成本图表时出错:', e);
                }
                // 清理之前的中心信息
                const chartCenter = ctx.parentElement;
                const oldCenter = chartCenter?.querySelector('.chart-center-info');
                if(oldCenter) oldCenter.remove();
            }
            
            const chartData = costCategories.map(c => c.value);
            chartData.push(Math.max(0, netProfit));
            
            const chartLabels = costCategories.map(c => c.name);
            chartLabels.push('净利润');
            
            const chartColors = costCategories.map(c => c.color);
            chartColors.push('#27ae60');
            
            const total = chartData.reduce((a, b) => a + b, 0);

            this.charts.cost = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        data: chartData,
                        backgroundColor: chartColors,
                        borderWidth: 2,
                        borderColor: '#fff',
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    resizeDelay: 120,
                    cutout: '62%',
                    layout: {
                        padding: 6
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.85)',
                            padding: 12,
                            titleFont: { size: 13, weight: 'bold' },
                            bodyFont: { size: 12 },
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return `${label}: ¥${Math.round(value).toLocaleString()} (${percent}%)`;
                                }
                            }
                        }
                    },
                    animation: {
                        animateRotate: true,
                        animateScale: true,
                        duration: 1000,
                        easing: 'easeOutQuart'
                    }
                }
            });

            // 在图表中心添加总金额显示（在图表创建后）
            setTimeout(() => {
                const chartCard = ctx.closest('.chart-card');
                const chartBody = chartCard?.querySelector('.chart-card-body') || ctx.parentElement;
                if(chartBody) {
                    let centerHtml = chartBody.querySelector('.chart-center-info');
                    if(centerHtml) {
                        centerHtml.remove();
                    }
                    centerHtml = document.createElement('div');
                    centerHtml.className = 'chart-center-info';
                    centerHtml.innerHTML = `
                        <div class="center-total-label">总金额</div>
                        <div class="center-total-value">¥${Math.round(total).toLocaleString()}</div>
                        <div class="center-profit-margin">利润率: ${profitMargin.toFixed(1)}%</div>
                    `;
                    chartBody.appendChild(centerHtml);
                }
            }, 300);

            // 渲染自定义图例（更灵活）
            const legendContainer = document.getElementById('costChartLegend');
            if(legendContainer) {
                legendContainer.innerHTML = chartLabels.map((label, i) => {
                    const value = chartData[i];
                    const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                    return `
                        <div class="legend-item legend-item--compact" style="--color: ${chartColors[i]}" title="${label} ¥${Math.round(value).toLocaleString()} (${percent}%)">
                            <span class="legend-dot"></span>
                            <span class="legend-label">${label}</span>
                            <span class="legend-value">${percent}%</span>
                        </div>
                    `;
                }).join('');
            }
        }

        // 渲染成本对比柱状图
        setTimeout(() => {
            const barCtx = this.safeGetElement('costBarChart');
            if(barCtx) {
                if(this.charts.costBar) {
                    try {
                        this.charts.costBar.destroy();
                    } catch(e) {
                        console.warn('销毁成本柱状图时出错:', e);
                    }
                }
                
                const sortedCosts = [...costCategories].sort((a, b) => b.value - a.value);
                
                this.charts.costBar = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedCosts.map(c => c.name),
                        datasets: [{
                            label: '成本金额',
                            data: sortedCosts.map(c => c.value),
                            backgroundColor: sortedCosts.map(c => c.color),
                            borderRadius: 6,
                            borderSkipped: false,
                            maxBarThickness: 50
                        }, {
                            label: '占比',
                            data: sortedCosts.map(c => (c.value / totalRevenue * 100)),
                            type: 'line',
                            borderColor: '#2D6A4F',
                            backgroundColor: 'rgba(45, 106, 79, 0.1)',
                            borderWidth: 2,
                            fill: false,
                            yAxisID: 'y1',
                            tension: 0.4,
                            pointRadius: 3,
                            pointBackgroundColor: '#2D6A4F',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        resizeDelay: 120,
                        layout: {
                            padding: { top: 2, right: 2, bottom: 2, left: 2 }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top',
                                labels: {
                                    usePointStyle: true,
                                    padding: 4,
                                    boxWidth: 6,
                                    font: { size: 9, weight: '600' }
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: function(context) {
                                        if(context.datasetIndex === 0) {
                                            return `金额: ¥${Math.round(context.parsed.y).toLocaleString()}`;
                                        } else {
                                            return `占比: ${context.parsed.y.toFixed(1)}%`;
                                        }
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                position: 'left',
                                title: {
                                    display: true,
                                    text: '成本金额 (元)',
                                    font: { size: 12, weight: 'bold' }
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                },
                                ticks: {
                                    font: { size: 10 },
                                    callback: function(value) {
                                        return '¥' + Math.round(value).toLocaleString();
                                    }
                                }
                            },
                            y1: {
                                beginAtZero: true,
                                position: 'right',
                                title: {
                                    display: true,
                                    text: '占比 (%)',
                                    font: { size: 12, weight: 'bold' }
                                },
                                grid: {
                                    drawOnChartArea: false
                                },
                                ticks: {
                                    font: { size: 10 },
                                    callback: function(value) {
                                        return value.toFixed(1) + '%';
                                    }
                                }
                            },
                            x: {
                                grid: {
                                    display: false
                                },
                                ticks: {
                                    font: { size: 11, weight: '500' },
                                    maxRotation: 0
                                }
                            }
                        },
                        animation: {
                            duration: 800,
                            easing: 'easeOutCubic'
                        }
                    }
                });
            }
        }, 100);

        // 渲染成本统计摘要（单行紧凑）
        const summaryStats = document.getElementById('costSummaryStats');
        if(summaryStats) {
            const fixedCost = rent + utility + staffCost;
            const variableCost = cogs + comm + mallCost;
            const peakPct = costCategories.length > 0
                ? Math.max(...costCategories.map(c => c.value / totalRevenue * 100)).toFixed(1)
                : '0';
            const tc = fixedCost + variableCost;
            const fixedShare = tc > 0 ? (fixedCost / tc) * 100 : 50;
            const varShare = tc > 0 ? (variableCost / tc) * 100 : 50;
            summaryStats.innerHTML = `
                <div class="cost-summary-panel" role="group" aria-label="成本结构摘要">
                    <div class="cost-summary-inline">
                        <span class="csi-chip csi-chip--fixed" title="固定成本：租金、水电、人力">
                            <span class="csi-chip__dot" aria-hidden="true"></span>
                            <span class="csi-chip__lbl">固定</span>
                            <span class="money-val">¥${Math.round(fixedCost).toLocaleString()}</span>
                        </span>
                        <span class="csi-chip csi-chip--variable" title="变动成本：货成、提成、商场抽成">
                            <span class="csi-chip__dot csi-chip__dot--var" aria-hidden="true"></span>
                            <span class="csi-chip__lbl">变动</span>
                            <span class="money-val">¥${Math.round(variableCost).toLocaleString()}</span>
                        </span>
                        <span class="csi-chip csi-chip--accent" title="成本项中单笔占营收最高比例">
                            <span class="csi-chip__lbl">峰值占比</span>
                            <strong>${peakPct}%</strong>
                        </span>
                    </div>
                    <div class="cost-summary-bar" title="总成本中固定与变动占比" role="img" aria-label="总成本中固定约占 ${fixedShare.toFixed(0)}%，变动约占 ${varShare.toFixed(0)}%">
                        <div class="cost-summary-bar__track">
                            <div class="cost-summary-bar__seg cost-summary-bar__seg--fixed" style="width:${fixedShare.toFixed(2)}%"></div>
                            <div class="cost-summary-bar__seg cost-summary-bar__seg--var" style="width:${varShare.toFixed(2)}%"></div>
                        </div>
                        <div class="cost-summary-bar__ticks">
                            <span>${fixedShare.toFixed(0)}% 固定</span>
                            <span>${varShare.toFixed(0)}% 变动</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // 渲染成本明细（紧凑表格）
        const detailContainer = document.getElementById('costDetailList');
        if(detailContainer) {
            const allItems = [
                { name: '总营收', value: totalRevenue, color: '#2D6A4F', type: 'revenue', percent: 100 },
                ...costCategories.map(c => ({
                    ...c,
                    percent: totalRevenue > 0 ? (c.value / totalRevenue * 100) : 0,
                    type: 'cost'
                })),
                { name: '总成本', value: totalCost, color: '#1B4332', type: 'summary', percent: costMargin },
                { name: '净利润', value: netProfit, color: netProfit > 0 ? '#27ae60' : '#e74c3c', type: 'profit', percent: profitMargin }
            ];

            const rows = allItems.map((item) => {
                const typeLabel = item.type === 'cost' ? '成本' : item.type === 'revenue' ? '营收' : item.type === 'profit' ? '利润' : '汇总';
                const rawPct = item.percent !== undefined ? Number(item.percent) : null;
                const pctHint = item.type === 'profit' ? '利润率' : item.type === 'revenue' ? '' : item.type === 'summary' ? '成本率' : '占营收';
                const barNeg = rawPct !== null && rawPct < 0;
                const barW = rawPct === null ? 0 : Math.min(100, Math.abs(rawPct));
                const barMod = barNeg ? ' cost-pct-bar--negative' : '';
                const barFillColor = item.type === 'profit' && netProfit < 0 ? '#e74c3c' : item.color;
                const pctCell = rawPct === null
                    ? '<td class="cost-detail-table__viz">—</td>'
                    : `<td class="cost-detail-table__viz">
                        <div class="cost-pct-bar${barMod}" aria-label="${item.name} ${rawPct.toFixed(1)}%，${pctHint || '占比'}">
                            <div class="cost-pct-bar__track">
                                <div class="cost-pct-bar__fill" style="width:${barW.toFixed(2)}%;background:${barFillColor};"></div>
                            </div>
                            <div class="cost-pct-bar__meta">
                                <span class="cost-pct-bar__value">${rawPct.toFixed(1)}%</span>
                                ${pctHint ? `<span class="cost-pct-bar__hint">${pctHint}</span>` : ''}
                            </div>
                        </div>
                    </td>`;

                let remark = '—';
                if(item.type === 'cost') {
                    remark = `日均 <span class="money-val">¥${Math.round(item.value / days).toLocaleString()}</span>`;
                } else if(item.type === 'revenue') {
                    remark = `<span class="cost-note-kpi">${days}</span> 天`;
                }

                const rowCls = `cost-detail-table__row cost-detail-table__row--${item.type}${item.type === 'profit' ? (netProfit >= 0 ? ' cost-detail-table__row--profit-pos' : ' cost-detail-table__row--profit-neg') : ''}`;
                return `
                    <tr class="${rowCls}" style="--row-accent:${item.color};">
                        <td class="cost-detail-table__name"><span class="cost-detail-dot" style="background:${item.color};" aria-hidden="true"></span>${item.name}</td>
                        <td class="cost-detail-table__type"><span class="cost-type-tag cost-type-tag--${item.type}">${typeLabel}</span></td>
                        <td class="cost-detail-table__num money-val" style="color:${item.color};">¥${Math.round(item.value).toLocaleString()}</td>
                        ${pctCell}
                        <td class="cost-detail-table__note">${remark}</td>
                    </tr>`;
            }).join('');

            detailContainer.innerHTML = `
                <div class="cost-detail-table-scroll">
                    <table class="cost-detail-table cost-detail-table--viz">
                        <thead>
                            <tr>
                                <th scope="col">项目</th>
                                <th scope="col">类型</th>
                                <th scope="col" class="cost-detail-table__num">金额</th>
                                <th scope="col" class="cost-detail-table__viz-head">结构</th>
                                <th scope="col">备注</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        this.applyPrivacy();

        // 渲染同比环比分析
        this.renderComparisonAnalysis(month);
    },

    renderComparisonAnalysis(month) {
        if(!month) {
            const metricsContainer = document.getElementById('comparisonMetrics');
            const detailsContainer = document.getElementById('comparisonDetails');
            if(metricsContainer) metricsContainer.innerHTML = '';
            if(detailsContainer) detailsContainer.innerHTML = '';
            return;
        }

        const s = this.getSettings();
        const currentData = this.data.filter(r => r.date.startsWith(month));
        if(!currentData.length) {
            const metricsContainer = document.getElementById('comparisonMetrics');
            const detailsContainer = document.getElementById('comparisonDetails');
            if(metricsContainer) metricsContainer.innerHTML = '<div class="empty-state-modern">暂无数据</div>';
            if(detailsContainer) detailsContainer.innerHTML = '';
            return;
        }

        // 计算当前月数据
        const currentRevenue = currentData.reduce((a,b)=>a+b.revenue,0);
        const currentProfit = currentData.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return res.net;
        }).reduce((a,b)=>a+b,0);

        // 计算上月（环比）
        const [year, monthNum] = month.split('-').map(Number);
        const prevMonth = monthNum === 1 ? `${year-1}-12` : `${year}-${String(monthNum-1).padStart(2,'0')}`;
        const prevData = this.data.filter(r => r.date.startsWith(prevMonth));
        const prevRevenue = prevData.length > 0 ? prevData.reduce((a,b)=>a+b.revenue,0) : 0;
        const prevProfit = prevData.length > 0 ? prevData.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return res.net;
        }).reduce((a,b)=>a+b,0) : 0;

        // 计算去年同期（同比）
        const lastYearMonth = `${year-1}-${String(monthNum).padStart(2,'0')}`;
        const lastYearData = this.data.filter(r => r.date.startsWith(lastYearMonth));
        const lastYearRevenue = lastYearData.length > 0 ? lastYearData.reduce((a,b)=>a+b.revenue,0) : 0;
        const lastYearProfit = lastYearData.length > 0 ? lastYearData.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return res.net;
        }).reduce((a,b)=>a+b,0) : 0;

        // 计算增长率
        const revenueMoM = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 0;
        const profitMoM = prevProfit !== 0 ? ((currentProfit - prevProfit) / Math.abs(prevProfit) * 100).toFixed(1) : 0;
        const revenueYoY = lastYearRevenue > 0 ? ((currentRevenue - lastYearRevenue) / lastYearRevenue * 100).toFixed(1) : 0;
        const profitYoY = lastYearProfit !== 0 ? ((currentProfit - lastYearProfit) / Math.abs(lastYearProfit) * 100).toFixed(1) : 0;

        // 渲染指标卡片
        const metricsContainer = document.getElementById('comparisonMetrics');
        if(metricsContainer) {
            metricsContainer.innerHTML = `
                <div class="comparison-metric-card revenue-metric">
                    <div class="metric-header">
                        <div class="metric-icon">
                            <i class="fas fa-chart-line"></i>
                        </div>
                        <div class="metric-title">当月营收</div>
                    </div>
                    <div class="metric-value">¥${Math.round(currentRevenue).toLocaleString()}</div>
                    <div class="metric-trends">
                        <div class="trend-badge ${parseFloat(revenueMoM) >= 0 ? 'positive' : 'negative'}">
                            <i class="fas ${parseFloat(revenueMoM) >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                            <span>环比 ${parseFloat(revenueMoM) >= 0 ? '+' : ''}${revenueMoM}%</span>
                        </div>
                        <div class="trend-badge ${parseFloat(revenueYoY) >= 0 ? 'positive' : 'negative'}">
                            <i class="fas ${parseFloat(revenueYoY) >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                            <span>同比 ${parseFloat(revenueYoY) >= 0 ? '+' : ''}${revenueYoY}%</span>
                        </div>
                    </div>
                </div>
                <div class="comparison-metric-card profit-metric">
                    <div class="metric-header">
                        <div class="metric-icon">
                            <i class="fas fa-coins"></i>
                        </div>
                        <div class="metric-title">当月净利</div>
                    </div>
                    <div class="metric-value">¥${Math.round(currentProfit).toLocaleString()}</div>
                    <div class="metric-trends">
                        <div class="trend-badge ${parseFloat(profitMoM) >= 0 ? 'positive' : 'negative'}">
                            <i class="fas ${parseFloat(profitMoM) >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                            <span>环比 ${parseFloat(profitMoM) >= 0 ? '+' : ''}${profitMoM}%</span>
                        </div>
                        <div class="trend-badge ${parseFloat(profitYoY) >= 0 ? 'positive' : 'negative'}">
                            <i class="fas ${parseFloat(profitYoY) >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                            <span>同比 ${parseFloat(profitYoY) >= 0 ? '+' : ''}${profitYoY}%</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // 渲染对比图表
        setTimeout(() => {
            // 营收对比图
            const revenueCtx = document.getElementById('comparisonRevenueChart');
            if(revenueCtx) {
                if(this.charts.comparisonRevenue) {
                    try {
                        this.charts.comparisonRevenue.destroy();
                    } catch(e) {
                        console.warn('销毁营收对比图表时出错:', e);
                    }
                }
                
                this.charts.comparisonRevenue = new Chart(revenueCtx, {
                    type: 'bar',
                    data: {
                        labels: ['上月', '当月', '去年同期'],
                        datasets: [{
                            label: '营收金额',
                            data: [prevRevenue, currentRevenue, lastYearRevenue],
                            backgroundColor: ['#52B788', '#2D6A4F', '#1B4332'],
                            borderRadius: 8,
                            borderSkipped: false,
                            maxBarThickness: 60
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        aspectRatio: 2,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: function(context) {
                                        return `营收: ¥${Math.round(context.parsed.y).toLocaleString()}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return '¥' + Math.round(value).toLocaleString();
                                    }
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                }
                            }
                        }
                    }
                });
            }

            // 利润对比图
            const profitCtx = this.safeGetElement('comparisonProfitChart');
            if(profitCtx) {
                if(this.charts.comparisonProfit) {
                    try {
                        this.charts.comparisonProfit.destroy();
                    } catch(e) {
                        console.warn('销毁利润对比图表时出错:', e);
                    }
                }
                
                this.charts.comparisonProfit = new Chart(profitCtx, {
                    type: 'bar',
                    data: {
                        labels: ['上月', '当月', '去年同期'],
                        datasets: [{
                            label: '利润金额',
                            data: [prevProfit, currentProfit, lastYearProfit],
                            backgroundColor: ['#52B788', currentProfit >= 0 ? '#27ae60' : '#e74c3c', '#1B4332'],
                            borderRadius: 8,
                            borderSkipped: false,
                            maxBarThickness: 60
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        aspectRatio: 2,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: function(context) {
                                        return `利润: ¥${Math.round(context.parsed.y).toLocaleString()}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: false,
                                ticks: {
                                    callback: function(value) {
                                        return '¥' + Math.round(value).toLocaleString();
                                    }
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                }
                            }
                        }
                    }
                });
            }
        }, 100);

        // 渲染对比详情
        const detailsContainer = document.getElementById('comparisonDetails');
        if(detailsContainer) {
            detailsContainer.innerHTML = `
                <div class="comparison-detail-item">
                    <div class="detail-item-header">
                        <div class="detail-item-icon">
                            <i class="fas fa-calendar-minus"></i>
                        </div>
                        <div class="detail-item-label">上月营收</div>
                    </div>
                    <div class="detail-item-value">¥${Math.round(prevRevenue).toLocaleString()}</div>
                </div>
                <div class="comparison-detail-item">
                    <div class="detail-item-header">
                        <div class="detail-item-icon">
                            <i class="fas fa-coins"></i>
                        </div>
                        <div class="detail-item-label">上月净利</div>
                    </div>
                    <div class="detail-item-value">¥${Math.round(prevProfit).toLocaleString()}</div>
                </div>
                <div class="comparison-detail-item">
                    <div class="detail-item-header">
                        <div class="detail-item-icon">
                            <i class="fas fa-calendar-year"></i>
                        </div>
                        <div class="detail-item-label">去年同期营收</div>
                    </div>
                    <div class="detail-item-value">¥${Math.round(lastYearRevenue).toLocaleString()}</div>
                </div>
                <div class="comparison-detail-item">
                    <div class="detail-item-header">
                        <div class="detail-item-icon">
                            <i class="fas fa-chart-area"></i>
                        </div>
                        <div class="detail-item-label">去年同期净利</div>
                    </div>
                    <div class="detail-item-value">¥${Math.round(lastYearProfit).toLocaleString()}</div>
                </div>
            `;
        }
    },

    renderFinanceWarning(data, s) {
        const container = document.getElementById('financeWarning');
        if(!container) return;

        if(!data || !data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const warnings = [];
        const recent = data.slice(-30); // 最近30天
        const avgRevenue = recent.reduce((a,b)=>a+b.revenue,0) / recent.length;
        const avgProfit = recent.reduce((a,b)=>a+b.profit,0) / recent.length;

        // 预警规则
        // 1. 连续亏损
        const recentProfits = recent.slice(-7).map(r => r.profit);
        if(recentProfits.every(p => p < 0)) {
            warnings.push({
                level: 'high',
                title: '⚠️ 连续亏损警告',
                message: `最近7天连续亏损，累计亏损 ¥${Math.round(Math.abs(recentProfits.reduce((a,b)=>a+b,0))).toLocaleString()}`,
                suggestion: '建议立即检查成本结构和营收策略'
            });
        }

        // 2. 营收大幅下降
        if(recent.length >= 14) {
            const firstWeek = recent.slice(0, 7).reduce((a,b)=>a+b.revenue,0);
            const lastWeek = recent.slice(-7).reduce((a,b)=>a+b.revenue,0);
            const decline = ((firstWeek - lastWeek) / firstWeek * 100);
            if(decline > 30) {
                warnings.push({
                    level: 'high',
                    title: '📉 营收大幅下降',
                    message: `最近7天营收较前7天下降 ${decline.toFixed(1)}%`,
                    suggestion: '建议分析原因并制定应对策略'
                });
            }
        }

        // 3. 低于目标
        if(avgRevenue < s.target / 30 * 0.7) {
            warnings.push({
                level: 'medium',
                title: '🎯 未达目标',
                message: `日均营收 ¥${Math.round(avgRevenue).toLocaleString()}，低于目标值70%`,
                suggestion: `目标日均营收: ¥${Math.round(s.target/30).toLocaleString()}`
            });
        }

        // 4. 成本率过高
        const totalRevenue = recent.reduce((a,b)=>a+b.revenue,0);
        const totalCost = totalRevenue * s.costRate + (s.rent + s.utility + s.staffCount * s.staffSalary) * (recent.length / 30);
        const costRate = totalRevenue > 0 ? (totalCost / totalRevenue * 100) : 0;
        if(costRate > 80) {
            warnings.push({
                level: 'medium',
                title: '💰 成本率偏高',
                message: `综合成本率达到 ${costRate.toFixed(1)}%`,
                suggestion: '建议优化成本结构，提高利润率'
            });
        }

        // 5. 无异常（正面提示）
        if(warnings.length === 0 && avgProfit > 0) {
            warnings.push({
                level: 'low',
                title: '✅ 财务状况良好',
                message: `最近30天日均盈利 ¥${Math.round(avgProfit).toLocaleString()}`,
                suggestion: '继续保持，建议关注长期趋势'
            });
        }

        container.innerHTML = warnings.map(w => `
            <div class="warning-item-compact warning-${w.level}">
                <div class="warning-title">${w.title}</div>
                <div class="warning-message">${w.message}</div>
                <div class="warning-suggestion">
                    <i class="fas fa-lightbulb"></i> ${w.suggestion}
                </div>
            </div>
        `).join('');

        if(warnings.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无预警信息</div>';
        }
    },

    renderForecast() {
        const container = document.getElementById('forecastContent');
        if(!container) return;
        
        if(!this.data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据，无法进行预测</div>';
            return;
        }

        const period = parseInt(document.getElementById('forecastPeriod')?.value || 30);
        const s = this.getSettings();
        
        // 获取最近30天的数据用于预测
        const recent = this.data.slice(-30);
        if(recent.length < 7) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">数据不足，至少需要7天数据才能预测</div>';
            return;
        }

        // 计算趋势
        const revenues = recent.map(r => r.revenue);
        const avgRevenue = revenues.reduce((a,b)=>a+b,0) / revenues.length;
        
        // 简单移动平均和趋势计算
        const recent7 = revenues.slice(-7);
        const prev7 = revenues.slice(-14, -7);
        const recentAvg = recent7.reduce((a,b)=>a+b,0) / recent7.length;
        const prevAvg = prev7.length > 0 ? prev7.reduce((a,b)=>a+b,0) / prev7.length : recentAvg;
        const trend = ((recentAvg - prevAvg) / prevAvg) * 100; // 趋势百分比
        
        // 预测未来数据（考虑趋势）
        const forecastData = [];
        let baseRevenue = recentAvg;
        for(let i = 1; i <= period; i++) {
            // 考虑趋势衰减（长期趋势会减弱）
            const trendFactor = 1 + (trend / 100) * Math.exp(-i / 30);
            const predicted = baseRevenue * trendFactor;
            forecastData.push({
                day: i,
                revenue: Math.max(0, predicted),
                date: new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            });
        }

        const totalForecast = forecastData.reduce((a,b)=>a+b.revenue,0);
        const avgForecast = totalForecast / period;
        const forecastProfit = forecastData.map(f => {
            const res = this.calcProfit(f.revenue, s);
            return res.net;
        }).reduce((a,b)=>a+b,0);

        // 渲染预测结果
        container.innerHTML = `
            <div class="forecast-summary" style="margin-bottom:20px;">
                <div class="grid-3" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:15px; margin-bottom:20px;">
                    <div style="background:linear-gradient(135deg, #2D6A4F 0%, #1B4332 100%); color:#fff; padding:20px; border-radius:10px;">
                        <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">预测总营收</div>
                        <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(totalForecast).toLocaleString()}</div>
                        <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">未来${period}天</div>
                    </div>
                    <div style="background:linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color:#fff; padding:20px; border-radius:10px;">
                        <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">日均预测</div>
                        <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(avgForecast).toLocaleString()}</div>
                        <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">趋势: ${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%</div>
                    </div>
                    <div style="background:linear-gradient(135deg, #f39c12 0%, #f8c471 100%); color:#fff; padding:20px; border-radius:10px;">
                        <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">预测净利润</div>
                        <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(forecastProfit).toLocaleString()}</div>
                        <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">基于当前成本</div>
                    </div>
                </div>
                <div style="background:#f8f9fa; padding:15px; border-radius:8px; border-left:4px solid #2D6A4F;">
                    <div style="font-size:var(--text-sm); color: var(--light-text-secondary); margin-bottom:5px;">
                        <i class="fas fa-info-circle"></i> 预测说明
                    </div>
                    <div style="font-size:var(--text-sm); color: var(--light-text-tertiary); line-height:1.6;">
                        基于最近${recent.length}天的历史数据，采用移动平均和趋势分析算法。预测结果仅供参考，实际数据可能受季节性、市场变化等因素影响。
                    </div>
                </div>
            </div>
            <div style="height:250px; position:relative;">
                <canvas id="forecastChart"></canvas>
            </div>
        `;

        // 渲染预测图表
        setTimeout(() => {
            const ctx = document.getElementById('forecastChart');
            if(ctx) {
                if(this.charts.forecast) {
                    try {
                        this.charts.forecast.destroy();
                    } catch(e) {
                        console.warn('销毁预测图表时出错:', e);
                    }
                }
                
                // 准备历史数据和预测数据
                const historicalLabels = recent.slice(-14).map(r => r.date.substring(5));
                const historicalData = recent.slice(-14).map(r => r.revenue);
                const forecastLabels = forecastData.slice(0, Math.min(14, period)).map(f => f.date.substring(5));
                const forecastDataPoints = forecastData.slice(0, Math.min(14, period)).map(f => f.revenue);
                
                this.charts.forecast = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: [...historicalLabels, ...forecastLabels],
                        datasets: [
                            {
                                label: '历史营收',
                                data: [...historicalData, ...new Array(forecastLabels.length).fill(null)],
                                borderColor: '#2D6A4F',
                                backgroundColor: 'rgba(45, 106, 79, 0.1)',
                                borderWidth: 2,
                                tension: 0.4,
                                fill: true
                            },
                            {
                                label: '预测营收',
                                data: [...new Array(historicalLabels.length).fill(null), ...forecastDataPoints],
                                borderColor: '#c4a55a',
                                backgroundColor: 'rgba(196, 165, 90, 0.14)',
                                borderWidth: 2,
                                borderDash: [6, 4],
                                tension: 0.4,
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return context.dataset.label + ': ¥' + Math.round(context.parsed.y).toLocaleString();
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return '¥' + Math.round(value).toLocaleString();
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }, 100);
    },

    calculateHealthScore() {
        const container = document.getElementById('healthScoreContent');
        if(!container) return;
        
        if(!this.data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const s = this.getSettings();
        const recent = this.data.slice(-30);
        if(recent.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">数据不足</div>';
            return;
        }

        // 计算各项指标
        const totalRevenue = recent.reduce((a,b)=>a+b.revenue,0);
        const totalProfit = recent.map(r => {
            const res = this.calcProfit(r.revenue, s);
            return res.net;
        }).reduce((a,b)=>a+b,0);
        const avgRevenue = totalRevenue / recent.length;
        const targetDaily = s.target / 30;
        const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
        
        // 计算各项得分（0-100分）
        const revenueScore = Math.min(100, (avgRevenue / targetDaily) * 100); // 目标达成度
        const profitScore = profitMargin > 0 ? Math.min(100, profitMargin * 2) : 0; // 利润率
        const stabilityScore = this.calculateStabilityScore(recent); // 稳定性
        const growthScore = this.calculateGrowthScore(recent); // 增长性
        
        // 综合得分（加权平均）
        const healthScore = (
            revenueScore * 0.3 +
            profitScore * 0.3 +
            stabilityScore * 0.2 +
            growthScore * 0.2
        );

        // 评级
        let grade, gradeColor, gradeText;
        if(healthScore >= 80) {
            grade = 'A'; gradeColor = '#27ae60'; gradeText = '优秀';
        } else if(healthScore >= 60) {
            grade = 'B'; gradeColor = '#f39c12'; gradeText = '良好';
        } else if(healthScore >= 40) {
            grade = 'C'; gradeColor = '#e74c3c'; gradeText = '一般';
        } else {
            grade = 'D'; gradeColor = '#e74c3c'; gradeText = '需改进';
        }

        container.innerHTML = `
            <div style="text-align:center; margin-bottom:30px;">
                <div style="font-size:4rem; font-weight:bold; color:${gradeColor}; margin-bottom:10px;">${grade}</div>
                <div style="font-size:var(--text-xl); color: var(--light-text-secondary); margin-bottom:5px;">${gradeText}</div>
                <div style="font-size:var(--text-4xl); font-weight:bold; color:${gradeColor};">
                    ${Math.round(healthScore)}<span style="font-size:var(--text-base); color: var(--light-text-tertiary);">/100</span>
                </div>
            </div>
            <div class="score-breakdown" style="display:flex; flex-direction:column; gap:12px;">
                <div class="score-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8f9fa; border-radius:8px;">
                    <span style="color: var(--light-text-secondary);"><i class="fas fa-chart-line"></i> 目标达成度</span>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:150px; height:8px; background:#e0e0e0; border-radius:4px; overflow:hidden;">
                            <div style="height:100%; background:#2D6A4F; width:${revenueScore}%; transition:width 0.5s;"></div>
                        </div>
                        <span style="font-weight:bold; color:#2D6A4F;">${Math.round(revenueScore)}分</span>
                    </div>
                </div>
                <div class="score-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8f9fa; border-radius:8px;">
                    <span style="color: var(--light-text-secondary);"><i class="fas fa-coins"></i> 盈利能力</span>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:150px; height:8px; background:#e0e0e0; border-radius:4px; overflow:hidden;">
                            <div style="height:100%; background:#e74c3c; width:${profitScore}%; transition:width 0.5s;"></div>
                        </div>
                        <span style="font-weight:bold; color:#e74c3c;">${Math.round(profitScore)}分</span>
                    </div>
                </div>
                <div class="score-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8f9fa; border-radius:8px;">
                    <span style="color: var(--light-text-secondary);"><i class="fas fa-shield-alt"></i> 经营稳定性</span>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:150px; height:8px; background:#e0e0e0; border-radius:4px; overflow:hidden;">
                            <div style="height:100%; background:#f39c12; width:${stabilityScore}%; transition:width 0.5s;"></div>
                        </div>
                        <span style="font-weight:bold; color:#f39c12;">${Math.round(stabilityScore)}分</span>
                    </div>
                </div>
                <div class="score-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8f9fa; border-radius:8px;">
                    <span style="color: var(--light-text-secondary);"><i class="fas fa-arrow-up"></i> 增长趋势</span>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:150px; height:8px; background:#e0e0e0; border-radius:4px; overflow:hidden;">
                            <div style="height:100%; background:#f8c471; width:${growthScore}%; transition:width 0.5s;"></div>
                        </div>
                        <span style="font-weight:bold; color:#f8c471;">${Math.round(growthScore)}分</span>
                    </div>
                </div>
            </div>
        `;
    },

    calculateStabilityScore(data) {
        if(data.length < 7) return 50;
        const revenues = data.map(r => r.revenue);
        const avg = revenues.reduce((a,b)=>a+b,0) / revenues.length;
        const variance = revenues.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / revenues.length;
        const stdDev = Math.sqrt(variance);
        const cv = avg > 0 ? stdDev / avg : 1; // 变异系数
        // 变异系数越小，稳定性越高
        return Math.max(0, Math.min(100, 100 - cv * 100));
    },

    calculateGrowthScore(data) {
        if(data.length < 14) return 50;
        const recent7 = data.slice(-7).reduce((a,b)=>a+b.revenue,0);
        const prev7 = data.slice(-14, -7).reduce((a,b)=>a+b.revenue,0);
        if(prev7 === 0) return 50;
        const growth = ((recent7 - prev7) / prev7) * 100;
        // 增长10%以上得满分，负增长得低分
        return Math.max(0, Math.min(100, 50 + growth * 2));
    },

    renderCashflowAnalysis(data, s) {
        const container = document.getElementById('cashflowAnalysis');
        if(!container) return;
        
        if(!data || !data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const recent = data.slice(-30);
        const dailyCashflows = recent.map(r => {
            const profit = r.profit || this.calcProfit(r.revenue, s).net;
            return {
                date: r.date,
                revenue: r.revenue,
                cost: r.revenue - profit,
                profit: profit
            };
        });

        const totalInflow = dailyCashflows.reduce((a,b)=>a+b.revenue,0);
        const totalOutflow = dailyCashflows.reduce((a,b)=>a+b.cost,0);
        const netCashflow = totalInflow - totalOutflow;
        const avgDailyInflow = totalInflow / recent.length;
        const avgDailyOutflow = totalOutflow / recent.length;

        container.innerHTML = `
            <div class="cashflow-summary" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:25px;">
                <div style="background:linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color:#fff; padding:20px; border-radius:10px;">
                    <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">现金流入</div>
                    <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(totalInflow).toLocaleString()}</div>
                    <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">日均: ¥${Math.round(avgDailyInflow).toLocaleString()}</div>
                </div>
                <div style="background:linear-gradient(135deg, #ee0979 0%, #ff6a00 100%); color:#fff; padding:20px; border-radius:10px;">
                    <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">现金流出</div>
                    <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(totalOutflow).toLocaleString()}</div>
                    <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">日均: ¥${Math.round(avgDailyOutflow).toLocaleString()}</div>
                </div>
                <div style="background:${netCashflow >= 0 ? 'linear-gradient(135deg, #2D6A4F 0%, #1B4332 100%)' : 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)'}; color:#fff; padding:20px; border-radius:10px;">
                    <div style="font-size:var(--text-sm); opacity:0.9; margin-bottom:8px;">净现金流</div>
                    <div style="font-size:var(--text-3xl); font-weight:bold;">¥${Math.round(netCashflow).toLocaleString()}</div>
                    <div style="font-size:var(--text-xs); margin-top:8px; opacity:0.8;">${netCashflow >= 0 ? '正向' : '负向'}</div>
                </div>
            </div>
            <div style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:20px;">
                <div style="font-weight:600; color:#333; margin-bottom:10px;">现金流分析</div>
                <div style="font-size:var(--text-base); color: var(--light-text-secondary); line-height:1.8;">
                    ${netCashflow >= 0 ? 
                        '✅ 现金流为正，经营状况良好。建议继续保持，并考虑将多余资金用于投资或扩大经营。' : 
                        '⚠️ 现金流为负，需要关注。建议：1) 优化成本结构 2) 提高营收 3) 控制支出 4) 考虑融资'
                    }
                </div>
            </div>
            <div style="height:300px; position:relative;">
                <canvas id="cashflowChart"></canvas>
            </div>
        `;

        // 渲染现金流图表
        setTimeout(() => {
            const ctx = document.getElementById('cashflowChart');
            if(ctx) {
                if(this.charts.cashflow) {
                    try {
                        this.charts.cashflow.destroy();
                    } catch(e) {
                        console.warn('销毁现金流图表时出错:', e);
                    }
                }
                
                const labels = dailyCashflows.map(c => c.date.substring(5));
                this.charts.cashflow = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: '现金流入',
                                data: dailyCashflows.map(c => c.revenue),
                                backgroundColor: 'rgba(45, 106, 79, 0.7)'
                            },
                            {
                                label: '现金流出',
                                data: dailyCashflows.map(c => -c.cost),
                                backgroundColor: 'rgba(231, 76, 60, 0.7)'
                            },
                            {
                                label: '净现金流',
                                data: dailyCashflows.map(c => c.profit),
                                type: 'line',
                                borderColor: '#2D6A4F',
                                borderWidth: 2,
                                fill: false
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: true, position: 'top' },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = Math.abs(context.parsed.y);
                                        return context.dataset.label + ': ¥' + Math.round(value).toLocaleString();
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                ticks: {
                                    callback: function(value) {
                                        return '¥' + Math.round(Math.abs(value)).toLocaleString();
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }, 100);
    },

    renderCostOptimization(data, s) {
        const container = document.getElementById('costOptimization');
        if(!container) return;
        
        if(!data || !data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const recent = data.slice(-30);
        const totalRevenue = recent.reduce((a,b)=>a+b.revenue,0);
        const days = recent.length;
        
        // 计算各项成本
        const cogs = totalRevenue * s.costRate;
        const rent = s.rent * (days / 30);
        const utility = s.utility * (days / 30);
        const staffCost = s.staffCount * s.staffSalary * (days / 30);
        const comm = totalRevenue * s.commRate;
        
        const costs = [
            { name: '货物成本', value: cogs, rate: s.costRate * 100, type: 'variable' },
            { name: '人力成本', value: staffCost, rate: totalRevenue > 0 ? (staffCost / totalRevenue * 100) : 0, type: 'fixed' },
            { name: '租金', value: rent, rate: totalRevenue > 0 ? (rent / totalRevenue * 100) : 0, type: 'fixed' },
            { name: '销售提成', value: comm, rate: s.commRate * 100, type: 'variable' },
            { name: '水电杂费', value: utility, rate: totalRevenue > 0 ? (utility / totalRevenue * 100) : 0, type: 'fixed' }
        ].sort((a,b) => b.value - a.value);

        const suggestions = [];
        
        // 生成优化建议
        if(s.costRate > 0.3) {
            suggestions.push({
                title: '降低货物成本率',
                content: `当前货物成本率为${(s.costRate*100).toFixed(1)}%，建议通过批量采购、供应商谈判等方式降低至25%以下，可节省约¥${Math.round(totalRevenue * (s.costRate - 0.25))}。`,
                impact: 'high',
                savings: Math.round(totalRevenue * (s.costRate - 0.25))
            });
        }
        
        if(staffCost / totalRevenue > 0.15) {
            suggestions.push({
                title: '优化人力成本',
                content: `人力成本占比${(staffCost/totalRevenue*100).toFixed(1)}%，建议通过提高人效、优化排班等方式降低至12%以下。`,
                impact: 'medium',
                savings: Math.round(totalRevenue * 0.03)
            });
        }
        
        if(rent / totalRevenue > 0.25) {
            suggestions.push({
                title: '评估租金合理性',
                content: `租金占比${(rent/totalRevenue*100).toFixed(1)}%，如占比过高，可考虑与商场协商降低租金或寻找更优位置。`,
                impact: 'medium',
                savings: Math.round(totalRevenue * 0.05)
            });
        }

        if(suggestions.length === 0) {
            suggestions.push({
                title: '成本结构良好',
                content: '当前成本结构较为合理，建议继续保持，并关注成本细节优化。',
                impact: 'low',
                savings: 0
            });
        }

        container.innerHTML = `
            <div class="cost-breakdown" style="margin-bottom:25px;">
                <h4 style="margin-bottom:15px; color:#555;">成本结构分析</h4>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    ${costs.map(cost => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8f9fa; border-radius:8px; border-left:4px solid ${cost.type === 'fixed' ? '#e74c3c' : '#2D6A4F'};">
                            <div>
                                <div style="font-weight:600; color:#333;">${cost.name}</div>
                                <div style="font-size:var(--text-sm); color: var(--light-text-tertiary);">占比: ${cost.rate.toFixed(1)}%</div>
                            </div>
                            <div class="money-val" style="font-weight:bold; color:#333;">¥${Math.round(cost.value).toLocaleString()}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="optimization-suggestions">
                <h4 style="margin-bottom:15px; color:#555;">优化建议</h4>
                ${suggestions.map(s => `
                    <div style="padding:15px; margin-bottom:15px; background:${s.impact === 'high' ? '#fff5f5' : s.impact === 'medium' ? '#fffaf0' : '#f0fdf4'}; border-radius:8px; border-left:4px solid ${s.impact === 'high' ? '#e74c3c' : s.impact === 'medium' ? '#f39c12' : '#27ae60'};">
                        <div style="font-weight:700; color:#333; margin-bottom:8px;">
                            <i class="fas fa-lightbulb"></i> ${s.title}
                            ${s.savings > 0 ? `<span style="color:#27ae60; font-size:var(--text-sm); margin-left:10px;">预计节省: ¥${s.savings.toLocaleString()}</span>` : ''}
                        </div>
                        <div style="font-size:var(--text-base); color: var(--light-text-secondary); line-height:1.6;">${s.content}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    getReportDateRange(period, customMonth) {
        const today = new Date();
        let startStr, endStr, label;
        if(period === 'current' || !period) {
            startStr = today.toISOString().substring(0, 7) + '-01';
            endStr = today.toISOString().split('T')[0];
            label = today.getFullYear() + '年' + (today.getMonth() + 1) + '月（本月）';
        } else if(period === 'last') {
            const last = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            startStr = last.toISOString().substring(0, 7) + '-01';
            const lastEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            endStr = lastEnd.toISOString().split('T')[0];
            label = last.getFullYear() + '年' + (last.getMonth() + 1) + '月（上月）';
        } else if(period === 'quarter') {
            const q = Math.floor(today.getMonth() / 3) + 1;
            const qStart = new Date(today.getFullYear(), (q - 1) * 3, 1);
            startStr = qStart.toISOString().substring(0, 7) + '-01';
            endStr = today.toISOString().split('T')[0];
            label = today.getFullYear() + '年第' + q + '季度';
        } else {
            const ym = customMonth || today.toISOString().substring(0, 7);
            startStr = ym + '-01';
            const [y, m] = ym.split('-').map(Number);
            const lastDay = new Date(y, m, 0);
            endStr = lastDay.toISOString().split('T')[0];
            label = y + '年' + m + '月';
        }
        return { startStr, endStr, label };
    },

    refreshFinanceReport() {
        const s = this.getSettings();
        const processed = this.data.map(r => ({
            ...r,
            profit: this.calcProfit(r.revenue, s).net,
            fixedCost: this.calcProfit(r.revenue, s).fixed
        }));
        const type = document.getElementById('reportType')?.value || 'monthly';
        const period = document.getElementById('reportPeriod')?.value || 'current';
        const customMonth = document.getElementById('reportCustomMonth')?.value || '';
        this.generateFinanceReport(processed, s, { type, period, customMonth });
    },

    generateFinanceReport(data, s, opts = {}) {
        const container = document.getElementById('financeReport');
        if(!container) return;

        const type = opts.type || 'monthly';
        const period = opts.period || 'current';
        const customMonth = opts.customMonth || '';
        const { startStr, endStr, label } = this.getReportDateRange(period, customMonth);
        const rangeData = data.filter(r => r.date >= startStr && r.date <= endStr);

        if(!data || !data.length) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--light-text-tertiary);">暂无数据</div>';
            return;
        }

        const today = new Date();
        const rangeRevenue = rangeData.reduce((a,b)=>a+b.revenue,0);
        const rangeProfit = rangeData.reduce((a,b)=>a+(b.profit != null ? b.profit : this.calcProfit(b.revenue, s).net),0);
        const totalRevenue = data.reduce((a,b)=>a+b.revenue,0);
        const totalProfit = data.reduce((a,b)=>a+(b.profit != null ? b.profit : this.calcProfit(b.revenue, s).net),0);
        const dist = this.calcDistribution(data.map(r => ({ ...r, profit: r.profit != null ? r.profit : this.calcProfit(r.revenue, s).net })), s);
        const roiPct = s.invest > 0 ? Math.min(100, (dist.investTotal / s.invest) * 100) : 0;
        const healthScore = this.getHealthScoreQuick(data, s);
        const marginPct = rangeRevenue > 0 ? (rangeProfit / rangeRevenue * 100).toFixed(1) : '0';

        if(type === 'shareholder') {
            container.innerHTML = `
                <div class="report-content report-printable" style="background:#fff; padding:25px; border-radius:10px; border:1px solid #eee;">
                    <h4 style="color:#333; margin:0 0 20px 0; border-bottom:2px solid #2D6A4F; padding-bottom:10px;">股东汇报摘要 · ${label}</h4>
                    <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px; margin-bottom:20px;">
                        <div style="padding:16px; background:#f8f9fa; border-radius:8px;">
                            <div style="font-size:var(--text-sm); color: var(--light-text-secondary);">回本进度</div>
                            <div style="font-size:var(--text-2xl); font-weight:bold; color:#2D6A4F;">${roiPct.toFixed(1)}%</div>
                            <div style="font-size:var(--text-sm); color: var(--light-text-tertiary);">已分红 ¥${Math.round(dist.investTotal).toLocaleString()} / 总投资 ¥${Math.round(s.invest).toLocaleString()}</div>
                        </div>
                        <div style="padding:16px; background:#f8f9fa; border-radius:8px;">
                            <div style="font-size:var(--text-sm); color: var(--light-text-secondary);">财务健康度</div>
                            <div style="font-size:var(--text-2xl); font-weight:bold; color:#27ae60;">${healthScore.grade}</div>
                            <div style="font-size:var(--text-sm); color: var(--light-text-tertiary);">${healthScore.text}</div>
                        </div>
                    </div>
                    <div style="margin-bottom:20px;">
                        <div style="font-size:var(--text-base); color: var(--light-text-secondary); margin-bottom:8px;">本期关键指标（${label}）</div>
                        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                            <div style="padding:12px; border:1px solid #eee; border-radius:6px;">营收 <span class="money-val">¥${Math.round(rangeRevenue).toLocaleString()}</span></div>
                            <div style="padding:12px; border:1px solid #eee; border-radius:6px;">净利润 <span class="money-val">¥${Math.round(rangeProfit).toLocaleString()}</span></div>
                            <div style="padding:12px; border:1px solid #eee; border-radius:6px;">净利率 ${marginPct}%</div>
                        </div>
                    </div>
                    <div style="background:#f0fdf4; padding:14px; border-radius:8px; border-left:4px solid #27ae60;">
                        <div style="font-weight:600; color:#333; margin-bottom:6px;">一句话建议</div>
                        <div style="font-size:var(--text-base); color: var(--light-text-secondary);">${healthScore.suggestion || '继续保持当前经营节奏，关注成本与回本进度。'}</div>
                    </div>
                    <div style="color: var(--light-text-tertiary); font-size:var(--text-sm); text-align:right; margin-top:20px; padding-top:16px; border-top:1px solid #eee;">报告生成时间: ${today.toLocaleString('zh-CN')}</div>
                </div>
            `;
            return;
        }

        if(type === 'profit-table') {
            const days = Math.max(1, rangeData.length);
            const monthlyFixed = s.rent + s.utility + (s.staffCount * s.staffSalary);
            const periodFixed = monthlyFixed * (days / 30);
            const cogs = rangeRevenue * s.costRate;
            const comm = rangeRevenue * s.commRate;
            const mallExcess = rangeData.reduce((sum, r) => {
                const dailyThreshold = s.mallThreshold / 30;
                if(r.revenue > dailyThreshold) sum += (r.revenue - dailyThreshold) * s.mallRate;
                return sum;
            }, 0);
            container.innerHTML = `
                <div class="report-content report-printable" style="background:#fff; padding:25px; border-radius:10px; border:1px solid #eee;">
                    <h4 style="color:#333; margin:0 0 20px 0; border-bottom:2px solid #2D6A4F; padding-bottom:10px;">简化利润表 · ${label}</h4>
                    <table class="profit-table-report" style="width:100%; border-collapse:collapse; font-size:var(--text-base);">
                        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 12px; color: var(--light-text-secondary);">营业收入</td><td style="padding:10px 12px; text-align:right;" class="money-val">¥${Math.round(rangeRevenue).toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 12px; color: var(--light-text-secondary);">减：货物成本</td><td style="padding:10px 12px; text-align:right;" class="money-val">-¥${Math.round(cogs).toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 12px; color: var(--light-text-secondary);">减：租金/杂费/人工（固定）</td><td style="padding:10px 12px; text-align:right;" class="money-val">-¥${Math.round(periodFixed).toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 12px; color: var(--light-text-secondary);">减：销售提成</td><td style="padding:10px 12px; text-align:right;" class="money-val">-¥${Math.round(comm).toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 12px; color: var(--light-text-secondary);">减：商场抽成</td><td style="padding:10px 12px; text-align:right;" class="money-val">-¥${Math.round(mallExcess).toLocaleString()}</td></tr>
                        <tr style="background:#f8f9fa;"><td style="padding:12px; font-weight:700; color:#333;">净利润</td><td style="padding:12px; text-align:right; font-weight:700;" class="money-val">¥${Math.round(rangeProfit).toLocaleString()}</td></tr>
                    </table>
                    <div style="color: var(--light-text-tertiary); font-size:var(--text-sm); text-align:right; margin-top:20px; padding-top:16px; border-top:1px solid #eee;">报告生成时间: ${today.toLocaleString('zh-CN')}</div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="report-content report-printable" style="background:#fff; padding:25px; border-radius:10px; border:1px solid #eee;">
                <h4 style="color:#555; margin:0 0 20px 0;">财务报告 - ${label}</h4>
                <div style="margin-bottom:30px;">
                    <h3 style="color:#333; margin-bottom:15px; border-bottom:2px solid #2D6A4F; padding-bottom:10px;">一、执行摘要</h3>
                    <div style="line-height:1.8; color: var(--light-text-secondary);">
                        <p>本报告基于${data.length}天财务数据，本期（${label}）共${rangeData.length}天。本期营收¥${Math.round(rangeRevenue).toLocaleString()}，净利润¥${Math.round(rangeProfit).toLocaleString()}，净利润率${marginPct}%。</p>
                    </div>
                </div>
                <div style="margin-bottom:30px;">
                    <h3 style="color:#333; margin-bottom:15px; border-bottom:2px solid #2D6A4F; padding-bottom:10px;">二、财务指标</h3>
                    <div class="grid-2" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:15px;">
                        <div style="padding:15px; background:#f8f9fa; border-radius:8px;">
                            <div style="color: var(--light-text-secondary); font-size:var(--text-base); margin-bottom:5px;">本期营收</div>
                            <div class="money-val" style="font-size:var(--text-2xl); font-weight:bold; color:#2D6A4F;">¥${Math.round(rangeRevenue).toLocaleString()}</div>
                        </div>
                        <div style="padding:15px; background:#f8f9fa; border-radius:8px;">
                            <div style="color: var(--light-text-secondary); font-size:var(--text-base); margin-bottom:5px;">本期净利润</div>
                            <div class="money-val" style="font-size:var(--text-2xl); font-weight:bold; color:#27ae60;">¥${Math.round(rangeProfit).toLocaleString()}</div>
                        </div>
                        <div style="padding:15px; background:#f8f9fa; border-radius:8px;">
                            <div style="color: var(--light-text-secondary); font-size:var(--text-base); margin-bottom:5px;">累计营收</div>
                            <div class="money-val" style="font-size:var(--text-2xl); font-weight:bold; color:#333;">¥${Math.round(totalRevenue).toLocaleString()}</div>
                        </div>
                        <div style="padding:15px; background:#f8f9fa; border-radius:8px;">
                            <div style="color: var(--light-text-secondary); font-size:var(--text-base); margin-bottom:5px;">累计净利润</div>
                            <div class="money-val" style="font-size:var(--text-2xl); font-weight:bold; color:#27ae60;">¥${Math.round(totalProfit).toLocaleString()}</div>
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:30px;">
                    <h3 style="color:#333; margin-bottom:15px; border-bottom:2px solid #2D6A4F; padding-bottom:10px;">三、经营建议</h3>
                    <div style="line-height:1.8; color: var(--light-text-secondary);">
                        <p>基于当前财务数据，建议：</p>
                        <ul style="padding-left:20px; margin-top:10px;">
                            <li>继续保持当前经营节奏，关注成本控制</li>
                            <li>${rangeRevenue < (s.target * rangeData.length / 30) ? '本期营收未达目标，建议加强营销推广' : '本期营收已达标，建议继续保持'}</li>
                            <li>优化成本结构，提高利润率</li>
                            <li>建立财务预警机制，及时发现异常</li>
                        </ul>
                    </div>
                </div>
                <div style="color: var(--light-text-tertiary); font-size:var(--text-sm); text-align:right; margin-top:30px; padding-top:20px; border-top:1px solid #eee;">
                    报告生成时间: ${today.toLocaleString('zh-CN')}
                </div>
            </div>
        `;
    },

    getHealthScoreQuick(data, s) {
        if(!data || !data.length) return { grade: '-', text: '数据不足', suggestion: '' };
        const recent = data.slice(-30);
        const totalRevenue = recent.reduce((a,b)=>a+b.revenue,0);
        const totalProfit = recent.reduce((a,b)=>a+(b.profit != null ? b.profit : this.calcProfit(b.revenue, s).net),0);
        const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
        const revenueScore = Math.min(100, (totalRevenue / recent.length) / (s.target / 30) * 100);
        const profitScore = Math.min(100, profitMargin * 2);
        const stabilityScore = this.calculateStabilityScore(recent);
        const growthScore = this.calculateGrowthScore(recent);
        const healthScore = revenueScore * 0.3 + profitScore * 0.3 + stabilityScore * 0.2 + growthScore * 0.2;
        let grade, text, suggestion;
        if(healthScore >= 80) { grade = 'A'; text = '优秀'; suggestion = '经营状况良好，建议保持并适度扩张。'; }
        else if(healthScore >= 60) { grade = 'B'; text = '良好'; suggestion = '整体健康，可关注成本与周转率优化。'; }
        else if(healthScore >= 40) { grade = 'C'; text = '一般'; suggestion = '建议加强营收与成本控制，关注现金流。'; }
        else { grade = 'D'; text = '待改善'; suggestion = '建议尽快优化经营与成本结构，必要时寻求支持。'; }
        return { grade, text, suggestion };
    },

    downloadReport() {
        const reportContent = document.querySelector('#financeReport .report-content');
        if(!reportContent) {
            ElMessage.warning('报告内容不存在，请先生成报告');
            return;
        }
        const text = reportContent.innerText;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        link.setAttribute('download', `财务报告_${dateStr}.txt`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        ElMessage.success('报告下载成功');
    },

    printReport() {
        const reportContent = document.querySelector('#financeReport .report-content');
        if(!reportContent) {
            ElMessage.warning('报告内容不存在，请先生成报告');
            return;
        }
        const win = window.open('', '_blank');
        win.document.write(`
            <!DOCTYPE html><html><head>
            <meta charset="utf-8"><title>财务报告</title>
            <style>
                body { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 15px; line-height: 1.6; padding: 24px; color: #1a1815; }
                .money-val { font-weight: bold; }
                table { border-collapse: collapse; width: 100%; }
                table td { padding: 10px 12px; border-bottom: 1px solid #eee; }
            </style></head><body>
            ${reportContent.outerHTML}
            </body></html>
        `);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); win.close(); }, 300);
    },

    exportExcel() {
        if(!this.data.length) {
            ElMessage.warning('无数据可导出');
            return;
        }
        const s = this.getSettings();
        const exportData = this.data.map(r => ({
            "日期": r.date,
            "银联POS营收": r.revenue,
            "订单数": r.orderCount || '',
            "订单均价": r.avgOrderPrice || '',
            "客单价": r.customerPrice || '',
            "估算净利": this.calcProfit(r.revenue, s).net,
            "原始凭证": r.raw
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "财务账本");
        
        // 生成带日期的文件名（精确到日）
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const fileName = `山海造物_财务备份_${dateStr}.xlsx`;
        XLSX.writeFile(wb, fileName);
        ElMessage.success('Excel导出成功');
    },

    exportCSV() {
        if(!this.data.length) {
            ElMessage.warning('无数据可导出');
            return;
        }
        const s = this.getSettings();
        const headers = ['日期', '银联POS营收', '订单数', '订单均价', '客单价', '估算净利', '原始凭证'];
        const rows = this.data.map(r => {
            const profit = this.calcProfit(r.revenue, s).net;
            return [
                r.date,
                r.revenue,
                r.orderCount || '',
                r.avgOrderPrice || '',
                r.customerPrice || '',
                profit,
                r.raw || ''
            ];
        });
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        link.setAttribute('download', `山海造物_财务备份_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        ElMessage.success('CSV导出成功');
    },

    exportJSON() {
        if(!this.data.length) {
            ElMessage.warning('无数据可导出');
            return;
        }
        const s = this.getSettings();
        const exportData = {
            exportDate: new Date().toISOString(),
            settings: s,
            records: this.data.map(r => ({
                date: r.date,
                revenue: r.revenue,
                orderCount: r.orderCount || null,
                avgOrderPrice: r.avgOrderPrice || null,
                customerPrice: r.customerPrice || null,
                profit: this.calcProfit(r.revenue, s).net,
                raw: r.raw || ''
            }))
        };
        
        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        link.setAttribute('download', `山海造物_财务备份_${dateStr}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        ElMessage.success('JSON导出成功');
    },

    importExcel(input) {
        const file = input.files[0];
        if(!file) return;
        ensureDefaultFinanceStoreInLocalBundle();
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(e.target.result, {type:'array'});
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                const bImp = loadStoreBundle()
                const newRecords = json.map(row => {
                    const date = row['日期'];
                    const rev = row['银联POS营收'] || row['营收'] || row['总营收'] || row['Revenue'];
                    const raw = row['原始凭证'] || row['原始日报凭证'] || row['凭证'] || '';
                    const orderCount = row['订单数'] || row['订单数量'] || row['OrderCount'] || null;
                    
                    // 计算订单均价和客单价
                    let avgOrderPrice = null;
                    let customerPrice = null;
                    if (orderCount && !isNaN(orderCount) && parseFloat(orderCount) > 0 && rev && !isNaN(rev)) {
                        const revenue = parseFloat(rev);
                        const count = parseInt(orderCount, 10);
                        if (count > 0 && revenue > 0) {
                            avgOrderPrice = parseFloat((revenue / count).toFixed(2));
                            customerPrice = avgOrderPrice;
                        }
                    }
                    
                    const rec = { 
                        date, 
                        revenue: parseFloat(rev), 
                        raw,
                        orderCount: orderCount ? parseInt(orderCount, 10) : null,
                        avgOrderPrice,
                        customerPrice
                    };
                    return applyDefaultStoreToFinanceRecord(rec, bImp);
                }).filter(r => r.date && !isNaN(r.revenue));

                if(newRecords.length > 0 && confirm(`解析到 ${newRecords.length} 条记录，确定覆盖？`)) {
                    this.data = newRecords;
                    this.saveData(); this.renderAll();
                    alert('导入成功！');
                }
            } catch(err) { alert('文件解析错误'); }
            input.value = '';
        };
        reader.readAsArrayBuffer(file);
    }
});

// 🟢 组件挂载：尝试恢复 24h 内的解锁会话，若成功则直接进入并初始化
onMounted(() => {
    if (restoreFinanceSession()) {
        ensureDefaultFinanceStoreInLocalBundle()
        financeRecordStoreId.value = findDefaultFinanceStoreId(loadStoreBundle()) || ''
        nextTick(async () => {
            try { await app.init() } catch (e) { console.warn('app.init 失败', e) }
        })
    }
})

onUnmounted(() => {
    try { app.clearTimers() } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
    try { app.destroyAllCharts() } catch (e) { safeWarn('Finance 本地存储或图表清理失败（已忽略）', e) }
})
</script>

<style scoped>
/* 🔒 安全锁屏样式 — VI 对齐 现代化 */
.security-lock {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(ellipse at top, #1c3a2c 0%, #0f1f18 35%, #0a0f0d 100%);
    z-index: 1000;
    display: flex; justify-content: center; align-items: center;
    overflow: hidden;
}
.lock-bg-grid {
    position: absolute; inset: 0;
    background-image:
        radial-gradient(circle at 20% 30%, rgba(196, 165, 90, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 80% 70%, rgba(45, 106, 79, 0.15) 0%, transparent 50%),
        repeating-linear-gradient(0deg, transparent, transparent 49px, rgba(196, 165, 90, 0.04) 49px, rgba(196, 165, 90, 0.04) 50px),
        repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(196, 165, 90, 0.04) 49px, rgba(196, 165, 90, 0.04) 50px);
    pointer-events: none;
    animation: lock-grid-shift 22s linear infinite;
}
@keyframes lock-grid-shift {
    from { transform: translate(0, 0); }
    to { transform: translate(50px, 50px); }
}

.lock-card {
    position: relative;
    text-align: center; color: rgba(255,255,255,0.92);
    padding: 38px 36px 32px;
    background: linear-gradient(160deg, rgba(255,255,255,0.08), rgba(196, 165, 90, 0.04));
    backdrop-filter: blur(20px);
    border-radius: 20px;
    border: 1px solid rgba(196, 165, 90, 0.25);
    width: min(420px, 92vw);
    box-shadow: 0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset;
    z-index: 2;
}
.lock-card::before {
    content: '';
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 60%; height: 1px;
    background: linear-gradient(90deg, transparent, #d4af37, transparent);
}

.lock-icon {
    width: 72px; height: 72px;
    margin: 0 auto 20px;
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.2), rgba(212, 175, 55, 0.05));
    border: 1px solid rgba(212, 175, 55, 0.4);
    border-radius: 18px;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; color: #d4af37;
    box-shadow: 0 8px 24px rgba(212, 175, 55, 0.15), 0 0 0 4px rgba(212, 175, 55, 0.05);
    animation: lock-icon-pulse 3s ease-in-out infinite;
}
@keyframes lock-icon-pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 8px 24px rgba(212, 175, 55, 0.15), 0 0 0 4px rgba(212, 175, 55, 0.05); }
    50% { transform: scale(1.04); box-shadow: 0 8px 32px rgba(212, 175, 55, 0.3), 0 0 0 6px rgba(212, 175, 55, 0.08); }
}

.lock-card h2 {
    color: #e8f5f0;
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.lock-sub {
    font-size: 11px;
    color: rgba(212, 175, 55, 0.7);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin: 0 0 24px;
    font-weight: 500;
}

.lock-features {
    display: flex; justify-content: center; gap: 14px;
    margin-bottom: 28px;
    flex-wrap: wrap;
}
.lock-feature {
    font-size: 11px;
    color: rgba(245, 242, 236, 0.55);
    display: flex; align-items: center; gap: 5px;
}
.lock-feature i { color: rgba(212, 175, 55, 0.7); font-size: 10px; }

.lock-input-group {
    display: flex; gap: 8px; justify-content: center; align-items: center;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 4px;
    transition: border-color 0.2s, box-shadow 0.2s;
}
.lock-input-group:focus-within {
    border-color: rgba(212, 175, 55, 0.6);
    box-shadow: 0 0 0 4px rgba(212, 175, 55, 0.1);
}
.lock-input-icon {
    margin-left: 10px;
    color: rgba(212, 175, 55, 0.5);
    font-size: 14px;
}
.lock-input-group input {
    background: transparent;
    border: none;
    color: #fff;
    flex: 1;
    padding: 10px 4px;
    font-size: 14px;
    letter-spacing: 0.05em;
    outline: none;
}
.lock-input-group input::placeholder { color: rgba(255,255,255,0.3); }
.lock-input-group button {
    background: linear-gradient(135deg, #d4af37, #b7950b);
    border: none;
    padding: 10px 18px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    color: #1a1815;
    transition: all 0.2s;
    display: flex; align-items: center; gap: 6px;
    font-size: 13px;
    letter-spacing: 0.05em;
}
.lock-input-group button:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(212, 175, 55, 0.4); }
.lock-input-group button:active { transform: scale(0.97); }
.lock-tip {
    margin-top: 18px;
    font-size: 11px;
    color: rgba(245, 242, 236, 0.4);
    display: flex; align-items: center; justify-content: center; gap: 6px;
}
.lock-tip i { color: rgba(212, 175, 55, 0.5); }

/* 财务模块根：VI 中文正文字体 + 抗锯齿（与 design-tokens 一致） */
.finance-wrapper {
    font-family: var(--font-cn-body), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

.finance-store-hint {
    margin: var(--space-2) 0 0 0;
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
    line-height: var(--leading-normal);
}

/* 财务页局部语义色：对齐山海造物 ERP VI */
.finance-body {
    --primary: var(--brand-green-500);
    --primary-dark: var(--brand-green-700);
    --primary-light: var(--brand-green-300);
    --accent: var(--semantic-error-icon);
    --accent-dark: #b8403c;
    --accent-light: #ec7063;
    --gold: var(--gold-400);
    --gold-light: var(--gold-200);
    --gold-dark: var(--gold-600);
    --pink: var(--earth-300);
    --pink-light: var(--earth-100);
    --success: var(--semantic-success-icon);
    --danger: var(--semantic-error-icon);
    --info: var(--cat-marine-mid);
    --text-main: var(--light-text-primary);
    --text-light: var(--light-text-secondary);
    --bg-body: var(--light-bg-primary);
    --bg-card: var(--light-bg-elevated);
    --radius: var(--radius-lg);
    --shadow: var(--shadow-md);

    font-family: var(--font-cn-body), -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: var(--text-base);
    color: var(--text-main);
    line-height: var(--leading-normal);
    background: var(--bg-body);
}

.finance-container { max-width: 100%; margin: 0 auto; }

.finance-header {
    background: linear-gradient(118deg, var(--brand-green-800) 0%, var(--brand-green-600) 42%, var(--brand-green-700) 100%);
    color: rgba(255, 255, 255, 0.96);
    padding: var(--space-6) var(--space-8);
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-8);
    box-shadow: var(--shadow-lg);
    position: relative;
    overflow: hidden;
    border-bottom: 3px solid var(--gold-400);
}
.finance-header::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 120% 80% at 100% 0%, rgba(196, 165, 90, 0.18), transparent 55%);
    pointer-events: none;
}
.finance-header-title { position: relative; z-index: 2; }
.finance-header h1 {
    font-size: clamp(var(--text-xl), 2.4vw, var(--text-3xl));
    margin: 0 0 var(--space-1);
    letter-spacing: -0.03em;
    font-weight: var(--weight-semibold);
    position: relative;
    color: #fff;
    font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
    display: flex;
    align-items: center;
    gap: 12px;
}
.finance-header h1 i {
    color: var(--gold-300);
    font-size: 0.9em;
    -webkit-text-fill-color: var(--gold-300);
}
.finance-header p {
    opacity: 0.88;
    font-size: var(--text-sm);
    position: relative;
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    letter-spacing: 0.02em;
}
.finance-header-sandbox-btn {
    background: rgba(244, 237, 224, 0.12) !important;
    border: 1px solid rgba(154, 123, 79, 0.45) !important;
    color: #f5f2ec !important;
}
.finance-header-sandbox-btn:hover {
    border-color: rgba(212, 175, 55, 0.7) !important;
    color: #d4af37 !important;
}
.finance-header-ai-btn {
    background: linear-gradient(135deg, #d4af37, #b7950b) !important;
    border: none !important;
    box-shadow: 0 4px 14px rgba(212, 175, 55, 0.35);
    transition: all 0.2s;
}
.finance-header-ai-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(212, 175, 55, 0.5); }

.header-actions {
    position: absolute; right: var(--space-6); top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    display: flex; align-items: center; gap: 10px;
}

.privacy-toggle {
    cursor: pointer;
    background: rgba(0, 0, 0, 0.22);
    padding: 7px 14px;
    border-radius: 999px;
    font-size: var(--text-sm);
    display: flex; align-items: center; gap: 6px;
    transition: all 0.2s;
    border: 1px solid rgba(255,255,255,0.22);
    backdrop-filter: blur(8px);
    color: rgba(255,255,255,0.9);
    user-select: none;
}
.privacy-toggle:hover { background: rgba(0, 0, 0, 0.4); border-color: rgba(212, 175, 55, 0.5); }
.privacy-toggle i { color: rgba(212, 175, 55, 0.85); }
.finance-header-lock-btn {
    color: rgba(255,255,255,0.7) !important;
    background: rgba(0, 0, 0, 0.18) !important;
    padding: 6px 10px !important;
    border-radius: 8px !important;
    font-size: 12px !important;
    transition: all 0.2s !important;
}
.finance-header-lock-btn:hover { color: var(--gold-300) !important; background: rgba(0, 0, 0, 0.3) !important; }

.card {
    background: var(--light-bg-elevated);
    border-radius: var(--radius-xl);
    padding: var(--space-6) var(--space-8);
    margin-bottom: var(--space-6);
    box-shadow: var(--shadow-md);
    border: 1px solid var(--light-border-subtle);
    border-top: 3px solid var(--brand-green-500);
    transition: box-shadow var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-out-soft), border-color var(--duration-normal) var(--ease-standard);
    position: relative;
    overflow: hidden;
}
.card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--brand-green-500) 0%, var(--gold-400) 100%);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-standard);
}
.card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
    border-color: var(--light-border-default);
}
.card:hover::before {
    opacity: 1;
}

.card-header { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    border-bottom: 2px solid #f0f0f0; 
    padding-bottom: 18px; 
    margin-bottom: 24px;
    position: relative;
}
.card-header::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 60px;
    height: 2px;
    background: linear-gradient(90deg, var(--accent) 0%, transparent 100%);
}
.card-title {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    letter-spacing: -0.02em;
}
.card-title i { 
    color: var(--primary); 
    font-size: var(--text-lg);
    opacity: 0.9;
}

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; }

.quick-dashboard-card .card-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.quick-dashboard-tip { font-size: var(--text-sm); color: var(--light-text-tertiary); font-weight: normal; }
.quick-dashboard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.quick-stat {
    padding: 18px 20px;
    border-radius: 12px;
    border-left: 4px solid #2D6A4F;
    background: linear-gradient(135deg, #faf8fc 0%, #f5f0f9 100%);
    position: relative;
    overflow: hidden;
    transition: transform 0.2s var(--ease-out-soft), box-shadow 0.2s;
    cursor: default;
}
.quick-stat:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(45, 106, 79, 0.12); }
.quick-stat::after {
    content: '';
    position: absolute;
    top: 0; right: 0;
    width: 80px; height: 80px;
    background: radial-gradient(circle at 100% 0%, rgba(45, 106, 79, 0.08), transparent 70%);
    pointer-events: none;
}
.quick-stat.week { border-left-color: #3498db; background: linear-gradient(135deg, #f0f8ff 0%, #e8f4fc 100%); }
.quick-stat.week::after { background: radial-gradient(circle at 100% 0%, rgba(52, 152, 219, 0.08), transparent 70%); }
.quick-stat.month { border-left-color: #c4a55a; background: linear-gradient(135deg, #fffbe6 0%, #fff5d9 100%); }
.quick-stat.month::after { background: radial-gradient(circle at 100% 0%, rgba(196, 165, 90, 0.12), transparent 70%); }
.quick-stat-label {
    font-size: 11px;
    color: var(--light-text-secondary);
    margin-bottom: 8px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
}
.quick-stat-val {
    font-size: clamp(var(--text-xl), 2.2vw, var(--text-2xl));
    font-weight: 700;
    color: var(--light-text-primary);
    font-family: var(--font-mono), ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1.1;
}
.quick-stat-sub {
    font-size: 12px;
    color: var(--light-text-tertiary);
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(0,0,0,0.06);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
@media (max-width: 768px) { .quick-dashboard-grid { grid-template-columns: 1fr; } }

.report-tab-content { padding-top: 12px; }
.report-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; padding: 12px 16px; background: #f8f9fa; border-radius: 8px; }
.report-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.report-controls label { font-size: var(--text-base); color: var(--light-text-secondary); white-space: nowrap; }
.report-actions { display: flex; gap: 10px; }
.finance-report-body { min-height: 120px; }

.inventory-sync-bar { margin-top: 14px; padding: 14px 16px; background: linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%); border: 1px solid rgba(45, 106, 79, 0.25); border-radius: 10px; }
.inventory-sync-summary { display: flex; align-items: center; gap: 8px; font-size: var(--text-base); color: var(--light-text-primary); margin-bottom: 10px; }
.inventory-sync-summary i { color: #2D6A4F; }
.inventory-sync-actions { margin-bottom: 8px; }
.inventory-sync-result { font-size: var(--text-sm); padding-top: 10px; border-top: 1px dashed rgba(0,0,0,0.08); }
.inventory-sync-result .result-ok { color: #27ae60; }
.inventory-sync-result .result-warn { color: #f39c12; }

.form-group { margin-bottom: 15px; }
.form-label { display: block; font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-light); margin-bottom: 6px; }
.form-control {
    width: 100%; padding: 10px 12px; border: 1px solid #e0e0e0; border-radius: 6px; 
    font-size: var(--text-base); transition: all 0.3s; background: #fafafa;
}
.form-control:focus { border-color: var(--primary); background: #fff; box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.1); }

.btn { padding: 9px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: var(--weight-semibold); transition: 0.2s; font-size: var(--text-base); display: inline-flex; align-items: center; gap: 6px; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-dark); }
.btn-primary:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.btn-gold {
    background: linear-gradient(135deg, var(--gold-600) 0%, var(--gold-400) 100%);
    color: var(--light-text-primary);
    font-weight: var(--weight-semibold);
    box-shadow: var(--shadow-sm);
}
.btn-gold:hover { filter: brightness(1.05); }
.btn-gold:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.btn-outline { background: white; border: 1px solid #ddd; color: var(--light-text-secondary); }
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }
.btn:disabled { background: #eee; color: #bbb; cursor: not-allowed; }

.stat-box { 
    background: #fff; border: 1px solid #eee; border-left: 4px solid var(--primary); 
    border-radius: 8px; padding: 15px 20px; position: relative;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.stat-box:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.stat-box.highlight-box { 
    background: linear-gradient(135deg, #fff 0%, #fafafa 100%);
    border-left-width: 5px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.stat-label { font-size: var(--text-sm); color: var(--text-light); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
.stat-val { font-size: clamp(var(--text-xl), 2.2vw, var(--text-3xl)); font-weight: var(--weight-semibold); color: var(--text-main); font-family: var(--font-mono), ui-monospace, monospace; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.stat-val.profit { color: var(--success); }
.stat-sub { font-size: var(--text-sm); color: var(--light-text-tertiary); margin-top: 5px; }

/* 月度经营看板样式 */
.monthly-dashboard { display: flex; flex-direction: column; gap: 25px; }
.dashboard-section { 
    background: #fafafa; 
    border-radius: 10px; 
    padding: 20px; 
    border: 1px solid #eee;
}
.section-title { 
    font-size: var(--text-base); 
    font-weight: var(--weight-semibold); 
    color: var(--text-main); 
    margin: 0 0 15px 0; 
    padding-bottom: 10px; 
    border-bottom: 2px solid var(--primary); 
    display: inline-block;
}
.section-title--block {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0;
}
.section-hint {
    font-size: var(--text-sm);
    color: var(--light-text-tertiary);
    margin: -6px 0 16px 0;
    line-height: 1.55;
    max-width: 920px;
}
.panel-head {
    margin-bottom: 14px;
    min-width: 0;
}
.panel-hint-details {
    margin-top: 6px;
    font-size: var(--text-sm);
    max-width: 100%;
}
.panel-hint-details summary {
    cursor: pointer;
    color: #2D6A4F;
    font-weight: 600;
    user-select: none;
    list-style: none;
    padding: 6px 0;
}
.panel-hint-details summary::-webkit-details-marker { display: none; }
.panel-hint-details summary::before {
    content: '▸ ';
    display: inline-block;
    transition: transform 0.15s ease;
    opacity: 0.7;
}
.panel-hint-details[open] summary::before {
    transform: rotate(90deg);
}
.panel-hint-body {
    margin: 8px 0 0 0;
    padding: 12px 14px;
    line-height: 1.55;
    color: var(--light-text-secondary);
    background: #fff;
    border-radius: 10px;
    border: 1px solid #e8e8e8;
    box-sizing: border-box;
    overflow-wrap: break-word;
    word-break: break-word;
}

/* 每月要点 + 商场分成：防溢出、分区留白 */
.monthly-brief-section,
.mall-share-section {
    overflow-x: hidden;
    min-width: 0;
}
.monthly-brief-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr);
    gap: clamp(14px, 2.5vw, 24px);
    align-items: stretch;
}
.monthly-brief-panel {
    background: #fff;
    border: 1px solid #e8e8e8;
    border-radius: 12px;
    padding: 14px 16px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.monthly-brief-panel-title {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--light-text-tertiary);
    margin: 0;
}
.monthly-brief-label {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
    margin: -4px 0 0 0;
    font-weight: normal;
    line-height: 1.45;
}
.monthly-brief-caption--top {
    text-align: left;
    margin: -4px 0 0 0 !important;
}
.monthly-brief-poster-frame {
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
    aspect-ratio: 794 / 1180;
    position: relative;
    border-radius: 12px;
    border: 1px solid #e0e8e4;
    background: #eef5f1;
    overflow: hidden;
    box-sizing: border-box;
    min-height: 200px;
}
.monthly-brief-poster-canvas {
    display: block;
    width: 100%;
    height: 100%;
    vertical-align: top;
}
.monthly-brief-chart-caption {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
    margin: 0;
    text-align: center;
    line-height: 1.4;
}
.monthly-brief-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: auto;
    padding-top: 4px;
}
.monthly-brief-actions {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.monthly-brief-textarea {
    flex: 1 1 auto;
    min-height: 140px;
    max-height: 320px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    resize: vertical;
    line-height: 1.5;
    overflow-x: hidden;
    overflow-y: auto;
}
.btn-block-mobile {
    width: 100%;
    box-sizing: border-box;
    justify-content: center;
}

.mall-share-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 14px;
    min-width: 0;
}
.mall-share-card {
    min-width: 0;
    padding: 14px 14px 12px;
    box-sizing: border-box;
}
.mall-share-card .stat-label {
    line-height: 1.3;
    hyphens: auto;
}
.mall-share-val {
    font-size: clamp(0.9rem, 2.1vw, 1.35rem) !important;
    line-height: 1.25;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.mall-share-sub {
    overflow-wrap: break-word;
    line-height: 1.35;
}

@media (max-width: 960px) {
    .monthly-brief-grid { grid-template-columns: 1fr; }
    .mall-share-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (max-width: 520px) {
    .mall-share-grid {
        grid-template-columns: 1fr;
        gap: 10px;
    }
    .monthly-brief-panel { padding: 12px 12px; }
    .dashboard-section { padding: 14px; }
}

::v-deep .blur-text { color: transparent !important; text-shadow: 0 0 8px rgba(0,0,0,0.4); user-select: none; }

.radar-container { margin-top: 10px; }
.radar-bar { height: 10px; background: #eee; border-radius: 5px; overflow: hidden; display: flex; }
.radar-fixed { background: var(--danger); height: 100%; transition: width 1s ease-in-out; }
.radar-profit { background: var(--success); height: 100%; transition: width 1s ease-in-out; }
.radar-labels { display: flex; justify-content: space-between; font-size: var(--text-xs); color: var(--light-text-tertiary); margin-top: 4px; }

.calendar-wrapper { 
    margin-top: 20px; 
    border-top: 1px dashed rgba(45, 106, 79, 0.2); 
    padding-top: 20px; 
    background: linear-gradient(135deg, #ffffff 0%, #f8f4fb 100%);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 12px rgba(45, 106, 79, 0.05);
}

.calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 15px;
}

.calendar-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-main);
}

.calendar-title i {
    color: var(--primary);
    font-size: var(--text-xl);
}

.calendar-subtitle {
    font-size: var(--text-sm);
    font-weight: normal;
    color: var(--text-light);
    margin-left: 5px;
}

.calendar-legend {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
    align-items: center;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--text-light);
}

.legend-dot {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(0,0,0,0.1);
}

.heat-0-dot { background: #f5f5f5; opacity: 0.5; }
.heat-1-dot { background: linear-gradient(135deg, #fffaf0 0%, #f9e79f 100%); }
.heat-2-dot { background: linear-gradient(135deg, #fdedec 0%, #f1948a 100%); }
.heat-3-dot { background: linear-gradient(135deg, #f5b7b1 0%, #e74c3c 100%); }
.heat-4-dot { background: linear-gradient(135deg, #e6b0aa 0%, #c0392b 100%); }

.legend-label {
    font-weight: 500;
}

.calendar-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
    margin-bottom: 10px;
    text-align: center;
}

.weekday {
    font-weight: 700;
    color: var(--text-light);
    font-size: var(--text-sm);
    padding: 8px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.calendar-grid { 
    display: grid; 
    grid-template-columns: repeat(7, 1fr); 
    gap: 8px; 
}

.calendar-stats {
    margin-top: 20px;
    padding-top: 15px;
    border-top: 1px solid rgba(45, 106, 79, 0.1);
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    justify-content: center;
}

.stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 10px 15px;
    background: rgba(45, 106, 79, 0.05);
    border-radius: 8px;
    min-width: 100px;
}

.stat-label {
    font-size: var(--text-xs);
    color: var(--text-light);
    font-weight: 500;
}

.stat-value {
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--primary);
}

.stat-empty {
    text-align: center;
    color: var(--text-light);
    font-size: var(--text-base);
    padding: 10px;
}

::v-deep .cal-day { 
    background: white; 
    border: 2px solid #f0f0f0; 
    border-radius: 8px; 
    min-height: 80px; 
    padding: 8px; 
    display: flex; 
    flex-direction: column; 
    justify-content: space-between; 
    cursor: pointer; 
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

::v-deep .cal-day::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--primary);
    opacity: 0;
    transition: opacity 0.3s;
}

::v-deep .cal-day:hover { 
    transform: translateY(-3px) scale(1.02); 
    box-shadow: 0 8px 20px rgba(45, 106, 79, 0.15); 
    border-color: var(--primary); 
    z-index: 5; 
}

::v-deep .cal-day:hover::before {
    opacity: 1;
}

::v-deep .cal-day.cal-empty {
    background: transparent;
    border: none;
    cursor: default;
}

::v-deep .cal-day.cal-empty:hover {
    transform: none;
    box-shadow: none;
}

::v-deep .cal-num { 
    font-size: var(--text-sm); 
    font-weight: 700; 
    color: var(--text-main);
    margin-bottom: 4px;
}

::v-deep .cal-rev { 
    font-size: var(--text-sm); 
    font-weight: 700; 
    color: var(--primary); 
    text-align: right;
    margin-top: auto;
}

::v-deep .cal-profit {
    font-size: var(--text-xs);
    font-weight: 600;
    text-align: right;
    margin-top: 2px;
}

::v-deep .cal-profit.profit-positive {
    color: #27ae60;
}

::v-deep .cal-profit.profit-negative {
    color: #e74c3c;
}

::v-deep .cal-orders {
    font-size: var(--text-xs);
    color: var(--text-light);
    text-align: right;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
}

::v-deep .cal-orders i {
    font-size: var(--text-xs);
}

/* 热力等级 - 使用九紫离火运配色 */
::v-deep .heat-0 { 
    opacity: 0.4; 
    background: #f5f5f5;
}

::v-deep .heat-1 { 
    background: linear-gradient(135deg, #fffaf0 0%, #f9e79f 100%); 
    border-color: #f9e79f;
}

::v-deep .heat-2 { 
    background: linear-gradient(135deg, #fdedec 0%, #f1948a 100%); 
    border-color: #f1948a;
}

::v-deep .heat-3 { 
    background: linear-gradient(135deg, #f5b7b1 0%, #e74c3c 100%); 
    border-color: #e74c3c;
    color: #fff;
}

::v-deep .heat-3 .cal-num,
::v-deep .heat-3 .cal-rev,
::v-deep .heat-3 .cal-profit,
::v-deep .heat-3 .cal-orders {
    color: rgba(255,255,255,0.95);
}

::v-deep .heat-4 { 
    background: linear-gradient(135deg, #e6b0aa 0%, #c0392b 100%); 
    border-color: #c0392b; 
    color: #fff;
    box-shadow: 0 2px 8px rgba(192, 57, 43, 0.2);
}

::v-deep .heat-4 .cal-num,
::v-deep .heat-4 .cal-rev,
::v-deep .heat-4 .cal-profit,
::v-deep .heat-4 .cal-orders {
    color: rgba(255,255,255,0.95);
}

::v-deep .heat-4::before {
    opacity: 1;
    background: #fff;
}

details.settings-panel summary { 
    cursor: pointer; padding: 15px; background: #fdfdfd; border: 1px solid #eee; border-radius: 8px; 
    font-weight: 600; color: var(--text-main); list-style: none; display: flex; justify-content: space-between; align-items: center;
}
details.settings-panel summary:hover { background: #f8f8f8; }
details.settings-panel[open] summary { border-bottom: none; border-radius: 8px 8px 0 0; background: #fff; border-bottom: 1px solid transparent; }
.settings-content { padding: 25px; border: 1px solid #eee; border-top: none; background: white; border-radius: 0 0 8px 8px; }

.ledger-wrapper { max-height: 500px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; background: #fff; }

::v-deep details.month-group { border-bottom: 1px solid #eee; }
::v-deep details.month-group:last-child { border-bottom: none; }
::v-deep details.month-group summary { 
    padding: 15px 20px; cursor: pointer; background: #fcfcfc; font-weight: 600; 
    display: flex; justify-content: space-between; align-items: center; transition: 0.2s;
    position: relative;
}
::v-deep details.month-group summary:hover { background: #f5f5f5; }
::v-deep details.month-group[open] summary { background: #fffbfb; color: var(--primary); border-bottom: 1px solid #eee; position: sticky; top: 0; z-index: 10; }
::v-deep details.month-group summary > *:first-child { flex: 1; }
::v-deep details.month-group summary > *:not(:first-child):not(.btn-delete-month) { margin-left: 10px; }

::v-deep table.ledger-table { width: 100%; border-collapse: collapse; font-size: var(--text-base); }
::v-deep table.ledger-table th { background: #f8f9fa; text-align: left; padding: 12px 15px; color: var(--light-text-secondary); border-bottom: 2px solid #eee; font-weight: 600; font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.5px; }
::v-deep table.ledger-table td { padding: 12px 15px; border-bottom: 1px solid #f9f9f9; vertical-align: top; }
::v-deep table.ledger-table tr:hover { background: #fafafa; }
::v-deep table.ledger-table tr:last-child td { border-bottom: none; }

.btn-delete-record {
    padding: 4px 10px;
    font-size: var(--text-sm);
    border: 1px solid var(--danger);
    background: #fff;
    color: var(--danger);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.btn-delete-record:hover {
    background: var(--danger);
    color: #fff;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(231, 76, 60, 0.3);
}
.btn-delete-record:active {
    transform: translateY(0);
}

.btn-delete-month {
    padding: 4px 12px;
    font-size: var(--text-xs);
    border: 1px solid var(--danger);
    background: rgba(231, 76, 60, 0.1);
    color: var(--danger);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
}
.btn-delete-month:hover {
    background: var(--danger);
    color: #fff;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(231, 76, 60, 0.3);
}
.btn-delete-month:active {
    transform: translateY(0);
}

::v-deep .raw-text { font-size: var(--text-sm); color: var(--light-text-tertiary); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; background: #f8f9fa; padding: 2px 6px; border-radius: 4px; }
::v-deep .raw-text:hover { white-space: pre-wrap; max-height: none; background: #fff; position: relative; z-index: 2; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border: 1px solid #eee; }

.hidden { display: none; }
.alert { padding: 12px; border-radius: 6px; margin-top: 15px; font-size: var(--text-base); display: none; }
.alert-success { background: #e8f8f5; color: #27ae60; border: 1px solid #d1f2eb; }
.alert-error { background: var(--semantic-error-bg); color: var(--semantic-error-text); border: 1px solid #fadbd8; }

.trend-chart-container {
    height: 250px;
    position: relative;
    width: 100%;
    overflow: hidden;
    padding: 10px;
    box-sizing: border-box;
}

.trend-chart-container canvas {
    max-width: 100%;
    height: 100% !important;
}

/* 成本分析卡片样式 */
.cost-analysis-card {
    position: relative;
}

.cost-analysis-card .card-actions {
    display: flex;
    gap: 12px;
    align-items: center;
}

.month-selector {
    min-width: 160px;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    border: 2px solid #e5e7eb;
    padding: 10px 14px;
    border-radius: 8px;
    transition: all 0.3s;
    background: #ffffff;
}

.month-selector:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.1);
    outline: none;
}

.btn-refresh {
    padding: 10px 16px;
    border-radius: 8px;
    font-weight: 600;
    transition: all 0.3s;
}

.btn-refresh:hover {
    background: var(--primary);
    color: #fff;
    border-color: var(--primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(45, 106, 79, 0.2);
}

/* 分析标签页样式 - 现代化 */
.analysis-tabs {
    margin-top: 24px;
}

.tab-buttons {
    display: flex;
    gap: 4px;
    border-bottom: 2px solid #e5e7eb;
    margin-bottom: 24px;
    padding-bottom: 0;
    background: #f9fafb;
    padding: 4px;
    border-radius: 12px;
}

.tab-btn {
    padding: 12px 24px;
    border: none;
    background: transparent;
    color: var(--light-text-secondary);
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    border-radius: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    flex: 1;
    justify-content: center;
    letter-spacing: 0.3px;
}

.tab-btn i {
    font-size: var(--text-base);
}

.tab-btn:hover {
    color: var(--primary);
    background: rgba(255, 255, 255, 0.8);
    transform: translateY(-1px);
}

.tab-btn.active {
    color: #fff;
    background: linear-gradient(135deg, var(--brand-green-600) 0%, var(--brand-green-800) 100%);
    box-shadow: 0 4px 14px rgba(45, 106, 79, 0.28);
    transform: translateY(-1px);
}

.tab-btn.active:hover {
    background: linear-gradient(135deg, var(--brand-green-700) 0%, var(--brand-green-900) 100%);
}

.tab-content {
    min-height: 400px;
    animation: fadeIn 0.4s ease-in;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* 成本分析容器 */
.cost-analysis-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

/* 总览区域 */
.cost-overview-section {
    margin-bottom: 0;
}

.overview-cards-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
}

@media (max-width: 960px) {
    .overview-cards-grid {
        grid-template-columns: 1fr;
    }
}

/* 顶部总览卡片 */
.cost-overview-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 15px;
    margin-bottom: 5px;
}

.overview-card {
    background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
    border: 1px solid #e5e7eb;
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
    position: relative;
    overflow: hidden;
    cursor: pointer;
}

.overview-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: var(--card-accent, #2D6A4F);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 0 8px rgba(0,0,0,0.1);
}

.overview-card::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(45, 106, 79, 0.02) 0%, transparent 100%);
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
}

.overview-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.08);
    border-color: var(--card-accent, #2D6A4F);
    background: linear-gradient(135deg, #ffffff 0%, #f8f4fb 100%);
}

.overview-card:hover::before {
    width: 6px;
    box-shadow: 0 0 12px var(--card-accent, #2D6A4F);
}

.overview-card:hover::after {
    opacity: 1;
}

.overview-card:hover .overview-icon {
    transform: scale(1.1) rotate(5deg);
    box-shadow: 0 8px 20px rgba(0,0,0,0.2);
}

.revenue-card { --card-accent: #2D6A4F; }
.cost-card { --card-accent: #e74c3c; }
.profit-card { --card-accent: #27ae60; }
.margin-card { --card-accent: #2D6A4F; }

.overview-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--card-accent, #2D6A4F) 0%, var(--card-accent, #2D6A4F)dd 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: var(--text-xl);
    flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.overview-icon::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.3s;
}

.overview-card:hover .overview-icon::before {
    opacity: 1;
}

.overview-content {
    flex: 1;
    min-width: 0;
}

.overview-label {
    font-size: var(--text-sm);
    color: var(--light-text-secondary);
    font-weight: var(--weight-medium);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.overview-value {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--light-text-primary);
    margin-bottom: 2px;
    line-height: var(--leading-tight);
    font-family: var(--font-mono), ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
}

.overview-sub {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
    font-weight: var(--weight-medium);
}

/* 图表区域：双图同宽、同高 */
.charts-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    align-items: stretch;
}

.charts-section--uniform {
    --cost-chart-h: 210px;
}

.charts-section--uniform .chart-card {
    padding: var(--space-3);
}

@media (max-width: 1024px) {
    .charts-section--uniform {
        grid-template-columns: 1fr;
        --cost-chart-h: 200px;
    }
}

.chart-card {
    background: var(--light-bg-elevated);
    border: 1px solid var(--light-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.chart-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--brand-green-500) 0%, var(--gold-400) 100%);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-standard);
}

.chart-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
    border-color: var(--light-border-default);
}

.chart-card:hover::before {
    opacity: 1;
}

.chart-card-primary {
    --panel-accent: var(--primary);
}

.chart-card-secondary {
    --panel-accent: var(--accent);
}

.chart-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 2px solid #f3f4f6;
}

.chart-card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-main);
    letter-spacing: 0.3px;
}

.chart-card-title i {
    color: var(--primary);
    font-size: var(--text-xl);
}

.chart-card-body {
    position: relative;
    min-height: 280px;
    padding: 10px;
}

.chart-card-body canvas {
    position: relative;
    z-index: 1;
    max-width: 100%;
    max-height: 100%;
}

/* 成本双图：固定高度，避免 flex + min-height 与 Chart 响应式互相撑高导致无限重排 */
.chart-card-header--compact {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom-width: 1px;
    border-bottom-color: var(--light-border-subtle);
}

.chart-card-header--compact .chart-card-title {
    font-size: var(--text-base);
    gap: 6px;
}

.chart-card-header--compact .chart-card-title i {
    font-size: var(--text-base);
}

.chart-legend--below-title {
    gap: 6px 8px;
    margin-bottom: 6px;
    max-height: 56px;
    overflow-y: auto;
    align-items: flex-start;
    align-content: flex-start;
}

.chart-legend--below-title :deep(.legend-item--compact) {
    padding: 2px 6px;
    font-size: var(--text-xs);
    gap: 4px;
}

.chart-legend--below-title :deep(.legend-item--compact .legend-dot) {
    width: 7px;
    height: 7px;
}

.chart-legend--below-title :deep(.legend-item--compact .legend-label) {
    max-width: 5.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chart-card-body.chart-card-body--fixed {
    min-height: unset !important;
    height: var(--cost-chart-h, 210px);
    max-height: var(--cost-chart-h, 210px);
    flex: 0 0 var(--cost-chart-h, 210px);
    padding: 4px 6px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
}

.chart-card-body--fixed canvas {
    flex: 0 1 auto;
    max-width: 100%;
    max-height: 100%;
}

.chart-card-body--fixed :deep(.chart-center-info) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    z-index: 10;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 88px;
    height: 88px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 50%;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08), inset 0 0 0 2px rgba(45, 106, 79, 0.1);
    backdrop-filter: blur(10px);
    animation: fadeIn 0.45s ease-out;
}

.chart-card-body--fixed :deep(.center-total-label) {
    font-size: var(--text-xs);
    margin-bottom: 2px;
    letter-spacing: 0.06em;
    color: #6b7280;
    font-weight: 700;
    text-transform: uppercase;
    opacity: 0.9;
}

.chart-card-body--fixed :deep(.center-total-value) {
    font-size: var(--text-base);
    margin-bottom: 2px;
    font-weight: 900;
    color: #2d6a4f;
    font-family: 'Segoe UI', 'Consolas', monospace;
    line-height: 1.1;
    letter-spacing: -0.5px;
}

.chart-card-body--fixed :deep(.center-profit-margin) {
    font-size: var(--text-xs);
    margin-top: 2px;
    padding: 1px 6px;
    color: #9ca3af;
    font-weight: 700;
    background: #f3f4f6;
    border-radius: 10px;
    font-family: monospace;
}

/* 成本明细区 · 精简排版 */
.cost-details-section--slim {
    padding: var(--space-4) var(--space-5);
    box-shadow: var(--shadow-sm);
}

.section-header-modern--slim {
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-2);
    gap: var(--space-2);
}

.section-title-modern--slim {
    font-size: var(--text-base);
    gap: var(--space-2);
}

.section-title-modern--slim i {
    font-size: var(--text-lg);
}

/* innerHTML 注入的子节点无 scoped data 属性，须从模板节点用 :deep 穿透 */
.cost-summary-badges :deep(.cost-summary-panel) {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
}

.cost-summary-badges :deep(.cost-summary-inline) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px 8px;
    font-size: var(--text-xs);
}

.cost-summary-badges :deep(.csi-chip) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: var(--radius-md);
    background: var(--light-bg-muted, #f3f4f6);
    border: 1px solid var(--light-border-subtle);
    color: var(--light-text-secondary);
    white-space: nowrap;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
}

.cost-summary-badges :deep(.csi-chip__lbl) {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--light-text-tertiary, #6b7280);
    letter-spacing: 0.02em;
}

.cost-summary-badges :deep(.csi-chip__dot) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brand-green-500, #2d6a4f);
    flex-shrink: 0;
}

.cost-summary-badges :deep(.csi-chip__dot--var) {
    background: linear-gradient(135deg, #f39c12, #e74c3c);
}

.cost-summary-badges :deep(.csi-chip--fixed) {
    border-color: rgba(45, 106, 79, 0.25);
    background: linear-gradient(180deg, rgba(45, 106, 79, 0.08) 0%, var(--light-bg-muted, #f3f4f6) 100%);
}

.cost-summary-badges :deep(.csi-chip--variable) {
    border-color: rgba(227, 116, 60, 0.28);
    background: linear-gradient(180deg, rgba(243, 156, 18, 0.1) 0%, var(--light-bg-muted, #f3f4f6) 100%);
}

.cost-summary-badges :deep(.csi-chip--accent) {
    background: var(--semantic-warning-bg, #fffbeb);
    border-color: rgba(196, 165, 90, 0.45);
    color: var(--light-text-primary);
}

.cost-summary-badges :deep(.csi-chip--accent strong) {
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    color: var(--brand-green-700, #1b4332);
}

.cost-summary-badges :deep(.cost-summary-bar) {
    width: min(320px, 100%);
}

.cost-summary-badges :deep(.cost-summary-bar__track) {
    display: flex;
    height: 8px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--light-border-subtle, #e5e7eb);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
}

.cost-summary-badges :deep(.cost-summary-bar__seg) {
    min-width: 0;
    transition: width 0.35s var(--ease-standard, ease-out);
}

.cost-summary-badges :deep(.cost-summary-bar__seg--fixed) {
    background: linear-gradient(90deg, #2d6a4f, #40916c);
}

.cost-summary-badges :deep(.cost-summary-bar__seg--var) {
    background: linear-gradient(90deg, #f39c12, #e67e22);
}

.cost-summary-badges :deep(.cost-summary-bar__ticks) {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: var(--text-xs);
    color: var(--light-text-tertiary, #9ca3af);
    font-variant-numeric: tabular-nums;
}

.cost-detail-table-wrap {
    min-height: 0;
}

.cost-detail-table-wrap :deep(.cost-detail-table-scroll) {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--light-border-subtle);
    border-radius: var(--radius-md);
    -webkit-overflow-scrolling: touch;
    background: var(--light-bg-elevated, #fff);
    box-shadow: var(--shadow-sm);
}

.cost-detail-table-wrap :deep(.cost-detail-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
}

.cost-detail-table-wrap :deep(.cost-detail-table--viz tbody tr) {
    border-left: 3px solid var(--row-accent, var(--light-border-subtle));
}

.cost-detail-table-wrap :deep(.cost-detail-table--viz tbody td) {
    border-right: 1px solid rgba(0, 0, 0, 0.04);
}

.cost-detail-table-wrap :deep(.cost-detail-table--viz tbody td:last-child) {
    border-right: none;
}

.cost-detail-table-wrap :deep(.cost-detail-table thead th) {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 6px 8px;
    background: var(--light-bg-muted, #f9fafb);
    color: var(--light-text-secondary);
    font-weight: var(--weight-semibold);
    border-bottom: 1px solid var(--light-border-subtle);
    white-space: nowrap;
}

.cost-detail-table-wrap :deep(.cost-detail-table__viz-head) {
    min-width: 7.5rem;
}

.cost-detail-table-wrap :deep(.cost-detail-table tbody td) {
    padding: 6px 8px;
    border-bottom: 1px solid var(--light-border-subtle);
    color: var(--light-text-primary);
    vertical-align: middle;
}

.cost-detail-table-wrap :deep(.cost-detail-table tbody tr:last-child td) {
    border-bottom: none;
}

.cost-detail-table-wrap :deep(.cost-detail-table__row--revenue td),
.cost-detail-table-wrap :deep(.cost-detail-table__row--summary td),
.cost-detail-table-wrap :deep(.cost-detail-table__row--profit td) {
    font-weight: var(--weight-medium);
}

.cost-detail-table-wrap :deep(.cost-detail-table__row--profit-pos .cost-detail-table__num.money-val) {
    color: #27ae60 !important;
}

.cost-detail-table-wrap :deep(.cost-detail-table__row--profit-neg .cost-detail-table__num.money-val) {
    color: #e74c3c !important;
}

.cost-detail-table-wrap :deep(.cost-detail-table tbody tr:nth-child(even):not(.cost-detail-table__row--summary):not(.cost-detail-table__row--profit)) {
    background: rgba(45, 106, 79, 0.03);
}

.cost-detail-table-wrap :deep(.cost-detail-table__name) {
    font-weight: var(--weight-medium);
}

.cost-detail-table-wrap :deep(.cost-detail-dot) {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
    flex-shrink: 0;
}

.cost-detail-table-wrap :deep(.cost-detail-table__num) {
    text-align: right;
    white-space: nowrap;
}

.cost-detail-table-wrap :deep(.cost-detail-table__type) {
    white-space: nowrap;
}

.cost-detail-table-wrap :deep(.cost-type-tag) {
    display: inline-block;
    padding: 2px 7px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.02em;
}

.cost-detail-table-wrap :deep(.cost-type-tag--revenue) {
    background: rgba(45, 106, 79, 0.12);
    color: #1b4332;
}

.cost-detail-table-wrap :deep(.cost-type-tag--cost) {
    background: rgba(231, 76, 60, 0.1);
    color: #c0392b;
}

.cost-detail-table-wrap :deep(.cost-type-tag--summary) {
    background: rgba(27, 67, 50, 0.12);
    color: #1b4332;
}

.cost-detail-table-wrap :deep(.cost-type-tag--profit) {
    background: rgba(39, 174, 96, 0.12);
    color: #1e8449;
}

.cost-detail-table-wrap :deep(.cost-detail-table__row--profit-neg .cost-type-tag--profit) {
    background: rgba(231, 76, 60, 0.12);
    color: #c0392b;
}

.cost-detail-table-wrap :deep(.cost-detail-table__viz) {
    min-width: 6.5rem;
    vertical-align: middle;
}

.cost-detail-table-wrap :deep(.cost-pct-bar) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: stretch;
}

.cost-detail-table-wrap :deep(.cost-pct-bar__track) {
    height: 6px;
    border-radius: var(--radius-full);
    background: rgba(0, 0, 0, 0.06);
    overflow: hidden;
}

.cost-detail-table-wrap :deep(.cost-pct-bar--negative .cost-pct-bar__track) {
    background: rgba(231, 76, 60, 0.12);
}

.cost-detail-table-wrap :deep(.cost-pct-bar__fill) {
    height: 100%;
    border-radius: var(--radius-full);
    min-width: 0;
    max-width: 100%;
    transition: width 0.4s var(--ease-standard, ease-out);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35) inset;
}

.cost-detail-table-wrap :deep(.cost-pct-bar__meta) {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 5px;
    flex-wrap: wrap;
}

.cost-detail-table-wrap :deep(.cost-pct-bar__value) {
    font-weight: var(--weight-bold);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--light-text-primary);
}

.cost-detail-table-wrap :deep(.cost-pct-bar__hint) {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary, #9ca3af);
    font-weight: var(--weight-medium);
}

.cost-detail-table-wrap :deep(.cost-detail-table__note) {
    color: var(--light-text-secondary);
    font-size: var(--text-xs);
    max-width: 10rem;
}

.cost-detail-table-wrap :deep(.cost-note-kpi) {
    display: inline-block;
    min-width: 1.25rem;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: rgba(45, 106, 79, 0.1);
    color: var(--brand-green-700, #1b4332);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
}

.cost-detail-table-wrap :deep(.cost-detail-pct-hint) {
    display: inline-block;
    margin-left: 4px;
    font-size: var(--text-xs);
    color: var(--light-text-tertiary, #9ca3af);
    font-weight: var(--weight-normal);
}

.chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

/* 兼容旧样式 */
.cost-charts-section {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 24px;
}

.chart-panel {
    background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
    border: 2px solid #e5e7eb;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.chart-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
    opacity: 0;
    transition: opacity 0.4s;
}

.chart-panel:hover {
    box-shadow: 0 12px 32px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
    transform: translateY(-4px);
    border-color: var(--primary);
}

.chart-panel:hover::before {
    opacity: 1;
}

.chart-panel.primary {
    --panel-accent: #2D6A4F;
    border-top: 3px solid #2D6A4F;
    background: linear-gradient(135deg, #ffffff 0%, #f8f4fb 100%);
}

.chart-panel.secondary {
    --panel-accent: #e74c3c;
    border-top: 3px solid #e74c3c;
    background: linear-gradient(135deg, #ffffff 0%, #fff5f7 100%);
}

.chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    padding-bottom: 12px;
    border-bottom: 1px solid #f3f4f6;
}

.chart-title {
    font-size: var(--text-base);
    font-weight: 700;
    color: #374151;
    display: flex;
    align-items: center;
    gap: 8px;
}

.chart-title i {
    color: #2D6A4F;
    font-size: var(--text-base);
}

.chart-legend-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: #4b5563;
    padding: 4px 8px;
    background: #f9fafb;
    border-radius: 6px;
    transition: all 0.2s;
}

.legend-item:hover {
    background: #f3f4f6;
    transform: scale(1.05);
}

.legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.8), 0 0 0 3px var(--color, transparent);
}

.legend-label {
    font-weight: 500;
    color: #374151;
}

.legend-value {
    font-weight: 700;
    color: var(--color);
    font-family: monospace;
}

.chart-wrapper {
    height: 280px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}

.chart-center-info {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    z-index: 10;
    pointer-events: none;
    padding: 8px;
    background: rgba(255,255,255,0.95);
    border-radius: 50%;
    width: 120px;
    height: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.1), inset 0 0 0 2px rgba(45, 106, 79, 0.1);
    backdrop-filter: blur(10px);
    animation: fadeIn 0.6s ease-out;
}

.center-total-label {
    font-size: var(--text-xs);
    color: #6b7280;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 6px;
    opacity: 0.9;
}

.center-total-value {
    font-size: var(--text-2xl);
    font-weight: 900;
    color: #2D6A4F;
    font-family: 'Segoe UI', 'Consolas', monospace;
    line-height: 1.1;
    margin-bottom: 4px;
    letter-spacing: -0.5px;
    text-shadow: 0 2px 4px rgba(45, 106, 79, 0.2);
}

.center-profit-margin {
    font-size: var(--text-xs);
    color: #9ca3af;
    font-weight: 700;
    margin-top: 4px;
    padding: 2px 8px;
    background: #f3f4f6;
    border-radius: 12px;
    font-family: monospace;
}

.chart-wrapper canvas {
    position: relative;
    z-index: 1;
}

/* 确保图表容器正确显示 */
.chart-panel.primary .chart-wrapper,
.chart-panel.secondary .chart-wrapper {
    min-height: 280px;
}

/* 图例项增强样式 */
.legend-item {
    transition: all 0.2s;
    cursor: pointer;
}

.legend-item:hover {
    background: #f3f4f6 !important;
    transform: scale(1.05);
}

.legend-item .legend-label {
    font-weight: 600;
}

.legend-item .legend-value {
    font-family: 'Consolas', 'Monaco', monospace;
    font-weight: 700;
}

/* 成本明细清单 · 区域与标题 */
.cost-details-section {
    background: var(--light-bg-elevated);
    border: 1px solid var(--light-border-subtle);
    border-radius: var(--radius-xl);
    padding: var(--space-6) var(--space-8);
    box-shadow: var(--shadow-md);
    border-top: 3px solid var(--brand-green-500);
    position: relative;
    overflow: hidden;
}

.cost-details-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--brand-green-500) 0%, var(--gold-400) 100%);
    opacity: 0.95;
}

.section-header-modern {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-6);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--light-border-subtle);
    position: relative;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.section-header-modern::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 72px;
    height: 2px;
    background: linear-gradient(90deg, var(--brand-green-500) 0%, transparent 100%);
    border-radius: var(--radius-full);
}

.section-title-modern {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--light-text-primary);
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    letter-spacing: -0.02em;
}

.section-title-modern i {
    color: var(--brand-green-600);
    font-size: var(--text-xl);
    opacity: 0.92;
}

.cost-summary-badges {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: flex-end;
    flex: 1;
    min-width: 0;
}

/* 兼容旧样式 */
.cost-detail-section {
    background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
    border: 2px solid #e5e7eb;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04);
    border-top: 5px solid #2D6A4F;
    position: relative;
    overflow: hidden;
}

.cost-detail-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: linear-gradient(90deg, #2D6A4F 0%, #1B4332 100%);
    box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 3px solid #f3f4f6;
    position: relative;
}

.section-header::after {
    content: '';
    position: absolute;
    bottom: -3px;
    left: 0;
    width: 80px;
    height: 3px;
    background: linear-gradient(90deg, #2D6A4F 0%, transparent 100%);
}

.section-title {
    font-size: var(--text-lg);
    font-weight: 800;
    color: #1f2937;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    letter-spacing: 0.5px;
}

.section-title i {
    color: #2D6A4F;
    font-size: var(--text-xl);
    opacity: 0.9;
}

.cost-summary-stats {
    display: flex;
    gap: 12px;
}

.stat-badge {
    padding: var(--space-2) var(--space-4);
    background: var(--light-bg-elevated);
    border: 1px solid var(--light-border-subtle);
    border-radius: var(--radius-lg);
    font-size: var(--text-xs);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    transition:
        border-color var(--duration-normal) var(--ease-standard),
        box-shadow var(--duration-normal) var(--ease-standard),
        background-color var(--duration-normal) var(--ease-standard);
    box-shadow: var(--shadow-sm);
    cursor: default;
    position: relative;
    flex-wrap: wrap;
    row-gap: 2px;
}

.stat-badge::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(45, 106, 79, 0.04) 0%, transparent 100%);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-standard);
    pointer-events: none;
    border-radius: inherit;
}

.stat-badge:hover {
    transform: none;
    box-shadow: var(--shadow-md);
    border-color: var(--brand-green-300);
    background: var(--brand-green-50);
}

.stat-badge:hover::before {
    opacity: 1;
}

.stat-badge:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), var(--shadow-sm);
}

.stat-badge.highlight {
    background: var(--semantic-warning-bg);
    border-color: rgba(196, 165, 90, 0.45);
    box-shadow: var(--shadow-sm);
}

.stat-badge.highlight:hover {
    border-color: var(--gold-500);
    background: var(--gold-50);
    box-shadow: var(--shadow-md);
}

.stat-badge-label {
    color: var(--light-text-secondary);
    font-weight: var(--weight-medium);
    letter-spacing: 0.02em;
}

.stat-badge-value {
    color: var(--light-text-primary);
    font-weight: var(--weight-semibold);
    font-family: var(--font-mono), 'SF Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    font-size: var(--text-sm);
}

.cost-detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
}

.cost-grid-item {
    background: var(--light-bg-elevated);
    border: 1px solid var(--light-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    transition:
        border-color var(--duration-normal) var(--ease-standard),
        box-shadow var(--duration-normal) var(--ease-standard),
        transform var(--duration-fast) var(--ease-out-soft);
    position: relative;
    overflow: hidden;
    cursor: default;
    box-shadow: var(--shadow-sm);
    outline: none;
}

.cost-grid-item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: linear-gradient(180deg, var(--item-color, var(--brand-green-500)) 0%, color-mix(in srgb, var(--item-color, var(--brand-green-700)) 75%, #1a1815) 100%);
    transition: width var(--duration-normal) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.cost-grid-item::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(45, 106, 79, 0.04) 0%, transparent 55%);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-standard);
    pointer-events: none;
}

.cost-grid-item:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: color-mix(in srgb, var(--item-color, var(--brand-green-500)) 35%, var(--light-border-default));
    background: var(--light-bg-elevated);
}

.cost-grid-item:hover::before {
    width: 5px;
}

.cost-grid-item:hover::after {
    opacity: 1;
}

.cost-grid-item:focus-visible {
    box-shadow: var(--focus-ring), var(--shadow-md);
    border-color: var(--brand-green-400);
}

.cost-grid-item:active {
    transform: translateY(0);
}

.cost-grid-item.revenue {
    background: linear-gradient(135deg, var(--brand-green-50) 0%, var(--light-bg-elevated) 100%);
    border-color: rgba(45, 106, 79, 0.28);
}

.cost-grid-item.revenue::before {
    background: linear-gradient(180deg, var(--brand-green-500) 0%, var(--brand-green-700) 100%);
}

.cost-grid-item.profit-positive {
    background: linear-gradient(135deg, var(--semantic-success-bg) 0%, var(--light-bg-elevated) 100%);
    border-color: rgba(82, 183, 136, 0.45);
}

.cost-grid-item.profit-positive::before {
    background: linear-gradient(180deg, var(--semantic-success-icon) 0%, var(--brand-green-700) 100%);
}

.cost-grid-item.profit-negative {
    background: linear-gradient(135deg, var(--semantic-error-bg) 0%, var(--light-bg-elevated) 100%);
    border-color: rgba(208, 84, 80, 0.35);
}

.cost-grid-item.profit-negative::before {
    background: linear-gradient(180deg, var(--semantic-error-icon) 0%, #a53d39 100%);
}

.cost-item-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
}

.cost-item-icon-wrapper {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid;
    flex-shrink: 0;
    box-shadow: var(--shadow-sm);
    transition:
        box-shadow var(--duration-normal) var(--ease-standard),
        transform var(--duration-fast) var(--ease-out-soft);
    position: relative;
    overflow: hidden;
}

.cost-item-icon-wrapper::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.4s;
}

.cost-grid-item:hover .cost-item-icon-wrapper {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
}

.cost-grid-item:hover .cost-item-icon-wrapper::before {
    opacity: 1;
}

.cost-item-icon-wrapper i {
    font-size: var(--text-xl);
    position: relative;
    z-index: 1;
}

.cost-item-title {
    flex: 1;
    min-width: 0;
}

.cost-item-name {
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--light-text-primary);
    margin-bottom: var(--space-1);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
}

.cost-item-type {
    font-size: var(--text-xs);
    color: var(--light-text-secondary);
    text-transform: none;
    letter-spacing: 0.04em;
    font-weight: var(--weight-medium);
    background: var(--light-bg-secondary);
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    display: inline-block;
    border: 1px solid var(--light-border-subtle);
}

.cost-item-body {
    padding-left: min(62px, 15vw);
}

.cost-item-value-wrapper {
    margin-bottom: 8px;
}

.cost-item-amount {
    font-size: clamp(var(--text-lg), 2.2vw, var(--text-2xl));
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    margin-bottom: var(--space-3);
    font-family: var(--font-mono), 'SF Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    user-select: text;
}

.cost-item-percent-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
}

.cost-item-percent-bar {
    flex: 1;
    height: 8px;
    background: var(--light-bg-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
    position: relative;
    box-shadow: inset 0 1px 2px rgba(26, 24, 21, 0.06);
    border: 1px solid var(--light-border-subtle);
}

.cost-item-percent-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.4);
    position: relative;
    overflow: hidden;
    background: linear-gradient(90deg, currentColor 0%, color-mix(in srgb, currentColor 90%, white) 100%);
}

.cost-item-percent-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
    animation: finance-cost-shimmer 2.2s ease-in-out infinite;
}

@keyframes finance-cost-shimmer {
    0% {
        left: -100%;
    }
    100% {
        left: 100%;
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

@media (prefers-reduced-motion: reduce) {
    .cost-item-percent-fill::after {
        animation: none;
    }

    .cost-grid-item:hover {
        transform: none;
    }
}

.cost-item-percent-text {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--light-text-secondary);
    font-family: var(--font-mono), ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    min-width: 3.25rem;
    text-align: right;
    letter-spacing: -0.02em;
    padding: 2px var(--space-2);
    background: var(--light-bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--light-border-subtle);
}

.cost-item-extra {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--light-border-subtle);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.cost-item-daily {
    font-size: var(--text-xs);
    color: var(--light-text-secondary);
    font-weight: var(--weight-medium);
}

.cost-item-note {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
    font-style: normal;
    margin-top: var(--space-1);
}

/* 成本明细 · 空状态 */
.empty-state-modern {
    padding: var(--space-12) var(--space-5);
    text-align: center;
    color: var(--light-text-tertiary);
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    min-height: 220px;
    justify-content: center;
    grid-column: 1 / -1;
    border: 1px dashed var(--light-border-default);
    border-radius: var(--radius-lg);
    background: var(--light-bg-secondary);
}

.empty-state-modern i {
    font-size: var(--text-4xl);
    color: var(--light-border-strong);
    margin-bottom: var(--space-1);
    opacity: 0.75;
}

.empty-state-modern p {
    margin: 0;
    font-weight: var(--weight-medium);
    color: var(--light-text-secondary);
    letter-spacing: 0.02em;
    max-width: 20rem;
    line-height: var(--leading-normal);
}

/* 成本明细网格 */
.cost-details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: var(--space-4);
    align-items: stretch;
}

@media (min-width: 1200px) {
    .cost-details-grid {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-5);
    }
}

/* 兼容旧样式 */
.empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--light-text-tertiary);
    font-size: var(--text-base);
    grid-column: 1 / -1;
}

/* 自定义滚动条样式 */
.cost-list-compact::-webkit-scrollbar,
.cost-detail-grid::-webkit-scrollbar,
.cost-details-grid::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

.cost-list-compact::-webkit-scrollbar-track,
.cost-detail-grid::-webkit-scrollbar-track,
.cost-details-grid::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
}

.cost-list-compact::-webkit-scrollbar-thumb,
.cost-detail-grid::-webkit-scrollbar-thumb,
.cost-details-grid::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
    transition: background 0.3s;
}

.cost-list-compact::-webkit-scrollbar-thumb:hover,
.cost-detail-grid::-webkit-scrollbar-thumb:hover,
.cost-details-grid::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
}

/* 图表容器优化 */
.chart-wrapper {
    position: relative;
    padding: 10px;
}

.chart-legend-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;
    max-width: 100%;
}

/* 加载动画 - 已用于进度条 */
.loading-shimmer {
    background: linear-gradient(
        90deg,
        #f0f0f0 25%,
        #e0e0e0 50%,
        #f0f0f0 75%
    );
    background-size: 1000px 100%;
    animation: shimmer 2s infinite;
}

/* 增强过渡效果 */
.cost-grid-item,
.overview-card,
.chart-panel,
.comparison-card-compact,
.warning-item-compact {
    will-change: transform, box-shadow;
}

/* 打印样式优化 */
@media print {
    .cost-analysis-layout {
        break-inside: avoid;
    }
    .cost-grid-item {
        break-inside: avoid;
        page-break-inside: avoid;
    }
}

/* 成本明细项 - 紧凑版 */
.cost-detail-item-compact {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: #fff;
    border-radius: 6px;
    border-left: 3px solid;
    transition: all 0.2s;
    cursor: pointer;
}

.cost-detail-item-compact:hover {
    transform: translateX(3px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    background: #f8f9fa;
}

.cost-item-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
}

.cost-item-left i {
    font-size: var(--text-base);
    width: 18px;
    text-align: center;
}

.cost-item-info {
    flex: 1;
}

.cost-item-name {
    font-weight: 600;
    color: #333;
    font-size: var(--text-base);
    margin-bottom: 2px;
}

.cost-item-percent {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
}

.cost-item-right {
    text-align: right;
}

.cost-item-value {
    font-size: var(--text-base);
    font-weight: 700;
}

/* 同比环比容器 - 新样式 */
.comparison-container,
.warning-container {
    padding: 28px;
    animation: fadeIn 0.4s ease-in;
    background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
    border-radius: 16px;
    min-height: 400px;
}

.comparison-tab .comparison-container,
.warning-tab .warning-container {
    background: transparent;
    padding: 0;
}

/* 同比环比布局 - 新样式 */
.comparison-layout {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.comparison-metrics-section {
    margin-bottom: 8px;
}

.comparison-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
}

.comparison-metric-card {
    background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
    border: 2px solid #e5e7eb;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.comparison-metric-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--metric-accent, var(--primary));
    opacity: 0;
    transition: opacity 0.4s;
}

.comparison-metric-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
    border-color: var(--metric-accent, var(--primary));
}

.comparison-metric-card:hover::before {
    opacity: 1;
}

.revenue-metric { --metric-accent: #2D6A4F; }
.profit-metric { --metric-accent: #27ae60; }

.metric-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

.metric-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--metric-accent, var(--primary)) 0%, var(--metric-accent, var(--primary))dd 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: var(--text-lg);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.metric-title {
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-main);
    letter-spacing: 0.3px;
}

.metric-value {
    font-size: var(--text-3xl);
    font-weight: 900;
    color: var(--text-main);
    margin-bottom: 16px;
    font-family: 'Segoe UI', -apple-system, 'SF Pro Display', monospace;
    line-height: 1.1;
    letter-spacing: -0.5px;
}

.metric-trends {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.trend-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: var(--text-sm);
    font-weight: 600;
    transition: all 0.3s;
}

.trend-badge.positive {
    background: linear-gradient(135deg, rgba(39, 174, 96, 0.1) 0%, rgba(39, 174, 96, 0.05) 100%);
    color: #27ae60;
    border: 1px solid rgba(39, 174, 96, 0.2);
}

.trend-badge.negative {
    background: linear-gradient(135deg, rgba(231, 76, 60, 0.1) 0%, rgba(231, 76, 60, 0.05) 100%);
    color: #e74c3c;
    border: 1px solid rgba(231, 76, 60, 0.2);
}

.trend-badge i {
    font-size: var(--text-xs);
}

.comparison-charts-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
}

.comparison-details-section {
    background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
    border: 2px solid #e5e7eb;
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04);
    border-top: 4px solid var(--primary);
    position: relative;
    overflow: hidden;
}

.comparison-details-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
    box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
}

.comparison-details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px;
}

.comparison-detail-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    transition: all 0.3s;
}

.comparison-detail-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    border-color: var(--primary);
    background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
}

.detail-item-header {
    display: flex;
    align-items: center;
    gap: 10px;
}

.detail-item-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--primary)15 0%, var(--primary)05 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    font-size: var(--text-base);
}

.detail-item-label {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-main);
}

.detail-item-value {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-main);
    font-family: 'Segoe UI', -apple-system, 'SF Pro Display', monospace;
}

@media (max-width: 768px) {
    .comparison-metrics-grid {
        grid-template-columns: 1fr;
    }
    
    .comparison-charts-section {
        grid-template-columns: 1fr;
    }
    
    .comparison-details-grid {
        grid-template-columns: 1fr;
    }
}

/* 兼容旧样式 */
.comparison-enhanced {
    padding: 24px;
    animation: fadeIn 0.4s ease-in;
    background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
    border-radius: 16px;
    min-height: 400px;
}

.comparison-grid-compact {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
    animation: fadeIn 0.4s ease-in;
}

.comparison-card-compact {
    padding: 28px 24px;
    border-radius: 16px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(10px);
}

.comparison-card-compact::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: linear-gradient(90deg, transparent, var(--gradient-color, rgba(255,255,255,0.6)), transparent);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.comparison-card-compact::after {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.4s;
}

.comparison-card-compact:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 12px 40px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.1);
}

.comparison-card-compact:hover::after {
    opacity: 1;
}

.comparison-revenue {
    background: linear-gradient(135deg, #2D6A4F 0%, #1B4332 100%);
    color: #fff;
    --gradient-color: rgba(255,255,255,0.4);
    box-shadow: 0 6px 24px rgba(45, 106, 79, 0.3), 0 2px 8px rgba(45, 106, 79, 0.2);
}

.comparison-revenue:hover {
    box-shadow: 0 16px 48px rgba(45, 106, 79, 0.4), 0 6px 20px rgba(45, 106, 79, 0.3);
}

.comparison-profit {
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    color: #fff;
    --gradient-color: rgba(255,255,255,0.4);
    box-shadow: 0 6px 24px rgba(240, 147, 251, 0.3), 0 2px 8px rgba(245, 87, 108, 0.2);
}

.comparison-profit:hover {
    box-shadow: 0 16px 48px rgba(240, 147, 251, 0.4), 0 6px 20px rgba(245, 87, 108, 0.3);
}

.comparison-detail {
    background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
    border: 2px solid #e5e7eb;
    border-top: 5px solid #2D6A4F;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03);
}

.comparison-detail:hover {
    border-color: #d1d5db;
    box-shadow: 0 12px 40px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.05);
}

.comparison-label {
    font-size: var(--text-base);
    opacity: 0.95;
    margin-bottom: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 8px;
}

.comparison-label i {
    font-size: var(--text-base);
    opacity: 0.9;
}

.comparison-value {
    font-size: 2.25rem;
    font-weight: 900;
    margin-bottom: 16px;
    font-family: 'Segoe UI', -apple-system, 'SF Pro Display', monospace;
    line-height: 1.1;
    text-shadow: 0 3px 8px rgba(0,0,0,0.15);
    letter-spacing: -0.5px;
}

.comparison-detail .comparison-value {
    color: #1f2937;
    text-shadow: none;
    font-size: clamp(var(--text-2xl), 3vw, 1.75rem);
}

.comparison-trends {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-base);
    gap: 16px;
    padding-top: 16px;
    border-top: 1.5px solid rgba(255,255,255,0.25);
    margin-top: 8px;
}

.comparison-detail .comparison-trends {
    border-top-color: #e5e7eb;
    border-top-width: 2px;
}

.trend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    flex: 1;
    padding: 8px 12px;
    background: rgba(255,255,255,0.1);
    border-radius: 8px;
    transition: all 0.3s;
}

.comparison-detail .trend-item {
    background: #f9fafb;
    justify-content: space-between;
}

.trend-item:hover {
    background: rgba(255,255,255,0.2);
    transform: translateX(2px);
}

.comparison-detail .trend-item:hover {
    background: #f3f4f6;
}

.trend-item i {
    font-size: var(--text-base);
    opacity: 0.9;
}

.trend-item span:not(.trend-value) {
    font-weight: 500;
    opacity: 0.9;
}

.trend-value {
    font-weight: 800;
    font-size: var(--text-base);
    padding: 4px 10px;
    border-radius: 6px;
    font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
    letter-spacing: 0.3px;
    white-space: nowrap;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.trend-value.positive {
    color: #059669;
    background: linear-gradient(135deg, rgba(5, 150, 105, 0.15) 0%, rgba(16, 185, 129, 0.2) 100%);
    border: 1px solid rgba(5, 150, 105, 0.2);
}

.trend-value.negative {
    color: #dc2626;
    background: linear-gradient(135deg, rgba(220, 38, 38, 0.15) 0%, rgba(239, 68, 68, 0.2) 100%);
    border: 1px solid rgba(220, 38, 38, 0.2);
}

.comparison-detail-title {
    font-size: var(--text-base);
    color: #374151;
    margin-bottom: 20px;
    font-weight: 800;
    padding-bottom: 14px;
    border-bottom: 3px solid #e5e7eb;
    display: flex;
    align-items: center;
    gap: 10px;
    letter-spacing: 0.5px;
}

.comparison-detail-title i {
    color: #2D6A4F;
    font-size: var(--text-lg);
}

.comparison-detail-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
    border-radius: 12px;
    border: 1.5px solid #e5e7eb;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.detail-row::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: linear-gradient(180deg, #2D6A4F 0%, #1B4332 100%);
    opacity: 0;
    transition: opacity 0.3s;
}

.detail-row:hover {
    background: linear-gradient(135deg, #f8f9fa 0%, #f3f4f6 100%);
    border-color: #d1d5db;
    transform: translateX(6px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.detail-row:hover::before {
    opacity: 1;
}

.detail-row:last-child {
    margin-bottom: 0;
}

.detail-label-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
}

.detail-label-wrapper i {
    color: #2D6A4F;
    font-size: var(--text-base);
    width: 20px;
    text-align: center;
    opacity: 0.8;
}

.detail-label {
    color: #4b5563;
    font-size: var(--text-base);
    font-weight: 600;
    letter-spacing: 0.3px;
}

.detail-value {
    font-weight: 800;
    font-size: var(--text-base);
    color: #1f2937;
    font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
    letter-spacing: 0.5px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    min-width: 120px;
    text-align: right;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

/* 财务预警 - 增强版 */
.warning-enhanced {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    animation: fadeIn 0.4s ease-in;
    background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
    border-radius: 16px;
    min-height: 300px;
}

.warning-item-compact {
    padding: 24px 22px;
    border-radius: 16px;
    border-left: 6px solid;
    border: 2px solid;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    backdrop-filter: blur(10px);
}

.warning-item-compact::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 6px;
    height: 100%;
    background: linear-gradient(180deg, var(--warning-accent) 0%, var(--warning-accent-secondary, var(--warning-accent)) 100%);
    transition: all 0.4s;
    box-shadow: 0 0 12px rgba(0,0,0,0.15);
}

.warning-item-compact::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.4s;
    pointer-events: none;
}

.warning-item-compact:hover {
    transform: translateX(8px) translateY(-4px) scale(1.01);
    box-shadow: 0 12px 32px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.1);
}

.warning-item-compact:hover::before {
    width: 8px;
    box-shadow: 0 0 16px var(--warning-accent);
}

.warning-item-compact:hover::after {
    opacity: 1;
}

.warning-high {
    --warning-accent: #dc2626;
    --warning-accent-secondary: #ef4444;
    border-left-color: #dc2626;
    border-color: #fecaca;
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    box-shadow: 0 4px 16px rgba(220, 38, 38, 0.15), 0 2px 6px rgba(220, 38, 38, 0.08);
}

.warning-high:hover {
    box-shadow: 0 12px 32px rgba(220, 38, 38, 0.25), 0 4px 12px rgba(220, 38, 38, 0.15);
}

.warning-medium {
    --warning-accent: #f59e0b;
    --warning-accent-secondary: #fbbf24;
    border-left-color: #f59e0b;
    border-color: #fde68a;
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    box-shadow: 0 4px 16px rgba(245, 158, 11, 0.15), 0 2px 6px rgba(245, 158, 11, 0.08);
}

.warning-medium:hover {
    box-shadow: 0 12px 32px rgba(245, 158, 11, 0.25), 0 4px 12px rgba(245, 158, 11, 0.15);
}

.warning-low {
    --warning-accent: #059669;
    --warning-accent-secondary: #10b981;
    border-left-color: #059669;
    border-color: #bbf7d0;
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    box-shadow: 0 4px 16px rgba(5, 150, 105, 0.15), 0 2px 6px rgba(5, 150, 105, 0.08);
}

.warning-low:hover {
    box-shadow: 0 12px 32px rgba(5, 150, 105, 0.25), 0 4px 12px rgba(5, 150, 105, 0.15);
}

.warning-title {
    font-weight: 900;
    font-size: var(--text-lg);
    color: #1f2937;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    line-height: 1.4;
    letter-spacing: 0.3px;
    position: relative;
    z-index: 1;
}

.warning-title i {
    font-size: var(--text-xl);
    opacity: 0.9;
}

.warning-message {
    color: #374151;
    margin-bottom: 14px;
    line-height: 1.8;
    font-size: var(--text-base);
    font-weight: 600;
    position: relative;
    z-index: 1;
    padding: 10px 12px;
    background: rgba(255,255,255,0.5);
    border-radius: 10px;
    border: 1px solid rgba(0,0,0,0.05);
}

.warning-suggestion {
    font-size: var(--text-base);
    color: #4b5563;
    padding: 14px 16px;
    background: linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%);
    border-radius: 12px;
    border-left: 4px solid var(--warning-accent);
    margin-top: 12px;
    font-weight: 600;
    line-height: 1.7;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    position: relative;
    z-index: 1;
    backdrop-filter: blur(5px);
}

.warning-suggestion i {
    margin-right: 8px;
    color: var(--warning-accent);
    font-size: var(--text-base);
    font-weight: 700;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* 现金流分析标签页样式 */
.cashflow-tabs {
    margin-top: 20px;
}

.cashflow-tabs .tab-buttons {
    display: flex;
    gap: 10px;
    border-bottom: 2px solid #eee;
    margin-bottom: 20px;
}

.cashflow-tabs .tab-btn {
    padding: 12px 24px;
    border: none;
    background: transparent;
    color: var(--light-text-secondary);
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: 600;
    border-bottom: 3px solid transparent;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.cashflow-tabs .tab-btn:hover {
    color: var(--primary);
    background: #fafafa;
}

.cashflow-tabs .tab-btn.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
    background: #fff;
}

.cashflow-tabs .tab-content {
    min-height: 400px;
}

/* 预测和健康度卡片样式 */
.forecast-summary, .score-breakdown {
    animation: fadeIn 0.3s ease-in;
}

.score-item {
    transition: all 0.2s;
}

.score-item:hover {
    transform: translateX(5px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* 报告样式 */
.report-content {
    line-height: 1.8;
}

.report-content h3 {
    font-size: var(--text-lg);
}

.report-content ul {
    margin: 10px 0;
}

.report-content li {
    margin: 8px 0;
}

@media (max-width: 768px) { 
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } 
    .grid-2-compact { grid-template-columns: 1fr; }
    .calendar-grid { gap: 4px; }
    .trend-chart-container {
        height: 280px;
        padding: 5px;
    }
    .tab-buttons {
        gap: 5px;
        margin-bottom: 12px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 5px;
    }
    .tab-btn {
        padding: 6px 12px;
        font-size: var(--text-sm);
        white-space: nowrap;
    }
    .cost-overview-cards {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
    }
    .overview-card {
        padding: 12px;
        flex-direction: column;
        text-align: center;
    }
    .overview-icon {
        width: 40px;
        height: 40px;
        font-size: var(--text-lg);
        margin: 0 auto 8px;
    }
    .overview-content {
        width: 100%;
    }
    .overview-value {
        font-size: var(--text-xl);
    }
    .cost-charts-section {
        grid-template-columns: 1fr;
        gap: 15px;
    }
    .chart-panel {
        padding: 14px;
    }
    .chart-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 12px;
        padding-bottom: 10px;
    }
    .chart-legend-inline {
        width: 100%;
        justify-content: flex-start;
        gap: 8px;
    }
    .legend-item {
        font-size: var(--text-xs);
        padding: 3px 6px;
    }
    .chart-wrapper {
        height: 220px;
    }
    .chart-center-info {
        transform: translate(-50%, -55%);
    }
    .center-total-value {
        font-size: var(--text-lg);
    }
    .center-profit-margin {
        font-size: var(--text-xs);
    }
    .cost-detail-section {
        padding: 14px;
    }
    .section-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
    }
    .cost-summary-stats {
        width: 100%;
        flex-wrap: wrap;
        gap: 8px;
    }
    .stat-badge {
        flex: 1;
        min-width: calc(50% - 4px);
    }
    .charts-section--uniform {
        --cost-chart-h: 180px;
    }
    .cost-detail-table-wrap :deep(.cost-detail-table-scroll) {
        max-height: 200px;
    }
    .cost-detail-table-wrap :deep(.cost-detail-table__note) {
        max-width: 6rem;
    }
    .cost-summary-badges :deep(.cost-summary-panel) {
        align-items: stretch;
        width: 100%;
    }
    .cost-summary-badges :deep(.cost-summary-inline) {
        justify-content: flex-start;
        width: 100%;
    }
    .cost-summary-badges :deep(.cost-summary-bar) {
        width: 100%;
    }
    .cost-detail-grid {
        grid-template-columns: 1fr;
        gap: 10px;
    }
    .cost-item-body {
        padding-left: 52px;
    }
    .comparison-enhanced {
        padding: 16px;
        min-height: 300px;
    }
    .comparison-grid-compact {
        grid-template-columns: 1fr;
        gap: 16px;
    }
    .comparison-card-compact {
        padding: 20px 18px;
    }
    .comparison-value {
        font-size: clamp(var(--text-2xl), 3vw, 1.75rem);
    }
    .comparison-label {
        font-size: var(--text-sm);
        margin-bottom: 10px;
    }
    .comparison-trends {
        flex-direction: column;
        gap: 10px;
        padding-top: 12px;
    }
    .trend-item {
        justify-content: space-between;
        padding: 6px 10px;
    }
    .trend-value {
        font-size: var(--text-base);
        padding: 3px 8px;
    }
    .comparison-detail-title {
        font-size: var(--text-base);
        margin-bottom: 16px;
        padding-bottom: 12px;
    }
    .detail-row {
        padding: 12px 14px;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }
    .detail-value {
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        font-size: var(--text-base);
    }
    .tab-content-enhanced {
        padding: 16px;
    }
    .warning-item-compact {
        padding: 12px 15px;
        margin-bottom: 8px;
    }
}

/* ---------- 财务核算 · VI 交互与数字呈现（覆盖层）---------- */
.money-val,
.stat-val,
.quick-stat-val,
.center-total-value {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
}

.finance-stat-team {
    border-left-color: var(--gold-500) !important;
}

.finance-stat-team-sub {
    color: var(--gold-700) !important;
}

.quick-stat {
    border-radius: var(--radius-lg);
    background: var(--light-bg-elevated);
    border: 1px solid var(--light-border-subtle);
    transition: box-shadow var(--duration-normal) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.quick-stat:hover {
    box-shadow: var(--shadow-sm);
    border-color: var(--light-border-default);
}

.quick-stat.today {
    border-left-color: var(--brand-green-500);
    background: linear-gradient(135deg, var(--brand-green-50) 0%, var(--light-bg-elevated) 100%);
}
.quick-stat.week {
    border-left-color: var(--cat-marine-mid);
    background: linear-gradient(135deg, var(--cat-marine-light) 0%, var(--light-bg-elevated) 100%);
}
.quick-stat.month {
    border-left-color: var(--semantic-success-icon);
    background: linear-gradient(135deg, var(--semantic-success-bg) 0%, var(--light-bg-elevated) 100%);
}

.quick-stat-label {
    font-size: var(--text-xs);
    color: var(--light-text-tertiary);
}

.quick-stat-val {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--light-text-primary);
}

.quick-stat-sub {
    font-size: var(--text-xs);
    color: var(--light-text-secondary);
}

.stat-val {
    font-family: var(--font-cn-body), 'Segoe UI', system-ui, sans-serif;
}

.trend-chart-container {
    min-height: 240px;
    border-radius: var(--radius-md);
    background: var(--light-bg-secondary);
    border: 1px solid var(--light-border-subtle);
}

.tab-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

:deep(.finance-ai-dialog .el-dialog__header) {
    border-bottom: 1px solid var(--light-border-subtle);
}

:deep(.finance-ai-dialog .el-dialog__title) {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--light-text-primary);
}

@media (prefers-reduced-motion: reduce) {
    .card:hover,
    .tab-btn:hover,
    .tab-btn.active,
    .stat-box:hover {
        transform: none;
    }
}
</style>