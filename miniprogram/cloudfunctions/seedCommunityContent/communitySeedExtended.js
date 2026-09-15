/**
 * 社区 UGC 扩展内容 — 博物学 / 白垩纪 / 自然地理 / 标本文创等
 */
const { sectionsToHtml, ugc, pick, stats, MEDIA } = require('./seedHelpers')
const { applyExhibitionCopy } = require('./exhibitionCopy')

const BASE = Date.now()

const EXTENDED_ARTICLES = [
  ugc('ugc_kpg_boundary', {
    title: '白垩纪末：K-Pg 界线到底划在哪里',
    brief: '6600 万年前的一灰层，把恐龙时代和哺乳动物时代分开。实地看剖面，比读任何科普书都直观。',
    category: 'knowledge',
    coverImage: pick('mineral', 0, 2)[0],
    images: pick('mineral', 0, 2, 4),
    tags: ['白垩纪', '地质', 'K-Pg', '博物学'],
    author: '林溪 · 地质笔记',
    stats: stats(2840, 198, 31),
    createTime: BASE - 3600000 * 5,
    content: sectionsToHtml([
      {
        title: '一层灰，两个世界',
        body: 'K-Pg 界线（Cretaceous-Paleogene boundary）是全球可对比的地层界面。界线附近常可见铱异常与冲击石英，指向一次剧烈的行星际事件。对公众而言，更直观的理解是：界线之下常见大型恐龙化石，界线之上则进入哺乳动物与被子植物主导的新生代。',
        images: [pick('mineral', 1)[0]],
        tips: [
          '界线并非「一夜灭绝」，生态重组可持续数十万年',
          '不同盆地剖面厚度差异大，对比需结合微体化石'
        ]
      },
      {
        title: '为什么白垩纪值得单独被记住',
        body: '白垩纪（约 145–66 Ma）是被子植物辐射、海洋化学变化与陆相恐龙群集演化的关键期。北美西部、中国东北热河组、欧洲 chalk 沉积，各自保存了不同的白垩纪切片。收藏或阅读标本时，把产地与层位写在卡片上，信息量会翻倍。',
        tips: ['热河组以细粒湖相页岩著称，软体组织保存概率较高']
      }
    ])
  }),
  ugc('ugc_dromaeosaur_movie', {
    title: '恐爪龙和电影里的「迅猛龙」不是一回事',
    brief: '《侏罗纪公园》里的迅猛龙，体型更接近恐爪龙属。厘清名字，是看恐龙标本的第一步。',
    category: 'knowledge',
    coverImage: pick('insect', 2)[0],
    images: pick('insect', 1, 3, 4),
    tags: ['恐龙', '恐爪龙', '科普'],
    author: '阿原 · 恐龙迷',
    stats: stats(4120, 356, 52),
    createTime: BASE - 3600000 * 8,
    content: sectionsToHtml([
      {
        title: '名字背后的分类学',
        body: 'Velociraptor mongoliensis 真实体长多在 2 米左右，带标志性的镰刀爪与 stiff tail。电影为了视觉张力放大了体型，并融合了 Deinonychus 等近缘类群的特征。理解这一点，再去看齿列、跖骨与爪鞘标本，就不会被流行文化带偏。',
        tips: ['镰刀爪用于钩住猎物，不是「开膛」专用武器', '羽毛证据主要来自近缘类群，重建图宜保留不确定性']
      },
      {
        title: '标本观看顺序',
        body: '建议：爪 → 齿列 → 尾椎序列 → 后肢比例。小型兽脚类恐龙的力量感，来自比例而非绝对尺寸。',
        images: [pick('insect', 0)[0]]
      }
    ])
  }),
  ugc('ugc_amber_time_capsule', {
    title: '琥珀里的时间胶囊：虫珀在说什么',
    brief: '树脂包裹的不只是虫体，还有白垩纪—第三纪森林里的微环境。',
    category: 'knowledge',
    coverImage: pick('mineral', 3)[0],
    images: pick('mineral', 3, 5, 6),
    tags: ['琥珀', '昆虫', '白垩纪', '自然考古'],
    author: '未晚 · 昆虫与植物',
    stats: stats(1960, 142, 19),
    createTime: BASE - 3600000 * 12,
    content: sectionsToHtml([
      {
        title: '形成：从树脂到化石',
        body: '琥珀是松柏类等树脂经埋藏、聚合与成岩作用形成的有机宝石。虫珀、植物珀、孢子珀，分别对应不同的古生态信号。波罗的海、缅甸、多米尼加等产地，层位与年龄差异显著，购买与收藏务必核对产地证书。',
        tips: ['加热嗅味、盐水浮选、紫外荧光，是简易鉴别手段', '内含物完整不等于科研价值高，分类鉴定仍需专业']
      },
      {
        title: '为什么博物爱好者会迷上虫珀',
        body: '三维保存的节肢动物，在光学显微镜下仍可见刚毛、复眼面与翅脉。它是「可握在掌心的剖面」，也是连接昆虫学、古植物学与沉积学的交叉标本。',
        images: [pick('mineral', 4)[0]]
      }
    ])
  }),
  ugc('ugc_jehol_biota', {
    title: '热河生物群：东北地层里的一整个白垩纪',
    brief: '辽宁西部—河北北部一带的湖相页岩，保存了从恐龙到早期鸟类的连续叙事。',
    category: 'knowledge',
    coverImage: pick('plant', 0)[0],
    images: pick('plant', 0, 1),
    tags: ['热河生物群', '白垩纪', '辽宁', '古生物'],
    author: '北辰 · 地层爱好者',
    stats: stats(3250, 267, 38),
    createTime: BASE - 3600000 * 18,
    content: sectionsToHtml([
      {
        title: '湖相细粒沉积的魔力',
        body: '热河组以凝灰质页岩、油页岩互层为特征，平静缺氧的湖底环境有利于软体组织与羽毛印痕的保存。Confuciusornis、Sinosauropteryx 等名物，均来自这一沉积体系。',
        tips: ['野外剖面需授权，化石采集受严格法律保护', '博物馆复制品与科研标本应区分标注']
      },
      {
        title: '与标本柜里的「鸟」对话',
        body: '早期鸟类的齿列、爪钩与尾综骨，是连接恐龙与现生鸟类的关键形态。看标本时不急于「像不像鸽子」，先看骨骼特征清单。',
        images: [pick('insect', 2)[0]]
      }
    ])
  }),
  ugc('ugc_fern_not_primitive', {
    title: '蕨类不是「低级植物」：它们只是更古老',
    brief: '在垂直花园与标本押叶里，蕨类是被低估的演化成功者。',
    category: 'knowledge',
    coverImage: pick('plant', 1)[0],
    images: pick('plant', 0, 1),
    tags: ['植物', '蕨类', '科普'],
    author: '未晚 · 植物学笔记',
    stats: stats(1580, 118, 14),
    createTime: BASE - 3600000 * 22,
    content: sectionsToHtml([
      {
        title: '系统发育视角',
        body: '现生蕨类与种子植物同为真叶植物支系，所谓「低级」是线性进化观的遗留。桫椤等木本蕨类，在中生代曾形成过显著林相。',
        tips: ['孢子繁殖不等于「原始」，是适应阴湿环境的策略', '押叶标本应标注孢子囊群形态']
      },
      {
        title: '居家与标本',
        body: '室内观叶蕨类喜散射光与高湿，与押花标本的干燥环境相反——活体与标本，是同一类群的两套保存语言。',
        images: [pick('plant', 0)[0]]
      }
    ])
  }),
  ugc('ugc_bryophyte_city', {
    title: '苔藓：砖缝里的陆地记忆',
    brief: '城市微栖息地中最被忽略的类群，却是理解植物登陆的钥匙。',
    category: 'knowledge',
    coverImage: pick('plant', 0)[0],
    images: pick('plant', 1, 0),
    tags: ['苔藓', '植物', '城市生态'],
    author: '陈野 · 博物插画',
    stats: stats(980, 76, 9),
    createTime: BASE - 3600000 * 26,
    content: sectionsToHtml([
      {
        title: '形态与生态',
        body: '苔藓无真根、无维管组织，依赖叶面吸收水分。它们对大气污染与湿度极为敏感，是城市生态质量的指示类群之一。',
        tips: ['采集少量样品制作显微装片，比整片挖取更可持续', '标本干燥后需密封防潮保存']
      }
    ])
  }),
  ugc('ugc_naturalist_plate', {
    title: '博物画册页：从野外速写到期装框',
    brief: '不是拍照替代手绘，而是强迫眼睛看见结构。',
    category: 'art',
    coverImage: pick('insect', 1)[0],
    images: pick('insect', 1, 2, 3),
    tags: ['博物画', '艺术', '标本'],
    author: '陈野 · 博物插画',
    stats: stats(2210, 189, 24),
    createTime: BASE - 3600000 * 30,
    content: sectionsToHtml([
      {
        title: '工具与顺序',
        body: '铅笔定位 → 防水墨水定稿 → 透明水彩分层。博物画强调比例、解剖与鳞片/羽枝细节，而非情绪渲染。许多自然史博物馆的历史图版，至今仍是分类学辅助材料。',
        images: [pick('insect', 0)[0]],
        tips: ['标注比例尺与观察日期', '与实体标本并置展示，信息互补']
      }
    ])
  }),
  ugc('ugc_dendro_climate', {
    title: '树轮考古：一圈年轮能读几年气候',
    brief: ' dendrochronology 把木材变成气候档案，也是自然考古的重要分支。',
    category: 'knowledge',
    coverImage: pick('plant', 1)[0],
    images: pick('plant', 0, 1),
    tags: ['树轮', '气候', '自然考古'],
    author: '林溪 · 地质笔记',
    stats: stats(1740, 131, 17),
    createTime: BASE - 3600000 * 34,
    content: sectionsToHtml([
      {
        title: '原理',
        body: '年轮宽度反映生长季水热条件。通过交叉定年，可将未知样本钉定在 regional master chronology 上，精度可达年甚至季。',
        tips: ['窄轮不一定等于干旱，也可能与竞争或病虫害有关', '标本需标注径向与切向截面方向']
      }
    ])
  }),
  ugc('ugc_fossil_stationery', {
    title: '标本文创：一块化石印迹书签的来处',
    brief: '文创不是贴图，而是把产地、层位与物种信息一起带回家。',
    category: 'craft',
    coverImage: pick('mineral', 2)[0],
    images: pick('mineral', 2, 4, 6),
    tags: ['文创', '化石', '标本'],
    author: '山海造物 · 工坊',
    stats: stats(2650, 224, 29),
    createTime: BASE - 3600000 * 38,
    content: sectionsToHtml([
      {
        title: '设计逻辑',
        body: '优质标本文创保留「铜牌式信息结构」：中文俗名、拉丁学名、产地与地质时代。材质上，纸品用微暖未涂布纸，金属件避免过度抛光，以贴近自然质感。',
        images: [pick('mineral', 0)[0]],
        tips: ['印迹类文创应注明是否为真实化石铸模', '避免使用未授权的科学复原图']
      }
    ])
  }),
  ugc('ugc_mineral_lighting', {
    title: '拍矿物标本的三盏灯：国家地理式光线',
    brief: '不是越亮越好，而是让晶面有层次。',
    category: 'art',
    coverImage: pick('mineral', 1)[0],
    images: pick('mineral', 1, 3, 5),
    tags: ['摄影', '矿物', '国家地理'],
    author: '阿禾 · 自然摄影',
    stats: stats(3420, 298, 41),
    createTime: BASE - 3600000 * 42,
    content: sectionsToHtml([
      {
        title: '主光、辅光、轮廓光',
        body: '主光 45° 建立体积；辅光控制暗部细节；轮廓光分离晶体与背景。国家地理式自然题材摄影，核心是让主体从背景「剥离」而不显人工。',
        images: [pick('mineral', 2)[0]],
        tips: ['偏振镜可减弱晶面过曝', '黑色绒布背景优于纯纸，减少边缘反光']
      }
    ])
  }),
  ugc('ugc_tethys_himalaya', {
    title: '特提斯洋的关闭：喜马拉雅里的海洋记忆',
    brief: '世界屋脊的岩石，记录着从洋壳俯冲到陆陆碰撞的完整链条。',
    category: 'knowledge',
    coverImage: pick('mineral', 4)[0],
    images: pick('mineral', 4, 6, 0),
    tags: ['板块构造', '自然地理', '喜马拉雅'],
    author: '林溪 · 地质笔记',
    stats: stats(2890, 241, 33),
    createTime: BASE - 3600000 * 46,
    content: sectionsToHtml([
      {
        title: '从洋到山',
        body: '印度板块与欧亚板块碰撞，使特提斯洋残余洋壳与沉积盖层被抬升、折皱。珠峰地区奥陶纪灰岩中的海洋化石，是这一过程的直接证据。',
        tips: ['蛇绿混杂岩带是古板块边界的重要标志', '收藏矿物需区分产地合规性']
      }
    ])
  }),
  ugc('ugc_karst_landform', {
    title: '喀斯特：水写在大地上的雕塑',
    brief: '溶蚀、崩塌、地下河——云贵高原的地理教科书。',
    category: 'knowledge',
    coverImage: MEDIA.bannerMuseum,
    images: pick('mineral', 0, 2),
    tags: ['喀斯特', '自然地理', '地貌'],
    author: '阿禾 · 自然摄影',
    stats: stats(2100, 167, 22),
    createTime: BASE - 3600000 * 50,
    content: sectionsToHtml([
      {
        title: '形成条件',
        body: '可溶性岩石（石灰岩、白云岩等）、充足降水与裂隙系统，共同决定喀斯特发育强度。峰丛、峰林、天坑、溶洞，是不同演化阶段的表面形态。',
        images: [pick('mineral', 1)[0]],
        tips: ['洞穴沉积物（石钟乳）记录古气候波动', '野外摄影注意安全与保护区规定']
      }
    ])
  }),
  ugc('ugc_feather_before_flight', {
    title: '羽毛早于飞行？鸟类起源争议简史',
    brief: '从始祖鸟到热河羽毛恐龙，「羽毛最初用来干什么」仍在更新。',
    category: 'knowledge',
    coverImage: pick('insect', 3)[0],
    images: pick('insect', 2, 4),
    tags: ['鸟类起源', '羽毛', '恐龙'],
    author: '阿原 · 恐龙迷',
    stats: stats(3670, 312, 44),
    createTime: BASE - 3600000 * 54,
    content: sectionsToHtml([
      {
        title: '四种假说',
        body: '保温、展示、平衡、滑翔——羽毛功能可能逐步叠加。当前证据支持羽毛在飞行之前已出现，与兽脚类恐龙广泛分布的丝状结构一致。',
        tips: ['复原图应标注证据等级：实证、推断、艺术演绎']
      }
    ])
  }),
  ugc('ugc_trilobite_eyes', {
    title: '三叶虫的复眼：古生代光学工程',
    brief: '寒武纪海洋里的「装甲车」，眼睛却精密得惊人。',
    category: 'knowledge',
    coverImage: pick('marine', 2)[0],
    images: pick('marine', 2, 4, 6),
    tags: ['三叶虫', '古生物', '寒武纪'],
    author: '北辰 · 地层爱好者',
    stats: stats(2450, 203, 27),
    createTime: BASE - 3600000 * 58,
    content: sectionsToHtml([
      {
        title: '复眼类型',
        body: '三叶虫复眼分为聚合眼与施密特眼等类型，透镜由方解石晶体构成。不同生态位（底栖、浮游）眼列排列差异明显，是古生态推断的重要依据。',
        images: [pick('marine', 3)[0]],
        tips: ['完整头甲比单块胸板更具研究价值', '摩洛哥、山东等地层位需分别标注']
      }
    ])
  }),
  ugc('ugc_alpine_vegetation', {
    title: '垂直带谱：从山脚到雪线植物怎么换',
    brief: '国家地理镜头里的高山，本质是温度与水分的梯度实验。',
    category: 'knowledge',
    coverImage: pick('plant', 0)[0],
    images: pick('plant', 0, 1),
    tags: ['自然地理', '植物', '垂直带'],
    author: '未晚 · 植物学笔记',
    stats: stats(1890, 154, 20),
    createTime: BASE - 3600000 * 62,
    content: sectionsToHtml([
      {
        title: '典型序列',
        body: '亚热带常绿阔叶 → 针阔混交 → 纯针叶林 → 灌丛草甸 → 稀疏植被 → 冰雪带。海拔每升高 1000 m，气温约降 6°C，配合降水再分配，形成清晰带谱。',
        tips: ['标本采集应记录海拔 GPS 与坡向', '高山植物多耐 UV，押花需避光保存']
      }
    ])
  }),
  ugc('ugc_dino_nesting', {
    title: '恐龙蛋巢：温度、姿态与母性假说',
    brief: '一窝整齐排列的蛋，可能是白垩纪最温柔的地质证据。',
    category: 'knowledge',
    coverImage: pick('mineral', 5)[0],
    images: pick('mineral', 5, 3),
    tags: ['恐龙', '蛋化石', '白垩纪'],
    author: '阿原 · 恐龙迷',
    stats: stats(2980, 256, 35),
    createTime: BASE - 3600000 * 66,
    content: sectionsToHtml([
      {
        title: '巢式与孵化',
        body: '部分 nest 显示蛋呈半埋藏、定向排列，暗示亲代行为。蛋壳孔隙率可反推孵化温与气体交换。中国南雄、河南西峡等地是蛋化石重要产地。',
        tips: ['蛋化石易碎，运输需定制缓冲', '复制品与原件应在标签上明确区分']
      }
    ])
  }),
  ugc('ugc_whale_stranding', {
    title: '从海滩到展柜：一具鲸类标本的长途',
    brief: '自然考古不只挖化石，也包括现代海洋巨兽的标本化过程。',
    category: 'story',
    coverImage: pick('marine', 0)[0],
    images: pick('marine', 0, 1, 3),
    tags: ['鲸类', '标本', '海洋'],
    author: '山海造物 · 工坊',
    stats: stats(1760, 143, 18),
    createTime: BASE - 3600000 * 70,
    content: sectionsToHtml([
      {
        title: '处理流程',
        body: '记录 → 去脂 → 骨架分离 → 漂白与重组 → 入库。大型哺乳动物标本化周期以年计，每一步都有严格的生物安全与环保要求。',
        images: [pick('marine', 2)[0]],
        tips: ['公众教育标本优先展示骨骼比例与生态位', '气味处理是工坊最被低估的环节']
      }
    ])
  }),
  ugc('ugc_specimen_desk', {
    title: '标本文房：铜牌、拉丁名与微暖白纸',
    brief: '一套值得传承的桌面：放大镜、游标卡尺与尚未写出的学名。',
    category: 'craft',
    coverImage: pick('insect', 0)[0],
    images: pick('insect', 0, 2, 4),
    tags: ['标本文创', '博物学', '工具'],
    author: '陈野 · 博物插画',
    stats: stats(2340, 201, 26),
    createTime: BASE - 3600000 * 74,
    content: sectionsToHtml([
      {
        title: '桌面清单',
        body: '软毛刷、无酸纸、铅笔与防水墨水是基础配置。铜牌标签采用中文宋体 + 拉丁斜体组合，字号克制，信息完整：种、产地、采集号、日期。',
        images: [pick('insect', 1)[0]],
        tips: ['避免 PVC 封套长期接触标本', '数字编号与实体标签双轨备份']
      }
    ])
  }),
  ugc('ugc_chengjiang_fauna', {
    title: '澄江动物群：寒武纪大爆发的一扇窗',
    brief: '云南帽天山下的页岩，保存了节肢动物软体的惊人细节。',
    category: 'knowledge',
    coverImage: pick('marine', 4)[0],
    images: pick('marine', 4, 5, 7),
    tags: ['澄江', '寒武纪', '自然考古'],
    author: '北辰 · 地层爱好者',
    stats: stats(3890, 334, 48),
    createTime: BASE - 3600000 * 78,
    content: sectionsToHtml([
      {
        title: '为什么重要',
        body: '澄江生物群以 Phyllopod bed 为代表，保存了 Anomalocaris、Hallucigenia 等「奇怪」类群的软体结构，为早期动物树提供了关键形态证据。',
        images: [pick('marine', 6)[0]],
        tips: ['世界自然遗产地严禁私自采集', '模型复制品应注明参考标本号']
      }
    ])
  }),
  ugc('ugc_volcanic_ash_marker', {
    title: '火山灰层：地质年表里的书签',
    brief: '一层凝灰岩，可能是全球对比的「同步事件」。',
    category: 'knowledge',
    coverImage: pick('mineral', 6)[0],
    images: pick('mineral', 6, 0, 2),
    tags: ['火山', '地层', '自然地理'],
    author: '林溪 · 地质笔记',
    stats: stats(1650, 128, 16),
    createTime: BASE - 3600000 * 82,
    content: sectionsToHtml([
      {
        title: '凝灰岩与 Tephra',
        body: '火山喷发产物可在数百至数千公里外沉降，形成等时性标志层。结合同位素测年，可约束沉积序列年龄。',
        tips: ['玻璃质 shard 在偏光显微镜下易识别', '野外需区分Primary fall 与 remobilized 层']
      }
    ])
  }),
  ugc('ugc_dragonfly_metamorphosis', {
    title: '蜻蜓的两次生命：若虫与成虫都值得一张图',
    brief: '完全变态的标本序列，是池塘生态的浓缩。',
    category: 'knowledge',
    coverImage: pick('insect', 4)[0],
    images: pick('insect', 3, 4, 0),
    tags: ['昆虫', '蜻蜓', '科普'],
    author: '未晚 · 昆虫与植物',
    stats: stats(1420, 109, 13),
    createTime: BASE - 3600000 * 86,
    content: sectionsToHtml([
      {
        title: '形态对比',
        body: '若虫水生，复眼分离，尾鳃呼吸；成虫陆空，复眼接近，翅脉网状。两者同时入框，是教学标本的经典组合。',
        images: [pick('insect', 2)[0]],
        tips: ['展翅需控制湿度与固定夹', '翅脉是分类关键，拍照避免强反光']
      }
    ])
  }),
  ugc('ugc_calcite_birefringence', {
    title: '收藏方解石：双折射与产地故事',
    brief: '一块透明方解石能把文字分成两个影子——物理与美学同时发生。',
    category: 'art',
    coverImage: pick('mineral', 0)[0],
    images: pick('mineral', 0, 1, 3),
    tags: ['矿物', '方解石', '收藏'],
    author: '阿禾 · 自然摄影',
    stats: stats(2080, 176, 21),
    createTime: BASE - 3600000 * 90,
    content: sectionsToHtml([
      {
        title: '光学性质',
        body: '方解石属三方晶系，常呈菱形解理。强双折射使透过晶体的图像产生位移，是矿物光学实验课的经典材料。',
        tips: ['硬度低（Mohs 3），勿与硬物混放', '标注产地：冰岛、中国、墨西哥等差异显著']
      }
    ])
  }),
  ugc('ugc_pamir_geography', {
    title: '帕米尔想起国家地理那组雪山：高寒与风',
    brief: '高海拔不是「更冷而已」，是大气密度、UV 与风蚀的综合结果。',
    category: 'story',
    coverImage: MEDIA.bannerBlue,
    images: [MEDIA.bannerBlue, MEDIA.bannerMuseum],
    tags: ['国家地理', '自然地理', '高原'],
    author: '阿禾 · 自然摄影',
    stats: stats(2560, 218, 30),
    createTime: BASE - 3600000 * 94,
    content: sectionsToHtml([
      {
        title: '镜头之后',
        body: '国家地理式高原摄影，等待的是短窗口的侧光与稳定空气。帕米尔、青藏高原、安第斯，各有风场与尘源差异，同一套参数无法通吃。',
        images: [MEDIA.bannerMuseum],
        tips: ['保护器材与人体同样重要', '尊重边境与保护区管理规定']
      }
    ])
  }),
  ugc('ugc_fossil_prep_hour', {
    title: '化石清修台上一小时：针尖下的白垩纪',
    brief: '气动雕针的声音，像给时间做减法。',
    category: 'craft',
    coverImage: pick('mineral', 4)[0],
    images: pick('mineral', 4, 5),
    tags: ['化石', '清修', '白垩纪'],
    author: '山海造物 · 工坊',
    stats: stats(1870, 159, 19),
    createTime: BASE - 3600000 * 98,
    content: sectionsToHtml([
      {
        title: '工具与原则',
        body: '气动笔、微型砂针、 consolidant 交替使用。原则：先定框后剔围岩，随时记录暴露面编号。过度清修比清修不足更不可逆。',
        tips: ['围岩硬度决定转速与针号', '粉尘防护不可省略']
      }
    ])
  }),
  ugc('ugc_marine_forest', {
    title: '海藻林与潮间带：海洋标本的另一张脸',
    brief: '不是只有贝壳。褐藻、红藻的压片同样值得进框。',
    category: 'knowledge',
    coverImage: pick('marine', 1)[0],
    images: pick('marine', 1, 2, 5),
    tags: ['海洋', '植物', '标本'],
    author: '未晚 · 昆虫与植物',
    stats: stats(1340, 98, 11),
    createTime: BASE - 3600000 * 102,
    content: sectionsToHtml([
      {
        title: '采集与固定',
        body: '潮间带采集需关注潮汐表与法规。固定液浓度与压片干燥曲线，决定色素保留程度。',
        images: [pick('marine', 0)[0]],
        tips: ['标注潮带位置：upper/mid/lower littoral']
      }
    ])
  }),
  ugc('ugc_natgeo_composition', {
    title: '国家地理构图的三条旧规则，今天仍好用',
    brief: '主体、路径、尺度——自然题材摄影的底层语法。',
    category: 'art',
    coverImage: MEDIA.bannerMuseum,
    images: [MEDIA.bannerMuseum, pick('plant', 0)[0]],
    tags: ['摄影', '国家地理', '构图'],
    author: '阿禾 · 自然摄影',
    stats: stats(3120, 278, 39),
    createTime: BASE - 3600000 * 106,
    content: sectionsToHtml([
      {
        title: '规则',
        body: '① 单一主体：避免画面出现两个争夺注意力的中心。② 视觉路径：利用 S 形河流、山脊线引导视线。③ 尺度参照：人物、帐篷、标本牌，都能让巨物可感。',
        images: [pick('mineral', 2)[0]],
        tips: ['黄金时刻适用于矿物与标本，不只是风光']
      }
    ])
  })
]

const EXTENDED_EXHIBITIONS = [
  {
    _seedKey: 'exhibition_cretaceous_echo',
    title: '白垩纪回响',
    latinName: 'Cretaceous Echo',
    coverImage: pick('mineral', 0, 2)[0],
    ...applyExhibitionCopy('exhibition_cretaceous_echo')
  },
  {
    _seedKey: 'exhibition_dinosauria',
    title: '恐龙世系',
    latinName: 'Dinosauria',
    coverImage: pick('insect', 2)[0],
    ...applyExhibitionCopy('exhibition_dinosauria')
  },
  {
    _seedKey: 'exhibition_naturalist_desk',
    title: '博物学家的工作台',
    latinName: 'Naturalist Desk',
    coverImage: pick('insect', 0)[0],
    ...applyExhibitionCopy('exhibition_naturalist_desk')
  },
  {
    _seedKey: 'exhibition_plate_tectonics',
    title: '板块与山河',
    latinName: 'Plate & Range',
    coverImage: pick('mineral', 4)[0],
    ...applyExhibitionCopy('exhibition_plate_tectonics')
  },
  {
    _seedKey: 'exhibition_paleozoic_window',
    title: '古生代之窗',
    latinName: 'Paleozoic Window',
    coverImage: pick('marine', 4)[0],
    ...applyExhibitionCopy('exhibition_paleozoic_window')
  },
  {
    _seedKey: 'exhibition_specimen_atelier',
    title: '标本文创实验室',
    latinName: 'Specimen Atelier',
    coverImage: pick('mineral', 2)[0],
    ...applyExhibitionCopy('exhibition_specimen_atelier')
  },
  {
    _seedKey: 'exhibition_natgeo_light',
    title: '国家地理灵感：光与野',
    latinName: 'Light & Wild',
    coverImage: MEDIA.bannerBlue,
    ...applyExhibitionCopy('exhibition_natgeo_light')
  },
  {
    _seedKey: 'exhibition_plant_vertical',
    title: '植物垂直剖面',
    latinName: 'Plantae Verticalis',
    coverImage: pick('plant', 0)[0],
    ...applyExhibitionCopy('exhibition_plant_vertical')
  }
]

module.exports = { EXTENDED_ARTICLES, EXTENDED_EXHIBITIONS, BASE }
