import{$t as e,Jt as t,Xt as n,Zt as r,_n as i,cn as a,en as o,mn as s,r as c,un as l}from"./element-plus-CVfHhcL0.js";import{_ as u,h as d,m as f,o as p}from"./index-D_jnvNgu.js";var m={class:`customer-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`CustomerAI`,props:{feature:Object},setup(f){let _=i(!1),v=i(``),y=async()=>{_.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){c.error(`获取数据失败`);return}let t=await u(`基于以下客户数据，生成详细的客户画像分析：

客户数据：
- 总会员数：${e.members.total}
- 本周新增会员：${e.members.weeklyNew}
- 平均客单价：¥${e.finance.averageOrderValue.toFixed(2)}
- 本周订单数：${e.finance.weeklyOrdersCount}单

请提供：
1. 核心客户群体特征（年龄、性别、消费习惯等）
2. 客户消费行为分析
3. 客户价值分层（高价值、中价值、低价值）
4. 客户需求洞察
5. 个性化营销建议
6. 客户留存和复购策略`,{systemInstruction:`你是一位客户分析专家，擅长用户画像构建和客户行为分析`,temperature:.8});v.value=d.parse(t)}catch(e){c.error(`分析失败：`+e.message)}finally{_.value=!1}};return(i,c)=>{let u=l(`el-button`);return a(),r(`div`,m,[c[1]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`👥 客户画像分析`),t(`p`,{class:`subtitle`},`深度分析客户行为，生成精准用户画像`)],-1),o(u,{type:`primary`,onClick:y,loading:_.value},{default:s(()=>[...c[0]||=[e(` 分析客户画像 `,-1)]]),_:1},8,[`loading`]),v.value?(a(),r(`div`,h,[t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-e4ff07fb`]]);export{_ as default};