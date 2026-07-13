# Capability 工作流详细设计（上）

> 本文档与 `docs/capabilities_design/DESIGN.md` 配套，描述每个 Capability 的精确工作流步骤、事件规格、Tool 调用协议、错误处理策略。DESIGN.md 定义"是什么"，本文档定义"怎么做"。

## 设计约束

- Capability 的 `execute()` 方法**不得直接调用 `ctx.llm.complete()`**。所有 LLM 调用必须通过 Tool。
- Capability 只做编排：循环、分支、`Promise.allSettled`、`ctx.emit`。
- 每个 Tool 调用前后必须 emit `tool_call` / `tool_result` 事件（含 `parentTraceId` 链）。
- 所有事件 payload 必须包含足够信息让前端渲染对应组件。

## 共享事件类型补充

在现有 `UiHint` 枚举基础上，新增 3 个 uiHint：

```
"clarification_asked"   → require_parsing 每轮对话提问时
"clarification_answered" → 用户回答后
"quality_warning"        → 充分性/冲突/不均衡告警
```

---

## 1. Requirement Parsing

### 1.1 类型定义

```typescript
// 新增：对话轮次记录
interface ClarificationRound {
  round: number;
  questionType: "scene_selection" | "targets" | "dimensions" | "output_format" | "constraints" | "confirm_preview";
  agentPrompt: string;
  userResponse: string;
  extractedDelta: Record<string, any>;
  timestamp: string;
}
```

`RequirementConfig` 新增字段 `clarificationHistory: ClarificationRound[]`（追加到 `shared/types.ts`）。

### 1.2 多轮对话引擎

整个 `execute()` 是一个 while 循环，直到用户确认。

```typescript
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  const userInput = state.data.userInput ?? "";
  const config = state.data.config as Partial<RequirementConfig> | undefined;

  // 确定起始轮次（支持从 HITL 恢复）
  let round = config?.clarificationHistory?.length
    ? config.clarificationHistory.length + 1
    : 1;

  // 如果 config 不存在，初始化
  const current: Partial<RequirementConfig> = config ?? { userInput };

  while (true) {
    switch (round) {
      case 1: current.analysisType = await this.askScene(current, ctx); break;
      case 2: current.targets = await this.askTargets(current, ctx); break;
      case 3: current.dimensions = await this.askDimensions(current, ctx); break;
      case 4: current.outputFormat = await this.askOutputFormat(current, ctx); break;
      case 5: current.constraints = await this.askConstraints(current, ctx); break;
      case 6: {
        const confirmed = await this.askConfirm(current, ctx);
        if (confirmed) {
          current.clarificationHistory = this.history;
          await ctx.emit({
            uiHint: "node_completed", eventType: "NODE_COMPLETED", nodeId: ctx.nodeId,
            workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
            payload: { summary: `解析完成：${current.targets!.length} 个竞品，${current.dimensions!.length} 个维度`, config: current },
            timestamp: new Date().toISOString(),
          });
          return { patch: { config: current as RequirementConfig }, artifacts: [] };
        }
        // 用户修改 → 回到对应轮次
        round = this.modifyRound;
        continue;
      }
      default: throw new Error(`Invalid round: ${round}`);
    }
    round++;
  }
}
```

**关键设计：每轮对外是一个 pause→wait→resume 循环。** 前端在收到 `clarification_asked` 后渲染问题，用户提交后通过 `POST /api/workflows/:id/route` 回传答案，runner.ts 恢复执行。

### 1.3 各轮次详细规格

#### Round 1: 分析场景定调

```
Step A: 生成场景选项 prompt
  → tool: llm_structured_extract
  参数: { text: userInput, instruction: SCENE_CLASSIFY_PROMPT }
  输出: { analysisType: "product_comparison"|"dev_decision"|"industry_trend", confidence: 0-1 }

Step B: 若 confidence < 0.7 → 向用户列出 3 种场景的简短描述让用户选择
        若 confidence >= 0.7 → 展示推断结果让用户确认

Step C: emit clarification_asked
  payload: {
    round: 1,
    questionType: "scene_selection",
    agentPrompt: "您想做哪种分析？\n1. 产品横向对比 - 多产品功能/定价等维度对比\n2. ...\n3. ...",
    options: ["product_comparison", "dev_decision", "industry_trend"],
    current: current.analysisType
  }

Step D: HITL 暂停（runner.ts 调用 waitForHumanDecision）

Step E: 用户返回后 emit clarification_answered
  payload: {
    round: 1,
    questionType: "scene_selection",
    userResponse: "用户选择的文本",
    extractedDelta: { analysisType: "product_comparison" }
  }
```

#### Round 2: 竞品列表补全

```
Step A: → tool: llm_structured_extract
  参数: {
    text: userInput,
    instruction: TARGETS_EXTRACT_PROMPT
      // "从用户输入中提取所有产品名称。用户可能已提及自身产品和竞品。"
      // "如果用户没有明确说明哪个是自身产品，标记为 null。"
  }
  输出: { mentioned: string[], ownProduct: string|null }

Step B: 判断
  - mentioned.length < 2 → agentPrompt 强调还缺竞品
  - ownProduct === null → agentPrompt 询问"你的自身产品是哪一个？"
  - 都满足 → agentPrompt 列出现有列表让用户确认或修改

Step C: emit clarification_asked
  payload: {
    round: 2,
    questionType: "targets",
    agentPrompt: "您提到了以下产品：A、B、C。您的自身产品是哪一个？还需要补充其他竞品吗？",
    currentTargets: [{ name, isOwn }],
    missing: "need_own_product" | "need_more_competitors" | null
  }

Step D: HITL 暂停

Step E: → tool: llm_structured_extract（从用户回答中提取产品名列表）
  参数: { text: userResponse, instruction: TARGETS_PARSE_PROMPT }
  输出: { targets: [{ name, ownProduct: boolean }] }
  自身产品强制排在 targets[0]

Step F: emit clarification_answered
  payload: {
    round: 2,
    questionType: "targets",
    userResponse,
    extractedDelta: { targets }
  }

Step G: 写入 clarificationHistory
```

#### Round 3: 对比维度确认

```
Step A: → tool: dimension_suggester（新增 Tool）
  参数: { targets: current.targets!, category: targets[0].category }
  输出: {
    suggested: ["functionality", "pricing", ...],  // 预设 5 维度的子集或扩展
    reasoning: "基于 SaaS 品类，推荐关注定价、API 开放性和 SLA 保障"
  }

Step B: emit clarification_asked
  payload: {
    round: 3,
    questionType: "dimensions",
    agentPrompt: "请选择对比维度（可多选，也可自定义输入）：",
    presetDimensions: [
      { key: "functionality", label: "功能特性" },
      { key: "pricing", label: "定价与付费模式" },
      { key: "user_experience", label: "用户体验与交互" },
      { key: "market_position", label: "市场地位与份额" },
      { key: "technology", label: "技术能力与架构" },
    ],
    suggested: dimension_suggester 的输出,
    current: current.dimensions
  }

Step C: HITL 暂停

Step D: → tool: llm_structured_extract
  输出: { dimensions: string[] }

Step E: emit clarification_answered
```

#### Round 4: 产物格式确认

```
Step A: emit clarification_asked
  payload: {
    round: 4,
    questionType: "output_format",
    agentPrompt: "您希望产出哪些产物？",
    formatOptions: [
      { key: "comparison_matrix", label: "对比矩阵表格", desc: "竞品×属性的对比表格，含差异高亮" },
      { key: "swot", label: "SWOT 分析", desc: "各竞品的优势/劣势/机会/威胁" },
      { key: "insight_report", label: "差异化洞察", desc: "以您的产品为参照系的差距/优势/机会/风险分析" },
      { key: "report", label: "完整分析报告", desc: "包含以上全部 + 数据来源附录" },
    ],
    current: current.outputFormat
  }

Step B: HITL 暂停

Step C: → tool: llm_structured_extract
  输出: { outputFormat: OutputFormat[] }

Step D: emit clarification_answered
```

#### Round 5: 约束条件

用户可跳过（前端渲染跳过按钮）。

```
Step A: emit clarification_asked
  payload: {
    round: 5,
    questionType: "constraints",
    agentPrompt: "是否有时间/地域/语言偏好？（可跳过）",
    constraintFields: [
      { key: "timeRange", label: "时间范围", placeholder: "如：最近一年" },
      { key: "regions", label: "地域", placeholder: "如：中国、北美" },
      { key: "languages", label: "语言偏好", placeholder: "如：中文、英文" },
    ],
    current: current.constraints,
    skippable: true
  }

Step B: HITL 暂停（含跳过按钮）

Step C: 若跳过 → constraints = {}，进入 Round 6
        若填写 → tool: llm_structured_extract 提取结构化 constraints

Step D: emit clarification_answered
```

#### Round 6: 最终确认

```
Step A: emit clarification_asked
  payload: {
    round: 6,
    questionType: "confirm_preview",
    agentPrompt: "请确认以下分析配置：\n" + formatConfigPreview(current),
    configPreview: current,  // 完整 config 预览
    actions: ["confirm", "modify", "cancel"]
  }

Step B: HITL 暂停

Step C: 用户操作:
  - "confirm" → 写入 state.data.config（含完整 clarificationHistory）→ 节点完成
  - "modify" → 返回用户指定轮次重新提问
  - "cancel" → 终止工作流
```

### 1.4 事件溯源

每轮对话的 `clarification_asked` 和 `clarification_answered` 各自拥有独立 `traceId`，`parentTraceId` 指向上一轮。完整 `clarificationHistory` 写入 `RequirementConfig`，在产物溯源中可被引用。

### 1.5 依赖的 Tool

| Tool | manifest.json name | 参数 | 返回 |
|------|-------------------|------|------|
| llm_structured_extract | `llm_structured_extract` | `{ text, instruction }` | 结构化 JSON |
| dimension_suggester | `dimension_suggester` | `{ targets, category }` | `{ suggested: string[], reasoning: string }` |

### 1.6 Prompt 文件

`backend/capabilities/requirement_parsing/prompts.ts` 需新增以下 Prompt：

```typescript
export const SCENE_CLASSIFY_PROMPT = `分析用户意图，判断属于以下哪种场景：
1. product_comparison: 比较多个产品
2. dev_decision: 产品发展方向决策
3. industry_trend: 产业趋势分析
当前 Phase 2 默认返回 product_comparison。
输出 JSON: { "analysisType": "...", "confidence": 0-1 }`;

export const TARGETS_EXTRACT_PROMPT = `从用户输入中提取所有产品/竞品名称。
输出 JSON: { "mentioned": ["产品名1", "产品名2"], "ownProduct": "自身产品名"|null }`;

export const TARGETS_PARSE_PROMPT = `从用户回答中提取竞品列表，标记哪个是自身产品。
输出 JSON: { "targets": [{ "name": "产品名", "isOwn": true|false }] }`;
```

---

## 2. Information Collection

### 2.1 类型定义

```typescript
// 新增：搜索计划
interface SearchPlan {
  batches: SearchBatch[];
}
interface SearchBatch {
  queries: SearchQuery[];
}
interface SearchQuery {
  target: string;
  dimension: string;
  query: string;
  searchType: "broad" | "targeted";  // broad=泛搜索, targeted=定向页面
}

// 新增：采集报告
interface CollectionReport {
  totalItems: number;
  perDimension: Record<string, { count: number; credibilityBreakdown: Record<string, number> }>;
  sufficiencyScore: number;
  sufficiencyVerdict: "sufficient" | "insufficient";
  collectionRounds: number;
}
```

### 2.2 主执行流程

```typescript
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  const config = state.data.config as RequirementConfig;
  if (!config) return { patch: {}, artifacts: [] };

  let allItems: RawDataItem[] = [];
  let collectionRounds = 0;
  const MAX_ROUNDS = 2;

  // Step 1: URL 发现
  await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS",
    payload: { stage: "url_discovery", message: "正在发现竞品官方 URL..." } });
  const resolverTool = this.tools.find(t => t.name === "competitor_url_resolver")!;
  const resolvedTargets = await this.resolveUrls(config.targets, resolverTool, ctx);

  // Step 2-5: 采集循环（含充分性自检）
  while (collectionRounds < MAX_ROUNDS) {
    collectionRounds++;

    // Step 2: 搜索计划
    await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS",
      payload: { stage: "planning", round: collectionRounds } });
    const plannerTool = this.tools.find(t => t.name === "search_planner")!;
    const plan = await this.generatePlan(resolvedTargets, config, plannerTool, ctx);

    // Step 3: 搜索+抓取
    await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS",
      payload: { stage: "collecting", round: collectionRounds, batchCount: plan.batches.length } });
    const newItems = await this.executeBatches(plan, ctx);
    allItems.push(...newItems);

    // Step 4: 可信度评估
    await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS",
      payload: { stage: "scoring", itemCount: allItems.length } });
    const scorerTool = this.tools.find(t => t.name === "credibility_scorer")!;
    allItems = await this.scoreItems(allItems, scorerTool, ctx);

    // Step 5: 充分性检查
    const checkerTool = this.tools.find(t => t.name === "sufficiency_checker")!;
    const sufficiency = await this.checkSufficiency(allItems, config, checkerTool, ctx);

    if (sufficiency.score >= 4) break;                      // 通过
    if (sufficiency.score >= 3 && collectionRounds >= 1) break;  // 第二轮放宽
    if (sufficiency.score < 3 && collectionRounds >= MAX_ROUNDS) {
      await ctx.emit({ uiHint: "quality_warning", eventType: "QUALITY_WARNING",
        payload: { message: `采集 ${MAX_ROUNDS} 轮后仍未达标`, sufficiency } });
      break;
    }
  }

  // Step 6: 按维度分组写入
  const rawData: Record<string, RawDataItem[]> = {};
  for (const item of allItems) {
    if (!rawData[item.dimension]) rawData[item.dimension] = [];
    rawData[item.dimension].push(item);
  }

  const report: CollectionReport = { /* ... */ };
  await ctx.emit({ uiHint: "node_completed", eventType: "NODE_COMPLETED",
    payload: { summary: `${allItems.length} 条数据，覆盖 ${Object.keys(rawData).length} 个维度`, report } });

  return { patch: { rawData, collectionReport: report }, artifacts: [] };
}
```

### 2.3 各步骤详细规格

#### Step 1: URL 发现

```
→ tool: competitor_url_resolver（新增）
调用方式: 对每个未提供 url 的 target 并行调用
  Promise.allSettled(targets.filter(t => !t.url).map(t =>
    tool.execute({ name: t.name, category: t.category }, toolCtx)
  ))

每次调用:
  emit TOOL_CALL { toolName: "competitor_url_resolver", params: { target: t.name } }
  → 执行 tool
  emit TOOL_RESULT { toolName: "competitor_url_resolver", result: { url, sourceType: "official"|"appstore"|"database" } }

成功 → 补全 target.url
失败 → 保持 url 为空，后续搜索时用 name 作为搜索词
```

#### Step 2: 搜索计划生成

```
→ tool: search_planner（新增）
参数: {
  targets: [{ name, url?, category? }],
  dimensions: config.dimensions,
  constraints: config.constraints
}
返回: {
  batches: [
    { queries: [
      { target: "Notion", dimension: "pricing", query: "Notion 定价 价格 方案 site:notion.so", searchType: "targeted" },
      { target: "Notion", dimension: "functionality", query: "Notion 功能特性 文档协作 数据库", searchType: "broad" }
    ]}
  ]
}

规则（prompt 中声明）:
- searchType 由 dimension 决定: pricing→targeted, 其他→broad
- targeted 查询指向官网特定路径
- constraints.timeRange 影响搜索词（如追加 "2025"）
- 每个 (target, dimension) 组合 1-2 个 query

emit TOOL_CALL { toolName: "search_planner", params: { targetCount, dimensionCount } }
→ 执行
emit TOOL_RESULT { toolName: "search_planner", result: { batchCount, totalQueries } }
```

#### Step 3: 按 batch 搜索与抓取

```
for batch in plan.batches:                      // 串行（batch 间可能有数据依赖提示）
  await Promise.allSettled(                     // 并行（batch 内无依赖）
    batch.queries.map(async (q) => {
      // 3a: 搜索
      emit TOOL_CALL { toolName: "web_search", params: { query: q.query }, parentTraceId }

      const searchStart = Date.now();
      const searchRes = await webSearch.execute({ query: q.query, maxResults: 3 }, toolCtx);

      emit TOOL_RESULT { toolName: "web_search", durationMs: Date.now() - searchStart,
        result: { count: searchRes.items.length, urls: searchRes.items.map(i => i.url) },
        parentTraceId }

      // 3b: 选 Top-2，逐个抓取
      const topUrls = searchRes.items.slice(0, 2).map(i => i.url);
      const scrapeResults = await Promise.allSettled(
        topUrls.map(async (url, idx) => {
          emit TOOL_CALL { toolName: "web_scrape", params: { url }, parentTraceId }

          const scrapeStart = Date.now();
          try {
            const scraped = await webScrape.execute({ url }, toolCtx);  // 10s 超时
            emit TOOL_RESULT { toolName: "web_scrape", durationMs: Date.now() - scrapeStart,
              result: { title: scraped.title, length: scraped.content.length } }

            // 3c: 组装 RawDataItem
            return {
              target: q.target,
              dimension: q.dimension,
              content: scraped.content,
              sourceUrl: url,
              sourceTitle: scraped.title,
              retrievedAt: new Date().toISOString(),
              credibility: "unknown" as const,  // Step 4 评分
            } satisfies RawDataItem;
          } catch {
            emit TOOL_CALL { toolName: "web_scrape", /* error payload */ }
            return null;  // 抓取失败不阻塞
          }
        })
      );

      return scrapeResults
        .filter(r => r.status === "fulfilled" && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<RawDataItem>).value);
    })
  );
```

**并发控制**: `Promise.allSettled` 内部每个 query 独立执行，search→scrape 是顺序的（需要等搜索结果），但不同 query 之间完全并行。

#### Step 4: 可信度评估

```
→ tool: credibility_scorer（新增）
对所有 RawDataItem 并行评分:
  Promise.all(items.map(item =>
    tool.execute({ url: item.sourceUrl, content: item.content, retrievedAt: item.retrievedAt }, toolCtx)
  ))

输入: { url, content, retrievedAt }
返回: { credibility: "high"|"medium"|"low"|"unknown", reason: string }

评分规则（在 tool 内部实现）:
1. 域名分析:
   - 包含 "github.com", "apple.com", "google.com" 或匹配 target.name 的域名 → high
   - 包含 "medium.com", "techcrunch.com", "36kr.com" 等媒体 → medium
   - 包含 "zhihu.com", "reddit.com", "v2ex.com" 等 → low
   - 其他 → unknown
2. 时效分析（从 content 中推断日期）:
   - 6 个月内 → 不降级
   - 1 年内 → 降一级
   - 超过 1 年 → 降两级
3. 内容量:
   - content.length < 200 → 降一级

emit TOOL_CALL { toolName: "credibility_scorer", params: { itemCount: items.length } }
→ 执行
emit TOOL_RESULT { toolName: "credibility_scorer",
  result: { breakdown: { high: N, medium: N, low: N, unknown: N } } }
```

#### Step 5: 充分性检查

```
→ tool: sufficiency_checker（新增）
参数: {
  rawDataItems: [{ target, dimension, credibility }],  // 精简版，只传元数据
  dimensions: config.dimensions,
  targetCount: config.targets.length
}
返回: {
  score: 1-5,
  verdict: "sufficient"|"insufficient",
  perDimension: {
    "pricing": { coverage: "0/3", missingTargets: ["竞品B"], highCredCount: 1 },
    ...
  },
  suggestions: ["建议补充竞品B的定价信息：搜索 '竞品B 价格 套餐'"]
}

评估算法（在 tool 内部实现）:
score = 5
- 存在任何 dimension 的 highCredCount < 3: score -= 1
- 存在任何 (target, dimension) 完全无数据: score -= 1
- 定价维度没有官方(high)来源: score -= 1
- 总覆盖率 < 80%: score -= 1
- 总覆盖率 < 50%: score -= 1
score = max(1, score)

emit TOOL_CALL { toolName: "sufficiency_checker" }
→ 执行
emit TOOL_RESULT { toolName: "sufficiency_checker", result: { score, verdict, perDimension } }
```

### 2.4 错误处理

| 错误场景 | 处理策略 |
|----------|----------|
| competitor_url_resolver 对某个 target 失败 | 该 target.url 保持为空，后续用 name 搜索 |
| web_search 网络超时（8s） | 该 query 返回空 items，不阻塞同 batch 其他 query |
| web_scrape 超时（10s）或 HTTP 错误 | 该 URL 返回 null，不阻塞其他 URL |
| credibility_scorer 失败 | 保持 credibility="unknown" |
| sufficiency_checker 失败 | 默认 score=3, verdict="insufficient"，继续 |
| 全部 search 返回空 | emit quality_warning，进入充分性检查 |
| 采集循环 2 轮后 score < 3 | emit quality_warning，仍然写入数据（下游可降级分析） |

### 2.5 依赖的 Tool

| Tool | manifest.json name | 参数 | 返回 | 新/已有 |
|------|-------------------|------|------|---------|
| competitor_url_resolver | `competitor_url_resolver` | `{ name, category }` | `{ url, sourceType }` | 新增 |
| search_planner | `search_planner` | `{ targets, dimensions, constraints }` | `{ batches }` | 新增 |
| web_search | `web_search` | `{ query, maxResults }` | `{ items: [{title, url, snippet}] }` | 已有·已接入 |
| web_scrape | `web_scrape` | `{ url }` | `{ title, content, excerpt, siteName }` | 已有·**待接入** |
| credibility_scorer | `credibility_scorer` | `{ url, content, retrievedAt }` | `{ credibility, reason }` | 新增 |
| sufficiency_checker | `sufficiency_checker` | `{ rawDataItems, dimensions, targetCount }` | `{ score, verdict, perDimension, suggestions }` | 新增 |
