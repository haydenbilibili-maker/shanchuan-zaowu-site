#!/usr/bin/env node
/**
 * 校验 / 重新上传云存储 stores/ 目录下的门店图片。
 *
 * 图源维护：在微信开发者工具 → 云开发 → 存储 → stores/ 直接管理。
 * 若本地有备份目录，可设置 STORE_MEDIA_DIR 环境变量指向该目录后运行本脚本。
 *
 * 用法：
 *   node scripts/upload-store-media.js
 *   STORE_MEDIA_DIR=/path/to/stores node scripts/upload-store-media.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const LOCAL_DIR = process.env.STORE_MEDIA_DIR || path.join(ROOT, 'assets', 'stores')
const CLOUD_PREFIX = 'stores'
const { cdnPath } = require('../config/cdn')

function walk(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) files.push(...walk(full, base))
    else if (/\.(png|jpg|jpeg|webp)$/i.test(ent.name)) {
      files.push({
        local: full,
        cloudKey: path.join(CLOUD_PREFIX, path.relative(base, full)).replace(/\\/g, '/')
      })
    }
  }
  return files
}

function printManifest(files) {
  console.log('\n--- CDN manifest（config/storeMediaCdn.js 已对齐）---\n')
  files.forEach(({ cloudKey }) => {
    console.log(cdnPath(cloudKey))
  })
  console.log(`\n共 ${files.length} 个文件\n`)
}

async function upload(files) {
  let tcb
  try {
    tcb = require('@cloudbase/node-sdk')
  } catch (e) {
    console.log('未安装 @cloudbase/node-sdk，仅输出 manifest。')
    console.log('手动上传：开发者工具 → 云开发 → 存储 → stores/\n')
    printManifest(files)
    return
  }

  const env = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
  const app = tcb.init({
    env,
    secretId: process.env.TCB_SECRET_ID,
    secretKey: process.env.TCB_SECRET_KEY
  })

  if (!process.env.TCB_SECRET_ID) {
    console.log('未设置 TCB_SECRET_ID / TCB_SECRET_KEY，跳过自动上传。')
    printManifest(files)
    return
  }

  for (const { local, cloudKey } of files) {
    process.stdout.write(`上传 ${cloudKey} ... `)
    await app.uploadFile({ cloudPath: cloudKey, fileContent: fs.createReadStream(local) })
    console.log('ok')
  }
  console.log('\n上传完成。请重新部署 getStoreConfig 云函数（若 seed 有变更）。')
}

function main() {
  if (!fs.existsSync(LOCAL_DIR)) {
    console.log('本地目录不存在:', LOCAL_DIR)
    console.log('门店图已在云存储 stores/ 维护，无需本地副本。')
    console.log('如需重新上传，请设置 STORE_MEDIA_DIR 或直接在云开发控制台管理文件。\n')
    process.exit(0)
  }
  const files = walk(LOCAL_DIR)
  upload(files).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

main()
