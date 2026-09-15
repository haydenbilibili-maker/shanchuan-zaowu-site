import cloudbase from "@cloudbase/js-sdk";
import {
  fetchCollectionLimit,
  isCloudbasePromiseBug,
  callCdnFunction,
  cdnCount,
} from "./utils/cloudbaseCdnDb.js";

// =================================================
// 🟢 云开发配置 - 与小程序共享同一环境
// =================================================
const envId = "cloud1-8gnkty5bfff9f0bf"; // 小程序环境ID
const region = "ap-shanghai"; // 上海区域

// 初始化云开发
const app = cloudbase.init({
  env: envId,
  region: region,
  // 持久化缓存登录状态
  persistence: "local"
});

const auth = app.auth();
const db = app.database();

// =================================================
// 🔐 登录与连接管理
// =================================================

let isConnecting = false;
let connectionPromise = null;

const AUTH_WAIT_MS = 15000;

function withAuthTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 超时（${AUTH_WAIT_MS / 1000}s）`)),
      AUTH_WAIT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 连接云开发数据库（带重试机制）
 */
export const loginToCloud = async (retryCount = 0) => {
  // 如果已经登录，直接返回
  try {
    const loginState = await withAuthTimeout(auth.getLoginState(), '检查登录状态');
    if (loginState) {
      console.log("✅ 云开发已连接", auth.currentUser);
      return true;
    }
  } catch (e) {
    console.warn("检查登录状态失败，重新登录", e);
  }

  // 如果正在连接，返回同一个 Promise（避免并发调用）
  if (isConnecting && connectionPromise) {
    try {
      const result = await connectionPromise;
      return result;
    } catch (e) {
      // 如果之前的连接失败，清除状态并重试
      console.warn("之前的连接失败，清除状态并重试", e);
      isConnecting = false;
      connectionPromise = null;
      // 继续执行下面的新连接逻辑
    }
  }

  // 开始新的连接
  isConnecting = true;
  const currentPromise = (async () => {
    try {
      // 关键：Web端必须先"匿名登录"才能连通数据库
      // 策略：先尝试登录，再通过数据库操作验证
      
      let loginAttempted = false;
      let loginSuccess = false;
      
      // 步骤1：检查是否已经登录
      try {
        const existingState = await withAuthTimeout(auth.getLoginState(), '检查既有登录');
        if (existingState) {
          loginSuccess = true;
          console.log("✅ 已存在登录状态");
        }
      } catch (e) {
        // 忽略检查错误，继续尝试登录
      }
      
      // 步骤2：如果未登录，尝试匿名登录
      if (!loginSuccess) {
        try {
          // 尝试 signInAnonymously（@cloudbase/js-sdk 2.9.1 的标准方法）
          if (typeof auth.signInAnonymously === 'function') {
            await withAuthTimeout(auth.signInAnonymously(), '匿名登录');
            loginAttempted = true;
            loginSuccess = true;
            console.log("✅ 使用 signInAnonymously 匿名登录成功");
          } else {
            // 如果方法不存在，记录警告但继续尝试数据库操作
            console.warn("⚠️ auth.signInAnonymously 方法不存在，将尝试直接访问数据库");
            console.warn("   可用的 auth 方法:", Object.keys(auth).filter(k => typeof auth[k] === 'function'));
          }
        } catch (loginErr) {
          console.warn("匿名登录尝试失败", loginErr);
          // 不立即失败，继续尝试数据库操作验证
        }
      }
      
      // 步骤3：通过数据库操作验证连接（最可靠的方式）
      try {
        // 尝试一个简单的数据库操作来验证连接
        // 使用 products 集合进行测试（limit(0) 只验证连接，不返回数据）
        await withAuthTimeout(db.collection('products').limit(0).get(), '数据库连接验证');
        console.log("✅ 数据库连接验证成功");
        loginSuccess = true;
      } catch (dbErr) {
        // 分析数据库错误
        const errMsg = dbErr.message || String(dbErr);
        const errCode = dbErr.code || '';
        
        // 如果是权限/认证错误
        if (errCode === -1 || 
            errCode === -502004 ||
            errMsg.includes('permission') || 
            errMsg.includes('权限') || 
            errMsg.includes('auth') ||
            errMsg.includes('unauthorized') ||
            errMsg.includes('未授权')) {
          
          // 如果还没有尝试登录，现在尝试
          if (!loginAttempted && typeof auth.signInAnonymously === 'function') {
            try {
              await withAuthTimeout(auth.signInAnonymously(), '匿名登录（重试）');
              // 重试数据库操作
              await withAuthTimeout(db.collection('products').limit(0).get(), '数据库连接验证');
              loginSuccess = true;
              console.log("✅ 登录后数据库连接成功");
            } catch (retryErr) {
              throw new Error("数据库访问被拒绝。请确保：1) 已开启匿名登录 2) 已添加安全域名 3) 数据库权限允许匿名访问");
            }
          } else {
            throw new Error("数据库访问被拒绝。请检查：1) 匿名登录是否开启 2) 安全域名是否配置 3) 数据库权限设置");
          }
        }
        // 如果是集合不存在，说明连接是通的
        else if (errCode === -502002 ||
                 errMsg.includes('not exist') || 
                 errMsg.includes('不存在') ||
                 errMsg.includes('collection not found')) {
          loginSuccess = true; // 连接是通的，只是集合不存在
          console.log("✅ 数据库连接正常（集合可能不存在，但不影响连接）");
        } 
        // 其他错误
        else {
          throw dbErr;
        }
      }
      
      // 最终验证
      const finalState = await auth.getLoginState().catch(() => null);
      
      // 验证 db 对象是否可用
      if (!db || typeof db.collection !== 'function') {
        throw new Error('数据库对象未正确初始化，请检查云开发配置');
      }
      
      // 测试 db.collection 是否正常工作
      try {
        const testCollection = db.collection('products');
        if (!testCollection || typeof testCollection.limit !== 'function') {
          throw new Error('数据库集合对象未正确初始化');
        }
      } catch (testErr) {
        console.warn('数据库集合测试失败，但继续执行', testErr);
      }
      
      console.log("✅ 云开发连接成功", {
        userId: auth.currentUser?.uid || 'anonymous',
        env: envId,
        region: region,
        hasLoginState: !!finalState,
        loginAttempted: loginAttempted,
        dbAvailable: !!(db && typeof db.collection === 'function')
      });
      
      isConnecting = false;
      connectionPromise = null;
      return true;
    } catch (err) {
      // 先清除状态
      isConnecting = false;
      connectionPromise = null;
      
      console.error("❌ 云开发连接失败", err);
      
      // 重试机制（最多重试2次）
      if (retryCount < 2) {
        console.log(`🔄 重试连接 (${retryCount + 1}/2)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        // 递归调用，但使用新的 Promise
        return await loginToCloud(retryCount + 1);
      }
      
      // 详细错误提示
      const errorMsg = err.message || String(err);
      const errorCode = err.code || '';
      
      console.error("=".repeat(50));
      console.error("🔧 连接失败排查指南");
      console.error("=".repeat(50));
      
      if (errorCode === -502003 || 
          errorMsg.includes('domain') || 
          errorMsg.includes('域名') || 
          errorMsg.includes('CORS') || 
          errorMsg.includes('origin')) {
        console.error("❌ 问题：安全域名未配置");
        console.error("✅ 解决：");
        console.error("   1. 打开云开发控制台：https://console.cloud.tencent.com/tcb");
        console.error("   2. 选择环境：cloud1-8gnkty5bfff9f0bf");
        console.error("   3. 进入：设置 → 安全配置 → Web 安全域名");
        console.error("   4. 添加：localhost:5173");
      } else if (errorCode === -1 || 
                 errorMsg.includes('anonymous') || 
                 errorMsg.includes('匿名') || 
                 errorMsg.includes('login') || 
                 errorMsg.includes('auth')) {
        console.error("❌ 问题：匿名登录未开启");
        console.error("✅ 解决：");
        console.error("   1. 打开云开发控制台");
        console.error("   2. 进入：设置 → 登录授权 → 匿名登录");
        console.error("   3. 开启匿名登录开关");
      } else if (errorCode === -502004 || 
                 errorMsg.includes('permission') || 
                 errorMsg.includes('权限')) {
        console.error("❌ 问题：数据库权限不足");
        console.error("✅ 解决：");
        console.error("   1. 打开云开发控制台");
        console.error("   2. 进入：数据库 → 权限设置");
        console.error("   3. 设置集合权限为：所有用户可读");
      } else {
        console.error("❌ 未知错误，请查看上方详细错误信息");
      }
      console.error("=".repeat(50));
      
      return false;
    }
  })();
  
  // 保存当前 Promise 到共享变量（确保 connectionPromise 已初始化）
  // 直接赋值，因为 connectionPromise 在文件顶部已声明
  connectionPromise = currentPromise;
  
  try {
    const result = await currentPromise;
    return result;
  } catch (err) {
    // 如果失败，清除状态
    isConnecting = false;
    connectionPromise = null;
    throw err;
  }
};

/**
 * 检查连接状态
 */
export const checkConnection = async () => {
  try {
    const loginState = await auth.getLoginState();
    return !!loginState;
  } catch (e) {
    return false;
  }
};

// =================================================
// 📁 文件管理
// =================================================

/**
 * 获取云存储文件的临时访问链接
 */
export const getTempFileUrl = async (cloudPath) => {
  if (!cloudPath || !cloudPath.startsWith('cloud://')) {
    return cloudPath;
  }
  
  try {
    await loginToCloud();
    const res = await app.getTempFileURL({ fileList: [cloudPath] });
    return (res.fileList && res.fileList.length > 0) 
      ? res.fileList[0].tempFileURL 
      : '';
  } catch (err) {
    console.error("获取文件链接失败", err);
    return '';
  }
};

/**
 * 批量获取云存储文件的临时访问链接
 */
/**
 * 管理后台通用：上传二进制到云存储，返回 fileID（cloud://…）
 */
export const uploadAdminBinary = async (file, folder = 'erp-store') => {
  if (!file || !(file instanceof Blob)) {
    throw new Error('无效文件')
  }
  await loginToCloud()
  const rawName = file.name || 'file'
  const safe = String(rawName).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
  const cloudPath = `${folder}/${Date.now()}_${safe}`
  const res = await app.uploadFile({ cloudPath, filePath: file })
  const fileID = res?.fileID
  if (!fileID) {
    throw new Error('上传未返回 fileID')
  }
  return fileID
}

export const getTempFileUrls = async (cloudPaths) => {
  if (!cloudPaths || cloudPaths.length === 0) {
    return [];
  }
  
  const validPaths = cloudPaths.filter(path => path && path.startsWith('cloud://'));
  if (validPaths.length === 0) {
    return cloudPaths;
  }
  
  try {
    await loginToCloud();
    const res = await app.getTempFileURL({ fileList: validPaths });
    
    const urlMap = {};
    res.fileList?.forEach(file => {
      urlMap[file.fileID] = file.tempFileURL || '';
    });
    
    return cloudPaths.map(path => {
      if (path && path.startsWith('cloud://')) {
        return urlMap[path] || path;
      }
      return path;
    });
  } catch (err) {
    console.error("批量获取文件链接失败", err);
    return cloudPaths;
  }
};

// =================================================
// 🗄️ 数据库集合操作辅助方法
// =================================================

/**
 * 安全执行数据库操作（自动连接）
 */
export const safeDbOperation = async (operation) => {
  try {
    const connected = await loginToCloud();
    if (!connected) {
      throw new Error("云开发登录失败：匿名登录未成功。业务读写请优先走 CDN 数据库接口（getCdnDatabase / fetchCollection*）。");
    }
    return await operation();
  } catch (err) {
    const errorMessage = err?.message || '未知错误';
    const isSdkPromiseBug =
      typeof errorMessage === 'string' &&
      (errorMessage.includes("setting 'promise'") || errorMessage.includes('setting "promise"'));
    const logFn = isSdkPromiseBug ? console.warn : console.error;
    logFn("数据库操作失败", {
      error: errorMessage,
      stack: err?.stack,
      timestamp: new Date().toISOString()
    });

    if (isSdkPromiseBug) {
      throw new Error(
        "CloudBase bundle SDK 异常（setting 'promise'）。请改用 CDN SDK（cloudbaseCdnDb），不要依赖 bundle 内 db.get/count。"
      );
    }

    if (errorMessage.includes('连接') || errorMessage.includes('connection') || errorMessage.includes('登录')) {
      throw new Error(`${errorMessage}。若持续失败，请检查安全域名白名单与网络，或改走 CDN 数据库接口。`);
    }

    throw err;
  }
};

/**
 * 获取集合数据（带分页）
 */
export const getCollectionData = async (collectionName, options = {}) => {
  const { limit = 500, where = null } = options;
  try {
    return await fetchCollectionLimit(collectionName, { limit, where });
  } catch (err) {
    if (isCloudbasePromiseBug(err)) {
      console.warn(`[getCollectionData] ${collectionName} SDK 异常，返回空列表`);
      return [];
    }
    console.warn(`[getCollectionData] CDN 读取 ${collectionName} 失败:`, err?.message || err);
    return [];
  }
};

/**
 * 拉取集合并在客户端排序（仅 CDN SDK，不回退 bundle）
 */
export const fetchCollectionSorted = async (collectionName, options = {}) => {
  const { limit = 500, sortFn, where, throwOnError = false } = options;
  try {
    let rows = await fetchCollectionLimit(collectionName, { limit, where });
    if (sortFn && rows.length) {
      rows = [...rows].sort(sortFn);
    }
    return rows;
  } catch (err) {
    console.warn(`[fetchCollectionSorted] ${collectionName}`, err?.message || err);
    if (throwOnError) throw err;
    return [];
  }
};

/**
 * 统计集合数据量（CDN SDK，避免 bundle db.count 的 promise bug）
 */
export const countCollection = async (collectionName, where = {}) => {
  try {
    const filter =
      where && typeof where === 'object' && Object.keys(where).length > 0
        ? where
        : null;
    return await cdnCount(collectionName, filter);
  } catch (err) {
    if (isCloudbasePromiseBug(err)) {
      console.warn(`[countCollection] ${collectionName} SDK 异常，返回 0`);
      return 0;
    }
    console.warn(`[countCollection] ${collectionName} 失败:`, err?.message || err);
    return 0;
  }
};

/**
 * 解包 doc().get() 返回值（Web SDK 可能返回对象或单元素数组）
 */
export const unwrapDocData = (res) => {
  if (!res || res.data == null) return null;
  const { data } = res;
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null;
  return data;
};

// =================================================
// 📊 小程序数据库集合映射
// =================================================

/**
 * 小程序使用的集合名称常量
 */
export const COLLECTIONS = {
  PRODUCTS: 'products',              // 商品/藏品（含 isTreasure / isOneOfAKind 孤品 / inArchive / hasSku+skus 多规格）
  CATEGORIES: 'categories',           // 分类
  CMS_WIKIS: 'cms_wikis',            // 百科内容/专题策展
  ARTICLES: 'articles',              // 知识文章
  CURATED_COLLECTIONS: 'curated_collections', // 专题展览（兼容）
  FRAMERS: 'framers',                // 名师手作
  BANNERS: 'banners',                // 轮播图
  ACTIVITIES: 'activities',          // 活动
  ORDERS: 'orders',                  // 订单
  PICKUP_VERIFY_LOGS: 'pickup_verify_logs', // 门店自取核销流水（managerShipOrder.verifyPickup 写入）
  REFUNDS: 'refunds',                // 退款审核单（可与 orders 退款状态回流合并展示）
  PURCHASE_INTENTS: 'purchase_intents', // 官网报价单采购意向
  PRICE_LIST_ITEMS: 'price_list_items', // 官网 /price-list 供货报价条目
  PURCHASE_ORDERS: 'purchase_orders', // 正式订货单（门店/渠道）
  OPS_PURCHASES: 'ops_purchases', // 超管采购管理（门店+工作室，managePurchaseOrder）
  OPS_SHIPMENTS: 'ops_shipments', // 门店出货单 SSOT（manageStoreShipment；小程序主录入）
  PROPERTY_COSTS: 'property_costs', // 物业成本（水电/房租，managePropertyCost）
  FULFILLMENT_SHIPMENTS: 'fulfillment_shipments', // 总部出货单（P1）
  STOCK_MOVEMENTS: 'stock_movements', // 总部成品库存流水（P1）
  FEISHU_PURCHASES: 'feishu_purchases', // 飞书采购镜像
  FEISHU_INVENTORY: 'feishu_inventory', // 飞书库存镜像
  FEISHU_SHIPMENTS: 'feishu_shipments', // 飞书出货镜像（同步至 ops_shipments）
  FEISHU_SYNC_LOGS: 'feishu_sync_logs', // 飞书同步审计
  USERS: 'users',                    // 用户
  BOOKINGS: 'bookings',              // 预约
  COUPONS: 'coupons',                // 优惠券
  STRATEGY_RESEARCH: 'strategy_research', // 战略调研结论（AI 用研）
  BENCHMARK_RESEARCH_DOCS: 'benchmark_research_docs', // 对标研究文档库（PDF/MD 全文检索）
  FINANCE_RECORDS: 'finance_records', // 财务账本记录（多端同步）
  FINANCE_SETTINGS: 'finance_settings', // 财务设置（多端同步）
  STORE_LEDGER: 'store_ledger', // 店长小程序账本（与 finance_records 桥接）
  MEMBER_LEVELS: 'member_levels',   // 会员等级体系配置
  POINTS_RULES: 'points_rules',      // 【遗留】旧积分规则，非线上赠分 SSOT
  STORE_POINT_RULES: 'store_point_rules', // 门店积分规则（线上 SSOT，¥10=1）
  MEMBER_WELCOME_GIFT: 'member_welcome_gift', // 新会员礼包（完成注册发放，upsertUserProfile）
  SHIPPING_RULES: 'shipping_rules',       // 商城运费/包邮规则（makeOrder SSOT）
  BOOKING_RULES: 'booking_rules',    // 预约规则配置
  ADMIN_ROLES: 'admin_roles',        // 管理员角色配置
  ADMIN_USERS: 'admin_users',        // 管理员用户
  ADMIN_OPERATION_LOGS: 'admin_operation_logs', // 操作日志
  ADMIN_LOGIN_LOGS: 'admin_login_logs',         // 登录日志
  SEARCH_HOT_KEYWORDS: 'search_hot_keywords',   // 搜索热门关键词配置
  SEARCH_BLACKLIST: 'search_blacklist',         // 搜索关键词黑名单
  USER_BEHAVIORS: 'user_behaviors',             // 用户行为数据（搜索、点击等）
  RECOMMEND_ALGORITHM_CONFIG: 'recommend_algorithm_config', // 推荐算法配置
  MARKETING_RULES_CONFIG: 'marketing_rules_config',         // 营销规则配置（秒杀、拼团、优惠券）
  REPORT_TEMPLATES: 'report_templates',                     // 报表模板
  ACHIEVEMENT_CONFIGS: 'achievement_configs',               // 成就系统配置
  USER_BEHAVIOR_CONFIG: 'user_behavior_config',            // 用户行为追踪配置
  NOTIFICATION_TEMPLATES: 'notification_templates',        // 通知消息模板配置
  STORE_DESIGN_VERSIONS: 'store_design_versions',          // 门店设计中心：设计版本（Web 端沉淀）
  STORE_DESIGN_MATERIALS: 'store_design_materials',         // 门店设计中心：标准物料库（可选）
  CUSTOM_CONFIGS: 'custom_configs',                       // 标本定制选项（框型/包装，getCustomConfig）
  CARE_GUIDES: 'care_guides',                             // 养护指南（getCareGuides）
  STORES: 'stores',                                       // C 端门店主数据（getStoreConfig）
  STORE_ZONES: 'store_zones',                             // C 端展区动线
  PET_CRAFT_CONFIGS: 'pet_craft_configs',                 // 伴宠工艺（getPetMemorialConfig）
  REWARDS: 'rewards',                                     // 积分兑换品
  WAITLIST: 'waitlist',                                   // 预约候补
  SUPPORT_CONFIGS: 'support_configs',                     // 客服入口（getSupportConfig）
  CONTENT_DISPLAY_FLAGS: 'content_display_flags',         // 内容展示开关（getContentDisplayFlags）
};

// =================================================
// 🔄 导出
// =================================================

export {
  getCdnDatabase,
  fetchCollectionLimit,
  fetchCollectionWhere,
  cdnQueryPage,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnDocGet,
  cdnSet,
  cdnUpsertDoc,
  cdnUpsertSingleton,
  cdnUpsertByWhere,
  cdnCount,
} from './utils/cloudbaseCdnDb.js';

/**
 * 调用已部署的云函数（飞书密钥只放云函数环境变量，走与数据库同一 CDN SDK）
 */
export async function callCloudFunction(name, data = {}) {
  return callCdnFunction(name, data);
}

/**
 * 禁止业务侧再 import { db }：bundle 内 db.get/count 有 promise bug。
 * 认证/上传仍可用下方 app / auth；数据读写请用 getCdnDatabase / fetchCollection*。
 */
const deprecatedBundleDb = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'collection' || prop === 'command') {
        throw new Error(
          "请勿使用 bundle db。" + String(prop) + "：请改用 getCdnDatabase() / fetchCollection*（CDN SDK）。",
        )
      }
      return undefined
    },
  },
)

export { deprecatedBundleDb as db, app, auth, envId, region };
