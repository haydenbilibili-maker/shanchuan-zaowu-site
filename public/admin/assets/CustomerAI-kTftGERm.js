import{Cn as e,Mn as t,Tn as n,kn as r,ln as i,mn as a,pn as o,r as s,sn as c,un as l}from"./element-plus-B7Q2su-S.js";import{C as u,F as d,N as f,W as p}from"./index-Cc691_bB.js";var m={class:`customer-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=p({__name:`CustomerAI`,props:{feature:Object},setup(p){let _=t(!1),v=t(``),y=async()=>{_.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`week`});if(!e){s.error(`获取数据失败`);return}let t=await d(`基于以下客户数据，生成详细的客户画像分析：

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
6. 客户留存和复购策略`,{systemInstruction:`你是一位客户分析专家，擅长用户画像构建和客户行为分析`,temperature:.8});v.value=f.parse(t)}catch(e){s.error(`分析失败：`+e.message)}finally{_.value=!1}};return(t,s)=>{let u=n(`el-button`);return e(),l(`div`,m,[s[1]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`👥 客户画像分析`),c(`p`,{class:`subtitle`},`深度分析客户行为，生成精准用户画像`)],-1),a(u,{type:`primary`,onClick:y,loading:_.value},{default:r(()=>[...s[0]||=[o(` 分析客户画像 `,-1)]]),_:1},8,[`loading`]),v.value?(e(),l(`div`,h,[c(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):i(``,!0)])}}},[[`__scopeId`,`data-v-e4ff07fb`]]);export{_ as default};