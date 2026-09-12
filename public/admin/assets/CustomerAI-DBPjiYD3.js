import{Jt as e,Xt as t,Zt as n,en as r,fn as i,gn as a,r as o,tn as s,un as c,yn as l}from"./element-plus-CVSIbaOo.js";import{C as u,F as d,N as f,W as p}from"./index-BxCDW-W1.js";var m={class:`customer-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=p({__name:`CustomerAI`,props:{feature:Object},setup(p){let _=l(!1),v=l(``),y=async()=>{_.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`week`});if(!e){o.error(`获取数据失败`);return}let t=await d(`基于以下客户数据，生成详细的客户画像分析：

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
6. 客户留存和复购策略`,{systemInstruction:`你是一位客户分析专家，擅长用户画像构建和客户行为分析`,temperature:.8});v.value=f.parse(t)}catch(e){o.error(`分析失败：`+e.message)}finally{_.value=!1}};return(o,l)=>{let u=i(`el-button`);return c(),n(`div`,m,[l[1]||=e(`div`,{class:`ai-header`},[e(`h3`,null,`👥 客户画像分析`),e(`p`,{class:`subtitle`},`深度分析客户行为，生成精准用户画像`)],-1),s(u,{type:`primary`,onClick:y,loading:_.value},{default:a(()=>[...l[0]||=[r(` 分析客户画像 `,-1)]]),_:1},8,[`loading`]),v.value?(c(),n(`div`,h,[e(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):t(``,!0)])}}},[[`__scopeId`,`data-v-e4ff07fb`]]);export{_ as default};