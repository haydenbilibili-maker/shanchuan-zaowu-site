# Icon优化清单 - Emoji替换为图标文件

## 📋 优化原则
1. **全面去除emoji的使用**
2. **优先使用assets中的icon文件**（可自定义命名）
3. **保持兜底机制**：如果没有assets中没有对应的icon文件，则使用CSS绘图

## 🗂️ 已有图标文件清单

### 当前assets/icons目录下的文件：
- ✅ animal.png
- ✅ audio.png
- ✅ booking-active.png
- ✅ booking-s.png
- ✅ booking.png
- ✅ box.png
- ✅ calendar_gold.png
- ✅ cart-active.png
- ✅ cart.png
- ✅ category_all.png
- ✅ category_animal.png
- ✅ category_marine.png
- ✅ category_mineral.png
- ✅ category_plant.png
- ✅ category.png
- ✅ chart.png
- ✅ checkin.png
- ✅ coin_gold.png
- ✅ coupon.png
- ✅ delete.png
- ✅ deliver.png
- ✅ done.png
- ✅ feedback.png
- ✅ group.png
- ✅ heart.png
- ✅ home-active.png
- ✅ home.png
- ✅ knowledge-active.png
- ✅ knowledge.png
- ✅ list.png
- ✅ location.png
- ✅ lock.png
- ✅ map.png
- ✅ medal_gold.png
- ✅ mountains.png
- ✅ oeacn.png
- ✅ pay.png
- ✅ plants.png
- ✅ poster.png
- ✅ qrcode.png
- ✅ refund.png
- ✅ service.png
- ✅ setting.png
- ✅ share.png
- ✅ ship.png
- ✅ star-active.png
- ✅ star.png
- ✅ store.png
- ✅ ticket.png
- ✅ trend.png
- ✅ user-active.png
- ✅ user.png
- ✅ voice-active.png
- ✅ voice.png

## 📝 Emoji使用情况统计

### 1. pages/user/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 🛍 | 折扣优惠 | `discount.png` | ❌ 缺失 |
| ☕️ | 免费饮品 | `drink.png` | ❌ 缺失 |
| 🎫 | 优先预约 | `ticket.png` | ✅ 已有 |
| 🎁 | 生日礼遇 | `gift.png` | ❌ 缺失 |
| 📱 | 手机/社群 | `phone.png` | ❌ 缺失 |
| 👁 | 浏览数 | `eye.png` | ❌ 缺失 |
| ❤️ | 收藏数 | `heart.png` | ✅ 已有 |
| 📤 | 分享数 | `share.png` | ✅ 已有 |
| 🔍 | 搜索数 | `search.png` | ❌ 缺失 |
| 📚 | 课程数 | `knowledge.png` | ✅ 已有 |
| 🏆 | 证书数 | `medal_gold.png` | ✅ 已有 |

### 2. pages/index/index.js
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 💎 | 矿物分类 | `category_mineral.png` | ✅ 已有 |
| 🌿 | 植物分类 | `category_plant.png` | ✅ 已有 |

### 3. pages/user/achievements/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 📤 | 分享 | `share.png` | ✅ 已有 |

### 4. pages/cart/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| ✏️ | 编辑 | `edit.png` | ❌ 缺失 |
| ✓ | 勾选 | `done.png` | ✅ 已有 |

### 5. pages/ticket/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 📅 | 日历 | `calendar_gold.png` | ✅ 已有 |

### 6. pages/booking/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 📅 | 日历 | `calendar_gold.png` | ✅ 已有 |
| ⏰ | 时间 | `clock.png` | ❌ 缺失 |
| 📱 | 手机 | `phone.png` | ❌ 缺失 |

### 7. pages/search/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 🗑 | 删除 | `delete.png` | ✅ 已有 |
| 🔍 | 搜索 | `search.png` | ❌ 缺失 |

### 8. pages/detail/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 📤 | 分享 | `share.png` | ✅ 已有 |

### 9. pages/order-detail/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| ✈️ | 物流 | `ship.png` | ✅ 已有（使用ship代替） |

### 10. pages/manager/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 🏆 | 成就 | `medal_gold.png` | ✅ 已有 |
| 💰 | 账本 | `coin_gold.png` | ✅ 已有 |
| 📦 | 订单 | `box.png` | ✅ 已有 |
| 📷 | 预约/拍照 | `camera.png` | ❌ 缺失 |
| 🎫 | 活动 | `ticket.png` | ✅ 已有 |
| 👑 | 权益 | `crown.png` | ❌ 缺失 |
| 🗑 | 删除 | `delete.png` | ✅ 已有 |
| 🔍 | 搜索 | `search.png` | ❌ 缺失 |
| 🎁 | 上传 | `gift.png` | ❌ 缺失 |

### 11. pages/framer/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| ✓ | 验证 | `done.png` | ✅ 已有 |

### 12. pages/collection-detail/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 👁 | 阅读 | `eye.png` | ❌ 缺失 |

### 13. pages/my-bookings/index.wxml
| Emoji | 用途 | 建议图标 | 状态 |
|-------|------|----------|------|
| 🎫 | 预约 | `ticket.png` | ✅ 已有 |

## ❌ 缺失的图标文件清单

需要上传以下图标文件到 `assets/icons/` 目录：

1. **discount.png** - 折扣优惠图标
2. **drink.png** - 饮品图标
3. **gift.png** - 礼物/生日礼遇图标
4. **phone.png** - 手机图标
5. **eye.png** - 眼睛/浏览图标
6. **search.png** - 搜索图标
7. **edit.png** - 编辑图标
8. **clock.png** - 时钟/时间图标
9. **camera.png** - 相机/拍照图标
10. **crown.png** - 皇冠/权益图标

## 🎨 CSS兜底方案

对于缺失的图标，将使用CSS绘制简单的图标作为兜底方案。

### CSS图标样式类：
- `.icon-discount` - 折扣图标（百分比符号）
- `.icon-drink` - 饮品图标（杯子）
- `.icon-gift` - 礼物图标（盒子+蝴蝶结）
- `.icon-phone` - 手机图标（矩形+圆角）
- `.icon-eye` - 眼睛图标（椭圆+圆点）
- `.icon-search` - 搜索图标（圆形+放大镜）
- `.icon-edit` - 编辑图标（铅笔）
- `.icon-clock` - 时钟图标（圆形+指针）
- `.icon-camera` - 相机图标（矩形+镜头）
- `.icon-crown` - 皇冠图标（三角形+装饰）

## 📋 替换计划

### 阶段1：使用已有图标替换
- [x] ❤️ → heart.png
- [x] 📤 → share.png
- [x] 🎫 → ticket.png
- [x] 📚 → knowledge.png
- [x] 🏆 → medal_gold.png
- [x] 🗑 → delete.png
- [x] 📅 → calendar_gold.png
- [x] ✓ → done.png
- [x] 💰 → coin_gold.png
- [x] 📦 → box.png
- [x] ✈️ → ship.png

### 阶段2：CSS兜底实现 ✅ 已完成
对于缺失的图标，已实现CSS绘制版本：
- [x] discount.png → `.icon-discount` (CSS绘制)
- [x] drink.png → `.icon-drink` (CSS绘制)
- [x] gift.png → `.icon-gift` (CSS绘制)
- [x] phone.png → `.icon-phone` (CSS绘制)
- [x] eye.png → `.icon-eye` (CSS绘制)
- [x] search.png → `.icon-search` (CSS绘制)
- [x] edit.png → `.icon-edit` (CSS绘制)
- [x] clock.png → `.icon-clock` (CSS绘制)
- [x] camera.png → `.icon-camera` (CSS绘制)
- [x] crown.png → `.icon-crown` (CSS绘制)

### 阶段3：样式文件更新 ✅ 已完成
已更新所有相关样式文件，使图标容器支持`<image>`标签和CSS图标：
- [x] pages/user/index.wxss
- [x] pages/user/achievements/index.wxss
- [x] pages/cart/index.wxss
- [x] pages/booking/index.wxss
- [x] pages/search/index.wxss
- [x] pages/detail/index.wxss
- [x] pages/order-detail/index.wxss
- [x] pages/manager/index.wxss
- [x] pages/framer/index.wxss
- [x] pages/my-bookings/index.wxss
- [x] app.wxss (CSS图标样式)

## 🔄 替换策略

1. **优先使用图片图标**：如果assets中有对应图标，使用`<image>`标签
2. **CSS兜底**：如果没有图标文件，使用CSS绘制的图标
3. **统一命名**：图标文件使用小写字母+下划线命名（如：`discount.png`）
4. **保持兼容**：替换时保持原有的class名称，只改变显示方式

## 📝 注意事项

1. 所有图标文件应放在 `assets/icons/` 目录下
2. 图标尺寸建议：48x48px 或 64x64px
3. 图标格式：PNG（支持透明背景）
4. 图标颜色：建议使用金色（#d4af37）或白色，与整体黑金风格保持一致
5. CSS图标使用伪元素（::before, ::after）绘制，保持简洁

---

**创建时间**：2025-01-XX  
**状态**：进行中  
**优先级**：高

