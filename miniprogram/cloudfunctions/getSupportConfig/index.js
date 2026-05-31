/**
 * 获取联系专员配置（FAQ、营业时间、咨询主题等）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function getDefaultConfig() {
  return {
    phone: '18519110274',
    hours: '10:00 - 22:00',
    responseHint: '专员通常在工作时间内 30 分钟内回复',
    address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
    latitude: 43.86661,
    longitude: 125.29306,
    communityQr: 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/qrcode/community-qrcode.jpg',
    topics: [
      { id: 'order', label: '订单咨询', desc: '支付、物流、售后', icon: '/assets/icons/cart.png' },
      { id: 'booking', label: '预约改期', desc: '到店预约与变更', icon: '/assets/icons/booking.png' },
      { id: 'product', label: '藏品鉴赏', desc: '选品与规格咨询', icon: '/assets/icons/knowledge.png' },
      { id: 'custom', label: '标本定制', desc: '标品工坊与伴宠记忆', icon: '/assets/icons/knowledge.png' },
      { id: 'specimen_care', label: '标本养护', desc: '安放、清洁与异常咨询', icon: '/assets/icons/knowledge.png' },
      { id: 'pet_memorial', label: '伴宠记忆', desc: '宠物标本制作意向', icon: '/assets/icons/knowledge.png' },
      { id: 'identify', label: '鉴定疑问', desc: 'AI 鉴定结果咨询', icon: '/assets/icons/camera.png' },
      { id: 'refund', label: '售后退款', desc: '退款进度与凭证', icon: '/assets/icons/discount.png' },
      { id: 'feedback', label: '反馈与建议', desc: '功能体验与内容建议', icon: '/assets/icons/message.png' },
      { id: 'other', label: '其他问题', desc: '品牌与合作等', icon: '/assets/icons/message.png' }
    ],
    faqs: [
      {
        q: '订单支付后多久发货？',
        a: '现货订单通常在 1-3 个工作日内发出。定制或装裱类藏品以商详页说明为准，专员会在发货前通过山海有信通知您。'
      },
      {
        q: '如何修改或取消预约？',
        a: '进入「预约」→「我的预约」，在预约详情中查看是否支持改期或取消。若页面无入口，请选择「预约改期」联系专员协助处理。'
      },
      {
        q: '退款多久到账？',
        a: '退款申请审核通过后，微信支付的款项一般 1-7 个工作日原路退回，具体以支付渠道为准。'
      },
      {
        q: '会员等级如何提升？',
        a: '在门店消费、完成预约参观、收藏与分享等行为均可获得成长值。进入「我的」可查看当前等级与下一级门槛。'
      },
      {
        q: '企业团购如何询价？',
        a: '在「标本工坊」完成方案选配后，于预览页选择「企业团购意向」提交（10 件起）。专员会在 1-2 个工作日内联系报价，无需立即支付。'
      },
      {
        q: 'AI 鉴定结果准确吗？',
        a: 'AI 鉴定仅供参考。若对结果有疑问，可选择「鉴定疑问」联系专员，或携带实物到店由标本师进一步确认。'
      }
    ]
  };
}

exports.main = async () => {
  try {
    const res = await db.collection('support_configs')
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get();

    if (res.data && res.data.length) {
      const cfg = res.data[0];
      return {
        success: true,
        config: { ...getDefaultConfig(), ...(cfg.config || {}) },
        default: false
      };
    }

    return {
      success: true,
      config: getDefaultConfig(),
      default: true
    };
  } catch (e) {
    console.warn('getSupportConfig fallback:', e.message);
    return {
      success: true,
      config: getDefaultConfig(),
      default: true,
      fallback: true
    };
  }
};
