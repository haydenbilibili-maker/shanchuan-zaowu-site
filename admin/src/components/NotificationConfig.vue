<template>
  <div class="notification-config retired">
    <div class="header-section">
      <h2>通知消息配置（已下线）</h2>
      <p class="subtitle">本页不再读写任何集合，避免「保存成功但不生效」的假接通</p>
    </div>

    <!--
      2026-09-24 产品点名会：安全下线（推荐默认）。
      历史：本页曾写 notification_templates，运行期读 message_templates（字段口径不同）。
      D6b 披露锚点保留「未接通运行期」字样，供 report:data-sources 识别历史说明。
    -->
    <el-alert
      class="write-only-disclosure"
      type="info"
      :closable="false"
      show-icon
      title="本页已安全下线：未接通运行期，入口已从导航移除"
    >
      <template #default>
        <p>
          历史上本页写入集合 <code>notification_templates</code>，而小程序运行期（云函数
          <code>dispatchMessage</code> / <code>messageAdmin</code>）读取的是
          <code>message_templates</code>，字段口径也不同 —— 保存成功从不影响实际发出的消息。
        </p>
        <p>
          <b>本批次默认：下线而非接线</b>（接线需改运行期契约与字段映射，触稳定期消息面，体量大）。
          实际文案请在云开发控制台维护 <code>message_templates</code>，或经
          <code>messageAdmin</code> 云函数管理。
        </p>
        <p>若深链仍打开本页，仅见本说明，不再提供编辑/保存。</p>
      </template>
    </el-alert>
  </div>
</template>

<script setup>
/** 已下线：无集合读写，无表单状态 */
</script>

<style scoped>
.notification-config.retired {
  padding: 8px 4px 24px;
}
.header-section h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}
.subtitle {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.write-only-disclosure {
  max-width: 720px;
}
.write-only-disclosure p {
  margin: 0 0 8px;
  line-height: 1.55;
}
.write-only-disclosure p:last-child {
  margin-bottom: 0;
}
</style>
