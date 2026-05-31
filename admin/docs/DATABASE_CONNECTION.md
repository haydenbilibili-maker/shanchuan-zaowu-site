# Admin Web 与小程序数据库连通性配置指南

## 📋 概述

Admin Web 系统已优化与微信小程序云开发数据库的连通性，使用相同的云环境，确保数据一致性。

## 🔧 配置信息

### 环境配置
- **环境ID**: `cloud1-8gnkty5bfff9f0bf`
- **区域**: `ap-shanghai` (上海)
- **SDK**: `@cloudbase/js-sdk@^2.9.1`

### 数据库集合映射

Admin Web 使用以下集合常量（定义在 `src/cloud.js` 的 `COLLECTIONS` 对象中）：

| 集合名称 | 用途 | 小程序使用 |
|---------|------|-----------|
| `products` | 商品/藏品档案 | ✅ |
| `categories` | 分类体系 | ✅ |
| `cms_wikis` | 百科内容/专题展览 | ✅ |
| `curated_collections` | 策展专题 | ✅ |
| `framers` | 名师手作 | ✅ |
| `banners` | 首页轮播 | ✅ |
| `activities` | 活动管理 | ✅ |
| `orders` | 订单管理 | ✅ |
| `users` | 用户/会员 | ✅ |
| `bookings` | 预约管理 | ✅ |
| `coupons` | 优惠券 | ✅ |

## 🚀 连接机制

### 自动连接
所有数据库操作都会自动调用 `loginToCloud()` 确保连接：

```javascript
import { db, loginToCloud, COLLECTIONS } from './cloud'

// 自动连接示例
const loadData = async () => {
  const connected = await loginToCloud()
  if (!connected) {
    ElMessage.error('数据库连接失败')
    return
  }
  
  const res = await db.collection(COLLECTIONS.PRODUCTS).get()
  // ...
}
```

### 连接重试
- 自动重试机制：最多重试 2 次
- 连接状态缓存：避免重复登录
- 持久化登录：使用 `localStorage` 保存登录状态

## ⚙️ 云开发控制台配置

### 1. 安全域名配置
在云开发控制台 → 设置 → 安全配置 → Web 安全域名中添加：
- `localhost:5173` (开发环境)
- `localhost:5174` (备用端口)
- 生产域名（部署后添加）

### 2. 匿名登录配置
在云开发控制台 → 设置 → 登录授权 → 匿名登录：
- ✅ 开启匿名登录
- ✅ 允许 Web 端匿名登录

### 3. 数据库权限配置
确保以下集合的权限设置允许匿名用户读写：
- `products`
- `categories`
- `cms_wikis`
- `banners`
- `framers`
- `activities`
- `orders`
- `users`

**推荐权限配置**：
- 所有用户可读
- 仅管理员可写（通过云函数或自定义权限）

## 🔍 故障排查

### 常见错误

#### 1. "数据库连接失败"
**原因**：
- 安全域名未配置
- 匿名登录未开启
- 网络连接问题

**解决方案**：
1. 检查云开发控制台的安全域名配置
2. 确认匿名登录已开启
3. 检查浏览器控制台的详细错误信息

#### 2. "集合不存在"
**原因**：
- 集合名称拼写错误
- 集合尚未创建

**解决方案**：
1. 使用 `COLLECTIONS` 常量确保集合名称正确
2. 在小程序端或云开发控制台创建缺失的集合

#### 3. "权限不足"
**原因**：
- 数据库权限配置过严
- 匿名用户无写权限

**解决方案**：
1. 在云开发控制台调整集合权限
2. 或使用云函数进行写操作

## 📝 使用示例

### 读取数据
```javascript
import { db, loginToCloud, COLLECTIONS, getTempFileUrl } from './cloud'

const loadProducts = async () => {
  await loginToCloud()
  const res = await db.collection(COLLECTIONS.PRODUCTS)
    .orderBy('createTime', 'desc')
    .limit(50)
    .get()
  
  // 处理云存储图片
  const products = await Promise.all(res.data.map(async item => ({
    ...item,
    httpImage: await getTempFileUrl(item.images[0])
  })))
  
  return products
}
```

### 写入数据
```javascript
const saveProduct = async (data) => {
  await loginToCloud()
  await db.collection(COLLECTIONS.PRODUCTS).add({
    ...data,
    createTime: Date.now()
  })
}
```

### 更新数据
```javascript
const updateProduct = async (id, data) => {
  await loginToCloud()
  await db.collection(COLLECTIONS.PRODUCTS).doc(id).update({
    ...data,
    updateTime: Date.now()
  })
}
```

### 删除数据
```javascript
const deleteProduct = async (id) => {
  await loginToCloud()
  await db.collection(COLLECTIONS.PRODUCTS).doc(id).remove()
}
```

## 🔄 数据同步

### 字段映射
小程序和 Admin Web 使用相同的字段名，但需要注意：

1. **时间字段**：
   - 小程序：`createTime`, `updateTime` (Date 对象)
   - Admin Web：`createTime`, `updateTime` (时间戳)

2. **图片字段**：
   - 小程序：直接使用 `cloud://` 路径
   - Admin Web：需要转换为 HTTPS 链接（使用 `getTempFileUrl`）

3. **状态字段**：
   - `isOffShelf`: 是否下架（小程序）
   - `isOnShelf`: 是否上架（Admin Web，取反）

## 🛠️ 开发建议

1. **始终使用 `COLLECTIONS` 常量**：避免硬编码集合名
2. **操作前检查连接**：使用 `loginToCloud()` 确保连接
3. **错误处理**：捕获并显示详细的错误信息
4. **图片处理**：使用 `getTempFileUrl` 转换云存储路径
5. **时间戳**：使用 `Date.now()` 而非 `db.serverDate()`

## 📞 技术支持

如遇到连接问题，请检查：
1. 浏览器控制台的错误日志
2. 云开发控制台的配置
3. 网络连接状态
4. 环境ID是否正确








