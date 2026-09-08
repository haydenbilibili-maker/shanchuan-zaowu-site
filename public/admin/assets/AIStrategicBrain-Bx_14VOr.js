import{$t as e,An as t,Mn as n,On as r,Qt as i,Tn as a,Zt as o,_n as s,an as c,bn as l,hn as u,in as d,jn as f,ln as p,nn as m,on as h,r as g,rn as _,un as v,xn as y,yn as b}from"./element-plus-DU8uayx_.js";import{H as x,K as S,M as C,N as w,P as T,U as E,W as D,j as O}from"./index-ILfaiQfc.js";var k={class:`ai-strategic-brain`},A={class:`ai-header`},ee={class:`header-left`},te={class:`mode-switcher`},ne={class:`header-right`},re=[`title`],ie={key:0,class:`speaking-indicator`},ae={class:`ai-container`},oe={class:`panel-header`},se={class:`persona-search`},ce={class:`persona-list`},le=[`onClick`],ue={class:`persona-icon`},de={class:`persona-info`},fe={class:`persona-name`},pe={class:`persona-desc`},me={key:0,class:`persona-check`},he={class:`chat-area`},ge={key:0,class:`chat-header`},_e={class:`debate-controls`},ve={key:0,class:`msg-header`},ye=[`innerHTML`],be=[`onClick`],xe={key:0,class:`chat-item ai-msg`},Se={class:`chat-bubble bubble-ai thinking`},Ce={class:`input-area`},we={class:`quick-actions`},Te={class:`weekly-report-section`},j=x({__name:`AIStrategicBrain`,props:{feature:{type:Object,default:null}},emits:[`close`],setup(x,{emit:j}){let Ee=x,De=j,M=m(()=>!!Ee.feature),N=r([{role:`ai`,content:`<strong>AI 战略顾问:</strong> 系统已就绪 (API Connected)。<br>全量业务数据已加载。<br>可以选择单个角色咨询，或启动智能博弈辩论模式。`,rawText:`系统已就绪，全量业务数据已加载。可以选择单个角色咨询，或启动智能博弈辩论模式。`}]),P=r(``),F=r(`cfo`),I=r(`chat`),L=r(!1),R=r(!1),z=r(``),B=r(!1),V=r(null),H=r(!0),U=r(``),W=r(!1),G=r(``),K=r(``),q=r([`cfo`,`cmo`,`coo`]),J=r(!1),Y=r(null),Oe={default:{rate:1,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunyang`,`Microsoft Yunxi`,`Microsoft Yunfeng`,`Microsoft Yunjian`,`Google 普通话（中国大陆）`]},cfo:{rate:.95,pitch:.98,volume:.9,preferredVoices:[`Microsoft Yunyang`,`Microsoft Yunfeng`,`Microsoft Yunjian`,`Google 普通话（中国大陆）`]},cmo:{rate:1,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunxi`,`Microsoft Yunjian`,`Microsoft Yunyang`,`Google 普通话（中国大陆）`]},coo:{rate:1,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunyang`,`Microsoft Yunxi`,`Google 普通话（中国大陆）`]},designer:{rate:.98,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunxi`,`Microsoft Yunjian`,`Microsoft Yunyang`,`Google 普通话（中国大陆）`]},visual:{rate:1,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunxi`,`Microsoft Yunjian`,`Microsoft Yunyang`,`Google 普通话（中国大陆）`]},store:{rate:.98,pitch:.98,volume:.9,preferredVoices:[`Microsoft Yunyang`,`Microsoft Yunfeng`,`Microsoft Yunjian`,`Google 普通话（中国大陆）`]},online:{rate:1,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunxi`,`Microsoft Yunjian`,`Microsoft Yunyang`,`Google 普通话（中国大陆）`]},private:{rate:.98,pitch:1,volume:.9,preferredVoices:[`Microsoft Yunxi`,`Microsoft Yunjian`,`Microsoft Yunyang`,`Google 普通话（中国大陆）`]}},X=(...e)=>{console.log(`[AI Debug]`,...e)},ke=async(e=!0)=>{if(X(`fetchSiteData 开始执行`,{showMessage:e,hasCache:!!Y.value}),Y.value&&Y.value.fetchTime&&Date.now()-Y.value.fetchTime<300*1e3)return X(`使用缓存数据`,Y.value),Y.value;try{X(`开始拉取全站数据（CDN）...`),e&&g.info(`正在获取全站数据...`);let t=new Date,n=new Date(t);n.setDate(t.getDate()-t.getDay()),n.setHours(0,0,0,0);let r=n.getTime(),i=new Date(t);i.setDate(t.getDate()-7);let a=i.getTime();X(`开始并行获取数据...`,{weekStartTime:r,weekAgoTime:a});let o=[],s=[],c=[],l=[],u=[],d=[],f=0,p=0,m=0,h=0,_=0,v=0;try{let e=await Promise.allSettled([S(E.PRODUCTS,{limit:1e3}).catch(e=>(X(`获取products失败`,e),[])),S(E.ORDERS,{orderBy:{field:`createTime`,order:`desc`},limit:500}).catch(e=>(X(`获取orders失败`,e),[])),S(E.USERS,{limit:1e3}).catch(e=>(X(`获取users失败`,e),[])),S(E.ACTIVITIES,{limit:100}).catch(e=>(X(`获取activities失败`,e),[])),S(E.BOOKINGS,{limit:500}).catch(e=>(X(`获取bookings失败`,e),[])),S(E.COUPONS,{limit:500}).catch(e=>(X(`获取coupons失败`,e),[])),D(E.PRODUCTS).catch(e=>(X(`统计products失败`,e),0)),D(E.ORDERS).catch(e=>(X(`统计orders失败`,e),0)),D(E.USERS).catch(e=>(X(`统计users失败`,e),0)),D(E.ACTIVITIES).catch(e=>(X(`统计activities失败`,e),0)),D(E.BOOKINGS).catch(e=>(X(`统计bookings失败`,e),0)),D(E.COUPONS).catch(e=>(X(`统计coupons失败`,e),0))]);X(`数据获取结果:`,e.map((e,t)=>({index:t,status:e.status,value:e.status===`fulfilled`?Array.isArray(e.value)?e.value.length:e.value:e.reason}))),o=e[0].status===`fulfilled`&&e[0].value||[],s=e[1].status===`fulfilled`&&e[1].value||[],c=e[2].status===`fulfilled`&&e[2].value||[],l=e[3].status===`fulfilled`&&e[3].value||[],u=e[4].status===`fulfilled`&&e[4].value||[],d=e[5].status===`fulfilled`&&e[5].value||[],f=e[6].status===`fulfilled`?e[6].value||0:o.length,p=e[7].status===`fulfilled`?e[7].value||0:s.length,m=e[8].status===`fulfilled`?e[8].value||0:c.length,h=e[9].status===`fulfilled`?e[9].value||0:l.length,_=e[10].status===`fulfilled`?e[10].value||0:u.length,v=e[11].status===`fulfilled`?e[11].value||0:d.length,X(`数据解析完成`,{products:o.length,orders:s.length,users:c.length,activities:l.length,bookings:u.length,coupons:d.length})}catch(e){X(`数据获取过程出错`,e)}let y=s.filter(e=>{try{return(e.createTime||e._createTime||e.create_time||0)>=a}catch(t){return X(`订单时间解析失败`,e,t),!1}});X(`本周订单数:`,y.length);let b=c.filter(e=>{try{return(e.createTime||e._createTime||e.create_time||e.registerTime||0)>=a}catch(t){return X(`用户时间解析失败`,e,t),!1}});X(`本周用户数:`,b.length);let x=0;try{x=y.filter(e=>{let t=e.status||e.orderStatus||``;return t===`paid`||t===`completed`||t===`已支付`||t===`已完成`}).reduce((e,t)=>{try{return e+(parseFloat(t.totalAmount)||parseFloat(t.total_amount)||parseFloat(t.amount)||parseFloat(t.price)||0)}catch(n){return X(`订单金额解析失败`,t,n),e}},0),X(`本周营收:`,x)}catch(e){X(`财务数据计算失败`,e),x=0}let C=o.filter(e=>(e.stock||0)<3&&e.stock>0),w=o.filter(e=>(e.stock||0)===0),T=o.reduce((e,t)=>e+(t.stock||0)*(parseFloat(t.costPrice)||parseFloat(t.price)*.6||0),0),O=c.filter(e=>(e.lastActiveTime||e.updateTime||e._updateTime||0)>=a),k=l.filter(e=>{let t=Date.now(),n=e.startTime||e.date||0,r=e.endTime||e.date||0;return n<=t&&r>=t}),A={products:{total:f,items:o},orders:{total:p,items:s,weekly:y},users:{total:m,items:c,weekly:b,active:O},activities:{total:h,items:l,active:k},bookings:{total:_,items:u},coupons:{total:v,items:d},finance:{weeklyRevenue:x,weeklyOrdersCount:y.length,averageOrderValue:y.length>0?x/y.length:0,totalRevenue:x,totalProfit:x*.55},inventory:{totalProducts:f,lowStock:C.length,outOfStock:w.length,totalValue:T,lowStockProducts:C,outOfStockProducts:w},members:{total:m,weeklyNew:b.length,active:O.length,activeRate:m>0?parseFloat((O.length/m*100).toFixed(2)):0},activitiesData:{total:h,active:k.length,upcoming:l.filter(e=>(e.startTime||e.date||0)>Date.now()).length},timeRange:{weekStart:r,weekAgo:a,now:Date.now()},fetchTime:Date.now()};return Y.value=A,X(`数据构建完成`,A),e&&g.success(`全站数据获取成功 (商品${f}件, 订单${p}单, 用户${m}人)`),A}catch(e){X(`获取全站数据失败`,e),console.error(`❌ 获取全站数据失败:`,e);let t=e.message||e.toString()||`未知错误`;return g.error(`获取全站数据失败: ${t}`),Y.value={products:{total:0,items:[]},orders:{total:0,items:[],weekly:[]},users:{total:0,items:[],weekly:[],active:[]},activities:{total:0,items:[],active:[]},bookings:{total:0,items:[]},coupons:{total:0,items:[]},finance:{weeklyRevenue:0,weeklyOrdersCount:0,averageOrderValue:0,totalRevenue:0,totalProfit:0},inventory:{totalProducts:0,lowStock:0,outOfStock:0,totalValue:0,lowStockProducts:[],outOfStockProducts:[]},members:{total:0,weeklyNew:0,active:0,activeRate:0},activitiesData:{total:0,active:0,upcoming:0},timeRange:{weekStart:0,weekAgo:0,now:Date.now()},fetchTime:Date.now()},null}},Z=async e=>{J.value=!0;try{g.info(`正在获取数据并生成周报...`);let t=await ke(!0);if(!t){g.error(`数据获取失败，无法生成周报`),J.value=!1;return}let n=``,r=new Date,i=new Date(r);i.setDate(r.getDate()-r.getDay());let a=new Date(i);a.setDate(i.getDate()+6);let o=`${i.getMonth()+1}月${i.getDate()}日 - ${a.getMonth()+1}月${a.getDate()}日`;switch(e){case`finance`:n=`请生成${o}的财务周报。基于以下数据：
        
财务数据：
- 本周营收：¥${t.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${t.finance.weeklyOrdersCount}单
- 平均客单价：¥${t.finance.averageOrderValue.toFixed(2)}
- 订单总数：${t.orders.total}

订单状态分布：
${t.orders.items.slice(0,50).reduce((e,t)=>{let n=t.status||`unknown`;return e[n]=(e[n]||0)+1,e},{})}

请生成一份专业的财务周报，包括：
1. 本周财务总结
2. 关键指标分析
3. 对比分析（如有历史数据）
4. 风险提示
5. 下周财务建议`;break;case`operations`:n=`请生成${o}的运营周报。基于以下数据：
        
运营数据：
- 商品总数：${t.products.total}
- 订单总数：${t.orders.total}
- 本周新增订单：${t.orders.weekly.length}
- 活动总数：${t.activities.total}
- 进行中活动：${t.activitiesData.active}
- 预约总数：${t.bookings.total}

请生成一份专业的运营周报，包括：
1. 本周运营总结
2. 关键运营指标
3. 活动效果分析
4. 运营问题识别
5. 下周运营计划`;break;case`inventory`:n=`请生成${o}的库存管理周报。基于以下数据：
        
库存数据：
- 商品总数：${t.inventory.totalProducts}
- 库存总价值：¥${t.inventory.totalValue.toFixed(2)}
- 低库存商品：${t.inventory.lowStock}件
- 缺货商品：${t.inventory.outOfStock}件

低库存商品列表：
${t.inventory.lowStockProducts.slice(0,10).map(e=>`- ${e.title} (库存: ${e.stock})`).join(`
`)}

缺货商品列表：
${t.inventory.outOfStockProducts.slice(0,10).map(e=>`- ${e.title}`).join(`
`)}

请生成一份专业的库存管理周报，包括：
1. 库存概况
2. 低库存和缺货预警
3. 库存周转分析
4. 补货建议
5. 库存优化方案`;break;case`members`:n=`请生成${o}的会员周报。基于以下数据：
        
会员数据：
- 会员总数：${t.members.total}
- 本周新增会员：${t.members.weeklyNew}
- 活跃会员：${t.members.active}
- 活跃率：${t.members.activeRate}%

用户增长趋势：
本周新增${t.members.weeklyNew}位会员

请生成一份专业的会员周报，包括：
1. 会员增长分析
2. 活跃度分析
3. 会员行为洞察
4. 会员运营建议
5. 会员留存策略`;break;case`activities`:n=`请生成${o}的活动周报。基于以下数据：
        
活动数据：
- 活动总数：${t.activitiesData.total}
- 进行中活动：${t.activitiesData.active}
- 即将开始：${t.activitiesData.upcoming}

活动列表：
${t.activities.items.slice(0,10).map(e=>`- ${e.title} (状态: ${e.status||`active`})`).join(`
`)}

请生成一份专业的活动周报，包括：
1. 活动执行情况
2. 活动效果评估
3. 参与度分析
4. 活动优化建议
5. 下周活动规划`;break;case`all`:n=`请生成${o}的全站综合周报。基于以下完整数据：
        
=== 财务数据 ===
- 本周营收：¥${t.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${t.finance.weeklyOrdersCount}单
- 平均客单价：¥${t.finance.averageOrderValue.toFixed(2)}

=== 运营数据 ===
- 商品总数：${t.products.total}
- 订单总数：${t.orders.total}
- 活动总数：${t.activities.total}
- 进行中活动：${t.activitiesData.active}

=== 库存数据 ===
- 库存总价值：¥${t.inventory.totalValue.toFixed(2)}
- 低库存商品：${t.inventory.lowStock}件
- 缺货商品：${t.inventory.outOfStock}件

=== 会员数据 ===
- 会员总数：${t.members.total}
- 本周新增：${t.members.weeklyNew}
- 活跃会员：${t.members.active}
- 活跃率：${t.members.activeRate}%

=== 活动数据 ===
- 进行中活动：${t.activitiesData.active}
- 即将开始：${t.activitiesData.upcoming}

请生成一份全面的全站综合周报，包括：
1. 执行摘要
2. 各模块数据概览
3. 关键指标分析
4. 问题与风险识别
5. 下周重点工作建议
6. 数据可视化建议`;break}P.value=n,await $(),g.success(`周报生成完成`)}catch(e){console.error(`生成周报失败:`,e),g.error(`生成周报失败: `+(e.message||`未知错误`))}finally{J.value=!1}},Q={cfo:{name:`严谨 CFO`,icon:`💰`,color:`#38bdf8`,shortDesc:`财务分析专家`,thinkingMsg:`正在分析财务数据`,systemPrompt:`你是山海造物标本艺术馆的CFO（首席财务官）。你的职责是：
- 提供严谨的财务分析和风险评估
- 基于数据进行决策建议
- 关注成本控制、利润优化和现金流管理
- 分析业务模式的财务可行性

当前业务数据：
- 月营收：¥130k-200k（波动性高）
- 行业规模：¥120亿（CAGR +22%）
- 目标：建立可持续的盈利模式

回答要求：基于数据、逻辑严谨、条理清晰，提供可执行的财务建议。`},cmo:{name:`创意 CMO`,icon:`🎯`,color:`#10b981`,shortDesc:`营销策略专家`,thinkingMsg:`正在构思创意方案`,systemPrompt:`你是山海造物标本艺术馆的CMO（首席营销官）。你的职责是：
- 制定品牌传播和营销策略
- 设计创意营销方案
- 分析用户增长和留存
- 制定内容营销计划

品牌定位：自然美学、手作体验、教育价值
目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
核心优势：标本艺术化、沉浸式体验、知识赋能

回答要求：富有创意、洞察深入、可执行性强，结合社交媒体和内容营销。`},coo:{name:`运营 COO`,icon:`⚙️`,color:`#f59e0b`,shortDesc:`运营管理专家`,thinkingMsg:`正在制定运营策略`,systemPrompt:`你是山海造物标本艺术馆的COO（首席运营官）。你的职责是：
- 优化门店运营效率和用户体验
- 设计产品线和库存管理
- 规划供应链和供应商管理
- 制定运营标准和SOP

当前运营状况：
- 单店模型：已验证可行
- 手作课程转化率：28.4%
- 核心挑战：非标品管理、供应链风险、易碎物流

回答要求：注重实操、系统性思考、平衡成本与体验，提供可落地的运营方案。`},designer:{name:`标本设计师`,icon:`🦋`,color:`#8b5cf6`,shortDesc:`产品设计专家`,thinkingMsg:`正在构思设计方案`,systemPrompt:`你是山海造物标本艺术馆的标本设计师。你的职责是：
- 设计标本产品的艺术呈现方式
- 平衡科学准确性与美学价值
- 考虑标本保存和展示的技术要求
- 创新标本与装饰的结合方式

专业背景：
- 熟悉昆虫、植物、海洋生物的标本制作工艺
- 了解树脂封装、标本画、生态缸等呈现形式
- 关注自然美学与现代家居的结合

设计理念：科学严谨 + 艺术美感 + 教育价值

回答要求：从设计角度思考问题，注重美学、工艺和用户体验的结合。`},visual:{name:`视觉设计师`,icon:`🎨`,color:`#ec4899`,shortDesc:`视觉传达专家`,thinkingMsg:`正在设计视觉方案`,systemPrompt:`你是山海造物标本艺术馆的视觉设计师。你的职责是：
- 设计品牌视觉识别系统
- 创建营销素材和宣传视觉
- 优化产品摄影和展示效果
- 设计门店视觉体验

设计风格：
- 自然美学：温暖、有机、真实
- 黑金质感：高端、神秘、品质感
- 教育导向：清晰、专业、启发思考

专业技能：
- 品牌VI设计、包装设计、空间视觉设计
- 摄影构图、色彩搭配、版面设计
- 数字化视觉、社交媒体视觉

回答要求：从视觉传达角度思考，注重品牌一致性、用户体验和视觉冲击力。`},store:{name:`门店营销师`,icon:`🏪`,color:`#14b8a6`,shortDesc:`门店运营专家`,thinkingMsg:`正在制定门店策略`,systemPrompt:`你是山海造物标本艺术馆的门店营销师。你的职责是：
- 设计门店体验流程和空间布局
- 制定门店促销和活动方案
- 优化店员服务标准和话术
- 提升进店转化和客单价

门店特色：
- 沉浸式体验：标本展示、手作工坊、知识讲解
- 教育属性：自然科普、亲子互动、学习价值
- 高客单价：艺术价值、收藏价值、情感价值

核心挑战：
- 如何将体验转化为销售
- 如何提高复购率
- 如何处理易碎品的展示

回答要求：从门店运营实战角度思考，注重可执行性、效果可测量性和用户体验。`},online:{name:`线上流量运营`,icon:`📱`,color:`#f97316`,shortDesc:`流量增长专家`,thinkingMsg:`正在分析流量数据`,systemPrompt:`你是山海造物标本艺术馆的线上流量运营。你的职责是：
- 制定全平台流量获取策略（抖音、小红书、淘宝、微信）
- 分析流量转化漏斗和用户行为
- 优化内容投放和广告ROI
- 设计用户增长活动和裂变机制

流量渠道：
- 内容平台：小红书种草、抖音短视频、B站科普
- 电商平台：淘宝、京东、抖音小店
- 社交平台：微信群、朋友圈、视频号

核心指标：
- 获客成本（CAC）
- 转化率（CTR、CVR）
- 用户生命周期价值（LTV）
- ROI

回答要求：从流量运营角度思考，注重数据驱动、成本控制和增长效率。`},private:{name:`私域运营`,icon:`👥`,color:`#06b6d4`,shortDesc:`私域增长专家`,thinkingMsg:`正在设计私域策略`,systemPrompt:`你是山海造物标本艺术馆的私域运营。你的职责是：
- 构建和管理微信私域生态（个人号、社群、企业微信）
- 设计用户分层和精准运营策略
- 策划社群活动和会员体系
- 提升用户复购和口碑传播

私域价值：
- 降低获客成本
- 提高用户粘性和复购率
- 建立品牌忠诚度
- 收集用户反馈和数据

运营策略：
- 内容运营：知识分享、产品故事、自然科普
- 活动运营：限时优惠、拼团活动、会员专享
- 服务运营：一对一咨询、售后服务、个性化推荐

回答要求：从私域运营角度思考，注重用户关系、社群价值和长期价值。`}},Ae=m(()=>Q[F.value]||Q.cfo),je=m(()=>{if(!U.value)return Q;let e=U.value.toLowerCase();return Object.fromEntries(Object.entries(Q).filter(([t,n])=>n.name.toLowerCase().includes(e)||n.shortDesc.toLowerCase().includes(e)))}),Me={diagnosis:{icon:`📊`,label:`经营诊断报告`},copy:{icon:`✍️`,label:`小红书种草文案`},risk:{icon:`⚠️`,label:`风险评估分析`},marketing:{icon:`📢`,label:`营销方案制定`},strategy:{icon:`🎯`,label:`战略规划建议`},data:{icon:`📈`,label:`数据分析洞察`},design:{icon:`🎨`,label:`产品设计方案`},visual:{icon:`🖼️`,label:`视觉设计建议`},store:{icon:`🏪`,label:`门店营销方案`},online:{icon:`📱`,label:`流量获取策略`},private:{icon:`👥`,label:`私域运营方案`}},Ne=e=>{I.value===`chat`&&(F.value=e,g.success(`已切换到${Q[e].name}`))},Pe=()=>C(N.value.slice(-10).map(e=>({role:e.role===`ai`?`assistant`:e.role,content:e.rawText||e.content.replace(/<[^>]*>/g,``)}))),$=async(e=0,t=!1,n=null,r=null)=>{if(e===0){if(!P.value.trim()&&!n){g.warning(`请输入指令`);return}n||=P.value.trim(),N.value.push({role:`user`,content:n}),P.value=``}if(!n||!String(n).trim()){let e=N.value.length>0?[...N.value].reverse().find(e=>e.role===`user`):null;if(e&&e.content)n=e.content;else{g.warning({message:`请输入问题或指令`,duration:2e3});return}}L.value=!0,await u(),Ve();try{let e=r?Q[r]:Ae.value,i=Pe(),a=``;if(!J.value&&(n.includes(`数据`)||n.includes(`分析`)||n.includes(`统计`)||n.includes(`营收`)||n.includes(`订单`)||n.includes(`库存`)||n.includes(`会员`)||n.includes(`战略`)||n.includes(`规划`)||n.includes(`竞品`)||n.includes(`产业链`)||n.includes(`门店`)))try{let e=await ke(!1);e&&(a=`\n\n=== 全站实时数据（供参考）===
财务：本周营收¥${e.finance.weeklyRevenue.toFixed(2)}，订单${e.finance.weeklyOrdersCount}单，平均客单价¥${e.finance.averageOrderValue.toFixed(2)}
库存：总价值¥${e.inventory.totalValue.toFixed(2)}，低库存${e.inventory.lowStock}件，缺货${e.inventory.outOfStock}件
会员：总数${e.members.total}，本周新增${e.members.weeklyNew}，活跃${e.members.active}（活跃率${e.members.activeRate}%）
活动：总数${e.activitiesData.total}，进行中${e.activitiesData.active}，即将开始${e.activitiesData.upcoming}
订单：总数${e.orders.total}，本周${e.orders.weekly.length}
商品：总数${e.products.total}

=== 战略参考数据 ===
行业规模：2024年市场规模约¥85亿，CAGR 22.3%，预计2027年达到¥180亿
产品结构：引流款（50%）、利润款（40%）、形象款（10%）
流量渠道：线下门店CAC¥80 ROI 3.5x，小红书CAC¥120 ROI 2.8x，抖音CAC¥150 ROI 2.2x，私域CAC¥30 ROI 5.0x
盈利模型：当前月均订单150单，客单价¥680，毛利率55%，固定成本¥8万
3年规划：2025基础夯实年，2026扩张增长年，2027品牌提升年，目标年营收¥2000万+
`)}catch(e){console.warn(`获取数据失败，但不影响回答:`,e)}let o=T(n,{persona:e.systemPrompt,data:a}),s=await w(i.length>0?n:`${e.systemPrompt}\n\n用户问题：${o}${a}`,{usePro:t,temperature:r===`cfo`?.7:.9,maxOutputTokens:2048,useCache:!0,systemInstruction:e.systemPrompt+`

你可以访问全站实时数据来回答用户问题。如果用户询问数据相关的问题，请提供准确的数据分析和洞察。`,conversationHistory:i.length>0?i:[]});if(s){let e=O.parse(s);N.value.push({role:`ai`,content:e,rawText:s,persona:r||F.value}),t&&g.success(`已自动切换到备选模型`)}else throw Error(`Invalid response format`)}catch(e){console.error(`AI请求失败:`,e);let t=e.message||`未知错误`;g.error(`AI请求失败: ${t}`),N.value.push({role:`ai`,content:`抱歉，连接失败。<br><small style="color: #888;">错误: ${t}</small>`,rawText:`抱歉，连接失败。错误: ${t}`,persona:r||F.value})}finally{L.value=!1,await u(),Ve()}},Fe=async()=>{if(!G.value||G.value===`custom`&&!K.value){g.warning(`请选择或输入辩论主题`);return}if(q.value.length<2){g.warning(`至少需要选择2个角色参与辩论`);return}W.value=!0;let e=G.value===`custom`?K.value:G.value;N.value.push({role:`user`,content:`开始智能博弈辩论：${e}`});for(let t of q.value){if(!W.value)break;await $(0,!1,`请针对主题"${e}"发表你的观点和立场。作为${Q[t].name}，请从你的专业角度分析这个问题，提出你的观点、理由和建议。你可以：
1. 表达明确立场
2. 提供专业分析和数据支持
3. 提出可能的担忧或挑战
4. 与其他角色的观点形成对比（如果已有其他观点）

保持专业但可以有一定的辩论色彩，让讨论更有深度。`,t),await new Promise(e=>setTimeout(e,1e3))}W.value&&await $(0,!1,`请对以上关于"${e}"的辩论进行总结，提炼各方的核心观点，找出共识和分歧，并给出综合建议。`,`cfo`),W.value=!1},Ie=()=>{W.value=!1,g.info(`辩论已停止`)},Le=e=>{let t=new Date,n={diagnosis:`生成一份全面的经营诊断报告，包括当前运营状况、主要问题、改进建议。报告标题为《山海造物标本艺术馆经营诊断报告》。报告元信息请务必使用：报告日期：${`${t.getFullYear()}年${t.getMonth()+1}月${t.getDate()}日`}；报告对象：山海造物管理层；报告撰写：AI战略顾问。`,copy:`为标本艺术馆"山海造物"写一段小红书种草文案，突出自然美学和手作体验。`,risk:`评估当前业务模式的主要风险点，并提供应对策略。`,marketing:`制定一份针对自然教育品牌的营销推广方案。`,strategy:`基于当前业务数据，制定未来6-12个月的战略规划建议。`,data:`分析当前业务数据，提供数据洞察和增长机会识别。`,design:`针对标本产品设计，提供创新设计方案和建议。`,visual:`针对品牌视觉设计，提供视觉传达方案和建议。`,store:`针对门店营销，提供门店运营和营销方案。`,online:`针对线上流量获取，制定流量增长策略。`,private:`针对私域运营，制定私域增长和运营方案。`};if(n[e]){let t=n[e];P.value=t,$(0,!1,t)}},Re=()=>{g.info(`正在跳转到AI智能中心...`),window.dispatchEvent(new CustomEvent(`switch-tab`,{detail:`12`}))},ze=()=>{if(M.value){De(`close`);return}Re()},Be=()=>{N.value=[{role:`ai`,content:`<strong>AI 战略顾问:</strong> 对话历史已清空。系统已重新就绪。`,rawText:`对话历史已清空。系统已重新就绪。`}],g.success(`对话历史已清空`)},Ve=()=>{V.value&&u(()=>{V.value.scrollTop=V.value.scrollHeight})},He=e=>{e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),P.value.trim()&&!L.value&&!W.value&&$())},Ue=async()=>{try{X(`测试API连接...`),await w(`请回复“ok”，用于测试战略智脑统一 AI 调用链路。`,{useCache:!1,maxOutputTokens:16,temperature:.1}),X(`✓ API连接成功`)}catch(e){X(`⚠️ API连接测试异常:`,e?.message||e)}},We=async(e,t=null)=>{try{if(R.value&&z.value===e){R.value=!1,z.value=``,window.speechSynthesis&&window.speechSynthesis.cancel();return}if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){g.warning(`您的浏览器不支持语音合成功能`),R.value=!1,z.value=``,B.value=!1;return}window.speechSynthesis.speaking&&window.speechSynthesis.cancel(),R.value=!0,z.value=e,B.value=!0;let t=e.replace(/<[^>]*>/g,``).replace(/&nbsp;/g,` `).replace(/&amp;/g,`&`).replace(/&lt;/g,`<`).replace(/&gt;/g,`>`).replace(/&quot;/g,`"`).replace(/【.*?】/g,``).replace(/\[.*?\]/g,``).replace(/\s+/g,` `).trim();if(!t||t.length===0){R.value=!1,z.value=``,B.value=!1;return}let n=window.speechSynthesis.getVoices();n.length===0&&(await new Promise(e=>{let t=()=>{n=window.speechSynthesis.getVoices(),n.length>0?e():setTimeout(t,100)};window.speechSynthesis.onvoiceschanged=()=>{n=window.speechSynthesis.getVoices(),e()},setTimeout(()=>{n.length===0?t():e()},100)}),n=window.speechSynthesis.getVoices());let r=e=>(e.name||``).toLowerCase(),i=n.filter(e=>e.lang&&e.lang.includes(`zh`)),a=null,o=i.filter(e=>{let t=r(e);return t.includes(`neural`)||t.includes(`natural`)||t.includes(`online`)});if(o.length>0&&(a=o.find(e=>r(e).includes(`yunxi`))||o.find(e=>r(e).includes(`yunyang`))||o.find(e=>r(e).includes(`xiaoxiao`))||o[0],console.log(`[语音] 选择神经/自然语音: ${a.name}`)),!a){for(let e of[`Yunxi`,`Microsoft Yunxi`,`Yunyang`,`Microsoft Yunyang`,`Xiaoxiao`,`Microsoft Xiaoxiao`,`Yaoyao`,`Microsoft Yaoyao`,`Huihui`,`Microsoft Huihui`,`Xiaoyi`,`Microsoft Xiaoyi`,`Google 普通话`,`Google 中文`,`Kangkang`,`Microsoft Kangkang`])if(a=i.find(t=>r(t).includes(e.toLowerCase())),a){console.log(`[语音] 选择语音: ${a.name}`);break}}if(!a){let e=i.filter(e=>{let t=r(e);return t.includes(`yaoyao`)||t.includes(`xiaoxiao`)||t.includes(`huihui`)||t.includes(`xiaoyi`)||t.includes(`xiaoyu`)});e.length>0&&(a=e[0],console.log(`[语音] 选择女声: ${a.name}`))}a||(a=i.find(e=>e.name&&r(e).includes(`microsoft`))||i.find(e=>e.name&&r(e).includes(`google`))||i[0],a&&console.log(`[语音] 选择备用: ${a.name}`));let s=new SpeechSynthesisUtterance(t);s.lang=`zh-CN`,s.rate=.86,s.pitch=1,s.volume=.86,a&&(s.voice=a,console.log(`[语音] 使用语音: ${a.name}, rate: ${s.rate}, pitch: ${s.pitch}`)),s.onstart=()=>{console.log(`▶️ 语音播放开始`),R.value=!0,B.value=!0},s.onend=()=>{R.value=!1,z.value=``,B.value=!1},s.onerror=e=>{console.error(`语音播报错误:`,e),R.value=!1,z.value=``,B.value=!1};try{window.speechSynthesis.speak(s)}catch(e){console.error(`调用speak失败:`,e),R.value=!1,z.value=``,B.value=!1}}catch(e){console.error(`语音播报异常:`,e),R.value=!1,z.value=``,B.value=!1}};return s(()=>{if(window.speechSynthesis){let e=()=>{let e=window.speechSynthesis.getVoices().filter(e=>{let t=e.lang.toLowerCase();return t.includes(`zh`)||t.includes(`cn`)||t.includes(`chinese`)});X(`📢 可用中文语音列表:`,e.map(e=>({name:e.name,lang:e.lang,default:e.default,localService:e.localService}))),X(`🎭 各角色语音配置:`),Object.entries(Oe).forEach(([t,n])=>{if(t!==`default`&&n.preferredVoices){let r=n.preferredVoices.filter(t=>e.some(e=>{let n=e.name.toLowerCase(),r=t.toLowerCase();return n.includes(r)||r.includes(n)}));r.length>0&&X(`  ${t}:`,{voices:r.join(`, `),rate:n.rate,pitch:n.pitch,volume:n.volume})}})};e(),window.speechSynthesis.onvoiceschanged=e,setTimeout(e,1e3)}Ue()}),(r,s)=>{let u=y(`el-input`),m=y(`el-button`),g=y(`el-option`),x=y(`el-select`),S=y(`el-divider`);return b(),h(`div`,k,[_(`div`,A,[_(`div`,ee,[s[15]||=_(`h2`,{class:`title`},`✦ AI 战略智脑`,-1),_(`div`,te,[_(`button`,{onClick:s[0]||=e=>I.value=`chat`,class:t([`mode-btn`,I.value===`chat`?`active`:``])},` 💬 单角色咨询 `,2),_(`button`,{onClick:s[1]||=e=>I.value=`debate`,class:t([`mode-btn`,I.value===`debate`?`active`:``])},` 🗣️ 智能博弈辩论 `,2)])]),_(`div`,ne,[_(`button`,{onClick:ze,class:`tool-center-btn`,title:M.value?`关闭战略智脑`:`前往AI工具中心`},n(M.value?`关闭工作台`:`🛠️ 工具中心`),9,re),_(`button`,{onClick:s[2]||=e=>H.value=!H.value,class:t([`persona-toggle-btn`,{active:H.value}])},n(H.value?`隐藏`:`显示`)+`角色面板 `,3),_(`button`,{onClick:Be,class:`clear-btn`,title:`清空对话历史`},` 🗑️ 清空 `),R.value?(b(),h(`div`,ie,`🔊 正在播报...`)):c(``,!0)])]),_(`div`,ae,[_(`div`,{class:t([`persona-panel`,{"panel-hidden":!H.value}])},[_(`div`,oe,[s[16]||=_(`h3`,null,`角色选择`,-1),_(`div`,se,[v(u,{modelValue:U.value,"onUpdate:modelValue":s[3]||=e=>U.value=e,placeholder:`搜索角色...`,size:`small`,clearable:``},null,8,[`modelValue`])])]),_(`div`,ce,[(b(!0),h(e,null,l(je.value,(e,r)=>(b(),h(`div`,{key:r,onClick:e=>Ne(r),class:t([`persona-card`,F.value===r?`active`:``])},[_(`div`,ue,n(e.icon),1),_(`div`,de,[_(`div`,fe,n(e.name),1),_(`div`,pe,n(e.shortDesc),1)]),F.value===r?(b(),h(`div`,me,`✓`)):c(``,!0)],10,le))),128))])],2),_(`div`,he,[I.value===`debate`?(b(),h(`div`,ge,[_(`div`,_e,[v(m,{size:`small`,onClick:Fe,disabled:W.value||L.value},{default:a(()=>[...s[17]||=[p(` 🚀 开始辩论 `,-1)]]),_:1},8,[`disabled`]),v(m,{size:`small`,onClick:Ie,disabled:!W.value},{default:a(()=>[...s[18]||=[p(` ⏹️ 停止辩论 `,-1)]]),_:1},8,[`disabled`]),v(x,{modelValue:G.value,"onUpdate:modelValue":s[4]||=e=>G.value=e,size:`small`,placeholder:`选择辩论主题`,style:{width:`200px`}},{default:a(()=>[v(g,{label:`是否应该扩大线上销售渠道？`,value:`online-expansion`}),v(g,{label:`是否应该增加门店体验投入？`,value:`store-experience`}),v(g,{label:`是否应该开发新产品线？`,value:`product-line`}),v(g,{label:`是否应该加大营销预算？`,value:`marketing-budget`}),v(g,{label:`自定义主题`,value:`custom`})]),_:1},8,[`modelValue`]),G.value===`custom`?(b(),d(u,{key:0,modelValue:K.value,"onUpdate:modelValue":s[5]||=e=>K.value=e,size:`small`,placeholder:`输入辩论主题...`,style:{width:`200px`}},null,8,[`modelValue`])):c(``,!0),v(x,{modelValue:q.value,"onUpdate:modelValue":s[6]||=e=>q.value=e,multiple:``,size:`small`,placeholder:`选择参与角色`,style:{width:`300px`}},{default:a(()=>[(b(),h(e,null,l(Q,(e,t)=>v(g,{key:t,label:e.name,value:t},null,8,[`label`,`value`])),64))]),_:1},8,[`modelValue`])])])):c(``,!0),_(`div`,{ref_key:`chatBoxRef`,ref:V,class:`chat-box`},[(b(!0),h(e,null,l(N.value,(e,r)=>(b(),h(`div`,{key:r,class:t([`chat-item`,e.role===`ai`?`ai-msg`:`user-msg`,e.persona?`persona-${e.persona}`:``])},[e.persona?(b(),h(`div`,ve,[_(`span`,{class:`persona-badge`,style:f({"--persona-color":Q[e.persona]?.color||`#38bdf8`})},n(Q[e.persona]?.icon)+` `+n(Q[e.persona]?.name),5)])):c(``,!0),_(`div`,{class:t([`chat-bubble`,e.role===`ai`?`bubble-ai`:`bubble-user`])},[_(`div`,{innerHTML:e.content},null,8,ye),e.role===`ai`&&e.rawText?(b(),h(`div`,{key:0,onClick:t=>We(e.rawText,e.persona),class:t([`voice-btn`,B.value&&z.value===e.rawText?`voice-active`:``])},[...s[19]||=[_(`svg`,{xmlns:`http://www.w3.org/2000/svg`,fill:`none`,viewBox:`0 0 24 24`,"stroke-width":`1.5`,stroke:`currentColor`,class:`voice-icon`},[_(`path`,{"stroke-linecap":`round`,"stroke-linejoin":`round`,d:`M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z`})],-1),p(` 播放语音 `,-1)]],10,be)):c(``,!0)],2)],2))),128)),L.value?(b(),h(`div`,xe,[_(`div`,Se,[p(n(Ae.value.thinkingMsg)+` `,1),s[20]||=_(`span`,{class:`thinking-dots`},[_(`span`,null,`.`),_(`span`,null,`.`),_(`span`,null,`.`)],-1)])])):c(``,!0)],512),_(`div`,Ce,[v(u,{modelValue:P.value,"onUpdate:modelValue":s[7]||=e=>P.value=e,onKeyup:o(He,[`enter`]),onKeydown:s[8]||=o(i(()=>{},[`prevent`]),[`enter`]),placeholder:I.value===`debate`?`输入辩论主题或观察...`:`输入指令，例如：生成经营诊断、评估风险、制定营销方案...`,class:`ai-input`,clearable:``,disabled:L.value||W.value},null,8,[`modelValue`,`placeholder`,`disabled`]),v(m,{type:`primary`,onClick:$,loading:L.value||W.value,disabled:!P.value.trim()||L.value||W.value,class:`send-btn`},{default:a(()=>[...s[21]||=[p(` 发送 `,-1)]]),_:1},8,[`loading`,`disabled`])])]),_(`div`,we,[s[29]||=_(`div`,{class:`quick-title`},`快捷指令`,-1),_(`div`,Te,[s[28]||=_(`div`,{class:`section-title`},`📊 智能周报生成`,-1),v(m,{onClick:s[9]||=e=>Z(`finance`),class:`report-btn`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[22]||=[p(` 💰 财务周报 `,-1)]]),_:1},8,[`loading`,`disabled`]),v(m,{onClick:s[10]||=e=>Z(`operations`),class:`report-btn`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[23]||=[p(` ⚙️ 运营周报 `,-1)]]),_:1},8,[`loading`,`disabled`]),v(m,{onClick:s[11]||=e=>Z(`inventory`),class:`report-btn`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[24]||=[p(` 📦 库存周报 `,-1)]]),_:1},8,[`loading`,`disabled`]),v(m,{onClick:s[12]||=e=>Z(`members`),class:`report-btn`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[25]||=[p(` 👥 会员周报 `,-1)]]),_:1},8,[`loading`,`disabled`]),v(m,{onClick:s[13]||=e=>Z(`activities`),class:`report-btn`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[26]||=[p(` 🎯 活动周报 `,-1)]]),_:1},8,[`loading`,`disabled`]),v(m,{onClick:s[14]||=e=>Z(`all`),class:`report-btn report-btn-full`,loading:J.value,disabled:L.value||W.value||J.value},{default:a(()=>[...s[27]||=[p(` 📋 全站综合周报 `,-1)]]),_:1},8,[`loading`,`disabled`])]),v(S,{style:{margin:`16px 0`,"border-color":`#333`}}),s[30]||=_(`div`,{class:`quick-title`},`常规指令`,-1),(b(),h(e,null,l(Me,(e,t)=>v(m,{key:t,onClick:e=>Le(t),class:`quick-btn`,text:``,disabled:L.value||W.value},{default:a(()=>[p(n(e.icon)+` `+n(e.label),1)]),_:2},1032,[`onClick`,`disabled`])),64))])])])}}},[[`__scopeId`,`data-v-5037c15d`]]);export{j as default};