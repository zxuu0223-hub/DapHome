---
title: 从想法到可收费 SaaS：标书工坊 BidDeck AI 创业复盘
date: 2026-08-29T21:00:00+08:00
tags: [创业, AI SaaS, BidDeck AI, 招投标, 产品开发]
summary: 复盘标书工坊 BidDeck AI 从市场机会、最小原型、真实文档分析，到完整标书生成、账户额度与订单系统的创业实践，并结合关键代码分析产品决策、踩坑与下一步方向。
---

## 一、为什么会做“标书工坊”

标书工坊 BidDeck AI 的起点，不是“我想再做一个 AI 写作工具”，而是一个很具体的商业问题：中文招投标文件篇幅长、条款密、重复劳动多，但任何一处资格条件、时间要求、盖章要求或响应遗漏，都可能直接导致废标。

传统标书制作通常要经历：阅读招标文件、整理资格条件、对照公司材料、建立响应矩阵、设计目录、撰写正文、检查缺项、排版交付。这个流程耗费大量人工，而且经验往往掌握在少数标书人员手里。

于是产品最初的假设是：

```text
如果 AI 能先把“读、比、查、写”四件事串起来，
就能显著降低制作标书的时间成本和漏项风险。
```

但创业不能停在一句“AI 自动写标书”。真正的产品必须回答四个问题：

- 用户上传的文件能不能被正确读取？
- AI 的判断能不能追溯到材料证据？
- 缺少的信息会不会被模型擅自编造？
- 如果用户愿意付费，账户、额度、项目和订单能不能真的运行？

这四个问题，构成了标书工坊从页面原型走向 SaaS 原型的主线。

## 二、第一阶段：先做出最小可用流程

第一版没有追求复杂后台，而是先把用户最核心的工作路径跑通：

```text
上传招标文件和公司材料
        ↓
AI 分析招标要求与公司证据
        ↓
查看风险、评分策略和响应矩阵
        ↓
生成完整标书草稿
        ↓
人工编辑并下载 Word
```

前端把流程拆成 `setup`、`editor` 和 `proposal` 三个阶段。后来实际使用时发现，只能后退、不能前进会让用户误以为生成结果丢失，于是增加双向导航，并保留已经产生的分析和草稿状态。

这件事看起来只是一个按钮问题，背后却是产品逻辑：SaaS 工作流不能把用户锁死在单向向导中。标书不是一次性表单，用户会反复在原始材料、分析结论和正文之间核对。

## 三、让上传的文件真正变成可分析文本

只有上传框，没有文档解析，就只是一个演示页面。标书工坊在浏览器端分别处理 PDF 和 DOCX：

```typescript
if (
  file.type === "application/pdf" ||
  file.name.toLowerCase().endsWith(".pdf")
) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  text = result.text.join("\n");
} else if (file.name.toLowerCase().endsWith(".docx")) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  text = result.value;
}
```

这里有两个关键选择。

第一，使用 `unpdf` 解析 PDF、使用 `mammoth` 解析 DOCX，让常见招标材料可以直接进入分析流程。

第二，招标文件与公司材料分组上传，而不是全部混在一个列表里。因为二者在业务中的角色不同：前者定义要求，后者提供证据。分组以后，模型的提示词也能明确区分“要求是什么”和“我们有什么”。

后来又补充了同名文件替换和旧结果失效逻辑。用户重新上传同名材料时，新文件会替换旧文件；文件增删、替换或补充文本发生变化后，之前的 AI 结果立即作废，防止页面继续展示基于旧材料生成的结论。

## 四、从“生成一段文字”转向结构化招标分析

最初很容易想到的做法，是把材料扔给大模型，让它返回一篇总结。但一篇看起来流畅的总结，无法支撑真实投标决策。

因此分析接口要求智谱 GLM 返回固定 JSON：

```typescript
const systemPrompt = `
严格依据文本分析，不得补造条款、资质或分值。
输出 JSON，包含：
detectedDocumentType、classificationConfidence、classificationReason、
summary、qualifications、fatalRisks、scoreItems、responseMatrix、
chapters、missingInfo、writingAdvice。
`;
```

结构化输出带来了几个直接好处：

- `fatalRisks` 可以独立形成废标风险区。
- `responseMatrix` 能逐条显示要求、状态、公司证据和补强建议。
- `scoreItems` 可以把评分项转成有针对性的得分策略。
- `chapters` 能用于后续生成标书目录。
- `missingInfo` 把缺失材料从正式目录中分离出来。
- `writingAdvice` 指导正文如何突出优势、隔离短板。

响应矩阵的前端结构也体现了“证据优先”的思路：

```tsx
<div className="matrix-row">
  <p>{row.requirement}</p>
  <span className={`matrix-status s-${row.status}`}>
    {row.status}
  </span>
  <p>{row.evidence}</p>
  <p>{row.recommendation}</p>
</div>
```

用户看到的不只是“符合”或“不符合”，而是四列可以核对的信息。对高风险业务而言，可追溯性比一句聪明的结论更重要。

## 五、真实测试暴露了大模型最危险的错误

产品真正进步的地方，不是提示词写得越来越长，而是拿真实材料跑完整流程以后，逐个修正模型的错误。

### 1. 数值约束方向被误判

测试中出现过这样的情况：招标要求“有效期不少于 90 日”，公司响应 120 日；或者要求“180 日内完成”，公司响应 170 日。它们明明满足要求，却被模型列为风险。

这类错误不能只靠重新提示，于是增加确定性复核：

```typescript
const isMinimum = /(不少于|不得少于|至少|最低)/.test(tenderContext);
const isMaximum = /(不超过|不得超过|至多|以内|\d+(?:\.\d+)?\s*日内)/.test(
  tenderContext,
);

return (
  (isMinimum && offered >= required) ||
  (isMaximum && offered <= required)
);
```

这段代码把自然语言中的约束方向转换成明确比较：

- “不少于、至少、最低”使用 `>=`。
- “不超过、以内、N 日内”使用 `<=`。

模型负责理解复杂文档，程序负责校验可以确定计算的事实。两者结合，比单独依赖任何一方都稳健。

### 2. “不构成风险”仍被放进风险列表

模型有时会在 `fatalRisks` 中返回“该项满足要求，不构成风险”。语义是正确的，但只要被放进风险数组，前端就会计数并高亮。

因此结果进入页面前还要过滤：

```typescript
fatalRisks: structuredStrings(raw.fatalRisks).filter(
  (risk) =>
    !/(不构成风险|无需整改|无需补充)/.test(risk) &&
    !isClearlySatisfiedNumericRequirement(
      risk,
      tenderText,
      bidResponseText,
    ),
),
```

这次纠错给我的启发是：结构化输出不等于结构可靠。模型返回 JSON，只是方便程序检查，并不意味着每个字段中的内容都天然正确。

### 3. 目录和缺失信息混在一起

模型曾把“请补充社保证明”放入标书目录。于是代码增加了 `missingActionPattern`：凡是包含“缺少、未提供、待确认、需补充”等动作词的项目，都从目录移入 `missingInfo`。

这让“最终文件应该写哪些章节”和“目前还缺什么材料”成为两个明确的问题，页面也更接近标书人员的真实思维方式。

## 六、从分析工具升级为完整标书生成器

完成分析后，第二个 AI 接口根据招标材料、公司材料和结构化分析生成 6—9 个章节：

```typescript
const response = await fetch(
  "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "glm-4-flash-250414",
      temperature: 0.2,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: sourceMaterial },
      ],
    }),
  },
);
```

生成规则中最重要的一条不是“写得专业”，而是禁止编造：

```text
只能使用输入材料中明确出现的事实。
缺少关键事实时，在正文原位置写“【待补充：具体内容】”。
```

程序还会重新扫描正文中的占位符：

```typescript
const inlinePlaceholders = [
  executiveSummary,
  ...chapters.map((chapter) => chapter.content),
].flatMap(
  (value) => value.match(/【待补充：[^】]+】/g) || [],
);
```

即使模型忘记把某个缺项放进 `missingPlaceholders`，程序仍能从正文中找回来。最终用户可以逐章编辑，并下载 Word 可打开的草稿。

这里也保留了明确的产品边界：商务报价、签字、盖章、日期和法定代表人等事项不能安全自动完成，必须进入人工检查清单。

## 七、创业项目不能只有功能，还要有商业闭环

做到“能分析、能生成”以后，标书工坊仍然只是工具原型。为了验证它能否成为 SaaS，项目继续补齐账户、项目保存、额度和订单。

数据库包含四张核心表：

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member',
  plan TEXT NOT NULL DEFAULT 'trial',
  credits INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'setup',
  snapshot_key TEXT NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  action TEXT NOT NULL,
  source_id TEXT NOT NULL UNIQUE
);
```

D1 保存账户、项目索引、订单和额度流水；R2 保存体积更大的项目快照。项目保存时还会验证所有权：

```typescript
const existing = await DB.prepare(
  "SELECT user_id FROM projects WHERE id = ?",
).bind(id).first<{ user_id: string }>();

if (existing && existing.user_id !== user.id) {
  return Response.json({ error: "无权修改该项目" }, { status: 403 });
}
```

额度系统采用“先扣费、失败退款”的方式。分析消耗 1 次，完整标书生成消耗 2 次：

```typescript
const charged = await chargeCredits(account.id, 1, "AI 投标分析");

if (!response.ok) {
  await refundCredits(account.id, 1, charged.sourceId);
  return Response.json(
    { error: "AI 分析暂时不可用，请稍后重试" },
    { status: 502 },
  );
}
```

这不是简单地在页面显示一个余额数字。每次增减都写入 `usage_ledger`，退款还通过唯一来源 ID 防止重复执行。

当前套餐为：

- 项目体验包：10 次，99 元。
- 专业项目包：50 次，399 元。
- 团队协作包：200 次，1299 元。

微信支付商户号尚未接入，所以系统没有伪造“支付成功”，而是创建待确认订单，由管理员确认到账后发放额度。对创业原型来说，诚实地保留人工运营环节，比做一个假的支付动画更有价值。

## 八、从这次创业过程中学到什么

### 1. 先选择高价值、强痛点场景

标书不是高频娱乐产品，但一次投标的时间成本和失败成本都很高。用户愿意付费的不是“AI 写了多少字”，而是更快地完成材料梳理、更少漏项、让结果更容易复核。

### 2. 演示效果不等于产品价值

最早的静态模板看起来像完整标书，但只要内容不是由真实材料驱动，就无法产生持续价值。后续版本删除固定的章节和示例正文，把结果页改成完全由本次 AI 分析生成，产品才从展示站向工具迈进。

### 3. AI 产品必须有确定性护栏

提示词解决开放问题，代码解决确定问题。数字大小关系、数组结构、枚举状态、文本长度、项目所有权、额度增减，都不应该交给模型自由发挥。

### 4. 商业化功能要尽早进入原型

如果一直等产品“完美”后才考虑收费，很容易做出一个功能很多却无法运营的工具。账户、试用额度、套餐和订单提前加入后，产品成本和用户价值才有了可衡量单位。

### 5. 高风险业务要把 AI 定位成助手

标书工坊输出的是可编辑初稿和风险辅助判断，不是法律承诺，也不是真实中标概率。最终文件必须由投标负责人复核。把边界写清楚并不会削弱产品，反而会提高可信度。

## 九、目前还没有解决的问题

标书工坊已经是一个能真实运行的 SaaS 原型，但还不是成熟商业产品。当前主要缺口包括：

- 扫描版 PDF 尚需 OCR。
- 正式 DOCX 模板、目录编号、页眉页脚和企业排版仍需完善。
- 微信支付尚未接入商户号。
- 企业知识库和历史标书检索尚未完成。
- 多人审阅、版本比较和企业权限仍在下一阶段。
- AI 给出的准备就绪度只是基于现有材料的区间评估，不是真实中标概率。

下一步最重要的不是继续增加首页卖点，而是找真实标书人员试用，记录他们在哪些节点不信任结果、哪些功能愿意付费，以及一份标书究竟节省了多少人工时间。

## 十、总结：创业是连续纠错，不是一次生成

标书工坊的开发经历可以压缩成这样一条路线：

```text
发现标书制作的高成本痛点
        ↓
做出上传—分析—生成的最小闭环
        ↓
接入真实 PDF、DOCX 与智谱 GLM
        ↓
用真实材料暴露模型误判
        ↓
加入证据矩阵、数字复核和防编造机制
        ↓
补齐项目保存、账户、额度与订单
        ↓
形成可测试、可运营、可收费的 SaaS 原型
```

回头看，真正推动项目向前的不是某一次写出很多代码，而是每次都把一个“看起来能用”的部分变成“真实可以验证”的部分。

AI 创业的核心也许就在这里：模型负责扩大能力边界，代码负责守住事实边界，用户反馈负责决定商业边界。
