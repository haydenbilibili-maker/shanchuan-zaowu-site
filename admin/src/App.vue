<template>
  <div class="app-root">
    <transition name="fade">
      <div v-if="!isLoggedIn" class="login-mask">
        <div class="login-card">
          <div class="logo-area">
            <div class="logo-circle">山</div>
            <h2>山海造物 · 数智化中台</h2>
            <p class="logo-sub">NATURE'S CREATIONS ADMIN</p>
          </div>

          <div class="input-wrapper">
            <el-input
              v-model="password"
              type="password"
              placeholder="请输入最高管理权限口令"
              show-password
              @keyup.enter="handleLogin"
              class="login-input"
            >
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </div>

          <el-button
            type="primary"
            class="login-btn"
            @click="handleLogin"
            :loading="loggingIn"
            size="large"
          >
            解锁指挥中心
          </el-button>

          <div class="login-footer">
            <p>🔒 内部系统 · 数据加密传输中</p>
            <p>v12.6.0 Enterprise Build · AI Enhanced</p>
          </div>
        </div>
      </div>
    </transition>

    <div v-if="isLoggedIn" class="admin-container">
      <!-- 📱 移动端顶部导航栏（始终可见） -->
      <div v-if="isMobile" class="mobile-top-nav">
        <div class="brand-section">
          <div class="brand-logo">山</div>
          <div class="brand-text">
            <div class="cn">山海造物</div>
            <div class="brand-sub">管理后台</div>
          </div>
        </div>
        <button 
          class="mobile-menu-toggle" 
          @click="mobileMenuVisible = !mobileMenuVisible"
          :class="{ active: mobileMenuVisible }"
        >
          <el-icon><Menu /></el-icon>
        </button>
      </div>

      <!-- 📋 菜单遮罩层 -->
      <div 
        v-if="isMobile"
        class="mobile-menu-overlay"
        :class="{ active: mobileMenuVisible }"
        @click="mobileMenuVisible = false"
      ></div>
      
      <el-container>
        
        <el-aside
          :width="isMobile ? '0px' : (sidebarCollapsed ? '64px' : '256px')"
          class="aside"
          :class="{ 'mobile-menu-open': isMobile ? mobileMenuVisible : true, 'is-collapsed': sidebarCollapsed && !isMobile }"
          ref="sidebarRef"
        >
          <!-- 桌面端品牌头部 -->
          <div v-if="!isMobile" class="brand-header">
            <div class="brand-logo">山</div>
            <div class="brand-text" v-show="!sidebarCollapsed">
              <div class="cn">山海造物</div>
              <div class="brand-sub">管理后台</div>
            </div>
            <el-button class="collapse-btn" link @click="toggleSidebar" :title="sidebarCollapsed ? '展开侧栏 ⌘B' : '收起侧栏 ⌘B'">
              <el-icon><component :is="sidebarCollapsed ? Expand : Fold" /></el-icon>
            </el-button>
          </div>
          
          <!-- 移动端抽屉菜单头部 -->
          <div v-if="isMobile" class="brand-header mobile-drawer-header">
            <div class="brand-logo">山</div>
            <div class="brand-text">
              <div class="cn">山海造物</div>
              <div class="brand-sub">管理后台</div>
            </div>
            <button type="button" class="mobile-sidebar-close" aria-label="关闭菜单" @click="mobileMenuVisible = false">
              <el-icon><Close /></el-icon>
            </button>
          </div>

          <!-- 🟢 快捷搜索栏（折叠时变成按钮） -->
          <div class="sidebar-search" :class="{ collapsed: sidebarCollapsed }" @click="openCommandPalette">
            <el-tooltip v-if="sidebarCollapsed" content="搜索模块 ⌘K" placement="right">
              <el-icon><Search /></el-icon>
            </el-tooltip>
            <template v-else>
              <el-icon><Search /></el-icon>
              <span>搜索模块...</span>
              <kbd v-if="!isMobile" class="kbd-hint">⌘K</kbd>
            </template>
          </div>

          <!-- 🟢 置顶收藏夹（折叠时隐藏） -->
          <div v-if="pinnedModules.length && (!sidebarCollapsed || isMobile)" class="pinned-section">
            <div class="pinned-title">⭐ 置顶</div>
            <div
              v-for="m in pinnedModules"
              :key="m.id"
              class="pinned-item"
              :class="{ active: currentTab === m.id }"
              @click="handleMenuSelect(m.id)"
            >
              <span class="pin-name">{{ m.name }}</span>
              <el-icon class="pin-remove" @click.stop="togglePin(m.id)"><Close /></el-icon>
            </div>
          </div>

          <el-menu
            :collapse="sidebarCollapsed && !isMobile"
            ref="sideMenuRef"
            :default-active="currentTab"
            :default-openeds="defaultOpeneds"
            active-text-color="#ffffff"
            background-color="transparent"
            text-color="rgba(245, 242, 236, 0.72)"
            class="el-menu-vertical"
            @select="handleMenuSelect"
            @open="handleSubMenuOpen"
            @close="handleSubMenuClose">

            <!-- ============ 1. 总览决策 ============ -->
            <el-menu-item-group title="总览决策">
                <el-menu-item index="0"><el-icon><Odometer /></el-icon><span>经营驾驶舱</span></el-menu-item>
                <el-menu-item index="26"><el-icon><Monitor /></el-icon><span>实时监控大屏 · 告警</span></el-menu-item>
                <el-menu-item index="49"><el-icon><DataBoard /></el-icon><span>经营数据大屏 · 看板</span></el-menu-item>
                <el-menu-item index="25"><el-icon><Trophy /></el-icon><span>运营决策中心</span></el-menu-item>
            </el-menu-item-group>

            <!-- ============ 2. 业务运营 ============ -->
            <el-sub-menu index="grp-business">
              <template #title>
                <el-icon><Shop /></el-icon>
                <span>业务运营</span>
              </template>
              <el-menu-item-group title="货 · 资产">
                <el-menu-item index="1"><el-icon><Box /></el-icon><span>藏品档案库</span></el-menu-item>
                <el-menu-item index="43"><el-icon><Menu /></el-icon><span>分类管理</span></el-menu-item>
                <el-menu-item index="3"><el-icon><List /></el-icon><span>全渠道订单</span></el-menu-item>
                <el-menu-item index="52"><el-icon><ShoppingCart /></el-icon><span>订货履约</span></el-menu-item>
                <el-menu-item index="57"><el-icon><Ticket /></el-icon><span>报价单配置</span></el-menu-item>
                <el-menu-item index="42"><el-icon><Refresh /></el-icon><span>退款审核</span></el-menu-item>
                <el-menu-item index="60"><el-icon><Connection /></el-icon><span>订单绑定审核</span></el-menu-item>
                <el-menu-item index="61"><el-icon><Van /></el-icon><span>运费与包邮规则</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="场 · 体验">
                <el-menu-item index="37"><el-icon><Stamp /></el-icon><span>预约与核销</span></el-menu-item>
                <el-menu-item index="5"><el-icon><Calendar /></el-icon><span>活动与排期</span></el-menu-item>
                <el-menu-item index="6"><el-icon><Ticket /></el-icon><span>权益与营销</span></el-menu-item>
                <el-menu-item index="30"><el-icon><Shop /></el-icon><span>店铺管理</span></el-menu-item>
                <el-menu-item index="55"><el-icon><Shop /></el-icon><span>C端门店展区</span></el-menu-item>
                <el-menu-item index="34"><el-icon><Brush /></el-icon><span>门店设计中心</span></el-menu-item>
                <el-menu-item index="35"><el-icon><Promotion /></el-icon><span>加盟商管理</span></el-menu-item>
                <el-menu-item index="48"><el-icon><House /></el-icon><span>物业合作测算</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="定制工坊">
                <el-menu-item index="38"><el-icon><Brush /></el-icon><span>标本定制工单</span></el-menu-item>
                <el-menu-item index="39"><el-icon><Avatar /></el-icon><span>伴宠记忆订单</span></el-menu-item>
              </el-menu-item-group>
            </el-sub-menu>

            <!-- ============ 3. 客户经营 ============ -->
            <el-sub-menu index="grp-customer">
              <template #title>
                <el-icon><UserFilled /></el-icon>
                <span>客户经营</span>
              </template>
              <el-menu-item-group title="会员资产">
                <el-menu-item index="4"><el-icon><UserFilled /></el-icon><span>会员管理</span></el-menu-item>
                <el-menu-item index="45"><el-icon><MagicStick /></el-icon><span>用户画像</span></el-menu-item>
                <el-menu-item index="46"><el-icon><Promotion /></el-icon><span>人群包</span></el-menu-item>
                <el-menu-item index="47"><el-icon><DataBoard /></el-icon><span>人群对比</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="行为与互动">
                <el-menu-item index="44"><el-icon><DataAnalysis /></el-icon><span>用户行为看板</span></el-menu-item>
                <el-menu-item index="40"><el-icon><Message /></el-icon><span>山海有信工单</span></el-menu-item>
                <el-menu-item index="41"><el-icon><ChatDotRound /></el-icon><span>评论审核</span></el-menu-item>
                <el-menu-item index="59"><el-icon><Document /></el-icon><span>开票申请台</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="内容营销">
                <el-menu-item index="51"><el-icon><VideoCamera /></el-icon><span>内容工厂</span></el-menu-item>
              </el-menu-item-group>
            </el-sub-menu>

            <!-- ============ 4. 小程序配置 ============ -->
            <el-sub-menu index="grp-miniapp">
              <template #title>
                <el-icon><Iphone /></el-icon>
                <span>小程序配置</span>
              </template>
              <el-menu-item-group title="内容运营">
                <el-menu-item index="8"><el-icon><Picture /></el-icon><span>首页轮播</span></el-menu-item>
                <el-menu-item index="13"><el-icon><Setting /></el-icon><span>首页配置</span></el-menu-item>
                <el-menu-item index="9"><el-icon><Collection /></el-icon><span>内容管理</span></el-menu-item>
                <el-menu-item index="54"><el-icon><Notebook /></el-icon><span>养护指南</span></el-menu-item>
                <el-menu-item index="56"><el-icon><Phone /></el-icon><span>客服入口配置</span></el-menu-item>
                <el-menu-item index="62"><el-icon><View /></el-icon><span>内容展示开关</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="会员/营销规则">
                <el-menu-item index="14"><el-icon><UserFilled /></el-icon><span>会员等级体系</span></el-menu-item>
                <el-menu-item index="63"><el-icon><Trophy /></el-icon><span>荣誉馆长名单</span></el-menu-item>
                <el-menu-item index="15"><el-icon><Ticket /></el-icon><span>门店积分规则</span></el-menu-item>
                <el-menu-item index="22"><el-icon><Trophy /></el-icon><span>成就系统配置</span></el-menu-item>
                <el-menu-item index="20"><el-icon><Ticket /></el-icon><span>活动营销规则</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="系统/算法/通知">
                <el-menu-item index="16"><el-icon><Calendar /></el-icon><span>预约规则配置</span></el-menu-item>
                <el-menu-item index="19"><el-icon><MagicStick /></el-icon><span>推荐算法配置</span></el-menu-item>
                <el-menu-item index="18"><el-icon><Search /></el-icon><span>搜索关键词管理</span></el-menu-item>
                <el-menu-item index="24"><el-icon><ChatDotRound /></el-icon><span>通知消息配置</span></el-menu-item>
                <el-menu-item index="23"><el-icon><DataAnalysis /></el-icon><span>用户行为追踪</span></el-menu-item>
                <el-menu-item index="21"><el-icon><DataAnalysis /></el-icon><span>数据报表增强</span></el-menu-item>
                <el-menu-item index="17"><el-icon><Lock /></el-icon><span>权限管理系统</span></el-menu-item>
              </el-menu-item-group>
            </el-sub-menu>

            <!-- ============ 5. 组织治理 ============ -->
            <el-sub-menu index="grp-governance">
              <template #title>
                <el-icon><OfficeBuilding /></el-icon>
                <span>组织治理</span>
              </template>
              <el-menu-item-group title="人才组织">
                <el-menu-item index="7"><el-icon><Brush /></el-icon><span>标本师管理</span></el-menu-item>
                <el-menu-item index="32"><el-icon><User /></el-icon><span>员工花名册</span></el-menu-item>
                <el-menu-item index="31"><el-icon><Wallet /></el-icon><span>员工薪酬管理</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="财务资本">
                <el-menu-item index="2"><el-icon><Money /></el-icon><span>财务核算系统</span></el-menu-item>
                <el-menu-item index="36"><el-icon><DataBoard /></el-icon><span>资本架构沙盘</span></el-menu-item>
                <el-menu-item index="50"><el-icon><TrendCharts /></el-icon><span>工作室启动成本</span></el-menu-item>
                <el-menu-item index="27"><el-icon><DocumentCopy /></el-icon><span>合伙人命理中心</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="治理与合规">
                <el-menu-item index="33"><el-icon><OfficeBuilding /></el-icon><span>公司治理</span></el-menu-item>
                <el-menu-item index="28"><el-icon><Lock /></el-icon><span>合规专栏</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="品牌视觉">
                <el-menu-item index="53"><el-icon><Brush /></el-icon><span>品牌 VIS</span></el-menu-item>
              </el-menu-item-group>
            </el-sub-menu>

            <!-- ============ 6. 战略与知识 ============ -->
            <el-menu-item-group title="战略与知识">
                <el-menu-item index="12"><el-icon><MagicStick /></el-icon><span>智能中心</span></el-menu-item>
                <el-menu-item index="10"><el-icon><DataAnalysis /></el-icon><span>战略调研看板</span></el-menu-item>
                <el-menu-item index="58"><el-icon><MagicStick /></el-icon><span>爆品概念生成器</span></el-menu-item>
                <el-menu-item index="29"><el-icon><Notebook /></el-icon><span>经营手册</span></el-menu-item>
            </el-menu-item-group>

          </el-menu>
          
          <div class="sidebar-footer">
             <div class="user-badge">
                 <el-avatar :size="32" style="background:var(--brand-green-500); color:var(--light-bg-elevated); font-weight:600;">馆</el-avatar>
                 <div class="user-info">
                    <span class="name">主理人</span>
                    <span class="status">● 在线</span>
                 </div>
             </div>
             <el-button link class="mobile-access-btn" @click="showMobileAccessDialog">
               <el-icon><Iphone /></el-icon> <span>手机访问</span>
             </el-button>
             <el-button link class="logout-btn" @click="logout">
               <el-icon><SwitchButton /></el-icon> <span>退出系统</span>
             </el-button>
          </div>
        </el-aside>
        
        <el-main class="main-content">
          <!-- 🟢 多标签条 + 面包屑 -->
          <MainTabsBar @open-palette="openCommandPalette" @reload="forceReloadCurrent" />

          <div class="content-scroll-wrap" :class="{ 'is-embed-page': currentTab === '36' || currentTab === '50', 'is-mobile-scroll': isMobile }">
          <transition name="fade-slide" mode="out-in">
            <!-- tab 1 藏品库为内联模块（依赖 App.vue 大量本地状态），不参与 keep-alive -->
            <div v-if="currentTab === '1'" :key="'1-' + reloadKey" class="module-wrapper">
               <div class="module-header">
                  <div class="title-box">
                    <h2>藏品档案库</h2>
                    <span class="subtitle">ARCHIVES MANAGEMENT</span>
                  </div>
                  <div style="display: flex; gap: 10px;">
                    <el-button 
                      type="primary" 
                      :icon="MagicStick"
                      @click="showProductAIDialog = true"
                      title="AI商品助手"
                    >
                      🤖 AI助手
                    </el-button>
                    <el-button 
                      type="primary" 
                      :icon="Box"
                      @click="showInventoryAIDialog = true"
                      title="AI库存助手"
                    >
                      📦 库存助手
                    </el-button>
                    <el-button type="primary"  :icon="Plus" @click="openDialog">录入新藏品</el-button>
                  </div>
               </div>

               <el-card shadow="never" class="table-card">
                 <!-- 批量操作栏 -->
                 <div class="batch-operations" v-if="selectedProducts && selectedProducts.length > 0" style="margin-bottom: 16px;">
                    <div class="batch-info">
                        <span>已选择 <strong>{{ selectedProducts ? selectedProducts.length : 0 }}</strong> 个商品</span>
                    </div>
                    <div class="batch-actions">
                        <el-button 
                            size="small" 
                            @click="handleBatchToggleShelf(true)"
                            :disabled="!selectedProducts || selectedProducts.length === 0 || selectedProducts.every(p => p && p.isOnShelf)"
                        >
                            <el-icon><CircleCheck /></el-icon>
                            批量上架
                        </el-button>
                        <el-button 
                            size="small" 
                            @click="handleBatchToggleShelf(false)"
                            :disabled="!selectedProducts || selectedProducts.length === 0 || selectedProducts.every(p => p && !p.isOnShelf)"
                        >
                            <el-icon><CircleClose /></el-icon>
                            批量下架
                        </el-button>
                        <el-button 
                            size="small" 
                            type="primary"
                            @click="showBatchPriceDialog = true"
                        >
                            <el-icon><Edit /></el-icon>
                            批量调价
                        </el-button>
                        <el-button 
                            size="small" 
                            type="primary"
                            @click="showBatchStockDialog = true"
                        >
                            <el-icon><Box /></el-icon>
                            批量调库存
                        </el-button>
                        <el-button 
                            size="small" 
                            type="primary"
                            @click="handleAddToArchive"
                            title="将重要SKU加入藏品档案库"
                        >
                            <el-icon><FolderAdd /></el-icon>
                            加入藏品档案
                        </el-button>
                        <el-button 
                            size="small" 
                            @click="handleBatchExport"
                        >
                            <el-icon><DocumentCopy /></el-icon>
                            批量导出
                        </el-button>
                        <el-button 
                            size="small" 
                            type="danger"
                            plain
                            @click="handleBatchTogglePromo('seckill', false)"
                            :disabled="!selectedProducts.some(p => p?.seckill?.enabled)"
                        >
                            批量关秒杀
                        </el-button>
                        <el-button
                            size="small"
                            type="warning"
                            plain
                            @click="handleBatchExtendSeckill"
                            :disabled="!selectedProducts.some(p => p?.seckill?.enabled)"
                        >
                            批量延长 +3 天
                        </el-button>
                        <el-button 
                            size="small" 
                            type="warning"
                            plain
                            @click="handleBatchTogglePromo('group', false)"
                            :disabled="!selectedProducts.some(p => p?.groupBuying?.enabled)"
                        >
                            批量关拼团
                        </el-button>
                        <el-button 
                            size="small" 
                            @click="clearProductSelection"
                        >
                            取消选择
                        </el-button>
                    </div>
                 </div>

                 <div class="archive-filter-row" style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <span class="archive-filter-label">档案筛选：</span>
                    <el-radio-group v-model="archiveFilter" size="small">
                        <el-radio-button label="all">全部</el-radio-button>
                        <el-radio-button label="archive">仅档案藏品</el-radio-button>
                        <el-radio-button label="oneOfAKind">仅孤品</el-radio-button>
                    </el-radio-group>
                    <span class="archive-filter-label" style="margin-left: 8px;">营销：</span>
                    <el-radio-group v-model="promoFilter" size="small">
                        <el-radio-button label="all">全部</el-radio-button>
                        <el-radio-button label="seckill">秒杀进行中</el-radio-button>
                        <el-radio-button label="seckill_expired">秒杀已过期</el-radio-button>
                        <el-radio-button label="group">拼团</el-radio-button>
                    </el-radio-group>
                    <el-tag
                      v-if="expiredSeckillCount > 0"
                      type="warning"
                      size="small"
                      effect="dark"
                      class="expired-promo-badge"
                      @click="promoFilter = 'seckill_expired'"
                    >
                      过期提醒 {{ expiredSeckillCount }}
                    </el-tag>
                    <el-button
                      v-if="expiredSeckillCount > 0"
                      size="small"
                      type="danger"
                      plain
                      @click="handleClearExpiredSeckill"
                    >
                      一键清理过期
                    </el-button>
                 </div>

                 <el-table 
                     ref="productTableRef"
                     :data="displayProducts" 
                     style="width: 100%" 
                     v-loading="loading" 
                     row-key="_id" 
                     stripe
                     empty-text="暂无藏品，点击右上角录入"
                     @selection-change="handleProductSelectionChange"
                 >
                    <el-table-column type="selection" width="55" />
                    <el-table-column label="封面" width="100">
                      <template #default="scope">
                         <el-image 
                            class="product-table-cover"
                            style="width: 64px; height: 64px;"
                            :src="scope.row.httpImage" 
                            :preview-src-list="[scope.row.httpImage]"
                            preview-teleported
                            :z-index="5000"
                            hide-on-click-modal
                            fit="cover" />
                      </template>
                    </el-table-column>
                    <el-table-column prop="title" label="藏品名称" min-width="180">
                        <template #default="scope">
                            <div class="prod-title">{{ scope.row.title }}</div>
                            <div class="prod-id">ID: {{ scope.row._id.substring(0,8) }}...</div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="category" label="分类" width="120">
                         <template #default="scope">
                             <el-tag effect="light" type="info" round>{{ scope.row.category }}</el-tag>
                         </template>
                    </el-table-column>
                    <el-table-column label="渠道/工艺" width="130">
                         <template #default="scope">
                             <div class="promo-cell">
                               <el-tag v-if="scope.row.channel" effect="plain" size="small" round>
                                 {{ scope.row.channel === 'import' ? '进口' : scope.row.channel === 'domestic' ? '国产' : scope.row.channel }}
                               </el-tag>
                               <el-tag v-if="scope.row.craftType" effect="plain" type="success" size="small" round>
                                 {{ ({ frame: '相框', cloche: '玻璃罩', diorama: '造景', magnet: '冰箱贴' })[scope.row.craftType] || scope.row.craftType }}
                               </el-tag>
                             </div>
                         </template>
                    </el-table-column>
                    <el-table-column prop="price" label="售价" width="140">
                         <template #default="scope">
                             <span class="price-tag">¥{{ scope.row.price }}</span>
                             <el-tag
                                 v-if="scope.row.hasSku && scope.row.skus?.length"
                                 size="small"
                                 type="warning"
                                 effect="plain"
                                 style="margin-left:6px;"
                             >{{ scope.row.skus.length }}规格</el-tag>
                         </template>
                    </el-table-column>
                    <el-table-column label="营销活动" width="180">
                        <template #default="scope">
                            <div class="promo-cell" v-if="scope.row.seckill?.enabled || scope.row.groupBuying?.enabled">
                              <el-tag
                                v-if="scope.row.seckill?.enabled"
                                :type="isSeckillExpired(scope.row) ? 'info' : 'danger'"
                                size="small"
                                effect="dark"
                              >
                                {{ isSeckillExpired(scope.row) ? '秒杀已过期' : '秒杀' }} ¥{{ scope.row.seckill.price ?? '-' }}
                              </el-tag>
                              <el-tag v-if="scope.row.groupBuying?.enabled" type="warning" size="small" effect="plain" style="margin-top:4px;">
                                拼团 ¥{{ scope.row.groupBuying.price ?? '-' }} / {{ scope.row.groupBuying.groupSize || 2 }}人
                              </el-tag>
                              <div v-if="scope.row.seckill?.enabled" class="promo-meta" :class="{ 'promo-meta-expired': isSeckillExpired(scope.row) }">
                                库存 {{ scope.row.seckill.stock ?? '-' }}
                                <template v-if="scope.row.seckill.endTime"> · 至 {{ formatPromoTime(scope.row.seckill.endTime) }}</template>
                              </div>
                            </div>
                            <span v-else class="promo-none">—</span>
                        </template>
                    </el-table-column>
                    <el-table-column prop="stock" label="库存" width="120">
                        <template #default="scope">
                            <span v-if="scope.row.stock === 0" class="stock-tag out">已售罄</span>
                            <span v-else-if="scope.row.stock < 3" class="stock-tag low">紧张 ({{ scope.row.stock }})</span>
                            <span v-else class="stock-tag normal">{{ scope.row.stock }}</span>
                        </template>
                    </el-table-column>
                    <el-table-column label="档案" width="100">
                        <template #default="scope">
                            <el-tag v-if="scope.row.inArchive" type="success" size="small" effect="light">在档</el-tag>
                            <el-tag v-else type="info" size="small" effect="plain">未入档</el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column label="孤品" width="80">
                        <template #default="scope">
                            <el-tag v-if="scope.row.isOneOfAKind" type="warning" size="small" effect="dark">孤品</el-tag>
                            <span v-else class="promo-none">—</span>
                        </template>
                    </el-table-column>
                    <el-table-column label="状态" width="100">
                         <template #default="scope">
                             <el-switch 
                                v-model="scope.row.isOnShelf" 
                                active-color="#52b788" 
                                inactive-color="#d05450"
                                inline-prompt
                                active-text="上"
                                inactive-text="下"
                                @change="toggleShelf(scope.row)" />
                         </template>
                    </el-table-column>
                    <el-table-column label="操作" width="150" fixed="right">
                      <template #default="scope">
                        <el-button size="small" :icon="Edit" circle @click="editItem(scope.row)" title="编辑" />
                        <el-button size="small" type="danger" :icon="Delete" circle @click="deleteItem(scope.row)" title="删除" />
                      </template>
                    </el-table-column>
                 </el-table>
               </el-card>

               <!-- AI商品助手弹窗 -->
               <el-dialog
                 v-model="showProductAIDialog"
                 title="AI商品助手"
                 width="900px"
                 :close-on-click-modal="false"
                 class="product-ai-dialog"
                 destroy-on-close
               >
                 <ProductAI :products="products" />
               </el-dialog>

               <!-- AI库存助手弹窗 -->
               <el-dialog
                 v-model="showInventoryAIDialog"
                 title="AI库存助手"
                 width="900px"
                 :close-on-click-modal="false"
                 class="inventory-ai-dialog"
                 destroy-on-close
               >
                 <InventoryAI :products="products" />
               </el-dialog>
            </div>
            <!-- 其余模块走动态组件 + keep-alive（含 id:51 内容工厂 → ContentFactory）：
                 keep-alive 只能缓存组件实例，之前包 keyed div 完全失效（切 tab 即销毁重建）；
                 现在切回标签时组件状态（表单/滚动/已加载数据）保留，:max=10 LRU 控制内存 -->
            <keep-alive v-else :max="10">
              <component
                :is="activeModuleDef.comp"
                v-bind="activeModuleDef.props"
                :key="currentTab + '-' + reloadKey"
                @switch-tab="handleMenuSelect"
              />
            </keep-alive>
          </transition>
          </div>
        </el-main>
      </el-container>
    </div>

    <!-- 🟢 全局命令面板（Cmd/Ctrl + K） -->
    <CommandPalette ref="cmdPaletteRef" @switch-tab="handleMenuSelect" />

    <el-dialog
        v-model="dialogVisible"
        :title="isEditing ? '编辑藏品档案' : '录入新藏品'" 
        width="800px"
        destroy-on-close
        class="product-archive-dialog"
    >
        <el-form :model="form" label-width="90px" label-position="left">
            <el-form-item label="藏品名称">
                <div class="latin-name-row">
                    <el-input
                        v-model="form.title"
                        placeholder="请输入商品全称"
                        @blur="onProductTitleBlur"
                    />
                    <el-button
                        type="primary"
                        :loading="productAiFillLoading"
                        :disabled="productAiFillLoading || latinAiLoading"
                        @click="assistProductFillAll"
                    >
                        <el-icon v-if="!productAiFillLoading"><MagicStick /></el-icon>
                        一键补齐
                    </el-button>
                </div>
                <span class="sku-hint-muted">根据名称补齐分类、描述、保护物种、科学分类与拉丁学名；结果可手改</span>
            </el-form-item>
            <el-form-item label="所属分类">
                <el-cascader
                    v-model="form.categoryPath"
                    :options="categoryCascaderOptions"
                    :props="{ expandTrigger: 'hover', value: 'value', label: 'label', children: 'children' }"
                    clearable
                    filterable
                    placeholder="选择一级 / 二级分类（写入 categoryId）"
                    style="width:100%"
                    @change="onCategoryPathChange"
                />
                <span class="sku-hint-muted">与小程序馆藏筛选同源：保存 rootCategoryId + categoryId</span>
            </el-form-item>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="渠道">
                        <el-select
                            v-model="form.channel"
                            clearable
                            placeholder="蝴蝶可选：进口/国产"
                            style="width:100%"
                            :disabled="!isButterflyProduct"
                        >
                            <el-option label="进口" value="import" />
                            <el-option label="国产" value="domestic" />
                        </el-select>
                        <span class="sku-hint-muted">仅蝴蝶相关商品启用；空=未标注</span>
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="生产方式">
                        <el-select
                            v-model="form.craftType"
                            clearable
                            placeholder="相框/玻璃罩/造景/冰箱贴"
                            style="width:100%"
                            :disabled="!isCraftEligibleProduct"
                        >
                            <el-option label="相框" value="frame" />
                            <el-option label="玻璃罩" value="cloche" />
                            <el-option label="造景" value="diorama" />
                            <el-option label="冰箱贴" value="magnet" />
                        </el-select>
                        <span class="sku-hint-muted">蝴蝶/昆虫/植物/海洋；空=未标注</span>
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="进货价格">
                        <el-input-number v-model="form.costPrice" :min="0" :precision="2" :step="10" style="width:100%" />
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="销售价格">
                        <el-input-number v-model="form.price" :min="0" :precision="2" :step="10" style="width:100%" />
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="初始库存">
                        <el-input-number
                            v-model="form.stock"
                            :min="0"
                            :step="1"
                            style="width:100%"
                            :disabled="form.hasSku"
                            @change="onStockChange"
                        />
                        <span v-if="form.hasSku" class="sku-hint-muted">多规格时由各规格库存汇总</span>
                        <span v-else class="sku-hint-muted">库存为 1 时默认标记孤品</span>
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item :label="isMerchandiseForm ? '拉丁学名' : '拉丁学名 *'">
                        <div class="latin-name-row">
                            <el-input
                                v-model="form.latinName"
                                :placeholder="isMerchandiseForm ? '文创类可选' : '标本类必填 · 可 AI 识别'"
                            />
                            <el-button
                                type="primary"
                                plain
                                :loading="latinAiLoading"
                                :disabled="latinAiLoading || productAiFillLoading"
                                @click="assistProductLatin({ force: true })"
                            >
                                <el-icon v-if="!latinAiLoading"><MagicStick /></el-icon>
                                AI 识别
                            </el-button>
                        </div>
                        <span class="sku-hint-muted">
                            {{ isMerchandiseForm ? '文创类可选；可点「一键补齐」或「AI 识别」' : '标本类必填；可用「一键补齐」或本按钮，结果可改写' }}
                        </span>
                    </el-form-item>
                </el-col>
            </el-row>
            <el-form-item label="藏品描述">
                <el-input v-model="form.description" type="textarea" :rows="3" placeholder="列表/详情页简介（纯文本 description）" />
            </el-form-item>

            <el-divider content-position="left">合规标识（与店长端同源）</el-divider>
            <el-form-item label="保护物种">
                <el-select v-model="form.protectionType" style="width:100%" @change="onProtectionTypeChange">
                    <el-option label="否" value="none" />
                    <el-option label="三有保护动物" value="sanyou" />
                    <el-option label="保护植物" value="protected_plant" />
                    <el-option label="保护动物" value="protected_animal" />
                </el-select>
                <span class="sku-hint-muted">写入 protectionType</span>
            </el-form-item>
            <el-form-item
                v-if="form.protectionType && form.protectionType !== 'none'"
                label="收藏证书 *"
                required
            >
                <ImageUploadField
                    v-model="form.collectionCertificate"
                    folder="products"
                    upload-label="上传证书"
                    tip="三有或保护类须上传合法收藏/许可证明；与店长端 collectionCertificate 同源；支持 JPG / PNG / WebP / GIF"
                    preview-width="180px"
                    preview-height="120px"
                />
            </el-form-item>

            <el-divider content-position="left">标本档案（与店长端同源）</el-divider>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="采集地">
                        <el-input v-model="form.origin" placeholder="如：云南西双版纳" />
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="采集时间">
                        <el-date-picker
                            v-model="form.collectDate"
                            type="date"
                            value-format="YYYY-MM-DD"
                            placeholder="选择日期"
                            style="width:100%"
                        />
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="装裱师">
                        <el-select
                            v-model="form.framerId"
                            clearable
                            filterable
                            placeholder="选择装裱师"
                            style="width:100%"
                            @change="onFramerChange"
                        >
                            <el-option
                                v-for="f in framerOptions"
                                :key="f._id"
                                :label="f.name"
                                :value="f._id"
                            />
                        </el-select>
                        <span class="sku-hint-muted">未选时默认 framerName=NATURE</span>
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="尺寸 (cm)">
                        <div class="size-inputs">
                            <el-input v-model="form.sizeL" placeholder="长" />
                            <span>×</span>
                            <el-input v-model="form.sizeW" placeholder="宽" />
                            <span>×</span>
                            <el-input v-model="form.sizeH" placeholder="高" />
                        </div>
                    </el-form-item>
                </el-col>
            </el-row>

            <el-divider content-position="left">科学分类 taxonomy</el-divider>
            <el-row :gutter="12">
                <el-col :span="8">
                    <el-form-item label="界">
                        <el-input v-model="form.taxonomy.kingdom" placeholder="如：动物界" />
                    </el-form-item>
                </el-col>
                <el-col :span="8">
                    <el-form-item label="门">
                        <el-input v-model="form.taxonomy.phylum" placeholder="如：节肢动物门" />
                    </el-form-item>
                </el-col>
                <el-col :span="8">
                    <el-form-item label="纲">
                        <el-input v-model="form.taxonomy.class" placeholder="如：昆虫纲" />
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="12">
                <el-col :span="8">
                    <el-form-item label="目">
                        <el-input v-model="form.taxonomy.order" placeholder="可选" />
                    </el-form-item>
                </el-col>
                <el-col :span="8">
                    <el-form-item label="科">
                        <el-input v-model="form.taxonomy.family" placeholder="可选" />
                    </el-form-item>
                </el-col>
                <el-col :span="8">
                    <el-form-item label="属">
                        <el-input v-model="form.taxonomy.genus" placeholder="可选" />
                    </el-form-item>
                </el-col>
            </el-row>

            <el-divider content-position="left">多规格 SKU（skus）</el-divider>
            <el-form-item label="启用多规格">
                <el-switch v-model="form.hasSku" @change="onHasSkuChange" />
                <span class="sku-hint-muted">一物一图：每规格独立封面/图集，小程序选规格所见即所得</span>
            </el-form-item>
            <template v-if="form.hasSku">
                <el-form-item label="规格维度">
                    <el-input
                        v-model="form.skuDimensionsStr"
                        placeholder="可选，如：尺寸,装裱（逗号分隔；多维规格名用 / 分隔）"
                    />
                </el-form-item>
                <div class="sku-variants-editor">
                    <div
                        v-for="(sku, idx) in form.skus"
                        :key="sku.id || idx"
                        class="sku-variant-row"
                    >
                        <div class="sku-variant-fields">
                            <el-input v-model="sku.specLabel" placeholder="规格名（如 30cm / 金框）" />
                            <el-input v-model="sku.sku" placeholder="SKU 编码（可选）" />
                            <el-input-number v-model="sku.price" :min="0" :precision="2" :step="10" controls-position="right" placeholder="价格" />
                            <el-input-number v-model="sku.stock" :min="0" :step="1" controls-position="right" placeholder="库存" />
                            <el-button type="danger" link :icon="Delete" @click="removeSkuRow(idx)">删除</el-button>
                        </div>
                        <div class="sku-variant-images">
                            <div v-if="sku.imagePreviews?.length" class="gallery-thumbs">
                                <div
                                    v-for="(url, imgIdx) in sku.imagePreviews"
                                    :key="'skuimg-' + idx + '-' + imgIdx"
                                    class="gallery-thumb"
                                    :class="{ 'is-cover': imgIdx === 0 }"
                                >
                                    <el-image
                                        :src="url"
                                        :preview-src-list="sku.imagePreviews"
                                        :initial-index="imgIdx"
                                        preview-teleported
                                        fit="cover"
                                        class="gallery-thumb-img"
                                    />
                                    <div class="gallery-thumb-actions">
                                        <el-button v-if="imgIdx !== 0" size="small" link type="primary" @click="setSkuCoverImage(idx, imgIdx)">设封面</el-button>
                                        <el-button size="small" link type="danger" @click="removeSkuImage(idx, imgIdx)">删除</el-button>
                                    </div>
                                    <span v-if="imgIdx === 0" class="cover-badge">封面</span>
                                </div>
                            </div>
                            <el-upload
                                drag
                                class="product-image-upload product-image-upload--sku"
                                :show-file-list="false"
                                accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                                multiple
                                :disabled="productMediaUploading"
                                :before-upload="beforeProductImageUpload"
                                :http-request="(opt) => uploadSkuImage(idx, opt)"
                            >
                                <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                                <div class="el-upload__text">点击或拖拽图片到此处</div>
                            </el-upload>
                            <span class="sku-hint-muted">至少 1 张；首张为该规格主图；支持 JPG / PNG / WebP / GIF</span>
                        </div>
                    </div>
                    <el-button type="primary" plain :icon="Plus" @click="addSkuRow">添加规格</el-button>
                </div>
            </template>

            <el-divider content-position="left">商品图（images）</el-divider>
            <el-form-item label="轮播图">
                <div class="product-media-gallery">
                    <div v-if="form.imagePreviews?.length" class="gallery-thumbs">
                        <div
                            v-for="(url, idx) in form.imagePreviews"
                            :key="'img-' + idx + '-' + (form.images?.[idx] || '')"
                            class="gallery-thumb"
                            :class="{ 'is-cover': idx === 0 }"
                        >
                            <el-image
                                :src="url"
                                :preview-src-list="form.imagePreviews"
                                :initial-index="idx"
                                preview-teleported
                                fit="cover"
                                class="gallery-thumb-img"
                            />
                            <div class="gallery-thumb-actions">
                                <el-button v-if="idx !== 0" size="small" link type="primary" @click="setCoverImage(idx)">设封面</el-button>
                                <el-button v-if="idx > 0" size="small" link @click="moveProductImage(idx, -1)">左移</el-button>
                                <el-button v-if="idx < form.images.length - 1" size="small" link @click="moveProductImage(idx, 1)">右移</el-button>
                                <el-button size="small" link type="danger" @click="removeProductImage(idx)">删除</el-button>
                            </div>
                            <span v-if="idx === 0" class="cover-badge">封面</span>
                        </div>
                    </div>
                    <el-upload
                        drag
                        class="product-image-upload"
                        :show-file-list="false"
                        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                        multiple
                        :disabled="productMediaUploading"
                        :before-upload="beforeProductImageUpload"
                        :http-request="uploadProductImage"
                    >
                        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                        <div class="el-upload__text">点击或拖拽图片到此处</div>
                    </el-upload>
                    <span class="sku-hint-muted">首张为封面 images[0]，与小程序详情轮播一致；支持 JPG / PNG / WebP / GIF</span>
                </div>
            </el-form-item>

            <el-divider content-position="left">图文详情</el-divider>
            <el-form-item label="详情图">
                <div class="product-media-gallery">
                    <div v-if="form.detailImagePreviews?.length" class="gallery-thumbs">
                        <div
                            v-for="(url, idx) in form.detailImagePreviews"
                            :key="'dimg-' + idx + '-' + (form.detailImages?.[idx] || '')"
                            class="gallery-thumb"
                        >
                            <el-image
                                :src="url"
                                :preview-src-list="form.detailImagePreviews"
                                :initial-index="idx"
                                preview-teleported
                                fit="cover"
                                class="gallery-thumb-img"
                            />
                            <div class="gallery-thumb-actions">
                                <el-button v-if="idx > 0" size="small" link @click="moveDetailImage(idx, -1)">左移</el-button>
                                <el-button v-if="idx < form.detailImages.length - 1" size="small" link @click="moveDetailImage(idx, 1)">右移</el-button>
                                <el-button size="small" link type="danger" @click="removeDetailImage(idx)">删除</el-button>
                            </div>
                        </div>
                    </div>
                    <el-upload
                        drag
                        class="product-image-upload"
                        :show-file-list="false"
                        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                        multiple
                        :disabled="productMediaUploading"
                        :before-upload="beforeProductImageUpload"
                        :http-request="uploadDetailImage"
                    >
                        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                        <div class="el-upload__text">点击或拖拽图片到此处</div>
                    </el-upload>
                    <span class="sku-hint-muted">写入 detailImages，详情页「图文详情」区展示；支持 JPG / PNG / WebP / GIF</span>
                </div>
            </el-form-item>
            <el-form-item label="富文本">
                <RichHtmlEditor
                    v-model="form.detailHtml"
                    @image-uploaded="onRichImageUploaded"
                />
            </el-form-item>

            <el-form-item label="镇店之宝">
                <el-switch v-model="form.isTreasure" />
            </el-form-item>
            <el-form-item label="孤品">
                <el-switch v-model="form.isOneOfAKind" @change="onOneOfAKindChange" />
                <span class="sku-hint-muted">仅一件、不可复制补货；库存=1 自动勾选，手动关掉后不再强开</span>
            </el-form-item>
            <el-form-item label="列入藏品档案">
                <el-switch v-model="form.inArchive" />
                <span class="sku-hint-muted">重要SKU入档，便于档案筛选与盘点（新建默认开启）</span>
            </el-form-item>
            <el-form-item label="是否参与会员折扣">
                <el-switch v-model="form.memberDiscountEnabled" />
                <span class="sku-hint-muted">关闭后按下单原价计价，仍可叠加优惠券等其它促销</span>
            </el-form-item>
            <el-form-item label="支持定制">
                <el-switch v-model="form.supportsCustom" />
                <span class="sku-hint-muted">与店长端 supportsCustom 同源</span>
            </el-form-item>
            
            <!-- 🟢 限时秒杀设置 -->
            <el-divider content-position="left">限时秒杀</el-divider>
            <el-form-item label="启用秒杀">
                <el-switch v-model="form.seckillEnabled" />
            </el-form-item>
            <template v-if="form.seckillEnabled">
                <el-row :gutter="20">
                    <el-col :span="12">
                        <el-form-item label="秒杀价格">
                            <el-input-number v-model="form.seckillPrice" :min="0" :precision="2" style="width:100%" />
                        </el-form-item>
                    </el-col>
                    <el-col :span="12">
                        <el-form-item label="秒杀库存">
                            <el-input-number v-model="form.seckillStock" :min="0" style="width:100%" />
                        </el-form-item>
                    </el-col>
                </el-row>
                <el-row :gutter="20">
                    <el-col :span="12">
                        <el-form-item label="开始时间">
                            <el-date-picker v-model="form.seckillStartTime" type="datetime" style="width:100%" />
                        </el-form-item>
                    </el-col>
                    <el-col :span="12">
                        <el-form-item label="结束时间">
                            <el-date-picker v-model="form.seckillEndTime" type="datetime" style="width:100%" />
                        </el-form-item>
                    </el-col>
                </el-row>
                <el-form-item label="限购数量">
                    <el-input-number v-model="form.seckillLimitPerUser" :min="1" style="width:100%" />
                </el-form-item>
            </template>
            
            <!-- 🟢 拼团设置 -->
            <el-divider content-position="left">拼团功能</el-divider>
            <el-form-item label="启用拼团">
                <el-switch v-model="form.groupBuyingEnabled" />
            </el-form-item>
            <template v-if="form.groupBuyingEnabled">
                <el-row :gutter="20">
                    <el-col :span="12">
                        <el-form-item label="拼团价格">
                            <el-input-number v-model="form.groupBuyingPrice" :min="0" :precision="2" style="width:100%" />
                        </el-form-item>
                    </el-col>
                    <el-col :span="12">
                        <el-form-item label="成团人数">
                            <el-input-number v-model="form.groupBuyingSize" :min="2" style="width:100%" />
                        </el-form-item>
                    </el-col>
                </el-row>
            </template>
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="dialogVisible = false">取消</el-button>
                <el-button type="primary"  @click="saveProduct">保存归档</el-button>
            </span>
        </template>
    </el-dialog>

    <!-- 🔧 手机访问链接对话框 -->
    <el-dialog
      v-model="mobileAccessDialogVisible"
      title="📱 手机访问链接"
      width="420px"
      align-center
      class="mobile-access-dialog"
      @opened="onDialogOpened"
    >
      <div class="mobile-access-content">
        <!-- 提示信息 -->
        <div class="access-intro">
          <el-icon :size="20" class="intro-icon"><InfoFilled /></el-icon>
          <span>使用手机浏览器扫描二维码或直接复制下方链接访问</span>
        </div>
        
        <!-- 二维码区域 -->
        <div class="qr-code-wrapper">
          <div class="qr-code-container" v-if="accessUrl && accessUrl.startsWith('http')">
            <div class="qr-code-loader" v-if="qrLoading">
              <el-icon class="is-loading" :size="32"><Loading /></el-icon>
              <p>正在生成二维码...</p>
            </div>
            <canvas 
              ref="qrCanvas" 
              class="qr-code-canvas"
              :class="{ 'qr-ready': !qrLoading }"
            ></canvas>
          </div>
          
          <div v-else class="qr-code-placeholder">
            <el-icon :size="64" class="placeholder-icon"><PictureFilled /></el-icon>
            <p class="placeholder-text">无法自动获取IP地址</p>
            <p class="placeholder-hint">请查看下方说明手动获取IP</p>
          </div>
        </div>
        
        <!-- 访问链接区域 -->
        <div class="access-link-section">
          <div class="section-label">访问链接</div>
          <div class="access-link-container" v-if="accessUrl && accessUrl.startsWith('http')">
            <el-input
              v-model="accessUrl"
              readonly
              class="access-link-input"
              size="large"
            >
              <template #append>
                <el-button
                  :icon="DocumentCopy"
                  @click="copyAccessUrl"
                  type="primary"
                  title="复制链接"
                  :loading="copying"
                >
                  复制
                </el-button>
              </template>
            </el-input>
            <div class="copy-success-tip" v-if="copySuccess">
              <el-icon><SuccessFilled /></el-icon>
              <span>链接已复制</span>
            </div>
          </div>
          
          <div v-else class="access-link-tip">
            <el-alert
              type="warning"
              :closable="false"
              show-icon
              class="ip-tip-alert"
            >
              <template #title>
                <div class="tip-title">无法自动获取IP地址</div>
              </template>
              <template #default>
                <div class="tip-content">
                  <p><strong>方法一：查看终端输出</strong></p>
                  <p>启动开发服务器时，终端会显示类似以下内容：</p>
                  <div class="code-block">
                    Network: http://192.168.x.x:5173
                  </div>
                  
                  <p style="margin-top: 12px;"><strong>方法二：命令行查询</strong></p>
                  <div class="code-block">
                    <span class="code-label">macOS/Linux:</span> ifconfig | grep "inet " | grep -v 127.0.0.1<br>
                    <span class="code-label">Windows:</span> ipconfig | findstr IPv4
                  </div>
                  
                  <p style="margin-top: 12px; color: var(--brand-green-600);">
                    <el-icon><WarningFilled /></el-icon>
                    找到局域网IP后，手动构建链接：<code>http://你的IP:5173</code>
                  </p>
                </div>
              </template>
            </el-alert>
          </div>
        </div>
        
        <!-- 使用说明 -->
        <div class="access-tips" v-if="accessUrl && accessUrl.startsWith('http')">
          <div class="tips-header">
            <el-icon><QuestionFilled /></el-icon>
            <span>访问说明</span>
          </div>
          <ul class="tips-list">
            <li>
              <el-icon class="tip-icon"><WarningFilled /></el-icon>
              <span><strong>重要</strong>：不能使用 127.0.0.1，必须使用局域网IP（如 192.168.x.x）</span>
            </li>
            <li>
              <el-icon class="tip-icon"><Connection /></el-icon>
              <span>确保手机与电脑在同一Wi-Fi网络</span>
            </li>
            <li>
              <el-icon class="tip-icon"><Lock /></el-icon>
              <span>如果无法访问，请检查防火墙是否允许5173端口</span>
            </li>
            <li>
              <el-icon class="tip-icon"><Monitor /></el-icon>
              <span>开发环境端口：5173（默认）</span>
            </li>
          </ul>
        </div>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="mobileAccessDialogVisible = false" size="large">关闭</el-button>
        </div>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent, h } from 'vue'

// 🟢 大模块懒加载（首屏减负）
const asyncWith = (loader) => defineAsyncComponent({
  loader,
  loadingComponent: { render: () => h('div', { style: 'padding: 60px; text-align: center; color: #d4af37;' }, '加载中…') },
  errorComponent: { render: () => h('div', { style: 'padding: 60px; text-align: center; color: #f56c6c;' }, '模块加载失败，请刷新重试') },
  delay: 100,
  timeout: 30000
})
// 导入图标库
import {
  Plus, Edit, Delete, Box, List, Lock, Money, Odometer, FolderAdd,
  UserFilled, Picture, PictureFilled, UploadFilled, Collection, Calendar, Ticket, SwitchButton, DataAnalysis, ChatDotRound, Setting, MagicStick, Search, Trophy, Iphone, DocumentCopy, Menu, View,
  InfoFilled, Loading, SuccessFilled, WarningFilled, QuestionFilled, Connection, Monitor, CircleCheck, CircleClose, Notebook, Shop, Wallet, Brush, User, OfficeBuilding, Promotion,
  DataBoard, TrendCharts, VideoCamera, Van,
  // 🟢 小程序对齐补充图标
  Stamp, Avatar, Message, Refresh, Document, ShoppingCart, Phone,
  // 🟢 命令面板/收藏夹
  Close,
  // 🟢 侧栏折叠
  Expand, Fold,
  // 🟢 物业合作测算
  House
} from '@element-plus/icons-vue'
// 导入云开发工具
import { getTempFileUrl, getTempFileUrls, uploadAdminBinary, COLLECTIONS, fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove, callCloudFunction } from './cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import RichHtmlEditor from './components/RichHtmlEditor.vue'
import ImageUploadField from './components/ImageUploadField.vue'

// --- 动态组件引入（同步加载，保证各 Tab 稳定渲染） ---
const FinanceDashboard = asyncWith(() => import('./components/Finance.vue'))
import OrderCenter from './components/Orders.vue'
import CRMSystem from './components/CRM.vue'
import ProductAI from './components/ai/ProductAI.vue'
import InventoryAI from './components/ai/InventoryAI.vue'
import OperationsDecisionCenter from './components/ai/OperationsDecisionCenter.vue'
import RealtimeMonitor from './components/RealtimeMonitor.vue'
import Dashboard from './components/Dashboard.vue'
import ActivityManager from './components/Activities.vue'
import MarketingCenter from './components/Marketing.vue'
import TeamManager from './components/Team.vue'
import BannerManager from './components/BannerManager.vue'
import HomeConfigManager from './components/HomeConfigManager.vue'
import ContentManager from './components/ContentManager.vue'
const StrategyResearch = asyncWith(() => import('./components/StrategyResearch.vue'))
const ProductConceptGenerator = asyncWith(() => import('./components/ProductConceptGenerator.vue'))
const AICenter = asyncWith(() => import('./components/AICenter.vue'))
import PartnerDestinyCenter from './components/PartnerDestinyCenter.vue'
import CapitalArchitectureSandbox from './components/CapitalArchitectureSandbox.vue'
import StartupCostModel from './components/StartupCostModel.vue'
import ContentFactory from './components/ContentFactory.vue'
const BrandVIS = asyncWith(() => import('./components/BrandVIS.vue'))
import ComplianceCenter from './components/ComplianceCenter.vue'
import MemberLevelConfig from './components/MemberLevelConfig.vue'
import PointsRulesConfig from './components/PointsRulesConfig.vue'
import BookingRulesConfig from './components/BookingRulesConfig.vue'
import PermissionManager from './components/PermissionManager.vue'
import SearchKeywordsManager from './components/SearchKeywordsManager.vue'
import RecommendAlgorithmConfig from './components/RecommendAlgorithmConfig.vue'
import MarketingRulesConfig from './components/MarketingRulesConfig.vue'
import CustomReportBuilder from './components/CustomReportBuilder.vue'
import AchievementConfig from './components/AchievementConfig.vue'
import UserBehaviorConfig from './components/UserBehaviorConfig.vue'
import NotificationConfig from './components/NotificationConfig.vue'
import OperationsManual from './components/OperationsManual.vue'
import StoreManagement from './components/StoreManagement.vue'
import FranchiseManagement from './components/FranchiseManagement.vue'
import PayrollManagement from './components/PayrollManagement.vue'
import CorporateGovernanceCenter from './components/CorporateGovernanceCenter.vue'
import StoreDesignCenter from './components/StoreDesignCenter.vue'

// 🟢 对齐小程序能力的 7 个新模块
import Bookings from './components/Bookings.vue'
import CustomOrders from './components/CustomOrders.vue'
const FulfillmentCenter = asyncWith(() => import('./components/FulfillmentCenter.vue'))
import PetMemorial from './components/PetMemorial.vue'
import CareGuides from './components/CareGuides.vue'
import StoreFrontConfig from './components/StoreFrontConfig.vue'
import SupportConfigs from './components/SupportConfigs.vue'
import ContentDisplayFlags from './components/ContentDisplayFlags.vue'
import PriceListManager from './components/PriceListManager.vue'
import SupportTickets from './components/SupportTickets.vue'
import CommentsModeration from './components/CommentsModeration.vue'
import Refunds from './components/Refunds.vue'
import InvoiceRequests from './components/InvoiceRequests.vue'
import HonoraryCurators from './components/HonoraryCurators.vue'
import PlatformOrderBinds from './components/PlatformOrderBinds.vue'
import ShippingRulesConfig from './components/ShippingRulesConfig.vue'
import Categories from './components/Categories.vue'
import BehaviorAnalytics from './components/BehaviorAnalytics.vue'
import UserInsights from './components/UserInsights.vue'
import AudienceManager from './components/AudienceManager.vue'
import CohortCompare from './components/CohortCompare.vue'
import PropertyEval from './components/PropertyEval.vue'
import CommandPalette from './components/CommandPalette.vue'
import MainTabsBar from './components/MainTabsBar.vue'
import { MODULES_BY_ID } from './utils/modulesRegistry'
import { useTabsManager } from './composables/useTabsManager'

const { openTab: openTabAPI, activeTabId, closeOthers: closeOthersAPI, closeAll: closeAllAPI } = useTabsManager()

// ============ 动态组件映射（替代 47 条 v-else-if 链，让 keep-alive 真正缓存组件实例） ============
// 值为工厂函数：props 在 computed 求值时取（products 等响应式数据变更可触发更新）
const TAB_COMPONENT_MAP = {
  '0': () => ({ comp: Dashboard }),
  '2': () => ({ comp: FinanceDashboard }),
  '3': () => ({ comp: OrderCenter }),
  '4': () => ({ comp: CRMSystem }),
  '5': () => ({ comp: ActivityManager }),
  '6': () => ({ comp: MarketingCenter }),
  '7': () => ({ comp: TeamManager, props: { initialSection: 'framer' } }),
  '8': () => ({ comp: BannerManager }),
  '9': () => ({ comp: ContentManager }),
  '10': () => ({ comp: StrategyResearch }),
  '58': () => ({ comp: ProductConceptGenerator }),
  '12': () => ({ comp: AICenter }),
  '13': () => ({ comp: HomeConfigManager }),
  '14': () => ({ comp: MemberLevelConfig }),
  '63': () => ({ comp: HonoraryCurators }),
  '15': () => ({ comp: PointsRulesConfig }),
  '16': () => ({ comp: BookingRulesConfig }),
  '17': () => ({ comp: PermissionManager }),
  '18': () => ({ comp: SearchKeywordsManager }),
  '19': () => ({ comp: RecommendAlgorithmConfig }),
  '20': () => ({ comp: MarketingRulesConfig }),
  '21': () => ({ comp: CustomReportBuilder }),
  '22': () => ({ comp: AchievementConfig }),
  '23': () => ({ comp: UserBehaviorConfig }),
  '24': () => ({ comp: NotificationConfig }),
  '25': () => ({ comp: OperationsDecisionCenter, props: { products: products.value, orders: [] } }),
  '26': () => ({ comp: RealtimeMonitor, props: { variant: 'live' } }),
  '27': () => ({ comp: PartnerDestinyCenter }),
  '28': () => ({ comp: ComplianceCenter }),
  '29': () => ({ comp: OperationsManual }),
  '30': () => ({ comp: StoreManagement }),
  '31': () => ({ comp: PayrollManagement }),
  '32': () => ({ comp: TeamManager, props: { initialSection: 'staff' } }),
  '33': () => ({ comp: CorporateGovernanceCenter }),
  '34': () => ({ comp: StoreDesignCenter }),
  '35': () => ({ comp: FranchiseManagement }),
  '36': () => ({ comp: CapitalArchitectureSandbox }),
  '50': () => ({ comp: StartupCostModel }),
  '51': () => ({ comp: ContentFactory }),
  '37': () => ({ comp: Bookings }),
  '38': () => ({ comp: CustomOrders }),
  '52': () => ({ comp: FulfillmentCenter }),
  '53': () => ({ comp: BrandVIS }),
  '39': () => ({ comp: PetMemorial }),
  '54': () => ({ comp: CareGuides }),
  '55': () => ({ comp: StoreFrontConfig }),
  '56': () => ({ comp: SupportConfigs }),
  '62': () => ({ comp: ContentDisplayFlags }),
  '57': () => ({ comp: PriceListManager }),
  '40': () => ({ comp: SupportTickets }),
  '41': () => ({ comp: CommentsModeration }),
  '42': () => ({ comp: Refunds }),
  '59': () => ({ comp: InvoiceRequests }),
  '60': () => ({ comp: PlatformOrderBinds }),
  '61': () => ({ comp: ShippingRulesConfig }),
  '43': () => ({ comp: Categories }),
  '44': () => ({ comp: BehaviorAnalytics }),
  '45': () => ({ comp: UserInsights }),
  '46': () => ({ comp: AudienceManager }),
  '47': () => ({ comp: CohortCompare }),
  '48': () => ({ comp: PropertyEval }),
  '49': () => ({ comp: RealtimeMonitor, props: { variant: 'business' } })
}
const activeModuleDef = computed(() => {
  const factory = TAB_COMPONENT_MAP[String(currentTab.value)]
  if (!factory) return { comp: Dashboard, props: {} } // 未注册的 tab 回退驾驶舱
  const def = factory()
  return { comp: def.comp, props: def.props || {} }
})

/** 生产环境可在 .env.production 中设置 VITE_ADMIN_PASSWORD；未设置时沿用开发默认口令 */
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_PASSWORD || 'admin888'

// --- 全局状态 ---
/** 默认进入数智化中台登录；登录成功后可带 #admin 便于收藏 */
const isLoggedIn = ref(false)
const password = ref('')
const loggingIn = ref(false)
// currentTab 改为 activeTabId 的代理（保留旧代码兼容性）
const currentTab = computed({
  get: () => activeTabId.value,
  set: (v) => { activeTabId.value = v }
})
const mobileMenuVisible = ref(false) // 移动端菜单显示状态
const sideMenuRef = ref(null)

// 强制刷新当前 tab 的 key（reload-current 动作用）
const reloadKey = ref(0)
const forceReloadCurrent = () => { reloadKey.value++ }

// ============ 侧栏折叠 ============
const SIDEBAR_COLLAPSED_KEY = 'sc_admin_sidebar_collapsed'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0') } catch (e) {}
}

// ============ 全局动作监听（命令面板触发 / 快捷键触发） ============
// 必须用命名常量包装（不能直接注册 closeOthersAPI，避免 Event 被当作 keepId），
// 且 add/remove 必须传同一引用，否则 removeEventListener 是 no-op，HMR 下监听器累积
const onTabsCloseOthers = () => closeOthersAPI()
const onTabsCloseAll = () => closeAllAPI()
const onActionLogout = () => logout()
const onExportCurrent = () => {
  ElMessage.info('请在当前模块内点击对应"导出"按钮（暂未做统一导出）')
}
const onSwitchTabEvent = (event) => {
  if (event.detail) handleMenuSelect(event.detail)
}
const setupActionListeners = () => {
  window.addEventListener('toggle-sidebar', toggleSidebar)
  window.addEventListener('tabs-close-others', onTabsCloseOthers)
  window.addEventListener('tabs-close-all', onTabsCloseAll)
  window.addEventListener('reload-current', forceReloadCurrent)
  window.addEventListener('logout', onActionLogout)
  window.addEventListener('export-current', onExportCurrent)
}
const cleanupActionListeners = () => {
  window.removeEventListener('toggle-sidebar', toggleSidebar)
  window.removeEventListener('tabs-close-others', onTabsCloseOthers)
  window.removeEventListener('tabs-close-all', onTabsCloseAll)
  window.removeEventListener('reload-current', forceReloadCurrent)
  window.removeEventListener('logout', onActionLogout)
  window.removeEventListener('export-current', onExportCurrent)
}

// 全局 Cmd+B 折叠侧栏
const onSidebarKey = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleSidebar()
  }
}
// ============ 侧边栏分组展开持久化 ============
// 6 大顶级分类：3 个是 flat（不需要 sub-menu key），4 个是折叠 sub-menu
const ALL_SUBMENUS = ['grp-business', 'grp-customer', 'grp-miniapp', 'grp-governance']
// 每个 currentTab 对应的子菜单 group（用于自动展开）
const TAB_TO_GROUP = {
  '1': 'grp-business', '3': 'grp-business', '5': 'grp-business', '6': 'grp-business',
  '30': 'grp-business', '34': 'grp-business', '35': 'grp-business', '37': 'grp-business',
  '38': 'grp-business', '39': 'grp-business', '42': 'grp-business', '43': 'grp-business',
  '48': 'grp-business', '52': 'grp-business', '55': 'grp-business',
  '57': 'grp-business', '60': 'grp-business', '61': 'grp-business',
  '4': 'grp-customer', '40': 'grp-customer', '41': 'grp-customer', '44': 'grp-customer',
  '45': 'grp-customer', '46': 'grp-customer', '47': 'grp-customer', '51': 'grp-customer', '59': 'grp-customer',
  '8': 'grp-miniapp', '9': 'grp-miniapp', '13': 'grp-miniapp', '14': 'grp-miniapp',
  '15': 'grp-miniapp', '16': 'grp-miniapp', '17': 'grp-miniapp', '18': 'grp-miniapp',
  '19': 'grp-miniapp', '20': 'grp-miniapp', '21': 'grp-miniapp', '22': 'grp-miniapp',
  '23': 'grp-miniapp', '24': 'grp-miniapp', '54': 'grp-miniapp', '56': 'grp-miniapp',
  '62': 'grp-miniapp', '63': 'grp-miniapp',
  '2': 'grp-governance', '7': 'grp-governance', '27': 'grp-governance', '28': 'grp-governance',
  '31': 'grp-governance', '32': 'grp-governance', '33': 'grp-governance', '36': 'grp-governance', '50': 'grp-governance', '53': 'grp-governance'
}
// ============ 置顶收藏夹（与 CommandPalette 共享 localStorage key） ============
const PINNED_KEY = 'sc_admin_pinned_modules'
const cmdPaletteRef = ref(null)
const pinnedIds = ref([])
const loadPinned = () => {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) pinnedIds.value = arr
    }
  } catch (e) { /* ignore */ }
}
const persistPinned = () => {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedIds.value)) } catch (e) {}
  // 同页内通知命令面板同步（storage 事件只派发给其它标签页）
  window.dispatchEvent(new CustomEvent('pinned-changed'))
}
const pinnedModules = computed(() => pinnedIds.value.map(id => MODULES_BY_ID[id]).filter(Boolean))
const togglePin = (id) => {
  if (pinnedIds.value.includes(id)) {
    pinnedIds.value = pinnedIds.value.filter(x => x !== id)
  } else {
    pinnedIds.value = [...pinnedIds.value, id].slice(0, 8)
  }
  persistPinned()
}
const openCommandPalette = () => {
  cmdPaletteRef.value?.open()
}
// 监听 localStorage 变化（CommandPalette 内部修改后同步到侧栏）
const onStorage = (e) => {
  if (e.key === PINNED_KEY) loadPinned()
}

const SIDEBAR_OPENED_KEY = 'sc_admin_sidebar_openeds'
const loadOpeneds = () => {
  try {
    const raw = localStorage.getItem(SIDEBAR_OPENED_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(k => ALL_SUBMENUS.includes(k))
    }
  } catch (e) { /* ignore */ }
  // 默认展开"业务运营"和"客户经营"
  return ['grp-business', 'grp-customer']
}
const defaultOpeneds = ref(loadOpeneds())
const persistOpeneds = () => {
  try { localStorage.setItem(SIDEBAR_OPENED_KEY, JSON.stringify(defaultOpeneds.value)) } catch (e) {}
}
const handleSubMenuOpen = (key) => {
  if (!defaultOpeneds.value.includes(key)) {
    defaultOpeneds.value.push(key)
    persistOpeneds()
  }
}
const handleSubMenuClose = (key) => {
  defaultOpeneds.value = defaultOpeneds.value.filter(k => k !== key)
  persistOpeneds()
}

// --- 藏品模块状态 ---
const loading = ref(false)
const products = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const showProductAIDialog = ref(false)
const showInventoryAIDialog = ref(false)
const selectedProducts = ref([]) // 批量操作选中的商品
const productTableRef = ref(null) // 表格引用
const showBatchPriceDialog = ref(false) // 批量调价对话框
const showBatchStockDialog = ref(false) // 批量调库存对话框
const batchPriceForm = ref({ type: 'set', value: 0, discount: 0 }) // 批量调价表单
const batchStockForm = ref({ type: 'set', value: 0 }) // 批量调库存表单
const form = ref({ 
    title: '', price: 0, costPrice: 0, stock: 1, category: '',
    categoryId: '', rootCategoryId: '', rootCategoryName: '', categoryType: '', categoryPath: [],
    channel: '', craftType: '',
    latinName: '', description: '', isTreasure: false, isOneOfAKind: true, inArchive: true, memberDiscountEnabled: true,
    supportsCustom: true,
    protectionType: 'none', collectionCertificate: '',
    origin: '', collectDate: '', framerName: 'NATURE', framerId: null,
    sizeL: '', sizeW: '', sizeH: '',
    taxonomy: { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' },
    images: [], imagePreviews: [],
    detailImages: [], detailImagePreviews: [],
    detailHtml: '',
    hasSku: false, skus: [], skuDimensionsStr: '',
    seckillEnabled: false, seckillPrice: 0, seckillStock: 0, seckillStartTime: null, seckillEndTime: null, seckillLimitPerUser: 1,
    groupBuyingEnabled: false, groupBuyingPrice: 0, groupBuyingSize: 2
})
const productMediaUploading = ref(false)
const latinAiLoading = ref(false)
const productAiFillLoading = ref(false)
/** 用户在库存=1 时手动关掉孤品后，不再因 stock===1 反复强开 */
const oneOfAKindManualOff = ref(false)
const categoryCascaderOptions = ref([])
const categoryFlatMap = ref({}) // id -> category doc
const framerOptions = ref([])

const emptyTaxonomy = () => ({ kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' })

const parseProductSize = (sizeStr) => {
    let sizeL = '', sizeW = '', sizeH = ''
    if (sizeStr) {
        const cleanSize = String(sizeStr).replace(/cm/gi, '').trim()
        const p = cleanSize.split(/[xX×]/)
        if (p.length >= 3) {
            sizeL = p[0].trim()
            sizeW = p[1].trim()
            sizeH = p[2].trim()
        }
    }
    return { sizeL, sizeW, sizeH }
}

const isMerchandiseProduct = (f) => {
    if (!f) return false
    if (f.categoryType === 'merch') return true
    const text = `${f.rootCategoryName || ''}${f.category || ''}`
    return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|陈饰|联名/.test(text)
}

const isMerchandiseForm = computed(() => isMerchandiseProduct(form.value))

const isButterflyProduct = computed(() => {
    const f = form.value || {}
    const blob = [f.rootCategoryName, f.category].filter(Boolean).join(' ')
    // 蝴蝶二级，或昆虫馆下可标注（运营仅对蝴蝶填写）
    return /蝴蝶|鳞翅|蝶|昆虫/.test(blob)
})

const isCraftEligibleProduct = computed(() => {
    const f = form.value || {}
    const blob = [f.rootCategoryName, f.category].filter(Boolean).join(' ')
    return /昆虫|植物|海洋|蝴蝶|鳞翅/.test(blob)
})
const archiveFilter = ref('all') // 'all' | 'archive' | 'oneOfAKind' 全部 / 仅档案藏品 / 仅孤品
const promoFilter = ref('all') // 'all' | 'seckill' | 'seckill_expired' | 'group'

// =================================================
// 🔐 认证与会话管理
// =================================================

function setAdminHash(on) {
    const path = `${window.location.pathname}${window.location.search}`
    if (on) {
        if (window.location.hash.replace(/^#\/?/, '') !== 'admin') {
            window.history.replaceState(null, '', `${path}#admin`)
        }
    } else if (window.location.hash) {
        window.history.replaceState(null, '', path)
    }
}

function stripLegacyBrandHashes() {
    const h = (window.location.hash || '').replace(/^#\/?/, '')
    if (h === 'brand' || h === 'brand-b') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
}

const checkSession = () => {
    // 检查本地存储的Token
    if (localStorage.getItem('sc_admin_token') === 'verified_888') {
        isLoggedIn.value = true
        setAdminHash(true)
        if (currentTab.value === '1') loadProducts()
    }
}

const handleLogin = () => {
    if (!password.value) return ElMessage.warning('请输入管理口令')
    loggingIn.value = true
    
    // 模拟鉴权延迟
    setTimeout(() => {
        if (password.value === ADMIN_SECRET) { 
            isLoggedIn.value = true
            localStorage.setItem('sc_admin_token', 'verified_888')
            setAdminHash(true)
            ElMessage.success({ message: '身份验证通过，欢迎回来', duration: 2000 })
        } else {
            ElMessage.error('口令错误，访问被拒绝')
            password.value = ''
        }
        loggingIn.value = false
    }, 800)
}

const logout = () => {
    ElMessageBox.confirm('确定要退出管理系统吗？', '提示', {
        confirmButtonText: '退出',
        cancelButtonText: '取消',
        type: 'warning'
    }).then(() => {
        localStorage.removeItem('sc_admin_token')
        isLoggedIn.value = false
        password.value = ''
        setAdminHash(false)
        ElMessage.info('已安全退出')
    }).catch(() => {})
}

const handleMenuSelect = (index) => {
    if (index === 'sub-miniapp' || String(index).startsWith('sub-') || String(index).startsWith('grp-')) return
    // 先清除之前的选择状态，避免ref引用问题
    if (currentTab.value === '1') {
        selectedProducts.value = []
        if (productTableRef.value) {
            try {
                productTableRef.value.clearSelection?.()
            } catch (e) {
                // 忽略清除选择时的错误
            }
        }
    }

    // 🟢 走 tabs manager：自动添加到多标签栏并激活
    openTabAPI(String(index))
    // 🟢 通过 Dashboard 快捷链接跳转时，自动展开对应一级分类
    // 移动端选择菜单后自动关闭菜单
    if (isMobile.value) {
        mobileMenuVisible.value = false
    }
    // 懒加载：仅在切换到藏品库且需要时加载
    if (index === '1') {
        try {
            const promo = sessionStorage.getItem('sc_archive_promo_filter')
            if (promo === 'seckill' || promo === 'seckill_expired' || promo === 'group' || promo === 'all') {
                promoFilter.value = promo
                sessionStorage.removeItem('sc_archive_promo_filter')
            }
        } catch (_) { /* ignore */ }
        // 使用nextTick确保组件已挂载后再加载数据
        nextTick(() => {
            // 再次检查是否仍在当前tab
            if (currentTab.value === '1') {
                loadProducts()
            }
        })
    }
}

// 跳转时自动展开所属一级分组（watch 而非 handleMenuSelect：MainTabsBar 点标签不走后者）
// 注意：必须用 TAB_TO_GROUP 求真实存在的 sub-menu index（'grp-*'），
// 之前写死 'sub-miniapp' 在 Element Plus 内部解构 undefined 直接抛 TypeError；
// el-menu 的 default-openeds 只在 setup 读一次，运行时必须调 open() 才有效，
// open() 会触发 @open → handleSubMenuOpen 自动完成 defaultOpeneds 同步与持久化
watch(currentTab, (tab) => {
    if (sidebarCollapsed.value) return // 折叠态没有展开概念
    const targetGroup = TAB_TO_GROUP[tab]
    if (!targetGroup) return
    nextTick(() => {
        try { sideMenuRef.value?.open?.(targetGroup) } catch (e) { /* 菜单未挂载时忽略 */ }
    })
}, { flush: 'post' })

const MOBILE_MQ = typeof window !== 'undefined'
  ? window.matchMedia('(max-width: 768px)')
  : null
const isMobile = ref(MOBILE_MQ?.matches ?? false)

const applyMobileClass = (mobile) => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('is-mobile', mobile)
}

const checkMobile = () => {
  if (!MOBILE_MQ) return
  isMobile.value = MOBILE_MQ.matches
  applyMobileClass(MOBILE_MQ.matches)
  if (import.meta.env.DEV) {
    console.log('移动端检测:', { width: window.innerWidth, isMobile: isMobile.value })
  }
}

const onMobileMqChange = (e) => {
  isMobile.value = e.matches
  applyMobileClass(e.matches)
  if (!e.matches) {
    mobileMenuVisible.value = false
    document.body.style.overflow = ''
  }
}

watch(mobileMenuVisible, (open) => {
  if (typeof document === 'undefined' || !isMobile.value) return
  document.body.style.overflow = open ? 'hidden' : ''
})

if (typeof window !== 'undefined') {
  checkMobile()
}


// --- 手机访问链接功能 ---
const mobileAccessDialogVisible = ref(false)
const accessUrl = ref('')
const qrCanvas = ref(null)
const qrLoading = ref(false)
const copying = ref(false)
const copySuccess = ref(false)

const getLocalIP = async () => {
    // 尝试获取本机IP地址（局域网IP，用于手机访问）
    try {
        // 使用WebRTC API获取本地IP（仅在HTTPS或localhost下可用）
        return new Promise((resolve) => {
            try {
                const RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection
                if (!RTCPeerConnection) {
                    resolve(null)
                    return
                }
                
                const pc = new RTCPeerConnection({ iceServers: [] })
                pc.createDataChannel('')
                let resolved = false
                const localIPs = [] // 收集所有局域网IP
                
                pc.onicecandidate = (e) => {
                    if (e.candidate && !resolved) {
                        const candidate = e.candidate.candidate
                        // 匹配局域网IP（192.168.x.x, 10.x.x.x, 172.16-31.x.x）
                        const match = candidate.match(/((192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)([0-9]{1,3}\.){2}[0-9]{1,3})/)
                        if (match) {
                            const ip = match[1]
                            // 排除127.0.0.1和169.254.x.x（自动分配地址）
                            if (ip !== '127.0.0.1' && !ip.startsWith('169.254.')) {
                                localIPs.push(ip)
                                if (!resolved) {
                                    resolved = true
                                    pc.close()
                                    resolve(ip) // 返回第一个找到的局域网IP
                                    return
                                }
                            }
                        }
                    }
                }
                
                pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {
                    if (!resolved) {
                        resolved = true
                        resolve(null)
                    }
                })
                
                // 超时降级 - 增加到3秒
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true
                        pc.close()
                        if (localIPs.length > 0) {
                            resolve(localIPs[0]) // 如果有收集到的IP，使用第一个
                        } else {
                            resolve(null)
                        }
                    }
                }, 3000)
            } catch (err) {
                resolve(null)
            }
        })
    } catch (e) {
        return null
    }
}

const generateQRCode = (text) => {
    try {
        qrLoading.value = true
        // 使用在线API生成二维码图片，增加尺寸提高清晰度
        const size = 240
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=2`
        
        const canvas = qrCanvas.value
        if (!canvas) {
            console.warn('Canvas element not found')
            qrLoading.value = false
            return
        }
        
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            console.warn('Cannot get 2d context from canvas')
            qrLoading.value = false
            return
        }
        
        canvas.width = size
        canvas.height = size
        
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            try {
                ctx.clearRect(0, 0, size, size)
                // 绘制白色背景
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(0, 0, size, size)
                // 绘制二维码
                ctx.drawImage(img, 0, 0, size, size)
                qrLoading.value = false
            } catch (err) {
                console.error('Error drawing QR code:', err)
                drawErrorText(ctx, size)
                qrLoading.value = false
            }
        }
        img.onerror = () => {
            console.warn('QR code image load failed')
            drawErrorText(ctx, size)
            qrLoading.value = false
        }
        img.src = qrUrl
    } catch (e) {
        console.error('Error generating QR code:', e)
        qrLoading.value = false
    }
}

const drawErrorText = (ctx, size) => {
    try {
        ctx.fillStyle = '#6b665d'
        ctx.font = '14px Arial'
        ctx.textAlign = 'center'
        ctx.fillText('二维码生成失败', size / 2, size / 2 - 10)
        ctx.fillText('请直接复制链接', size / 2, size / 2 + 10)
    } catch (err) {
        console.error('Error drawing error text:', err)
    }
}

const showMobileAccessDialog = async () => {
    try {
        const port = typeof window !== 'undefined' && window.location ? (window.location.port || '5173') : '5173'
        const protocol = typeof window !== 'undefined' && window.location ? window.location.protocol : 'http:'
        const currentHost = typeof window !== 'undefined' && window.location ? window.location.hostname : ''
        
        // 首先尝试使用WebRTC获取IP
        let ip = await getLocalIP()
        
        // 如果WebRTC失败，检查当前hostname
        if (!ip || ip === '127.0.0.1' || ip === 'localhost') {
            // 如果当前hostname是有效的IP地址（不是127.0.0.1或localhost），使用它
            if (currentHost && currentHost !== '127.0.0.1' && currentHost !== 'localhost' && /^\d+\.\d+\.\d+\.\d+$/.test(currentHost)) {
                ip = currentHost
            }
        }
        
        // 构建访问URL
        if (ip && ip !== '127.0.0.1' && ip !== 'localhost') {
            // 成功获取到有效的IP地址
            accessUrl.value = `${protocol}//${ip}:${port}`
        } else {
            // 无法获取IP，使用当前hostname（可能是localhost）
            // 如果是localhost/127.0.0.1，提供提示信息
            if (currentHost === '127.0.0.1' || currentHost === 'localhost' || !currentHost) {
                accessUrl.value = '' // 清空，将在模板中显示提示
            } else {
                accessUrl.value = `${protocol}//${currentHost}:${port}`
            }
        }
        
        // 显示对话框
        mobileAccessDialogVisible.value = true
    } catch (e) {
        console.error('获取访问地址失败:', e)
        accessUrl.value = ''
        mobileAccessDialogVisible.value = true
        qrLoading.value = false
    }
}

// 对话框打开后的回调
const onDialogOpened = async () => {
    // 等待DOM更新后生成二维码
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 只有在有有效URL时才生成二维码
    if (accessUrl.value && accessUrl.value.startsWith('http')) {
        if (qrCanvas.value) {
            generateQRCode(accessUrl.value)
        } else {
            // 如果canvas还没准备好，再等一下
            setTimeout(() => {
                if (qrCanvas.value) {
                    generateQRCode(accessUrl.value)
                }
            }, 300)
        }
    }
}

const copyAccessUrl = async () => {
    if (!accessUrl.value) return
    
    copying.value = true
    copySuccess.value = false
    
    try {
        await navigator.clipboard.writeText(accessUrl.value)
        copySuccess.value = true
        ElMessage.success('链接已复制到剪贴板')
        
        // 3秒后隐藏成功提示
        setTimeout(() => {
            copySuccess.value = false
        }, 3000)
    } catch (e) {
        // 降级方案：使用传统方法
        const textArea = document.createElement('textarea')
        textArea.value = accessUrl.value
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.select()
        textArea.setSelectionRange(0, 99999) // 移动端兼容
        try {
            const success = document.execCommand('copy')
            if (success) {
                copySuccess.value = true
                ElMessage.success('链接已复制到剪贴板')
                setTimeout(() => {
                    copySuccess.value = false
                }, 3000)
            } else {
                ElMessage.error('复制失败，请手动复制')
            }
        } catch (err) {
            ElMessage.error('复制失败，请手动复制')
        }
        document.body.removeChild(textArea)
    } finally {
        copying.value = false
    }
}

// =================================================
// 📦 藏品管理逻辑 (Tab 1 核心功能)
// =================================================

const loadProducts = async () => {
    if (!isLoggedIn.value) return
    loading.value = true
    try {
        const rows = await fetchCollectionSorted(COLLECTIONS.PRODUCTS, {
            limit: 200,
            throwOnError: true,
            sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
        })

        if (!Array.isArray(rows)) {
            console.warn('商品数据格式异常:', rows)
            products.value = []
            return
        }

        const list = await Promise.all(rows.map(async (item) => {
            try {
                let img = ''
                if (item && item.images && Array.isArray(item.images) && item.images.length > 0) {
                    try {
                        img = await getTempFileUrl(item.images[0])
                    } catch (imgErr) {
                        console.warn('图片加载失败:', imgErr)
                        img = ''
                    }
                }
                return { 
                    ...item, 
                    httpImage: img, 
                    isOnShelf: !item.isOffShelf 
                }
            } catch (itemErr) {
                console.error('处理商品项失败:', itemErr, item)
                return null
            }
        }))
        
        // 过滤掉null项
        products.value = list.filter(item => item !== null)
    } catch (err) {
        console.error('加载商品失败', err)
        ElMessage.error('查询藏品档案失败: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

const toggleShelf = async (row) => {
    try {
        await cdnUpdate(COLLECTIONS.PRODUCTS, row._id, {
            isOffShelf: !row.isOnShelf,
            updateTime: Date.now()
        })
        ElMessage.success(row.isOnShelf ? '商品已上架' : '商品已下架')
    } catch (err) { 
        row.isOnShelf = !row.isOnShelf // 回滚
        console.error('状态更新失败', err)
        ElMessage.error('状态更新失败: ' + (err.message || '未知错误'))
    }
}

// 商品批量操作
const handleProductSelectionChange = (selection) => {
    if (Array.isArray(selection)) {
        selectedProducts.value = selection
    } else {
        selectedProducts.value = []
    }
}

// 档案 + 营销筛选后的列表（用于表格展示）
const displayProducts = computed(() => {
    let list = products.value || []
    if (archiveFilter.value === 'archive') {
        list = list.filter(p => p.inArchive === true)
    } else if (archiveFilter.value === 'oneOfAKind') {
        list = list.filter(p => p.isOneOfAKind === true)
    }
    if (promoFilter.value === 'seckill') {
        list = list.filter(p => p.seckill?.enabled && !isSeckillExpired(p))
    } else if (promoFilter.value === 'seckill_expired') {
        list = list.filter(p => p.seckill?.enabled && isSeckillExpired(p))
    } else if (promoFilter.value === 'group') {
        list = list.filter(p => p.groupBuying?.enabled)
    }
    return list
})

const isSeckillExpired = (row) => {
    if (!row?.seckill?.enabled) return false
    const end = row.seckill.endTime ? Number(row.seckill.endTime) : null
    return !!(end && end < Date.now())
}

const expiredSeckillCount = computed(() =>
    (products.value || []).filter((p) => isSeckillExpired(p)).length
)

const formatPromoTime = (ts) => {
    if (!ts) return ''
    const d = new Date(typeof ts === 'number' ? ts : Number(ts))
    if (Number.isNaN(d.getTime())) return ''
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${m}-${day} ${h}:${min}`
}

// 将选中重要SKU加入藏品档案
const handleAddToArchive = async () => {
    if (!selectedProducts.value || selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择要加入档案的商品')
        return
    }
    try {
        loading.value = true
        const promises = selectedProducts.value.map(p =>
            cdnUpdate(COLLECTIONS.PRODUCTS, p._id, {
                inArchive: true,
                updateTime: Date.now()
            })
        )
        await Promise.all(promises)
        ElMessage.success(`已将 ${selectedProducts.value.length} 个重要SKU加入藏品档案`)
        clearProductSelection()
        loadProducts()
    } catch (err) {
        console.error('加入档案失败:', err)
        ElMessage.error('加入档案失败: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

const clearProductSelection = () => {
    selectedProducts.value = []
    // 使用nextTick确保DOM更新后再清除选择
    nextTick(() => {
        if (productTableRef.value && typeof productTableRef.value.clearSelection === 'function') {
            try {
                productTableRef.value.clearSelection()
            } catch (err) {
                console.warn('清除选择失败:', err)
            }
        }
    })
}

// 批量上下架
const handleBatchToggleShelf = async (isOnShelf) => {
    if (selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择商品')
        return
    }

    const action = isOnShelf ? '上架' : '下架'
    ElMessageBox.confirm(
        `确认批量${action} ${selectedProducts.value.length} 个商品吗？`,
        `批量${action}确认`,
        {
            confirmButtonText: `确认${action}`,
            cancelButtonText: '取消',
            type: 'warning'
        }
    ).then(async () => {
        try {
            loading.value = true
            const promises = selectedProducts.value.map(product =>
                cdnUpdate(COLLECTIONS.PRODUCTS, product._id, {
                    isOffShelf: !isOnShelf,
                    updateTime: Date.now()
                })
            )

            await Promise.all(promises)
            ElMessage.success(`成功${action} ${selectedProducts.value.length} 个商品`)
            clearProductSelection()
            loadProducts()
        } catch (err) {
            console.error(`批量${action}失败:`, err)
            ElMessage.error(`批量${action}失败: ${err.message || '未知错误'}`)
        } finally {
            loading.value = false
        }
    }).catch(() => {})
}

/** 批量关闭秒杀 / 拼团（保留历史字段，仅 enabled=false） */
const handleBatchTogglePromo = async (kind, enabled) => {
    if (!selectedProducts.value?.length) {
        ElMessage.warning('请先选择商品')
        return
    }
    const label = kind === 'seckill' ? '秒杀' : '拼团'
    const targets = selectedProducts.value.filter((p) => {
        if (!p) return false
        if (kind === 'seckill') return !!p.seckill?.enabled
        return !!p.groupBuying?.enabled
    })
    if (!targets.length) {
        ElMessage.warning(`所选商品中没有已开启的${label}`)
        return
    }
    try {
        await ElMessageBox.confirm(
            `确认批量关闭 ${targets.length} 个商品的${label}？`,
            `批量关${label}`,
            { type: 'warning' }
        )
    } catch {
        return
    }
    try {
        loading.value = true
        await Promise.all(targets.map((p) => {
            if (kind === 'seckill') {
                const next = { ...(p.seckill || {}), enabled: !!enabled }
                return cdnUpdate(COLLECTIONS.PRODUCTS, p._id, { seckill: next, updateTime: Date.now() })
            }
            const next = { ...(p.groupBuying || {}), enabled: !!enabled }
            return cdnUpdate(COLLECTIONS.PRODUCTS, p._id, { groupBuying: next, updateTime: Date.now() })
        }))
        ElMessage.success(`已关闭 ${targets.length} 个商品的${label}`)
        clearProductSelection()
        loadProducts()
    } catch (err) {
        console.error(`批量关${label}失败:`, err)
        ElMessage.error(`批量关${label}失败: ${err.message || '未知错误'}`)
    } finally {
        loading.value = false
    }
}

/** 批量延长已开秒杀的 endTime（+3 天；无 endTime 则从现在起算） */
const handleBatchExtendSeckill = async () => {
    if (!selectedProducts.value?.length) {
        ElMessage.warning('请先选择商品')
        return
    }
    const targets = selectedProducts.value.filter((p) => p?.seckill?.enabled)
    if (!targets.length) {
        ElMessage.warning('所选商品中没有已开启的秒杀')
        return
    }
    const DAY = 3 * 24 * 60 * 60 * 1000
    try {
        await ElMessageBox.confirm(
            `将为 ${targets.length} 个商品的秒杀结束时间延长 3 天（在现有 endTime 或当前时刻基础上）。`,
            '批量延长秒杀',
            { type: 'info' }
        )
    } catch {
        return
    }
    try {
        loading.value = true
        const now = Date.now()
        await Promise.all(targets.map((p) => {
            const cur = Number(p.seckill?.endTime) || 0
            const base = cur > now ? cur : now
            const next = { ...(p.seckill || {}), enabled: true, endTime: base + DAY }
            return cdnUpdate(COLLECTIONS.PRODUCTS, p._id, { seckill: next, updateTime: Date.now() })
        }))
        ElMessage.success(`已延长 ${targets.length} 个商品的秒杀结束时间`)
        clearProductSelection()
        loadProducts()
    } catch (err) {
        console.error('批量延长秒杀失败:', err)
        ElMessage.error('批量延长秒杀失败: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

/** 一键关闭所有已过期但仍 enabled 的秒杀（不改价，仅 enabled=false） */
const handleClearExpiredSeckill = async () => {
    const targets = (products.value || []).filter((p) => isSeckillExpired(p))
    if (!targets.length) {
        ElMessage.info('当前没有过期秒杀')
        return
    }
    try {
        await ElMessageBox.confirm(
            `将关闭 ${targets.length} 个「已过期但仍开启」的秒杀标记（保留历史价格字段）。`,
            '清理过期秒杀',
            { type: 'warning' }
        )
    } catch {
        return
    }
    try {
        loading.value = true
        await Promise.all(targets.map((p) => {
            const next = { ...(p.seckill || {}), enabled: false }
            return cdnUpdate(COLLECTIONS.PRODUCTS, p._id, { seckill: next, updateTime: Date.now() })
        }))
        ElMessage.success(`已清理 ${targets.length} 个过期秒杀`)
        clearProductSelection()
        loadProducts()
    } catch (err) {
        console.error('清理过期秒杀失败:', err)
        ElMessage.error('清理过期秒杀失败: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

// 批量调价
const handleBatchPrice = async () => {
    if (selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择商品')
        return
    }

    // 过滤有效商品
    const validProducts = selectedProducts.value.filter(p => p && p._id)
    if (validProducts.length === 0) {
        ElMessage.warning('没有有效的商品可操作')
        return
    }

    if (batchPriceForm.value.type !== 'discount' && (!batchPriceForm.value.value || batchPriceForm.value.value <= 0)) {
        ElMessage.warning('请输入有效的价格')
        return
    }

    if (batchPriceForm.value.type === 'discount' && (!batchPriceForm.value.discount || batchPriceForm.value.discount <= 0 || batchPriceForm.value.discount > 100)) {
        ElMessage.warning('请输入有效的折扣（1-100）')
        return
    }

    ElMessageBox.confirm(
        `确认批量调整 ${validProducts.length} 个商品的价格吗？`,
        '批量调价确认',
        {
            confirmButtonText: '确认调整',
            cancelButtonText: '取消',
            type: 'warning'
        }
    ).then(async () => {
        try {
            loading.value = true
            const promises = validProducts.map(product => {
                if (!product || !product._id) return Promise.resolve()
                
                let newPrice = product.price || 0
                if (batchPriceForm.value.type === 'set') {
                    newPrice = batchPriceForm.value.value
                } else if (batchPriceForm.value.type === 'add') {
                    newPrice = (product.price || 0) + batchPriceForm.value.value
                } else if (batchPriceForm.value.type === 'discount') {
                    newPrice = Math.round((product.price || 0) * (batchPriceForm.value.discount / 100) * 100) / 100
                }

                return cdnUpdate(COLLECTIONS.PRODUCTS, product._id, {
                    price: Math.max(0, newPrice),
                    updateTime: Date.now()
                }).catch(err => {
                    console.error(`商品${product._id}调价失败:`, err)
                    return null
                })
            })

            const results = await Promise.all(promises)
            const successCount = results.filter(r => r !== null).length
            ElMessage.success(`成功调整 ${successCount} 个商品价格`)
            showBatchPriceDialog.value = false
            batchPriceForm.value = { type: 'set', value: 0, discount: 0 }
            clearProductSelection()
            // 只在当前tab时刷新
            if (currentTab.value === '1') {
                loadProducts()
            }
        } catch (err) {
            console.error('批量调价失败:', err)
            ElMessage.error(`批量调价失败: ${err.message || '未知错误'}`)
        } finally {
            loading.value = false
        }
    }).catch(() => {})
}

// 批量调库存
const handleBatchStock = async () => {
    if (selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择商品')
        return
    }

    if (!batchStockForm.value.value || batchStockForm.value.value < 0) {
        ElMessage.warning('请输入有效的库存数量')
        return
    }

    ElMessageBox.confirm(
        `确认批量调整 ${selectedProducts.value.length} 个商品的库存吗？`,
        '批量调库存确认',
        {
            confirmButtonText: '确认调整',
            cancelButtonText: '取消',
            type: 'warning'
        }
    ).then(async () => {
        try {
            loading.value = true
            const promises = selectedProducts.value.map(product => {
                let newStock = product.stock || 0
                if (batchStockForm.value.type === 'set') {
                    newStock = batchStockForm.value.value
                } else if (batchStockForm.value.type === 'add') {
                    newStock = (product.stock || 0) + batchStockForm.value.value
                } else if (batchStockForm.value.type === 'subtract') {
                    newStock = Math.max(0, (product.stock || 0) - batchStockForm.value.value)
                }

                return cdnUpdate(COLLECTIONS.PRODUCTS, product._id, {
                    stock: Math.max(0, newStock),
                    updateTime: Date.now()
                })
            })

            await Promise.all(promises)
            ElMessage.success(`成功调整 ${selectedProducts.value.length} 个商品库存`)
            showBatchStockDialog.value = false
            batchStockForm.value = { type: 'set', value: 0 }
            clearProductSelection()
            loadProducts()
        } catch (err) {
            console.error('批量调库存失败:', err)
            ElMessage.error(`批量调库存失败: ${err.message || '未知错误'}`)
        } finally {
            loading.value = false
        }
    }).catch(() => {})
}

// 批量导出商品
const handleBatchExport = () => {
    const exportProducts = selectedProducts.value.length > 0 
        ? selectedProducts.value.filter(p => p && p._id)
        : products.value.filter(p => p && p._id)
    
    if (exportProducts.length === 0) {
        ElMessage.warning('没有可导出的商品')
        return
    }

    try {
        const exportData = exportProducts.map(product => ({
            商品名称: product.title || '',
            分类: product.category || '',
            售价: `¥${product.price || 0}`,
            成本价: `¥${product.costPrice || 0}`,
            库存: product.stock || 0,
            上架状态: product.isOnShelf ? '上架' : '下架',
            孤品: product.isOneOfAKind ? '是' : '否',
            拉丁学名: product.latinName || '',
            描述: (product.description || '').substring(0, 100),
            创建时间: product.createTime ? new Date(product.createTime).toLocaleString() : ''
        }))

        if (exportData.length === 0) {
            ElMessage.warning('没有有效的商品数据可导出')
            return
        }

        const headers = Object.keys(exportData[0])
        const csvContent = [
            headers.join(','),
            ...exportData.map(row => 
                headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(',')
            )
        ].join('\n')

        const BOM = '\uFEFF'
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', `商品导出_${new Date().toISOString().split('T')[0]}.csv`)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        
        ElMessage.success(`已导出 ${exportProducts.length} 个商品`)
        if (selectedProducts.value.length > 0) {
            clearProductSelection()
        }
    } catch (err) {
        console.error('导出失败:', err)
        ElMessage.error('导出失败: ' + (err.message || '未知错误'))
    }
}

const loadCategoriesForProduct = async () => {
    try {
        const roots = await fetchCollectionSorted(COLLECTIONS.CATEGORIES, {
            limit: 500,
            where: { level: 1 },
            sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
        })
        const subs = await fetchCollectionSorted(COLLECTIONS.CATEGORIES, {
            limit: 500,
            where: { level: 2 },
            sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
        })
        const flat = {}
        roots.forEach((r) => { flat[r._id] = r })
        subs.forEach((s) => { flat[s._id] = s })
        categoryFlatMap.value = flat
        categoryCascaderOptions.value = roots.map((r) => ({
            value: r._id,
            label: r.name,
            children: subs
                .filter((s) => s.parentId === r._id && s.active !== false)
                .map((s) => ({ value: s._id, label: s.name }))
        }))
    } catch (e) {
        console.warn('加载分类树失败', e)
        categoryCascaderOptions.value = []
    }
}

const loadFramersForProduct = async () => {
    try {
        const rows = await fetchCollectionSorted(COLLECTIONS.FRAMERS, {
            limit: 200,
            sortFn: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh')
        })
        framerOptions.value = rows || []
    } catch (e) {
        console.warn('加载装裱师失败', e)
        framerOptions.value = []
    }
}

const onProtectionTypeChange = (val) => {
    if (!val || val === 'none') {
        form.value.collectionCertificate = ''
    }
}

const onFramerChange = (id) => {
    if (!id) {
        form.value.framerId = null
        form.value.framerName = 'NATURE'
        return
    }
    const hit = framerOptions.value.find((f) => f._id === id)
    form.value.framerId = id
    form.value.framerName = hit?.name || 'NATURE'
}

const blankProductForm = () => ({
    title: '', price: 0, costPrice: 0, stock: 1, category: '',
    categoryId: '', rootCategoryId: '', rootCategoryName: '', categoryType: '', categoryPath: [],
    channel: '', craftType: '',
    latinName: '', description: '', isTreasure: false, isOneOfAKind: true, inArchive: true, memberDiscountEnabled: true,
    supportsCustom: true,
    protectionType: 'none', collectionCertificate: '',
    origin: '', collectDate: '', framerName: 'NATURE', framerId: null,
    sizeL: '', sizeW: '', sizeH: '',
    taxonomy: emptyTaxonomy(),
    images: [], imagePreviews: [],
    detailImages: [], detailImagePreviews: [],
    detailHtml: '',
    hasSku: false, skus: [], skuDimensionsStr: '',
    seckillEnabled: false, seckillPrice: 0, seckillStock: 0, seckillStartTime: null, seckillEndTime: null, seckillLimitPerUser: 1,
    groupBuyingEnabled: false, groupBuyingPrice: 0, groupBuyingSize: 2
})

const syncOneOfAKindFromStock = (stockVal) => {
    const n = Number(stockVal)
    if (n === 1) {
        if (!oneOfAKindManualOff.value) form.value.isOneOfAKind = true
    } else if (Number.isFinite(n) && n > 1) {
        form.value.isOneOfAKind = false
        oneOfAKindManualOff.value = false
    }
}

const onStockChange = (val) => {
    syncOneOfAKindFromStock(val)
}

const onOneOfAKindChange = (val) => {
    if (!val && Number(form.value.stock) === 1) {
        oneOfAKindManualOff.value = true
    } else if (val) {
        oneOfAKindManualOff.value = false
    }
}

/** 将 AI 分类建议落到 cascader / 表单字段（不触发自动拉丁识别） */
const applyCategorySuggestion = (cat) => {
    if (!cat || !cat.rootCategoryId) return false
    const path = cat.categoryId ? [cat.rootCategoryId, cat.categoryId] : [cat.rootCategoryId]
    form.value.categoryPath = path
    form.value.rootCategoryId = cat.rootCategoryId
    form.value.rootCategoryName = cat.rootCategoryName || ''
    form.value.categoryId = cat.categoryId || ''
    form.value.category = cat.category || cat.rootCategoryName || ''
    form.value.categoryType = cat.categoryType || ''

    const blob = [form.value.rootCategoryName, form.value.category].filter(Boolean).join(' ')
    if (!/蝴蝶|鳞翅|蝶|昆虫/.test(blob)) form.value.channel = ''
    if (!/昆虫|植物|海洋|蝴蝶|鳞翅/.test(blob)) form.value.craftType = ''
    return true
}

/** 将 assistProductCopy 返回写入表单；fillAll 时覆盖分类/保护物种等 */
const applyAssistProductCopyResult = (d, { force = false, fillCategory = false } = {}) => {
    const f = form.value || {}
    const latinName = String(d.latinName || '').trim()
    if (!isMerchandiseProduct(f) && !latinName && !fillCategory) {
        throw new Error('未能识别拉丁学名，请补充更具体的名称或分类后重试')
    }
    if (latinName) form.value.latinName = latinName

    if (d.description && (force || !String(form.value.description || '').trim())) {
        form.value.description = String(d.description).trim()
    }

    if (fillCategory && d.category) {
        applyCategorySuggestion(d.category)
    }

    if (fillCategory && d.protectionType) {
        const pt = String(d.protectionType).trim()
        if (['none', 'sanyou', 'protected_plant', 'protected_animal'].includes(pt)) {
            form.value.protectionType = pt
            if (pt === 'none') form.value.collectionCertificate = ''
        }
    }

    const tax = d.taxonomy || {}
    const prevTax = form.value.taxonomy || emptyTaxonomy()
    form.value.taxonomy = {
        kingdom: tax.kingdom || prevTax.kingdom || '',
        phylum: tax.phylum || prevTax.phylum || '',
        class: tax.class || prevTax.class || '',
        order: tax.order || prevTax.order || '',
        family: tax.family || prevTax.family || '',
        genus: tax.genus || prevTax.genus || '',
    }
    return latinName
}

const onCategoryPathChange = (path) => {
    if (!path || !path.length) {
        form.value.category = ''
        form.value.categoryId = ''
        form.value.rootCategoryId = ''
        form.value.rootCategoryName = ''
        form.value.categoryType = ''
        form.value.channel = ''
        form.value.craftType = ''
        return
    }
    const rootId = path[0]
    const subId = path[1] || ''
    const root = categoryFlatMap.value[rootId]
    const sub = subId ? categoryFlatMap.value[subId] : null
    form.value.rootCategoryId = rootId
    form.value.rootCategoryName = (root && root.name) || ''
    form.value.categoryId = subId
    form.value.category = (sub && sub.name) || form.value.rootCategoryName
    form.value.categoryType = (sub && sub.categoryType) || (root && root.categoryType) || ''

    // 切换分类后清理不适用维度，避免脏数据写入
    const blob = [form.value.rootCategoryName, form.value.category].filter(Boolean).join(' ')
    if (!/蝴蝶|鳞翅|蝶|昆虫/.test(blob)) form.value.channel = ''
    if (!/昆虫|植物|海洋|蝴蝶|鳞翅/.test(blob)) form.value.craftType = ''

    // 与店长端一致：二级分类带 taxonomy 时预填科学分类
    const tax = (sub && sub.taxonomy) || (root && root.taxonomy) || null
    if (tax && typeof tax === 'object') {
        form.value.taxonomy = {
            kingdom: tax.kingdom || '',
            phylum: tax.phylum || '',
            class: tax.class || '',
            order: tax.order || '',
            family: tax.family || '',
            genus: tax.genus || ''
        }
    }

    // 选完分类且已有名称、拉丁名为空时，自动识别（与失焦互补）
    if (
        !isMerchandiseProduct(form.value) &&
        String(form.value.title || '').trim() &&
        !String(form.value.latinName || '').trim()
    ) {
        assistProductLatin({ force: false, quiet: true })
    }
}

/** 复用店长端 assistProductCopy：拉丁学名 + 描述 + taxonomy（需已有分类时自动/失焦） */
const assistProductLatin = async ({ force = false, quiet = false } = {}) => {
    const f = form.value || {}
    const title = String(f.title || '').trim()
    if (!title) {
        if (!quiet) ElMessage.warning('请先填写藏品名称')
        return
    }
    if (!isMerchandiseProduct(f) && !f.category && !f.rootCategoryName) {
        if (!quiet) ElMessage.warning('请先选择所属分类，或使用「一键补齐」')
        return
    }
    if (!force && String(f.latinName || '').trim()) return
    if (latinAiLoading.value || productAiFillLoading.value) return

    latinAiLoading.value = true
    try {
        const res = await callCloudFunction('assistProductCopy', {
            title,
            category: f.category || '',
            rootCategory: f.rootCategoryName || '',
            origin: f.origin || '',
        })
        if (!res || res.success === false) {
            throw new Error((res && res.msg) || '识别失败')
        }
        const latinName = applyAssistProductCopyResult(res.data || {}, { force, fillCategory: false })
        ElMessage.success(latinName ? '已识别拉丁学名' : '描述已补全')
    } catch (e) {
        console.error('assistProductLatin', e)
        if (!quiet) {
            ElMessage.error(e.message || 'AI 识别失败')
        } else {
            ElMessage.warning(e.message || '自动识别未完成，可点「一键补齐」或「AI 识别」重试')
        }
    } finally {
        latinAiLoading.value = false
    }
}

/** 一键补齐：仅需藏品名称；补分类 / 描述 / 保护物种 / taxonomy / latinName */
const assistProductFillAll = async () => {
    const f = form.value || {}
    const title = String(f.title || '').trim()
    if (!title) {
        ElMessage.warning('请先填写藏品名称')
        return
    }
    if (productAiFillLoading.value || latinAiLoading.value) return

    productAiFillLoading.value = true
    try {
        const res = await callCloudFunction('assistProductCopy', {
            title,
            category: f.category || '',
            rootCategory: f.rootCategoryName || '',
            origin: f.origin || '',
        })
        if (!res || res.success === false) {
            throw new Error((res && res.msg) || '补齐失败')
        }
        const d = res.data || {}
        const latinName = applyAssistProductCopyResult(d, { force: true, fillCategory: true })
        if (!isMerchandiseProduct(form.value) && !latinName) {
            throw new Error('未能补全拉丁学名，请核对名称后重试')
        }
        const parts = []
        if (d.category?.rootCategoryName) {
            parts.push(d.category.categoryId
                ? `${d.category.rootCategoryName} / ${d.category.category}`
                : d.category.rootCategoryName)
        }
        if (latinName) parts.push('学名')
        if (d.description) parts.push('描述')
        if (d.protectionType && d.protectionType !== 'none') parts.push('保护物种')
        if (d.taxonomy && Object.values(d.taxonomy).some(Boolean)) parts.push('科学分类')
        ElMessage.success(parts.length ? `已补齐：${parts.join('、')}` : '补齐完成，请核对')
    } catch (e) {
        console.error('assistProductFillAll', e)
        ElMessage.error(e.message || '一键补齐失败')
    } finally {
        productAiFillLoading.value = false
    }
}

const onProductTitleBlur = () => {
    if (isMerchandiseProduct(form.value)) return
    if (String(form.value.latinName || '').trim()) return
    if (!String(form.value.title || '').trim()) return
    if (!form.value.category && !form.value.rootCategoryName) return
    assistProductLatin({ force: false, quiet: true })
}

const resolveCategoryPath = (row) => {
    if (!row) return []
    if (row.rootCategoryId && row.categoryId) return [row.rootCategoryId, row.categoryId]
    if (row.rootCategoryId) return [row.rootCategoryId]
    if (row.categoryId) {
        const sub = categoryFlatMap.value[row.categoryId]
        if (sub && sub.parentId) return [sub.parentId, row.categoryId]
        return [row.categoryId]
    }
    // 兼容仅写了中文 category 名：尝试在子分类中匹配
    if (row.category) {
        const hit = Object.values(categoryFlatMap.value).find(
            (c) => c.level === 2 && c.name === row.category
        )
        if (hit) return [hit.parentId, hit._id]
        const rootHit = Object.values(categoryFlatMap.value).find(
            (c) => c.level === 1 && c.name === row.category
        )
        if (rootHit) return [rootHit._id]
    }
    return []
}

const openDialog = async () => { 
    isEditing.value = false 
    oneOfAKindManualOff.value = false
    await Promise.all([loadCategoriesForProduct(), loadFramersForProduct()])
    form.value = blankProductForm()
    dialogVisible.value = true 
}

const editItem = async (row) => { 
    isEditing.value = true 
    oneOfAKindManualOff.value = false
    await Promise.all([loadCategoriesForProduct(), loadFramersForProduct()])
    const path = resolveCategoryPath(row)
    const images = Array.isArray(row.images) ? [...row.images].filter(Boolean) : []
    const detailImages = Array.isArray(row.detailImages) ? [...row.detailImages].filter(Boolean) : []
    const rawSkus = Array.isArray(row.skus) ? row.skus.filter((s) => s && s.id) : []
    const skus = await Promise.all(rawSkus.map(async (s) => {
        const skuImages = Array.isArray(s.images) && s.images.length
            ? s.images.filter(Boolean)
            : (s.image ? [s.image] : [])
        const imagePreviews = skuImages.length ? await getTempFileUrls(skuImages) : []
        return {
            id: s.id,
            specLabel: s.specLabel || '',
            sku: s.sku || s.skuCode || '',
            price: parseFloat(s.price) || 0,
            stock: parseInt(s.stock, 10) || 0,
            images: skuImages,
            imagePreviews,
            specs: s.specs || null,
        }
    }))
    const [imagePreviews, detailImagePreviews] = await Promise.all([
        getTempFileUrls(images),
        getTempFileUrls(detailImages),
    ])
    const sizeParts = parseProductSize(row.size)
    const tax = row.taxonomy || {}
    form.value = { 
        ...row,
        costPrice: row.costPrice || 0,
        categoryId: row.categoryId || '',
        rootCategoryId: row.rootCategoryId || '',
        rootCategoryName: row.rootCategoryName || '',
        categoryType: row.categoryType || '',
        categoryPath: path,
        channel: row.channel || '',
        craftType: row.craftType || '',
        latinName: row.latinName || '',
        description: row.description || '',
        images,
        imagePreviews,
        detailImages,
        detailImagePreviews,
        detailHtml: row.detailHtml || '',
        hasSku: !!(row.hasSku && skus.length),
        skus,
        skuDimensionsStr: Array.isArray(row.skuDimensions) ? row.skuDimensions.join(',') : '',
        isTreasure: row.isTreasure || false,
        isOneOfAKind: row.isOneOfAKind || false,
        inArchive: row.inArchive || false,
        memberDiscountEnabled: row.memberDiscountEnabled !== false,
        supportsCustom: row.supportsCustom !== false,
        protectionType: row.protectionType || 'none',
        collectionCertificate: row.collectionCertificate || '',
        origin: row.origin || '',
        collectDate: row.collectDate || '',
        framerName: row.framerName || 'NATURE',
        framerId: row.framerId || null,
        sizeL: sizeParts.sizeL,
        sizeW: sizeParts.sizeW,
        sizeH: sizeParts.sizeH,
        taxonomy: {
            kingdom: tax.kingdom || '',
            phylum: tax.phylum || '',
            class: tax.class || '',
            order: tax.order || '',
            family: tax.family || '',
            genus: tax.genus || ''
        },
        seckillEnabled: row.seckill && row.seckill.enabled || false,
        seckillPrice: row.seckill && row.seckill.price || 0,
        seckillStock: row.seckill && row.seckill.stock || 0,
        seckillStartTime: row.seckill && row.seckill.startTime ? new Date(row.seckill.startTime) : null,
        seckillEndTime: row.seckill && row.seckill.endTime ? new Date(row.seckill.endTime) : null,
        seckillLimitPerUser: row.seckill && row.seckill.limitPerUser || 1,
        groupBuyingEnabled: row.groupBuying && row.groupBuying.enabled || false,
        groupBuyingPrice: row.groupBuying && row.groupBuying.price || 0,
        groupBuyingSize: row.groupBuying && row.groupBuying.groupSize || 2
    }
    const stockN = parseInt(row.stock, 10) || 0
    oneOfAKindManualOff.value = stockN === 1 && !row.isOneOfAKind
    dialogVisible.value = true 
}

const refreshImagePreviews = async () => {
    form.value.imagePreviews = await getTempFileUrls(form.value.images || [])
}
const refreshDetailImagePreviews = async () => {
    form.value.detailImagePreviews = await getTempFileUrls(form.value.detailImages || [])
}

const makeSkuId = () => `sku_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

const createEmptySkuRow = () => ({
    id: makeSkuId(),
    specLabel: '',
    sku: '',
    price: form.value.price || 0,
    stock: 1,
    images: [],
    imagePreviews: [],
    specs: null,
})

const onHasSkuChange = (enabled) => {
    if (enabled && (!form.value.skus || !form.value.skus.length)) {
        form.value.skus = [createEmptySkuRow()]
    }
    if (!enabled) {
        form.value.skus = []
        form.value.skuDimensionsStr = ''
    }
}

const addSkuRow = () => {
    form.value.skus = [...(form.value.skus || []), createEmptySkuRow()]
}

const removeSkuRow = (idx) => {
    const next = [...(form.value.skus || [])]
    next.splice(idx, 1)
    form.value.skus = next
    if (!next.length) {
        form.value.hasSku = false
        form.value.skuDimensionsStr = ''
    }
}

const refreshSkuImagePreviews = async (skuIdx) => {
    const sku = form.value.skus?.[skuIdx]
    if (!sku) return
    sku.imagePreviews = await getTempFileUrls(sku.images || [])
}

const PRODUCT_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])
const PRODUCT_IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i

/** 拖拽时 accept 未必可靠，统一校验图片类型 */
const beforeProductImageUpload = (file) => {
    const type = String(file?.type || '').toLowerCase()
    const name = String(file?.name || '')
    if (PRODUCT_IMAGE_MIME.has(type) || PRODUCT_IMAGE_EXT.test(name)) return true
    if (type.startsWith('image/') && (!name.includes('.') || PRODUCT_IMAGE_EXT.test(name))) return true
    ElMessage.error('仅支持 JPG / PNG / WebP / GIF 图片')
    return false
}

const uploadSkuImage = async (skuIdx, opt) => {
    const sku = form.value.skus?.[skuIdx]
    if (!sku) return
    productMediaUploading.value = true
    try {
        const fileID = await uploadAdminBinary(opt.file, 'products')
        sku.images = [...(sku.images || []), fileID]
        await refreshSkuImagePreviews(skuIdx)
        ElMessage.success('规格图已上传')
    } catch (e) {
        ElMessage.error('上传失败: ' + (e.message || '未知错误'))
    } finally {
        productMediaUploading.value = false
    }
}

const removeSkuImage = async (skuIdx, imgIdx) => {
    const sku = form.value.skus?.[skuIdx]
    if (!sku) return
    const imgs = [...(sku.images || [])]
    imgs.splice(imgIdx, 1)
    sku.images = imgs
    await refreshSkuImagePreviews(skuIdx)
}

const setSkuCoverImage = async (skuIdx, imgIdx) => {
    if (imgIdx <= 0) return
    const sku = form.value.skus?.[skuIdx]
    if (!sku) return
    const imgs = [...(sku.images || [])]
    const [picked] = imgs.splice(imgIdx, 1)
    imgs.unshift(picked)
    sku.images = imgs
    await refreshSkuImagePreviews(skuIdx)
}

const buildSkusForSave = () => {
    const dims = String(form.value.skuDimensionsStr || '')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)

    const skus = (form.value.skus || [])
        .filter((s) => s && String(s.specLabel || '').trim())
        .map((s, i) => {
            const specLabel = String(s.specLabel).trim()
            let specs = s.specs && typeof s.specs === 'object' ? { ...s.specs } : null
            if (dims.length && specLabel.includes('/')) {
                const parts = specLabel.split('/').map((x) => x.trim())
                specs = {}
                dims.forEach((dim, idx) => {
                    specs[dim] = parts[idx] || parts[parts.length - 1] || ''
                })
            } else if (dims.length === 1) {
                specs = { [dims[0]]: specLabel }
            }
            const images = Array.isArray(s.images) ? s.images.filter(Boolean) : []
            return {
                id: s.id || makeSkuId() + '_' + i,
                specLabel,
                sku: String(s.sku || '').trim(),
                specs: specs || {},
                price: parseFloat(s.price) || 0,
                stock: parseInt(s.stock, 10) || 0,
                image: images[0] || '',
                images,
            }
        })

    return { skus, skuDimensions: dims }
}

const uploadProductImage = async (opt) => {
    productMediaUploading.value = true
    try {
        const fileID = await uploadAdminBinary(opt.file, 'products')
        form.value.images = [...(form.value.images || []), fileID]
        await refreshImagePreviews()
        ElMessage.success('轮播图已上传')
    } catch (e) {
        ElMessage.error('上传失败: ' + (e.message || '未知错误'))
    } finally {
        productMediaUploading.value = false
    }
}

const uploadDetailImage = async (opt) => {
    productMediaUploading.value = true
    try {
        const fileID = await uploadAdminBinary(opt.file, 'products')
        form.value.detailImages = [...(form.value.detailImages || []), fileID]
        await refreshDetailImagePreviews()
        ElMessage.success('详情图已上传')
    } catch (e) {
        ElMessage.error('上传失败: ' + (e.message || '未知错误'))
    } finally {
        productMediaUploading.value = false
    }
}

const removeProductImage = async (idx) => {
    const imgs = [...(form.value.images || [])]
    imgs.splice(idx, 1)
    form.value.images = imgs
    await refreshImagePreviews()
}

const removeDetailImage = async (idx) => {
    const imgs = [...(form.value.detailImages || [])]
    imgs.splice(idx, 1)
    form.value.detailImages = imgs
    await refreshDetailImagePreviews()
}

const setCoverImage = async (idx) => {
    if (idx <= 0) return
    const imgs = [...(form.value.images || [])]
    const [picked] = imgs.splice(idx, 1)
    imgs.unshift(picked)
    form.value.images = imgs
    await refreshImagePreviews()
}

const moveProductImage = async (idx, delta) => {
    const imgs = [...(form.value.images || [])]
    const j = idx + delta
    if (j < 0 || j >= imgs.length) return
    ;[imgs[idx], imgs[j]] = [imgs[j], imgs[idx]]
    form.value.images = imgs
    await refreshImagePreviews()
}

const moveDetailImage = async (idx, delta) => {
    const imgs = [...(form.value.detailImages || [])]
    const j = idx + delta
    if (j < 0 || j >= imgs.length) return
    ;[imgs[idx], imgs[j]] = [imgs[j], imgs[idx]]
    form.value.detailImages = imgs
    await refreshDetailImagePreviews()
}

const onRichImageUploaded = async (fileID) => {
    if (!fileID) return
    if ((form.value.detailImages || []).includes(fileID)) return
    form.value.detailImages = [...(form.value.detailImages || []), fileID]
    await refreshDetailImagePreviews()
}

const deleteItem = (row) => { 
    ElMessageBox.confirm(
        `确定要永久删除藏品《${row.title}》吗?`, '高风险操作', 
        { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    ).then(async () => {
        try {
            await cdnRemove(COLLECTIONS.PRODUCTS, row._id)
            ElMessage.success('档案已销毁')
            loadProducts()
        } catch (err) {
            console.error('删除失败', err)
            ElMessage.error('删除失败: ' + (err.message || '未知错误'))
        }
    }).catch(()=>{}) 
}

const saveProduct = async () => {
    if(!form.value.title) return ElMessage.warning('请输入藏品名称')
    if (!isMerchandiseProduct(form.value) && !String(form.value.latinName || '').trim()) {
        return ElMessage.warning('标本类藏品须填写拉丁学名（与店长端一致）')
    }
    const needsCert = form.value.protectionType && form.value.protectionType !== 'none'
    if (needsCert && !String(form.value.collectionCertificate || '').trim()) {
        return ElMessage.warning('请上传收藏证书（保护类标本必填）')
    }

    let hasSku = false
    let skus = []
    let skuDimensions = []
    if (form.value.hasSku) {
        const built = buildSkusForSave()
        skus = built.skus
        skuDimensions = built.skuDimensions
        if (!skus.length) return ElMessage.warning('请至少添加一条有效规格（需填写规格名）')
        const missingImg = skus.find((s) => !s.images || !s.images.length)
        if (missingImg) return ElMessage.warning(`规格「${missingImg.specLabel}」请至少上传 1 张图`)
        hasSku = true
    }
    
    try {
        // 🟢 处理秒杀数据
        let seckill = null
        if (form.value.seckillEnabled) {
            seckill = {
                enabled: true,
                price: form.value.seckillPrice,
                stock: form.value.seckillStock,
                limitPerUser: form.value.seckillLimitPerUser,
                startTime: form.value.seckillStartTime ? new Date(form.value.seckillStartTime).getTime() : null,
                endTime: form.value.seckillEndTime ? new Date(form.value.seckillEndTime).getTime() : null
            }
        }
        
        // 🟢 处理拼团数据
        let groupBuying = null
        if (form.value.groupBuyingEnabled) {
            groupBuying = {
                enabled: true,
                price: form.value.groupBuyingPrice,
                groupSize: form.value.groupBuyingSize
            }
        }
        
        const blob = [form.value.rootCategoryName, form.value.category].filter(Boolean).join(' ')
        const channelOk = /蝴蝶|鳞翅|蝶|昆虫/.test(blob)
        const craftOk = /昆虫|植物|海洋|蝴蝶|鳞翅/.test(blob)
        let images = (form.value.images || []).filter(Boolean)
        const detailImages = (form.value.detailImages || []).filter(Boolean)
        const detailHtml = String(form.value.detailHtml || '')
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
            .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
            .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')

        let price = form.value.price
        let stock = form.value.stock
        if (hasSku) {
            const prices = skus.map((s) => parseFloat(s.price) || 0).filter((p) => p > 0)
            price = prices.length ? Math.min(...prices) : price
            stock = skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
            // 无商品级封面时，用首规格封面兜底
            if (!images.length && skus[0]?.images?.[0]) {
                images.push(skus[0].images[0])
            }
        }

        const sizeStr = `${form.value.sizeL || 0}x${form.value.sizeW || 0}x${form.value.sizeH || 0} cm`
        const tax = form.value.taxonomy || emptyTaxonomy()
        let collectionCertificate = String(form.value.collectionCertificate || '').trim()
        if (!needsCert) collectionCertificate = ''

        const data = {
            title: form.value.title,
            price,
            costPrice: form.value.costPrice || 0,
            stock,
            category: form.value.category || '',
            categoryId: form.value.categoryId || '',
            rootCategoryId: form.value.rootCategoryId || '',
            rootCategoryName: form.value.rootCategoryName || '',
            categoryType: form.value.categoryType || '',
            channel: channelOk ? (form.value.channel || '') : '',
            craftType: craftOk ? (form.value.craftType || '') : '',
            latinName: form.value.latinName || '',
            description: form.value.description || '',
            images,
            detailImages,
            detailHtml,
            hasSku,
            skus: hasSku ? skus : [],
            skuDimensions: hasSku ? skuDimensions : [],
            isTreasure: form.value.isTreasure || false,
            isOneOfAKind: form.value.isOneOfAKind || false,
            inArchive: form.value.inArchive || false,
            memberDiscountEnabled: form.value.memberDiscountEnabled !== false,
            supportsCustom: form.value.supportsCustom !== false,
            protectionType: form.value.protectionType || 'none',
            collectionCertificate,
            origin: form.value.origin || '',
            collectDate: form.value.collectDate || '',
            framerName: form.value.framerName || 'NATURE',
            framerId: form.value.framerId || null,
            size: sizeStr,
            taxonomy: {
                kingdom: tax.kingdom || '',
                phylum: tax.phylum || '',
                class: tax.class || '',
                order: tax.order || '',
                family: tax.family || '',
                genus: tax.genus || ''
            },
            updateTime: Date.now(),
            seckill: seckill,
            groupBuying: groupBuying
        }
        
        if (isEditing.value) {
            await cdnUpdate(COLLECTIONS.PRODUCTS, form.value._id, data)
            ElMessage.success('更新成功')
        } else {
            data.createTime = Date.now()
            data.isOffShelf = false
            await cdnAdd(COLLECTIONS.PRODUCTS, data)
            ElMessage.success('创建成功')
        }
        
        dialogVisible.value = false
        loadProducts() 
    } catch (err) {
        console.error('保存失败', err)
        ElMessage.error('保存失败: ' + (err.message || '未知错误'))
    }
}

const initMobileDetection = () => {
    checkMobile()
    MOBILE_MQ?.addEventListener('change', onMobileMqChange)
}

const cleanupMobileDetection = () => {
    MOBILE_MQ?.removeEventListener('change', onMobileMqChange)
    applyMobileClass(false)
}

function onHashLegacyCleanup() {
    stripLegacyBrandHashes()
}

onMounted(() => {
    stripLegacyBrandHashes()
    checkSession()
    loadPinned()
    window.addEventListener('hashchange', onHashLegacyCleanup)
    window.addEventListener('storage', onStorage)
    window.addEventListener('pinned-changed', loadPinned) // 同页内命令面板置顶 → 侧栏同步
    window.addEventListener('keydown', onSidebarKey)
    setupActionListeners()
    // 立即检测移动端
    initMobileDetection()
    // 监听自定义事件，支持组件间跳转（命名引用，确保可被移除）
    window.addEventListener('switch-tab', onSwitchTabEvent)
})

onUnmounted(() => {
    window.removeEventListener('hashchange', onHashLegacyCleanup)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pinned-changed', loadPinned)
    window.removeEventListener('keydown', onSidebarKey)
    window.removeEventListener('switch-tab', onSwitchTabEvent)
    cleanupMobileDetection()
    cleanupActionListeners()
})
</script>

<style>
/* ================================================= */
/* 🎨 核心样式定义 */
/* ================================================= */

/* 设计令牌见 src/styles/design-tokens.css */

body { margin: 0; background: var(--bg-light); font-family: var(--font-cn-body), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.app-root { height: 100vh; overflow: hidden; }

/* --- 登录页样式 --- */
.login-mask {
    height: 100vh; width: 100%; background: var(--dark-bg-primary);
    display: flex; justify-content: center; align-items: center;
    background-image: radial-gradient(var(--dark-border-default) 1px, transparent 1px);
    background-size: 40px 40px;
    z-index: 9999;
}
.login-card {
    background: rgba(26, 24, 21, 0.96); 
    padding: 50px 40px; 
    border-radius: var(--radius-xl); 
    width: 400px; 
    text-align: center; 
    border: 1px solid var(--dark-border-subtle);
    box-shadow: 0 20px 60px rgba(0,0,0,0.55);
    backdrop-filter: blur(10px);
}
.logo-circle {
    width: 70px; height: 70px; background: var(--brand-green-500); color: var(--light-bg-elevated);
    font-size: 36px; font-weight: 900; line-height: 70px; border-radius: 50%;
    margin: 0 auto 15px; box-shadow: 0 0 20px rgba(45, 106, 79, 0.4);
}
.login-card h2 { color: var(--dark-text-primary); font-size: 20px; margin: 0; letter-spacing: 2px; }
.logo-sub { color: var(--dark-text-tertiary); font-size: 10px; letter-spacing: 4px; margin-top: 5px; margin-bottom: 30px; }
.input-wrapper { margin-bottom: 25px; }
.login-btn { width: 100%; font-weight: bold; letter-spacing: 2px; height: 45px; font-size: 16px; }
.login-footer { margin-top: 30px; color: var(--dark-text-secondary); font-size: 12px; line-height: 1.5; }

/* --- 主布局样式 --- */
.admin-container { height: 100vh; display: flex; background: var(--bg-light); }
.aside { 
    background: linear-gradient(180deg, var(--brand-green-900) 0%, var(--brand-green-700) 100%);
    display: flex; flex-direction: column; 
    border-right: 1px solid var(--border-dark); 
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.3);
    z-index: 10;
    position: relative;
}

/* 🟢 左侧菜单 - 黑金效果 */
.aside::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
    opacity: 0.3;
}

.brand-header { 
    height: 80px; 
    display: flex; 
    align-items: center; 
    padding-left: 24px;
    border-bottom: 1px solid var(--border-dark); 
    background: rgba(10, 31, 23, 0.35);
    backdrop-filter: blur(10px);
    position: relative;
}
.brand-header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 24px;
    right: 24px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
    opacity: 0.2;
}
.brand-logo { 
    width: 36px; 
    height: 36px; 
    background: var(--brand-green-500);
    color: var(--light-bg-elevated);
    border-radius: 8px; 
    font-weight: 900; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    font-size: 20px; 
    margin-right: 12px;
    box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
    transition: all 0.3s ease;
}
.brand-logo:hover {
    box-shadow: 0 4px 12px rgba(45, 106, 79, 0.5);
    transform: scale(1.05);
}
.brand-text .cn { 
    color: var(--text-dark); 
    font-weight: bold; 
    font-size: 16px; 
    letter-spacing: 1px; 
}
.brand-text .brand-sub { 
    color: var(--text-dark-muted); 
    font-size: 11px; 
    letter-spacing: 0.5px; 
    margin-top: 1px;
}

/* 菜单调整 - 黑金效果 */
.el-menu { 
    border-right: none !important; 
    margin-top: 10px; 
    background: transparent !important;
}
.el-menu-item-group__title { 
    padding: 16px 0 10px 24px !important; 
    font-size: 12px; 
    color: var(--text-dark-muted) !important; 
    letter-spacing: 0.5px; 
    font-weight: 600; 
    margin-top: 8px;
}
.el-menu-item { 
    height: 48px; 
    line-height: 48px; 
    margin: 2px 12px; 
    border-radius: 8px; 
    color: var(--text-dark-secondary) !important;
    transition: all 0.3s ease;
    padding: 0 12px !important;
    font-size: 14px;
    display: flex;
    align-items: center;
}
.el-menu-item:hover { 
    background: rgba(255, 255, 255, 0.06) !important; 
    color: var(--text-dark) !important; 
    transform: translateX(2px);
}
.el-menu-item.is-active { 
    background: var(--brand-green-500) !important; 
    color: var(--light-bg-elevated) !important; 
    font-weight: 600; 
    box-shadow: none;
    position: relative;
}
.el-menu-item.is-active .el-icon {
    color: var(--light-bg-elevated) !important;
}
.el-menu-item.is-active::before {
    display: none;
}
.el-menu-item .el-icon { 
    font-size: 18px; 
    margin-right: 12px; 
    color: inherit;
    width: 20px;
    text-align: center;
}

/* 🟢 侧栏折叠按钮 */
.collapse-btn {
    margin-left: auto !important;
    color: rgba(245, 242, 236, 0.5) !important;
    padding: 4px !important;
}
.collapse-btn:hover { color: #d4af37 !important; }
.aside.is-collapsed .brand-header { justify-content: center; padding: 0 !important; }
.aside.is-collapsed .brand-logo { margin: 0 auto; }
.aside.is-collapsed .collapse-btn { position: absolute; right: 4px; top: 8px; }
.aside { transition: width 0.25s ease; position: relative; }

/* 🟢 侧栏快捷搜索栏 */
.sidebar-search {
    margin: 12px 14px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: rgba(245, 242, 236, 0.6);
    font-size: 13px;
    transition: 0.2s;
}
.sidebar-search.collapsed {
    margin: 12px 8px;
    padding: 10px 0;
    justify-content: center;
}
.sidebar-search:hover {
    background: rgba(212, 175, 55, 0.12);
    border-color: rgba(212, 175, 55, 0.3);
    color: rgba(245, 242, 236, 0.9);
}
.sidebar-search span { flex: 1; }
.kbd-hint {
    background: rgba(0,0,0,0.4);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
    color: rgba(245, 242, 236, 0.7);
    border: 1px solid rgba(255,255,255,0.1);
}

/* 🟢 置顶收藏夹 */
.pinned-section {
    margin: 0 8px 12px;
    padding: 6px 0 8px;
    border-bottom: 1px dashed rgba(255,255,255,0.08);
}
.pinned-title {
    padding: 6px 14px 4px;
    font-size: 10px;
    letter-spacing: 1px;
    color: rgba(212, 175, 55, 0.5);
}
.pinned-item {
    display: flex;
    align-items: center;
    padding: 7px 14px;
    cursor: pointer;
    border-radius: 6px;
    margin: 1px 4px;
    transition: 0.15s;
}
.pinned-item:hover {
    background: rgba(212, 175, 55, 0.12);
}
.pinned-item.active {
    background: rgba(212, 175, 55, 0.18);
}
.pinned-item.active .pin-name {
    color: #d4af37;
    font-weight: 600;
}
.pin-name {
    flex: 1;
    font-size: 13px;
    color: rgba(245, 242, 236, 0.8);
}
.pin-remove {
    color: rgba(245, 242, 236, 0.3);
    cursor: pointer;
    font-size: 14px;
    transition: 0.15s;
}
.pin-remove:hover { color: #f56c6c; }

.el-menu-vertical .el-sub-menu__title {
    height: 48px;
    line-height: 48px;
    margin: 2px 12px;
    border-radius: 8px;
    padding: 0 12px !important;
    font-size: 14px;
    color: rgba(245, 242, 236, 0.72) !important;
}
.el-menu-vertical .el-sub-menu__title:hover {
    background: rgba(255, 255, 255, 0.06) !important;
    color: var(--text-dark) !important;
}
.el-menu-vertical .el-sub-menu.is-opened > .el-sub-menu__title {
    color: rgba(245, 242, 236, 0.92) !important;
}
.el-menu-vertical .el-menu--inline {
    background: transparent !important;
}
.el-menu-vertical .el-menu--inline .el-menu-item {
    padding-left: 36px !important;
    min-width: auto;
}

/* 侧边栏底部 - 黑金效果 */
.sidebar-footer { 
    margin-top: auto; 
    padding: 20px; 
    border-top: 1px solid var(--border-dark); 
    background: rgba(10, 31, 23, 0.35);
    backdrop-filter: blur(10px);
}
.user-badge { 
    display: flex; 
    align-items: center; 
    margin-bottom: 15px; 
    padding: 0 10px; 
}
.user-info { 
    margin-left: 10px; 
    display: flex; 
    flex-direction: column; 
}
.user-info .name { 
    color: var(--text-dark); 
    font-size: 14px; 
    font-weight: bold; 
}
.user-info .status { 
    color: var(--semantic-success-icon); 
    font-size: 12px; 
    margin-top: 2px; 
}
.logout-btn { 
    width: 100%; 
    justify-content: flex-start; 
    color: var(--text-dark-secondary); 
    transition: all 0.3s ease;
}
.logout-btn:hover { 
    color: var(--primary); 
    transform: translateX(2px);
}

/* 🟢 内容区 - 白色低饱和度 + 黑金效果 */
.main-content {
    padding: 0 !important;
    overflow: hidden;
    height: 100vh;
    background: var(--light-bg-primary);
    position: relative;
    display: flex;
    flex-direction: column;
}
.content-scroll-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 24px 30px;
}
.main-content::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
    opacity: 0.1;
}
.main-content :deep(.ai-strategic-brain) { 
  padding: 0 !important; 
  margin: -30px !important; 
  width: calc(100% + 60px) !important; 
  height: calc(100vh + 60px) !important; 
  position: relative !important;
  z-index: 1;
}
.main-content :deep(.strategy-research-container) {
  padding: 0 !important;
  margin: -30px !important;
  width: calc(100% + 60px) !important;
  height: calc(100vh + 60px) !important;
  position: relative !important;
  z-index: 1;
}

.archive-filter-label {
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
}
.expired-promo-badge {
  cursor: pointer;
  margin-left: 4px;
}

.sku-hint-muted {
  margin-left: 8px;
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
}

.latin-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.latin-name-row .el-input {
  flex: 1;
}
.latin-name-row .el-button {
  flex-shrink: 0;
}

.size-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.size-inputs .el-input {
  flex: 1;
}
.size-inputs > span {
  color: var(--light-text-tertiary);
  flex-shrink: 0;
}

.sku-variants-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 0 16px 90px;
  padding: 12px 14px;
  background: #FAF8F3;
  border: 1px solid #E8E5DE;
  border-radius: 8px;
}
.sku-variant-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px dashed #E0DCD3;
}
.sku-variant-row:last-of-type {
  border-bottom: none;
  padding-bottom: 0;
}
.sku-variant-fields {
  display: grid;
  grid-template-columns: 1.4fr 1fr 110px 90px auto;
  gap: 8px;
  align-items: center;
}
.sku-variant-images {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sku-variant-images .gallery-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.sku-variant-images .gallery-thumb {
  position: relative;
  width: 80px;
  border: 1px solid #E8E5DE;
  border-radius: 8px;
  overflow: hidden;
  background: #FAF6ED;
}
.sku-variant-images .gallery-thumb.is-cover {
  border-color: #C4A76C;
}
.sku-variant-images .gallery-thumb-img {
  width: 80px;
  height: 80px;
  display: block;
}
.sku-variant-images .gallery-thumb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0;
  padding: 2px 4px 4px;
  background: #fff;
}
.sku-variant-images .cover-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: #C4A76C;
  color: #1A1814;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
@media (max-width: 900px) {
  .sku-variants-editor { margin-left: 0; }
  .sku-variant-fields { grid-template-columns: 1fr 1fr; }
}

.product-media-gallery {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.product-media-gallery .gallery-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.product-media-gallery .gallery-thumb {
  position: relative;
  width: 96px;
  border: 1px solid #E8E5DE;
  border-radius: 8px;
  overflow: hidden;
  background: #FAF6ED;
}
.product-media-gallery .gallery-thumb.is-cover {
  border-color: #C4A76C;
}
.product-media-gallery .gallery-thumb-img {
  width: 96px;
  height: 96px;
  display: block;
}
.product-media-gallery .gallery-thumb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0;
  padding: 2px 4px 6px;
  background: #fff;
}
.product-media-gallery .cover-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: #C4A76C;
  color: #1A1814;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

.product-image-upload {
  width: 100%;
  max-width: 420px;
}
.product-image-upload :deep(.el-upload) {
  width: 100%;
}
.product-image-upload :deep(.el-upload-dragger) {
  width: 100%;
  padding: 18px 16px;
  background: #FAF8F3;
  border: 1px dashed #E0DCD3;
  border-radius: 8px;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.product-image-upload :deep(.el-upload-dragger:hover),
.product-image-upload :deep(.el-upload-dragger.is-dragover) {
  border-color: #C4A76C;
  background: #FAF6ED;
}
.product-image-upload :deep(.el-icon--upload) {
  font-size: 36px;
  color: #C4A76C;
  margin-bottom: 6px;
}
.product-image-upload :deep(.el-upload__text) {
  color: #6b6560;
  font-size: 13px;
  line-height: 1.4;
}
.product-image-upload--sku {
  max-width: 320px;
}
.product-image-upload--sku :deep(.el-upload-dragger) {
  padding: 12px 12px;
}
.product-image-upload--sku :deep(.el-icon--upload) {
  font-size: 28px;
  margin-bottom: 4px;
}
.product-image-upload--sku :deep(.el-upload__text) {
  font-size: 12px;
}
.product-archive-dialog .el-dialog__body {
  max-height: min(72vh, 720px);
  overflow-y: auto;
}

.product-table-cover {
  border-radius: var(--radius-md);
  border: 1px solid var(--light-border-subtle);
  overflow: hidden;
}

.module-header { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 24px; 
    padding-bottom: 16px;
    border-bottom: 2px solid var(--border-light);
}
.title-box h2 { 
    margin: 0; 
    color: var(--text-light); 
    font-weight: 600; 
    font-size: var(--text-2xl); 
    border-left: 4px solid var(--primary); 
    padding-left: 15px; 
    position: relative;
}
.title-box h2::before {
    display: none;
}
.title-box .subtitle { 
    color: var(--text-light-muted); 
    font-size: 12px; 
    padding-left: 19px; 
    letter-spacing: 2px; 
    display: block; 
    margin-top: 5px; 
}

/* 🟢 表格卡片 - 白色低饱和度 + 黑金边框 */
.table-card { 
    border-radius: 12px; 
    border: 1px solid var(--border-light); 
    box-shadow: var(--shadow-light);
    background: var(--bg-light-card);
    overflow: hidden;
    transition: all 0.3s ease;
}
.table-card:hover {
    box-shadow: 0 4px 20px rgba(45, 106, 79, 0.1);
    border-color: var(--primary);
}
.prod-title { 
    font-weight: bold; 
    color: var(--text-light); 
    font-size: 14px; 
}
.prod-id { 
    font-size: 12px; 
    color: var(--text-light-muted); 
    margin-top: 2px; 
    font-family: monospace; 
}
.price-tag { 
    color: var(--primary-dark); 
    font-weight: bold; 
    font-family: 'Segoe UI', monospace; 
    text-shadow: 0 1px 2px rgba(45, 106, 79, 0.2);
}
.stock-tag { 
    font-size: 12px; 
    padding: 2px 8px; 
    border-radius: 4px; 
    font-weight: 500;
}
.stock-tag.out { background: var(--semantic-error-bg); color: var(--semantic-error-text); border: 1px solid rgba(208, 84, 80, 0.28); }
.stock-tag.low { background: var(--semantic-warning-bg); color: var(--semantic-warning-text); border: 1px solid rgba(196, 165, 90, 0.45); }
.stock-tag.normal { background: var(--semantic-success-bg); color: var(--semantic-success-text); border: 1px solid rgba(45, 106, 79, 0.22); }
.promo-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.promo-meta { font-size: 11px; color: #999; margin-top: 2px; }
.promo-meta-expired { color: #E6A23C; }
.promo-none { color: #ccc; }

/* 🟢 Element Plus 全局样式覆盖 - 黑金效果 */
.el-button--primary { 
    --el-button-bg-color: var(--primary); 
    --el-button-border-color: var(--primary); 
    --el-button-hover-bg-color: var(--primary-hover); 
    --el-button-hover-border-color: var(--primary-hover); 
    color: var(--light-bg-elevated); 
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
    transition: all 0.3s ease;
}
.el-button--primary:hover {
    box-shadow: 0 4px 12px rgba(45, 106, 79, 0.4);
    transform: translateY(-1px);
}
.el-switch.is-checked .el-switch__core { 
    border-color: var(--semantic-success-icon); 
    background-color: var(--semantic-success-icon); 
}

/* 🟢 卡片样式统一 */
.el-card {
    background: var(--bg-light-card);
    border: 1px solid var(--border-light);
    border-radius: 12px;
    box-shadow: var(--shadow-light);
    transition: all 0.3s ease;
}
.el-card:hover {
    box-shadow: 0 4px 20px rgba(45, 106, 79, 0.08);
    border-color: var(--primary);
}

/* 🟢 表格样式统一 */
.el-table {
    background: var(--bg-light-card);
    color: var(--text-light);
}
.el-table th {
    background: var(--bg-light-hover);
    color: var(--text-light);
    font-weight: 600;
    border-bottom: 2px solid var(--border-light);
}
.el-table td {
    border-bottom: 1px solid var(--border-light);
}
.el-table tr:hover > td {
    background: rgba(45, 106, 79, 0.05);
}

/* 🟢 输入框样式统一 */
.el-input__wrapper {
    background: var(--bg-light-card);
    border: 1px solid var(--border-light);
    box-shadow: none;
    transition: all 0.3s ease;
}
.el-input__wrapper:hover {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.1);
}
.el-input__wrapper.is-focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.2);
}
.el-input__inner {
    color: var(--text-light);
}

/* 🟢 对话框样式统一 */
.el-dialog {
    background: var(--bg-light-card);
    border: 1px solid var(--border-light);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}
.el-dialog__header {
    border-bottom: 1px solid var(--border-light);
    padding: 20px 24px;
}
.el-dialog__title {
    color: var(--text-light);
    font-weight: 600;
    font-size: 18px;
}
.el-dialog__body {
    color: var(--text-light-secondary);
    padding: 24px;
}

/* 🟢 标签样式统一 */
.el-tag {
    border: 1px solid var(--border-light);
    background: var(--bg-light-hover);
    color: var(--text-light);
}

/* 🔧 手机访问功能样式 */
.mobile-access-btn {
    width: 100%;
    justify-content: flex-start;
    color: var(--text-dark-secondary);
    transition: all 0.3s ease;
    margin-bottom: 8px;
}
.mobile-access-btn:hover {
    color: var(--primary);
    transform: translateX(2px);
}

.mobile-access-content {
    text-align: center;
}

.qr-code-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 20px 0;
    padding: 20px;
    background: var(--light-bg-secondary);
    border-radius: var(--radius-md);
    min-height: 240px;
}

.qr-code-placeholder {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin: 20px 0;
    padding: 40px 20px;
    background: var(--light-bg-secondary);
    border-radius: var(--radius-md);
    min-height: 240px;
}

.qr-code-canvas {
    border: 1px solid var(--light-border-default);
    border-radius: var(--radius-sm);
    background: var(--light-bg-elevated);
}

.access-link-container {
    margin: 20px 0;
}

.access-link-tip {
    width: 100%;
}

.access-link-tip {
    width: 100%;
}

.access-link-input {
    width: 100%;
}

.access-tips {
    margin-top: 20px;
    text-align: left;
    padding: 15px;
    background: var(--light-bg-tertiary);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--light-text-secondary);
}

.access-tips p {
    margin: 0 0 8px 0;
    font-weight: 600;
    color: var(--light-text-primary);
}

.access-tips ul {
    margin: 0;
    padding-left: 20px;
}

.access-tips li {
    margin: 5px 0;
    line-height: 1.6;
}

/* 🟢 分页样式统一 */
.el-pagination {
    color: var(--text-light);
}
.el-pagination button {
    background: var(--bg-light-card);
    border: 1px solid var(--border-light);
    color: var(--text-light);
}
.el-pagination .el-pager li {
    background: var(--bg-light-card);
    border: 1px solid var(--border-light);
    color: var(--text-light);
}
/* 批量操作栏样式 */
.batch-operations {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1) 0%, rgba(45, 106, 79, 0.05) 100%);
  border: 1px solid rgba(45, 106, 79, 0.3);
  border-radius: 8px;
}

.batch-info {
  font-size: 14px;
  color: var(--light-text-primary);
}

.batch-info strong {
  color: var(--brand-green-600);
  font-weight: 600;
}

.batch-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.el-pagination .el-pager li.is-active {
    background: var(--primary);
    color: var(--light-bg-elevated);
    border-color: var(--primary);
}

/* 动画 - 优化过渡效果，避免DOM操作错误 */
.fade-slide-enter-active { 
    transition: opacity 0.2s ease, transform 0.2s ease; 
}
.fade-slide-leave-active { 
    transition: opacity 0.15s ease, transform 0.15s ease;
    position: absolute;
    width: 100%;
}
.fade-slide-enter-from { 
    opacity: 0; 
    transform: translateX(10px); 
}
.fade-slide-leave-to { 
    opacity: 0; 
    transform: translateX(-10px); 
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>