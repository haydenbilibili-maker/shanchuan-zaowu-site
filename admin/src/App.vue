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
          <!-- 桌面端品牌头部 + 一键缩放侧栏 -->
          <div v-if="!isMobile" class="brand-header" :class="{ 'is-rail': sidebarCollapsed }">
            <div class="brand-row">
              <div class="brand-logo" :title="sidebarCollapsed ? '山海造物 · 管理后台' : undefined">山</div>
              <div class="brand-text" v-show="!sidebarCollapsed">
                <div class="cn">山海造物</div>
                <div class="brand-sub">管理后台</div>
              </div>
              <div v-if="!sidebarCollapsed" class="brand-actions">
                <el-tooltip :content="recentCollapsed ? '展开最近常用' : '收起最近常用'" placement="bottom" :show-after="400">
                  <el-button
                    class="collapse-btn collapse-btn--groups"
                    link
                    :aria-label="recentCollapsed ? '展开最近常用' : '收起最近常用'"
                    @click="toggleRecentCollapsed"
                  >
                    <el-icon><component :is="recentCollapsed ? ArrowDownBold : ArrowUpBold" /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="一键缩放侧栏 ⌘B" placement="bottom" :show-after="400">
                  <el-button
                    class="collapse-btn"
                    link
                    aria-label="一键缩放侧栏"
                    @click="toggleSidebar"
                  >
                    <el-icon><Fold /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
            <el-tooltip
              v-if="sidebarCollapsed"
              content="展开侧栏 ⌘B"
              placement="right"
              :show-after="200"
            >
              <el-button
                class="collapse-btn collapse-btn--rail"
                link
                aria-label="展开侧栏"
                @click="toggleSidebar"
              >
                <el-icon><Expand /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
          <!-- 移动端抽屉菜单头部 -->
          <div v-if="isMobile" class="brand-header mobile-drawer-header">
            <div class="brand-logo">山</div>
            <div class="brand-text">
              <div class="cn">山海造物</div>
              <div class="brand-sub">管理后台</div>
            </div>
            <div class="brand-actions">
              <el-tooltip :content="recentCollapsed ? '展开最近常用' : '收起最近常用'" placement="bottom" :show-after="400">
                <el-button
                  class="collapse-btn collapse-btn--groups"
                  link
                  :aria-label="recentCollapsed ? '展开最近常用' : '收起最近常用'"
                  @click="toggleRecentCollapsed"
                >
                  <el-icon><component :is="recentCollapsed ? ArrowDownBold : ArrowUpBold" /></el-icon>
                </el-button>
              </el-tooltip>
              <button type="button" class="mobile-sidebar-close" aria-label="关闭菜单" @click="mobileMenuVisible = false">
                <el-icon><Close /></el-icon>
              </button>
            </div>
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
            <div class="pinned-title">PINNED · 置顶</div>
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

          <!-- 🟢 最近常用（进入菜单路由后写入；无记录时隐藏） -->
          <div v-if="recentModules.length && !recentCollapsed && (!sidebarCollapsed || isMobile)" class="recent-section">
            <div class="recent-title">RECENT · 最近常用</div>
            <div
              v-for="m in recentModules"
              :key="'recent-' + m.id"
              class="recent-item"
              :class="{ active: currentTab === m.id }"
              @click="handleMenuSelect(m.id)"
            >
              <el-icon v-if="m.icon" class="recent-ico"><component :is="resolveEpIcon(m.icon)" /></el-icon>
              <span class="recent-name">{{ m.name }}</span>
            </div>
          </div>

          <el-menu
            :collapse="sidebarCollapsed && !isMobile"
            ref="sideMenuRef"
            :default-active="sidebarActiveIndex"
            active-text-color="#ffffff"
            background-color="transparent"
            text-color="rgba(245, 242, 236, 0.72)"
            class="el-menu-vertical"
            @select="handleMenuSelect">

            <el-menu-item-group title="HOME">
                <el-menu-item :index="homeNavItem.id"><el-icon><component :is="resolveEpIcon(homeNavItem.icon)" /></el-icon><span>{{ homeNavItem.title }}</span></el-menu-item>
            </el-menu-item-group>

            <!-- 一级导航域：由 GROUPS 派生（config/adminNavDomains.js → NAV_SIDEBAR_ITEMS），勿在此手写 -->
            <el-menu-item-group title="DOMAINS">
                <el-menu-item v-for="item in NAV_SIDEBAR_ITEMS" :key="item.id" :index="item.id">
                  <el-icon><component :is="resolveEpIcon(item.icon)" /></el-icon><span>{{ item.title }}</span>
                </el-menu-item>
            </el-menu-item-group>

          </el-menu>
          <div class="sidebar-footer" :class="{ 'is-rail': sidebarCollapsed && !isMobile }">
             <el-tooltip
               :disabled="!(sidebarCollapsed && !isMobile)"
               content="主理人 · 在线"
               placement="right"
             >
               <div class="user-badge">
                   <el-avatar :size="32" style="background:var(--brand-green-500); color:var(--light-bg-elevated); font-weight:600;">馆</el-avatar>
                   <div class="user-info" v-show="!(sidebarCollapsed && !isMobile)">
                      <span class="name">主理人</span>
                      <span class="status">● 在线</span>
                   </div>
               </div>
             </el-tooltip>
             <el-tooltip
               :disabled="!(sidebarCollapsed && !isMobile)"
               content="手机访问"
               placement="right"
             >
               <el-button link class="mobile-access-btn" @click="showMobileAccessDialog">
                 <el-icon><Iphone /></el-icon> <span v-show="!(sidebarCollapsed && !isMobile)">手机访问</span>
               </el-button>
             </el-tooltip>
             <el-tooltip
               :disabled="!(sidebarCollapsed && !isMobile)"
               content="退出系统"
               placement="right"
             >
               <el-button link class="logout-btn" @click="logout">
                 <el-icon><SwitchButton /></el-icon> <span v-show="!(sidebarCollapsed && !isMobile)">退出系统</span>
               </el-button>
             </el-tooltip>
          </div>
        </el-aside>
        <el-main class="main-content">
          <!-- 🟢 多标签条 + 面包屑 -->
          <MainTabsBar @open-palette="openCommandPalette" @reload="forceReloadCurrent" />

          <div class="content-scroll-wrap" :class="{ 'is-embed-page': currentTab === '36' || currentTab === '50' || isNavHubTab, 'is-nav-hub': isNavHubTab, 'is-mobile-scroll': isMobile }">
          <div v-if="domainContextBar" class="domain-context-bar">
            <button type="button" class="domain-back" @click="backToDomainHub">
              <span class="domain-back-arrow">←</span>
              {{ domainContextBar.domainTitle }}
            </button>
            <span class="domain-sep" aria-hidden="true">/</span>
            <span class="domain-current">{{ domainContextBar.moduleName }}</span>
          </div>
          <!-- 未注册模块的可见提示：不再让「回退驾驶舱」看起来像正常页面。
               注意：必须放在 <transition> / <keep-alive> **外面** ——
               两者都只接受恰好一个子节点（v-if/v-else 视为一个），塞进去会让模板编译直接失败
               （dev 下 App.vue 返回 500、整页只剩「加载中…」）。 -->
          <el-alert
            v-if="unknownTabs.length"
            type="warning"
            show-icon
            :closable="false"
            class="unknown-tabs-alert"
            :title="`当前模块 id「${unknownTabs[0]}」未注册，已回退经营驾驶舱`"
          >
            <template #default>
              菜单注册表与组件映射表（`TAB_COMPONENT_MAP` / `INLINE_TAB_IDS`）不同步，或该模块尚未接通 ——
              上面展示的是经营驾驶舱，与该模块无关。请改用命令面板 ⌘K 搜索，或联系技术确认。
            </template>
          </el-alert>
          <transition name="fade-slide" mode="out-in">
            <!-- tab 1 藏品库为内联模块（依赖 App.vue 大量本地状态），不参与 keep-alive -->
            <div v-if="currentTab === '1'" :key="'1-' + reloadKey" class="module-wrapper">
               <div class="module-header">
                  <div class="title-box">
                    <h2>
                      藏品档案库
                      <span class="archive-sku-count" :title="displaySkuCountTitle">
                        共 {{ productsTotal }} 件
                        <template v-if="displaySkuCount">
                          · 本页 {{ displaySkuCount }} 个 SKU
                        </template>
                      </span>
                    </h2>
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
                    <el-input
                      v-model="productSearchQuery"
                      clearable
                      placeholder="搜索名称 / 学名 / 分类（全库）"
                      style="width: 240px;"
                      size="small"
                      @keyup.enter="resetProductPageAndLoad"
                      @clear="resetProductPageAndLoad"
                    />
                    <el-button size="small" type="primary" plain @click="resetProductPageAndLoad">查询</el-button>
                    <span class="archive-filter-label">档案筛选：</span>
                    <el-radio-group v-model="archiveFilter" size="small" @change="resetProductPageAndLoad">
                        <el-radio-button label="all">全部</el-radio-button>
                        <el-radio-button label="archive">仅档案藏品</el-radio-button>
                        <el-radio-button label="oneOfAKind">仅孤品</el-radio-button>
                    </el-radio-group>
                    <span class="archive-filter-label" style="margin-left: 8px;">营销：</span>
                    <el-radio-group v-model="promoFilter" size="small" @change="resetProductPageAndLoad">
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
                      @click="promoFilter = 'seckill_expired'; resetProductPageAndLoad()"
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
                            <div v-if="(scope.row.displayTags || []).length" class="prod-tags">
                                <el-tag
                                    v-for="tag in scope.row.displayTags"
                                    :key="tag"
                                    size="small"
                                    effect="plain"
                                    class="product-tag-chip"
                                >{{ tag }}</el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="category" label="分类" width="120">
                         <template #default="scope">
                             <el-tag effect="light" type="info" round>{{ scope.row.category }}</el-tag>
                         </template>
                    </el-table-column>
                    <el-table-column label="渠道/装裱/工艺" width="180">
                         <template #default="scope">
                             <div class="promo-cell">
                               <el-tag v-if="scope.row.channel" effect="plain" size="small" round>
                                 {{ CHANNEL_LABEL_MAP[scope.row.channel] || scope.row.channel }}
                               </el-tag>
                               <el-tag v-if="scope.row.craftType" effect="plain" type="success" size="small" round>
                                 {{ CRAFT_TYPE_LABEL_MAP[scope.row.craftType] || scope.row.craftType }}
                               </el-tag>
                               <el-tag v-if="scope.row.craftProcess" effect="plain" type="warning" size="small" round>
                                 {{ CRAFT_PROCESS_LABEL_MAP[scope.row.craftProcess] || scope.row.craftProcess }}
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
                    <el-table-column label="毛利" width="90">
                         <template #default="scope">
                             <span class="profit-cell">{{ scope.row.profitRate }}%</span>
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
                                v-model="scope.row.isOnShelf" active-color="var(--semantic-success-icon)" inactive-color="var(--semantic-error-icon)"
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
                 <div class="product-pagination-row" style="margin-top: 16px; display: flex; justify-content: flex-end;">
                   <el-pagination
                     v-model:current-page="productPage"
                     v-model:page-size="productPageSize"
                     :page-sizes="[50, 100]"
                     :total="productsTotal"
                     layout="total, sizes, prev, pager, next, jumper"
                     background
                     @current-change="loadProducts"
                     @size-change="onProductPageSizeChange"
                   />
                 </div>
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
                @open-module="onNavHubOpen"
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
        <el-form ref="productFormRef" :model="form" :rules="productRules" label-width="90px" label-position="left">
            <el-form-item label="藏品名称" prop="title">
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
                <span class="sku-hint-muted">根据名称补齐分类、描述、保护物种、科学分类、拉丁学名与标签；结果可手改</span>
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
            <el-form-item label="标签">
                <div class="product-tags-editor">
                    <div v-if="form.tags && form.tags.length" class="product-tags-chips">
                        <el-tag
                            v-for="tag in form.tags"
                            :key="tag"
                            closable
                            size="small"
                            effect="plain"
                            class="product-tag-chip"
                            @close="removeProductTag(tag)"
                        >{{ tag }}</el-tag>
                    </div>
                    <div class="product-tags-add">
                        <el-input
                            v-model="form.tagDraft"
                            placeholder="回车添加，最多 10 个短词"
                            maxlength="12"
                            @keyup.enter.prevent="addProductTag"
                        />
                        <el-button @click="addProductTag">添加</el-button>
                    </div>
                </div>
                <span class="sku-hint-muted">写入 products.tags，与小程序藏品库同源；用于首页推荐、搜索关联与用户画像</span>
            </el-form-item>
            <el-form-item label="适配礼赠场景">
                <el-checkbox-group v-model="form.giftScenes" class="gift-scene-checks">
                    <el-checkbox
                        v-for="sc in giftSceneOptions"
                        :key="sc.key"
                        :label="sc.key"
                    >{{ sc.label }}</el-checkbox>
                </el-checkbox-group>
                <span class="sku-hint-muted">写入 products.giftScenes（英文 key）；与兴趣标签 tags 分离，用于礼赠场景选品</span>
            </el-form-item>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="渠道">
                        <el-select
                            v-model="form.channel"
                            clearable
                            placeholder="进口/国产/其它"
                            style="width:100%"
                            :disabled="!isTaxonomyEligibleProduct"
                        >
                            <el-option label="进口" value="import" />
                            <el-option label="国产" value="domestic" />
                            <el-option label="其它" value="other" />
                        </el-select>
                        <span class="sku-hint-muted">昆虫/植物/海洋/动物；空=未标注</span>
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="装裱方式">
                        <el-select
                            v-model="form.craftType"
                            clearable
                            placeholder="相框/玻璃罩/造景/冰箱贴/饰品/蝶翅画/其它"
                            style="width:100%"
                            :disabled="!isTaxonomyEligibleProduct"
                        >
                            <el-option label="相框" value="frame" />
                            <el-option label="方形玻璃罩" value="cloche" />
                            <el-option label="圆形玻璃罩" value="cloche_round" />
                            <el-option label="圆柱形玻璃罩" value="cloche_cylinder" />
                            <el-option label="造景" value="diorama" />
                            <el-option label="冰箱贴" value="magnet" />
                            <el-option label="饰品" value="accessory" />
                            <el-option label="蝶翅画" value="wing_art" />
                            <el-option label="其它" value="other" />
                        </el-select>
                        <span class="sku-hint-muted">装裱/封装形态；DB 字段 craftType；空=未标注</span>
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="20">
                <el-col :span="12">
                    <el-form-item label="制作工艺">
                        <el-select
                            v-model="form.craftProcess"
                            clearable
                            placeholder="浸制/塑化/剥制/其它"
                            style="width:100%"
                            :disabled="!isTaxonomyEligibleProduct"
                        >
                            <el-option label="浸制" value="immersion" />
                            <el-option label="塑化" value="plastination" />
                            <el-option label="剥制" value="taxidermy" />
                            <el-option label="其它" value="other" />
                        </el-select>
                        <span class="sku-hint-muted">标本制作工艺；DB 字段 craftProcess；空=未标注</span>
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="进货价格">
                        <el-input-number v-model="form.costPrice" :min="0" :precision="2" :step="10" style="width:100%" />
                    </el-form-item>
                </el-col>
            </el-row>
            <el-row :gutter="20">
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
                    <el-form-item :label="isMerchandiseForm ? '拉丁学名' : '拉丁学名 *'" prop="latinName">
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
                prop="collectionCertificate"
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
  errorComponent: {
    render: () => h('div', { style: 'padding: 60px; text-align: center; color: #f56c6c; line-height: 1.6;' }, [
      h('div', '模块加载失败或超时'),
      h('div', { style: 'margin-top: 8px; font-size: 13px; color: #909399;' }, '请刷新页面重试；若持续失败，可能是发版资源未同步。'),
    ]),
  },
  delay: 100,
  timeout: 20000,
})
// 导入图标库
import {
  Plus, Edit, Delete, Box, List, Lock, Money, FolderAdd,
  Picture, PictureFilled, UploadFilled, Collection, Calendar, Ticket, SwitchButton, DataAnalysis, ChatDotRound, Setting, MagicStick, Search, Trophy, Iphone, DocumentCopy, Menu, View, Present, Sort,
  InfoFilled, Loading, SuccessFilled, WarningFilled, QuestionFilled, Connection, Monitor, CircleCheck, CircleClose, Notebook, Wallet, Brush, User, Promotion,
  DataBoard, TrendCharts, VideoCamera, Van,
  // 🟢 小程序对齐补充图标
  Stamp, Avatar, Message, Refresh, Document, ShoppingCart, Phone,
  // 🟢 命令面板/收藏夹
  Close,
  // 🟢 侧栏折叠（左右宽度 / 上下分组）
  Expand, Fold, ArrowUpBold, ArrowDownBold,
  // 🟢 物业合作测算
  House,
  // 🟢 小票审核 / 待我审批
  Tickets, Checked
} from '@element-plus/icons-vue'
import * as EpIcons from '@element-plus/icons-vue'
// 导入云开发工具
import { getTempFileUrl, getTempFileUrls, uploadAdminBinary, COLLECTIONS, fetchCollectionSorted, cdnUpdate, callCloudFunction, getCdnDatabase, cdnCount, cdnQueryPage } from './cloud'
import { toChineseTaxonomy } from './utils/taxonomyZh'
import { sanitizeProductTags, readProductTags, MAX_TAGS } from './utils/productTags'
import { GIFT_SCENES, sanitizeGiftScenes, readGiftScenes } from './utils/giftScenes'
import { establishAdminSession, clearAdminSession, assertWriteApplied } from './utils/cloudbaseCdnDb'
import { isActiveCategory } from './utils/categoryActive'
import { ElMessage, ElMessageBox } from 'element-plus'
import RichHtmlEditor from './components/RichHtmlEditor.vue'
import ImageUploadField from './components/ImageUploadField.vue'

/**
 * 藏品写入守卫（products）。
 *
 * `products` 线上规则 `{ read: true, write: false }` → ERP **只读**。而权限被拒时
 * CloudBase SDK **不抛错**，只 resolve `{code:'DATABASE_PERMISSION_DENIED'}` —— 于是
 * 「批量下架 / 入档 / 调价 / 改库存 / 秒杀开关」这些操作原先都会打出
 * 「已下架 N 个商品」而**零落库**（审计 P0-5 里 `products` 那一项）。
 *
 * 统一在这里断言：写没生效就抛 `WriteNotAppliedError`，由调用方**既有的** catch
 * 如实报错，不再出现假成功。批量场景下 Promise.all 会因第一个失败而拒绝。
 */
async function updateProduct(id, patch, actionLabel = '藏品写入') {
    const res = await cdnUpdate(COLLECTIONS.PRODUCTS, id, patch)
    assertWriteApplied('products', res, actionLabel)
    return res
}

/** 图标名（注册表里的字符串）→ 组件，避免字符串当文本叠字 */
const resolveEpIcon = (name) => EpIcons[name] || EpIcons.Menu

// --- 动态组件引入（同步加载，保证各 Tab 稳定渲染） ---
const FinanceDashboard = asyncWith(() => import('./components/Finance.vue'))
// 2026-09-14 与小程序对齐补的四模块（定金 / 直播 / 装裱师佣金 / 生日礼）
const DepositOps = asyncWith(() => import('./components/DepositOps.vue'))
const LiveSessions = asyncWith(() => import('./components/LiveSessions.vue'))
const ArtisanCommissionRegistry = asyncWith(() => import('./components/ArtisanCommission.vue'))
const BirthdayGiftConfig = asyncWith(() => import('./components/BirthdayGiftConfig.vue'))
const PurchaseOps = asyncWith(() => import('./components/PurchaseOps.vue'))
const StoreShipments = asyncWith(() => import('./components/StoreShipments.vue'))
const FeishuSyncCenter = asyncWith(() => import('./components/FeishuBridge.vue'))
const PropertyCostOps = asyncWith(() => import('./components/PropertyCostOps.vue'))
import OrderCenter from './components/Orders.vue'
import ProductAI from './components/ai/ProductAI.vue'
import InventoryAI from './components/ai/InventoryAI.vue'
import OperationsDecisionCenter from './components/ai/OperationsDecisionCenter.vue'
import Dashboard from './components/Dashboard.vue'
import ActivityManager from './components/Activities.vue'
import TeamManager from './components/Team.vue'
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
import PermissionManager from './components/PermissionManager.vue'
import SearchKeywordsManager from './components/SearchKeywordsManager.vue'
import RecommendAlgorithmConfig from './components/RecommendAlgorithmConfig.vue'
import CustomReportBuilder from './components/CustomReportBuilder.vue'
import NotificationConfig from './components/NotificationConfig.vue'
import OperationsManual from './components/OperationsManual.vue'
import FranchiseManagement from './components/FranchiseManagement.vue'
import PayrollManagement from './components/PayrollManagement.vue'
import CorporateGovernanceCenter from './components/CorporateGovernanceCenter.vue'

// 合并后的 Hub 入口（子能力以 Tab 呈现，旧 id 经 moduleAliases 跳转）
import StoreOpsHub from './components/StoreOpsHub.vue'
import MarketingOpsHub from './components/MarketingOpsHub.vue'
import MemberOpsHub from './components/MemberOpsHub.vue'
import HomeOpsHub from './components/HomeOpsHub.vue'
import BehaviorOpsHub from './components/BehaviorOpsHub.vue'
import BookingOpsHub from './components/BookingOpsHub.vue'
import MonitorOpsHub from './components/MonitorOpsHub.vue'
import AdminNavHub from './components/AdminNavHub.vue'
import { hubSections, resolveModuleOpen } from './utils/moduleAliases'
import { getNavDomain, MODULE_TO_NAV_DOMAIN, NAV_DOMAIN_IDS, NAV_SIDEBAR_ITEMS } from './config/adminNavDomains.js'
import { setNavOrigin, getNavOrigin } from './utils/navOrigin'

// 🟢 对齐小程序能力的模块
import CustomOrders from './components/CustomOrders.vue'
const FulfillmentCenter = asyncWith(() => import('./components/FulfillmentCenter.vue'))
import PetMemorial from './components/PetMemorial.vue'
import CareGuides from './components/CareGuides.vue'
import SupportConfigs from './components/SupportConfigs.vue'
import PriceListManager from './components/PriceListManager.vue'
import SupportTickets from './components/SupportTickets.vue'
import CommentsModeration from './components/CommentsModeration.vue'
import Refunds from './components/Refunds.vue'
import InvoiceRequests from './components/InvoiceRequests.vue'
import PlatformOrderBinds from './components/PlatformOrderBinds.vue'
import StoreReceiptClaims from './components/StoreReceiptClaims.vue'
import ApprovalQueue from './components/ApprovalQueue.vue'
import ShippingRulesConfig from './components/ShippingRulesConfig.vue'
import Categories from './components/Categories.vue'
import PropertyEval from './components/PropertyEval.vue'
import CommandPalette from './components/CommandPalette.vue'
import MainTabsBar from './components/MainTabsBar.vue'
import { MODULES_BY_ID } from './utils/modulesRegistry'

/** 侧栏 HOME 项：名称/图标同样取自注册表，避免「经营驾驶舱」再手抄一遍 */
const homeNavItem = {
  id: '0',
  title: MODULES_BY_ID['0']?.name || '经营驾驶舱',
  icon: MODULES_BY_ID['0']?.icon || 'Odometer',
}
import { parseModuleHash, buildModuleHash } from './utils/moduleHash'
import { safeLocalSet } from './utils/safeStorage.js'
import { useTabsManager } from './composables/useTabsManager'
import { useRecentModules, RECENT_MODULES_KEY, RECENT_CHANGED_EVENT } from './composables/useRecentModules'

const { openTab: openTabAPI, activeTabId, closeOthers: closeOthersAPI, closeAll: closeAllAPI } = useTabsManager()
const { recentModules, recordRecent, loadRecent } = useRecentModules()

// ============ 动态组件映射（替代 47 条 v-else-if 链，让 keep-alive 真正缓存组件实例） ============
// 值为工厂函数：props 在 computed 求值时取（products 等响应式数据变更可触发更新）
const TAB_COMPONENT_MAP = {
  'nav-overview': () => ({ comp: AdminNavHub, props: { domainId: 'nav-overview' } }),
  'nav-business': () => ({ comp: AdminNavHub, props: { domainId: 'nav-business' } }),
  'nav-studio': () => ({ comp: AdminNavHub, props: { domainId: 'nav-studio' } }),
  'nav-customer': () => ({ comp: AdminNavHub, props: { domainId: 'nav-customer' } }),
  'nav-miniapp': () => ({ comp: AdminNavHub, props: { domainId: 'nav-miniapp' } }),
  'nav-governance': () => ({ comp: AdminNavHub, props: { domainId: 'nav-governance' } }),
  'nav-intelligence': () => ({ comp: AdminNavHub, props: { domainId: 'nav-intelligence' } }),
  '0': () => ({ comp: Dashboard }),
  '2': () => ({ comp: FinanceDashboard }),
  '3': () => ({ comp: OrderCenter }),
  '4': () => ({ comp: MemberOpsHub, props: { initialSection: hubSections['4'] || 'crm' } }),
  '5': () => ({ comp: ActivityManager }),
  '6': () => ({ comp: MarketingOpsHub, props: { initialSection: hubSections['6'] || 'assets' } }),
  '7': () => ({ comp: TeamManager, props: { initialSection: 'framer' } }),
  '9': () => ({ comp: ContentManager }),
  '10': () => ({ comp: StrategyResearch }),
  '58': () => ({ comp: ProductConceptGenerator }),
  '12': () => ({ comp: AICenter }),
  '13': () => ({ comp: HomeOpsHub, props: { initialSection: hubSections['13'] || 'layout' } }),
  '17': () => ({ comp: PermissionManager }),
  '18': () => ({ comp: SearchKeywordsManager }),
  '19': () => ({ comp: RecommendAlgorithmConfig }),
  '21': () => ({ comp: CustomReportBuilder }),
  '24': () => ({ comp: NotificationConfig }),
  '25': () => ({ comp: OperationsDecisionCenter, props: { products: products.value, orders: [] } }),
  '26': () => ({ comp: MonitorOpsHub, props: { initialSection: hubSections['26'] || 'live' } }),
  '27': () => ({ comp: PartnerDestinyCenter }),
  '28': () => ({ comp: ComplianceCenter }),
  '29': () => ({ comp: OperationsManual }),
  '30': () => ({ comp: StoreOpsHub, props: { initialSection: hubSections['30'] || 'erp' } }),
  '31': () => ({ comp: PayrollManagement }),
  '32': () => ({ comp: TeamManager, props: { initialSection: 'staff' } }),
  '33': () => ({ comp: CorporateGovernanceCenter }),
  '35': () => ({ comp: FranchiseManagement }),
  '36': () => ({ comp: CapitalArchitectureSandbox }),
  '50': () => ({ comp: StartupCostModel }),
  '51': () => ({ comp: ContentFactory }),
  '37': () => ({ comp: BookingOpsHub, props: { initialSection: hubSections['37'] || 'ops' } }),
  '38': () => ({ comp: CustomOrders }),
  '52': () => ({ comp: FulfillmentCenter }),
  '53': () => ({ comp: BrandVIS }),
  '39': () => ({ comp: PetMemorial }),
  '54': () => ({ comp: CareGuides }),
  '56': () => ({ comp: SupportConfigs }),
  '57': () => ({ comp: PriceListManager }),
  '40': () => ({ comp: SupportTickets }),
  '41': () => ({ comp: CommentsModeration }),
  '42': () => ({ comp: Refunds }),
  '59': () => ({ comp: InvoiceRequests }),
  '60': () => ({ comp: PlatformOrderBinds }),
  '65': () => ({ comp: StoreReceiptClaims }),
  '67': () => ({ comp: ApprovalQueue }),
  '61': () => ({ comp: ShippingRulesConfig }),
  '43': () => ({ comp: Categories }),
  '44': () => ({ comp: BehaviorOpsHub, props: { initialSection: hubSections['44'] || 'analytics' } }),
  '48': () => ({ comp: PropertyEval })
  ,
  // 2026-09-14 与小程序对齐补的四模块
  '72': () => ({ comp: DepositOps }),
  '73': () => ({ comp: LiveSessions }),
  '74': () => ({ comp: ArtisanCommissionRegistry }),
  '75': () => ({ comp: BirthdayGiftConfig }),
  '76': () => ({ comp: PurchaseOps }),
  '79': () => ({ comp: StoreShipments }),
  '78': () => ({ comp: FeishuSyncCenter }),
  '77': () => ({ comp: PropertyCostOps })
}
/**
 * 由模板**内联**渲染、天然不进 `TAB_COMPONENT_MAP` 的模块 id。
 *
 * 藏品档案库(1) 依赖 App.vue 里大量本地状态，因此走 `v-if="currentTab === '1'"` 分支。
 * 「未注册告警」必须把它也算作已注册的渲染方，否则打开 ERP 最常用的藏品库会误报
 * 「有 1 个模块 id 未注册，已回退经营驾驶舱」—— 而页面其实是正确的藏品库（实测踩过）。
 *
 * 新增内联模块时必须登记到这里；`npm run check:nav-sources` 会断言
 * 「每个规范模块都能被 TAB_COMPONENT_MAP 或本集合渲染」，漏登记即失败。
 */
const INLINE_TAB_IDS = new Set(['1'])

/** 该 tab 是否有渲染方（组件映射表或内联分支） */
const isRegisteredTab = (id) => !!TAB_COMPONENT_MAP[String(id)] || INLINE_TAB_IDS.has(String(id))

/**
 * **当前** tab 是否未注册。只反映眼前这一屏，不做会话级累计。
 *
 * 原实现是往 ref 里累计（`unknownTabs.value = [...unknownTabs.value, id]`）：先进过一个坏 id，
 * 之后切到任何正常模块，告警都还挂着「未注册 id：999 …… 当前展示的驾驶舱内容与该模块无关」——
 * 而眼前的页面其实完全正常。实测踩到（先进 #/m/999 再打开藏品档案库）。
 * 告警一旦说谎，就等于训练运营忽略它。
 */
const unknownTabs = computed(() =>
  isRegisteredTab(currentTab.value) ? [] : [String(currentTab.value)]
)

const activeModuleDef = computed(() => {
  const factory = TAB_COMPONENT_MAP[String(currentTab.value)]
  if (!factory) return { comp: Dashboard, props: {} } // 回退驾驶舱（告警见 watch(currentTab)）
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

const isNavHubTab = computed(() => String(currentTab.value || '').startsWith('nav-'))

/** 侧栏高亮：功能页高亮所属业务域；导航大屏/驾驶舱高亮自身 */
const sidebarActiveIndex = computed(() => {
  const tab = String(currentTab.value || '')
  if (tab === '0' || NAV_DOMAIN_IDS.includes(tab)) return tab
  return MODULE_TO_NAV_DOMAIN[tab] || tab
})

const domainContextBar = computed(() => {
  const tab = String(currentTab.value || '')
  if (!tab || tab === '0' || tab.startsWith('nav-')) return null
  const domainId = getNavOrigin(tab) || MODULE_TO_NAV_DOMAIN[tab]
  const domain = getNavDomain(domainId)
  if (!domain) return null
  const mod = MODULES_BY_ID[tab]
  return {
    domainId: domain.id,
    domainTitle: domain.title,
    moduleName: mod?.name || tab,
  }
})

const onNavHubOpen = (payload) => {
  const id = String(payload?.id || '')
  const domainId = String(payload?.domainId || '')
  if (!id) return
  if (domainId) setNavOrigin(id, domainId)
  handleMenuSelect(id)
}

const backToDomainHub = () => {
  const bar = domainContextBar.value
  if (!bar?.domainId) return
  openTabAPI(bar.domainId)
}

// 强制刷新当前 tab 的 key（reload-current 动作用）
const reloadKey = ref(0)
const forceReloadCurrent = () => { reloadKey.value++ }

// ============ 侧栏折叠 ============
const SIDEBAR_COLLAPSED_KEY = 'sc_admin_sidebar_collapsed'
const RECENT_COLLAPSED_KEY = 'sc_admin_recent_collapsed'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
const recentCollapsed = ref(localStorage.getItem(RECENT_COLLAPSED_KEY) === '1')
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
  safeLocalSet(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0')
  // 通知依赖布局宽度的图表/表格重算
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
}
const toggleRecentCollapsed = () => {
  recentCollapsed.value = !recentCollapsed.value
  safeLocalSet(RECENT_COLLAPSED_KEY, recentCollapsed.value ? '1' : '0')
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
  window.addEventListener('sidebar-groups-collapse', collapseAllGroups)
  window.addEventListener('sidebar-groups-expand', expandAllGroups)
  window.addEventListener('tabs-close-others', onTabsCloseOthers)
  window.addEventListener('tabs-close-all', onTabsCloseAll)
  window.addEventListener('reload-current', forceReloadCurrent)
  window.addEventListener('logout', onActionLogout)
  window.addEventListener('export-current', onExportCurrent)
}
const cleanupActionListeners = () => {
  window.removeEventListener('toggle-sidebar', toggleSidebar)
  window.removeEventListener('sidebar-groups-collapse', collapseAllGroups)
  window.removeEventListener('sidebar-groups-expand', expandAllGroups)
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
  } catch (e) {
    // 读取失败按「无置顶」处理是安全的；记录以便排查存储被禁用的情况
    console.warn('[App] 读取置顶模块失败（按空处理）', e?.message || e)
  }
}
const persistPinned = () => {
  safeLocalSet(PINNED_KEY, JSON.stringify(pinnedIds.value))
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
  if (e.key === RECENT_MODULES_KEY) loadRecent()
}

const SIDEBAR_OPENED_KEY = 'sc_admin_sidebar_openeds'
const loadOpeneds = () => {
  try {
    const raw = localStorage.getItem(SIDEBAR_OPENED_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(k => ALL_SUBMENUS.includes(k))
    }
  } catch (e) {
    console.warn('[App] 读取侧栏展开组失败（回落默认）', e?.message || e)
  }
  // 默认展开"业务运营"和"客户经营"
  return ['grp-business', 'grp-customer']
}
const defaultOpeneds = ref(loadOpeneds())
const persistOpeneds = () => {
  safeLocalSet(SIDEBAR_OPENED_KEY, JSON.stringify(defaultOpeneds.value))
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

/** 窄栏（仅图标）模式下垂直分组控件不可用 */
const canToggleGroups = () => !(sidebarCollapsed.value && !isMobile.value)

/** 兼容命令面板：收起最近常用（侧栏已无二级分组） */
const collapseAllGroups = () => {
  if (!canToggleGroups()) return
  recentCollapsed.value = true
  safeLocalSet(RECENT_COLLAPSED_KEY, '1')
}

/** 兼容命令面板：展开最近常用 */
const expandAllGroups = () => {
  if (!canToggleGroups()) return
  recentCollapsed.value = false
  safeLocalSet(RECENT_COLLAPSED_KEY, '0')
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
    channel: '', craftType: '', craftProcess: '',
    latinName: '', description: '', tags: [], tagDraft: '', giftScenes: [], isTreasure: false, isOneOfAKind: true, inArchive: true, memberDiscountEnabled: true,
    supportsCustom: false,
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
const giftSceneOptions = GIFT_SCENES
const productMediaUploading = ref(false)
const latinAiLoading = ref(false)
const productAiFillLoading = ref(false)
/** 用户在库存=1 时手动关掉孤品后，不再因 stock===1 反复强开 */
const oneOfAKindManualOff = ref(false)
const categoryCascaderOptions = ref([])
const categoryFlatMap = ref({}) // id -> category doc
const framerOptions = ref([])

const emptyTaxonomy = () => ({ kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' })

const productFormRef = ref(null)

/**
 * 藏品表单校验。
 * 审计 P1：全仓 el-form 90 处但 `:rules` 仅 16 处，校验都靠会消失的 `ElMessage.warning`，
 * 而这是一个 43 字段的弹窗 —— 报错后运营不知道该回去改哪个框。
 * 这里把原有三条业务校验（名称 / 拉丁学名 / 收藏证书）改为字段内联错误。
 */
const productRules = computed(() => ({
    title: [{ required: true, message: '请输入藏品名称', trigger: 'blur' }],
    latinName: [{
        validator: (rule, value, callback) => {
            // 标本类必填；商品类（周边/文创）不要求
            if (isMerchandiseProduct(form.value)) return callback()
            if (!String(value || '').trim()) {
                return callback(new Error('标本类藏品须填写拉丁学名（与店长端一致）'))
            }
            callback()
        },
        trigger: 'blur'
    }],
    collectionCertificate: [{
        validator: (rule, value, callback) => {
            const needs = form.value.protectionType && form.value.protectionType !== 'none'
            if (needs && !String(value || '').trim()) {
                return callback(new Error('请上传收藏证书（保护类标本必填）'))
            }
            callback()
        },
        trigger: 'change'
    }]
}))

/** 科学分类展示/落库：拉丁层级名归一为中文 */
const normalizeFormTaxonomy = (raw) => {
    const base = toChineseTaxonomy(raw || {})
    return {
        kingdom: base.kingdom || '',
        phylum: base.phylum || '',
        class: base.class || '',
        order: base.order || '',
        family: base.family || '',
        genus: base.genus || ''
    }
}

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

const CHANNEL_LABEL_MAP = {
    import: '进口',
    domestic: '国产',
    wild: '野采',
    other: '其它'
}

const CRAFT_TYPE_LABEL_MAP = {
    frame: '相框',
    cloche: '方形玻璃罩',
    cloche_round: '圆形玻璃罩',
    cloche_cylinder: '圆柱形玻璃罩',
    diorama: '造景',
    magnet: '冰箱贴',
    accessory: '饰品',
    jewelry: '饰品',
    wing_art: '蝶翅画',
    other: '其它'
}

const CRAFT_PROCESS_LABEL_MAP = {
    immersion: '浸制',
    plastination: '塑化',
    taxidermy: '剥制',
    other: '其它'
}

const TAXONOMY_ELIGIBLE_RE = /昆虫|植物|海洋|动物|蝴蝶|鳞翅|蝶/

const isMerchandiseProduct = (f) => {
    if (!f) return false
    if (f.categoryType === 'merch') return true
    const text = `${f.rootCategoryName || ''}${f.category || ''}`
    return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|陈饰|联名/.test(text)
}

const isMerchandiseForm = computed(() => isMerchandiseProduct(form.value))

/** 渠道 / 装裱方式 / 制作工艺：昆虫·植物·海洋·动物（含蝴蝶二级） */
const isTaxonomyEligibleProduct = computed(() => {
    const f = form.value || {}
    const blob = [f.rootCategoryName, f.category].filter(Boolean).join(' ')
    return TAXONOMY_ELIGIBLE_RE.test(blob)
})
/** @deprecated 保留别名，语义已对齐 isTaxonomyEligibleProduct */
const isButterflyProduct = isTaxonomyEligibleProduct
const isCraftEligibleProduct = isTaxonomyEligibleProduct
const archiveFilter = ref('all') // 'all' | 'archive' | 'oneOfAKind' 全部 / 仅档案藏品 / 仅孤品
const promoFilter = ref('all') // 'all' | 'seckill' | 'seckill_expired' | 'group'
const productSearchQuery = ref('')
const productPage = ref(1)
const productPageSize = ref(50)
const productsTotal = ref(0)
const productsServerFiltered = ref(false)

// =================================================
// 🔐 认证与会话管理
// =================================================

// =================================================
// 🔗 模块级深链（#/m/<moduleId>）—— 审计 §0 P0-16
// 目的：任何模块都能直达、分享、收藏；刷新后停在原模块（此前 101 个模块都必须
//       「域大屏 → 找卡片」，且全仓只处理 #admin 一个 hash）。
// 约定：登录后 hash 一律为 #/m/<id>；#admin 保留为「已登录但未选模块」的兼容写法。
// =================================================
function readModuleFromHash() {
    return parseModuleHash(window.location.hash)
}

/** 把模块写进 hash。用 replaceState：切模块不塞历史记录，否则「返回」要按很多次 */
function syncModuleHash(moduleId) {
    if (!isLoggedIn.value) return
    const next = buildModuleHash(moduleId)
    if (!next) return
    if (window.location.hash === next) return
    window.history.replaceState(
        null, '',
        `${window.location.pathname}${window.location.search}${next}`
    )
}

/**
 * 把 hash 里的模块 id 应用为当前标签。
 *
 * 2026-09-16 审计（浏览器实测发现）：这里原先直接 `activeTabId.value = id`，
 * 绕过了 `useTabsManager.openTab()`，于是 `activeTabId` 变了而 `openTabs` 没变 ——
 * 实测粘 `#/m/42` 打开退款审核：面包屑/主区/域返回条都已切到「退款审核」，
 * 但**标签栏仍只显示「经营驾驶舱」且无 42 号标签**，用户看着标签栏找不到自己在哪。
 * 另外别名深链（`#/m/16`）未归一化，会被 `watch(currentTab)` 误报为「未注册模块」。
 *
 * 现在：已注册（含别名归一化）→ 走 openTab，主区与标签栏必然一致；
 * 未注册 → 仍然切过去，交给 `watch(currentTab)` 记录并渲染可见告警（不静默无反应）。
 */
function applyHashModule(id) {
    const key = resolveModuleOpen(id)
    if (MODULES_BY_ID[key]) openTabAPI(id)
    else activeTabId.value = String(id)
}

/** 登录后首次应用深链；没有深链就把当前默认模块写进去，便于直接收藏当前页 */
function applyModuleHashOnce() {
    const id = readModuleFromHash()
    if (id && id !== String(currentTab.value || '')) {
        applyHashModule(id)
    } else {
        syncModuleHash(currentTab.value)
    }
}

/** 外部改 hash（粘贴链接 / 前进后退）时同步模块 */
function onModuleHashChange() {
    const id = readModuleFromHash()
    if (id && id !== String(currentTab.value || '')) {
        applyHashModule(id)
    }
}

function setAdminHash(on) {
    const path = `${window.location.pathname}${window.location.search}`
    if (on) {
        // 已有模块深链时不要覆盖成 #admin（否则分享出去的链接会丢模块）
        if (readModuleFromHash()) {
            syncModuleHash(currentTab.value)
            return
        }
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
        applyModuleHashOnce()
        if (currentTab.value === '1') loadProducts()
    }
}

const handleLogin = async () => {
    if (!password.value) return ElMessage.warning('请输入管理口令')
    loggingIn.value = true

    // 先建立**服务端**会话：/api/admin-session 校验 ADMIN_PROXY_PASSWORD 并下发 HttpOnly Cookie。
    // 管理类云函数代理 /api/cloud-fn 依赖该 Cookie 才会注入 ADMIN_OPS_KEY，故必须先于前端放行。
    const session = await establishAdminSession(password.value).catch((e) => ({
        ok: false, skipped: false, msg: e?.message || '管理会话接口异常',
    }))

    if (!session.ok) {
        loggingIn.value = false
        ElMessage.error(session.msg || '口令错误或无权访问，请联系管理员确认口令')
        password.value = ''
        return
    }
    // 服务端未部署（本地开发）时降级为前端口令门禁
    if (session.skipped && password.value !== ADMIN_SECRET) {
        loggingIn.value = false
        ElMessage.error('口令错误或无权访问，请联系管理员确认口令')
        password.value = ''
        return
    }

    isLoggedIn.value = true
    localStorage.setItem('sc_admin_token', 'verified_888')
    setAdminHash(true)
    applyModuleHashOnce()
    ElMessage.success({ message: '身份验证通过，欢迎回来', duration: 2000 })
    loggingIn.value = false
}

const logout = () => {
    ElMessageBox.confirm('确定要退出管理系统吗？', '提示', {
        confirmButtonText: '退出',
        cancelButtonText: '取消',
        type: 'warning'
    }).then(async () => {
        try {
            await clearAdminSession()
        } catch (e) {
            // 会话清理失败不能静默：否则人以为已退出、实际服务端会话仍在
            console.error('退出登录时清理服务端会话失败', e)
            ElMessage.warning(`服务端会话清理失败（本地已退出）：${e?.message || '未知错误'}`)
        }
        localStorage.removeItem('sc_admin_token')
        isLoggedIn.value = false
        password.value = ''
        setAdminHash(false)
        ElMessage.info('已安全退出')
    }).catch((e) => {
        if (e !== 'cancel' && e !== 'close') console.error('退出确认框异常', e)
    })
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
                console.warn('[App] 清除表格选择失败（已忽略）', e?.message || e)
            }
        }
    }

    const raw = String(index)
    const resolved = resolveModuleOpen(raw)
    // 驾驶舱 / 命令面板 / Hub 进入功能页时统一记录返回域，保证「返回」可靠
    if (resolved && !resolved.startsWith('nav-') && resolved !== '0') {
        const from = String(currentTab.value || '')
        const domainId = from.startsWith('nav-')
            ? from
            : (MODULE_TO_NAV_DOMAIN[resolved] || null)
        if (domainId) setNavOrigin(resolved, domainId)
    }

    // 🟢 走 tabs manager：自动添加到多标签栏并激活
    openTabAPI(raw)
    // 移动端选择菜单后自动关闭菜单
    if (isMobile.value) {
        mobileMenuVisible.value = false
    }
    // 懒加载：仅在切换到藏品库且需要时加载
    if (resolved === '1' || raw === '1') {
        try {
            const promo = sessionStorage.getItem('sc_archive_promo_filter')
            if (promo === 'seckill' || promo === 'seckill_expired' || promo === 'group' || promo === 'all') {
                promoFilter.value = promo
                sessionStorage.removeItem('sc_archive_promo_filter')
            }
        } catch (e) {
            console.warn('[App] 清理归档促销筛选标记失败（已忽略）', e?.message || e)
        }
        // 使用nextTick确保组件已挂载后再加载数据
        nextTick(() => {
            // 再次检查是否仍在当前tab
            if (currentTab.value === '1') {
                loadProducts()
            }
        })
    }
}

// 记录最近常用；侧栏已无二级 submenu，不再自动 open 分组
watch(currentTab, (tab) => {
    if (isLoggedIn.value) {
        recordRecent(tab)
        syncModuleHash(tab)
    }
    // 未注册的模块 id：原先静默回退驾驶舱，现在留痕 + 可见提示（审计 P2）。
    // 提示内容本身是 computed（只看当前 tab），这里只负责留痕，避免告警变成会话级累计。
    const id = String(tab || '')
    if (id && !isRegisteredTab(id)) {
        console.error(
            `[App] 未注册的模块 id "${id}"：TAB_COMPONENT_MAP 与 INLINE_TAB_IDS 都没有渲染方，已回退经营驾驶舱。` +
            '请检查 modulesRegistry 与 TAB_COMPONENT_MAP 是否同步。'
        )
    }
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

const escapeRegExpClient = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const enrichProductRows = async (rows) => {
    const list = await Promise.all((rows || []).map(async (item) => {
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
                tags: readProductTags(item),
                displayTags: readProductTags(item).slice(0, 4),
                giftScenes: readGiftScenes(item),
                httpImage: img,
                isOnShelf: !item.isOffShelf,
                profitRate: (() => {
                    const pr = parseFloat(item.price)
                    const cp = parseFloat(item.costPrice)
                    if (!Number.isFinite(pr) || pr === 0 || !Number.isFinite(cp)) return '0.0'
                    return (((pr - cp) / pr) * 100).toFixed(1)
                })()
            }
        } catch (itemErr) {
            console.error('处理商品项失败:', itemErr, item)
            return null
        }
    }))
    return list.filter((item) => item !== null)
}

const buildClientProductWhere = async () => {
    const db = await getCdnDatabase()
    const _ = db.command
    const keyword = String(productSearchQuery.value || '').trim().slice(0, 64)
    const conditions = []
    if (archiveFilter.value === 'archive') conditions.push({ inArchive: true })
    else if (archiveFilter.value === 'oneOfAKind') conditions.push({ isOneOfAKind: true })
    if (promoFilter.value === 'group') conditions.push({ 'groupBuying.enabled': true })
    else if (promoFilter.value === 'seckill' || promoFilter.value === 'seckill_expired') {
        conditions.push({ 'seckill.enabled': true })
    }
    if (keyword && typeof db.RegExp === 'function') {
        const re = db.RegExp({ regexp: escapeRegExpClient(keyword), options: 'i' })
        conditions.push(_.or([{ title: re }, { latinName: re }, { category: re }, { tags: re }]))
    }
    if (!conditions.length) return null
    if (conditions.length === 1) return conditions[0]
    return _.and(conditions)
}

/** CDN 直读兜底：匿名端单次常限 20 条，用 skip 循环凑满当前页 */
const loadProductsViaCdnPage = async () => {
    const page = productPage.value
    const pageSize = productPageSize.value
    const skip = (page - 1) * pageSize
    const where = await buildClientProductWhere()
    const needsMemoryPromo =
        promoFilter.value === 'seckill' || promoFilter.value === 'seckill_expired'

    if (needsMemoryPromo) {
        const matched = []
        let cursor = 0
        const MAX = 3000
        while (matched.length < skip + pageSize && cursor < MAX) {
            const batch = await cdnQueryPage(COLLECTIONS.PRODUCTS, {
                where,
                skip: cursor,
                limit: 20
            })
            if (!batch.length) break
            batch.forEach((row) => {
                if (promoFilter.value === 'seckill' && row?.seckill?.enabled && !isSeckillExpired(row)) {
                    matched.push(row)
                } else if (promoFilter.value === 'seckill_expired' && isSeckillExpired(row)) {
                    matched.push(row)
                }
            })
            cursor += batch.length
            if (batch.length < 20) break
        }
        // 继续扫完以得到较准确 total（上限内）
        while (cursor < MAX) {
            const batch = await cdnQueryPage(COLLECTIONS.PRODUCTS, {
                where,
                skip: cursor,
                limit: 20
            })
            if (!batch.length) break
            batch.forEach((row) => {
                if (promoFilter.value === 'seckill' && row?.seckill?.enabled && !isSeckillExpired(row)) {
                    matched.push(row)
                } else if (promoFilter.value === 'seckill_expired' && isSeckillExpired(row)) {
                    matched.push(row)
                }
            })
            cursor += batch.length
            if (batch.length < 20) break
        }
        matched.sort((a, b) => (Number(b.createTime) || 0) - (Number(a.createTime) || 0))
        productsTotal.value = matched.length
        return matched.slice(skip, skip + pageSize)
    }

    try {
        productsTotal.value = await cdnCount(COLLECTIONS.PRODUCTS, where)
    } catch (e) {
        console.warn('cdnCount products', e)
        productsTotal.value = 0
    }

    const rows = []
    let cursor = skip
    while (rows.length < pageSize) {
        const take = Math.min(20, pageSize - rows.length)
        const batch = await cdnQueryPage(COLLECTIONS.PRODUCTS, {
            where,
            skip: cursor,
            limit: take
        })
        if (!batch.length) break
        rows.push(...batch)
        cursor += batch.length
        if (batch.length < take) break
    }
    return [...rows].sort((a, b) => (Number(b.createTime) || 0) - (Number(a.createTime) || 0))
}

const resetProductPageAndLoad = () => {
    productPage.value = 1
    loadProducts()
}

const onProductPageSizeChange = () => {
    productPage.value = 1
    loadProducts()
}

const loadProducts = async () => {
    if (!isLoggedIn.value) return
    loading.value = true
    try {
        let rows = []
        productsServerFiltered.value = false
        try {
            const res = await callCloudFunction('manageProducts', {
                action: 'list',
                page: productPage.value,
                pageSize: productPageSize.value,
                keyword: String(productSearchQuery.value || '').trim(),
                archiveFilter: archiveFilter.value,
                promoFilter: promoFilter.value
            })
            if (res && res.success !== false && Array.isArray(res.list)) {
                rows = res.list
                productsTotal.value = Number(res.total) || 0
                productsServerFiltered.value = true
            } else {
                throw new Error(res?.msg || 'manageProducts list 失败')
            }
        } catch (fnErr) {
            console.warn('manageProducts list 回退 CDN 分页:', fnErr?.message || fnErr)
            rows = await loadProductsViaCdnPage()
            productsServerFiltered.value = !!(
                String(productSearchQuery.value || '').trim()
                || archiveFilter.value !== 'all'
                || promoFilter.value !== 'all'
            )
        }

        if (!Array.isArray(rows)) {
            console.warn('商品数据格式异常:', rows)
            products.value = []
            productsTotal.value = 0
            return
        }

        products.value = await enrichProductRows(rows)
    } catch (err) {
        console.error('加载商品失败', err)
        ElMessage.error('查询藏品档案失败: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

const toggleShelf = async (row) => {
    const onShelf = !!row.isOnShelf
    const prev = row.isOnShelf
    try {
        const res = await callCloudFunction('manageApprovals', {
            action: 'submitProductShelf',
            productId: row._id,
            onShelf
        })
        if (!res || res.success === false) {
            row.isOnShelf = !prev
            ElMessage.error(res?.msg || '状态更新失败')
            return
        }
        if (res.pendingApproval) {
            row.isOnShelf = false
            ElMessage.success(res.msg || '已提交上架审批')
        } else {
            ElMessage.success(res.msg || (onShelf ? '商品已上架' : '商品已下架'))
        }
    } catch (err) {
        row.isOnShelf = !prev
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
// 筛选/搜索已在 loadProducts（云函数 list 或 CDN 分页）完成，此处不再二次截断
const displayProducts = computed(() => products.value || [])

/** 单品计 1；开启多规格且有 skus 时按规格条数计（非库存 stock） */
const countProductSkus = (p) => {
    if (p?.hasSku && Array.isArray(p.skus) && p.skus.length > 0) return p.skus.length
    return 1
}

const displaySkuCount = computed(() =>
    (displayProducts.value || []).reduce((sum, p) => sum + countProductSkus(p), 0)
)

const displaySkuCountTitle = computed(() => {
    const total = productsTotal.value || 0
    const pageN = displayProducts.value?.length || 0
    const skusN = displaySkuCount.value
    return `全库/筛选合计 ${total} 件；本页 ${pageN} 件、${skusN} 个 SKU`
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
            updateProduct(p._id, {
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

// 批量上下架（上架走审批闸门 manageApprovals；下架直通）
const handleBatchToggleShelf = async (isOnShelf) => {
    if (selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择商品')
        return
    }

    const action = isOnShelf ? '上架' : '下架'
    ElMessageBox.confirm(
        isOnShelf
            ? `确认批量提交上架审批 ${selectedProducts.value.length} 个商品？非超管账号将进入待审队列。`
            : `确认批量下架 ${selectedProducts.value.length} 个商品吗？`,
        `批量${action}确认`,
        {
            confirmButtonText: `确认${action}`,
            cancelButtonText: '取消',
            type: 'warning'
        }
    ).then(async () => {
        try {
            loading.value = true
            if (!isOnShelf) {
                const promises = selectedProducts.value.map(product =>
                    updateProduct(product._id, {
                        isOffShelf: true,
                        updateTime: Date.now()
                    })
                )
                await Promise.all(promises)
                ElMessage.success(`成功下架 ${selectedProducts.value.length} 个商品`)
            } else {
                let pending = 0
                let direct = 0
                let failed = 0
                for (const product of selectedProducts.value) {
                    try {
                        const res = await callCloudFunction('manageApprovals', {
                            action: 'submitProductShelf',
                            productId: product._id,
                            onShelf: true
                        })
                        if (res && res.pendingApproval) pending += 1
                        else if (res && res.success) direct += 1
                        else failed += 1
                    } catch (e) {
                        failed += 1
                    }
                }
                ElMessage.success(
                    `上架完成：直通 ${direct} · 待审 ${pending}${failed ? ` · 失败 ${failed}` : ''}`
                )
            }
            clearProductSelection()
            loadProducts()
        } catch (err) {
            console.error(`批量${action}失败:`, err)
            ElMessage.error(`批量${action}失败: ${err.message || '未知错误'}`)
        } finally {
            loading.value = false
        }
        }).catch((e) => {
        // 只吞用户取消；意外异常必须留痕
        if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
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
                return updateProduct(p._id, { seckill: next, updateTime: Date.now() })
            }
            const next = { ...(p.groupBuying || {}), enabled: !!enabled }
            return updateProduct(p._id, { groupBuying: next, updateTime: Date.now() })
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
            return updateProduct(p._id, { seckill: next, updateTime: Date.now() })
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
            return updateProduct(p._id, { seckill: next, updateTime: Date.now() })
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

                return updateProduct(product._id, {
                    price: Math.max(0, newPrice),
                    updateTime: Date.now()
                }).catch(err => {
                    console.error(`商品${product._id}调价失败:`, err)
                    return null
                })
            })

            const results = await Promise.all(promises)
            const successCount = results.filter(r => r !== null).length
            const failCount = results.length - successCount
            if (failCount > 0) {
                // 一个都没写进去还说「成功调整 0 个」会让人以为操作正常
                ElMessage.error(`价格调整：成功 ${successCount} 个，失败 ${failCount} 个 —— 失败项未落库（products 集合为只读，需服务端通道）`)
            } else {
                ElMessage.success(`成功调整 ${successCount} 个商品价格`)
            }
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
        }).catch((e) => {
        // 只吞用户取消；意外异常必须留痕
        if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
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

                return updateProduct(product._id, {
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
        }).catch((e) => {
        // 只吞用户取消；意外异常必须留痕
        if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
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
            标签: readProductTags(product).join('、'),
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
            sortFn: (a, b) => (a.sort ?? a.sortOrder ?? 0) - (b.sort ?? b.sortOrder ?? 0)
        })
        const subs = await fetchCollectionSorted(COLLECTIONS.CATEGORIES, {
            limit: 500,
            where: { level: 2 },
            sortFn: (a, b) => (a.sort ?? a.sortOrder ?? 0) - (b.sort ?? b.sortOrder ?? 0)
        })
        const activeRoots = (roots || []).filter(isActiveCategory)
        const activeSubs = (subs || []).filter(isActiveCategory)
        const flat = {}
        activeRoots.forEach((r) => { flat[r._id] = r })
        activeSubs.forEach((s) => { flat[s._id] = s })
        categoryFlatMap.value = flat
        categoryCascaderOptions.value = activeRoots.map((r) => ({
            value: r._id,
            label: r.name,
            children: activeSubs
                .filter((s) => s.parentId === r._id)
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
    channel: '', craftType: '', craftProcess: '',
    latinName: '', description: '', tags: [], tagDraft: '', giftScenes: [], isTreasure: false, isOneOfAKind: true, inArchive: true, memberDiscountEnabled: true,
    supportsCustom: false,
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
    if (!TAXONOMY_ELIGIBLE_RE.test(blob)) {
        form.value.channel = ''
        form.value.craftType = ''
        form.value.craftProcess = ''
    }
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
            // 无证书时不自动升为保护类，避免「一键补齐」后被收藏证书校验卡死无法保存
            const hasCert = !!String(form.value.collectionCertificate || '').trim()
            if (pt === 'none') {
                form.value.protectionType = 'none'
                form.value.collectionCertificate = ''
            } else if (hasCert) {
                form.value.protectionType = pt
            } else if (pt !== (form.value.protectionType || 'none')) {
                ElMessage.warning(`AI 建议保护等级「${pt}」，请确认后手动选择并上传收藏证书`)
            }
        }
    }

    const tax = d.taxonomy || {}
    const prevTax = form.value.taxonomy || emptyTaxonomy()
    const nextTax = normalizeFormTaxonomy({
        kingdom: tax.kingdom || prevTax.kingdom || '',
        phylum: tax.phylum || prevTax.phylum || '',
        class: tax.class || prevTax.class || '',
        order: tax.order || prevTax.order || '',
        family: tax.family || prevTax.family || '',
        genus: tax.genus || prevTax.genus || '',
    })
    form.value.taxonomy = nextTax
    const incoming = sanitizeProductTags(d.tags)
    if (incoming.length) {
        form.value.tags = sanitizeProductTags([...(form.value.tags || []), ...incoming])
    }
    return latinName
}

const addProductTag = () => {
    const current = form.value.tags || []
    const next = sanitizeProductTags([...current, form.value.tagDraft])
    if (next.length === current.length && String(form.value.tagDraft || '').trim()) {
        ElMessage.warning(current.length >= MAX_TAGS ? '最多 10 个标签' : '标签无效或已存在')
    }
    form.value.tags = next
    form.value.tagDraft = ''
}

const removeProductTag = (tag) => {
    form.value.tags = (form.value.tags || []).filter((item) => item !== tag)
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
        form.value.craftProcess = ''
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
    if (!TAXONOMY_ELIGIBLE_RE.test(blob)) {
        form.value.channel = ''
        form.value.craftType = ''
        form.value.craftProcess = ''
    }

    // 与店长端一致：二级分类带 taxonomy 时预填科学分类
    const tax = (sub && sub.taxonomy) || (root && root.taxonomy) || null
    if (tax && typeof tax === 'object') {
        form.value.taxonomy = normalizeFormTaxonomy({
            kingdom: tax.kingdom || '',
            phylum: tax.phylum || '',
            class: tax.class || '',
            order: tax.order || '',
            family: tax.family || '',
            genus: tax.genus || ''
        })
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
        if (sanitizeProductTags(d.tags).length) parts.push('标签')
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
        craftProcess: row.craftProcess || '',
        latinName: row.latinName || '',
        description: row.description || '',
        tags: readProductTags(row),
        tagDraft: '',
        giftScenes: readGiftScenes(row),
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
        taxonomy: normalizeFormTaxonomy({
            kingdom: tax.kingdom || '',
            phylum: tax.phylum || '',
            class: tax.class || '',
            order: tax.order || '',
            family: tax.family || '',
            genus: tax.genus || ''
        }),
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
    const productId = String(row?._id || '').trim()
    if (!productId) {
        ElMessage.error('缺少藏品 ID，无法删除')
        return
    }
    ElMessageBox.confirm(
        `确定要永久删除藏品《${row.title}》吗?`, '高风险操作',
        { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    ).then(async () => {
        try {
            // products 集合 write:false：禁止 CDN 直删，须走 manageProducts.remove（硬删）
            const res = await callCloudFunction('manageProducts', {
                action: 'remove',
                productId
            })
            if (!res || res.success === false) {
                throw new Error(res?.msg || '删除失败')
            }
            // 立即从当前页移除并刷新总数，再拉齐服务端
            products.value = (products.value || []).filter((p) => p && p._id !== productId)
            productsTotal.value = Math.max(0, (Number(productsTotal.value) || 0) - 1)
            ElMessage.success('档案已销毁')
            await loadProducts()
        } catch (err) {
            console.error('删除失败', err)
            ElMessage.error('删除失败: ' + (err.message || '未知错误'))
        }
        }).catch((e) => {
        // 只吞用户取消；意外异常必须留痕
        if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

const saveProduct = async () => {
    // 内联校验优先：错误直接标在对应字段下方（43 字段弹窗里 toast 会让人找不到北）
    const formRef = productFormRef.value
    if (formRef) {
        try {
            await formRef.validate()
        } catch {
            ElMessage.warning('请先修正表单中标红的必填项')
            return
        }
    } else if (!form.value.title) {
        // 兜底：表单未挂载时仍不能放过空名称
        return ElMessage.warning('请输入藏品名称')
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
        const channelOk = TAXONOMY_ELIGIBLE_RE.test(blob)
        const craftOk = channelOk
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
        const tax = normalizeFormTaxonomy(form.value.taxonomy || emptyTaxonomy())
        form.value.taxonomy = tax
        let collectionCertificate = String(form.value.collectionCertificate || '').trim()
        if (!needsCert) collectionCertificate = ''

        // 元为单位的数值；与店长端 / manageProducts 一致，禁止 CDN 直写 products（write:false）
        const safePrice = Number.isFinite(Number(price)) ? Math.max(0, Number(price)) : 0
        const safeCost = Number.isFinite(Number(form.value.costPrice))
            ? Math.max(0, Number(form.value.costPrice))
            : 0
        const safeStock = Number.isFinite(Number(stock)) ? Math.max(0, Math.floor(Number(stock))) : 0

        const data = {
            title: form.value.title,
            price: safePrice,
            costPrice: safeCost,
            stock: safeStock,
            category: form.value.category || '',
            categoryId: form.value.categoryId || '',
            rootCategoryId: form.value.rootCategoryId || '',
            rootCategoryName: form.value.rootCategoryName || '',
            categoryType: form.value.categoryType || '',
            channel: channelOk ? (form.value.channel || '') : '',
            craftType: craftOk ? (form.value.craftType || '') : '',
            craftProcess: craftOk ? (form.value.craftProcess || '') : '',
            latinName: form.value.latinName || '',
            description: form.value.description || '',
            tags: sanitizeProductTags(form.value.tags),
            giftScenes: sanitizeGiftScenes(form.value.giftScenes),
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
            supportsCustom: !!form.value.supportsCustom,
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

        const productId = isEditing.value ? String(form.value._id || '').trim() : ''
        if (isEditing.value && !productId) {
            throw new Error('藏品 ID 缺失，请关闭后重新打开编辑')
        }

        // 上下架仅 manageApprovals；upsert 会剥离 isOffShelf，新建默认下架
        const res = await callCloudFunction('manageProducts', {
            action: 'upsert',
            productId,
            data
        })
        if (!res || res.success === false) {
            throw new Error(res?.msg || '保存失败')
        }

        ElMessage.success(isEditing.value ? '更新成功' : '创建成功（默认下架，上架请走审批）')
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
    onModuleHashChange()
}

onMounted(() => {
    // 代理会话过期（/api/cloud-fn 返回 401）时立即回到口令门禁，避免页面静默失效
    window.addEventListener('sc-admin-session-expired', () => {
        isLoggedIn.value = false
        password.value = ''
        setAdminHash(false)
        ElMessage.warning('管理会话已过期，请重新输入口令')
    })
    stripLegacyBrandHashes()
    checkSession()
    loadPinned()
    loadRecent()
    window.addEventListener('hashchange', onHashLegacyCleanup)
    window.addEventListener('storage', onStorage)
    window.addEventListener('pinned-changed', loadPinned) // 同页内命令面板置顶 → 侧栏同步
    window.addEventListener(RECENT_CHANGED_EVENT, loadRecent)
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
    window.removeEventListener(RECENT_CHANGED_EVENT, loadRecent)
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
    background: linear-gradient(180deg, #1c1a17 0%, #2e2517 100%);
    display: flex; flex-direction: column; 
    border-right: 1px solid var(--border-dark); 
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.3);
    z-index: 10;
    position: relative;
    transition: width 0.25s ease;
    overflow-x: hidden;
}

/* 左侧菜单 —— 黑金：近黑底 + 金饰（此注释原先写着「黑金」但底色是品牌绿，2026-09-16 已改为事实描述） */
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
    padding-right: 12px;
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
.brand-row {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
}
.brand-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
}
.mobile-drawer-header .brand-actions {
    margin-left: auto;
}
.mobile-drawer-header .mobile-sidebar-close {
    margin-left: 2px;
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
    flex-shrink: 0;
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

/* 左侧菜单 —— 近黑底 + 金饰（激活态为金色左侧条） */
.el-menu { 
    border-right: none !important; 
    margin-top: 10px; 
    background: transparent !important;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
}
.el-menu-item-group__title { 
    padding: 16px 0 10px 24px !important; 
    font-size: 10px; 
    color: var(--text-dark-muted) !important; 
    letter-spacing: 0.15em; 
    font-weight: 600;
    text-transform: uppercase;
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
    background: var(--bg-dark-active) !important; 
    color: var(--gold-300) !important; 
    font-weight: 600; 
    box-shadow: inset 2px 0 0 var(--gold-500);
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

/* 🟢 侧栏一键缩放（左右）+ 分组展开/收起（上下） */
.collapse-btn {
    margin-left: 0 !important;
    color: rgba(245, 242, 236, 0.5) !important;
    padding: 6px !important;
    min-height: 32px;
    border-radius: 8px !important;
}
.collapse-btn:hover { color: #d4af37 !important; background: rgba(212, 175, 55, 0.12) !important; }
.collapse-btn--rail {
    margin: 0 !important;
    width: 40px;
    height: 32px;
}
.aside.is-collapsed .brand-header {
    height: auto;
    min-height: 80px;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 6px;
    padding: 12px 0 10px !important;
}
.aside.is-collapsed .brand-header::after {
    left: 12px;
    right: 12px;
}
.aside.is-collapsed .brand-row {
    justify-content: center;
    width: auto;
}
.aside.is-collapsed .brand-logo {
    margin: 0;
}
.aside.is-collapsed .el-menu-item-group__title {
    display: none !important;
    padding: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    overflow: hidden;
}
.aside.is-collapsed .el-menu-item,
.aside.is-collapsed .el-sub-menu__title {
    margin: 4px 8px !important;
    padding: 0 !important;
    justify-content: center;
}
.aside.is-collapsed .el-menu-item .el-icon,
.aside.is-collapsed .el-sub-menu__title .el-icon {
    margin-right: 0 !important;
}
.aside.is-collapsed .sidebar-footer {
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}
.aside.is-collapsed .sidebar-footer .user-badge {
    margin-bottom: 4px;
    padding: 0;
    justify-content: center;
}
.aside.is-collapsed .sidebar-footer .mobile-access-btn,
.aside.is-collapsed .sidebar-footer .logout-btn {
    width: auto;
    min-width: 40px;
    justify-content: center;
    padding: 8px !important;
}
.aside.is-collapsed .sidebar-footer .mobile-access-btn .el-icon,
.aside.is-collapsed .sidebar-footer .logout-btn .el-icon {
    margin: 0;
}

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

/* 🟢 最近常用 */
.recent-section {
    margin: 0 8px 12px;
    padding: 6px 0 8px;
    border-bottom: 1px dashed rgba(255,255,255,0.08);
}
.recent-title {
    padding: 6px 14px 4px;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6B6560;
}
.recent-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    cursor: pointer;
    border-radius: 6px;
    margin: 1px 4px;
    transition: 0.15s;
}
.recent-item:hover {
    background: rgba(255, 255, 255, 0.06);
}
.recent-item.active {
    background: rgba(212, 175, 55, 0.14);
}
.recent-item.active .recent-name,
.recent-item.active .recent-ico {
    color: #d4af37;
}
.recent-item.active .recent-name {
    font-weight: 600;
}
.recent-ico {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    font-size: 14px;
    color: rgba(245, 242, 236, 0.45);
    overflow: hidden;
}
.recent-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: rgba(245, 242, 236, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

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
    background: rgba(28, 26, 23, 0.55);
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

/* 内容区 —— 浅色工作台。黑金刻意只放在外壳与点缀：
   ERP 每天长时间处理密集表格，工作台保持浅色以守住效率与视觉舒适度（2026-09-16 品牌适配决策）。 */
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
/* 未注册模块告警：transition/keep-alive 的同级兄弟（不能放进两者内部） */
.unknown-tabs-alert {
    margin: 0 0 14px;
}
.content-scroll-wrap.is-nav-hub {
    padding: 0;
    background: #f2ede4;
}
.content-scroll-wrap.is-embed-page:not(.is-nav-hub) {
    padding: 0;
}
.domain-context-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    padding: 10px 14px;
    background: #ffffff;
    border: 1px solid #e8e5de;
    border-radius: 8px;
}
.domain-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: #2d5a3f;
    cursor: pointer;
}
.domain-back:hover {
    color: #1b4332;
}
.domain-back-arrow {
    font-size: 14px;
}
.domain-sep {
    color: #d5d1c8;
}
.domain-current {
    font-size: 13px;
    color: #33302c;
    font-weight: 500;
}
.content-scroll-wrap.is-nav-hub .domain-context-bar {
    display: none;
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
.title-box .archive-sku-count {
    margin-left: 12px;
    font-size: 14px;
    font-weight: 500;
    color: var(--primary);
    letter-spacing: 0;
    vertical-align: middle;
}

/* 表格卡片 —— 浅色卡面 + 金调描边/投影（原先注释写「黑金边框」但 hover 投影是品牌绿 rgba(45,106,79)） */
.table-card { 
    border-radius: 12px; 
    border: 1px solid var(--border-light); 
    box-shadow: var(--shadow-light);
    background: var(--bg-light-card);
    overflow: hidden;
    transition: all 0.3s ease;
}
.table-card:hover {
    box-shadow: 0 4px 20px rgba(168, 141, 66, 0.16);
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
.prod-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}
.product-tags-editor {
    width: 100%;
}
.product-tags-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}
.gift-scene-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
}
.gift-scene-checks .el-checkbox {
    margin-right: 0;
}
.product-tags-add {
    display: flex;
    align-items: center;
    gap: 8px;
}
.product-tag-chip {
    --el-tag-text-color: #8A7530;
    --el-tag-bg-color: #FAF6ED;
    --el-tag-border-color: #E0CFA3;
}
.price-tag { 
    color: var(--primary-dark); 
    font-weight: bold; 
    font-family: 'Segoe UI', monospace; 
    text-shadow: 0 1px 2px rgba(45, 106, 79, 0.2);
}
.profit-cell {
    font-size: 13px;
    color: var(--color-text-secondary, #6B6560);
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
.promo-none { color: var(--light-text-secondary); }

/* Element Plus 全局覆盖 —— 主色已转黑金（--primary = gold-700；白底 6.7:1 可读） */
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
