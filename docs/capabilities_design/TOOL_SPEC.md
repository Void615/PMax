# Tool 设计规格文档

> 本文档定义 PMax 横向产品对比链路的全部 17 个 Tool 的接口规范和实现策略。
> 与 `CAPABILITY_WORKFLOW_SPEC_P1/P2.md` 配套，Tool 调用方参照 Capability 规格中的工作流定义。

## 设计约定

- **纯函数 Tool**：导出 `const toolName: Tool = { ... }`，不依赖 LLM
- **LLM 工厂 Tool**：导出 `function createXxx(llm): Tool { ... }`，通过闭包注入 LLM
- 每个 Tool 对应独立的 `backend/tools/<name>/` 目录
- 目录内文件：
  - `manifest.json`: 名称、描述、参数 JSON Schema（用于 LLM function calling）
  - `skill.ts`: Tool 实现
  - 可选 `prompts.ts`: LLM prompt 模板（仅 LLM 工厂 Tool 需要）
- 所有 Tool 的 `execute()` 签名: `(params: Record<string, any>, ctx: ToolContext) => Promise<any>`
- ctx 提供 `traceId` 和 `runId`，用于溯源

---

## 已有且已接入（5 个）

以下 5 个 Tool 已在现有 Capability 中正常使用，列出当前规格供 reference，标注需要修改的内容。

### T1: llm_structured_extract

- **目录:** `backend/tools/llm_structured_extract/`
- **类型:** LLM 工厂
- **工厂签名:** `createLlmStructuredExtract(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "llm_structured_extract",
  "description": "调用 LLM 从文本中提取结构化 JSON 数据",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "待提取的原始文本" },
      "schema": { "type": "object", "description": "期望输出的 JSON Schema" },
      "instruction": { "type": "string", "description": "提取指令" }
    },
    "required": ["text", "instruction"]
  }
}
```

| 输入字段 | 类型 | 必需 | 说明 |
|----------|------|------|------|
| text | string | 是 | 待提取文本 |
| schema | object | 否 | 期望的 JSON Schema |
| instruction | string | 是 | 提取 prompt，告知 LLM 提取什么、输出什么格式 |

**返回:** 解析后的 JSON 对象（类型由 instruction 决定）

**被调用者:** requirement_parsing（Round 1-5，每轮提取增量结构化信息）

**状态:** 已有·已接入·不需修改

---

### T2: web_search

- **目录:** `backend/tools/web_search/`
- **类型:** 纯函数
- **导出:** `export const webSearch: Tool`

```json
{
  "name": "web_search",
  "description": "通用网页搜索，返回搜索结果列表",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "maxResults": { "type": "number", "description": "最大结果数，默认 5" }
    },
    "required": ["query"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |
| maxResults | number | 否 | 最大结果数（默认 5） |

**返回:**
```typescript
{ items: [{ title: string, url: string, snippet: string }], totalResults: number }
```

**实现:** 对接 DuckDuckGo Instant Answer API（`api.duckduckgo.com/?format=json&no_html=1`），8s 超时。三级数据源解析：AbstractText → RelatedTopics → Results。

**错误处理:** 网络异常降级返回空 `{ items: [], totalResults: 0 }`

**被调用者:** information_collection（Step 3，每个 query 调用一次）

**状态:** 已有·已接入·不需修改

---

### T3: matrix_builder

- **目录:** `backend/tools/matrix_builder/`
- **类型:** LLM 工厂
- **工厂签名:** `createMatrixBuilder(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "matrix_builder",
  "description": "基于结构化数据生成对比矩阵（每个属性一行，每个竞品一列）",
  "parameters": {
    "type": "object",
    "properties": {
      "targets": { "type": "array", "items": { "type": "string" } },
      "data": { "type": "string", "description": "结构化对比数据的 JSON 字符串" }
    },
    "required": ["targets", "data"]
  }
}
```

**需扩展的参数（按 CAPABILITY_WORKFLOW_SPEC_P2 4.3）：**

| 新增输入 | 类型 | 必需 | 说明 |
|----------|------|------|------|
| dimensions | string[] | 否 | 对比维度列表 |
| coverageContext | object | 否 | coverageMatrix，告知 LLM 哪些单元格数据缺失 |
| imbalanceWarnings | string[] | 否 | 数据不均衡告警，引导 LLM 在 analysis 中注明 |
| confidencePenalty | number | 否 | 0-2，全局置信度惩罚级别 |

**被调用者:** analysis_reasoning（Step 1）

**返回:**
```typescript
{ comparisonMatrix: [{ dimension, attribute, values: [{ target, value, sourceTraceId }], winner?, confidence, analysis }] }
```

**prompt 模板（需更新 `prompts.ts`）：**

```typescript
// backend/tools/matrix_builder/prompts.ts（新增文件）
export const MATRIX_PROMPT = `你是一个竞品分析师。基于以下结构化对比数据，生成多维度对比矩阵。

竞品：{targets}
维度：{dimensions}
数据：{data}
覆盖情况：{coverageContext}
数据不均衡提醒：{imbalanceWarnings}

对每个可对比的属性，输出：
- dimension: 所属维度
- attribute: 属性名
- values: 各竞品的取值列表 [{target, value, sourceTraceId}]
- winner: 该属性表现最佳的竞品名（无明显优胜者则为 null）
- confidence: 从源数据传播的置信度（high/medium/low）
- analysis: 一句话差异分析

规则：
- 每个属性必须在所有竞品中都有对应的值
- 如果某个竞品在该属性上无数据，value 设为 "无数据"，confidence="low"
- 如果 coverageContext 显示某单元格为 "missing"，在 analysis 中注明"数据不足"
- 如果 imbalanceWarnings 存在，分析中考虑数据不均衡的影响
- {confidencePenaltyRule}
- 不要虚构数据

只输出 JSON: { "comparisonMatrix": [...] }`;
```

**状态:** 已有·已接入·**需扩展参数 + 新增 prompts.ts**

---

### T4: swot_generator

- **目录:** `backend/tools/swot_generator/`
- **类型:** LLM 工厂
- **工厂签名:** `createSwotGenerator(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "swot_generator",
  "description": "基于对比数据为指定竞品生成 SWOT 分析",
  "parameters": {
    "type": "object",
    "properties": {
      "target": { "type": "string", "description": "竞品名称" },
      "data": { "type": "string", "description": "对比数据的 JSON 字符串" }
    },
    "required": ["target", "data"]
  }
}
```

**需扩展的参数：**

| 新增输入 | 类型 | 必需 | 说明 |
|----------|------|------|------|
| comparisonContext | string | 否 | 对比矩阵摘要 JSON，帮助 LLM 理解横向差异 |
| confidencePenalty | number | 否 | 0-2 |

**prompt 模板更新：** 增加 comparisonContext 和 confidencePenalty 的处理逻辑。

**状态:** 已有·已接入·**需扩展参数**

---

### T5: table_composer

- **目录:** `backend/tools/table_composer/`
- **类型:** 纯函数
- **导出:** `export const tableComposer: Tool`

```json
{
  "name": "table_composer",
  "description": "将结构化数据渲染为 Markdown 对比表格",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "表格标题" },
      "targets": { "type": "array", "items": { "type": "string" }, "description": "竞品名称列表（列头）" },
      "rows": { "type": "string", "description": "表格行数据的 JSON 字符串" }
    },
    "required": ["title", "targets", "rows"]
  }
}
```

**需扩展的参数：**

| 新增输入 | 类型 | 必需 | 说明 |
|----------|------|------|------|
| highlights | string[] | 否 | 高亮的 attribute 名列表（winner 所在行），渲染时加粗或标记 |

**返回:** `{ content: string, format: "markdown" }`

**实现:** 纯字符串模板。rows 为 `[{ attribute, values: { target: value } }]`，渲染为 Markdown 表格。highlights 中的 attribute 匹配的行，其值后追加 `**🏆**` 标记。

**被调用者:** artifact_generation（Step 2a）

**状态:** 已有·已接入·**需扩展 highlights 参数**

---

## 已有但未接入（需扩展参数后接入，4 个）

### T6: web_scrape

- **目录:** `backend/tools/web_scrape/`
- **类型:** 纯函数
- **导出:** `export const webScrape: Tool`

```json
{
  "name": "web_scrape",
  "description": "抓取单页内容并清洗提取正文",
  "parameters": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "要抓取的页面 URL" }
    },
    "required": ["url"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| url | string | 是 | 目标页面 URL |

**返回:**
```typescript
{ title: string, content: string, excerpt: string, siteName: string }
```

**实现:** `fetch(url)` → `new JSDOM(html)` → `new Readability(doc).parse()`。10s 超时，Content-Type 检测（跳过非 HTML），Readability 失败时使用 `document.body.textContent`。

**被调用者:** information_collection（Step 3b，对 Top-2 搜索结果逐 URL 调用）

**接入要求:** 在 information_collection Capability 中需要 `Promise.allSettled` 包装，每个 query 的 Top-2 URL 并行抓取。抓取失败不阻塞同 batch 其他 query。

**状态:** 已有·**需接入** information_collection

---

### T7: pricing_normalizer

- **目录:** `backend/tools/pricing_normalizer/`
- **类型:** LLM 工厂
- **工厂签名:** `createPricingNormalizer(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "pricing_normalizer",
  "description": "统一货币和计费周期，提取标准化价格层级",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "价格描述文本" }
    },
    "required": ["text"]
  }
}
```

**需修改的参数（适配 information_processing 的调用协议）：**

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| target | string | 是 | 竞品名称 |
| dimension | string | 是 | 固定 "pricing" |
| rawContent | string | 是 | 拼接后的原始文本（替代原 text 参数） |
| items | object[] | 是 | `[{ traceId, sourceUrl }]`，用于构建 sourceTraceIds |

**返回需修改为:**
```typescript
{
  records: [{
    attribute: string,    // "月费价格"、"免费版功能限制"、"企业版价格"
    value: string,        // "¥99/月"
    rawValue: string,     // "$13.99/month"
    confidence: number    // 0-1
  }]
}
```

**prompt 模板（需更新 `prompts.ts`）：**

```typescript
// backend/tools/pricing_normalizer/prompts.ts（新增文件）
export const PRICING_PROMPT = `从以下价格信息中提取标准化定价信息。

竞品：{target}
原始信息：{rawContent}

提取所有定价相关属性：
- attribute: 属性名（如 "月费价格"、"免费版功能限制"、"企业版年费"）
- value: 归一化值（统一为 CNY，计费周期归一化为月度）
- rawValue: 原文中的原始表述
- confidence: 0-1 置信度

规则：
- 统一货币为 CNY（汇率按近日估算即可）
- 月/年计费归一化到月度（年费 / 12）
- 区分不同用户层级的定价（个人版/团队版/企业版）
- 仅提取原文明确提到的价格，不要推测
- confidence < 0.5 的不要输出

只输出 JSON: { "records": [{ "attribute": "...", "value": "...", "rawValue": "...", "confidence": 0.95 }] }`;
```

**被调用者:** information_processing（Step 2，当 dimension === "pricing" 时使用）

**状态:** 已有·**需修改参数 + 新增 prompts.ts + 接入**

---

### T8: feature_extractor

- **目录:** `backend/tools/feature_extractor/`
- **类型:** LLM 工厂
- **工厂签名:** `createFeatureExtractor(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "feature_extractor",
  "description": "从非结构化文本中提取产品功能点",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "产品描述文本" },
      "target": { "type": "string", "description": "所属产品名称" }
    },
    "required": ["text"]
  }
}
```

**需修改的参数：**

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| target | string | 是 | 竞品名称 |
| dimension | string | 是 | 对比维度 |
| rawContent | string | 是 | 拼接后的原始文本（替代原 text 参数） |
| items | object[] | 是 | `[{ traceId, sourceUrl }]` |

**返回需统一为 records 格式：**
```typescript
{ records: [{ attribute: string, value: string, rawValue?: string, confidence: number }] }
```

**prompt 模板（需更新）：**

```typescript
export const FEATURE_EXTRACT_PROMPT = `你是一个产品信息提取器。从以下原始信息中提取对比数据。

对比维度：{dimension}
竞品：{target}
原始信息：{rawContent}

对每个可识别的属性，提取：
- attribute: 属性名
- value: 归一化值（简明的标准化表达）
- rawValue: 原文中的原始表述
- confidence: 0-1 置信度

规则：
- 只提取与 "{dimension}" 维度直接相关的属性
- 功能描述分解为原子功能点
- 避免提取无关维度的信息（如从 UX 文本中提取价格会导致低 confidence）
- 仅提取原文明确提到的信息，不要推测
- confidence < 0.5 的记录不要输出

只输出 JSON: { "records": [...] }`;
```

**被调用者:** information_processing（Step 2，非 pricing 的所有维度）

**状态:** 已有·**需修改参数 + 新增 prompts.ts + 接入**

---

### T9: markdown_renderer

- **目录:** `backend/tools/markdown_renderer/`
- **类型:** 纯函数
- **导出:** `export const markdownRenderer: Tool`

```json
{
  "name": "markdown_renderer",
  "description": "将结构化 sections 组装为完整 Markdown 文档",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "文档标题" },
      "sections": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "heading": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["heading", "content"]
        }
      }
    },
    "required": ["title", "sections"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | 是 | 文档标题 |
| sections | object[] | 是 | `[{ heading, content }]`，每个 section 一个二级标题 |

**返回:** `{ content: string, format: "markdown" }`

**实现:** 纯字符串模板。组装为 `# {title}\n\n## {heading}\n{content}\n\n` 重复结构。

**被调用者:** artifact_generation（Step 2d，outputFormat 含 "report" 时）

**状态:** 已有·**需接入**

---

## 需新增（10 个）

### T10: dimension_suggester

- **创建路径:** `backend/tools/dimension_suggester/`
- **类型:** LLM 工厂
- **工厂签名:** `createDimensionSuggester(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "dimension_suggester",
  "description": "根据产品品类推荐竞品对比维度",
  "parameters": {
    "type": "object",
    "properties": {
      "targets": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "category": { "type": "string" }
          }
        },
        "description": "竞品列表（含品类）"
      }
    },
    "required": ["targets"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| targets | object[] | 是 | `[{ name, category? }]`，品类信息用于推断维度 |

**返回:**
```typescript
{ suggested: string[], reasoning: string }
```

**实现:** LLM 根据 targets 的品类信息（如 "SaaS"、"短视频"、"电商"），从预设 5 维度中推荐相关维度，并给出理由。品类未知时保守推荐 functionality + pricing。

**prompt 模板:**

```typescript
// backend/tools/dimension_suggester/prompts.ts（新建）
export const DIMENSION_SUGGEST_PROMPT = `根据以下竞品的品类信息，推荐适合的对比维度。

竞品列表：{targets}
预设可用维度：functionality(功能特性), pricing(定价), user_experience(用户体验), market_position(市场地位), technology(技术能力)

请推荐 3-5 个最相关的维度（包括你建议的自定义维度），输出 JSON:
{ "suggested": ["functionality", "pricing", ...], "reasoning": "基于XX品类，建议关注XX" }`;
```

**被调用者:** requirement_parsing（Round 3）

**测试策略:** mock LLM 返回固定 JSON，验证维度推荐逻辑。

---

### T11: competitor_url_resolver

- **创建路径:** `backend/tools/competitor_url_resolver/`
- **类型:** LLM 工厂（辅助少量搜索）
- **工厂签名:** `createCompetitorUrlResolver(llm?: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "competitor_url_resolver",
  "description": "查找竞品的官方网站或应用商店 URL",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "竞品名称" },
      "category": { "type": "string", "description": "产品品类（可选）" }
    },
    "required": ["name"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 产品名称 |
| category | string | 否 | 产品品类 |

**返回:**
```typescript
{ url: string, sourceType: "official" | "appstore" | "database" }
```

**实现策略（两阶段）：**

1. **搜索阶段**：用 `name + "官网"` 作为 query 调 web_search（maxResults=2）
2. **判定阶段**：对搜索结果，LLM 根据域名和 snippet 判断哪一个是官方网站
   - 匹配品牌名或品类关键词 → official
   - 包含 `apps.apple.com` / `play.google.com` → appstore
   - 包含 `g2.com` / `capterra.com` 等 → database
   - 其他 → 取第一个非论坛/非媒体的 URL

**后备策略:** 如果搜索无结果 → 构造 URL 推断：`https://{name}.com`，标记为推测 URL。

**被调用者:** information_collection（Step 1，对每个未提供 url 的 target 并行调用）

**测试策略:** mock web_search 返回，验证 URL 选择和 sourceType 判定。

---

### T12: search_planner

- **创建路径:** `backend/tools/search_planner/`
- **类型:** LLM 工厂
- **工厂签名:** `createSearchPlanner(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "search_planner",
  "description": "将竞品×维度网格分解为分批搜索计划",
  "parameters": {
    "type": "object",
    "properties": {
      "targets": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "url": { "type": "string" },
            "category": { "type": "string" }
          }
        }
      },
      "dimensions": { "type": "array", "items": { "type": "string" } },
      "constraints": {
        "type": "object",
        "properties": {
          "timeRange": { "type": "object" },
          "regions": { "type": "array" },
          "languages": { "type": "array" }
        }
      }
    },
    "required": ["targets", "dimensions"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| targets | object[] | 是 | `[{ name, url?, category? }]` |
| dimensions | string[] | 是 | 对比维度列表 |
| constraints | object | 否 | 时间/地域/语言约束 |

**返回:**
```typescript
{
  batches: [
    { queries: [
      {
        target: string,
        dimension: string,
        query: string,
        searchType: "broad" | "targeted"
      }
    ]}
  ]
}
```

**实现:** LLM 按以下规则生成搜索计划：
- pricing 维度 → `searchType: "targeted"`，query 指向官网定价页（如 `竞品名 定价 价格 site:competitor.com`）
- 其他维度 → `searchType: "broad"`，query 为通用搜索词（如 `竞品名 功能特性 2025`）
- 每个 (target, dimension) 组合生成 1-2 个 query
- constraints.timeRange 影响搜索词
- batch 内 queries 无依赖（可并行），batch 之间建议将 targeted 类型分组优先执行

**prompt 模板:**

```typescript
// backend/tools/search_planner/prompts.ts（新建）
export const SEARCH_PLAN_PROMPT = `你是一个搜索计划生成器。基于以下需求生成分批搜索计划。

竞品列表：{targets}
对比维度：{dimensions}
约束条件：{constraints}

对每个（竞品，维度）组合生成 1-2 个搜索 query。
识别哪些 query 可以并行执行（彼此无数据依赖的放在同一个 batch）。

输出 JSON:
{
  "batches": [
    { "queries": [
      { "target": "竞品A", "dimension": "pricing", "query": "竞品A 定价 价格 site:example.com", "searchType": "targeted" },
      { "target": "竞品A", "dimension": "functionality", "query": "竞品A 功能特性 最新功能介绍", "searchType": "broad" }
    ]}
  ]
}

规则：
- 定价维度 → searchType: "targeted"，query 指向官网特定页面
- 功能维度 → searchType: "broad"，query 含产品名 + 功能关键词
- UX维度 → searchType: "broad"，query 含产品名 + 体验/评价
- 市场地位 → searchType: "broad"，query 含产品名 + 市场份额/用户量
- 技术能力 → searchType: "broad"，query 含产品名 + 技术架构/API
- 同一 batch 内的 queries 可并行（彼此无数据依赖）
- 如果 constraints 有时间范围，影响搜索词（添加年份或"最新"）
- 如果 constraints 有地域，影响搜索词（添加地域名）

只输出 JSON。`;
```

**被调用者:** information_collection（Step 2）

**测试策略:** mock LLM 返回标准 JSON schema 的 SearchPlan。

---

### T13: credibility_scorer

- **创建路径:** `backend/tools/credibility_scorer/`
- **类型:** 纯函数 + 可选 LLM（规则为主，LLM 辅助识别非标准域名）
- **导出:** `export const credibilityScorer: Tool`

```json
{
  "name": "credibility_scorer",
  "description": "根据来源域名、时效性和内容完整性，评估信息可信度",
  "parameters": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "信息源 URL" },
      "content": { "type": "string", "description": "页面内容文本" },
      "retrievedAt": { "type": "string", "description": "采集时间 ISO 8601" }
    },
    "required": ["url", "content", "retrievedAt"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| url | string | 是 | 信息源 URL |
| content | string | 是 | 页面全文内容 |
| retrievedAt | string | 是 | 采集时间 ISO 8601 |

**返回:**
```typescript
{ credibility: "high" | "medium" | "low" | "unknown", reason: string }
```

**评分算法（规则引擎，非 LLM）：**

```
Step 1: 域名评分
  - 域名匹配 target 名称（如 notion.so） → score += 3 (high)
  - 域名在 OFFICIAL_LIST (apple.com, google.com, microsoft.com, github.com, ...) → score += 3
  - 域名在 MEDIA_LIST (techcrunch.com, 36kr.com, theverge.com, ...) → score += 2 (medium)
  - 域名在 UGC_LIST (zhihu.com, reddit.com, v2ex.com, quora.com, xiaohongshu.com, ...) → score += 1 (low)
  - 其他 → score += 2 (medium)

Step 2: 时效评分
  - 从 content 中提取最晚的日期 → 计算距今月数
  - ≤ 6 个月 → 不扣分
  - ≤ 12 个月 → score -= 1
  - > 12 个月 → score -= 2
  - 无法提取日期 → 不扣分（不确定时不惩罚）

Step 3: 内容量评分
  - content.length < 200 → score -= 1

结果映射:
  score >= 3 → "high"
  score >= 2 → "medium"
  score >= 1 → "low"
  score < 1  → "unknown"
```

**OFFICIAL_LIST / MEDIA_LIST / UGC_LIST** 维护在 skill.ts 中作为常量数组。

**被调用者:** information_collection（Step 4，对所有 RawDataItem 并行评分）

**测试策略:** 通过不同域名/内容组合验证评分结果；mock 内容中的日期字符串验证时效逻辑。

---

### T14: sufficiency_checker

- **创建路径:** `backend/tools/sufficiency_checker/`
- **类型:** 规则 + LLM（规则计算硬指标，LLM 生成补充建议）

```json
{
  "name": "sufficiency_checker",
  "description": "评估信息采集的充分性，给出 1-5 评分",
  "parameters": {
    "type": "object",
    "properties": {
      "rawDataItems": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "target": { "type": "string" },
            "dimension": { "type": "string" },
            "credibility": { "type": "string" }
          }
        }
      },
      "dimensions": { "type": "array", "items": { "type": "string" } },
      "targetCount": { "type": "number" }
    },
    "required": ["rawDataItems", "dimensions", "targetCount"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| rawDataItems | object[] | 是 | 精简元数据 `[{ target, dimension, credibility }]` |
| dimensions | string[] | 是 | 对比维度列表 |
| targetCount | number | 是 | 竞品总数 |

**返回:**
```typescript
{
  score: number,           // 1-5
  verdict: "sufficient" | "insufficient",
  perDimension: {
    [dim: string]: {
      coverage: string,      // "2/3"
      missingTargets: string[],
      highCredCount: number
    }
  },
  suggestions: string[]     // 补充建议
}
```

**评分算法：**

```
score = 5

// 硬指标
for each dimension:
  highCred = count of (credibility === "high")
  coveredTargets = unique targets with ≥ 1 item
  coverage = coveredTargets.size / targetCount

  if highCred < 3:                score -= 1
  if coverage < 0.8:              score -= 1
  if coverage < 0.5:              score -= 1
  if dim === "pricing" && highCred === 0: score -= 1  // 定价无官方来源

score = max(1, score)

// 补充建议由 LLM 生成（基于 perDimension 的缺失情况）
suggestions = llm.complete("根据以下覆盖度报告生成补充搜索建议：...")
```

**被调用者:** information_collection（Step 5）

**测试策略:** 构造不同的 rawDataItems 组合（全部 high / 混合 / 大量 missing），验证 score 计算结果。

---

### T15: entity_resolver

- **创建路径:** `backend/tools/entity_resolver/`
- **类型:** LLM 工厂
- **工厂签名:** `createEntityResolver(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "entity_resolver",
  "description": "合并语义相同的属性名，解决同义异名问题",
  "parameters": {
    "type": "object",
    "properties": {
      "dimension": { "type": "string", "description": "所属对比维度" },
      "records": {
        "type": "array",
        "items": { "type": "object" },
        "description": "同一维度下的所有结构化记录"
      }
    },
    "required": ["dimension", "records"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| dimension | string | 是 | 所属维度 |
| records | object[] | 是 | 同一 dimension 下所有 StructuredRecord[] |

**返回:**
```typescript
{ merged: StructuredRecord[] }
```

**实现:** LLM 分析所有 attribute，语义相同的合并：
- 保留最常见的 attribute 名称（或第一个作为 canonical）
- value 取 confidence 最高的记录的 value
- sourceTraceIds 合并去重
- rawValue 合并（用 ` | ` 连接不同的 rawValue）
- 示例输入 → 输出：
  ```
  输入: [
    { attribute: "免广告", target: "A", confidence: 0.9 },
    { attribute: "无广告", target: "A", confidence: 0.7 },
    { attribute: "ad-free", target: "A", confidence: 0.8 }
  ]
  输出 merged: [
    { attribute: "免广告", value: "支持", confidence: 0.9, sourceTraceIds: [all] }
  ]
  ```

**prompt 模板:**

```typescript
// backend/tools/entity_resolver/prompts.ts（新建）
export const ENTITY_RESOLVE_PROMPT = `你是一个数据清理器。合并以下{dimension}维度中语义相同的属性。

当前记录：{records}

识别语义相同的属性（如 "免广告"、"无广告"、"ad-free"、"No Ads" 都指同一个功能），合并它们：
- attribute: 取最常见的表述
- value: 取 confidence 最高的记录的 value
- 合并所有 sourceTraceIds

输出 JSON: { "merged": [...] }

只合并明显语义相同的，不确定的保持原样。只输出 JSON。`;
```

**被调用者:** information_processing（Step 3）

**测试策略:** mock LLM 返回合并后的 JSON，验证 sourceTraceIds 合并逻辑。

---

### T16: conflict_detector

- **创建路径:** `backend/tools/conflict_detector/`
- **类型:** 规则 + LLM

```json
{
  "name": "conflict_detector",
  "description": "检测同一属性的多来源矛盾声明",
  "parameters": {
    "type": "object",
    "properties": {
      "records": {
        "type": "array",
        "items": { "type": "object" },
        "description": "实体对齐后的结构化记录列表"
      }
    },
    "required": ["records"]
  }
}
```

| 输入 | 类型 | 必需 | 说明 |
|------|------|------|------|
| records | object[] | 是 | entity_resolver 合并后的 StructuredRecord[] |

**返回:**
```typescript
{
  records: StructuredRecord[],      // 标记了 status 的记录
  conflicts: [{
    recordA: StructuredRecord,
    recordB: StructuredRecord,
    nature: "value_contradiction" | "credibility_mismatch",
    severity: "high" | "medium" | "low"
  }]
}
```

**检测算法：**

```
Step 1: 规则层（快速过滤明显冲突）
  按 (target, attribute) 分组
  对每组内的多记录比较 value:
    - 完全相同 → clean
    - 语义接近（编辑距离 < 3，忽略大小写/标点/单位差异） → clean
    - 存在语义矛盾词对（"免费" vs "付费"、"支持" vs "不支持"） → 标记

Step 2: LLM 层（处理语义等价但字面不同）
  对规则层无法判断的记录对 → 交给 LLM
  示例: "¥99/月" vs "¥1188/年" → 等价（不冲突）
  示例: "免费" vs "月费 ¥99" → 矛盾（冲突）

Step 3: 标记
  - 有冲突的记录 → status = "conflicting"
  - 仅有低 confidence 的记录（全部 confidence < 0.7） → status = "inferred"
  - 其他 → 保持 "clean"
```

**被调用者:** information_processing（Step 4）

**测试策略:** 构造已知矛盾的记录对，验证检测结果；构造等价值（如不同单位表达）验证不误报。

---

### T17: insight_extractor

- **创建路径:** `backend/tools/insight_extractor/`
- **类型:** LLM 工厂
- **工厂签名:** `createInsightExtractor(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "insight_extractor",
  "description": "以自身产品为参照系，提取差异化竞争洞察",
  "parameters": {
    "type": "object",
    "properties": {
      "comparisonMatrix": { "type": "array", "items": { "type": "object" } },
      "swot": { "type": "array", "items": { "type": "object" } },
      "ownProduct": { "type": "string", "description": "用户自身产品名称" },
      "imbalanceWarnings": { "type": "array", "items": { "type": "string" } },
      "confidencePenalty": { "type": "number", "description": "0-2 全局置信度惩罚" }
    },
    "required": ["comparisonMatrix", "swot", "ownProduct"]
  }
}
```

**返回:**
```typescript
{
  insights: [{
    category: "gap" | "opportunity" | "risk" | "advantage",
    statement: string,        // "你的产品在定价维度显著高于所有竞品"
    evidence: string,         // "你的月费 ¥99 vs 竞品A ¥49、竞品B 免费"
    relatedTargets: string[], // 涉及的竞品名列表
    sourceTraceIds: string[]  // 源自 comparisonMatrix/SWOT 的 traceId
  }]
}
```

**prompt 模板:**

```typescript
// backend/tools/insight_extractor/prompts.ts（新建）
export const INSIGHT_EXTRACT_PROMPT = `你是一个竞争策略分析师。基于以下对比分析数据，提取以"{ownProduct}"为参照系的差异化洞察。

对比矩阵：{comparisonMatrix}
SWOT 分析：{swot}
数据不均衡提醒：{imbalanceWarnings}

请提取 4 类洞察（每类最多 3 条）：
1. gap（差距）: ownProduct 在某个属性上显著弱于至少 2 个竞品
2. advantage（优势）: ownProduct 在某个属性上显著优于至少 2 个竞品
3. opportunity（机会）: 所有竞品都未充分覆盖的维度或属性
4. risk（风险）: 竞品在某个维度快速追赶或已超过 ownProduct

每条 insight 包含：
- category: 分类标签
- statement: 一句话陈述（不超过 30 字）
- evidence: 引用对比数据中的具体数值来支撑
- relatedTargets: 涉及的竞品名
- sourceTraceIds: 来自输入数据的 traceId（不能为空）

规则：
- evidence 必须引用具体数值，不要笼统说"更好"或"更差"
- 如果数据不均衡影响分析公正性，在相关 insight 中注明
- 没有足够数据支撑的类别输出空数组
- confidencePenalty={confidencePenalty} 时，statement 中注明"置信度较低"

只输出 JSON: { "insights": [...] }`;
```

**被调用者:** analysis_reasoning（Step 3）

**测试策略:** mock LLM 返回标准 insights JSON。

---

### T18: comparison_summarizer

- **创建路径:** `backend/tools/comparison_summarizer/`
- **类型:** LLM 工厂
- **工厂签名:** `createComparisonSummarizer(llm: { complete(prompt: string): Promise<string> }): Tool`

```json
{
  "name": "comparison_summarizer",
  "description": "基于对比分析和洞察，生成综合摘要（≤500 字）",
  "parameters": {
    "type": "object",
    "properties": {
      "targets": { "type": "array", "items": { "type": "string" } },
      "matrixSummary": { "type": "string" },
      "swotSummary": { "type": "string" },
      "insights": { "type": "string" },
      "imbalanceWarnings": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["targets", "matrixSummary", "swotSummary", "insights"]
  }
}
```

**返回:** `{ summary: string }`（≤ 500 字）

**prompt 模板:**

```typescript
export const SUMMARY_PROMPT = `基于以下对比分析和洞察，生成一段 500 字以内的综合分析摘要。

竞品：{targets}
对比矩阵摘要：{matrixSummary}
SWOT 摘要：{swotSummary}
差异化洞察：{insights}
数据不均衡提醒：{imbalanceWarnings}

摘要必须涵盖：
1. 整体竞争格局概述（1-2 句）
2. 各竞品的核心差异化优势（每个竞品 1 句）
3. 自身产品的关键差距和机会（2-3 句，重点）
4. 值得关注的趋势或风险（1-2 句）
5. 如果存在数据不均衡，在末尾注明数据局限性

直接输出摘要文本，不要 JSON 包裹。`;
```

**被调用者:** analysis_reasoning（Step 4）

**测试策略:** mock LLM 返回文本摘要。

---

### T19: source_map_builder

- **创建路径:** `backend/tools/source_map_builder/`
- **类型:** 纯函数 + LLM（规则构建主链，LLM 辅助匹配结论片段到原文）

```json
{
  "name": "source_map_builder",
  "description": "从分析结论回溯到原始 URL，构建全链路溯源映射",
  "parameters": {
    "type": "object",
    "properties": {
      "analysisResults": { "type": "object", "description": "完整 AnalysisResult 对象" },
      "rawData": { "type": "object", "description": "原始采集数据" },
      "structuredData": { "type": "object", "description": "结构化数据（可选）" }
    },
    "required": ["analysisResults", "rawData"]
  }
}
```

**返回:**
```typescript
{
  sourceMap: [{
    conclusionFragment: string,   // "竞品A 月费 ¥49/月"
    sourceUrl: string,            // "https://competitor-a.com/pricing"
    sourceExcerpt: string,        // "Pricing plans start at $6.99/month for individuals..." （≤200 字符）
    traceId: string,              // 对应的 WorkflowEvent traceId
    credibility: "high" | "medium" | "low" | "unknown"
  }]
}
```

**构建算法：**

```
1. 展开所有待溯源条目:
   - comparisonMatrix: 每个 FeatureComparison 的每个 values[] （sourceTraceId）
   - swot: 每个 SWOTEntry（sourceTraceIds[]）
   - insights: 每个 Insight（sourceTraceIds[]）

2. 对每个条目，通过 sourceTraceId 查找:
   a) 从 structuredData 中找到对应的 StructuredRecord.sourceTraceIds
   b) 从 rawData 中找到对应的 RawDataItem
   c) 提取 sourceUrl、credibility
   d) 从 RawDataItem.content 中截取相关片段（≤200 字符）
      - LLM 辅助: 传入 conclusionFragment + content，让 LLM 找出最相关的原文段落

3. 不可回溯的标记:
   { traceId: "unavailable", sourceUrl: "", sourceExcerpt: "无法回溯到原始来源" }
```

**被调用者:** artifact_generation（Step 1）

**测试策略:** 构造已知 sourceTraceIds → rawData 链路的 analysisResults，验证 sourceMap 中每个 entry 的 URL 和 excerpt 正确。

---

## Tool 状态汇总

| # | name | 类型 | 归属 Capability | 状态 | 复杂度 |
|---|------|------|----------------|------|--------|
| 1 | llm_structured_extract | LLM 工厂 | requirement_parsing | 已有·已接入 | — |
| 2 | web_search | 纯函数 | information_collection | 已有·已接入 | — |
| 3 | matrix_builder | LLM 工厂 | analysis_reasoning | 已有·已接入·待扩展 | 中 |
| 4 | swot_generator | LLM 工厂 | analysis_reasoning | 已有·已接入·待扩展 | 中 |
| 5 | table_composer | 纯函数 | artifact_generation | 已有·已接入·待扩展 | 低 |
| 6 | web_scrape | 纯函数 | information_collection | 已有·待接入 | 低 |
| 7 | pricing_normalizer | LLM 工厂 | information_processing | 已有·待改参·待接入 | 中 |
| 8 | feature_extractor | LLM 工厂 | information_processing | 已有·待改参·待接入 | 中 |
| 9 | markdown_renderer | 纯函数 | artifact_generation | 已有·待接入 | 低 |
| 10 | dimension_suggester | LLM 工厂 | requirement_parsing | **新增** | 低 |
| 11 | competitor_url_resolver | 搜索+LLM | information_collection | **新增** | 低 |
| 12 | search_planner | LLM 工厂 | information_collection | **新增** | 中 |
| 13 | credibility_scorer | 纯函数+规则 | information_collection | **新增** | 低 |
| 14 | sufficiency_checker | 规则+LLM | information_collection | **新增** | 中 |
| 15 | entity_resolver | LLM 工厂 | information_processing | **新增** | 中 |
| 16 | conflict_detector | 规则+LLM | information_processing | **新增** | 低-中 |
| 17 | insight_extractor | LLM 工厂 | analysis_reasoning | **新增** | 中 |
| 18 | comparison_summarizer | LLM 工厂 | analysis_reasoning | **新增** | 中 |
| 19 | source_map_builder | 规则+LLM | artifact_generation | **新增** | 低 |

**总计: 19 个 Tool**（5 已有已接入 + 4 已有待接入 + 10 新增）

注: 19 个中，`competitor_url_resolver` 内部直接调用 `web_search`（是 Tool 调用 Tool 的唯一特例，因为它是 search 的轻量包装）。
