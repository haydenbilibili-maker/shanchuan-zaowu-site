<template>
  <div class="ai-center aic-v2">
    <!-- 统一壳层：降低首屏噪音，模式切换始终可见 -->
    <header class="aic-topbar" aria-label="AI 智能中心">
      <div class="aic-topbar-left">
        <div class="aic-mark" aria-hidden="true">山</div>
        <div class="aic-topbar-titles">
          <h2 class="aic-topbar-title">AI 智能中心</h2>
          <p class="aic-topbar-sub">{{ shellSubtitle }}</p>
        </div>
      </div>
      <nav class="aic-segment" aria-label="工作模式">
        <button
          v-for="mode in modeTabs"
          :key="mode.id"
          type="button"
          :class="['aic-seg', currentMode === mode.id ? 'is-active' : '']"
          @click="switchMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </nav>
      <div class="aic-topbar-right">
        <button
          type="button"
          class="aic-model-pill"
          :class="providerChipClass"
          @click="openOnlineConfig"
          :title="aiProviderConfigHint"
        >
          <span class="aic-provider-dot" aria-hidden="true" />
          <span>{{ providerChipLabel }}</span>
        </button>
        <button type="button" class="aic-icon-ghost" @click="showBackendConfigDialog = true" title="模型配置">
          <el-icon :size="18"><Setting /></el-icon>
        </button>
      </div>
    </header>

    <!-- DeepSeek / Provider 未配置提示 -->
    <el-alert
      v-if="showProviderWarning"
      class="aic-env-alert"
      type="warning"
      show-icon
      :closable="false"
      title="尚未配置可用的云端 AI Key"
    >
      <template #default>
        <div class="aic-env-alert-body">
          <p>{{ aiProviderConfigHint }}</p>
          <div class="aic-env-alert-actions">
            <el-button type="primary" size="small" @click="openOnlineConfig">粘贴 Key / 打开配置</el-button>
            <el-button size="small" text @click="dismissProviderWarning = true">稍后</el-button>
          </div>
        </div>
      </template>
    </el-alert>

    <!-- ===== 工具工作台 ===== -->
    <section v-if="currentMode === 'tools'" class="aic-tools" aria-label="AI 工具工作台">
      <aside class="aic-tools-side">
        <div class="aic-side-block">
          <div class="aic-side-label">搜索工具</div>
          <el-input
            v-model="toolSearch"
            placeholder="名称、标签或描述…"
            clearable
            size="default"
            prefix-icon="Search"
          />
        </div>
        <div class="aic-side-block">
          <div class="aic-side-label">分类</div>
          <div class="aic-cat-list" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="activeCategory === 'all'"
              :class="['aic-cat', activeCategory === 'all' ? 'is-active' : '']"
              @click="activeCategory = 'all'"
            >
              <span>全部</span>
              <em>{{ features.length }}</em>
            </button>
            <button
              v-for="category in categories"
              :key="category.id"
              type="button"
              role="tab"
              :aria-selected="activeCategory === category.id"
              :class="['aic-cat', activeCategory === category.id ? 'is-active' : '']"
              @click="activeCategory = category.id"
            >
              <span>{{ category.icon }} {{ category.name }}</span>
              <em>{{ featureCountByCategory[category.id] || 0 }}</em>
            </button>
          </div>
        </div>
        <div class="aic-side-block" v-if="recentFeatures.length">
          <div class="aic-side-label">最近使用</div>
          <div class="aic-recent-list">
            <button
              v-for="item in recentFeatures"
              :key="item.id"
              type="button"
              class="aic-recent-item"
              @click="openFeature(item)"
            >
              <span class="aic-recent-ico" aria-hidden="true">{{ item.icon }}</span>
              <span class="aic-recent-name">{{ item.title }}</span>
            </button>
          </div>
        </div>
        <div class="aic-side-block aic-side-shortcuts">
          <div class="aic-side-label">快捷入口</div>
          <button type="button" class="aic-shortcut" @click="switchMode('chat')">
            <span>智能咨询</span>
            <small>选人 → 交代任务</small>
          </button>
          <button type="button" class="aic-shortcut" @click="switchMode('openclaw')">
            <span>OpenClaw</span>
            <small>PRD 与派发对接</small>
          </button>
          <button type="button" class="aic-shortcut" @click="openFeatureById('strategic-brain')">
            <span>战略智脑</span>
            <small>多角色决策建议</small>
          </button>
        </div>
      </aside>

      <div class="aic-tools-main">
        <div class="aic-tools-head">
          <div>
            <h3 class="aic-section-title">{{ activeCategoryMeta?.name || '全部工具' }}</h3>
            <p class="aic-section-desc">{{ activeCategoryDesc }}</p>
          </div>
          <div class="aic-legend" title="点击可筛选能力类型">
            <button type="button" :class="['aic-legend-item', 'aic-legend-item--api', capabilityFilter === 'api' ? 'is-on' : '']" @click="toggleCapabilityFilter('api')"><i class="cap-dot cap-api" />真 API</button>
            <button type="button" :class="['aic-legend-item', 'aic-legend-item--bridge', capabilityFilter === 'bridge' ? 'is-on' : '']" @click="toggleCapabilityFilter('bridge')"><i class="cap-dot cap-bridge" />对接</button>
            <button type="button" :class="['aic-legend-item', 'aic-legend-item--demo', capabilityFilter === 'demo' ? 'is-on' : '']" @click="toggleCapabilityFilter('demo')"><i class="cap-dot cap-demo" />演示</button>
          </div>
        </div>

        <div v-if="filteredFeatures.length" class="aic-feature-grid">
          <button
            v-for="feature in filteredFeatures"
            :key="feature.id"
            type="button"
            class="aic-feature-card"
            :title="feature.capabilityHint || feature.description"
            @click="openFeature(feature)"
          >
            <div class="aic-feature-top">
              <span class="aic-feature-icon" aria-hidden="true">{{ feature.icon }}</span>
              <el-tag
                size="small"
                effect="plain"
                :type="capabilityTagType(feature.capability)"
                :class="['aic-cap-tag', `aic-cap-tag--${feature.capability || 'demo'}`]"
                :title="feature.capabilityHint || feature.capabilityLabel || ''"
              >
                {{ feature.capabilityLabel || '真 API' }}
              </el-tag>
            </div>
            <h4 class="aic-feature-title">{{ feature.title }}</h4>
            <p class="aic-feature-desc">{{ feature.description }}</p>
            <div class="aic-feature-foot">
              <div class="aic-feature-tags">
                <span v-for="tag in feature.tags.slice(0, 3)" :key="tag">{{ tag }}</span>
              </div>
              <span class="aic-feature-cta">进入</span>
            </div>
          </button>
        </div>
        <div v-else class="aic-empty aic-empty--tools">
          <p class="aic-empty-title">{{ toolSearch.trim() ? '没有匹配的工具' : '当前分类暂无工具' }}</p>
          <p class="aic-empty-desc">
            {{ toolSearch.trim()
              ? `未找到与「${toolSearch.trim()}」相关的能力，试试更短关键词或切换分类`
              : '试试其他分类，或从左侧快捷入口进入对话 / OpenClaw' }}
          </p>
          <div class="aic-empty-actions">
            <el-button v-if="toolSearch.trim()" size="small" type="primary" plain @click="toolSearch = ''">清空搜索</el-button>
            <el-button size="small" @click="toolSearch = ''; activeCategory = 'all'">查看全部工具</el-button>
            <el-button size="small" type="primary" @click="switchMode('chat')">去智能咨询</el-button>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== OpenClaw ===== -->
    <section v-else-if="currentMode === 'openclaw'" class="aic-openclaw" aria-label="OpenClaw 虚拟员工">
      <OpenClawVirtualStaff @close="switchMode('tools')" @open-chat="switchMode('chat')" />
    </section>

    <!-- ===== 咨询 / 辩论：选人 → 交代任务 → 输出 ===== -->
    <section
      v-else-if="currentMode === 'chat' || currentMode === 'debate'"
      class="aic-consult"
      aria-label="智能咨询工作区"
    >
      <aside class="aic-persona-rail" :class="{ 'is-collapsed': !showPersonaPanel }">
        <div class="aic-rail-head">
          <div>
            <div class="aic-side-label">虚拟员工</div>
            <p class="aic-rail-hint">先选人，再交代任务</p>
          </div>
          <button type="button" class="aic-icon-btn" @click="showPersonaPanel = !showPersonaPanel" :title="showPersonaPanel ? '收起' : '展开'">
            {{ showPersonaPanel ? '‹' : '›' }}
          </button>
        </div>
        <template v-if="showPersonaPanel">
          <div class="aic-session-block">
            <div class="aic-session-head">
              <div class="aic-side-label">会话</div>
              <button type="button" class="aic-text-btn aic-session-new" @click="startNewSession" title="新对话 (⌘/Ctrl+N)">
                + 新对话
              </button>
            </div>
            <el-input
              v-model="sessionSearch"
              size="small"
              clearable
              placeholder="搜索会话…"
              class="aic-session-search"
            />
            <div class="aic-session-list" role="list">
              <button
                v-for="s in filteredSessionList"
                :key="s.id"
                type="button"
                role="listitem"
                :class="['aic-session-item', s.id === currentSessionId ? 'is-active' : '']"
                @click="switchSession(s.id)"
              >
                <span class="aic-session-title">{{ s.title || '新对话' }}</span>
                <span class="aic-session-meta">{{ formatSessionTime(s.updatedAt) }}</span>
                <span
                  class="aic-session-del"
                  title="删除会话"
                  role="button"
                  @click.stop="deleteSession(s.id)"
                >×</span>
              </button>
              <p v-if="!sessionListSorted.length" class="aic-session-empty">暂无会话</p>
            </div>
          </div>
          <el-input
            v-model="personaSearch"
            placeholder="搜索角色或领域…"
            size="small"
            clearable
            prefix-icon="Search"
            class="aic-persona-search"
          />
          <div class="aic-persona-cats" role="tablist">
            <button
              type="button"
              role="tab"
              :class="['aic-p-cat', selectedPersonaCategory === 'all' ? 'is-active' : '']"
              @click="selectedPersonaCategory = 'all'"
            >全部</button>
            <button
              v-for="(cat, key) in personaCategories"
              :key="key"
              type="button"
              role="tab"
              :class="['aic-p-cat', selectedPersonaCategory === key ? 'is-active' : '']"
              @click="selectedPersonaCategory = key"
            >{{ cat.icon }} {{ cat.name.split(' ')[1] || cat.name }}</button>
          </div>
          <div class="aic-persona-scroll">
            <template v-for="(cat, catKey) in personaCategories" :key="catKey">
              <template v-if="selectedPersonaCategory === 'all' || selectedPersonaCategory === catKey">
                <div
                  v-if="Object.entries(filteredPersonas).some(([, p]) => p.category === catKey)"
                  class="aic-persona-group"
                >
                  <div class="aic-persona-group-title">{{ cat.icon }} {{ cat.name }}</div>
                  <button
                    v-for="([key, persona]) in Object.entries(filteredPersonas).filter(([, p]) => p.category === catKey)"
                    :key="key"
                    type="button"
                    :class="['aic-persona', personaMode === key ? 'is-active' : '']"
                    :aria-pressed="personaMode === key"
                    @click="selectPersona(key)"
                  >
                    <span class="aic-persona-ico" aria-hidden="true">{{ persona.icon }}</span>
                    <span class="aic-persona-meta">
                      <span class="aic-persona-name">{{ persona.name }}</span>
                      <span class="aic-persona-desc">{{ persona.shortDesc }}</span>
                    </span>
                    <span v-if="personaMode === key" class="aic-persona-check" aria-hidden="true">✓</span>
                  </button>
                </div>
              </template>
            </template>
            <div v-if="Object.keys(filteredPersonas).length === 0" class="aic-empty aic-empty--compact">
              <p class="aic-empty-title">未找到角色</p>
              <el-button size="small" text @click="personaSearch = ''; selectedPersonaCategory = 'all'">重置</el-button>
            </div>
          </div>
        </template>
      </aside>

      <div class="aic-consult-main">
        <div class="aic-thread-bar">
          <div class="aic-thread-persona" :style="{ '--p-color': currentPersona.color }">
            <span class="aic-thread-avatar" aria-hidden="true">{{ currentPersona.icon }}</span>
            <div>
              <div class="aic-thread-name">{{ currentPersona.name }}</div>
              <div class="aic-thread-desc">{{ currentPersona.shortDesc }}</div>
            </div>
          </div>
          <div class="aic-thread-actions">
            <button type="button" class="aic-text-btn" @click="exportCurrentSession" title="导出 Markdown">导出</button>
            <button type="button" class="aic-text-btn" @click="startNewSession" title="新对话 (⌘/Ctrl+N)">新对话</button>
            <button v-if="messages.length > 3" type="button" class="aic-text-btn" @click="scrollToBottom">滚到底</button>
          </div>
        </div>

        <div v-if="currentMode === 'debate'" class="aic-debate-bar">
          <el-select v-model="debateTopic" size="small" placeholder="选择辩论主题" style="width: 220px">
            <el-option label="是否应该扩大线上销售渠道？" value="online-expansion" />
            <el-option label="是否应该增加门店体验投入？" value="store-experience" />
            <el-option label="是否应该开发新产品线？" value="product-line" />
            <el-option label="是否应该加大营销预算？" value="marketing-budget" />
            <el-option label="是否应该拓展新市场？" value="market-expansion" />
            <el-option label="是否应该引入新技术？" value="tech-innovation" />
            <el-option label="自定义主题" value="custom" />
          </el-select>
          <el-input
            v-if="debateTopic === 'custom'"
            v-model="customDebateTopic"
            size="small"
            placeholder="输入自定义辩论主题…"
            style="width: 200px"
          />
          <el-select
            v-model="selectedDebatePersonas"
            multiple
            size="small"
            placeholder="参与角色（≥2）"
            style="min-width: 240px; flex: 1"
            :max-collapse-tags="2"
          >
            <el-option-group
              v-for="(cat, catKey) in personaCategories"
              :key="catKey"
              :label="cat.name"
            >
              <el-option
                v-for="([key, persona]) in Object.entries(personas).filter(([, p]) => p.category === catKey)"
                :key="key"
                :label="persona.name"
                :value="key"
              >
                <span>{{ persona.icon }} {{ persona.name }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <el-button
            size="small"
            type="primary"
            @click="startDebate"
            :disabled="isDebating || isAiThinking || !debateTopic || (debateTopic === 'custom' && !customDebateTopic.trim()) || selectedDebatePersonas.length < 2"
          >开始辩论</el-button>
          <el-button size="small" type="danger" plain @click="stopDebate" :disabled="!isDebating">停止</el-button>
        </div>

        <div class="aic-chat-panel">
          <div ref="chatBoxRef" class="aic-chat-box">
            <div v-if="showWelcomeState" class="aic-welcome">
              <div class="aic-welcome-mark" aria-hidden="true">{{ currentPersona.icon }}</div>
              <h3 class="aic-welcome-title">你好，我是{{ currentPersona.name }}</h3>
              <p class="aic-welcome-desc">{{ currentPersona.shortDesc }} · 直接输入问题，或点下方示例开始</p>
              <div class="aic-suggests">
                <button
                  v-for="(s, i) in emptySuggestions"
                  :key="i"
                  type="button"
                  class="aic-suggest"
                  @click="applySuggestion(s)"
                >{{ s }}</button>
              </div>
            </div>
            <div
              v-for="(msg, index) in visibleMessages"
              :key="msg.id || index"
              :class="['aic-msg', msg.role === 'ai' ? 'is-ai' : 'is-user']"
            >
              <div class="aic-msg-head" v-if="msg.persona">
                <span class="aic-msg-badge" :style="{ '--persona-color': personas[msg.persona]?.color || 'var(--brand-green-500)' }">
                  {{ personas[msg.persona]?.icon }} {{ personas[msg.persona]?.name }}
                </span>
              </div>
              <div :class="['aic-bubble', msg.role === 'ai' ? 'is-ai' : 'is-user', msg.isStreaming ? 'is-streaming' : '']">
                <div v-html="msg.content"></div>
                <span v-if="msg.isStreaming" class="aic-stream-caret" aria-hidden="true"></span>
                <div v-if="msg.role === 'ai' && !msg.isStreaming" class="aic-msg-actions">
                  <button
                    v-if="msg.rawText"
                    type="button"
                    class="aic-msg-action"
                    @click="copyMessageText(msg)"
                  >复制</button>
                  <button
                    v-if="msg.rawText"
                    type="button"
                    class="aic-msg-action"
                    @click="quoteMessage(msg)"
                  >引用追问</button>
                  <button
                    v-if="msg.rawText"
                    type="button"
                    :class="['aic-msg-action', isPlaying && currentAudioText === msg.rawText ? 'is-active' : '']"
                    @click="playAudio(msg.rawText, msg.persona)"
                  >
                    {{ isPlaying && currentAudioText === msg.rawText ? '停止播放' : '播放语音' }}
                  </button>
                  <button
                    v-if="canRegenerateAt(index)"
                    type="button"
                    class="aic-msg-action"
                    :disabled="isAiThinking || isDebating"
                    @click="regenerateLastAI"
                  >重新生成</button>
                </div>
              </div>
            </div>
            <div v-if="isAiThinking && !hasStreamingMessage" class="aic-msg is-ai">
              <div class="aic-bubble is-ai is-thinking">
                <span>{{ currentPersona.thinkingMsg }}</span>
                <span class="aic-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
                <button type="button" class="aic-msg-action aic-stop-inline" @click="stopGeneration">停止</button>
              </div>
            </div>
            <div v-if="lastChatError" class="aic-error-banner">
              <strong>调用失败</strong>
              <span>{{ lastChatError }}</span>
              <el-button v-if="isConfigError(lastChatError)" size="small" type="primary" @click="openOnlineConfig">去配置</el-button>
              <el-button v-else size="small" type="primary" plain @click="regenerateLastAI">重试</el-button>
              <el-button size="small" text @click="lastChatError = ''">关闭</el-button>
            </div>
          </div>

          <div class="aic-composer">
            <div v-if="quoteDraft" class="aic-quote-bar">
              <div class="aic-quote-bar-main">
                <span class="aic-quote-label">引用</span>
                <span class="aic-quote-text">{{ quoteDraft }}</span>
              </div>
              <button type="button" class="aic-text-btn" @click="clearQuote">取消</button>
            </div>
            <div class="aic-composer-card">
              <div class="aic-quick-row" role="toolbar" aria-label="快捷指令">
                <button
                  v-for="(action, key) in quickActions"
                  :key="key"
                  type="button"
                  class="aic-quick"
                  :disabled="isAiThinking || isDebating || showProviderWarning"
                  @click="quickAI(key)"
                >
                  <span aria-hidden="true">{{ action.icon }}</span>
                  {{ action.label }}
                </button>
              </div>
              <el-input
                ref="aiInputRef"
                v-model="aiInput"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 8 }"
                resize="none"
                @keydown.enter.exact.prevent="handleEnterKey"
                @keydown.esc.prevent="handleComposerEscape"
                :placeholder="currentMode === 'debate' ? '补充观察或追问…' : `给 ${currentPersona.name} 发消息…`"
                class="aic-textarea"
                :disabled="isAiThinking || isDebating"
              />
              <div class="aic-composer-foot">
                <div class="aic-composer-meta">
                  <span class="aic-composer-hint">{{ composerHint }}</span>
                  <button type="button" class="aic-model-mini" @click="openOnlineConfig">{{ providerChipLabel }}</button>
                </div>
                <div class="aic-composer-ctas">
                  <el-button
                    v-if="isAiThinking || isDebating"
                    class="aic-stop-cta"
                    round
                    @click="stopGeneration"
                  >
                    停止
                  </el-button>
                  <el-button
                    v-else
                    type="primary"
                    class="aic-send-cta"
                    round
                    @click="sendAI"
                    :disabled="isAiThinking || isDebating || !aiInput.trim() || showProviderWarning"
                  >
                    发送
                  </el-button>
                </div>
              </div>
            </div>
            <p v-if="recentTasks.length" class="aic-recent-tasks">
              <span class="aic-recent-tasks-label">最近</span>
              <button
                v-for="(t, i) in recentTasks"
                :key="i"
                type="button"
                class="aic-recent-task"
                :disabled="isAiThinking || isDebating"
                @click="applySuggestion(t)"
              >{{ t }}</button>
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 后台调用配置弹窗 -->
    <el-dialog
      v-model="showBackendConfigDialog"
      title="模型与接口配置"
      width="900px"
      :close-on-click-modal="false"
      class="backend-config-dialog"
      destroy-on-close
    >
      <div class="backend-config-content">
        <div class="service-type-tabs">
          <div
            class="type-tab"
            :class="{ active: serviceType === 'local' }"
            @click="serviceType = 'local'"
          >
            <el-icon><Monitor /></el-icon>
            <span>本地模型</span>
          </div>
          <div
            class="type-tab"
            :class="{ active: serviceType === 'online' }"
            @click="serviceType = 'online'"
          >
            <el-icon><Cloudy /></el-icon>
            <span>在线接口</span>
          </div>
        </div>

        <template v-if="serviceType === 'local'">
          <div class="compact-panel-content">
            <div class="compact-service-info">
              <div class="compact-info-row">
                <span class="info-label">服务状态：</span>
                <div class="service-status-compact" :class="{ 'status-online': backendServiceStatus === 'online', 'status-offline': backendServiceStatus === 'offline', 'status-starting': backendServiceStatus === 'starting', 'status-stopping': backendServiceStatus === 'stopping' }">
                  <div class="status-indicator-small"></div>
                  <span class="status-text-small">{{ statusText }}</span>
                </div>
              </div>
              <div class="compact-info-row">
                <span class="info-label">服务地址：</span>
                <span class="info-value-small">http://localhost:8080</span>
              </div>
              <div class="compact-info-row">
                <span class="info-label">当前模型：</span>
                <span class="info-value-small model-name">{{ currentModel?.name || '未选择' }}</span>
              </div>
              <div class="compact-info-row">
                <span class="info-label">运行时长：</span>
                <span class="info-value-small">{{ serviceUptime }}</span>
              </div>
            </div>
            <div class="compact-service-actions">
              <el-button type="success" size="small" :icon="SwitchButton" @click="startService" :loading="backendServiceStatus === 'starting'" :disabled="backendServiceStatus === 'online' || backendServiceStatus === 'starting' || backendServiceStatus === 'stopping'">开机</el-button>
              <el-button type="warning" size="small" :icon="SwitchButton" @click="stopService" :loading="backendServiceStatus === 'stopping'" :disabled="backendServiceStatus === 'offline' || backendServiceStatus === 'starting' || backendServiceStatus === 'stopping'">关机</el-button>
              <el-button type="primary" size="small" :icon="Refresh" @click="restartService" :loading="backendServiceStatus === 'starting' || backendServiceStatus === 'stopping'" :disabled="backendServiceStatus === 'offline' || backendServiceStatus === 'starting' || backendServiceStatus === 'stopping'">重启</el-button>
              <el-button text size="small" :icon="Refresh" @click="refreshModelList" :loading="refreshingModels">刷新模型</el-button>
            </div>
          </div>
          <div class="compact-model-list-section">
            <div class="section-header-compact">
              <h4 class="section-title-compact"><el-icon><Box /></el-icon>可用模型列表</h4>
            </div>
            <div class="compact-model-list" v-if="modelList.length > 0">
              <div
                v-for="model in modelList"
                :key="model.id"
                class="compact-model-card"
                :class="{ 'model-active': currentModel?.id === model.id }"
                @click="selectModel(model)"
              >
                <div class="compact-model-icon">{{ model.icon }}</div>
                <div class="compact-model-info">
                  <div class="compact-model-title">{{ model.name }}</div>
                  <div class="compact-model-meta">
                    <span>{{ model.params }}B</span><span>·</span>
                    <span>{{ model.status === 'active' ? '运行中' : '待机' }}</span>
                  </div>
                </div>
                <el-icon class="check-icon" v-if="currentModel?.id === model.id"><Check /></el-icon>
              </div>
            </div>
            <div class="empty-model-compact" v-else>
              <p>暂无可用模型，请刷新列表</p>
            </div>
          </div>
        </template>

        <template v-if="serviceType === 'online'">
          <div class="compact-online-api-panel">
            <el-alert
              :type="aiProviderConfigStatus.deepseekConfigured || (aiProviderConfigStatus.bailian + aiProviderConfigStatus.gemini + aiProviderConfigStatus.openai) > 0 ? 'success' : 'warning'"
              show-icon
              :closable="false"
              class="api-security-alert"
              title="优先使用环境变量（构建时注入），勿将生产 Key 明文写入云库或 localStorage"
              :description="aiProviderConfigHint"
            />
            <div class="env-config-status-card">
              <div class="env-config-status-header">
                <h4 class="config-title-compact"><el-icon><Key /></el-icon>环境变量 AI 配置</h4>
                <el-tag :type="aiProviderConfigStatus.deepseekConfigured ? 'success' : 'danger'" size="small">
                  {{ aiProviderConfigStatus.deepseekConfigured
                    ? (aiProviderConfigStatus.deepseekGateway ? 'DeepSeek 已配置（服务端）' : 'DeepSeek 已配置')
                    : (gatewayChecked ? 'DeepSeek 未配置' : '正在检测…') }}
                </el-tag>
              </div>
              <div class="env-config-grid">
                <div class="env-config-row"><span class="env-label">默认 Provider</span><span class="env-value">{{ aiProviderConfigStatus.defaultProvider || '—' }}</span></div>
                <div class="env-config-row"><span class="env-label">DeepSeek Key</span><span class="env-value mono">{{ aiProviderConfigStatus.deepseekMaskedKey || (gatewayChecked ? '未设置服务端 DEEPSEEK_API_KEY' : '正在检测…') }}</span></div>
                <div class="env-config-row"><span class="env-label">配置来源</span><span class="env-value">{{ aiProviderConfigStatus.deepseekGateway ? 'Cloudflare Pages 环境变量（经 /api/ai 网关）' : (aiProviderConfigStatus.deepseek > 0 ? '前端环境变量（仅开发）' : '—') }}</span></div>
                <div class="env-config-row"><span class="env-label">模型</span><span class="env-value">{{ aiProviderConfigStatus.deepseekModel || 'deepseek-chat' }}</span></div>
                <div class="env-config-row"><span class="env-label">Base URL</span><span class="env-value mono">{{ aiProviderConfigStatus.deepseekBaseUrl || 'https://api.deepseek.com' }}</span></div>
                <div class="env-config-row"><span class="env-label">其他 Key</span><span class="env-value">百炼 {{ aiProviderConfigStatus.bailian }}{{ aiProviderConfigStatus.gateway?.bailian ? '（服务端）' : '' }} / Gemini {{ aiProviderConfigStatus.gemini }}{{ aiProviderConfigStatus.gateway?.gemini ? '（服务端）' : '' }} / OpenAI {{ aiProviderConfigStatus.openai }}{{ aiProviderConfigStatus.gateway?.openai ? '（服务端）' : '' }}</span></div>
              </div>
              <p class="env-config-tip">
                本地：在 <code>admin/.env</code> 填写后重启 <code>npm run dev:admin</code>。
                生产：GitHub Secrets 注入后重新部署。详见 <code>admin/docs/AI_DeepSeek环境变量配置.md</code>。
              </p>
              <div class="runtime-key-panel">
                <div class="runtime-key-title">本机即时备用 Key（无需重启）</div>
                <div class="runtime-key-row">
                  <el-input
                    v-model="runtimeDeepseekDraft"
                    type="password"
                    show-password
                    clearable
                    placeholder="粘贴 DeepSeek API Key（sk-…）"
                    @keyup.enter="saveRuntimeDeepseekKey"
                  />
                  <el-button type="primary" @click="saveRuntimeDeepseekKey">立即生效</el-button>
                </div>
                <p class="runtime-key-tip">仅存本机浏览器；生产环境仍建议用环境变量。{{ aiProviderConfigStatus.runtimeDeepseekConfigured ? '已检测到本机备用 Key。' : '' }}</p>
              </div>
            </div>
            <div class="compact-api-header">
              <h4 class="config-title-compact"><el-icon><Setting /></el-icon>浏览器备用接口（次优先）</h4>
              <el-button type="primary" size="small" :icon="Plus" @click="handleAddApiClick" class="add-api-btn-compact">新增接口</el-button>
            </div>
            <p class="env-secondary-tip">以下条目保存在本机 localStorage，仅作开发/演示备用；实际 AI 调用优先读环境变量中的 DeepSeek / 百炼等 Key。</p>
            <div class="compact-api-list" v-if="apiConfigList.length > 0">
              <div
                v-for="api in apiConfigList"
                :key="api.id"
                class="compact-api-card"
                :class="{ 'api-active': currentApiConfig?.id === api.id }"
                @click="selectApiConfig(api)"
              >
                <div class="compact-api-left">
                  <div class="compact-api-icon-wrapper">
                    <div class="compact-api-icon">{{ api.icon }}</div>
                    <div class="api-status-dot-small" :class="api.status"></div>
                  </div>
                  <div class="compact-api-info">
                    <div class="compact-api-name-row">
                      <span class="compact-api-name">{{ api.name }}</span>
                      <el-tag :type="api.status === 'active' ? 'success' : 'info'" size="small">{{ api.status === 'active' ? '启用' : '禁用' }}</el-tag>
                    </div>
                    <div class="compact-api-desc">{{ api.description || api.baseUrl }}</div>
                  </div>
                </div>
                <div class="compact-api-actions">
                  <el-button text size="small" @click.stop="editApiConfig(api)" title="编辑"><el-icon><Edit /></el-icon></el-button>
                  <el-button text size="small" type="danger" @click.stop="deleteApiConfig(api)" title="删除"><el-icon><Delete /></el-icon></el-button>
                </div>
              </div>
            </div>
            <div class="empty-api-compact" v-else>
              <el-icon class="empty-icon-small"><Cloudy /></el-icon>
              <p class="empty-text-small">暂无浏览器备用接口（可忽略，推荐只用环境变量）</p>
              <el-button type="primary" size="small" :icon="Plus" @click="handleAddApiClick">添加备用接口</el-button>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="showBackendConfigDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showAddApiDialog"
      :title="editingApiConfig ? '编辑API配置' : '新增API配置'"
      width="600px"
      :close-on-click-modal="false"
      class="api-config-dialog"
      destroy-on-close
    >
      <el-form :model="apiForm" :rules="apiFormRules" ref="apiFormRef" label-width="100px" label-position="left">
        <el-form-item label="接口名称" prop="name">
          <el-input v-model="apiForm.name" placeholder="例如：OpenAI API、通义千问API" clearable />
        </el-form-item>
        <el-form-item label="接口描述" prop="description">
          <el-input v-model="apiForm.description" type="textarea" :rows="2" placeholder="简要描述此API接口的用途" clearable />
        </el-form-item>
        <el-form-item label="API类型" prop="type">
          <el-select v-model="apiForm.type" placeholder="选择API类型" style="width: 100%">
            <el-option label="OpenAI Compatible" value="openai" />
            <el-option label="通义千问" value="qwen" />
            <el-option label="智谱AI" value="zhipu" />
            <el-option label="百度文心" value="baidu" />
            <el-option label="其他" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="基础URL" prop="baseUrl">
          <el-input v-model="apiForm.baseUrl" placeholder="https://api.example.com/v1" clearable />
          <div class="form-tip">API服务的基础URL地址</div>
        </el-form-item>
        <el-form-item label="API Key" prop="apiKey">
          <el-input v-model="apiForm.apiKey" type="password" placeholder="请输入API密钥" show-password clearable />
          <div class="form-tip">仅作本机备用；生产请在 Cloudflare Pages 配置服务端 DEEPSEEK_API_KEY（经 /api/ai 网关调用，密钥不入前端包）</div>
        </el-form-item>
        <el-form-item label="模型列表" prop="models">
          <el-select v-model="apiForm.models" multiple filterable allow-create default-first-option placeholder="选择或输入模型名称" style="width: 100%">
            <el-option v-for="model in suggestedModels[apiForm.type] || []" :key="model" :label="model" :value="model" />
          </el-select>
          <div class="form-tip">支持多个模型，用逗号分隔或在下拉列表中选择</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="apiForm.status" active-text="启用" inactive-text="禁用" :active-value="'active'" :inactive-value="'inactive'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelApiConfig">取消</el-button>
        <el-button type="primary" @click="saveApiConfig" :loading="savingApiConfig">{{ editingApiConfig ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="featureDialogVisible"
      :title="currentFeature?.title"
      width="90%"
      :close-on-click-modal="false"
      class="feature-dialog"
      destroy-on-close
    >
      <template v-if="currentFeature">
        <div v-if="currentFeature.capabilityHint || currentFeature.capability === 'demo'" class="aic-feature-dialog-note">
          <el-tag size="small" :type="capabilityTagType(currentFeature.capability)" effect="plain">
            {{ currentFeature.capabilityLabel || currentFeature.capability }}
          </el-tag>
          <span>{{ currentFeature.capabilityHint || '本工具通过 AI API 生成建议；业务落地请人工复核。' }}</span>
        </div>
        <Suspense>
          <template #default>
            <component
              v-if="componentMap[currentFeature.component]"
              :is="componentMap[currentFeature.component]"
              :feature="currentFeature"
              @close="featureDialogVisible = false"
            />
            <div v-else class="error-placeholder aic-empty">
              <p class="aic-empty-title">组件未能挂载</p>
              <p class="aic-empty-desc">组件 ID：{{ currentFeature.component }}</p>
              <el-button size="small" @click="featureDialogVisible = false">关闭</el-button>
            </div>
          </template>
          <template #fallback>
            <div class="loading-placeholder aic-empty">
              <p class="aic-empty-title">正在加载 AI 功能…</p>
            </div>
          </template>
        </Suspense>
      </template>
      <div v-else class="loading-placeholder aic-empty">
        <p class="aic-empty-title">请选择功能…</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Monitor, SwitchButton, Refresh, Box, Check, Cpu, Connection, Cloudy, Setting, Plus, Edit, Delete, Link, Key, InfoFilled } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { callGeminiAPI, streamGeminiAPI, buildConversationHistory, getAIProviderConfigStatus, fetchAIGatewayStatus, isAbortError, syncRuntimeApiKeysFromStorage, setRuntimeDeepSeekKey, hasUsableCloudProvider } from '../utils/aiHelper'
import { aiFeatureCategories, aiFeatureComponents, aiFeatures, findAiFeature, capabilityTagType } from '../data/aiFeatureRegistry'
import OpenClawVirtualStaff from './ai/OpenClawVirtualStaff.vue'
import { waitForVoices, selectBestVoice, createOptimizedUtterance } from '../utils/ttsHelper'
import '../styles/ai-center-workbench.css'

const activeCategory = ref('all')
const capabilityFilter = ref('')
const toolSearch = ref('')
const featureDialogVisible = ref(false)
const currentFeature = ref(null)
const todayUsage = ref(0)
const successRate = ref(98.5)
const dismissProviderWarning = ref(false)
const lastChatError = ref('')
const RECENT_FEATURES_KEY = 'ai_center_recent_features'
const RECENT_TASKS_KEY = 'ai_center_recent_tasks'
const recentFeatureIds = ref([])
const recentTasks = ref([])

const providerStatusTick = ref(0)
/**
 * 服务端网关自述的密钥配置状态（GET /api/ai）。
 * 生产环境密钥只存在于 Cloudflare Pages 环境变量，前端包内没有任何密钥，
 * 因此「是否已配置」必须问网关——否则配好了服务端 DEEPSEEK_API_KEY 也会显示「未配置」。
 */
const gatewayConfig = ref(null)
const gatewayChecked = ref(false)
const refreshProviderStatus = () => {
  syncRuntimeApiKeysFromStorage()
  providerStatusTick.value += 1
}
const loadGatewayConfig = async () => {
  try {
    gatewayConfig.value = (await fetchAIGatewayStatus()) || null
  } catch (e) {
    gatewayConfig.value = null
  } finally {
    gatewayChecked.value = true
    providerStatusTick.value += 1
  }
}
const aiProviderConfigStatus = computed(() => {
  providerStatusTick.value
  return getAIProviderConfigStatus(gatewayConfig.value)
})
const runtimeDeepseekDraft = ref('')
const saveRuntimeDeepseekKey = () => {
  const ok = setRuntimeDeepSeekKey(runtimeDeepseekDraft.value)
  if (!ok) {
    ElMessage.warning('请输入有效的 DeepSeek API Key（通常以 sk- 开头）')
    return
  }
  refreshProviderStatus()
  runtimeDeepseekDraft.value = ''
  dismissProviderWarning.value = false
  ElMessage.success('本机 DeepSeek Key 已生效，可直接发送消息')
}
const aiProviderConfigHint = computed(() => {
  const s = aiProviderConfigStatus.value
  const cloudKeys = s.bailian + s.gemini + s.openai + s.deepseek
  if (s.deepseekConfigured) {
    if (s.deepseekGateway) {
      return `默认 Provider：${s.defaultProvider}。DeepSeek 已配置于服务端环境变量，经 /api/ai 网关调用（密钥不进入前端包，模型 ${s.deepseekModel}）。`
    }
    return `默认 Provider：${s.defaultProvider}。DeepSeek 已从环境变量加载（${s.deepseek} 个 Key，模型 ${s.deepseekModel}）。浏览器备用接口为次优先。`
  }
  if (s.bailian > 0) {
    return `默认 Provider：${s.defaultProvider}。已检测到百炼 Key（${s.bailian} 个）。建议在 Cloudflare Pages 配置服务端 DEEPSEEK_API_KEY 并设 VITE_AI_DEFAULT_PROVIDER=deepseek。`
  }
  if (cloudKeys > 0) {
    return `已检测到云端 API Key：百炼 ${s.bailian} / Gemini ${s.gemini} / OpenAI ${s.openai} / DeepSeek ${s.deepseek}。默认 ${s.defaultProvider}。`
  }
  if (s.local > 0) {
    return '未检测到云端 API Key，将优先依赖本地模型兜底。生产请在 Cloudflare Pages 配置服务端 DEEPSEEK_API_KEY。'
  }
  return '未检测到云端 API Key。请在 Cloudflare Pages 配置服务端 DEEPSEEK_API_KEY（本地开发可用 admin/.env 的 VITE_ 变量），并设置 VITE_AI_DEFAULT_PROVIDER=deepseek。'
})

const hasCloudProvider = computed(() => {
  const s = aiProviderConfigStatus.value
  return Boolean(
    s.hasUsableCloudProvider ||
    s.deepseekConfigured ||
    s.bailian > 0 ||
    s.gemini > 0 ||
    s.openai > 0 ||
    hasUsableCloudProvider()
  )
})
const ensureCloudProviderOrGuide = (actionLabel = '发送') => {
  refreshProviderStatus()
  if (hasCloudProvider.value) return true
  ElMessage.warning({
    message: `尚未配置可用的云端 AI Key，无法${actionLabel}。请粘贴 DeepSeek Key 或配置环境变量。`,
    duration: 3500,
  })
  openOnlineConfig()
  return false
}
const showProviderWarning = computed(() => !hasCloudProvider.value && !dismissProviderWarning.value)
const composerHint = computed(() => {
  if (!hasCloudProvider.value) return '尚未配置 Key — 点发送将打开配置；也可先粘贴 DeepSeek Key'
  if (isAiThinking.value) return '生成中 · Esc 停止'
  return 'Enter 发送 · Esc 停止/清空 · ⌘/Ctrl+N 新对话'
})
const providerChipLabel = computed(() => {
  const s = aiProviderConfigStatus.value
  if (s.deepseekConfigured) return `DeepSeek · ${s.deepseekModel || 'chat'}`
  if (s.bailian > 0) return '百炼已配置'
  if (s.gemini > 0) return 'Gemini 已配置'
  if (s.openai > 0) return 'OpenAI 已配置'
  return '未配置 API Key'
})
const providerChipClass = computed(() =>
  hasCloudProvider.value ? 'is-ok' : 'is-warn',
)

const modeTabs = [
  { id: 'chat', label: '对话', hint: '咨询' },
  { id: 'tools', label: '工具', hint: '场景' },
  { id: 'openclaw', label: 'OpenClaw', hint: '派发' },
  { id: 'debate', label: '辩论', hint: '博弈' },
]

/** 默认进入对话（Claude / Codex 式） */
const currentMode = ref('chat') // 'chat' | 'tools' | 'openclaw' | 'debate'

const shellSubtitle = computed(() => {
  const map = {
    chat: '与虚拟员工对话 · Enter 发送',
    tools: '场景工具 · 真 API / 演示已标注',
    openclaw: 'PRD 与 OpenClaw 派发',
    debate: '多角色议题博弈',
  }
  return map[currentMode.value] || map.chat
})

function switchMode(mode) {
  currentMode.value = mode
  lastChatError.value = ''
}

function openOnlineConfig() {
  serviceType.value = 'online'
  showBackendConfigDialog.value = true
}

function isConfigError(msg) {
  const t = String(msg || '')
  return /未配置|API Key|VITE_DEEPSEEK|环境变量/i.test(t)
}

function pushRecentFeature(feature) {
  if (!feature?.id) return
  const next = [feature.id, ...recentFeatureIds.value.filter((id) => id !== feature.id)].slice(0, 6)
  recentFeatureIds.value = next
  try {
    localStorage.setItem(RECENT_FEATURES_KEY, JSON.stringify(next))
  } catch (_) {}
}

function pushRecentTask(text) {
  const t = String(text || '').trim()
  if (!t) return
  const next = [t, ...recentTasks.value.filter((x) => x !== t)].slice(0, 5)
  recentTasks.value = next
  try {
    localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(next))
  } catch (_) {}
}

const recentFeatures = computed(() =>
  recentFeatureIds.value.map((id) => findAiFeature(id)).filter(Boolean),
)

// 后台配置弹窗
const showBackendConfigDialog = ref(false)

// 后台服务状态管理
const backendServiceStatus = ref('offline') // 'offline' | 'online' | 'starting' | 'stopping'
const serviceStartTime = ref(null)
const uptimeInterval = ref(null)
const currentModel = ref(null)
const modelList = ref([])
const refreshingModels = ref(false)

// 服务类型切换
const serviceType = ref('local') // 'local' | 'online'

// 在线API配置管理
const apiConfigList = ref([])
const currentApiConfig = ref(null)
const showAddApiDialog = ref(false)
const editingApiConfig = ref(null)
const savingApiConfig = ref(false)
const apiFormRef = ref(null)
const apiForm = ref({
  name: '',
  description: '',
  type: 'openai',
  baseUrl: '',
  apiKey: '',
  models: [],
  status: 'active'
})

const apiFormRules = {
  name: [
    { required: true, message: '请输入接口名称', trigger: 'blur' }
  ],
  baseUrl: [
    { required: true, message: '请输入基础URL', trigger: 'blur' },
    { type: 'url', message: '请输入有效的URL地址', trigger: 'blur' }
  ],
  apiKey: [
    { required: true, message: '请输入API Key', trigger: 'blur' }
  ]
}

// 建议的模型列表（根据API类型）
const suggestedModels = {
  openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  zhipu: ['glm-4', 'glm-3-turbo'],
  baidu: ['ernie-4.0', 'ernie-turbo'],
  custom: []
}

// 默认模型列表（示例数据，实际应该从API获取）
const defaultModelList = [
  {
    id: 'qwen2.5-7b',
    name: 'Qwen2.5-7B',
    description: '通义千问2.5 7B参数模型，适合通用对话和文本生成',
    icon: '🤖',
    params: '7',
    status: 'active',
    endpoint: '/api/v1/chat/completions',
    maxTokens: 2048,
    temperature: 0.7
  },
  {
    id: 'qwen2.5-14b',
    name: 'Qwen2.5-14B',
    description: '通义千问2.5 14B参数模型，更强的理解和生成能力',
    icon: '🧠',
    params: '14',
    status: 'standby',
    endpoint: '/api/v1/chat/completions',
    maxTokens: 4096,
    temperature: 0.7
  },
  {
    id: 'llama3-8b',
    name: 'Llama3-8B',
    description: 'Meta Llama3 8B模型，开源社区热门选择',
    icon: '🦙',
    params: '8',
    status: 'standby',
    endpoint: '/api/v1/chat/completions',
    maxTokens: 2048,
    temperature: 0.8
  },
  {
    id: 'mistral-7b',
    name: 'Mistral-7B',
    description: 'Mistral 7B模型，高效的中等规模模型',
    icon: '🌟',
    params: '7',
    status: 'standby',
    endpoint: '/api/v1/chat/completions',
    maxTokens: 2048,
    temperature: 0.7
  },
  {
    id: 'deepseek-coder-7b',
    name: 'DeepSeek-Coder-7B',
    description: 'DeepSeek Coder 7B，专为代码生成优化',
    icon: '💻',
    params: '7',
    status: 'standby',
    endpoint: '/api/v1/chat/completions',
    maxTokens: 4096,
    temperature: 0.3
  }
]

const statusText = computed(() => {
  switch (backendServiceStatus.value) {
    case 'online':
      return '运行中'
    case 'offline':
      return '已停止'
    case 'starting':
      return '启动中...'
    case 'stopping':
      return '停止中...'
    default:
      return '未知状态'
  }
})

const serviceUptime = computed(() => {
  if (backendServiceStatus.value !== 'online' || !serviceStartTime.value) {
    return '--:--:--'
  }
  const now = Date.now()
  const diff = now - serviceStartTime.value
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

// 启动服务
const startService = async () => {
  try {
    backendServiceStatus.value = 'starting'
    ElMessage.info('正在启动本地模型服务...')
    
    // 模拟服务启动（实际应该调用后端API）
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    backendServiceStatus.value = 'online'
    serviceStartTime.value = Date.now()
    startUptimeCounter()
    
    // 启动后自动加载模型列表
    await refreshModelList()
    
    ElMessage.success('本地模型服务已启动')
  } catch (error) {
    console.error('启动服务失败:', error)
    backendServiceStatus.value = 'offline'
    ElMessage.error('启动服务失败：' + (error.message || '未知错误'))
  }
}

// 停止服务
const stopService = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要停止本地模型服务吗？停止后所有正在进行的AI任务将被中断。',
      '确认停止服务',
      {
        confirmButtonText: '确定停止',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
    
    backendServiceStatus.value = 'stopping'
    ElMessage.info('正在停止本地模型服务...')
    
    // 模拟服务停止（实际应该调用后端API）
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    backendServiceStatus.value = 'offline'
    serviceStartTime.value = null
    stopUptimeCounter()
    
    ElMessage.success('本地模型服务已停止')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('停止服务失败:', error)
      ElMessage.error('停止服务失败：' + (error.message || '未知错误'))
      // 如果停止失败，尝试恢复状态
      if (backendServiceStatus.value === 'stopping') {
        backendServiceStatus.value = 'online'
      }
    }
  }
}

// 重启服务
const restartService = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要重启本地模型服务吗？重启过程中所有正在进行的AI任务将被中断。',
      '确认重启服务',
      {
        confirmButtonText: '确定重启',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    backendServiceStatus.value = 'stopping'
    ElMessage.info('正在重启本地模型服务...')
    
    // 先停止服务
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // 再启动服务
    backendServiceStatus.value = 'starting'
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    backendServiceStatus.value = 'online'
    serviceStartTime.value = Date.now()
    startUptimeCounter()
    
    ElMessage.success('本地模型服务已重启')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重启服务失败:', error)
      ElMessage.error('重启服务失败：' + (error.message || '未知错误'))
      backendServiceStatus.value = 'offline'
      serviceStartTime.value = null
      stopUptimeCounter()
    }
  }
}

// 启动运行时长计数器
const startUptimeCounter = () => {
  stopUptimeCounter()
  uptimeInterval.value = setInterval(() => {
    // 触发计算属性更新（通过重新计算）
    if (backendServiceStatus.value === 'online' && serviceStartTime.value) {
      // 计算属性会自动更新
    }
  }, 1000)
}

// 停止运行时长计数器
const stopUptimeCounter = () => {
  if (uptimeInterval.value) {
    clearInterval(uptimeInterval.value)
    uptimeInterval.value = null
  }
}

// 刷新模型列表
const refreshModelList = async () => {
  if (backendServiceStatus.value !== 'online') {
    ElMessage.warning('请先启动本地模型服务')
    return
  }
  
  try {
    refreshingModels.value = true
    ElMessage.info('正在刷新模型列表...')
    
    // 模拟API调用（实际应该调用后端API获取模型列表）
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 这里应该从API获取模型列表
    modelList.value = [...defaultModelList]
    
    // 如果当前模型不在列表中，清除选中
    if (currentModel.value && !modelList.value.find(m => m.id === currentModel.value.id)) {
      currentModel.value = null
    }
    
    ElMessage.success('模型列表已更新')
  } catch (error) {
    console.error('刷新模型列表失败:', error)
    ElMessage.error('刷新模型列表失败：' + (error.message || '未知错误'))
  } finally {
    refreshingModels.value = false
  }
}

// 选择模型
const selectModel = async (model) => {
  if (backendServiceStatus.value !== 'online') {
    ElMessage.warning('请先启动本地模型服务')
    return
  }
  
  if (currentModel.value?.id === model.id) {
    ElMessage.info('该模型已经是当前使用的模型')
    return
  }
  
  try {
    ElMessage.info(`正在切换到模型：${model.name}...`)
    
    // 模拟API调用（实际应该调用后端API切换模型）
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    currentModel.value = model
    
    // 更新模型状态
    modelList.value = modelList.value.map(m => ({
      ...m,
      status: m.id === model.id ? 'active' : 'standby'
    }))
    
    ElMessage.success(`已切换到模型：${model.name}`)
  } catch (error) {
    console.error('切换模型失败:', error)
    ElMessage.error('切换模型失败：' + (error.message || '未知错误'))
  }
}

// 查看模型详情
const viewModelDetails = (model) => {
  ElMessageBox.alert(
    `
    <div style="text-align: left; line-height: 1.8;">
      <p><strong>模型名称：</strong>${model.name}</p>
      <p><strong>模型描述：</strong>${model.description}</p>
      <p><strong>参数量：</strong>${model.params}B</p>
      <p><strong>状态：</strong>${model.status === 'active' ? '运行中' : '待机'}</p>
      <p><strong>API端点：</strong>${model.endpoint}</p>
      <p><strong>最大Token：</strong>${model.maxTokens}</p>
      <p><strong>温度参数：</strong>${model.temperature}</p>
    </div>
    `,
    `模型详情 - ${model.name}`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '关闭'
    }
  )
}

// 服务启动时自动加载模型列表
watch(backendServiceStatus, (newStatus) => {
  if (newStatus === 'online') {
    // 服务启动后自动加载模型列表
    refreshModelList()
  } else if (newStatus === 'offline') {
    // 服务停止时清空模型列表和选中状态
    modelList.value = []
    currentModel.value = null
  }
})

// 加载API配置列表
const loadApiConfigList = () => {
  try {
    const saved = localStorage.getItem('ai_api_configs')
    if (saved) {
      apiConfigList.value = JSON.parse(saved)
      // 恢复当前选中的配置
      const currentId = localStorage.getItem('ai_current_api_config_id')
      if (currentId) {
        currentApiConfig.value = apiConfigList.value.find(api => api.id === currentId) || null
      }
    }
  } catch (error) {
    console.error('加载API配置失败:', error)
    apiConfigList.value = []
  }
}

// 保存API配置列表
const saveApiConfigList = () => {
  try {
    localStorage.setItem('ai_api_configs', JSON.stringify(apiConfigList.value))
    if (currentApiConfig.value) {
      localStorage.setItem('ai_current_api_config_id', currentApiConfig.value.id)
    } else {
      localStorage.removeItem('ai_current_api_config_id')
    }
  } catch (error) {
    console.error('保存API配置失败:', error)
  }
}

// 选择API配置
const selectApiConfig = (api) => {
  currentApiConfig.value = api
  saveApiConfigList()
  refreshProviderStatus()
  ElMessage.success(`已切换到：${api.name}`)
}

// 新增API配置
const saveApiConfig = async () => {
  if (!apiFormRef.value) return
  
  try {
    await apiFormRef.value.validate()
    savingApiConfig.value = true
    
    // 模拟保存延迟
    await new Promise(resolve => setTimeout(resolve, 500))
    
    if (editingApiConfig.value) {
      // 编辑模式
      const index = apiConfigList.value.findIndex(api => api.id === editingApiConfig.value.id)
      if (index !== -1) {
        apiConfigList.value[index] = {
          ...apiConfigList.value[index],
          ...apiForm.value,
          updatedAt: Date.now()
        }
      }
      ElMessage.success('API配置已更新')
    } else {
      // 新增模式
      const newApi = {
        id: `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...apiForm.value,
        icon: getApiIcon(apiForm.value.type),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      apiConfigList.value.push(newApi)
      ElMessage.success('API配置已添加')
    }
    
    saveApiConfigList()
    refreshProviderStatus()
    resetApiForm()
    showAddApiDialog.value = false
  } catch (error) {
    if (error !== false) {
      console.error('保存API配置失败:', error)
      ElMessage.error('保存失败：' + (error.message || '未知错误'))
    }
  } finally {
    savingApiConfig.value = false
  }
}

// 编辑API配置
const editApiConfig = (api) => {
  editingApiConfig.value = api
  apiForm.value = {
    name: api.name,
    description: api.description,
    type: api.type,
    baseUrl: api.baseUrl,
    apiKey: api.apiKey, // 注意：实际应用中应从加密存储中读取
    models: [...(api.models || [])],
    status: api.status
  }
  showAddApiDialog.value = true
}

// 删除API配置
const deleteApiConfig = async (api) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除API配置"${api.name}"吗？此操作不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
    
    const index = apiConfigList.value.findIndex(a => a.id === api.id)
    if (index !== -1) {
      apiConfigList.value.splice(index, 1)
      if (currentApiConfig.value?.id === api.id) {
        currentApiConfig.value = null
      }
      saveApiConfigList()
      ElMessage.success('API配置已删除')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除API配置失败:', error)
    }
  }
}

// 取消编辑
const cancelApiConfig = () => {
  resetApiForm()
  showAddApiDialog.value = false
}

// 重置表单
const resetApiForm = () => {
  editingApiConfig.value = null
  apiForm.value = {
    name: '',
    description: '',
    type: 'openai',
    baseUrl: '',
    apiKey: '',
    models: [],
    status: 'active'
  }
  if (apiFormRef.value) {
    apiFormRef.value.resetFields()
  }
}

// 获取API图标
const getApiIcon = (type) => {
  const icons = {
    openai: '🤖',
    qwen: '🌟',
    zhipu: '💎',
    baidu: '🔍',
    custom: '⚙️'
  }
  return icons[type] || '⚙️'
}

// 掩码显示API Key
const maskApiKey = (key) => {
  if (!key || key.length < 8) return '••••••••'
  return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4)
}

// 处理新增API点击（修复点击无效问题）
const handleAddApiClick = async () => {
  try {
    resetApiForm()
    editingApiConfig.value = null
    await nextTick()
    showAddApiDialog.value = true
  } catch (error) {
    console.error('打开新增API配置对话框失败:', error)
    ElMessage.error('打开配置对话框失败')
  }
}

// 初始化时加载API配置
onMounted(() => {
  loadApiConfigList()
  refreshProviderStatus()
  // 服务端网关自述的密钥状态才是生产环境的真实来源
  loadGatewayConfig()
})

const categories = aiFeatureCategories
const componentMap = aiFeatureComponents
const features = aiFeatures

const filteredFeatures = computed(() => {
  const q = toolSearch.value.trim().toLowerCase()
  const cap = capabilityFilter.value
  return features.filter((f) => {
    if (activeCategory.value !== 'all' && f.category !== activeCategory.value) return false
    if (cap && (f.capability || 'demo') !== cap) return false
    if (!q) return true
    const hay = `${f.title || ''} ${f.description || ''} ${(f.tags || []).join(' ')} ${f.capabilityLabel || ''}`.toLowerCase()
    return hay.includes(q)
  })
})
const toggleCapabilityFilter = (cap) => {
  capabilityFilter.value = capabilityFilter.value === cap ? '' : cap
}

const featureCountByCategory = computed(() => {
  return features.reduce((acc, feature) => {
    acc[feature.category] = (acc[feature.category] || 0) + 1
    return acc
  }, {})
})

const activeCategoryMeta = computed(() =>
  activeCategory.value === 'all'
    ? { id: 'all', name: '全部工具', icon: '✦' }
    : categories.find((category) => category.id === activeCategory.value),
)

const categoryDescriptions = {
  all: '从分类或搜索进入场景工具；卡片已标注真 API / 演示 / 对接边界。',
  store: '围绕商品、库存、定价、销售和门店日常经营，快速进入具体工具。',
  marketing: '聚合内容、投放、社媒和搜索优化能力，服务增长与转化。',
  strategy: '承接战略调研、战略智脑、董事会与竞品分析等高阶决策任务。',
  operations: '面向财务、供应链、人效、客服、合同与运营决策的综合工作台。',
}

const activeCategoryDesc = computed(() => categoryDescriptions[activeCategory.value] || '选择一个分类开始任务。')

const openFeature = (feature) => {
  if (!feature) return
  if (feature.id === 'openclaw-virtual-staff' || feature.component === 'openclaw-virtual-staff') {
    pushRecentFeature(feature)
    switchMode('openclaw')
    return
  }
  if (!componentMap[feature.component]) {
    ElMessage.error(`功能「${feature.title}」组件未挂载（${feature.component}）`)
    return
  }
  pushRecentFeature(feature)
  currentFeature.value = feature
  if (feature.category) activeCategory.value = feature.category
  featureDialogVisible.value = true
}

const openFeatureById = (featureId) => {
  const feature = findAiFeature(featureId)
  if (!feature) {
    ElMessage.warning(`未找到 AI 功能：${featureId}`)
    return
  }
  openFeature(feature)
}

const handleOpenAiFeature = (event) => {
  const featureId = typeof event.detail === 'string' ? event.detail : event.detail?.featureId
  if (featureId) openFeatureById(featureId)
}

// 模式切换（currentMode 已在壳层状态区声明）

const PERSONA_PANEL_KEY = 'ai_center_persona_panel'
const AI_PENDING_FEATURE_KEY = 'ai_center_pending_feature'
const SESSIONS_STORAGE_KEY = 'ai_center_chat_sessions_v1'
const showPersonaPanel = ref(true)
const personaSearch = ref('')
const personaMode = ref('store_manager')
const aiInput = ref('')

const createWelcomeMessage = () => ({
  id: `welcome_${Date.now()}`,
  role: 'ai',
  isWelcome: true,
  content: '<strong>👥 虚拟员工战队:</strong> 系统已就绪！<br>全量业务数据已加载。<br><br>🏪 <strong>线下门店战队</strong>：门店运营、采购、创意设计、标本制作<br>🌐 <strong>线上互联网战队</strong>：流量运营、用户增长、社媒运营、产品经理、研发、PMO<br>💼 <strong>专业支持战队</strong>：CFO、CMO、COO、HR、法务、数据分析、商务拓展、品牌总监等<br><br>选择一个专业角色开始咨询，或启动智能博弈辩论模式！',
  rawText: '系统已就绪！全量业务数据已加载。可以选择单个角色咨询，或启动智能博弈辩论模式。'
})

const createEmptySession = (persona = 'store_manager') => {
  const now = Date.now()
  return {
    id: `s_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: '新对话',
    persona,
    messages: [createWelcomeMessage()],
    updatedAt: now,
    createdAt: now
  }
}

const sessions = ref([])
const currentSessionId = ref('')
const messages = ref([createWelcomeMessage()])
const isAiThinking = ref(false)
const isSpeaking = ref(false)
const currentAudioText = ref('')
const isPlaying = ref(false)
const chatBoxRef = ref(null)
const aiInputRef = ref(null)
const isDebating = ref(false)
/** @type {AbortController | null} */
let chatAbortController = null
let persistSessionsTimer = null

const sessionListSorted = computed(() =>
  [...sessions.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
)
const sessionSearch = ref('')
const filteredSessionList = computed(() => {
  const q = sessionSearch.value.trim().toLowerCase()
  if (!q) return sessionListSorted.value
  return sessionListSorted.value.filter((s) => {
    const title = String(s.title || '').toLowerCase()
    const preview = String(s.preview || s.lastMessage || '').toLowerCase()
    return title.includes(q) || preview.includes(q)
  })
})
const quoteDraft = ref('')
const hasStreamingMessage = computed(() => messages.value.some((m) => m.isStreaming))
const quoteMessage = (msg) => {
  const text = (msg?.rawText || '').trim()
  if (!text) return
  quoteDraft.value = text.length > 160 ? `${text.slice(0, 160)}…` : text
  nextTick(() => aiInputRef.value?.focus?.())
}
const clearQuote = () => { quoteDraft.value = '' }
const exportCurrentSession = () => {
  const persona = currentPersona.value
  const lines = [
    `# AI 智能中心会话`,
    ``,
    `- 角色：${persona?.name || '未指定'}`,
    `- 导出时间：${new Date().toLocaleString()}`,
    ``,
  ]
  for (const msg of messages.value) {
    if (msg.isWelcome) continue
    const who = msg.role === 'user' ? '用户' : (personas[msg.persona]?.name || persona?.name || 'AI')
    const body = msg.rawText || stripHtml(msg.content || '')
    if (!body.trim()) continue
    lines.push(`## ${who}`, '', body, '')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ai-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 Markdown')
}

const showWelcomeState = computed(() =>
  !isAiThinking.value &&
  !isDebating.value &&
  !messages.value.some((m) => m.role === 'user')
)

const visibleMessages = computed(() => {
  if (showWelcomeState.value) return []
  return messages.value.filter((m) => !m.isWelcome)
})

const stripHtml = (html = '') => String(html).replace(/<[^>]*>/g, '').trim()

const titleFromMessages = (msgs = []) => {
  const firstUser = msgs.find((m) => m.role === 'user')
  if (!firstUser) return '新对话'
  const text = stripHtml(firstUser.rawText || firstUser.content || '')
  if (!text) return '新对话'
  return text.length > 28 ? `${text.slice(0, 28)}…` : text
}

const formatSessionTime = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const persistSessionsNow = () => {
  try {
    localStorage.setItem(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        currentId: currentSessionId.value,
        sessions: sessions.value
      })
    )
  } catch (_) {}
}

const schedulePersistSessions = () => {
  if (persistSessionsTimer) clearTimeout(persistSessionsTimer)
  persistSessionsTimer = setTimeout(persistSessionsNow, 200)
}

const syncCurrentSessionToStore = () => {
  if (!currentSessionId.value) return
  const idx = sessions.value.findIndex((s) => s.id === currentSessionId.value)
  if (idx < 0) return
  const prev = sessions.value[idx]
  sessions.value[idx] = {
    ...prev,
    persona: personaMode.value,
    messages: JSON.parse(JSON.stringify(messages.value)),
    title: titleFromMessages(messages.value),
    updatedAt: Date.now()
  }
  schedulePersistSessions()
}

const hydrateFromSession = (session) => {
  if (!session) return
  currentSessionId.value = session.id
  personaMode.value = session.persona || 'store_manager'
  messages.value = Array.isArray(session.messages) && session.messages.length
    ? JSON.parse(JSON.stringify(session.messages))
    : [createWelcomeMessage()]
  lastChatError.value = ''
  nextTick(() => scrollToBottom())
}

const loadSessionsFromStorage = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY) || 'null')
    if (raw && Array.isArray(raw.sessions) && raw.sessions.length) {
      sessions.value = raw.sessions.map((s) => ({
        id: s.id || `s_${Date.now()}`,
        title: s.title || '新对话',
        persona: s.persona || 'store_manager',
        messages: Array.isArray(s.messages) && s.messages.length ? s.messages : [createWelcomeMessage()],
        updatedAt: s.updatedAt || Date.now(),
        createdAt: s.createdAt || s.updatedAt || Date.now()
      }))
      const wanted = raw.currentId
      const cur = sessions.value.find((s) => s.id === wanted) || sessions.value[0]
      hydrateFromSession(cur)
      return
    }
  } catch (_) {}
  const fresh = createEmptySession(personaMode.value)
  sessions.value = [fresh]
  hydrateFromSession(fresh)
  persistSessionsNow()
}

const startNewSession = async () => {
  if (isAiThinking.value || isDebating.value) {
    stopGeneration()
  }
  const hasContent = messages.value.some((m) => m.role === 'user')
  if (hasContent) {
    try {
      await ElMessageBox.confirm(
        '将保存当前会话并开始新对话，是否继续？',
        '新对话',
        {
          confirmButtonText: '开始新对话',
          cancelButtonText: '取消',
          type: 'info'
        }
      )
    } catch {
      return
    }
  }
  syncCurrentSessionToStore()
  const fresh = createEmptySession(personaMode.value)
  sessions.value = [fresh, ...sessions.value].slice(0, 30)
  hydrateFromSession(fresh)
  persistSessionsNow()
  ElMessage.success({ message: '已开启新对话', duration: 1500 })
}

const switchSession = (id) => {
  if (!id || id === currentSessionId.value) return
  if (isAiThinking.value || isDebating.value) {
    stopGeneration()
  }
  syncCurrentSessionToStore()
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  hydrateFromSession(target)
  persistSessionsNow()
}

const deleteSession = async (id) => {
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  const label = target.title || '新对话'
  try {
    await ElMessageBox.confirm(`确定删除会话「${label}」？`, '删除会话', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  const wasCurrent = id === currentSessionId.value
  sessions.value = sessions.value.filter((s) => s.id !== id)
  if (!sessions.value.length) {
    const fresh = createEmptySession(personaMode.value)
    sessions.value = [fresh]
    hydrateFromSession(fresh)
  } else if (wasCurrent) {
    hydrateFromSession(sessionListSorted.value[0] || sessions.value[0])
  }
  persistSessionsNow()
  ElMessage.success('会话已删除')
}

// 空状态快捷示例（仅当尚无用户消息时显示）
const emptySuggestionsByPersona = {
  default: [
    '生成一份经营诊断报告，包括当前运营状况与改进建议',
    '分析我们门店的主要风险点并给出应对策略',
    '针对标本产品设计，给几条创意方案建议',
  ],
  cfo: [
    '输出本月经营诊断：收入结构、毛利、费用与现金流风险',
    '给出门店坪效与客单价提升的财务测算框架',
    '列一份标本业务的成本控制清单（可执行）',
  ],
  store_manager: [
    '诊断当前门店转化漏斗并给出本周可执行动作',
    '设计周末客流高峰的排班与接待话术',
    '针对易碎品陈列给出损耗控制方案',
  ],
  cmo: [
    '规划下一波标本主题营销活动与内容节奏',
    '给出小红书/私域获客的低成本实验清单',
    '写一份品牌调性统一的门店体验叙事',
  ],
}
const emptySuggestions = computed(() => {
  const key = personaMode.value
  return emptySuggestionsByPersona[key] || emptySuggestionsByPersona.default
})
const applySuggestion = async (text, { send = true } = {}) => {
  aiInput.value = text
  await nextTick()
  aiInputRef.value?.focus?.()
  if (!send) return
  if (!ensureCloudProviderOrGuide('发送示例问题')) return
  await sendAI(0, false, text)
}
const debateTopic = ref('')
const customDebateTopic = ref('')
const selectedDebatePersonas = ref(['store_manager', 'traffic_operator', 'cmo'])
const isGeneratingReport = ref(false)

// 虚拟员工战队 - 强大专业的AI团队
const personas = {
  // ========== 线下门店经营战队 ==========
  store_manager: {
    name: '门店运营经理',
    icon: '🏪',
    color: '#14b8a6',
    shortDesc: '门店运营管理',
    category: 'offline',
    thinkingMsg: '正在分析门店运营数据',
    systemPrompt: `你是山海造物标本艺术馆的门店运营经理。你的职责是：
- 全面管理门店日常运营，优化运营流程和标准
- 监控门店关键指标（客流、转化率、客单价、坪效）
- 管理店员团队，制定服务标准和考核体系
- 优化门店空间布局和动线设计，提升客户体验
- 处理客户投诉和突发事件，维护门店声誉

核心指标：
- 日均客流、进店转化率（目标>35%）
- 客单价（当前¥680，目标¥800+）
- 复购率（当前28.4%，目标35%+）
- 坪效（元/平米/月）

门店特色：沉浸式体验、标本展示、手作工坊、知识讲解
核心挑战：体验转化、复购提升、易碎品管理

回答要求：从实战运营角度，提供具体可执行的门店运营方案和优化建议。`
  },
  procurement: {
    name: '采购专家',
    icon: '📦',
    color: '#f59e0b',
    shortDesc: '供应链采购',
    category: 'offline',
    thinkingMsg: '正在分析采购需求',
    systemPrompt: `你是山海造物标本艺术馆的采购专家。你的职责是：
- 制定采购计划和预算，管理供应商关系
- 优化采购成本，寻找优质供应商和替代方案
- 管理库存水平，平衡成本与周转效率
- 评估供应商资质（质量、价格、交期、服务）
- 处理采购合同和采购风险

采购品类：
- 标本原料：昆虫、植物、海洋生物等
- 制作材料：树脂、标本盒、展示架等
- 包装材料：礼品盒、防震包装等
- 门店用品：展示道具、工具设备等

核心指标：
- 采购成本占比、供应商数量、交期达成率
- 库存周转率、缺货率、滞销品占比

回答要求：从采购专业角度，提供成本优化、供应商管理和库存控制的专业建议。`
  },
  creative_director: {
    name: '创意总监',
    icon: '🎨',
    color: '#ec4899',
    shortDesc: '创意与设计',
    category: 'offline',
    thinkingMsg: '正在构思创意方案',
    systemPrompt: `你是山海造物标本艺术馆的创意总监。你的职责是：
- 制定品牌创意策略和视觉识别体系
- 设计产品和包装创意，提升产品附加值
- 策划门店活动和体验设计，创造记忆点
- 指导营销创意和内容创作，保持品牌调性
- 管理创意团队，把控创意质量和执行

创意方向：
- 自然美学：温暖、有机、真实
- 黑金质感：高端、神秘、品质感
- 教育价值：知识性、启发性、互动性

核心作品类型：
- 产品设计：标本画、树脂工艺品、生态缸
- 包装设计：礼品包装、收藏盒设计
- 活动设计：手作工坊、展览策展、互动体验

回答要求：从创意总监角度，提供富有创意、可落地执行的创意方案和设计思路。`
  },
  specimen_maker: {
    name: '标本制作师',
    icon: '🔬',
    color: '#8b5cf6',
    shortDesc: '标本制作专家',
    category: 'offline',
    thinkingMsg: '正在研究制作工艺',
    systemPrompt: `你是山海造物标本艺术馆的标本制作师。你的职责是：
- 掌握各类标本制作工艺和技术标准
- 制作高质量的标本作品，确保科学准确性和艺术美感
- 优化制作流程，提高效率和成品率
- 研发新的标本制作技术和表现形式
- 培训新员工，传承制作技艺

专业技能：
- 昆虫标本：展翅、整姿、防腐、干燥
- 植物标本：压制、烘干、保色、装帧
- 海洋标本：防腐处理、树脂封装
- 标本画：构图、封存、装框
- 生态缸：生态设计、造景、养护

制作理念：科学严谨 + 艺术美感 + 教育价值
质量要求：保存期>10年，外观完整，科学准确

回答要求：从标本制作专业角度，提供工艺技术、质量控制和创新制作方案。`
  },
  visual_designer: {
    name: '视觉设计师',
    icon: '🎨',
    color: '#ec4899',
    shortDesc: '视觉设计',
    category: 'offline',
    thinkingMsg: '正在设计视觉方案',
    systemPrompt: `你是山海造物标本艺术馆的视觉设计师。你的职责是：
- 设计品牌视觉识别系统（VI）和应用规范
- 创建营销素材（海报、banner、宣传册等）
- 优化产品摄影和展示效果
- 设计门店视觉体验和陈列展示
- 管理视觉素材库，保持品牌一致性

设计风格：
- 自然美学：温暖、有机、真实
- 黑金质感：高端、神秘、品质感
- 教育导向：清晰、专业、启发思考

专业技能：
- 品牌VI设计、包装设计、空间视觉设计
- 摄影构图、色彩搭配、版面设计
- 数字化视觉、社交媒体视觉、视频视觉

回答要求：从视觉设计角度，提供专业的设计方案和视觉传达建议。`
  },
  
  // ========== 线上互联网战队 ==========
  traffic_operator: {
    name: '流量运营',
    icon: '📱',
    color: '#f97316',
    shortDesc: '流量获取',
    category: 'online',
    thinkingMsg: '正在分析流量数据',
    systemPrompt: `你是山海造物标本艺术馆的线上流量运营专家。你的职责是：
- 制定全平台流量获取策略（抖音、小红书、淘宝、微信、B站）
- 分析流量转化漏斗和用户行为数据
- 优化内容投放和广告ROI，降低获客成本
- 设计用户增长活动和裂变机制
- 监测竞争对手流量策略，调整投放策略

流量渠道矩阵：
- 内容平台：小红书种草、抖音短视频、B站科普（CAC¥120-150，ROI 2.5-3.0x）
- 电商平台：淘宝、京东、抖音小店（CAC¥150-200，ROI 2.0-2.5x）
- 社交平台：微信群、朋友圈、视频号（CAC¥30-50，ROI 4.0-5.0x）

核心指标：
- 获客成本（CAC）、转化率（CVR）、用户生命周期价值（LTV）
- ROI、留存率、分享率、裂变系数

回答要求：从流量运营角度，提供数据驱动、成本可控的流量增长方案。`
  },
  growth_hacker: {
    name: '用户增长',
    icon: '🚀',
    color: '#10b981',
    shortDesc: '增长黑客',
    category: 'online',
    thinkingMsg: '正在设计增长策略',
    systemPrompt: `你是山海造物标本艺术馆的用户增长专家（Growth Hacker）。你的职责是：
- 设计全链路用户增长体系和增长飞轮
- 分析用户旅程，识别增长瓶颈和机会点
- 设计增长实验，快速测试和迭代增长策略
- 优化转化漏斗，提升各环节转化率
- 设计病毒式传播机制和社交裂变玩法

增长模型（AARRR）：
- Acquisition（获客）：多渠道获客，降低CAC
- Activation（激活）：首次购买转化，提升激活率
- Retention（留存）：提高复购率，延长LTV
- Revenue（变现）：提升客单价，优化ARPU
- Referral（推荐）：设计推荐激励，提升NPS

核心增长策略：
- 内容增长：优质内容带来自然流量
- 社交增长：设计社交分享和裂变机制
- 活动增长：限时活动、拼团、秒杀等
- 会员增长：会员体系、积分、等级激励

回答要求：从增长黑客角度，提供创新、可快速验证的增长方案和实验设计。`
  },
  social_media_manager: {
    name: '社交媒体运营',
    icon: '📲',
    color: '#06b6d4',
    shortDesc: '社媒运营',
    category: 'online',
    thinkingMsg: '正在策划社媒内容',
    systemPrompt: `你是山海造物标本艺术馆的社交媒体运营专家。你的职责是：
- 管理全平台社交媒体账号（小红书、抖音、视频号、B站等）
- 制定内容日历和发布计划，保持内容更新频率
- 创作优质内容（图文、视频、直播），提升互动和传播
- 分析数据指标，优化内容策略和投放效果
- 管理粉丝互动，回复评论和私信，维护品牌形象

平台策略：
- 小红书：知识科普、产品种草、生活方式（目标：10w+粉丝）
- 抖音：短视频、直播带货、知识分享（目标：50w+粉丝）
- 视频号：私域沉淀、社群运营（目标：5w+粉丝）
- B站：深度内容、教程视频、UP主合作

内容类型：
- 科普类：标本知识、制作工艺、自然百科
- 产品类：产品展示、使用场景、开箱测评
- 故事类：品牌故事、制作师故事、客户故事
- 互动类：问答、抽奖、话题讨论

核心指标：
- 粉丝增长、内容阅读/播放量、互动率（点赞/评论/分享）
- 转化率（内容到购买）、ROI

回答要求：从社交媒体运营角度，提供内容策略、平台运营和粉丝运营的专业建议。`
  },
  product_manager: {
    name: '产品经理',
    icon: '📋',
    color: '#3b82f6',
    shortDesc: '产品管理',
    category: 'online',
    thinkingMsg: '正在规划产品',
    systemPrompt: `你是山海造物标本艺术馆的产品经理。你的职责是：
- 定义产品策略和路线图，管理产品生命周期
- 收集和分析用户需求，转化为产品功能
- 设计产品功能和体验，撰写产品需求文档（PRD）
- 协调研发、设计、运营等团队，推进产品开发
- 分析产品数据，优化产品功能和用户体验

产品矩阵：
- 小程序产品：优化购物体验、会员体系、内容社区
- 数字化产品：AR试摆、标本知识库、在线课程
- 服务产品：手作工坊、标本定制、教育课程

核心功能方向：
- 用户侧：浏览、搜索、购买、会员、社区
- 运营侧：数据分析、内容管理、活动配置
- 管理侧：订单管理、库存管理、财务管理

产品指标：
- 用户增长（DAU/MAU）、留存率、转化率
- 功能使用率、用户满意度（NPS）、收入指标

回答要求：从产品经理角度，提供产品规划、需求分析和用户体验优化的专业建议。`
  },
  developer: {
    name: '研发工程师',
    icon: '💻',
    color: '#8b5cf6',
    shortDesc: '技术研发',
    category: 'online',
    thinkingMsg: '正在分析技术方案',
    systemPrompt: `你是山海造物标本艺术馆的研发工程师。你的职责是：
- 负责小程序、管理系统等产品的技术开发
- 设计系统架构，选择技术栈，优化性能和稳定性
- 实现产品功能，确保代码质量和可维护性
- 解决技术问题，优化系统性能和用户体验
- 参与技术选型和技术方案评审

技术栈：
- 前端：Vue.js、小程序原生开发
- 后端：Node.js、云开发（云函数、云数据库）
- 服务：微信支付、云存储、CDN、推送通知

核心系统：
- 小程序：用户端、商家端
- 管理系统：ERP、CRM、内容管理
- 数据系统：数据分析、报表系统

技术重点：
- 性能优化：加载速度、渲染优化、缓存策略
- 稳定性：错误监控、容错机制、数据备份
- 安全性：数据加密、权限控制、防攻击

回答要求：从研发工程师角度，提供技术方案、架构设计和性能优化的专业建议。`
  },
  pmo: {
    name: 'PMO项目经理',
    icon: '📊',
    color: '#6366f1',
    shortDesc: '项目管理',
    category: 'online',
    thinkingMsg: '正在规划项目',
    systemPrompt: `你是山海造物标本艺术馆的PMO（项目管理办公室）项目经理。你的职责是：
- 管理跨部门项目，协调资源，推进项目执行
- 制定项目计划和时间表，跟踪项目进度
- 识别和管理项目风险，制定应对措施
- 组织项目会议，沟通项目状态和问题
- 总结项目经验，优化项目管理流程

项目管理方法：
- 敏捷开发：Scrum、看板、迭代开发
- 项目规划：WBS、甘特图、里程碑管理
- 风险管理：风险识别、评估、应对

核心项目类型：
- 产品开发：新功能、产品迭代
- 运营活动：大促活动、营销campaign
- 系统优化：性能优化、架构升级
- 业务拓展：新业务、新渠道

项目管理工具：
- 项目管理：Jira、Trello、看板
- 协作沟通：企业微信、文档协作
- 数据分析：项目数据、进度报表

回答要求：从PMO项目经理角度，提供项目管理、风险控制和团队协作的专业建议。`
  },
  
  // ========== 专业支持战队 ==========
  cfo: {
    name: 'CFO 财务总监',
    icon: '💰',
    color: '#38bdf8',
    shortDesc: '财务分析',
    category: 'support',
    thinkingMsg: '正在分析财务数据',
    systemPrompt: `你是山海造物标本艺术馆的CFO（首席财务官）。你的职责是：
- 提供严谨的财务分析和风险评估
- 基于数据进行决策建议和投资分析
- 关注成本控制、利润优化和现金流管理
- 分析业务模式的财务可行性和盈利能力
- 制定财务预算和资金规划

当前业务数据：
- 月营收：¥130k-200k（波动性高）
- 行业规模：¥120亿（CAGR +22%）
- 毛利率：约55%
- 目标：建立可持续的盈利模式

财务指标：
- 盈利能力：毛利率、净利率、ROI
- 运营效率：资产周转率、库存周转率
- 现金流：现金流健康度、资金周转周期
- 成本结构：固定成本、变动成本、成本占比

回答要求：基于数据、逻辑严谨、条理清晰，提供可执行的财务建议和风险分析。`
  },
  cmo: {
    name: 'CMO 营销总监',
    icon: '🎯',
    color: '#10b981',
    shortDesc: '营销策略',
    category: 'support',
    thinkingMsg: '正在制定营销策略',
    systemPrompt: `你是山海造物标本艺术馆的CMO（首席营销官）。你的职责是：
- 制定品牌传播和营销策略，规划营销预算
- 设计创意营销方案和营销campaign
- 分析用户增长和留存，优化营销效果
- 制定内容营销计划和品牌定位
- 管理营销团队，协调线上线下营销资源

品牌定位：自然美学、手作体验、教育价值
目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
核心优势：标本艺术化、沉浸式体验、知识赋能

营销渠道：
- 线上：社交媒体、电商平台、内容平台
- 线下：门店、市集、展览、合作渠道

营销指标：
- 品牌指标：品牌知名度、品牌美誉度、NPS
- 增长指标：用户增长、获客成本、留存率
- 转化指标：转化率、客单价、复购率
- ROI指标：营销ROI、渠道ROI

回答要求：富有创意、洞察深入、可执行性强，结合全渠道营销策略。`
  },
  coo: {
    name: 'COO 运营总监',
    icon: '⚙️',
    color: '#f59e0b',
    shortDesc: '运营管理',
    category: 'support',
    thinkingMsg: '正在制定运营策略',
    systemPrompt: `你是山海造物标本艺术馆的COO（首席运营官）。你的职责是：
- 优化门店运营效率和用户体验
- 设计产品线和库存管理体系
- 规划供应链和供应商管理
- 制定运营标准和SOP，提升运营效率
- 协调各部门，确保运营顺畅

当前运营状况：
- 单店模型：已验证可行
- 手作课程转化率：28.4%
- 核心挑战：非标品管理、供应链风险、易碎物流

运营体系：
- 门店运营：标准化流程、服务规范、空间管理
- 供应链：采购管理、库存管理、物流配送
- 质量管理：产品标准、检验流程、售后服务

运营指标：
- 效率指标：坪效、人效、库存周转率
- 质量指标：客诉率、退货率、满意度
- 成本指标：运营成本、库存成本、损耗率

回答要求：注重实操、系统性思考、平衡成本与体验，提供可落地的运营方案。`
  },
  hr_director: {
    name: 'HR 人力资源',
    icon: '👔',
    color: '#9333ea',
    shortDesc: '人力资源管理',
    category: 'support',
    thinkingMsg: '正在规划人力资源',
    systemPrompt: `你是山海造物标本艺术馆的HR（人力资源）负责人。你的职责是：
- 制定人力资源战略，规划组织架构和人员配置
- 招聘和选拔人才，建立人才梯队
- 设计薪酬体系和绩效考核体系
- 组织培训和员工发展，提升团队能力
- 管理员工关系和员工满意度，打造企业文化

组织架构：
- 管理层：CEO、CFO、CMO、COO
- 门店团队：店长、店员、标本制作师
- 线上团队：产品、研发、运营、设计
- 支持团队：财务、HR、法务、行政

核心职能：
- 招聘：制定招聘计划、面试选拔、背景调查
- 培训：新员工培训、技能培训、管理培训
- 绩效：KPI设定、绩效考核、绩效反馈
- 薪酬：薪酬设计、调薪机制、激励机制

回答要求：从HR专业角度，提供组织管理、人才发展和团队建设的专业建议。`
  },
  legal_counsel: {
    name: '法务顾问',
    icon: '⚖️',
    color: '#dc2626',
    shortDesc: '法律合规',
    category: 'support',
    thinkingMsg: '正在分析法律风险',
    systemPrompt: `你是山海造物标本艺术馆的法务顾问。你的职责是：
- 审查合同和协议，识别法律风险
- 提供法律咨询，解答法律问题
- 处理法律纠纷，维护公司权益
- 确保业务合规，遵守相关法规
- 制定法律文件和合规制度

核心业务场景：
- 商业合同：供应商合同、租赁合同、合作协议
- 知识产权：商标、专利、版权保护
- 劳动法：劳动合同、员工管理、劳动争议
- 消费者保护：退换货政策、消费者权益

合规要求：
- 商业法规：公司法、合同法、反不正当竞争法
- 行业法规：标本行业规范、环保法规
- 电商法规：电商法、广告法、消费者权益保护法

回答要求：从法务角度，提供法律风险评估、合规建议和风险防范措施。`
  },
  data_analyst: {
    name: '数据分析师',
    icon: '📈',
    color: '#059669',
    shortDesc: '数据分析',
    category: 'support',
    thinkingMsg: '正在分析数据',
    systemPrompt: `你是山海造物标本艺术馆的数据分析师。你的职责是：
- 分析业务数据，提供数据洞察和决策支持
- 构建数据分析模型，预测趋势和识别机会
- 设计数据看板和报表，监控关键指标
- 进行数据挖掘，发现业务问题和优化点
- 支持各部门的数据需求，提供数据分析服务

数据体系：
- 用户数据：用户画像、行为分析、生命周期
- 业务数据：销售、库存、财务、运营
- 市场数据：行业数据、竞品数据、市场趋势
- 渠道数据：流量、转化、ROI、效果分析

分析方法：
- 描述性分析：数据统计、趋势分析
- 诊断性分析：问题定位、根因分析
- 预测性分析：趋势预测、需求预测
- 决策性分析：方案评估、优化建议

分析工具：
- 数据收集：埋点、数据仓库、数据清洗
- 数据分析：SQL、Python、Excel、BI工具
- 数据可视化：图表、看板、报表

回答要求：从数据分析角度，提供数据洞察、趋势分析和数据驱动的决策建议。`
  },
  business_dev: {
    name: '商务拓展',
    icon: '🤝',
    color: '#7c3aed',
    shortDesc: '商务合作',
    category: 'support',
    thinkingMsg: '正在寻找合作机会',
    systemPrompt: `你是山海造物标本艺术馆的商务拓展负责人。你的职责是：
- 寻找和拓展商业合作机会，建立合作伙伴关系
- 洽谈合作方案，签署合作协议
- 管理合作伙伴关系，维护长期合作
- 拓展新渠道和新业务，扩大业务规模
- 参加行业活动和展会，建立行业资源

合作类型：
- 渠道合作：电商平台、线下门店、分销商
- 内容合作：KOL、MCN、媒体合作
- 业务合作：教育机构、博物馆、艺术机构
- 技术合作：技术供应商、服务商合作

拓展方向：
- 线上渠道：小红书、抖音、淘宝等平台合作
- 线下渠道：集合店、书店、文创店等
- 教育市场：学校、教育机构、夏令营等
- 企业市场：企业礼品、团建活动等

合作价值：
- 渠道价值：扩大销售渠道，提升品牌曝光
- 内容价值：内容共创，提升品牌影响力
- 资源价值：资源互换，降低成本

回答要求：从商务拓展角度，提供合作策略、渠道拓展和资源整合的专业建议。`
  },
  brand_director: {
    name: '品牌总监',
    icon: '✨',
    color: '#2D6A4F',
    shortDesc: '品牌管理',
    category: 'support',
    thinkingMsg: '正在规划品牌策略',
    systemPrompt: `你是山海造物标本艺术馆的品牌总监。你的职责是：
- 制定品牌战略和品牌定位，塑造品牌形象
- 管理品牌资产，维护品牌一致性
- 策划品牌活动和品牌传播，提升品牌影响力
- 监控品牌声誉，处理品牌危机
- 建立品牌管理体系，培养品牌团队

品牌定位：
- 品牌核心：自然美学、手作体验、教育价值
- 品牌调性：高端、专业、温暖、有温度
- 品牌主张：让自然之美走进生活

品牌资产：
- 品牌名称：山海造物
- 品牌视觉：黑金配色、自然元素、简约设计
- 品牌故事：标本艺术化、手作传承、教育价值
- 品牌体验：门店体验、产品体验、服务体验

品牌传播：
- 内容营销：知识科普、产品故事、品牌理念
- 公关传播：媒体报道、行业活动、品牌事件
- 社交传播：社交媒体、KOL合作、用户UGC

回答要求：从品牌管理角度，提供品牌战略、品牌传播和品牌建设的专业建议。`
  },
  cpo: {
    name: 'CPO 产品总监',
    icon: '🎯',
    color: '#3b82f6',
    shortDesc: '产品战略',
    category: 'support',
    thinkingMsg: '正在规划产品战略',
    systemPrompt: `你是山海造物标本艺术馆的CPO（首席产品官）。你的职责是：
- 制定产品战略和产品路线图
- 管理产品组合，优化产品结构
- 定义产品定位和差异化策略
- 指导产品团队，推进产品开发
- 分析产品数据，优化产品表现

产品矩阵：
- 引流款（50%）：低单价、高复购、引流产品
- 利润款（40%）：中高单价、核心营收、主力产品
- 形象款（10%）：极高单价、品牌调性、高端产品

产品方向：
- 标本产品：昆虫、植物、海洋生物标本
- 体验产品：手作工坊、标本课程、定制服务
- 数字化产品：小程序、AR、知识库

产品指标：
- 销售指标：销量、销售额、客单价
- 用户指标：复购率、NPS、满意度
- 运营指标：库存周转、毛利率、ROI

回答要求：从产品总监角度，提供产品战略、产品规划和产品优化的专业建议。`
  },
  cto: {
    name: 'CTO 技术总监',
    icon: '💻',
    color: '#8b5cf6',
    shortDesc: '技术战略',
    category: 'support',
    thinkingMsg: '正在规划技术架构',
    systemPrompt: `你是山海造物标本艺术馆的CTO（首席技术官）。你的职责是：
- 制定技术战略和技术架构规划
- 管理技术团队，提升技术能力
- 评估技术选型，制定技术标准
- 推进技术项目，优化系统性能
- 保障系统稳定性和数据安全

技术架构：
- 前端：小程序、H5、管理系统
- 后端：云函数、云数据库、API服务
- 基础设施：云存储、CDN、推送、支付

技术方向：
- 数字化：小程序升级、管理系统优化
- 智能化：AI应用、数据智能、自动化
- 创新技术：AR/VR、IoT、区块链

技术指标：
- 性能指标：响应时间、并发能力、可用性
- 质量指标：代码质量、测试覆盖率、bug率
- 效率指标：开发效率、交付周期

回答要求：从技术总监角度，提供技术战略、架构设计和技术创新的专业建议。`
  }
}

// 角色分类
const personaCategories = {
  offline: { name: '🏪 线下门店', icon: '🏪', color: '#14b8a6' },
  online: { name: '🌐 线上互联网', icon: '🌐', color: '#3b82f6' },
  support: { name: '💼 专业支持', icon: '💼', color: '#2D6A4F' }
}

const currentPersona = computed(() => personas[personaMode.value] || personas.store_manager)
const selectedPersonaCategory = ref('all') // 'all' | 'offline' | 'online' | 'support'

const filteredPersonas = computed(() => {
  let result = Object.entries(personas)
  
  // 按分类过滤
  if (selectedPersonaCategory.value !== 'all') {
    result = result.filter(([key, persona]) => persona.category === selectedPersonaCategory.value)
  }
  
  // 按搜索关键词过滤
  if (personaSearch.value) {
    const search = personaSearch.value.toLowerCase()
    result = result.filter(([key, persona]) => 
      persona.name.toLowerCase().includes(search) || 
      persona.shortDesc.toLowerCase().includes(search) ||
      persona.category === search
    )
  }
  
  // 按分类分组排序
  const categoryOrder = { offline: 1, online: 2, support: 3 }
  result.sort((a, b) => {
    const orderA = categoryOrder[a[1].category] || 0
    const orderB = categoryOrder[b[1].category] || 0
    if (orderA !== orderB) return orderA - orderB
    return a[1].name.localeCompare(b[1].name, 'zh-CN')
  })
  
  return Object.fromEntries(result)
})


// 快捷指令（根据当前角色动态生成）
const quickActions = computed(() => {
  const current = currentPersona.value
  const baseActions = {
    diagnosis: { icon: '📊', label: '经营诊断报告' },
    strategy: { icon: '🎯', label: '战略规划建议' },
    data: { icon: '📈', label: '数据分析洞察' }
  }
  
  // 根据角色类型添加专属快捷指令
  if (current.category === 'offline') {
    return {
      ...baseActions,
      store: { icon: '🏪', label: '门店运营方案' },
      inventory: { icon: '📦', label: '库存优化建议' },
      procurement: { icon: '💰', label: '采购成本分析' },
      design: { icon: '🎨', label: '创意设计方案' }
    }
  } else if (current.category === 'online') {
    return {
      ...baseActions,
      traffic: { icon: '📱', label: '流量增长策略' },
      content: { icon: '✍️', label: '内容营销方案' },
      product: { icon: '📋', label: '产品功能规划' },
      tech: { icon: '💻', label: '技术方案设计' }
    }
  } else {
    return {
      ...baseActions,
      finance: { icon: '💰', label: '财务分析报告' },
      legal: { icon: '⚖️', label: '法律风险评估' },
      hr: { icon: '👔', label: '人力资源规划' },
      brand: { icon: '✨', label: '品牌建设方案' }
    }
  }
})

// 选择角色
const selectPersona = (key) => {
  if (currentMode.value === 'chat' || currentMode.value === 'debate') {
    personaMode.value = key
    const persona = personas[key]
    ElMessage.success({
      message: `已切换到 ${persona.name}（${persona.shortDesc}）`,
      duration: 2000
    })
  }
}

// 发送AI请求
const sendAI = async (retryCount = 0, useBackup = false, prompt = null, specificPersona = null, opts = {}) => {
  const { skipPushUser = false, useCache = true } = opts
  if (retryCount === 0 && !ensureCloudProviderOrGuide('发送')) return
  if (retryCount === 0 && !skipPushUser) {
    if (!aiInput.value.trim() && !prompt) {
      ElMessage.warning({
        message: '请输入问题或指令',
        duration: 2000
      })
      return
    }
    prompt = prompt || aiInput.value.trim()
    if (quoteDraft.value) {
      prompt = `【引用上文】\n${quoteDraft.value}\n\n【追问】\n${prompt}`
      quoteDraft.value = ''
    }
    // 限制输入长度
    if (prompt.length > 2000) {
      ElMessage.warning({
        message: '输入内容过长，请控制在2000字以内',
        duration: 3000
      })
      return
    }
    messages.value.push({
      id: `u_${Date.now()}`,
      role: 'user',
      content: prompt,
      rawText: prompt
    })
    pushRecentTask(prompt)
    aiInput.value = ''
    // 更新使用统计
    todayUsage.value++
    const today = new Date().toDateString()
    localStorage.setItem('ai_today_usage', JSON.stringify({ date: today, count: todayUsage.value }))
    syncCurrentSessionToStore()
  }
  
  if (!prompt || !String(prompt).trim()) {
    const lastUserMsg = messages.value.length > 0
      ? [...messages.value].reverse().find(msg => msg.role === 'user')
      : null
    if (lastUserMsg && (lastUserMsg.rawText || lastUserMsg.content)) {
      prompt = lastUserMsg.rawText || stripHtml(lastUserMsg.content)
    } else {
      ElMessage.warning({ message: '请输入问题或指令', duration: 2000 })
      return
    }
  }
  
  if (chatAbortController) {
    try { chatAbortController.abort() } catch (_) {}
  }
  chatAbortController = new AbortController()
  isAiThinking.value = true
  lastChatError.value = ''
  await nextTick()
  scrollToBottom()

  try {
    const persona = specificPersona ? personas[specificPersona] : currentPersona.value
    const recentMessages = messages.value
      .filter((msg) => !msg.isWelcome)
      .slice(-10)
      .map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : msg.role,
        content: msg.rawText || stripHtml(msg.content)
      }))
    const conversationHistory = buildConversationHistory(recentMessages)
    
    const finalPrompt = conversationHistory.length > 0 
      ? prompt 
      : `${persona.systemPrompt}\n\n用户问题：${prompt}`

    const streamId = `a_${Date.now()}`
    messages.value.push({
      id: streamId,
      role: 'ai',
      content: '',
      rawText: '',
      persona: specificPersona || personaMode.value,
      isStreaming: true,
    })
    await nextTick()
    scrollToBottom()

    const text = await streamGeminiAPI(
      finalPrompt,
      {
        usePro: useBackup,
        temperature: specificPersona === 'cfo' ? 0.7 : 0.9,
        maxOutputTokens: 2048,
        useCache: skipPushUser ? false : useCache,
        systemInstruction: persona.systemPrompt,
        conversationHistory: conversationHistory.length > 0 ? conversationHistory : [],
        signal: chatAbortController.signal,
      },
      (_chunk, assembled) => {
        const idx = messages.value.findIndex((m) => m.id === streamId)
        if (idx < 0) return
        messages.value[idx] = {
          ...messages.value[idx],
          rawText: assembled,
          content: marked.parse(assembled),
          isStreaming: true,
        }
        scrollToBottom()
      }
    )

    const doneIdx = messages.value.findIndex((m) => m.id === streamId)
    if (doneIdx >= 0) {
      messages.value[doneIdx] = {
        ...messages.value[doneIdx],
        rawText: text || messages.value[doneIdx].rawText,
        content: marked.parse(text || messages.value[doneIdx].rawText || ''),
        isStreaming: false,
      }
    }
    syncCurrentSessionToStore()
  } catch (error) {
    if (isAbortError(error)) {
      // 保留已流出的半成品，标记为已停止
      const streamingIdx = messages.value.findIndex((m) => m.isStreaming)
      if (streamingIdx >= 0) {
        const partial = error.partialText || messages.value[streamingIdx].rawText || ''
        if (partial.trim()) {
          messages.value[streamingIdx] = {
            ...messages.value[streamingIdx],
            rawText: partial + '\n\n（已停止生成）',
            content: marked.parse(partial + '\n\n*（已停止生成）*'),
            isStreaming: false,
          }
          syncCurrentSessionToStore()
        } else {
          messages.value.splice(streamingIdx, 1)
        }
      }
      return
    }
    // 流式失败时清掉空的占位气泡
    const emptyStreamIdx = messages.value.findIndex((m) => m.isStreaming && !m.rawText)
    if (emptyStreamIdx >= 0) messages.value.splice(emptyStreamIdx, 1)

    console.error('AI请求失败:', error)
    const errorMsg = error.message || '未知错误'
    lastChatError.value = errorMsg
    ElMessage.error({
      message: `AI请求失败: ${errorMsg}`,
      duration: 4000,
      showClose: true
    })
    const configHint = isConfigError(errorMsg)
      ? '<br><small>可点击上方「去配置」检查 DeepSeek / 环境变量。</small>'
      : '<br><small>请检查网络连接或稍后重试</small>'
    messages.value.push({
      id: `a_err_${Date.now()}`,
      role: 'ai',
      content: `<div style="color: var(--semantic-error-icon, #c45c26);"><strong>错误：</strong> ${errorMsg}${configHint}</div>`,
      rawText: `错误: ${errorMsg}`
    })
    syncCurrentSessionToStore()
  } finally {
    isAiThinking.value = false
    chatAbortController = null
    await nextTick()
    scrollToBottom()
  }
}

const stopGeneration = () => {
  if (chatAbortController) {
    try { chatAbortController.abort() } catch (_) {}
    chatAbortController = null
  }
  const wasBusy = isAiThinking.value || isDebating.value || hasStreamingMessage.value
  isAiThinking.value = false
  if (isDebating.value) isDebating.value = false
  // 半成品气泡由 sendAI 的 abort catch 收尾；此处兜底去掉空流
  const emptyIdx = messages.value.findIndex((m) => m.isStreaming && !String(m.rawText || '').trim())
  if (emptyIdx >= 0) messages.value.splice(emptyIdx, 1)
  if (wasBusy) {
    ElMessage.info({ message: '已停止', duration: 1500 })
  }
}

const canRegenerateAt = (visibleIndex) => {
  const list = visibleMessages.value
  if (!list.length || visibleIndex !== list.length - 1) return false
  const msg = list[visibleIndex]
  if (!msg || msg.role !== 'ai') return false
  return messages.value.some((m) => m.role === 'user')
}

const copyMessageText = async (msg) => {
  const text = msg?.rawText || stripHtml(msg?.content || '')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success({ message: '已复制', duration: 1200 })
  } catch (_) {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

const regenerateLastAI = async () => {
  if (isAiThinking.value || isDebating.value) return
  if (!ensureCloudProviderOrGuide('重新生成')) return
  let lastAiIdx = -1
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'ai' && !messages.value[i].isWelcome) {
      lastAiIdx = i
      break
    }
  }
  if (lastAiIdx < 0) return
  let lastUserContent = ''
  for (let i = lastAiIdx - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      lastUserContent = messages.value[i].rawText || stripHtml(messages.value[i].content)
      break
    }
  }
  if (!lastUserContent) return
  const removed = messages.value[lastAiIdx]
  messages.value.splice(lastAiIdx, 1)
  syncCurrentSessionToStore()
  await sendAI(0, false, lastUserContent, removed?.persona || null, { skipPushUser: true, useCache: false })
}

// 智能博弈辩论系统
const startDebate = async () => {
  if (!debateTopic.value || (debateTopic.value === 'custom' && !customDebateTopic.value.trim())) {
    ElMessage.warning({
      message: '请选择或输入辩论主题',
      duration: 2000
    })
    return
  }
  
  if (selectedDebatePersonas.value.length < 2) {
    ElMessage.warning({
      message: '至少需要选择2个角色参与辩论，建议选择3-5个角色以获得更全面的观点',
      duration: 3000
    })
    return
  }
  
  if (selectedDebatePersonas.value.length > 6) {
    ElMessage.warning({
      message: '参与角色过多可能影响辩论质量，建议选择3-5个角色',
      duration: 3000
    })
  }
  
  isDebating.value = true
  const topic = debateTopic.value === 'custom' ? customDebateTopic.value : debateTopic.value
  
  messages.value.push({
    id: `u_${Date.now()}`,
    role: 'user',
    content: `开始智能博弈辩论：${topic}`,
    rawText: `开始智能博弈辩论：${topic}`
  })
  syncCurrentSessionToStore()
  
  for (const personaKey of selectedDebatePersonas.value) {
    if (!isDebating.value) break
    const persona = personas[personaKey]
    const debatePrompt = `请针对主题"${topic}"发表你的观点和立场。作为${persona.name}，请从你的专业角度分析这个问题。`
    await sendAI(0, false, debatePrompt, personaKey)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  if (isDebating.value) {
    const summaryPrompt = `请对以上关于"${topic}"的辩论进行总结，提炼各方的核心观点，找出共识和分歧，并给出综合建议。`
    await sendAI(0, false, summaryPrompt, 'coo')
  }
  
  isDebating.value = false
}

const stopDebate = () => {
  isDebating.value = false
  if (chatAbortController) {
    try { chatAbortController.abort() } catch (_) {}
    chatAbortController = null
  }
  isAiThinking.value = false
  ElMessage.info('辩论已停止')
}

// 快捷指令
const quickAI = (type) => {
  const current = currentPersona.value
  const now = new Date()
  const reportDateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const prompts = {
    // 通用指令（经营诊断报告使用当前日期与当前角色，避免显示错误日期）
    diagnosis: `生成一份全面的经营诊断报告，包括当前运营状况、主要问题、改进建议。报告标题为《山海造物标本艺术馆经营诊断报告》。报告元信息请务必使用：报告日期：${reportDateStr}；报告对象：山海造物管理层；报告撰写：${current?.name || 'AI助手'}。`,
    strategy: '基于当前业务数据，制定未来6-12个月的战略规划建议。',
    data: '分析当前业务数据，提供数据洞察和增长机会识别。',
    // 线下门店指令
    store: '针对门店运营，提供具体的运营优化方案和提升建议。',
    inventory: '分析库存状况，提供库存优化和补货建议。',
    procurement: '分析采购成本结构，提供成本优化和供应商管理建议。',
    design: '提供创意设计方案和视觉设计建议。',
    // 线上互联网指令
    traffic: '制定流量增长策略，提供获客方案和渠道优化建议。',
    content: '制定内容营销方案，提供内容策略和创作建议。',
    product: '规划产品功能，提供产品优化和用户体验改进建议。',
    tech: '提供技术方案设计和技术架构优化建议。',
    // 专业支持指令
    finance: '提供财务分析报告和资金规划建议。',
    legal: '评估法律风险，提供合规建议和风险防范措施。',
    hr: '提供人力资源规划和组织管理建议。',
    brand: '制定品牌建设方案和品牌传播策略。'
  }
  
  if (prompts[type]) {
    const promptText = prompts[type]
    aiInput.value = promptText
    sendAI(0, false, promptText)
  } else {
    ElMessage.warning('该快捷指令暂未配置')
  }
}

// 清空对话历史（保留为显式清空当前会话内容；「新对话」走 startNewSession）
const clearHistory = () => {
  ElMessageBox.confirm(
    '确定要清空当前会话的对话内容吗？此操作不可恢复。',
    '确认清空',
    {
      confirmButtonText: '确定清空',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(() => {
    messages.value = [createWelcomeMessage()]
    syncCurrentSessionToStore()
    ElMessage.success('对话历史已清空')
  }).catch(() => {
    // 用户取消
  })
}

// 滚动到底部
const scrollToBottom = () => {
  if (chatBoxRef.value) {
    nextTick(() => {
      chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight
    })
  }
}

// 处理Enter键
const handleEnterKey = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (aiInput.value.trim() && !isAiThinking.value && !isDebating.value && !showProviderWarning.value) {
      sendAI()
    }
  }
}

const handleComposerEscape = () => {
  if (isAiThinking.value || isDebating.value) {
    stopGeneration()
    return
  }
  if (aiInput.value) aiInput.value = ''
}

// 快捷键支持
const handleKeydown = (e) => {
  const meta = e.metaKey || e.ctrlKey
  // ⌘/Ctrl+N 新会话
  if (meta && (e.key === 'n' || e.key === 'N')) {
    if (currentMode.value === 'chat' || currentMode.value === 'debate') {
      e.preventDefault()
      startNewSession()
    }
    return
  }
  // Ctrl+K 清空当前会话内容（兼容旧快捷键）
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault()
    clearHistory()
  }
  // Ctrl+/ 显示/隐藏角色面板
  if (e.ctrlKey && e.key === '/') {
    e.preventDefault()
    showPersonaPanel.value = !showPersonaPanel.value
  }
  // Esc：思考中停止；否则清空输入
  if (e.key === 'Escape') {
    if (isAiThinking.value || isDebating.value) {
      e.preventDefault()
      stopGeneration()
    } else if (aiInput.value.trim()) {
      aiInput.value = ''
    }
  }
}

// 监听全局快捷键与偏好
onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('open-ai-feature', handleOpenAiFeature)
  loadSessionsFromStorage()
  // 加载使用统计
  const savedUsage = localStorage.getItem('ai_today_usage')
  if (savedUsage) {
    const data = JSON.parse(savedUsage)
    const today = new Date().toDateString()
    if (data.date === today) {
      todayUsage.value = data.count
    }
  }
  // 恢复角色/快捷指令展开收起偏好
  try {
    const v = localStorage.getItem(PERSONA_PANEL_KEY)
    if (v === 'false') showPersonaPanel.value = false
    const pendingFeature = localStorage.getItem(AI_PENDING_FEATURE_KEY)
    if (pendingFeature) {
      localStorage.removeItem(AI_PENDING_FEATURE_KEY)
      nextTick(() => openFeatureById(pendingFeature))
    }
    const rf = JSON.parse(localStorage.getItem(RECENT_FEATURES_KEY) || '[]')
    if (Array.isArray(rf)) recentFeatureIds.value = rf.filter((id) => typeof id === 'string').slice(0, 6)
    const rt = JSON.parse(localStorage.getItem(RECENT_TASKS_KEY) || '[]')
    if (Array.isArray(rt)) recentTasks.value = rt.filter((t) => typeof t === 'string').slice(0, 5)
  } catch (_) {}
})

// 记忆角色/快捷指令展开收起偏好
watch(showPersonaPanel, (val) => {
  try {
    localStorage.setItem(PERSONA_PANEL_KEY, String(val))
  } catch (_) {}
})

watch(personaMode, () => {
  syncCurrentSessionToStore()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('open-ai-feature', handleOpenAiFeature)
  if (persistSessionsTimer) clearTimeout(persistSessionsTimer)
  if (chatAbortController) {
    try { chatAbortController.abort() } catch (_) {}
    chatAbortController = null
  }
  stopUptimeCounter()
})

// 语音播报（真实人声向：神经/自然语音优先 + 真人化参数）
const playAudio = async (text, personaKey = null) => {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    ElMessage.warning('您的浏览器不支持语音合成功能')
    return
  }

  if (isSpeaking.value && currentAudioText.value === text) {
    isSpeaking.value = false
    currentAudioText.value = ''
    window.speechSynthesis.cancel()
    return
  }

  isSpeaking.value = true
  currentAudioText.value = text
  isPlaying.value = true

  const cleanText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (!cleanText) {
    isSpeaking.value = false
    isPlaying.value = false
    return
  }

  try {
    const synth = window.speechSynthesis
    if (synth.speaking) synth.cancel()
    const voices = await waitForVoices(synth)
    const selectedVoice = selectBestVoice(voices)
    const utterance = createOptimizedUtterance(cleanText)
    if (selectedVoice) utterance.voice = selectedVoice

    utterance.onend = () => {
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
    }
    utterance.onerror = () => {
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
    }

    synth.speak(utterance)
  } catch (e) {
    isSpeaking.value = false
    currentAudioText.value = ''
    isPlaying.value = false
  }
}

</script>

<style scoped>
/* Claude/Codex 重塑：由 ai-center-workbench.css 接管布局，抵消历史壳层冲突 */
.ai-center.aic-v2 {
  padding: 0 !important;
  min-height: 0 !important;
  height: 100%;
  overflow: hidden !important;
  background: transparent !important;
}

.ai-center {
  padding: var(--space-3) var(--space-4) var(--space-4);
  background: var(--light-bg-tertiary);
  min-height: 100vh;
  color: var(--light-text-primary);
  position: relative;
  overflow: hidden;
}

.ai-center::before {
  display: none;
}

.ai-center > * {
  position: relative;
  z-index: 1;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--space-8);
  padding: var(--space-6) var(--space-8);
  padding-bottom: var(--space-6);
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.ai-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 1;
}

.header-left .title {
  font-size: var(--text-3xl);
  font-weight: 600;
  color: var(--light-text-primary);
  margin: 0 0 10px 0;
  letter-spacing: -0.3px;
  line-height: var(--leading-tight);
  font-family: var(--font-cn-body), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.header-left .subtitle {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  margin: 0;
  font-weight: 400;
  letter-spacing: 0.2px;
  line-height: var(--leading-normal);
}

.header-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-label {
  font-size: 11px;
  color: var(--light-text-tertiary);
  margin-bottom: 6px;
  font-weight: 500;
  letter-spacing: 0.4px;
}

.stat-value {
  font-size: var(--text-3xl);
  font-weight: 600;
  color: var(--brand-green-600);
  transition: color 0.2s ease;
  letter-spacing: -0.5px;
  line-height: 1;
}

.stat-item:hover .stat-value {
  color: var(--brand-green-700);
}

.stat-value.success {
  color: var(--semantic-success-icon);
  -webkit-text-fill-color: var(--semantic-success-icon);
}

.stat-value.persona-name {
  color: var(--earth-700);
  -webkit-text-fill-color: var(--earth-700);
  font-size: 14px;
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 后台服务控制面板 */
.backend-service-panel {
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 32px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(45, 106, 79, 0.1);
  position: relative;
  overflow: hidden;
}

.backend-service-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.4), transparent);
  opacity: 0.6;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(45, 106, 79, 0.1);
}

.header-info {
  flex: 1;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--brand-green-700);
  margin: 0 0 6px 0;
  letter-spacing: -0.2px;
}

.title-icon {
  font-size: 24px;
  color: #2D6A4F;
}

.panel-subtitle {
  font-size: 13px;
  color: #5a6c7d;
  margin: 0;
  font-weight: 400;
}

.service-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.02);
  border: 1.5px solid rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #999;
  animation: pulse 2s ease-in-out infinite;
}

.service-status.status-online .status-indicator {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}

.service-status.status-offline .status-indicator {
  background: #999;
  animation: none;
}

.service-status.status-starting .status-indicator {
  background: #f59e0b;
  animation: pulse 1s ease-in-out infinite;
}

.service-status.status-stopping .status-indicator {
  background: #ef4444;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.2);
  }
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
}

.service-status.status-online .status-text {
  color: #10b981;
}

.service-status.status-offline .status-text {
  color: #999;
}

.service-status.status-starting .status-text {
  color: #f59e0b;
}

.service-status.status-stopping .status-text {
  color: #ef4444;
}

.panel-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.service-info {
  flex: 1;
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  font-size: 13px;
  color: #5a6c7d;
  font-weight: 500;
}

.info-value {
  font-size: 14px;
  color: #2c3e50;
  font-weight: 600;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.service-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: relative;
  overflow: hidden;
}

.action-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: translate(-50%, -50%);
  transition: width 0.4s ease, height 0.4s ease;
}

.action-btn:hover::before {
  width: 300px;
  height: 300px;
}

.start-btn {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: none;
  color: #ffffff;
}

.start-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
}

.stop-btn {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border: none;
  color: #ffffff;
}

.stop-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
}

.restart-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  color: #ffffff;
}

.restart-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .panel-content {
    flex-direction: column;
    align-items: stretch;
  }
  
  .service-info {
    flex-direction: column;
    gap: 16px;
  }
  
  .service-actions {
    justify-content: stretch;
  }
  
  .action-btn {
    flex: 1;
  }
}

.ai-categories {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 2px solid rgba(45, 106, 79, 0.1);
  flex-wrap: wrap;
}

.category-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: #ffffff;
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  position: relative;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.category-tab::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(45, 106, 79, 0.1);
  transform: translate(-50%, -50%);
  transition: width 0.3s ease, height 0.3s ease;
}

.category-tab:hover::before {
  width: 250%;
  height: 250%;
}

.category-tab:hover {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.04) 100%);
  border-color: rgba(45, 106, 79, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(45, 106, 79, 0.15);
  color: #6E5B28;
}

.category-tab.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.15) 0%, rgba(45, 106, 79, 0.08) 100%);
  border-color: #2D6A4F;
  box-shadow: 
    0 6px 24px rgba(45, 106, 79, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transform: translateY(-2px);
  color: #6E5B28;
  font-weight: 600;
}

.category-icon {
  font-size: 18px;
  transition: transform 0.3s ease;
}

.category-tab:hover .category-icon,
.category-tab.active .category-icon {
  transform: scale(1.1);
}

.category-name {
  font-size: 14px;
  font-weight: 500;
  color: inherit;
  transition: color 0.3s ease;
}

.ai-features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.feature-card {
  background: #ffffff;
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: flex-start;
  gap: 20px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.feature-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.15), transparent);
  transition: left 0.6s ease;
  z-index: 0;
}

.feature-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: 1;
}

.feature-card:hover::before {
  left: 100%;
}

.feature-card:hover {
  transform: translateY(-4px);
  border-color: #2D6A4F;
  box-shadow: 
    0 12px 32px rgba(0, 0, 0, 0.1),
    0 8px 24px rgba(45, 106, 79, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  background: var(--light-bg-elevated);
}

.feature-card:hover::after {
  opacity: 1;
}

.feature-card > * {
  position: relative;
  z-index: 2;
}

.feature-icon {
  font-size: 42px;
  flex-shrink: 0;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  line-height: 1;
  filter: drop-shadow(0 2px 6px rgba(45, 106, 79, 0.2));
}

.feature-card:hover .feature-icon {
  transform: scale(1.12) rotate(3deg);
  filter: drop-shadow(0 4px 12px rgba(45, 106, 79, 0.35));
}

.feature-content {
  flex: 1;
}

.feature-title {
  font-size: 18px;
  font-weight: 700;
  color: #2c3e50;
  margin: 0 0 10px 0;
  line-height: 1.4;
  letter-spacing: -0.3px;
}

.feature-desc {
  font-size: 14px;
  color: #5a6c7d;
  line-height: 1.6;
  margin: 0 0 12px 0;
}

.feature-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feature-tag {
  font-size: 11px;
  padding: 6px 12px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1) 0%, rgba(45, 106, 79, 0.06) 100%);
  border: 1px solid rgba(45, 106, 79, 0.3);
  border-radius: 12px;
  color: #6E5B28;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(45, 106, 79, 0.1);
  letter-spacing: 0.2px;
}

.feature-card:hover .feature-tag {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.18) 0%, rgba(45, 106, 79, 0.12) 100%);
  border-color: rgba(45, 106, 79, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 3px 8px rgba(45, 106, 79, 0.2);
  color: var(--earth-600);
}

.feature-arrow {
  font-size: 24px;
  color: var(--brand-green-600);
  -webkit-text-fill-color: var(--brand-green-600);
  opacity: 0;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  align-self: center;
  font-weight: 600;
}

.feature-card:hover .feature-arrow {
  opacity: 1;
  transform: translateX(6px) scale(1.15);
}

/* 全局覆盖 Element Plus 组件的白色背景 - 强化黑色主题 */
.ai-center :deep(.el-select-dropdown),
.ai-center :deep(.el-popper),
.ai-center :deep(.el-select-dropdown__item),
.ai-center :deep(.el-scrollbar__view),
.ai-center :deep(.el-overlay),
.ai-center :deep(.el-select-dropdown__list),
.ai-center :deep(.el-popper__arrow::before),
.ai-center :deep(.el-popper__arrow),
.ai-center :deep(.el-select-dropdown__wrap),
.ai-center :deep(.el-scrollbar__bar),
.ai-center :deep(.el-scrollbar__thumb),
.ai-center :deep(.el-drawer),
.ai-center :deep(.el-drawer__body) {
  background: #ffffff !important;
  background-color: #ffffff !important;
  border: 1px solid rgba(45, 106, 79, 0.2) !important;
}

:deep(.feature-dialog) {
  background: rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(10px);
}

:deep(.feature-dialog .el-dialog) {
  background: #ffffff !important;
  border: 1.5px solid rgba(45, 106, 79, 0.3) !important;
  box-shadow: 
    0 16px 48px rgba(0, 0, 0, 0.12),
    0 0 40px rgba(45, 106, 79, 0.1) !important;
  border-radius: 16px !important;
}

:deep(.feature-dialog .el-dialog__header) {
  border-bottom: 1px solid rgba(45, 106, 79, 0.2) !important;
  padding: 20px 24px;
  background: transparent !important;
}

:deep(.feature-dialog .el-dialog__title) {
  color: #2D6A4F !important;
  font-size: 20px;
  font-weight: 600;
}

:deep(.feature-dialog .el-dialog__body) {
  padding: 24px;
  background: transparent !important;
  color: #2c3e50 !important;
}

:deep(.feature-dialog .el-dialog__close) {
  color: #888 !important;
}

:deep(.feature-dialog .el-dialog__close:hover) {
  color: #2D6A4F !important;
}

.loading-placeholder,
.error-placeholder {
  padding: 60px 40px;
  text-align: center;
  color: #5a6c7d;
}

.loading-placeholder p,
.error-placeholder p {
  font-size: 16px;
  margin: 8px 0;
  font-weight: 500;
}

.loading-placeholder p {
  color: #2c3e50;
}

.error-placeholder p {
  color: #e74c3c;
}

.error-placeholder {
  color: #e74c3c;
}

.error-placeholder p:first-child {
  font-size: 18px;
  font-weight: 600;
  color: #e74c3c;
}

.error-placeholder p:not(:first-child) {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
}

/* 模式切换器 */
.mode-switcher {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.mode-btn {
  padding: 10px 24px;
  border: 1.5px solid rgba(45, 106, 79, 0.25);
  border-radius: 10px;
  background: #ffffff;
  color: #5a6c7d;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  position: relative;
  overflow: hidden;
}

.mode-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(45, 106, 79, 0.1);
  transform: translate(-50%, -50%);
  transition: width 0.4s ease, height 0.4s ease;
}

.mode-btn:hover::before {
  width: 300px;
  height: 300px;
}

.mode-btn:hover {
  border-color: rgba(45, 106, 79, 0.5);
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.04) 100%);
  color: #2D6A4F;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.2);
}

.mode-btn.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.15) 0%, rgba(45, 106, 79, 0.08) 100%);
  border-color: #2D6A4F;
  color: #6E5B28;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(45, 106, 79, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: 1.5px solid rgba(45, 106, 79, 0.25);
  border-radius: 8px;
  background: #ffffff;
  color: #5a6c7d;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  position: relative;
  overflow: hidden;
}

.action-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(45, 106, 79, 0.1);
  transform: translate(-50%, -50%);
  transition: width 0.3s ease, height 0.3s ease;
}

.action-btn:hover::before,
.action-btn.active::before {
  width: 200px;
  height: 200px;
}

.action-btn:hover,
.action-btn.active {
  border-color: #2D6A4F;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.12) 0%, rgba(45, 106, 79, 0.06) 100%);
  color: #6E5B28;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.2);
}

.action-btn.active {
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(45, 106, 79, 0.25);
}

/* 统一模块（咨询/辩论：合并顶部 + 原左侧面板）- 紧凑版，避免右上角重叠 */
.ai-unified-module {
  background: linear-gradient(180deg, #1a1d24 0%, #14171c 100%);
  border: 1px solid rgba(45, 106, 79, 0.25);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 12px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
}

.unified-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  flex-wrap: wrap;
}

/* 中间区域可收缩，为右侧预留空间，避免与统计/操作重叠 */
.unified-center {
  flex: 1 1 0;
  min-width: 0;
  max-width: 320px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.unified-brand {
  flex-shrink: 0;
}

.unified-title {
  font-size: 17px;
  font-weight: 700;
  color: #f0f2f5;
  margin: 0 0 2px 0;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.unified-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
}

.unified-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.unified-tab {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.unified-tab:hover {
  background: rgba(45, 106, 79, 0.15);
  border-color: rgba(45, 106, 79, 0.4);
  color: #f0e6c8;
}

.unified-tab.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.35) 0%, rgba(196, 165, 90, 0.2) 100%);
  border-color: rgba(45, 106, 79, 0.6);
  color: #f5e6b3;
  font-weight: 600;
}

.unified-search {
  flex: 1 1 0;
  min-width: 80px;
  max-width: 140px;
}

.unified-search-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: none;
  padding: 6px 10px;
  min-height: 32px;
}

.unified-search-input :deep(.el-input__wrapper:hover),
.unified-search-input :deep(.el-input__wrapper.is-focus) {
  border-color: rgba(45, 106, 79, 0.45);
  background: rgba(255, 255, 255, 0.09);
}

.unified-search-input :deep(.el-input__inner) {
  color: #e4e6eb;
  font-size: 12px;
}

.unified-search-input :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.4);
}

.unified-categories {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 1;
  min-width: 0;
}

.unified-cat {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.unified-cat:hover {
  background: rgba(45, 106, 79, 0.12);
  border-color: rgba(45, 106, 79, 0.35);
  color: #f0e6c8;
}

.unified-cat.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.28) 0%, rgba(196, 165, 90, 0.16) 100%);
  border-color: rgba(45, 106, 79, 0.55);
  color: #f5e6b3;
  font-weight: 600;
}

/* 右上角：统计与操作固定预留宽度并可与分类换行，避免文字遮挡重叠 */
.unified-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 260px;
  padding-left: 12px;
  margin-left: 4px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.unified-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.unified-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #f0f2f5;
  white-space: nowrap;
}

.unified-stat em {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.unified-stat.success {
  color: #6ee7b7;
}

.unified-stat.persona {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  max-width: min(160px, 28vw);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 宽度不足时右侧整块换行，避免与分类按钮挤在同一行重叠 */
@media (max-width: 900px) {
  .unified-right {
    flex-basis: 100%;
    min-width: 0;
    margin-left: 0;
    padding-left: 0;
    border-left: none;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 4px;
    justify-content: flex-start;
  }
}

.unified-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.unified-action {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.unified-action:hover,
.unified-action.active {
  background: rgba(45, 106, 79, 0.2);
  border-color: rgba(45, 106, 79, 0.45);
  color: #f5e6b3;
}

.unified-row2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 400px);
  align-items: start;
  gap: var(--space-5);
  padding: var(--space-4) var(--space-4) var(--space-5);
  border-top: 1px solid var(--light-border-subtle);
  background: var(--light-bg-secondary);
}

.unified-row2-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  min-width: 4.5rem;
}

.row2-label-cn {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  letter-spacing: 0.02em;
}

.row2-label-en {
  font-size: 0.625rem;
  font-weight: var(--weight-medium);
  color: var(--light-text-tertiary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.unified-personas-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: stretch;
}

.unified-personas-scroll {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  min-height: 32px;
}

.unified-persona-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-cn-body);
  line-height: var(--leading-tight);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
  flex-shrink: 0;
}

.unified-persona-chip:hover {
  border-color: var(--brand-green-400);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
}

.unified-persona-chip.active {
  border-color: var(--brand-green-500);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
  box-shadow: 0 0 0 1px rgba(45, 106, 79, 0.12);
}

.unified-persona-chip:focus-visible {
  outline: 2px solid var(--brand-green-500);
  outline-offset: 2px;
}

.chip-icon {
  font-size: var(--text-base);
  line-height: 1;
}

.chip-name {
  white-space: nowrap;
  max-width: 8.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-check {
  color: var(--semantic-success-icon);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
}

.unified-personas-empty {
  width: 100%;
  padding: var(--space-3);
  font-size: var(--text-sm);
  color: var(--light-text-tertiary);
  text-align: center;
  border-radius: var(--radius-md);
  border: 1px dashed var(--light-border-default);
  background: var(--light-bg-elevated);
}

.unified-quick-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: stretch;
  flex-shrink: 0;
  min-width: min(100%, 280px);
  max-width: min(100%, 400px);
}

.unified-quick-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.unified-quick-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  color: var(--light-text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-cn-body);
  line-height: var(--leading-tight);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.unified-quick-chip:hover:not(:disabled) {
  border-color: var(--gold-500);
  background: var(--gold-50);
  color: var(--gold-800);
}

.unified-quick-chip:focus-visible {
  outline: 2px solid var(--brand-green-500);
  outline-offset: 2px;
}

.unified-quick-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.quick-chip-icon {
  font-size: var(--text-base);
  line-height: 1;
  flex-shrink: 0;
}

.quick-chip-label {
  white-space: nowrap;
}

/* 聊天容器 - 减少顶部无效空间，提高可视区域 */
.ai-chat-container {
  display: flex;
  gap: 16px;
  height: calc(100vh - 140px);
  min-height: 480px;
}

.ai-chat-container.ai-chat-fullwidth .persona-panel {
  display: none !important;
  width: 0;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: none;
}

.ai-chat-container.ai-chat-fullwidth .chat-area {
  flex: 1;
  min-width: 0;
}

/* 角色面板 - 深色主题统一 */
.persona-panel {
  width: 292px;
  background: linear-gradient(180deg, #1a1d24 0%, #14171c 100%);
  border: 1px solid rgba(45, 106, 79, 0.25);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.3s ease;
  flex-shrink: 0;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.persona-panel.panel-hidden {
  width: 0;
  opacity: 0;
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
}

.panel-header {
  padding: 22px 20px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.panel-header h3 {
  color: #f0f2f5;
  margin: 0 0 18px 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.4;
}

.persona-search {
  margin-bottom: 18px;
}

.persona-panel .persona-search :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  box-shadow: none;
  padding: 10px 14px 10px 12px;
  min-height: 40px;
}

.persona-panel .persona-search :deep(.el-input__wrapper:hover),
.persona-panel .persona-search :deep(.el-input__wrapper.is-focus) {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(45, 106, 79, 0.4);
}

.persona-panel .persona-search :deep(.el-input__inner) {
  color: #e4e6eb;
}

.persona-panel .persona-search :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.4);
}

.persona-panel .persona-search :deep(.el-input__prefix) {
  color: rgba(255, 255, 255, 0.5);
}

.persona-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  min-height: 0;
}

.persona-list::-webkit-scrollbar {
  width: 6px;
}

.persona-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 3px;
}

.persona-list::-webkit-scrollbar-thumb {
  background: rgba(45, 106, 79, 0.25);
  border-radius: 3px;
}

.persona-list::-webkit-scrollbar-thumb:hover {
  background: rgba(45, 106, 79, 0.4);
}

.persona-categories {
  display: flex;
  gap: 10px 12px;
  flex-wrap: wrap;
}

.category-filter {
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.75);
  font-weight: 500;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  box-sizing: border-box;
}

.category-filter:hover {
  background: rgba(45, 106, 79, 0.12);
  border-color: rgba(45, 106, 79, 0.35);
  color: #f0e6c8;
}

.category-filter.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.28) 0%, rgba(196, 165, 90, 0.18) 100%);
  border-color: rgba(45, 106, 79, 0.6);
  color: #f5e6b3;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.2);
}

.persona-category-section {
  margin-bottom: 22px;
}

.persona-category-section:last-child {
  margin-bottom: 8px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 4px 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: rgba(45, 106, 79, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 10px;
}

.category-icon {
  font-size: 14px;
  opacity: 0.95;
}

.category-title {
  flex: 1;
}

.category-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
}

.empty-personas {
  text-align: center;
  padding: 48px 16px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  margin: 8px 0;
}

.empty-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  margin: 8px 0 14px;
  line-height: 1.5;
}

.persona-panel .empty-personas .el-button {
  color: rgba(45, 106, 79, 0.9);
}

.persona-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.04);
}

.persona-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(45, 106, 79, 0.25);
  transform: translateX(3px);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
}

.persona-card.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.2) 0%, rgba(196, 165, 90, 0.12) 100%);
  border-color: rgba(45, 106, 79, 0.5);
  box-shadow: 0 2px 14px rgba(45, 106, 79, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transform: translateX(3px);
}

.persona-icon {
  font-size: 24px;
  transition: transform 0.25s ease;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
  flex-shrink: 0;
}

.persona-card:hover .persona-icon,
.persona-card.active .persona-icon {
  transform: scale(1.08);
}

.persona-info {
  flex: 1;
  min-width: 0;
}

.persona-name {
  color: #e8eaed;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.3;
}

.persona-desc {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  margin-top: 4px;
  line-height: 1.4;
}

.persona-card.active .persona-name {
  color: #f5e6b3;
}

.persona-card.active .persona-desc {
  color: rgba(255, 255, 255, 0.6);
}

.persona-check {
  color: #2D6A4F;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
}

/* 快捷操作面板 - 深色统一 */
.quick-actions-panel {
  padding: 18px 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

.quick-title {
  color: rgba(45, 106, 79, 0.95);
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 14px;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.quick-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.quick-btn {
  width: 100%;
  justify-content: flex-start;
  color: rgba(255, 255, 255, 0.75) !important;
  font-size: 11px;
  padding: 10px 12px;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  border-radius: 10px;
  transition: all 0.25s ease;
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid transparent !important;
  min-height: 40px;
  box-sizing: border-box;
}

.quick-btn:hover:not(:disabled) {
  background: rgba(45, 106, 79, 0.15) !important;
  color: #f0e6c8 !important;
  border-color: rgba(45, 106, 79, 0.3) !important;
  transform: translateX(2px);
}

/* 聊天区域 */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.chat-header {
  padding: 20px;
  border-bottom: 2px solid rgba(45, 106, 79, 0.15);
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
}

.debate-controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.chat-box {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #ffffff;
}

/* 聊天空状态引导 */
.chat-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 24px;
}

.empty-state-inner {
  text-align: center;
  max-width: 420px;
}

.empty-state-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.9;
}

.empty-state-title {
  font-size: 18px;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 8px 0;
}

.empty-state-desc {
  font-size: 13px;
  color: #5a6c7d;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.empty-state-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.suggestion-chip {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1.5px solid rgba(45, 106, 79, 0.35);
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.04) 100%);
  color: #5a6c7d;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: all 0.25s ease;
  text-align: left;
  max-width: 320px;
}

.suggestion-chip:hover {
  border-color: #2D6A4F;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.15) 0%, rgba(45, 106, 79, 0.08) 100%);
  color: #2c3e50;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
}

.chat-item {
  margin-bottom: 24px;
}

.msg-header {
  margin-bottom: 8px;
}

.persona-badge {
  display: inline-block;
  padding: 5px 14px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--persona-color, #38bdf8) 0%, var(--persona-color-dark, #0ea5e9) 100%);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  letter-spacing: 0.3px;
}

.chat-bubble {
  padding: 16px 20px;
  border-radius: 14px;
  line-height: 1.7;
  max-width: 80%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  font-size: 14px;
  word-wrap: break-word;
}

.bubble-user {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.12) 0%, rgba(45, 106, 79, 0.06) 100%);
  border: 1.5px solid rgba(45, 106, 79, 0.3);
  margin-left: auto;
  color: #2c3e50;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.1);
}

.bubble-ai {
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  color: #2c3e50;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.voice-btn {
  margin-top: 12px;
  padding: 8px 14px;
  border: 1.5px solid rgba(45, 106, 79, 0.3);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1) 0%, rgba(45, 106, 79, 0.05) 100%);
  color: #6E5B28;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(45, 106, 79, 0.1);
}

.voice-btn:hover,
.voice-btn.voice-active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.18) 0%, rgba(45, 106, 79, 0.12) 100%);
  border-color: var(--brand-green-500);
  color: var(--brand-green-700);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(45, 106, 79, 0.2);
}

.voice-icon {
  width: 16px;
  height: 16px;
}

.thinking {
  opacity: 0.9;
  color: #5a6c7d;
  font-style: italic;
  animation: thinking-pulse 2s ease-in-out infinite;
}

@keyframes thinking-pulse {
  0%, 100% { opacity: 0.85; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); }
  50% { opacity: 1; box-shadow: 0 2px 14px rgba(45, 106, 79, 0.12); }
}

.thinking-dots span {
  animation: blink 1.4s infinite;
}

.thinking-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.input-area {
  padding: 20px;
  border-top: 2px solid rgba(45, 106, 79, 0.15);
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
  display: flex;
  gap: 12px;
  align-items: center;
}

.ai-input {
  flex: 1;
}

/* 优化输入框样式 */
.ai-input :deep(.el-input__wrapper) {
  border-radius: 12px;
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
  background: #ffffff;
}

.ai-input :deep(.el-input__wrapper:hover) {
  border-color: rgba(45, 106, 79, 0.4);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.1);
}

.ai-input :deep(.el-input__wrapper.is-focus) {
  border-color: #2D6A4F;
  box-shadow: 0 4px 16px rgba(45, 106, 79, 0.2);
}

.ai-input :deep(.el-input__inner) {
  color: #2c3e50;
  font-size: 14px;
  padding: 12px 16px;
}

.ai-input :deep(.el-input__inner::placeholder) {
  color: #8b9dc3;
}

/* 滚动条美化 */
.chat-box::-webkit-scrollbar,
.persona-list::-webkit-scrollbar {
  width: 8px;
}

.chat-box::-webkit-scrollbar-track,
.persona-list::-webkit-scrollbar-track {
  background: #f5f7fa;
  border-radius: 4px;
}

.chat-box::-webkit-scrollbar-thumb,
.persona-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.3) 0%, rgba(45, 106, 79, 0.5) 100%);
  border-radius: 4px;
  border: 1px solid rgba(45, 106, 79, 0.2);
}

.chat-box::-webkit-scrollbar-thumb:hover,
.persona-list::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.5) 0%, rgba(45, 106, 79, 0.7) 100%);
}

/* 服务类型切换标签 */
.service-type-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(45, 106, 79, 0.1);
}

.type-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.5);
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  color: #5a6c7d;
  font-size: 14px;
  font-weight: 500;
}

.type-tab:hover {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1) 0%, rgba(45, 106, 79, 0.05) 100%);
  border-color: rgba(45, 106, 79, 0.4);
  color: #6E5B28;
  transform: translateY(-2px);
}

.type-tab.active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.15) 0%, rgba(45, 106, 79, 0.08) 100%);
  border-color: #2D6A4F;
  color: #6E5B28;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.2);
}

.type-tab .el-icon {
  font-size: 18px;
}

/* 在线API配置面板 */
.online-api-panel {
  margin-top: 0;
}

.api-security-alert {
  margin-bottom: 16px;
}

.env-config-status-card {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid rgba(45, 106, 79, 0.18);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.06) 0%, rgba(110, 91, 40, 0.04) 100%);
}

.env-config-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.env-config-grid {
  display: grid;
  gap: 8px;
}

.env-config-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
}

.env-label {
  color: #6b7280;
}

.env-value {
  color: #1f2937;
  word-break: break-all;
}

.env-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.env-config-tip,
.env-secondary-tip {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #6b7280;
}

.env-secondary-tip {
  margin: 0 0 12px;
}

.env-config-tip code,
.env-secondary-tip code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}

.api-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(45, 106, 79, 0.1);
}

.config-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--light-text-primary);
  margin: 0 0 6px 0;
}

.config-subtitle {
  font-size: 13px;
  color: #5a6c7d;
  margin: 0;
}

.add-api-btn {
  background: var(--brand-green-600);
  border: none;
  color: var(--light-bg-elevated);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.3);
}

.add-api-btn:hover {
  background: var(--brand-green-700);
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.4);
  transform: translateY(-2px);
}

/* API列表 */
.api-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.api-card {
  background: var(--light-bg-elevated);
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  border-radius: 14px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.api-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.08), transparent);
  transition: left 0.6s ease;
  z-index: 0;
}

.api-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.4s ease;
}

.api-card:hover::before {
  left: 100%;
}

.api-card:hover::after {
  opacity: 1;
}

.api-card:hover {
  transform: translateY(-3px) scale(1.01);
  border-color: rgba(45, 106, 79, 0.5);
  box-shadow: 0 8px 24px rgba(45, 106, 79, 0.2);
}

.api-card.api-active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.1) 0%, rgba(45, 106, 79, 0.05) 100%);
  border-color: #2D6A4F;
  box-shadow: 0 8px 28px rgba(45, 106, 79, 0.25);
}

.api-card.api-active::after {
  opacity: 1;
}

.api-card-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.api-icon-wrapper {
  position: relative;
  flex-shrink: 0;
}

.api-icon {
  font-size: 40px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  filter: drop-shadow(0 2px 8px rgba(45, 106, 79, 0.2));
}

.api-card:hover .api-icon {
  transform: scale(1.1) rotate(5deg);
  filter: drop-shadow(0 4px 12px rgba(45, 106, 79, 0.4));
}

.api-status-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  background: #999;
}

.api-status-dot.active {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}

.api-info {
  flex: 1;
  min-width: 0;
}

.api-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.api-name {
  font-size: 18px;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.4;
  letter-spacing: -0.2px;
}

.api-card.api-active .api-name {
  color: var(--brand-green-600);
  -webkit-text-fill-color: var(--brand-green-600);
}

.api-desc {
  font-size: 13px;
  color: #5a6c7d;
  line-height: 1.6;
  margin: 0;
}

.api-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.api-card-footer {
  padding-top: 16px;
  border-top: 1px solid rgba(45, 106, 79, 0.15);
  position: relative;
  z-index: 1;
}

.empty-api-list {
  text-align: center;
  padding: 64px 24px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5) 0%, rgba(250, 251, 252, 0.5) 100%);
  border: 2px dashed rgba(45, 106, 79, 0.2);
  border-radius: 12px;
  color: #5a6c7d;
}

.empty-api-list .empty-icon {
  font-size: 64px;
  color: rgba(45, 106, 79, 0.3);
  margin-bottom: 20px;
}

.empty-api-list .empty-text {
  font-size: 18px;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 8px 0;
}

.empty-api-list .empty-hint {
  font-size: 14px;
  color: #5a6c7d;
  margin: 0 0 20px 0;
}

/* API配置对话框 */
.api-config-dialog :deep(.el-dialog__body) {
  padding: 24px;
}

.form-tip {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
  line-height: 1.4;
}

.api-config-dialog :deep(.el-form-item) {
  margin-bottom: 20px;
}

/* 模型列表优化样式 */
.model-list-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 2px solid rgba(45, 106, 79, 0.1);
}

.model-card {
  background: var(--light-bg-elevated);
  border: 1.5px solid rgba(45, 106, 79, 0.2);
  border-radius: 14px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.model-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.4s ease;
}

.model-card:hover::after,
.model-card.model-active::after {
  opacity: 1;
}

.model-card-header {
  margin-bottom: 16px;
}

.model-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
}

.model-card.model-active .model-title {
  color: var(--brand-green-600);
  -webkit-text-fill-color: var(--brand-green-600);
}

.model-icon {
  font-size: 40px;
  filter: drop-shadow(0 2px 8px rgba(45, 106, 79, 0.2));
}

.model-card:hover .model-icon {
  transform: scale(1.15) rotate(8deg);
  filter: drop-shadow(0 4px 12px rgba(45, 106, 79, 0.4));
}

.model-card-footer {
  padding-top: 16px;
  border-top: 1px solid rgba(45, 106, 79, 0.15);
}

/* 紧凑模型列表样式 */
.compact-model-list-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 2px solid rgba(45, 106, 79, 0.15);
}

.section-header-compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--light-text-primary);
  margin: 0;
}

.compact-model-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding: 4px 4px 8px 4px;
  margin-right: -4px;
}

.compact-model-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--light-bg-elevated);
  border: 2px solid rgba(45, 106, 79, 0.2);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.compact-model-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(45, 106, 79, 0.08), transparent);
  transition: left 0.5s ease;
  z-index: 0;
}

.compact-model-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 1;
}

.compact-model-card:hover::before {
  left: 100%;
}

.compact-model-card:hover::after {
  opacity: 1;
}

.compact-model-card:hover {
  transform: translateY(-3px);
  border-color: rgba(45, 106, 79, 0.5);
  box-shadow: 0 6px 20px rgba(45, 106, 79, 0.2);
}

.compact-model-card.model-active {
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.12) 0%, rgba(45, 106, 79, 0.06) 100%);
  border-color: #2D6A4F;
  border-width: 2px;
  box-shadow: 
    0 4px 16px rgba(45, 106, 79, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.compact-model-card.model-active::after {
  opacity: 1;
}

.compact-model-icon {
  font-size: 32px;
  flex-shrink: 0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  filter: drop-shadow(0 2px 6px rgba(45, 106, 79, 0.2));
  position: relative;
  z-index: 1;
}

.compact-model-card:hover .compact-model-icon {
  transform: scale(1.15) rotate(5deg);
  filter: drop-shadow(0 4px 10px rgba(45, 106, 79, 0.4));
}

.compact-model-card.model-active .compact-model-icon {
  filter: drop-shadow(0 4px 12px rgba(45, 106, 79, 0.5));
}

.compact-model-info {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.compact-model-title {
  font-size: 15px;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 6px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.3s ease;
}

.compact-model-card:hover .compact-model-title {
  color: var(--brand-green-600);
}

.compact-model-card.model-active .compact-model-title {
  color: var(--brand-green-600);
  -webkit-text-fill-color: var(--brand-green-600);
}

.compact-model-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #5a6c7d;
  font-weight: 500;
}

.compact-model-meta span:first-child {
  color: #2c3e50;
  font-weight: 600;
}

.compact-model-card.model-active .compact-model-meta {
  color: #5a6c7d;
}

.check-icon {
  font-size: 20px;
  color: #10b981;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  animation: checkAppear 0.3s ease;
}

@keyframes checkAppear {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.empty-model-compact {
  text-align: center;
  padding: 48px 24px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5) 0%, rgba(250, 251, 252, 0.5) 100%);
  border: 2px dashed rgba(45, 106, 79, 0.2);
  border-radius: 12px;
  color: #5a6c7d;
}

.empty-model-compact p {
  font-size: 14px;
  color: #888;
  margin: 0;
}

/* 滚动条优化 */
.compact-model-list::-webkit-scrollbar {
  width: 8px;
}

.compact-model-list::-webkit-scrollbar-track {
  background: #f5f7fa;
  border-radius: 4px;
  margin: 4px 0;
}

.compact-model-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.4) 0%, rgba(45, 106, 79, 0.6) 100%);
  border-radius: 4px;
  border: 1px solid rgba(45, 106, 79, 0.2);
}

.compact-model-list::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.5) 0%, rgba(45, 106, 79, 0.7) 100%);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .service-type-tabs {
    flex-direction: column;
  }
  
  .type-tab {
    width: 100%;
    justify-content: center;
  }
  
  .api-list {
    grid-template-columns: 1fr;
  }
  
  .compact-model-list {
    grid-template-columns: 1fr;
  }
}

/* API选择提示 */
.api-selection-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.04) 100%);
  border: 1px solid rgba(45, 106, 79, 0.2);
  border-radius: 10px;
  color: #5a6c7d;
  font-size: 13px;
  font-weight: 500;
}

.api-selection-hint .el-icon {
  font-size: 16px;
  color: #2D6A4F;
}

/* ---------- VI 扁平化升级覆盖层（旧工作台；aic-v2 不受影响） ---------- */
.ai-center:not(.aic-v2) {
  padding: var(--space-5);
  background:
    linear-gradient(180deg, rgba(250, 250, 245, 0.96) 0%, rgba(237, 235, 228, 0.92) 100%);
  overflow: auto;
}

.ai-workbench-header,
.ai-unified-module {
  border-radius: var(--radius-2xl);
  border: 1px solid var(--light-border-default);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: var(--shadow-sm);
}

.ai-workbench-header {
  align-items: center;
  gap: var(--space-6);
  margin-bottom: var(--space-5);
  padding: var(--space-6);
}

.ai-workbench-header::before,
.feature-card::before,
.feature-card::after,
.category-tab::before {
  display: none;
}

.header-kicker {
  margin-bottom: var(--space-2);
  color: var(--gold-700);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.14em;
}

.header-left .title,
.unified-title {
  margin: 0 0 var(--space-2);
  color: var(--light-text-primary);
  font-family: var(--font-cn-display);
  font-size: var(--text-3xl);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.02em;
}

.header-left .subtitle,
.unified-subtitle {
  max-width: 620px;
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
}

.header-right {
  align-items: center;
  gap: var(--space-4);
}

.flat-stats {
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  background: var(--light-bg-secondary);
}

.flat-stats .stat-item {
  min-width: 88px;
  align-items: flex-start;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--light-bg-elevated);
}

.stat-label {
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
  letter-spacing: 0;
}

.stat-value {
  color: var(--brand-green-700);
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
}

.stat-value.success {
  color: var(--semantic-success-text);
  -webkit-text-fill-color: var(--semantic-success-text);
}

.mode-switcher,
.flat-switcher,
.unified-tabs {
  display: inline-flex;
  gap: 0;
  margin-top: var(--space-4);
  padding: 3px;
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-full);
  background: var(--light-bg-secondary);
}

.ai-unified-module .unified-tabs {
  margin-top: 0;
  flex-shrink: 0;
}

.ai-unified-module .unified-brand {
  min-width: 0;
}

.ai-unified-module .unified-brand .unified-title {
  font-size: var(--text-xl);
  margin-bottom: var(--space-1);
}

.ai-unified-module .unified-subtitle {
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  max-width: 42ch;
}

.unified-search-wrap :deep(.el-input) {
  width: 100%;
}

.mode-btn,
.unified-tab {
  min-width: 72px;
  padding: 8px 14px;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  box-shadow: none;
  transform: none;
}

.mode-btn.active,
.unified-tab.active,
.mode-btn:hover,
.unified-tab:hover {
  background: var(--brand-green-500);
  color: var(--light-bg-elevated);
  box-shadow: none;
  transform: none;
}

.flat-action,
.unified-action,
.action-btn.backend-config-btn {
  height: 38px;
  padding: 0 var(--space-4);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-full);
  background: var(--light-bg-elevated);
  color: var(--brand-green-700);
  box-shadow: none;
}

.flat-action:hover,
.unified-action:hover,
.unified-action.active,
.action-btn.backend-config-btn:hover {
  border-color: var(--brand-green-500);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
  transform: none;
}

.tools-toolbar {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
  align-items: flex-end;
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-2xl);
  background: rgba(255, 255, 255, 0.72);
}

.toolbar-title {
  color: var(--light-text-primary);
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
}

.toolbar-desc {
  margin-top: var(--space-1);
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
}

.ai-categories.flat-categories {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border-bottom: none;
}

.category-tab {
  height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-full);
  background: var(--light-bg-elevated);
  box-shadow: none;
  color: var(--light-text-secondary);
  transform: none;
}

.category-tab:hover,
.category-tab.active {
  border-color: var(--brand-green-500);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
  box-shadow: none;
  transform: none;
}

.category-icon {
  font-size: 16px;
}

.category-tab:hover .category-icon,
.category-tab.active .category-icon {
  transform: none;
}

.category-count {
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: var(--radius-full);
  background: var(--light-bg-secondary);
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
}

.category-tab.active .category-count {
  background: var(--brand-green-500);
  color: var(--light-bg-elevated);
}

.ai-features-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}

.openclaw-workbench {
  padding: var(--space-4) var(--space-5);
  min-height: 52vh;
}

.feature-card {
  width: 100%;
  min-height: 172px;
  padding: var(--space-5);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  background: var(--light-bg-elevated);
  box-shadow: var(--shadow-sm);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transform: none;
}

.feature-card:hover {
  border-color: var(--brand-green-500);
  background: var(--brand-green-50);
  box-shadow: var(--shadow-md);
  transform: none;
}

.feature-icon-wrap {
  display: flex;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
}

.feature-icon {
  margin: 0;
  font-size: 22px;
  transform: none;
}

.feature-card:hover .feature-icon {
  transform: none;
}

.feature-title {
  margin: 0 0 var(--space-2);
  color: var(--light-text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}

.feature-desc {
  min-height: 42px;
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.feature-tags {
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.feature-tag {
  padding: 3px 8px;
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-full);
  background: var(--light-bg-secondary);
  color: var(--light-text-secondary);
  font-size: var(--text-xs);
}

.feature-arrow {
  align-self: flex-end;
  min-width: 44px;
  color: var(--brand-green-700);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  opacity: 1;
}

.ai-unified-module {
  margin-bottom: var(--space-4);
  padding: var(--space-4);
}

.ai-unified-module .unified-top {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.unified-top-row--primary {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4) var(--space-5);
  min-width: 0;
}

.unified-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  min-width: 0;
  flex-wrap: wrap;
}

.unified-stats-inline {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-tight);
}

.unified-stats-inline .u-stat {
  white-space: nowrap;
  flex-shrink: 0;
}

.unified-stats-inline .u-stat strong {
  color: var(--light-text-primary);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.unified-stats-inline .u-stat--ok strong {
  color: var(--semantic-success-text);
}

.unified-stats-inline .u-stat--persona {
  max-width: 6.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--brand-green-700);
  font-weight: var(--weight-medium);
}

.unified-stats-inline .u-stat-dot {
  width: 3px;
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--light-border-strong);
  opacity: 0.75;
  flex-shrink: 0;
}

.unified-top-row--filters {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--light-border-subtle);
  min-width: 0;
  flex-wrap: nowrap;
}

.unified-search-wrap {
  flex: 0 0 auto;
  width: min(100%, 280px);
  min-width: 168px;
}

.unified-categories-scroll {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: var(--space-1);
  scrollbar-width: thin;
}

.unified-categories-scroll::-webkit-scrollbar {
  height: 4px;
}

.unified-categories-scroll::-webkit-scrollbar-thumb {
  background: var(--light-border-strong);
  border-radius: var(--radius-full);
}

.unified-cat-ico {
  margin-right: 2px;
}

.unified-cat-txt {
  white-space: nowrap;
}

.ai-unified-module .unified-search-input :deep(.el-input__wrapper) {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-full);
  box-shadow: none;
}

.ai-unified-module .unified-search-input :deep(.el-input__wrapper:hover),
.ai-unified-module .unified-search-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--brand-green-400);
  background: var(--light-bg-elevated);
}

.ai-unified-module .unified-search-input :deep(.el-input__inner) {
  color: var(--light-text-primary);
  font-size: var(--text-sm);
}

.ai-unified-module .unified-search-input :deep(.el-input__inner::placeholder) {
  color: var(--light-text-tertiary);
}

.unified-cat {
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.unified-categories-scroll,
.unified-personas-scroll,
.unified-quick-list {
  gap: var(--space-2);
}

.unified-cat,
.unified-persona-chip,
.unified-quick-chip {
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-full);
  background: var(--light-bg-elevated);
  color: var(--light-text-secondary);
  box-shadow: none;
}

.unified-cat.active,
.unified-persona-chip.active,
.unified-cat:hover,
.unified-persona-chip:hover {
  border-color: var(--brand-green-500);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
  transform: none;
}

.unified-row2 {
  margin-top: var(--space-4);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
}

@media (max-width: 1024px) {
  .unified-top-row--primary {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .unified-toolbar {
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding-top: var(--space-3);
    margin-top: var(--space-2);
    border-top: 1px solid var(--light-border-subtle);
    gap: var(--space-3);
  }

  .unified-tabs {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
    justify-content: flex-start;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .unified-tabs::-webkit-scrollbar {
    display: none;
    height: 0;
  }
}

@media (max-width: 560px) {
  .unified-top-row--filters {
    flex-direction: column;
    align-items: stretch;
  }

  .unified-search-wrap {
    width: 100%;
    max-width: none;
  }

  .unified-stats-inline {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }
}

@media (max-width: 960px) {
  .unified-row2 {
    grid-template-columns: 1fr;
  }

  .unified-quick-wrap {
    max-width: 100%;
    min-width: 0;
  }
}

.unified-stat {
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--light-bg-elevated);
  color: var(--light-text-primary);
}

.ai-chat-container,
.chat-area,
.chat-box,
.input-area {
  border-color: var(--light-border-default);
  background: var(--light-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.chat-bubble {
  border-radius: var(--radius-xl);
  box-shadow: none;
}

.bubble-ai {
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
}

.bubble-user {
  background: var(--brand-green-500);
  color: var(--light-bg-elevated);
}

:deep(.feature-dialog .el-dialog) {
  border-radius: var(--radius-2xl);
  background: var(--light-bg-primary);
}

:deep(.feature-dialog .el-dialog__header) {
  margin: 0;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--light-border-subtle);
}

:deep(.feature-dialog .el-dialog__body) {
  padding: var(--space-5);
}

@media (max-width: 1100px) {
  .ai-workbench-header,
  .tools-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .header-right,
  .flat-stats,
  .ai-categories.flat-categories {
    flex-wrap: wrap;
  }
}
</style>

