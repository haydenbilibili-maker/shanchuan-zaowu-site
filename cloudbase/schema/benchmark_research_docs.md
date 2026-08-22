# benchmark_research_docs · 对标研究文档库

Admin「战略调研看板 → 对标研究」的动态资料库：归档 PDF/MD 入库后可全文检索。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `docKey` | string | 稳定唯一键（相对路径或文件名 slug），用于 upsert |
| `title` | string | 标题 |
| `fileName` | string | 原始文件名 |
| `relativePath` | string | 归档内相对路径（可选） |
| `era` | string | `shanhai` / `shanchuan` / `charter` / `topic` / `upload` |
| `group` | string | `A` / `B` / `C` / `meta` / `topic` / `''` |
| `brandId` | string | 对标品牌 id（见 `benchmarkResearchLibrary.js`） |
| `docType` | string | `pdf` / `md` / `txt` / `other` |
| `source` | string | `archive_seed` / `admin_upload` |
| `excerpt` | string | 摘要（前 ~400 字） |
| `searchableText` | string | 全文检索字段（截断，默认 ≤ 120000 字符） |
| `charCount` | number | 原文字符数（截断前） |
| `pageCount` | number | PDF 页数（可选） |
| `fileID` | string | 云存储 `cloud://…`（可选，原文附件） |
| `textStatus` | string | `ready` / `pending_pdf` / `empty` / `error` |
| `tags` | string[] | 检索标签 |
| `createTime` | number | 首次入库 |
| `updateTime` | number | 最近更新 |

## 写入入口

- Admin 对标研究页：上传 PDF/MD → 浏览器抽文本 → upsert
- CLI：`cd admin && node scripts/seed-benchmark-research.mjs`（优先灌入归档 MD；PDF 登记元数据）

## 权限

见 `cloudbase/rules/benchmark_research_docs.json`（匿名可读便于 Admin Web；写需登录）。

## 检索说明

CloudBase 文档库无原生全文索引；Admin 拉取集合后在客户端对 `searchableText` / `title` / `tags` 做关键词匹配，并高亮摘录。
