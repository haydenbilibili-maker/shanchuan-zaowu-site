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
                <el-menu-item index="26"><el-icon><Monitor /></el-icon><span>实时监控大屏</span></el-menu-item>
                <el-menu-item index="49"><el-icon><DataBoard /></el-icon><span>经营数据大屏</span></el-menu-item>
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
                <el-menu-item index="42"><el-icon><Refresh /></el-icon><span>退款审核</span></el-menu-item>
              </el-menu-item-group>
              <el-menu-item-group title="场 · 体验">
                <el-menu-item index="37"><el-icon><Stamp /></el-icon><span>预约与核销</span></el-menu-item>
                <el-menu-item index="5"><el-icon><Calendar /></el-icon><span>活动与排期</span></el-menu-item>
                <el-menu-item index="6"><el-icon><Ticket /></el-icon><span>权益与营销</span></el-menu-item>
                <el-menu-item index="30"><el-icon><Shop /></el-icon><span>店铺管理</span></el-menu-item>
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
              </el-menu-item-group>
              <el-menu-item-group title="会员/营销规则">
                <el-menu-item index="14"><el-icon><UserFilled /></el-icon><span>会员等级体系</span></el-menu-item>
                <el-menu-item index="15"><el-icon><Ticket /></el-icon><span>积分规则配置</span></el-menu-item>
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
            </el-sub-menu>

            <!-- ============ 6. 战略与知识 ============ -->
            <el-menu-item-group title="战略与知识">
                <el-menu-item index="12"><el-icon><MagicStick /></el-icon><span>智能中心</span></el-menu-item>
                <el-menu-item index="10"><el-icon><DataAnalysis /></el-icon><span>战略调研看板</span></el-menu-item>
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
                            @click="clearProductSelection"
                        >
                            取消选择
                        </el-button>
                    </div>
                 </div>

                 <div class="archive-filter-row" style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
                    <span class="archive-filter-label">档案筛选：</span>
                    <el-radio-group v-model="archiveFilter" size="small">
                        <el-radio-button label="all">全部</el-radio-button>
                        <el-radio-button label="archive">仅档案藏品</el-radio-button>
                    </el-radio-group>
                 </div>

                 <el-table 
                     ref="productTableRef"
                     :data="displayProducts" 
                     style="width: 100%" 
                     v-loading="loading" 
                     row-key="_id" 
                     stripe
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
                    <el-table-column prop="price" label="售价" width="140">
                         <template #default="scope">
                             <span class="price-tag">¥{{ scope.row.price }}</span>
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
        width="500px"
        destroy-on-close
    >
        <el-form :model="form" label-width="90px" label-position="left">
            <el-form-item label="藏品名称">
                <el-input v-model="form.title" placeholder="请输入商品全称" />
            </el-form-item>
            <el-form-item label="所属分类">
                <el-select v-model="form.category" placeholder="请选择" style="width:100%">
                    <el-option label="🦋 昆虫标本" value="昆虫" />
                    <el-option label="💎 矿石晶体" value="矿石" />
                    <el-option label="🌿 植物封存" value="植物" />
                    <el-option label="🐚 海洋生物" value="海洋" />
                    <el-option label="🎨 原创手作" value="手作" />
                </el-select>
            </el-form-item>
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
                        <el-input-number v-model="form.stock" :min="0" :step="1" style="width:100%" />
                    </el-form-item>
                </el-col>
                <el-col :span="12">
                    <el-form-item label="拉丁学名">
                        <el-input v-model="form.latinName" placeholder="可选" />
                    </el-form-item>
                </el-col>
            </el-row>
            <el-form-item label="藏品描述">
                <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入藏品描述..." />
            </el-form-item>
            <el-form-item label="镇店之宝">
                <el-switch v-model="form.isTreasure" />
            </el-form-item>
            <el-form-item label="列入藏品档案">
                <el-switch v-model="form.inArchive" />
                <span class="sku-hint-muted">重要SKU入档，便于档案筛选与盘点</span>
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
            
            <el-alert title="图片上传与富文本描述请在小程序端操作" type="info" :closable="false" show-icon style="margin-top:10px" />
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
  UserFilled, Picture, PictureFilled, Collection, Calendar, Ticket, SwitchButton, DataAnalysis, ChatDotRound, Setting, MagicStick, Search, Trophy, Iphone, DocumentCopy, Menu,
  InfoFilled, Loading, SuccessFilled, WarningFilled, QuestionFilled, Connection, Monitor, CircleCheck, CircleClose, Notebook, Shop, Wallet, Brush, User, OfficeBuilding, Promotion,
  DataBoard, TrendCharts, VideoCamera,
  // 🟢 小程序对齐补充图标
  Stamp, Avatar, Message, Refresh, Document, ShoppingCart,
  // 🟢 命令面板/收藏夹
  Close,
  // 🟢 侧栏折叠
  Expand, Fold,
  // 🟢 物业合作测算
  House
} from '@element-plus/icons-vue'
// 导入云开发工具
import { getTempFileUrl, COLLECTIONS, fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove } from './cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

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
const AICenter = asyncWith(() => import('./components/AICenter.vue'))
import PartnerDestinyCenter from './components/PartnerDestinyCenter.vue'
import CapitalArchitectureSandbox from './components/CapitalArchitectureSandbox.vue'
import StartupCostModel from './components/StartupCostModel.vue'
import ContentFactory from './components/ContentFactory.vue'
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
import PurchaseIntents from './components/PurchaseIntents.vue'
import PetMemorial from './components/PetMemorial.vue'
import SupportTickets from './components/SupportTickets.vue'
import CommentsModeration from './components/CommentsModeration.vue'
import Refunds from './components/Refunds.vue'
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
  '12': () => ({ comp: AICenter }),
  '13': () => ({ comp: HomeConfigManager }),
  '14': () => ({ comp: MemberLevelConfig }),
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
  '26': () => ({ comp: RealtimeMonitor }),
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
  '52': () => ({ comp: PurchaseIntents }),
  '39': () => ({ comp: PetMemorial }),
  '40': () => ({ comp: SupportTickets }),
  '41': () => ({ comp: CommentsModeration }),
  '42': () => ({ comp: Refunds }),
  '43': () => ({ comp: Categories }),
  '44': () => ({ comp: BehaviorAnalytics }),
  '45': () => ({ comp: UserInsights }),
  '46': () => ({ comp: AudienceManager }),
  '47': () => ({ comp: CohortCompare }),
  '48': () => ({ comp: PropertyEval }),
  '49': () => ({ comp: RealtimeMonitor })
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
  '48': 'grp-business', '52': 'grp-business',
  '4': 'grp-customer', '40': 'grp-customer', '41': 'grp-customer', '44': 'grp-customer',
  '45': 'grp-customer', '46': 'grp-customer', '47': 'grp-customer', '51': 'grp-customer',
  '8': 'grp-miniapp', '9': 'grp-miniapp', '13': 'grp-miniapp', '14': 'grp-miniapp',
  '15': 'grp-miniapp', '16': 'grp-miniapp', '17': 'grp-miniapp', '18': 'grp-miniapp',
  '19': 'grp-miniapp', '20': 'grp-miniapp', '21': 'grp-miniapp', '22': 'grp-miniapp',
  '23': 'grp-miniapp', '24': 'grp-miniapp',
  '2': 'grp-governance', '7': 'grp-governance', '27': 'grp-governance', '28': 'grp-governance',
  '31': 'grp-governance', '32': 'grp-governance', '33': 'grp-governance', '36': 'grp-governance', '50': 'grp-governance'
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
    latinName: '', description: '', isTreasure: false, inArchive: false,
    seckillEnabled: false, seckillPrice: 0, seckillStock: 0, seckillStartTime: null, seckillEndTime: null, seckillLimitPerUser: 1,
    groupBuyingEnabled: false, groupBuyingPrice: 0, groupBuyingSize: 2
})
const archiveFilter = ref('all') // 'all' | 'archive' 全部 / 仅档案藏品

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
        // 确保数据库连接
        const connected = await loginToCloud()
        if (!connected) {
            ElMessage.error('数据库连接失败，请检查网络或配置')
            loading.value = false
            return
        }
        
        // 确保 db 和 collection 对象可用
        if (!db || typeof db.collection !== 'function') {
            throw new Error('数据库对象未正确初始化')
        }
        
        const productsCollection = db.collection(COLLECTIONS.PRODUCTS)
        if (!productsCollection || typeof productsCollection.orderBy !== 'function') {
            throw new Error('数据库集合对象未正确初始化')
        }
        
        const res = await productsCollection
            .orderBy('createTime', 'desc')
            .limit(50)
            .get()
            
        // 处理图片链接 - 添加安全检查
        if (!res || !res.data || !Array.isArray(res.data)) {
            console.warn('商品数据格式异常:', res)
            products.value = []
            return
        }
        
        const list = await Promise.all(res.data.map(async (item) => {
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
        ElMessage.error('数据库连接异常: ' + (err.message || '未知错误'))
    } finally {
        loading.value = false
    }
}

const toggleShelf = async (row) => {
    try {
        const connected = await loginToCloud()
        if (!connected) {
            ElMessage.error('数据库连接失败')
            return
        }
        await db.collection(COLLECTIONS.PRODUCTS).doc(row._id).update({ 
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

// 档案筛选后的列表（用于表格展示）
const displayProducts = computed(() => {
    const list = products.value || []
    if (archiveFilter.value === 'archive') {
        return list.filter(p => p.inArchive === true)
    }
    return list
})

// 将选中重要SKU加入藏品档案
const handleAddToArchive = async () => {
    if (!selectedProducts.value || selectedProducts.value.length === 0) {
        ElMessage.warning('请先选择要加入档案的商品')
        return
    }
    try {
        loading.value = true
        const connected = await loginToCloud()
        if (!connected) {
            ElMessage.error('数据库连接失败')
            return
        }
        const promises = selectedProducts.value.map(p =>
            db.collection(COLLECTIONS.PRODUCTS).doc(p._id).update({
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
            const connected = await loginToCloud()
            if (!connected) {
                ElMessage.error('数据库连接失败')
                return
            }

            const promises = selectedProducts.value.map(product => 
                db.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
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
            const connected = await loginToCloud()
            if (!connected) {
                ElMessage.error('数据库连接失败')
                return
            }

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

                return db.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
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
            const connected = await loginToCloud()
            if (!connected) {
                ElMessage.error('数据库连接失败')
                return
            }

            const promises = selectedProducts.value.map(product => {
                let newStock = product.stock || 0
                if (batchStockForm.value.type === 'set') {
                    newStock = batchStockForm.value.value
                } else if (batchStockForm.value.type === 'add') {
                    newStock = (product.stock || 0) + batchStockForm.value.value
                } else if (batchStockForm.value.type === 'subtract') {
                    newStock = Math.max(0, (product.stock || 0) - batchStockForm.value.value)
                }

                return db.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
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

const openDialog = () => { 
    isEditing.value = false 
    form.value = { 
        title: '', price: 0, costPrice: 0, stock: 1, category: '昆虫',
        latinName: '', description: '', isTreasure: false, inArchive: false,
        seckillEnabled: false, seckillPrice: 0, seckillStock: 0, seckillStartTime: null, seckillEndTime: null, seckillLimitPerUser: 1,
        groupBuyingEnabled: false, groupBuyingPrice: 0, groupBuyingSize: 2
    } 
    dialogVisible.value = true 
}

const editItem = async (row) => { 
    isEditing.value = true 
    form.value = { 
        ...row,
        costPrice: row.costPrice || 0,
        latinName: row.latinName || '',
        description: row.description || '',
        isTreasure: row.isTreasure || false,
        inArchive: row.inArchive || false,
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
    dialogVisible.value = true 
}

const deleteItem = (row) => { 
    ElMessageBox.confirm(
        `确定要永久删除藏品《${row.title}》吗?`, '高风险操作', 
        { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    ).then(async () => {
        try {
            const connected = await loginToCloud()
            if (!connected) {
                ElMessage.error('数据库连接失败')
                return
            }
            await db.collection(COLLECTIONS.PRODUCTS).doc(row._id).remove()
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
    
    try {
        const connected = await loginToCloud()
        if (!connected) {
            ElMessage.error('数据库连接失败')
            return
        }
        
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
        
        const data = {
            title: form.value.title,
            price: form.value.price,
            costPrice: form.value.costPrice || 0,
            stock: form.value.stock,
            category: form.value.category,
            latinName: form.value.latinName || '',
            description: form.value.description || '',
            isTreasure: form.value.isTreasure || false,
            inArchive: form.value.inArchive || false,
            updateTime: Date.now(),
            seckill: seckill,
            groupBuying: groupBuying
        }
        
        if (isEditing.value) {
            await db.collection(COLLECTIONS.PRODUCTS).doc(form.value._id).update(data)
            ElMessage.success('更新成功')
        } else {
            data.createTime = Date.now()
            data.isOffShelf = false
            data.images = []
            data.framerName = 'NATURE' // 默认标本师
            data.framerId = null
            data.origin = ''
            data.collectDate = ''
            data.size = '0x0x0 cm' // 默认尺寸
            await db.collection(COLLECTIONS.PRODUCTS).add(data)
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

.sku-hint-muted {
  margin-left: 8px;
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
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