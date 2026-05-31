/**
 * 伴宠记忆提交流程 — 开发者工具自动化测试
 *
 * 前置条件：
 * 1. 微信开发者工具已打开本项目
 * 2. 设置 → 安全设置 → 服务端口：已开启
 * 3. 云函数 getPetMemorialConfig、petMemorialOrder 已部署
 * 4. 集合 pet_memorial_orders 已创建
 *
 * 运行：cd scripts && npm install && node test-pet-memorial-flow.js
 */
const automator = require('miniprogram-automator')
const path = require('path')

const PROJECT_PATH = path.resolve(__dirname, '..')

async function tapButton(miniProgram, text) {
  const page = await miniProgram.currentPage()
  const btn = await page.$('button')
  const buttons = await page.$$('button')
  for (const b of buttons) {
    const t = await b.text()
    if (t && t.includes(text)) {
      await b.tap()
      return page
    }
  }
  throw new Error(`未找到按钮：${text}`)
}

async function main() {
  console.log('连接开发者工具…')
  const miniProgram = await automator.connect({
    wsEndpoint: 'ws://localhost:9420'
  })

  console.log('启动伴宠记忆页（devtest 预填）…')
  await miniProgram.reLaunch('/pages/custom/pet/index?from=devtest')
  await miniProgram.waitFor(800)

  let page = await miniProgram.currentPage()
  console.log('Step 1: 知情确认 → 下一步')
  await tapButton(miniProgram, '下一步')
  await miniProgram.waitFor(400)

  console.log('Step 2: 档案 → 下一步')
  await tapButton(miniProgram, '下一步')
  await miniProgram.waitFor(400)

  console.log('Step 3: 工艺 → 下一步')
  await tapButton(miniProgram, '下一步')
  await miniProgram.waitFor(400)

  console.log('Step 4: 交接 → 下一步')
  await tapButton(miniProgram, '下一步')
  await miniProgram.waitFor(400)

  console.log('Step 5: 提交意向')
  await tapButton(miniProgram, '提交意向')
  await miniProgram.waitFor(3000)

  page = await miniProgram.currentPage()
  const route = page.path
  console.log('当前页面:', route)

  if (route.includes('pet/status')) {
    const orderNoEl = await page.$('.order-no')
    const orderNo = orderNoEl ? await orderNoEl.text() : ''
    console.log('✅ 提交流程成功', orderNo)
  } else {
    console.error('❌ 未跳转到进度页，请检查 Console 云函数报错')
    process.exit(1)
  }

  await miniProgram.disconnect()
}

main().catch((err) => {
  console.error('测试失败:', err.message)
  console.error('\n若连接失败，请在开发者工具中：设置 → 安全 → 开启服务端口')
  process.exit(1)
})
