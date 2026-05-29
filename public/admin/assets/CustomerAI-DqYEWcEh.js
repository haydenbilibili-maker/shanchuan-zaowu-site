import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,s as p,y as m}from"./index-nwDdqFlp.js";var h={class:`customer-ai`},g={key:0,class:`result-card`},_=[`innerHTML`],v=f({__name:`CustomerAI`,props:{feature:Object},setup(e){let f=o(!1),v=o(``),y=async()=>{f.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){l.error(`获取数据失败`);return}let t=await m(`基于以下客户数据，生成详细的客户画像分析：

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
6. 客户留存和复购策略`,{systemInstruction:`你是一位客户分析专家，擅长用户画像构建和客户行为分析`,temperature:.8});v.value=d.parse(t)}catch(e){l.error(`分析失败：`+e.message)}finally{f.value=!1}};return(e,o)=>{let l=s(`el-button`);return u(),i(`div`,h,[o[1]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`👥 客户画像分析`),n(`p`,{class:`subtitle`},`深度分析客户行为，生成精准用户画像`)],-1),a(l,{type:`primary`,onClick:y,loading:f.value},{default:c(()=>[...o[0]||=[t(` 分析客户画像 `,-1)]]),_:1},8,[`loading`]),v.value?(u(),i(`div`,g,[n(`div`,{class:`result-content`,innerHTML:v.value},null,8,_)])):r(``,!0)])}}},[[`__scopeId`,`data-v-e4ff07fb`]]);export{v as default};