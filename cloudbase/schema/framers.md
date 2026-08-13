# framers · 标本师 / 名师档案

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

- Admin「标本师管理」主数据
- 小程序首页「名师手作」、标本师个人页、定制选师（`getCustomConfig`）

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 对外署名 |
| `alias` | string? | 艺名 |
| `title` | string? | 头衔（首页副文案） |
| `type` | string | `store` 门店 \| `partner` 特邀 |
| `bio` / `desc` | string | 简介（两端兼容，写入时同步） |
| `avatar` | string | 头像 fileID 或 URL |
| `cover` | string? | 个人页封面 |
| `gallery` | string[] | 作品照片 fileID |
| `tags` | string[] | 擅长领域 |
| `priceDelta` | number | 定制加价（元） |
| `extraDays` | number | 额外交期（天） |
| `sort` | number | 越大越靠前 |
| `active` | boolean | 是否在小程序展示 |
| `city` | string? | 常驻城市 |
| `yearsExperience` | number? | 从业年限 |
| `joinedAt` | string? | 入驻日期 YYYY-MM-DD |
| `quote` | string? | 一句理念 |
| `education` | string? | 学习经历 |
| `signatureStyle` | string? | 技法/风格 |
| `note` | string? | 内部备注（后台） |
| `createTime` / `updatedAt` | number | |
