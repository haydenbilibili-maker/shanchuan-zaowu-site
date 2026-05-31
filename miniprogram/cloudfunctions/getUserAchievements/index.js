const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const userId = event.userId || wxContext.OPENID;

  if (!userId) {
    return { success: false, msg: '用户ID缺失' };
  }

  try {
    // 获取用户统计数据（直接查询数据库）
    const stats = {};
    
    // 辅助函数：安全查询集合计数
    const safeCount = async (collectionName, query = null) => {
      try {
        let queryBuilder = db.collection(collectionName);
        if (query && Object.keys(query).length > 0) {
          // 将 userId 转换为 _openid（如果存在）
          const normalizedQuery = { ...query };
          if (normalizedQuery.userId) {
            normalizedQuery._openid = normalizedQuery.userId;
            delete normalizedQuery.userId;
          }
          
          // 处理复杂查询条件（如 _.in(), _.neq() 等）
          if (normalizedQuery._openid && normalizedQuery.status && normalizedQuery.status._in) {
            queryBuilder = queryBuilder.where({
              _openid: normalizedQuery._openid,
              status: normalizedQuery.status
            });
          } else if (normalizedQuery._openid && normalizedQuery.type && normalizedQuery.type._neq) {
            queryBuilder = queryBuilder.where({
              _openid: normalizedQuery._openid,
              type: normalizedQuery.type
            });
          } else {
            queryBuilder = queryBuilder.where(normalizedQuery);
          }
        }
        const result = await queryBuilder.count();
        return result.total || 0;
      } catch (e) {
        // 集合不存在或其他错误，返回 0
        // 不抛出错误，只记录警告
        const errorMsg = e.message || e.errMsg || e.toString() || String(e);
        const errorStr = JSON.stringify(e) || '';
        
        // 检查所有可能的错误标识
        if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
            errorMsg.includes('not exist') ||
            errorMsg.includes('not exists') ||
            errorMsg.includes('502005') ||
            errorMsg.includes('ResourceNotFound') ||
            errorMsg.includes('Db or Table not exist') ||
            errorStr.includes('DATABASE_COLLECTION_NOT_EXIST') ||
            errorStr.includes('502005')) {
          console.warn(`集合 ${collectionName} 不存在，返回默认值 0`);
          return 0;
        } else {
          console.warn(`集合 ${collectionName} 查询失败:`, errorMsg);
          // 即使不是集合不存在错误，也返回 0，避免影响整体流程
          return 0;
        }
      }
    };

    // 1. 我的数据（浏览数、收藏数、分享数、搜索数）
    // 如果 user_behaviors 集合不存在，尝试从其他集合获取数据
    stats.viewCount = await safeCount('user_behaviors', { userId, action: 'view' });
    
    // 收藏数：从 collections 集合获取
    stats.collectCount = await safeCount('collections', { _openid: userId });

    stats.shareCount = await safeCount('user_behaviors', { userId, action: 'share' });
    stats.searchCount = await safeCount('user_behaviors', { userId, action: 'search' });

    // 2. 消费统计
    let totalConsumption = 0;
    let orderCount = 0;
    try {
      const ordersRes = await db.collection('orders')
        .where({
          _openid: userId,
          status: _.in(['paid', 'shipped', 'received'])
        })
        .get();
      
      orderCount = ordersRes.data.length;
      ordersRes.data.forEach(order => {
        if (order.totalPrice) {
          let price = parseFloat(order.totalPrice.toString().replace(/,/g, ''));
          if (!isNaN(price)) totalConsumption += price;
        }
      });
    } catch (e) {
      const errorMsg = e.message || e.errMsg || e.toString() || String(e);
      const errorStr = JSON.stringify(e) || '';
      if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
          errorMsg.includes('not exist') ||
          errorMsg.includes('not exists') ||
          errorMsg.includes('502005') ||
          errorMsg.includes('ResourceNotFound') ||
          errorMsg.includes('Db or Table not exist') ||
          errorStr.includes('DATABASE_COLLECTION_NOT_EXIST') ||
          errorStr.includes('502005')) {
        console.warn('orders 集合不存在，返回默认值');
      } else {
        console.warn('获取订单数据失败:', errorMsg);
      }
      orderCount = 0;
      totalConsumption = 0;
    }
    stats.totalConsumption = totalConsumption.toFixed(2);
    stats.orderCount = orderCount;

    // 3. 学习记录
    // 注意：safeCount 不支持复杂查询条件，需要单独处理
    try {
      const courseRes = await db.collection('bookings')
        .where({
          _openid: userId,
          type: 'course',
          status: _.in(['completed', 'confirmed'])
        })
        .count();
      stats.courseCount = courseRes.total || 0;
    } catch (e) {
      const errorMsg = e.message || e.errMsg || e.toString() || String(e);
      const errorStr = JSON.stringify(e) || '';
      if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
          errorMsg.includes('not exist') ||
          errorMsg.includes('502005') ||
          errorMsg.includes('ResourceNotFound') ||
          errorStr.includes('DATABASE_COLLECTION_NOT_EXIST')) {
        console.warn('bookings 集合不存在，返回默认值');
      } else {
        console.warn('获取课程数据失败:', errorMsg);
      }
      stats.courseCount = 0;
    }

    try {
      const certificateRes = await db.collection('orders')
        .where({
          _openid: userId,
          status: 'received',
          type: _.neq('coupon')
        })
        .count();
      stats.certificateCount = certificateRes.total || 0;
    } catch (e) {
      const errorMsg = e.message || e.errMsg || e.toString() || String(e);
      const errorStr = JSON.stringify(e) || '';
      if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
          errorMsg.includes('not exist') ||
          errorMsg.includes('502005') ||
          errorMsg.includes('ResourceNotFound') ||
          errorStr.includes('DATABASE_COLLECTION_NOT_EXIST')) {
        console.warn('orders 集合不存在（证书查询），返回默认值');
      } else {
        console.warn('获取证书数据失败:', errorMsg);
      }
      stats.certificateCount = 0;
    }

    // 定义成就配置 - 使用技术绘图图标路径
    const achievementConfigs = [
      // 探索类
      {
        id: 'explore_10',
        type: 'explore',
        name: '初探者',
        desc: '浏览10个藏品',
        icon: '/assets/icons/knowledge.png',
        threshold: 10,
        reward: { points: 10, type: 'points' },
        check: () => stats.viewCount >= 10
      },
      {
        id: 'explore_50',
        type: 'explore',
        name: '探索家',
        desc: '浏览50个藏品',
        icon: '/assets/icons/knowledge-active.png',
        threshold: 50,
        reward: { points: 50, type: 'points' },
        check: () => stats.viewCount >= 50
      },
      {
        id: 'explore_100',
        type: 'explore',
        name: '博物学家',
        desc: '浏览100个藏品',
        icon: '/assets/icons/knowledge.png',
        threshold: 100,
        reward: { points: 100, type: 'points' },
        check: () => stats.viewCount >= 100
      },
      {
        id: 'search_5',
        type: 'explore',
        name: '搜索新手',
        desc: '搜索5次',
        icon: '/assets/icons/voice.png',
        threshold: 5,
        reward: { points: 5, type: 'points' },
        check: () => stats.searchCount >= 5
      },
      {
        id: 'search_20',
        type: 'explore',
        name: '搜索达人',
        desc: '搜索20次',
        icon: '/assets/icons/voice-active.png',
        threshold: 20,
        reward: { points: 20, type: 'points' },
        check: () => stats.searchCount >= 20
      },
      
      // 收藏类
      {
        id: 'collect_5',
        type: 'collect',
        name: '收藏新手',
        desc: '收藏5件',
        icon: '/assets/icons/heart.png',
        threshold: 5,
        reward: { points: 15, type: 'points' },
        check: () => stats.collectCount >= 5
      },
      {
        id: 'collect_10',
        type: 'collect',
        name: '收藏家',
        desc: '收藏10件',
        icon: '/assets/icons/star.png',
        threshold: 10,
        reward: { points: 30, type: 'points' },
        check: () => stats.collectCount >= 10
      },
      {
        id: 'collect_50',
        type: 'collect',
        name: '收藏大师',
        desc: '收藏50件',
        icon: '/assets/icons/star-active.png',
        threshold: 50,
        reward: { points: 100, type: 'points' },
        check: () => stats.collectCount >= 50
      },
      {
        id: 'folder_3',
        type: 'collect',
        name: '整理达人',
        desc: '创建3个收藏夹',
        icon: '/assets/icons/list.png',
        threshold: 3,
        reward: { points: 20, type: 'points' },
        check: async () => {
          try {
            const foldersRes = await db.collection('collection_folders')
              .where({ _openid: userId })
              .count();
            return (foldersRes.total || 0) >= 3;
          } catch (e) {
            const errorMsg = e.message || e.errMsg || e.toString() || String(e);
            const errorStr = JSON.stringify(e) || '';
            if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
                errorMsg.includes('not exist') ||
                errorMsg.includes('502005') ||
                errorMsg.includes('ResourceNotFound') ||
                errorStr.includes('DATABASE_COLLECTION_NOT_EXIST')) {
              console.warn('collection_folders 集合不存在，返回 false');
            } else {
              console.warn('获取收藏夹数量失败:', errorMsg);
            }
            return false;
          }
        }
      },
      
      // 社交类
      {
        id: 'share_1',
        type: 'social',
        name: '分享者',
        desc: '分享1次',
        icon: '/assets/icons/share.png',
        threshold: 1,
        reward: { points: 10, type: 'points' },
        check: () => stats.shareCount >= 1
      },
      {
        id: 'share_5',
        type: 'social',
        name: '分享达人',
        desc: '分享5次',
        icon: '/assets/icons/share.png',
        threshold: 5,
        reward: { points: 50, type: 'points' },
        check: () => stats.shareCount >= 5
      },
      {
        id: 'share_20',
        type: 'social',
        name: '分享大师',
        desc: '分享20次',
        icon: '/assets/icons/share.png',
        threshold: 20,
        reward: { points: 200, type: 'points' },
        check: () => stats.shareCount >= 20
      },
      
      // 消费类
      {
        id: 'first_purchase',
        type: 'consumption',
        name: '首次购买',
        desc: '完成首次购买',
        icon: '/assets/icons/cart.png',
        threshold: 1,
        reward: { points: 50, type: 'points' },
        check: () => stats.orderCount >= 1
      },
      {
        id: 'spend_500',
        type: 'consumption',
        name: '消费新星',
        desc: '累计消费¥500',
        icon: '/assets/icons/coin_gold.png',
        threshold: 500,
        reward: { points: 100, type: 'points' },
        check: () => parseFloat(stats.totalConsumption || 0) >= 500
      },
      {
        id: 'spend_2000',
        type: 'consumption',
        name: '消费达人',
        desc: '累计消费¥2000',
        icon: '/assets/icons/coin_gold.png',
        threshold: 2000,
        reward: { points: 300, type: 'points' },
        check: () => parseFloat(stats.totalConsumption || 0) >= 2000
      },
      {
        id: 'spend_10000',
        type: 'consumption',
        name: '消费大师',
        desc: '累计消费¥10000',
        icon: '/assets/icons/coin_gold.png',
        threshold: 10000,
        reward: { points: 1000, type: 'points' },
        check: () => parseFloat(stats.totalConsumption || 0) >= 10000
      },
      
      // 学习类
      {
        id: 'course_1',
        type: 'learning',
        name: '学习者',
        desc: '完成1个课程',
        icon: '/assets/icons/knowledge.png',
        threshold: 1,
        reward: { points: 30, type: 'points' },
        check: () => stats.courseCount >= 1
      },
      {
        id: 'course_5',
        type: 'learning',
        name: '学习达人',
        desc: '完成5个课程',
        icon: '/assets/icons/knowledge-active.png',
        threshold: 5,
        reward: { points: 150, type: 'points' },
        check: () => stats.courseCount >= 5
      },
      {
        id: 'certificate_1',
        type: 'learning',
        name: '证书持有者',
        desc: '获得1个证书',
        icon: '/assets/icons/medal_gold.png',
        threshold: 1,
        reward: { points: 50, type: 'points' },
        check: () => stats.certificateCount >= 1
      },
      {
        id: 'certificate_5',
        type: 'learning',
        name: '证书收藏家',
        desc: '获得5个证书',
        icon: '/assets/icons/medal_gold.png',
        threshold: 5,
        reward: { points: 250, type: 'points' },
        check: () => stats.certificateCount >= 5
      }
    ];

    // 检查每个成就的完成状态
    const achievements = [];
    for (const config of achievementConfigs) {
      let isUnlocked = false;
      try {
        if (typeof config.check === 'function') {
          isUnlocked = await config.check();
        } else {
          isUnlocked = config.check;
        }
      } catch (e) {
        console.error(`检查成就 ${config.id} 失败:`, e);
        isUnlocked = false;
      }
      
      // 获取当前进度
      let currentProgress = 0;
      if (config.type === 'explore') {
        if (config.id.includes('explore')) {
          currentProgress = Math.min(stats.viewCount || 0, config.threshold);
        } else if (config.id.includes('search')) {
          currentProgress = Math.min(stats.searchCount || 0, config.threshold);
        }
      } else if (config.type === 'collect') {
        if (config.id.includes('collect')) {
          currentProgress = Math.min(stats.collectCount || 0, config.threshold);
        } else if (config.id.includes('folder')) {
          currentProgress = Math.min(
            await safeCount('collection_folders', { _openid: userId }),
            config.threshold
          );
        }
      } else if (config.type === 'social') {
        currentProgress = Math.min(stats.shareCount || 0, config.threshold);
      } else if (config.type === 'consumption') {
        if (config.id === 'first_purchase') {
          currentProgress = Math.min(stats.orderCount || 0, config.threshold);
        } else {
          currentProgress = Math.min(parseFloat(stats.totalConsumption || 0), config.threshold);
        }
      } else if (config.type === 'learning') {
        if (config.id.includes('course')) {
          currentProgress = Math.min(stats.courseCount || 0, config.threshold);
        } else if (config.id.includes('certificate')) {
          currentProgress = Math.min(stats.certificateCount || 0, config.threshold);
        }
      }

      achievements.push({
        ...config,
        unlocked: isUnlocked,
        progress: currentProgress,
        progressPercent: Math.min((currentProgress / config.threshold) * 100, 100)
      });
    }

    // 按类型分组
    const achievementsByType = {
      explore: achievements.filter(a => a.type === 'explore'),
      collect: achievements.filter(a => a.type === 'collect'),
      social: achievements.filter(a => a.type === 'social'),
      consumption: achievements.filter(a => a.type === 'consumption'),
      learning: achievements.filter(a => a.type === 'learning')
    };

    // 统计信息
    const totalAchievements = achievements.length;
    const unlockedCount = achievements.filter(a => a.unlocked).length;
    const totalRewards = achievements
      .filter(a => a.unlocked)
      .reduce((sum, a) => sum + (a.reward?.points || 0), 0);

    return {
      success: true,
      data: {
        achievements,
        achievementsByType,
        stats: {
          total: totalAchievements,
          unlocked: unlockedCount,
          locked: totalAchievements - unlockedCount,
          progress: Math.round((unlockedCount / totalAchievements) * 100),
          totalRewards
        }
      }
    };

  } catch (e) {
    console.error('获取用户成就失败:', e);
    const errorMsg = e.message || e.errMsg || e.toString() || String(e);
    const errorStr = JSON.stringify(e) || '';
    
    // 如果是集合不存在的错误，返回成功但数据为空，而不是失败
    if (errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') || 
        errorMsg.includes('not exist') ||
        errorMsg.includes('not exists') ||
        errorMsg.includes('502005') ||
        errorMsg.includes('ResourceNotFound') ||
        errorMsg.includes('Db or Table not exist') ||
        errorStr.includes('DATABASE_COLLECTION_NOT_EXIST') ||
        errorStr.includes('502005')) {
      console.warn('数据库集合不存在，返回空数据');
      return {
        success: true,
        data: {
          achievements: [],
          achievementsByType: {
            explore: [],
            collect: [],
            social: [],
            consumption: [],
            learning: []
          },
          stats: {
            total: 0,
            unlocked: 0,
            locked: 0,
            progress: 0,
            totalRewards: 0
          }
        }
      };
    }
    
    return { 
      success: false, 
      msg: errorMsg,
      data: null 
    };
  }
};

