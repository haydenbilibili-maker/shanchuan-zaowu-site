<template>
  <ModuleHub
    hub-id="6"
    title="权益与营销"
    subtitle="券 · 积分礼包 · 活动规则 · 成就 · 钱包"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import Marketing from './Marketing.vue'
import MarketingRulesConfig from './MarketingRulesConfig.vue'
import WelcomeGiftConfig from './WelcomeGiftConfig.vue'
import PointsRulesConfig from './PointsRulesConfig.vue'
import WalletConfig from './WalletConfig.vue'
import AchievementConfig from './AchievementConfig.vue'

defineProps({
  initialSection: { type: String, default: 'assets' }
})

const tabs = [
  { name: 'assets', label: '券与权益商品', comp: Marketing },
  { name: 'welcome', label: '新会员礼包', comp: WelcomeGiftConfig },
  { name: 'points', label: '积分规则', comp: PointsRulesConfig },
  { name: 'rules', label: '活动营销规则', comp: MarketingRulesConfig },
  { name: 'achievement', label: '成就系统', comp: AchievementConfig },
  { name: 'wallet', label: '我的钱包', comp: WalletConfig }
]
</script>
