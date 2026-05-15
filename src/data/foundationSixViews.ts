/** /foundation 六观主体 · 文案来源：山海造物·官网 v0.4·六观文案 v0.4.md */

export type FoundationViewHighlight = 'coral';

export interface FoundationViewData {
  id: string;
  number: string;
  titleCn: string;
  titleEn: string;
  tagline: string;
  paragraphs: string[];
  negative: string | string[];
  positive: string | string[];
  closing: string;
  highlight?: FoundationViewHighlight;
  /** 观后附注（外链等） */
  afterBlock?: string;
}

export const foundationViewTransitions: { number: string; text: string }[] = [
  { number: '02', text: '从根本立场到对内体验' },
  { number: '03', text: '从空间到表达' },
  { number: '04', text: '从对外表达到对内组织' },
  { number: '05', text: '从组织内部到对外承担' },
  { number: '06', text: '从额外承担到必须遵守' },
];

export const foundationViews: FoundationViewData[] = [
  {
    id: 'nature',
    number: '01',
    titleCn: '自然观',
    titleEn: 'On Nature',
    tagline: '我们不教育自然，我们向自然学习。',
    paragraphs: [
      '<p><strong class="text-cream">自然不需要被解释</strong></p>',
      '自然不是一个等待人类去解读的客体。<br />它是先于我们存在的、广阔的、有自己秩序的整体。',
      '我们做标本、做自然小匣、做工坊体验——<br />不是为了把自然「科普」给你，<br />而是为了<strong class="text-brass-bright">让自然能进入你的日常</strong>——以一种不打扰、不教育、不抢话的方式。',
      '<p><strong class="text-cream">自然博物美学不是装饰</strong></p>',
      '家里多一颗矿石、案头多一只蝴蝶、窗边多一束干花——<br />这不是装饰主义，这是<strong class="text-brass-bright">一种生活方式的选择</strong>。',
      '你愿意让什么进入你的视线、进入你的生活、进入你每天 8 小时与之共处的空间？<br />这件事比你以为的更重要。',
      '我们做的，是为这个选择提供选项。',
      '<p><strong class="text-cream">自然有它的边界</strong></p>',
      '我们做的事，不能伤害自然。',
      '我们不做任何让动物受到伤害的事——所有标本来源于自然死亡或合法养殖的副产品。<br />我们不做任何让生态失衡的事——不参与野外大规模采集 · 不做保护物种 · 不做来源不明的标本。<br />我们不做任何让自然只剩下「消费品」含义的事——不夸大稀缺性 · 不用「濒危」作为卖点。',
      '如果某一天，我们的某件产品违反了这三条之一——<br />我们会主动下架，<br />即使损失全部成本。',
    ],
    negative: `<p class="font-serif text-lg text-cream tracking-cn mb-3"><strong class="text-cream">不做任何让「自然」变成「猎奇」的事。</strong></p>
<p class="text-sm leading-relaxed">不会用「全球只有 X 只」作为卖点；<br />不会用「野外捕获」作为故事；<br />不会让任何一件标本看上去像「猎获的战利品」。</p>
<p class="text-sm leading-relaxed mt-3">如果让顾客觉得「啊，好酷，能找到这么稀有的东西」——<br />我们就失败了。</p>`,
    positive: `<p><strong class="text-brass-bright">1% 承诺</strong>：</p>
<p>每家城市门店年营收的 1%，<br />捐赠给本地动物园或动植物保护基金，<br />用于动物权益保护。</p>
<p class="mt-3">第一份《1% 承诺年度透明报告》将于 2027 年 4 月发布。</p>`,
    closing: '<strong class="text-cream">自然不需要我们去守护</strong>——它需要的是，我们做这件事时，不要让自然受到伤害。',
  },
  {
    id: 'view-space',
    number: '02',
    titleCn: '空间观',
    titleEn: 'On Space',
    tagline: '店是博物馆，不是商店。',
    paragraphs: [
      '<p><strong class="text-cream">我们不是开店，我们是开馆</strong></p>',
      '商店的逻辑是：让顾客快速找到想要的东西、付钱、走人。<br />博物馆的逻辑是：让来访者慢慢看、安静地呆一会儿、回头再来。',
      '我们做的是后者。',
      '第一家工作室在长春，60 平米。<br />但它不是一个 60 平米的「卖标本的店」，<br />而是一个 60 平米的「小型自然博物馆」。',
      '<p><strong class="text-cream">空间要让人停下来</strong></p>',
      '一进店，会先安静下来。<br />灯光是暖色低照度的——像旧时画廊。<br />背景音是工作室真实的环境声——铁皮工具、木案、茶水。<br />味道是黄铜、木头、新晒的干花。',
      '每一个细节都是为了<strong class="text-brass-bright">让人愿意停一会儿</strong>。',
      '停一会儿，是这一切的开始。<br />不停下来，什么都不会发生。',
      '<p><strong class="text-cream">空间是品牌的第一份「无字宣言」</strong></p>',
      '进店的前 10 秒，<br />访客不会读任何文案，<br />但他们会用所有的感官接收到我们是谁。',
      '如果空间是粗糙的、嘈杂的、急功近利的——<br />任何后续的文案、活动、营销都救不回来。',
      '我们花在空间上的钱和心思，<br />比花在所有其他营销手段的总和还要多。',
    ],
    negative: `<p class="font-serif text-lg text-cream tracking-cn mb-3"><strong class="text-cream">不做「打卡式空间」。</strong></p>
<p class="text-sm leading-relaxed">不会摆一些「为了拍照而存在的角」；<br />不会做任何「扫码送礼」的引流装置；<br />不会让空间的任何一处看起来像是「为了让你发朋友圈」。</p>
<p class="text-sm leading-relaxed mt-3">我们的空间不防顾客拍照——但它的设计目的，不是为了被拍照。<br />是为了让待在里面的人感到从容。</p>`,
    positive: `<p class="font-serif text-cream tracking-cn mb-3"><strong class="text-brass-bright">首店空间设计的三条铁律</strong>：</p>
<ol class="list-decimal pl-5 space-y-2">
<li><strong class="text-cream">不超过 4 种主色</strong>——黄铜 / 暗木 / 暗绿 / 微暖白</li>
<li><strong class="text-cream">不超过 50 dB 的背景音</strong>——低音量真实环境声 + 低音量自然声</li>
<li><strong class="text-cream">每平米至少 60 cm 的留白</strong>——人在里面要能舒展、能不撞到东西、能慢下来</li>
</ol>
<p class="mt-4 text-sm">任何一处空间设计破坏这三条，<br />就重新做。</p>`,
    closing: '好的空间不需要解释——它只需要让走进来的人，愿意呆一会儿。',
    afterBlock:
      '<p class="text-sm text-text-soft mt-paragraph">空间体系的展陈与动线专页 → <a href="/how/space" class="text-brass-mid hover:text-brass-bright border-b border-brass-mid/40">/how/space</a></p>',
  },
  {
    id: 'content',
    number: '03',
    titleCn: '内容观',
    titleEn: 'On Content',
    tagline: '我们诚实地走过问题，不假装有答案。',
    paragraphs: [
      '<p><strong class="text-cream">内容不是营销</strong></p>',
      '很多品牌做内容是为了「种草」——让你看完想买。<br />我们做内容不是为了这件事。',
      '我们做内容是因为：<br /><strong class="text-brass-bright">有些事，我们真的在想 · 真的在做 · 真的有体会。</strong>',
      '把它写下来，是因为不写就消失了。<br />有人愿意读、愿意回应、愿意一起走——这是惊喜，不是目的。',
      '<p><strong class="text-cream">我们写「问题」，不写「答案」</strong></p>',
      '我们这一代人面对的问题太多了——<br />关于工作、关于家庭、关于身份、关于该往哪里去。',
      '很多内容创作者擅长给「答案」——<br />「你应该这样」、「你应该那样」。',
      '我们不擅长这件事。<br />我们擅长的是：<strong class="text-brass-bright">诚实地写出问题是什么、我们怎么想、我们做了什么、做完之后又怎么想</strong>。',
      '把「走过问题」的过程写出来，比写「答案」更诚实。',
      '<p><strong class="text-cream">真实大于精致</strong></p>',
      '我们的文字会偶尔粗糙，<br />我们的照片会偶尔曝光不准，<br />我们的视频会偶尔有杂音——',
      '但每一条内容都是<strong class="text-brass-bright">真实做出来的</strong>。<br />不是 AI 生成的精修品 · 不是写给算法的关键词堆 · 不是给「目标用户画像」的精准营销。',
      '我们更愿意发一条粗糙但真实的内容，<br />而不是一条精致但空洞的内容。',
    ],
    negative: `<p class="font-serif text-lg text-cream tracking-cn mb-3"><strong class="text-cream">不做「为了流量而存在」的内容。</strong></p>
<p class="text-sm leading-relaxed">不蹭热点（除非热点和我们的事真的相关）；<br />不做「震惊体」标题；<br />不做「反转剧本」短视频；<br />不做「5 分钟教你 X 个 X」的清单文。</p>
<p class="text-sm leading-relaxed mt-3">如果某条内容的存在意义只是「获取流量」——<br />我们不会发它。</p>`,
    positive: `<p><strong class="text-brass-bright">公众号的发文节奏</strong>：</p>
<p class="text-sm">不定期发布。<br />每篇 3000-8000 字。<br />只在「真的有话说」的时候发。</p>
<p class="text-sm mt-3">宁可一个月不发，<br />也不发一篇「为了维持账号活跃度」的文章。</p>`,
    closing: '好的内容不需要追流量——它需要的是，写它的人真的在想这件事。',
    afterBlock:
      '<p class="text-sm text-text-soft mt-paragraph">相关：<a href="/notes" class="text-brass-mid hover:text-brass-bright border-b border-brass-mid/40">笔记</a>会逐步整理到本站。</p>',
  },
  {
    id: 'talent',
    number: '04',
    titleCn: '人才观',
    titleEn: 'On Talent',
    tagline: '我们优先招青年——青年不是年龄，是状态。',
    paragraphs: [
      '<p><strong class="text-cream">青年优先</strong></p>',
      '我们的招聘原则：<strong class="text-brass-bright">同等条件下，优先选青年</strong>。',
      '「青年」不是按年龄分——<br />我们见过 50 岁的青年，也见过 25 岁的中年。',
      '青年的特征是：<br />- <strong class="text-cream">愿意从头学一件事</strong><br />- <strong class="text-cream">不怕做不熟悉的事</strong><br />- <strong class="text-cream">对未来还有期待</strong>',
      '如果你符合这三条，你就是我们说的青年。<br />我们的工作室对青年永远开门。',
      '<p><strong class="text-cream">工坊师傅与店员的关系</strong></p>',
      '我们不分「管理层」和「执行层」。<br />工作室里只有两种角色：<strong class="text-brass-bright">做事的人</strong> 和 <strong class="text-brass-bright">判断事的人</strong>。',
      '廉澍是工坊的灵魂——做了近十年的实体店运营，熬过疫情。<br />他做的事 + 他做出的判断，构成了山海造物的工艺与产品基础。',
      '我们的店员、标本师、内容创作者——<br />每一个人都是「做事」和「判断」兼具的人。<br />我们不要「流程执行机器」，我们要「会思考的伙伴」。',
      `<p><strong class="text-cream">我们如何对待人</strong></p>
<p class="text-sm">我们的工作室：</p>
<ul class="list-none pl-0 space-y-2 text-sm text-text-soft mt-2">
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不卷加班</strong> —— 工作时间 9:30-18:30，超过 18:30 算加班 · 不鼓励</li>
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不画大饼</strong> —— 不说「未来上市了你能怎么怎么样」，只说「今年这一年你能怎么怎么样」</li>
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不搞奇怪的团建</strong> —— 不周末爬山，不晚上聚餐，不强迫参加</li>
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不省工资</strong> —— 同地区中等偏上水平 + 季度奖金 + 长期跟随的期权（公司化之后）</li>
</ul>
<p class="text-sm mt-4">但我们也对自己人有要求：</p>
<ul class="list-none pl-0 space-y-2 text-sm text-text-soft mt-2">
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不做表演式工作</strong> —— 不要装忙</li>
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不躲事</strong> —— 看到问题主动认领</li>
<li class="pl-6 relative"><span class="absolute left-0 top-2 w-2 h-px bg-brass-mid"></span><strong class="text-cream">不绕开真问题</strong> —— 内部讨论要直接 · 不要绕</li>
</ul>`,
    ],
    negative: `<p class="font-serif text-lg text-cream tracking-cn mb-3"><strong class="text-cream">不做「职业经理人式」的招聘。</strong></p>
<p class="text-sm leading-relaxed">我们不招「履历完美但没有热情」的人；<br />我们不招「什么都懂但什么都不深入」的人；<br />我们不招「短期来过渡的人」——除非他坦诚说「我就是来过渡的」。</p>
<p class="text-sm leading-relaxed mt-3">我们更愿意招一个「履历单薄但真心想做这件事」的青年，<br />而不是一个「履历漂亮但心不在这里」的中年。</p>`,
    positive: `<p><strong class="text-brass-bright">校园招聘启动</strong>：</p>
<p class="text-sm">2026 Q3 启动校园招聘——长春当地高校优先（吉林大学 / 东北师大 / 长春大学等）。</p>
<p class="text-sm mt-3">我们不只招相关专业的学生：<br />- 生物 / 美术 / 设计专业固然好；<br />- 文学 / 哲学 / 历史专业一样欢迎；<br />- 没有特殊专业但「想从头学」的学生最欢迎。</p>
<p class="text-sm mt-3">试用期不设门槛，只看一件事：<strong class="text-cream">你是不是真心想做这件事</strong>。</p>`,
    closing: '好的团队不需要 KPI 鞭策——它需要的是，每个人都在做自己愿意做的事。',
  },
  {
    id: 'pledge-view',
    number: '05',
    titleCn: '承诺观',
    titleEn: 'On Commitment',
    tagline: '我们对外的承诺，是会被违反时主动赔偿的事。',
    paragraphs: [
      '<p><strong class="text-cream">承诺不是宣传</strong></p>',
      '很多品牌做「公益宣传」——<br />「我们关爱地球」、「我们助力XX」——<br />但具体怎么做、做多少、什么时候做，往往说不清。',
      '我们不做这种「营销式公益」。',
      '我们的承诺有四个标准：',
      '<ol class="list-decimal pl-6 space-y-2 text-sm text-text-soft"><li><strong class="text-cream">写下来</strong>——白纸黑字在我们的官网/文档上</li><li><strong class="text-cream">有数字</strong>——具体到捐多少 / 给谁 / 什么时候</li><li><strong class="text-cream">可查证</strong>——年度发布透明报告</li><li><strong class="text-cream">会赔偿</strong>——做不到时主动公开 + 主动赔偿</li></ol>',
      '<p><strong class="text-cream">当下我们的三个承诺</strong></p>',
      '<p><strong class="text-brass-bright">一 · 1% 营收捐赠承诺</strong><br />每家城市门店年营收的 1%，捐赠给本地动物园或动植物保护基金。<br />2027 年 4 月发布首份《1% 承诺年度透明报告》。</p>',
      '<p><strong class="text-brass-bright">二 · AED 设备与急救能力</strong><br />每家正式门店常备 AED 设备 + 至少 2 名员工持有急救证书。<br />不只是装样子——是真的能用、真的会用。</p>',
      '<p><strong class="text-brass-bright">三 · 应急求助服务</strong><br />我们的门店对<strong class="text-cream">所有需要短暂避雨/避雪/休息/借电话</strong>的人开放。<br />不消费也可以进来坐一会儿。<br />这是城市里「陌生人的客厅」的小小一部分。</p>',
      '<p><strong class="text-cream">承诺会被违反吗</strong></p>',
      '会。',
      '可能因为团队疏忽，可能因为某次执行出错，可能因为我们没想到的情境。',
      '当违反发生时：',
      '<ol class="list-decimal pl-6 space-y-2 text-sm text-text-soft"><li><strong class="text-cream">主动公开</strong> —— 在官网/公众号发文说明</li><li><strong class="text-cream">主动赔偿</strong> —— 给受影响的人合理补偿</li><li><strong class="text-cream">修订流程</strong> —— 公开发布「如何避免再次发生」的改进方案</li></ol>',
      '承诺会被违反——这是真实的人和真实的组织都会发生的事。<br />但<strong class="text-brass-bright">有没有透明地处理违反的过程</strong>——这才是判断一个品牌底线的真正标准。',
    ],
    negative: `<p class="font-serif text-lg text-cream tracking-cn mb-3"><strong class="text-cream">不做「虚的承诺」。</strong></p>
<p class="text-sm leading-relaxed">不承诺「做最好的」、「做第一的」、「改变行业的」——<br />这些都是无法衡量的口号。</p>
<p class="text-sm leading-relaxed mt-3">我们只承诺<strong class="text-cream">可以被数字检验、被时间检验的事</strong>。</p>`,
    positive: `<p><strong class="text-brass-bright">承诺的年度复盘</strong>：</p>
<p class="text-sm">每年 4 月，我们在公众号发布一篇《承诺年度报告》，<br />逐项说明：</p>
<ul class="list-disc pl-5 space-y-1 text-sm text-text-soft mt-2">
<li>每个承诺当年的执行情况</li>
<li>任何违反了的事 + 我们怎么处理的</li>
<li>下一年承诺的更新（如果有）</li>
</ul>
<p class="text-sm mt-4">这不是任选的事，<br />是每年 4 月必须做的事。</p>`,
    closing: '好的承诺不需要漂亮——它需要的是，做不到的时候，你愿意承担后果。',
    afterBlock:
      '<p class="text-sm text-text-soft mt-paragraph text-center"><a href="#one-percent" class="text-brass-mid hover:text-brass-bright border-b border-brass-mid/40">↓ 1% 承诺执行全文</a></p>',
  },
  {
    id: 'view-compliance',
    number: '06',
    titleCn: '合规观',
    titleEn: 'Compliance',
    tagline: '合规不是限制——是让我们能心安做这件事 30 年的护身符。',
    highlight: 'coral',
    paragraphs: [
      '<p><strong class="text-cream">合规不是「做表面文章」</strong></p>',
      '我们做的是标本与自然物的经营。',
      '这件事涉及的法规非常多——<br />野生动植物保护法、CITES 公约、海关检疫法、文化用品管理条例、消防、卫生……',
      '这些法规存在，不是为了为难我们。<br />是为了：',
      '<ul class="list-disc pl-5 space-y-1 text-sm text-text-soft"><li>让自然不被无止境地索取</li><li>让消费者不被欺骗</li><li>让行业不被某些人毁掉</li></ul>',
      '我们做的事，必须<strong class="text-brass-bright">经得起监管的实地检查，也必须经得起媒体的随机询问</strong>。',
      '这不是说我们「完美合规」——<br />任何在中国做实体零售的人都知道这是不可能的承诺。',
      '但我们承诺：<strong class="text-coral-mid">任何不合规的事，一旦发现就立即纠正 · 不掩盖 · 不侥幸</strong>。',
      '<p><strong class="text-cream">合规需要建立体系，不能靠「侥幸」</strong></p>',
      '合规不是「偶尔做一次自查」，<br />而是一整套覆盖<strong class="text-cream">采购 / 凭证 / 流程 / 培训 / 应急</strong>的体系。',
      '我们已建立内部合规自查机制：<br /><strong class="text-brass-bright">70+ 项自查条目</strong>，覆盖 <strong class="text-brass-bright">7 大类</strong>——',
      `<pre class="mt-4 p-4 rounded-sm bg-ink-deep/60 border border-brass-mid/15 text-xs text-text-soft whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">A · 经营资质      （执照 / 经营范围 / 税务 / 场地）
B · 品类与来源    （昆虫 / 植物 / 矿石 / 贝壳 / 鸟羽 / 哺乳）
C · 物种合规      （保护名录 / CITES 公约 / 地方保护）
D · 采购与凭证    （供应商 / 进货 / 进口 / 检疫 / 采集）
E · 内部流程      （入库 / 档案 / 销售 / 盘点 / 异常 SOP）
F · 团队与培训    （培训 / 话术 / 媒体应对 / 客户投诉）
G · 风险事件预案  （监管 / 媒体 / 海关 / 律师 / 公关）</pre>`,
      '每 6 个月做一次完整自查。<br />任何「否」或「部分」项，必须在下次自查前闭环。',
      '<p><strong class="text-cream">合规是品牌信任的硬通货</strong></p>',
      '在未来 3-5 年，消费者会越来越关注「这家品牌真的合规吗」。',
      '随着监管趋严、信息透明度提升、消费者意识觉醒——<br />合规会成为品牌的<strong class="text-brass-bright">硬通货</strong>：',
      '<ul class="list-disc pl-5 space-y-1 text-sm text-text-soft"><li>做得好的品牌，会越走越远</li><li>蒙混过关的品牌，会被时代淘汰</li></ul>',
      '我们选择前一条路。<br />不是因为我们高尚，是因为这是<strong class="text-cream">唯一可持续的选择</strong>。',
    ],
    negative: `<ol class="list-decimal pl-5 space-y-2 text-sm leading-relaxed text-text-soft [&>li::marker]:text-coral-mid [&>li::marker]:font-semibold">
<li>不做任何中国国家一级保护动物的标本（任何形式）</li>
<li>不做任何国家二级保护动物的标本（除非有完整许可证）</li>
<li>不做任何 CITES 附录 I 物种</li>
<li>不做活体动物交易（任何品类）</li>
<li>不做来源不明的中国境内化石</li>
<li>不做无 CITES 许可的珊瑚 / 砗磲 / 玳瑁制品</li>
<li>不做野生鸟类标本（当前阶段建议）</li>
<li>不做哺乳动物标本（当前阶段建议）</li>
<li>不做不能追溯来源的任何标本</li>
<li>不参与任何「洗源」交易（合法外壳掩盖非法来源）</li>
</ol>
<p class="text-sm mt-4 leading-relaxed">这 10 条不是「建议」，是<strong class="text-coral-mid">红线</strong>。<br />触碰其中任何一条——立即下架 · 立即律师咨询 · 必要时公开说明。</p>`,
    positive: `<ol class="list-decimal pl-5 space-y-2 text-sm text-text-soft leading-relaxed [&>li::marker]:text-brass-bright [&>li::marker]:font-semibold">
<li>每件标本入库时登记完整来源信息（含物种学名 / 来源类型 / 供应商 / 入库日期 / 凭证编号）</li>
<li>每件展示/销售标本附「博物档案卡」（含来源 + 学名 + 凭证编号 + 制作日期）</li>
<li>每 6 个月做一次完整内部合规自查（覆盖 7 大类 70+ 项 · 自查表已文档化）</li>
<li>与常年法律顾问保持月度联系（定期更新法规变动 · 边界情境立即咨询）</li>
<li>监管来访 + 客户质疑 + 媒体询问的应对 SOP 已文档化（任何团队成员都知道遇到这些情境该怎么做）</li>
<li>边界情境立即启动律师咨询（不自己判断 · 不依赖经验 · 不侥幸 · 不拖延）</li>
</ol>
<p class="text-sm mt-4 leading-relaxed">这 6 项是<strong class="text-brass-bright">不能省略的</strong>——<br />任何想绕过其中一项的「高效」做法，都是侥幸。</p>`,
    closing: '<strong class="text-cream">好的合规不需要喊口号</strong>——它需要的是，把每一件标本的来源都说得清。',
  },
];
