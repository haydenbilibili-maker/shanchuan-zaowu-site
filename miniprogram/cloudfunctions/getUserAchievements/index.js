const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TYPE_META = {
  explore: { label: '探索', en: 'EXPLORATION' },
  collect: { label: '收藏', en: 'COLLECTION' },
  social: { label: '社交', en: 'SOCIAL' },
  consumption: { label: '消费', en: 'CONSUMPTION' },
  learning: { label: '学习', en: 'LEARNING' }
};

const ATLAS_SETS = {
  atlas_frost: ['017', '023', '018', '021'],
  atlas_overwinter: ['001', '012', '028'],
  atlas_mountain: ['041', '031', '033', '015', '034', '036']
};

function isMissingCollectionError(e) {
  const errorMsg = e.message || e.errMsg || e.toString() || String(e);
  const errorStr = JSON.stringify(e) || '';
  return (
    errorMsg.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    errorMsg.includes('not exist') ||
    errorMsg.includes('not exists') ||
    errorMsg.includes('502005') ||
    errorMsg.includes('ResourceNotFound') ||
    errorMsg.includes('Db or Table not exist') ||
    errorStr.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    errorStr.includes('502005')
  );
}

function formatProgressText(current, threshold, unit, id) {
  if (id && id.indexOf('spend_') === 0) {
    const cur = Number(current) || 0;
    const tgt = Number(threshold) || 0;
    const curLabel = Number.isInteger(cur) ? String(cur) : cur.toFixed(0);
    return `¥${curLabel} / ¥${tgt}`;
  }
  const u = unit || '';
  return `${current} / ${threshold}${u ? u : ''}`;
}

function emptyPayload() {
  return {
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
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const selfOpenid = String(wxContext.OPENID || '')
  const requestedOpenid = String((event && event.userId) || '').trim()
  // 安全：默认只能查自己。原实现 `event.userId || OPENID` 允许任意登录用户
  // 传他人 openid 读取其消费额/订单数/图鉴。运维经 adminOpsKey 时保留代查能力。
  const opsKey = process.env.ADMIN_OPS_KEY || ''
  const isAdminOps = !!(opsKey && event && event.adminOpsKey && String(event.adminOpsKey) === opsKey)
  const userId = isAdminOps && requestedOpenid ? requestedOpenid : selfOpenid
  if (!userId) {
    return { success: false, msg: '请先登录' };
  }

  try {
    const stats = {};

    const safeCount = async (collectionName, query = null) => {
      try {
        let queryBuilder = db.collection(collectionName);
        if (query && Object.keys(query).length > 0) {
          const normalizedQuery = { ...query };
          if (normalizedQuery.userId) {
            normalizedQuery._openid = normalizedQuery.userId;
            delete normalizedQuery.userId;
          }

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
        if (isMissingCollectionError(e)) {
          console.warn(`集合 ${collectionName} 不存在，返回默认值 0`);
        } else {
          console.warn(`集合 ${collectionName} 查询失败:`, e.message || e.errMsg || String(e));
        }
        return 0;
      }
    };

    stats.viewCount = await safeCount('user_behaviors', { userId, action: 'view' });
    stats.collectCount = await safeCount('collections', { _openid: userId });

    let atlasIds = [];
    try {
      const atlasRes = await db.collection('user_atlas').where({ _openid: userId }).limit(100).get();
      atlasIds = (atlasRes.data || []).map((d) => d.speciesId).filter(Boolean);
    } catch (e) {
      atlasIds = [];
    }
    stats.atlasCount = atlasIds.length;
    const atlasHas = (ids) => ids.every((id) => atlasIds.indexOf(id) !== -1);
    const atlasMatchCount = (ids) => ids.filter((id) => atlasIds.indexOf(id) !== -1).length;

    stats.shareCount = await safeCount('user_behaviors', { userId, action: 'share' });
    stats.searchCount = await safeCount('user_behaviors', { userId, action: 'search' });
    stats.folderCount = await safeCount('collection_folders', { _openid: userId });

    let totalConsumption = 0;
    let orderCount = 0;
    try {
      const ordersRes = await db.collection('orders')
        .where({
          _openid: userId,
          status: _.in(['paid', 'shipped', 'received'])
        })
        .limit(100)
        .get();

      orderCount = 0;
      (ordersRes.data || []).forEach((order) => {
        if (order.source === 'exchange') return;
        orderCount += 1;
        if (order.totalPrice) {
          const price = parseFloat(order.totalPrice.toString().replace(/,/g, ''));
          if (!isNaN(price)) totalConsumption += price;
        }
      });
    } catch (e) {
      if (isMissingCollectionError(e)) {
        console.warn('orders 集合不存在，返回默认值');
      } else {
        console.warn('获取订单数据失败:', e.message || e.errMsg || String(e));
      }
      orderCount = 0;
      totalConsumption = 0;
    }
    stats.totalConsumption = Number(totalConsumption.toFixed(2));
    stats.orderCount = orderCount;

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
      if (isMissingCollectionError(e)) {
        console.warn('bookings 集合不存在，返回默认值');
      } else {
        console.warn('获取课程数据失败:', e.message || e.errMsg || String(e));
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
      if (isMissingCollectionError(e)) {
        console.warn('orders 集合不存在（证书查询），返回默认值');
      } else {
        console.warn('获取证书数据失败:', e.message || e.errMsg || String(e));
      }
      stats.certificateCount = 0;
    }

    const achievementConfigs = [
      {
        id: 'explore_10',
        type: 'explore',
        name: '初探者',
        desc: '浏览 10 个藏品',
        condition: '累计浏览藏品达到 10 次',
        icon: '/assets/icons/knowledge.png',
        threshold: 10,
        unit: '次',
        reward: { points: 10, type: 'points' },
        metric: () => stats.viewCount || 0,
        check: () => (stats.viewCount || 0) >= 10
      },
      {
        id: 'explore_50',
        type: 'explore',
        name: '探索家',
        desc: '浏览 50 个藏品',
        condition: '累计浏览藏品达到 50 次',
        icon: '/assets/icons/knowledge.png',
        threshold: 50,
        unit: '次',
        reward: { points: 50, type: 'points' },
        metric: () => stats.viewCount || 0,
        check: () => (stats.viewCount || 0) >= 50
      },
      {
        id: 'explore_100',
        type: 'explore',
        name: '博物学家',
        desc: '浏览 100 个藏品',
        condition: '累计浏览藏品达到 100 次',
        icon: '/assets/icons/knowledge.png',
        threshold: 100,
        unit: '次',
        reward: { points: 100, type: 'points' },
        metric: () => stats.viewCount || 0,
        check: () => (stats.viewCount || 0) >= 100
      },
      {
        id: 'search_5',
        type: 'explore',
        name: '搜索新手',
        desc: '搜索 5 次',
        condition: '使用搜索功能累计 5 次',
        icon: '/assets/icons/knowledge.png',
        threshold: 5,
        unit: '次',
        reward: { points: 5, type: 'points' },
        metric: () => stats.searchCount || 0,
        check: () => (stats.searchCount || 0) >= 5
      },
      {
        id: 'search_20',
        type: 'explore',
        name: '搜索达人',
        desc: '搜索 20 次',
        condition: '使用搜索功能累计 20 次',
        icon: '/assets/icons/knowledge.png',
        threshold: 20,
        unit: '次',
        reward: { points: 20, type: 'points' },
        metric: () => stats.searchCount || 0,
        check: () => (stats.searchCount || 0) >= 20
      },
      {
        id: 'collect_5',
        type: 'collect',
        name: '收藏新手',
        desc: '收藏 5 件',
        condition: '收藏夹内累计收藏 5 件藏品',
        icon: '/assets/icons/heart.png',
        threshold: 5,
        unit: '件',
        reward: { points: 15, type: 'points' },
        metric: () => stats.collectCount || 0,
        check: () => (stats.collectCount || 0) >= 5
      },
      {
        id: 'collect_10',
        type: 'collect',
        name: '收藏家',
        desc: '收藏 10 件',
        condition: '收藏夹内累计收藏 10 件藏品',
        icon: '/assets/icons/heart.png',
        threshold: 10,
        unit: '件',
        reward: { points: 30, type: 'points' },
        metric: () => stats.collectCount || 0,
        check: () => (stats.collectCount || 0) >= 10
      },
      {
        id: 'collect_50',
        type: 'collect',
        name: '收藏大师',
        desc: '收藏 50 件',
        condition: '收藏夹内累计收藏 50 件藏品',
        icon: '/assets/icons/heart.png',
        threshold: 50,
        unit: '件',
        reward: { points: 100, type: 'points' },
        metric: () => stats.collectCount || 0,
        check: () => (stats.collectCount || 0) >= 50
      },
      {
        id: 'folder_3',
        type: 'collect',
        name: '整理达人',
        desc: '创建 3 个收藏夹',
        condition: '创建至少 3 个收藏夹',
        icon: '/assets/icons/heart.png',
        threshold: 3,
        unit: '个',
        reward: { points: 20, type: 'points' },
        metric: () => stats.folderCount || 0,
        check: () => (stats.folderCount || 0) >= 3
      },
      {
        id: 'atlas_first',
        type: 'collect',
        name: '第一页',
        desc: '点亮图鉴中的一页',
        condition: '在山海图鉴中点亮任意 1 页',
        icon: '/assets/icons/atlas.png',
        threshold: 1,
        unit: '页',
        reward: { points: 20, type: 'points' },
        metric: () => stats.atlasCount || 0,
        check: () => (stats.atlasCount || 0) >= 1
      },
      {
        id: 'atlas_frost',
        type: 'collect',
        name: '霜降守望',
        desc: '集齐霜降守望',
        condition: '集齐图鉴「霜降守望」全部 4 页',
        icon: '/assets/icons/atlas.png',
        threshold: 4,
        unit: '页',
        reward: { points: 40, type: 'points' },
        metric: () => atlasMatchCount(ATLAS_SETS.atlas_frost),
        check: () => atlasHas(ATLAS_SETS.atlas_frost)
      },
      {
        id: 'atlas_overwinter',
        type: 'collect',
        name: '越冬者',
        desc: '集齐越冬者三页',
        condition: '集齐图鉴「越冬者」全部 3 页',
        icon: '/assets/icons/atlas.png',
        threshold: 3,
        unit: '页',
        reward: { points: 40, type: 'points' },
        metric: () => atlasMatchCount(ATLAS_SETS.atlas_overwinter),
        check: () => atlasHas(ATLAS_SETS.atlas_overwinter)
      },
      {
        id: 'atlas_mountain',
        type: 'collect',
        name: '守山者',
        desc: '集齐守山者',
        condition: '集齐图鉴「守山者」全部 6 页',
        icon: '/assets/icons/atlas.png',
        threshold: 6,
        unit: '页',
        reward: { points: 40, type: 'points' },
        metric: () => atlasMatchCount(ATLAS_SETS.atlas_mountain),
        check: () => atlasHas(ATLAS_SETS.atlas_mountain)
      },
      {
        id: 'atlas_volume',
        type: 'collect',
        name: '山海图鉴卷一',
        desc: '卷一十六页全部点亮',
        condition: '山海图鉴卷一 16 页全部点亮',
        icon: '/assets/icons/atlas.png',
        threshold: 16,
        unit: '页',
        reward: { points: 100, type: 'points' },
        metric: () => Math.min(stats.atlasCount || 0, 16),
        check: () => (stats.atlasCount || 0) >= 16
      },
      {
        id: 'share_1',
        type: 'social',
        name: '分享者',
        desc: '分享 1 次',
        condition: '分享内容 1 次',
        icon: '/assets/icons/share.png',
        threshold: 1,
        unit: '次',
        // 合规：分享类成就只授予徽章，不发放积分（避免构成诱导分享）
        reward: { type: 'badge' },
        metric: () => stats.shareCount || 0,
        check: () => (stats.shareCount || 0) >= 1
      },
      {
        id: 'share_5',
        type: 'social',
        name: '分享达人',
        desc: '分享 5 次',
        condition: '分享内容累计 5 次',
        icon: '/assets/icons/share.png',
        threshold: 5,
        unit: '次',
        reward: { type: 'badge' },
        metric: () => stats.shareCount || 0,
        check: () => (stats.shareCount || 0) >= 5
      },
      {
        id: 'share_20',
        type: 'social',
        name: '分享大师',
        desc: '分享 20 次',
        condition: '分享内容累计 20 次',
        icon: '/assets/icons/share.png',
        threshold: 20,
        unit: '次',
        reward: { type: 'badge' },
        metric: () => stats.shareCount || 0,
        check: () => (stats.shareCount || 0) >= 20
      },
      {
        id: 'first_purchase',
        type: 'consumption',
        name: '首次购买',
        desc: '完成首次购买',
        condition: '完成 1 笔有效订单（不含积分兑换）',
        icon: '/assets/icons/coin_gold.png',
        threshold: 1,
        unit: '笔',
        reward: { points: 50, type: 'points' },
        metric: () => stats.orderCount || 0,
        check: () => (stats.orderCount || 0) >= 1
      },
      {
        id: 'spend_500',
        type: 'consumption',
        name: '消费新星',
        desc: '累计消费 ¥500',
        condition: '有效订单累计消费满 ¥500',
        icon: '/assets/icons/coin_gold.png',
        threshold: 500,
        unit: '元',
        reward: { points: 100, type: 'points' },
        metric: () => stats.totalConsumption || 0,
        check: () => (stats.totalConsumption || 0) >= 500
      },
      {
        id: 'spend_2000',
        type: 'consumption',
        name: '消费达人',
        desc: '累计消费 ¥2000',
        condition: '有效订单累计消费满 ¥2000',
        icon: '/assets/icons/coin_gold.png',
        threshold: 2000,
        unit: '元',
        reward: { points: 300, type: 'points' },
        metric: () => stats.totalConsumption || 0,
        check: () => (stats.totalConsumption || 0) >= 2000
      },
      {
        id: 'spend_10000',
        type: 'consumption',
        name: '消费大师',
        desc: '累计消费 ¥10000',
        condition: '有效订单累计消费满 ¥10000',
        icon: '/assets/icons/coin_gold.png',
        threshold: 10000,
        unit: '元',
        reward: { points: 1000, type: 'points' },
        metric: () => stats.totalConsumption || 0,
        check: () => (stats.totalConsumption || 0) >= 10000
      },
      {
        id: 'course_1',
        type: 'learning',
        name: '学习者',
        desc: '完成 1 个课程',
        condition: '完成或确认 1 次课程预约',
        icon: '/assets/icons/knowledge.png',
        threshold: 1,
        unit: '次',
        reward: { points: 30, type: 'points' },
        metric: () => stats.courseCount || 0,
        check: () => (stats.courseCount || 0) >= 1
      },
      {
        id: 'course_5',
        type: 'learning',
        name: '学习达人',
        desc: '完成 5 个课程',
        condition: '完成或确认 5 次课程预约',
        icon: '/assets/icons/knowledge.png',
        threshold: 5,
        unit: '次',
        reward: { points: 150, type: 'points' },
        metric: () => stats.courseCount || 0,
        check: () => (stats.courseCount || 0) >= 5
      },
      {
        id: 'certificate_1',
        type: 'learning',
        name: '证书持有者',
        desc: '获得 1 个证书',
        condition: '确认收货获得 1 份藏品证书',
        icon: '/assets/icons/medal_gold.png',
        threshold: 1,
        unit: '份',
        reward: { points: 50, type: 'points' },
        metric: () => stats.certificateCount || 0,
        check: () => (stats.certificateCount || 0) >= 1
      },
      {
        id: 'certificate_5',
        type: 'learning',
        name: '证书收藏家',
        desc: '获得 5 个证书',
        condition: '确认收货累计获得 5 份藏品证书',
        icon: '/assets/icons/medal_gold.png',
        threshold: 5,
        unit: '份',
        reward: { points: 250, type: 'points' },
        metric: () => stats.certificateCount || 0,
        check: () => (stats.certificateCount || 0) >= 5
      }
    ];

    const achievements = [];
    for (const config of achievementConfigs) {
      let isUnlocked = false;
      try {
        isUnlocked = !!(await config.check());
      } catch (e) {
        console.error(`检查成就 ${config.id} 失败:`, e);
        isUnlocked = false;
      }

      let rawProgress = 0;
      try {
        rawProgress = Number(config.metric()) || 0;
      } catch (e) {
        rawProgress = 0;
      }

      const threshold = config.threshold || 1;
      const currentProgress = Math.min(rawProgress, threshold);
      const progressPercent = Math.min(100, Math.round((currentProgress / threshold) * 100));
      const typeMeta = TYPE_META[config.type] || { label: config.type, en: '' };
      const progressText = formatProgressText(currentProgress, threshold, config.unit, config.id);

      achievements.push({
        id: config.id,
        type: config.type,
        typeLabel: typeMeta.label,
        typeEn: typeMeta.en,
        name: config.name,
        desc: config.desc,
        condition: config.condition || config.desc,
        icon: config.icon,
        threshold,
        unit: config.unit || '',
        reward: config.reward || { points: 0, type: 'points' },
        unlocked: isUnlocked,
        progress: currentProgress,
        progressPercent,
        progressText,
        statusLabel: isUnlocked ? '已点亮' : '未点亮'
      });
    }

    const sortAchievements = (list) => {
      return list.slice().sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        if (a.unlocked) return (b.reward?.points || 0) - (a.reward?.points || 0);
        return (b.progressPercent || 0) - (a.progressPercent || 0);
      });
    };

    const achievementsByType = {
      explore: sortAchievements(achievements.filter((a) => a.type === 'explore')),
      collect: sortAchievements(achievements.filter((a) => a.type === 'collect')),
      social: sortAchievements(achievements.filter((a) => a.type === 'social')),
      consumption: sortAchievements(achievements.filter((a) => a.type === 'consumption')),
      learning: sortAchievements(achievements.filter((a) => a.type === 'learning'))
    };

    const totalAchievements = achievements.length;
    const unlockedCount = achievements.filter((a) => a.unlocked).length;
    const totalRewards = achievements
      .filter((a) => a.unlocked)
      .reduce((sum, a) => sum + (a.reward?.points || 0), 0);

    return {
      success: true,
      data: {
        achievements: sortAchievements(achievements),
        achievementsByType,
        stats: {
          total: totalAchievements,
          unlocked: unlockedCount,
          locked: totalAchievements - unlockedCount,
          progress: totalAchievements ? Math.round((unlockedCount / totalAchievements) * 100) : 0,
          totalRewards
        },
        metrics: {
          viewCount: stats.viewCount || 0,
          collectCount: stats.collectCount || 0,
          atlasCount: stats.atlasCount || 0,
          shareCount: stats.shareCount || 0,
          searchCount: stats.searchCount || 0,
          folderCount: stats.folderCount || 0,
          orderCount: stats.orderCount || 0,
          totalConsumption: stats.totalConsumption || 0,
          courseCount: stats.courseCount || 0,
          certificateCount: stats.certificateCount || 0
        }
      }
    };
  } catch (e) {
    console.error('获取用户成就失败:', e);
    if (isMissingCollectionError(e)) {
      console.warn('数据库集合不存在，返回空数据');
      return { success: true, data: emptyPayload() };
    }
    return {
      success: false,
      msg: e.message || e.errMsg || String(e),
      data: null
    };
  }
};
