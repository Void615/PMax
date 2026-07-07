# Phase 2 Capability 全链路实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现产品横向对比场景的 5 个 Capability + 9 个 Tool，完成从用户需求输入到产物输出的端到端闭环。

**Architecture:** Capability 通过工厂函数 + SkillLoader 加载 Tool；CapabilityRegistry 集中注册；GraphRuntime 编排执行。遵循现有 Runtime v2 接口契约，不改动 runtime/ 目录代码。

**Tech Stack:** TypeScript (ESM), Node.js 20+, 现有 Runtime v2 (`@pmax/runtime-ts`)

**Specs:**
- [通用 Agentic Workflow 设计](../../general-workflow-design.md)
- [Phase 2 Capability 全链路设计](../../capability-design-phase2.md)

## Global Constraints

- 不改动 `backend/runtime/` 目录下的任何文件
- 新增代码放在 `backend/capabilities/` 和 `backend/tools/`
- Capability 通过工厂函数模式加载 Tool（模式 B）
- 所有输出类型对 Capability 接口完全兼容
- Tool 目录结构：`tools/{name}/manifest.json` + `tools/{name}/skill.ts`

---

## File Structure Plan

```
backend/
├── runtime/                          # 不变
├── capabilities/
│   ├── shared/
│   │   └── types.ts                  # 跨 Capability 共享类型
│   ├── requirement_parsing/
│   │   ├── index.ts                  # 工厂函数 + Capability
│   │   └── prompts.ts                # LLM prompt 模板
│   ├── information_collection/
│   │   ├── index.ts
│   │   └── prompts.ts
│   ├── analysis_reasoning/
│   │   ├── index.ts
│   │   └── prompts.ts
│   ├── artifact_generation/
│   │   ├── index.ts
│   │   └── source_map.ts
│   └── information_processing/
│       ├── index.ts
│       └── prompts.ts
├── tools/
│   ├── llm_structured_extract/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── web_search/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── web_scrape/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── matrix_builder/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── swot_generator/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── table_composer/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── feature_extractor/
│   │   ├── manifest.json
│   │   └── skill.ts
│   ├── pricing_normalizer/
│   │   ├── manifest.json
│   │   └── skill.ts
│   └── markdown_renderer/
│       ├── manifest.json
│       └── skill.ts
└── entry/
    └── workflow.ts                   # 工作流入口：注册 Capability，启动编排循环
```

---

### Task 1: 共享类型定义

**Files:**
- Create: `backend/capabilities/shared/types.ts`

**Interfaces:**
- Produces: `RequirementConfig`, `Target`, `RawDataItem`, `CollectionResult`, `StructuredRecord`, `ProcessingResult`, `FeatureComparison`, `SWOTEntry`, `AnalysisResult`, `Artifact`, `SourceMapEntry`, `WorkflowData`

- [ ] **Step 1: 创建共享类型文件**

```typescript
// backend/capabilities/shared/types.ts

// ── requirement_parsing 产出 ──

export interface Target {
  name: string;
  url?: string;
  category?: string;
}

export type Dimension =
  | "functionality"
  | "pricing"
  | "user_experience"
  | "market_position"
  | "technology"
  | string;

export type OutputFormat = "comparison_matrix" | "swot" | "feature_list" | "report";

export interface AnalysisConstraints {
  timeRange?: { from?: string; to?: string };
  regions?: string[];
  languages?: string[];
  maxCompetitors?: number;
}

export interface RequirementConfig {
  analysisType: "product_comparison";
  targets: Target[];
  dimensions: Dimension[];
  outputFormat: OutputFormat[];
  constraints: AnalysisConstraints;
  userInput: string; // 保留原始输入
}

// ── information_collection 产出 ──

export interface RawDataItem {
  target: string;
  dimension: string;
  content: string;
  sourceUrl: string;
  sourceTitle?: string;
  retrievedAt: string;
  credibility: "high" | "medium" | "low" | "unknown";
}

export interface CollectionResult {
  items: RawDataItem[];
  uncoveredDimensions: string[];
  summary: string;
}

// ── information_processing 产出 ──

export interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;
  value: string;
  rawValue?: string;
  confidence: number;
  sourceTraceIds: string[];
}

export interface ProcessingResult {
  records: StructuredRecord[];
  uncoveredDimensions: string[];
}

// ── analysis_reasoning 产出 ──

export interface FeatureComparison {
  dimension: string;
  attribute: string;
  values: { target: string; value: string; sourceTraceId: string }[];
  winner?: string;
  analysis: string;
}

export interface SWOTEntry {
  category: "strengths" | "weaknesses" | "opportunities" | "threats";
  target: string;
  point: string;
  evidence: string;
  sourceTraceIds: string[];
}

export interface AnalysisResult {
  comparisonMatrix: FeatureComparison[];
  swot: SWOTEntry[];
  summary: string;
}

// ── artifact_generation 产出 ──

export interface SourceMapEntry {
  conclusionFragment: string;
  sourceUrl: string;
  sourceExcerpt: string;
  traceId: string;
}

export interface Artifact {
  type: "comparison_matrix" | "swot" | "summary";
  format: "markdown" | "html" | "json";
  title: string;
  content: string;
  sourceMap: SourceMapEntry[];
}

// ── RuntimeState.data 数据契约 ──

export interface WorkflowData {
  userInput?: string;
  config?: RequirementConfig;
  rawData?: Record<string, RawDataItem[]>;
  structuredData?: Record<string, StructuredRecord[]>;
  analysisResults?: AnalysisResult;
  artifacts?: Artifact[];
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```powershell
git add backend/capabilities/shared/types.ts
git commit -m "feat: add shared WorkflowData types for Phase 2"
```

---

### Task 2: Tool 基础设施——llm_structured_extract

**Files:**
- Create: `backend/tools/llm_structured_extract/manifest.json`
- Create: `backend/tools/llm_structured_extract/skill.ts`

**Interfaces:**
- Consumes: `Tool` interface from `backend/runtime/capability/types.js`
- Produces: `llm_structured_extract` Tool——对 `ctx.llm.complete()` 的薄包装，提取 JSON

- [ ] **Step 1: 创建 manifest.json**

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

- [ ] **Step 2: 创建 skill.ts**

```typescript
// backend/tools/llm_structured_extract/skill.ts
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

// Tool 需要访问 ctx.llm，但 ToolContext 只有 traceId + runId。
// 因此：llm 客户端通过闭包注入。
export function createLlmStructuredExtract(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "llm_structured_extract",
    description: "调用 LLM 从文本中提取结构化 JSON 数据",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "待提取的原始文本" },
        schema: { type: "object", description: "期望输出的 JSON Schema" },
        instruction: { type: "string", description: "提取指令" },
      },
      required: ["text", "instruction"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<Record<string, any>> {
      const prompt = `${params.instruction}

输入文本：
${params.text}

${params.schema ? `请按以下 JSON Schema 输出：${JSON.stringify(params.schema)}` : "请输出 JSON。"}

只输出 JSON，不要包含其他内容。`;

      const raw = await llm.complete(prompt);
      // 提取 JSON（处理可能的 markdown 代码块包裹）
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
```

- [ ] **Step 3: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```powershell
git add backend/tools/llm_structured_extract/
git commit -m "feat: add llm_structured_extract tool"
```

---

### Task 3: P0 基础 Tool 实现

**Files:**
- Create: `backend/tools/web_search/manifest.json`, `backend/tools/web_search/skill.ts`
- Create: `backend/tools/web_scrape/manifest.json`, `backend/tools/web_scrape/skill.ts`
- Create: `backend/tools/matrix_builder/manifest.json`, `backend/tools/matrix_builder/skill.ts`
- Create: `backend/tools/swot_generator/manifest.json`, `backend/tools/swot_generator/skill.ts`
- Create: `backend/tools/table_composer/manifest.json`, `backend/tools/table_composer/skill.ts`

**Interfaces:**
- Consumes: `Tool` interface + llm client
- Produces: 5 个 P0 Tool

- [ ] **Step 1: web_search Tool**

`backend/tools/web_search/manifest.json`:
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

`backend/tools/web_search/skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface SearchParams {
  query: string;
  maxResults?: number;
}

export const webSearch: Tool = {
  name: "web_search",
  description: "通用网页搜索，返回搜索结果列表",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      maxResults: { type: "number", description: "最大结果数，默认 5" },
    },
    required: ["query"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { query, maxResults = 5 } = params as unknown as SearchParams;
    // TODO: 替换为真实搜索 API（SerpAPI / Tavily / Brave Search）
    // 当前返回 stub 用于验证链路
    return {
      items: [{
        title: `搜索结果: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `关于 "${query}" 的搜索结果占位（接入真实搜索 API 后替换）`,
      }],
      totalResults: 1,
    };
  },
};
```

- [ ] **Step 2: web_scrape Tool**

`backend/tools/web_scrape/manifest.json`:
```json
{
  "name": "web_scrape",
  "description": "抓取并清洗指定 URL 的网页内容",
  "parameters": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "目标网页 URL" },
      "maxChars": { "type": "number", "description": "最大返回字符数，默认 5000" }
    },
    "required": ["url"]
  }
}
```

`backend/tools/web_scrape/skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface ScrapeParams {
  url: string;
  maxChars?: number;
}

export const webScrape: Tool = {
  name: "web_scrape",
  description: "抓取并清洗指定 URL 的网页内容",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "目标网页 URL" },
      maxChars: { type: "number", description: "最大返回字符数，默认 5000" },
    },
    required: ["url"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { url, maxChars = 5000 } = params as unknown as ScrapeParams;
    // TODO: 替换为真实抓取（firecrawl / jina reader / 自建爬虫）
    return {
      url,
      title: `网页: ${url}`,
      content: `[占位] ${url} 的内容。接入真实抓取 API 后替换。`.slice(0, maxChars),
    };
  },
};
```

- [ ] **Step 3: matrix_builder Tool**

`backend/tools/matrix_builder/manifest.json`:
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

`backend/tools/matrix_builder/skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createMatrixBuilder(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "matrix_builder",
    description: "基于结构化数据生成对比矩阵",
    parameters: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" } },
        data: { type: "string", description: "结构化对比数据的 JSON 字符串" },
      },
      required: ["targets", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { targets, data } = params;
      const prompt = `你是一个竞品分析师。基于以下数据生成对比矩阵。

竞品：${JSON.stringify(targets)}
数据：${data}

对每个可对比的属性，输出一行：
- dimension: 所属维度
- attribute: 属性名
- values: 各竞品的取值列表
- winner: 该属性表现最佳的竞品名（无明显优胜者则为 null）
- analysis: 一句话差异分析

输出 JSON: { "comparisonMatrix": [...] }`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
```

- [ ] **Step 4: swot_generator Tool**

`backend/tools/swot_generator/manifest.json`:
```json
{
  "name": "swot_generator",
  "description": "为指定竞品生成 SWOT 分析",
  "parameters": {
    "type": "object",
    "properties": {
      "target": { "type": "string", "description": "竞品名称" },
      "data": { "type": "string", "description": "该竞品的对比数据 JSON 字符串" }
    },
    "required": ["target", "data"]
  }
}
```

`backend/tools/swot_generator/skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createSwotGenerator(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "swot_generator",
    description: "为指定竞品生成 SWOT 分析",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "竞品名称" },
        data: { type: "string", description: "该竞品的对比数据 JSON 字符串" },
      },
      required: ["target", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { target, data } = params;
      const prompt = `基于以下对比数据，为竞品 ${target} 生成 SWOT 分析。

对比数据：${data}

输出 JSON: {
  "swot": [
    { "category": "strengths"|"weaknesses"|"opportunities"|"threats",
      "point": "具体分析点",
      "evidence": "数据中的支撑证据" }
  ]
}

规则：每类 2-5 条。S/W 基于产品自身，O/T 基于外部环境。`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
```

- [ ] **Step 5: table_composer Tool**

`backend/tools/table_composer/manifest.json`:
```json
{
  "name": "table_composer",
  "description": "将对比矩阵数据渲染为 Markdown 表格",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "表格标题" },
      "targets": { "type": "array", "items": { "type": "string" } },
      "rows": { "type": "string", "description": "行数据的 JSON 字符串" }
    },
    "required": ["title", "targets", "rows"]
  }
}
```

`backend/tools/table_composer/skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export const tableComposer: Tool = {
  name: "table_composer",
  description: "将对比矩阵数据渲染为 Markdown 表格",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "表格标题" },
      targets: { type: "array", items: { type: "string" } },
      rows: { type: "string", description: "行数据的 JSON 字符串" },
    },
    required: ["title", "targets", "rows"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { title, targets, rows: rowsJson } = params;
    const rows: { attribute: string; values: Record<string, string> }[] =
      typeof rowsJson === "string" ? JSON.parse(rowsJson) : rowsJson;

    // 构建 Markdown 表格
    const header = `| 属性 | ${targets.join(" | ")} |`;
    const separator = `|------|${targets.map(() => "------").join("|")}|`;
    const body = rows.map((row) => {
      const vals = targets.map((t: string) => row.values[t] ?? "-");
      return `| ${row.attribute} | ${vals.join(" | ")} |`;
    }).join("\n");

    const markdown = `## ${title}\n\n${header}\n${separator}\n${body}`;
    return { format: "markdown", content: markdown };
  },
};
```

- [ ] **Step 6: 验证所有 Tool 编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 7: Commit**

```powershell
git add backend/tools/web_search/ backend/tools/web_scrape/ backend/tools/matrix_builder/ backend/tools/swot_generator/ backend/tools/table_composer/
git commit -m "feat: add P0 tools (web_search, web_scrape, matrix_builder, swot_generator, table_composer)"
```

---

### Task 4: requirement_parsing Capability

**Files:**
- Create: `backend/capabilities/requirement_parsing/prompts.ts`
- Create: `backend/capabilities/requirement_parsing/index.ts`

**Interfaces:**
- Consumes: `Capability`, `RuntimeState`, `RuntimeContext` from runtime
- Consumes: `RequirementConfig`, `Target`, `Dimension`, `OutputFormat` from shared/types
- Produces: `createRequirementParsingCap(llm)` factory → `Capability`

- [ ] **Step 1: 创建 prompts.ts**

```typescript
// backend/capabilities/requirement_parsing/prompts.ts

export const PARSE_PROMPT = `你是一个需求解析器。从用户的自然语言输入中提取竞品分析的结构化参数。

用户输入：{userInput}

请提取以下信息：
1. 竞品列表（至少 2 个）
2. 对比维度（从以下选择：functionality 功能, pricing 定价, user_experience 用户体验, market_position 市场地位, technology 技术能力）
3. 输出产物格式（从以下选择：comparison_matrix 对比矩阵, swot SWOT分析, feature_list 功能列表, report 综合报告）
4. 约束条件（如有时间范围、地域等）

输出 JSON 格式：
{
  "analysisType": "product_comparison",
  "targets": [{ "name": "竞品名", "url": "可选URL", "category": "可选品类" }],
  "dimensions": ["functionality", "pricing"],
  "outputFormat": ["comparison_matrix", "swot"],
  "constraints": {}
}

规则：
- analysisType 目前固定为 "product_comparison"
- 如果用户未明确指出的维度，根据行业常识合理推断并补全
- targets 至少需要 2 个

只输出 JSON。`;
```

- [ ] **Step 2: 创建 Capability 工厂**

```typescript
// backend/capabilities/requirement_parsing/index.ts
import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type { RequirementConfig } from "../shared/types.js";
import { createLlmStructuredExtract } from "../../tools/llm_structured_extract/skill.js";
import { PARSE_PROMPT } from "./prompts.js";

export function createRequirementParsingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const extractTool = createLlmStructuredExtract(llm);

  return {
    id: "requirement_parsing",
    description: "解析用户自然语言需求，提取结构化分析参数（竞品列表、对比维度、产物格式）",
    inputHints: [],
    outputHints: ["config"],
    requires: [],
    tools: [extractTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const userInput = state.data.userInput ?? "";
      await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS", payload: { stage: "parsing" } });

      const tool = this.tools.find(t => t.name === "llm_structured_extract")!;
      const raw = await tool.execute({
        text: userInput,
        instruction: PARSE_PROMPT.replace("{userInput}", userInput),
      }, { traceId: ctx.traceId, runId: ctx.runId });

      const config = raw as unknown as RequirementConfig;
      config.userInput = userInput;

      // 合法性校验
      if (!config.targets || config.targets.length < 2) {
        await ctx.emit({
          uiHint: "workflow_paused",
          eventType: "WORKFLOW_PAUSED",
          payload: { reason: "targets_insufficient", message: "请至少提供 2 个竞品名称" },
        });
        // 仍写入 config 供人工修改
      }

      if (!config.dimensions || config.dimensions.length === 0) {
        config.dimensions = ["functionality", "pricing"]; // 默认维度
      }

      if (!config.outputFormat || config.outputFormat.length === 0) {
        config.outputFormat = ["comparison_matrix", "swot"]; // 默认产物
      }

      if (!config.constraints) {
        config.constraints = {};
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: {
          summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
          config,
        },
      });

      return { patch: { config }, artifacts: [] };
    },
  };
}
```

- [ ] **Step 3: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```powershell
git add backend/capabilities/requirement_parsing/
git commit -m "feat: add requirement_parsing Capability"
```

---

### Task 5: information_collection Capability

**Files:**
- Create: `backend/capabilities/information_collection/prompts.ts`
- Create: `backend/capabilities/information_collection/index.ts`

**Interfaces:**
- Consumes: `config` from state.data
- Consumes: `web_search`, `web_scrape` tools
- Produces: `createInformationCollectionCap()` factory → `Capability`

- [ ] **Step 1: 创建 prompts.ts**

```typescript
// backend/capabilities/information_collection/prompts.ts

export const SEARCH_PLAN_PROMPT = `你是一个竞品信息采集调度器。基于以下需求生成搜索计划。

竞品列表：{targets}
对比维度：{dimensions}

对每个（竞品，维度）组合生成 1-2 个搜索 query。
识别哪些 query 可以并行执行（彼此无数据依赖的放在同一个 batch）。

输出 JSON:
{
  "batches": [
    { "queries": [{ "target": "竞品A", "dimension": "功能", "query": "竞品A 功能特性 会员权益" }] }
  ]
}

规则：
- 搜索 query 要具体，包含竞品名称和维度关键词
- 优先搜索官方来源（官网、应用商店页面）
- 每个 batch 内的 queries 可并行，batch 之间串行（如先采集基础信息再采集细节）

只输出 JSON。`;

export const SUFFICIENCY_PROMPT = `评估以下采集结果的充分性。

需求：{requirement}
已采集数据：{summary}
未覆盖的维度：{uncovered}

评分 1-5（5=完全充分），如果 < 3 分，建议补充哪些方向。

输出 JSON: { "score": 3, "verdict": "sufficient|insufficient", "suggestion": "..." }`;
```

- [ ] **Step 2: 创建 Capability 工厂**

```typescript
// backend/capabilities/information_collection/index.ts
import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem, CollectionResult } from "../shared/types.js";
import { webSearch } from "../../tools/web_search/skill.js";
import { webScrape } from "../../tools/web_scrape/skill.js";
import { SEARCH_PLAN_PROMPT, SUFFICIENCY_PROMPT } from "./prompts.js";

export function createInformationCollectionCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const tools: Tool[] = [webSearch, webScrape];

  return {
    id: "information_collection",
    description: "按竞品×维度网格采集原始信息，支持多轮分竞品采集",
    inputHints: ["config"],
    outputHints: ["rawData"],
    requires: ["requirement_parsing"],
    tools,

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      if (!config) {
        return { patch: {}, artifacts: [] };
      }

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "planning", message: `准备采集 ${config.targets.length} 个竞品 × ${config.dimensions.length} 个维度的信息` },
      });

      // 1. LLM 生成搜索计划
      const searchTool = tools.find(t => t.name === "web_search")!;
      const scrapeTool = tools.find(t => t.name === "web_scrape")!;

      const planPrompt = SEARCH_PLAN_PROMPT
        .replace("{targets}", JSON.stringify(config.targets.map(t => t.name)))
        .replace("{dimensions}", JSON.stringify(config.dimensions));

      const planRaw = await llm.complete(planPrompt);
      const jsonMatch = planRaw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, planRaw];
      const plan = JSON.parse((jsonMatch[1] ?? planRaw).trim());

      const allItems: RawDataItem[] = [];

      // 2. 按 batch 执行搜索
      for (const batch of (plan.batches ?? [{ queries: [] }])) {
        const queries: { target: string; dimension: string; query: string }[] = batch.queries ?? [];

        const results = await Promise.allSettled(
          queries.map(async (q) => {
            await ctx.emit({
              uiHint: "tool_call",
              eventType: "TOOL_CALL",
              payload: { toolName: "web_search", params: { query: q.query } },
            });

            const start = Date.now();
            const res = await searchTool.execute({ query: q.query, maxResults: 3 }, { traceId: ctx.traceId, runId: ctx.runId });

            const item: RawDataItem = {
              target: q.target,
              dimension: q.dimension,
              content: res.items?.[0]?.snippet ?? JSON.stringify(res),
              sourceUrl: res.items?.[0]?.url ?? "",
              sourceTitle: res.items?.[0]?.title,
              retrievedAt: new Date().toISOString(),
              credibility: "medium",
            };

            await ctx.emit({
              uiHint: "tool_result",
              eventType: "TOOL_RESULT",
              payload: { toolName: "web_search", durationMs: Date.now() - start, result: { title: item.sourceTitle } },
            });

            return item;
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled") allItems.push(r.value);
        }
      }

      // 3. 评估充分性
      const summary = `${allItems.length} 条原始信息，覆盖 ${new Set(allItems.map(i => i.dimension)).size} 个维度`;
      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { summary, itemCount: allItems.length },
      });

      // 按 dimension 分组存储
      const rawData: Record<string, RawDataItem[]> = {};
      for (const item of allItems) {
        const key = item.dimension;
        if (!rawData[key]) rawData[key] = [];
        rawData[key].push(item);
      }

      return { patch: { rawData }, artifacts: [] };
    },
  };
}
```

- [ ] **Step 3: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```powershell
git add backend/capabilities/information_collection/
git commit -m "feat: add information_collection Capability"
```

---

### Task 6: analysis_reasoning Capability

**Files:**
- Create: `backend/capabilities/analysis_reasoning/prompts.ts`
- Create: `backend/capabilities/analysis_reasoning/index.ts`

**Interfaces:**
- Consumes: `config`, `rawData` or `structuredData` from state.data
- Consumes: `matrix_builder`, `swot_generator` tools (LLM-dependent)
- Produces: `createAnalysisReasoningCap(llm)` factory → `Capability`

- [ ] **Step 1: 创建 prompts.ts**

```typescript
// backend/capabilities/analysis_reasoning/prompts.ts

export const COMPARISON_PROMPT = `你是一个竞品分析师。基于以下结构化对比数据，生成对比分析报告。

竞品：{targets}
维度：{dimensions}
数据：{data}

对每个可对比的属性，输出：
- dimension: 所属维度
- attribute: 属性名
- values: 各竞品的取值列表 [{target, value, sourceTraceId}]
- winner: 该属性表现最佳的竞品名（无明显优胜者则为 null）
- analysis: 一句差异分析

输出 JSON: { "comparisonMatrix": [...] }

规则：
- 每个属性必须在所有竞品中都有对应的值
- 如果某个竞品在该属性上无数据，value 设为 "无数据"
- analysis 要指出差异原因或值得关注的点
- 不要虚构数据

只输出 JSON。`;

export const SWOT_PROMPT = `基于以下对比数据，为竞品 {target} 生成 SWOT 分析。

对比数据：{data}

输出 JSON: {
  "swot": [
    { "category": "strengths"|"weaknesses"|"opportunities"|"threats",
      "point": "具体分析点（一句话）",
      "evidence": "数据支撑或推理依据",
      "sourceTraceIds": [] }
  ]
}

规则：
- 每类 2-5 条
- S/W 基于产品自身对比数据（功能、定价、体验等）
- O/T 基于外部环境推断（市场趋势、差异化机会、威胁）
- evidence 必须引用对比数据中的具体发现
- sourceTraceIds 对应原始数据的 traceId

只输出 JSON。`;

export const SUMMARY_PROMPT = `基于以下对比分析和 SWOT 结果，生成一段 200 字以内的综合分析摘要。

竞品：{targets}
对比矩阵摘要：{matrixSummary}
SWOT 摘要：{swotSummary}

摘要应涵盖：
1. 整体竞争格局概述
2. 各竞品的核心差异化优势
3. 关键发现或值得关注的趋势

直接输出摘要文本，不要 JSON。`;
```

- [ ] **Step 2: 创建 Capability 工厂**

```typescript
// backend/capabilities/analysis_reasoning/index.ts
import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type {
  RequirementConfig,
  RawDataItem,
  StructuredRecord,
  FeatureComparison,
  SWOTEntry,
  AnalysisResult,
} from "../shared/types.js";
import { createMatrixBuilder } from "../../tools/matrix_builder/skill.js";
import { createSwotGenerator } from "../../tools/swot_generator/skill.js";
import { COMPARISON_PROMPT, SUMMARY_PROMPT } from "./prompts.js";

export function createAnalysisReasoningCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const matrixTool = createMatrixBuilder(llm);
  const swotTool = createSwotGenerator(llm);

  return {
    id: "analysis_reasoning",
    description: "对采集数据进行多维对比分析和 SWOT 生成",
    inputHints: ["config", "rawData", "structuredData"],
    outputHints: ["analysisResults"],
    requires: ["information_collection"],
    tools: [matrixTool, swotTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
      const structuredData = state.data.structuredData as Record<string, StructuredRecord[]> | undefined;

      if (!config) return { patch: {}, artifacts: [] };

      // 优先使用 structuredData，降级到 rawData
      const dataForAnalysis = structuredData
        ? JSON.stringify(structuredData)
        : JSON.stringify(rawData ?? {});

      const targets = config.targets.map(t => t.name);

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "comparison", message: "生成对比矩阵..." },
      });

      // Phase 1: 对比矩阵
      const matrixResult = await matrixTool.execute({
        targets,
        data: dataForAnalysis,
      }, { traceId: ctx.traceId, runId: ctx.runId });

      await ctx.emit({
        uiHint: "tool_result",
        eventType: "TOOL_RESULT",
        payload: { toolName: "matrix_builder", result: { rows: matrixResult.comparisonMatrix?.length ?? 0 } },
      });

      // Phase 2: SWOT（每个竞品并行）
      const swotEntries: SWOTEntry[] = [];
      const swotResults = await Promise.allSettled(
        targets.map(async (target) => {
          await ctx.emit({
            uiHint: "tool_call",
            eventType: "TOOL_CALL",
            payload: { toolName: "swot_generator", params: { target } },
          });
          const res = await swotTool.execute({ target, data: dataForAnalysis }, { traceId: ctx.traceId, runId: ctx.runId });
          await ctx.emit({
            uiHint: "tool_result",
            eventType: "TOOL_RESULT",
            payload: { toolName: "swot_generator", result: { target, entries: res.swot?.length ?? 0 } },
          });
          return res;
        })
      );

      for (const r of swotResults) {
        if (r.status === "fulfilled" && r.value.swot) {
          swotEntries.push(...r.value.swot.map((s: any) => ({ ...s, target: s.target ?? "unknown" })));
        }
      }

      // Phase 3: LLM 综合归纳
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "summarizing", message: "生成综合分析摘要..." },
      });

      const summaryPrompt = SUMMARY_PROMPT
        .replace("{targets}", targets.join("、"))
        .replace("{matrixSummary}", JSON.stringify(matrixResult.comparisonMatrix?.slice(0, 5) ?? []))
        .replace("{swotSummary}", JSON.stringify(swotEntries.slice(0, 10)));

      const summary = await llm.complete(summaryPrompt);

      const analysisResult: AnalysisResult = {
        comparisonMatrix: matrixResult.comparisonMatrix ?? [],
        swot: swotEntries,
        summary: summary.trim().slice(0, 500),
      };

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: {
          summary: `生成 ${analysisResult.comparisonMatrix.length} 条对比 + ${analysisResult.swot.length} 条 SWOT`,
        },
      });

      return { patch: { analysisResults: analysisResult }, artifacts: [] };
    },
  };
}
```

- [ ] **Step 3: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```powershell
git add backend/capabilities/analysis_reasoning/
git commit -m "feat: add analysis_reasoning Capability"
```

---

### Task 7: artifact_generation Capability

**Files:**
- Create: `backend/capabilities/artifact_generation/source_map.ts`
- Create: `backend/capabilities/artifact_generation/index.ts`

**Interfaces:**
- Consumes: `analysisResults`, `config.outputFormat`, `rawData` from state.data
- Consumes: `table_composer`, `markdown_renderer` tools
- Produces: `createArtifactGenerationCap()` factory → `Capability`

- [ ] **Step 1: 创建 source_map.ts**

```typescript
// backend/capabilities/artifact_generation/source_map.ts
import type { SourceMapEntry, FeatureComparison, RawDataItem } from "../shared/types.js";

export function buildSourceMap(
  analysisResults: { comparisonMatrix: FeatureComparison[] },
  rawData: Record<string, RawDataItem[]> | undefined
): SourceMapEntry[] {
  const map: SourceMapEntry[] = [];
  const allRawItems = rawData ? Object.values(rawData).flat() : [];

  for (const entry of analysisResults.comparisonMatrix ?? []) {
    for (const val of entry.values ?? []) {
      const src = allRawItems.find(r => {
        // 简单文本匹配查找来源
        return r.content.includes(val.value) || val.value.includes(r.content.slice(0, 20));
      });
      if (src) {
        map.push({
          conclusionFragment: `${entry.attribute}: ${val.target}=${val.value}`,
          sourceUrl: src.sourceUrl,
          sourceExcerpt: src.content.slice(0, 200),
          traceId: val.sourceTraceId ?? "",
        });
      }
    }
  }

  return map;
}
```

- [ ] **Step 2: 创建 Capability 工厂**

```typescript
// backend/capabilities/artifact_generation/index.ts
import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, AnalysisResult, Artifact, SourceMapEntry } from "../shared/types.js";
import { tableComposer } from "../../tools/table_composer/skill.js";
import { buildSourceMap } from "./source_map.js";

export function createArtifactGenerationCap(): Capability {
  return {
    id: "artifact_generation",
    description: "将分析结果格式化为最终可交付产物（对比表格 + SWOT + 溯源）",
    inputHints: ["analysisResults", "config", "rawData"],
    outputHints: ["artifacts"],
    requires: ["analysis_reasoning"],
    tools: [tableComposer],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const analysisResults = state.data.analysisResults as AnalysisResult;
      const rawData = state.data.rawData as Record<string, any> | undefined;

      if (!config || !analysisResults) {
        return { patch: {}, artifacts: [] };
      }

      const artifacts: Artifact[] = [];
      const sourceMap = buildSourceMap(analysisResults, rawData);

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "rendering", message: `生成 ${config.outputFormat.join("、")}` },
      });

      // 1. 对比矩阵表格
      if (config.outputFormat.includes("comparison_matrix")) {
        const rows = analysisResults.comparisonMatrix.map(c => ({
          attribute: c.attribute,
          values: Object.fromEntries((c.values ?? []).map(v => [v.target, v.value])),
        }));

        const tool = this.tools.find(t => t.name === "table_composer")!;
        await ctx.emit({
          uiHint: "tool_call",
          eventType: "TOOL_CALL",
          payload: { toolName: "table_composer", params: { title: "产品对比矩阵" } },
        });

        const result = await tool.execute({
          title: "产品对比矩阵",
          targets: config.targets.map(t => t.name),
          rows: JSON.stringify(rows),
        }, { traceId: ctx.traceId, runId: ctx.runId });

        await ctx.emit({
          uiHint: "tool_result",
          eventType: "TOOL_RESULT",
          payload: { toolName: "table_composer", result: { format: result.format } },
        });

        artifacts.push({
          type: "comparison_matrix",
          format: result.format ?? "markdown",
          title: "产品对比矩阵",
          content: result.content ?? "",
          sourceMap,
        });
      }

      // 2. SWOT
      if (config.outputFormat.includes("swot")) {
        const targets = config.targets.map(t => t.name);
        for (const target of targets) {
          const swotForTarget = analysisResults.swot.filter(s => s.target === target);
          const content = [
            `## ${target} SWOT 分析`,
            "",
            "### 优势 (Strengths)",
            ...swotForTarget.filter(s => s.category === "strengths").map(s => `- ${s.point}`),
            "",
            "### 劣势 (Weaknesses)",
            ...swotForTarget.filter(s => s.category === "weaknesses").map(s => `- ${s.point}`),
            "",
            "### 机会 (Opportunities)",
            ...swotForTarget.filter(s => s.category === "opportunities").map(s => `- ${s.point}`),
            "",
            "### 威胁 (Threats)",
            ...swotForTarget.filter(s => s.category === "threats").map(s => `- ${s.point}`),
          ].join("\n");

          artifacts.push({
            type: "swot",
            format: "markdown",
            title: `${target} SWOT 分析`,
            content,
            sourceMap,
          });
        }
      }

      // 3. 综合分析摘要
      artifacts.push({
        type: "summary",
        format: "markdown",
        title: "综合分析摘要",
        content: `## 综合分析摘要\n\n${analysisResults.summary}`,
        sourceMap,
      });

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { artifactCount: artifacts.length },
      });

      // 4. 发送 workflow_complete
      await ctx.emit({
        uiHint: "workflow_complete",
        eventType: "WORKFLOW_COMPLETE",
        payload: { artifactCount: artifacts.length, sourceMapCount: sourceMap.length },
      });

      return { patch: { artifacts }, artifacts: [] };
    },
  };
}
```

- [ ] **Step 3: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```powershell
git add backend/capabilities/artifact_generation/
git commit -m "feat: add artifact_generation Capability with source map"
```

---

### Task 8: 工作流入口——注册与编排

**Files:**
- Create: `backend/entry/workflow.ts`

**Interfaces:**
- Consumes: `CapabilityRegistry`, `GraphRuntime`, `Orchestrator`, `RuntimeContext` from runtime
- Consumes: All Capability factories
- Produces: `createWorkflow(llm, eventBus)` → `{ run }` 入口函数

- [ ] **Step 1: 创建工作流入口**

```typescript
// backend/entry/workflow.ts
import {
  CapabilityRegistry,
  GraphRuntime,
  Orchestrator,
} from "../runtime/index.js";
import type {
  RuntimeContext,
  EventBus,
  RuntimeState,
} from "../runtime/index.js";
import { createRequirementParsingCap } from "../capabilities/requirement_parsing/index.js";
import { createInformationCollectionCap } from "../capabilities/information_collection/index.js";
import { createAnalysisReasoningCap } from "../capabilities/analysis_reasoning/index.js";
import { createArtifactGenerationCap } from "../capabilities/artifact_generation/index.js";
import type { WorkflowData } from "../capabilities/shared/types.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan?(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<Record<string, any>>;
  synthesize?(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export function createWorkflow(llm: LlmClient, eventBus: EventBus) {
  const registry = new CapabilityRegistry();

  // 注册所有 Capability
  registry.register(createRequirementParsingCap(llm));
  registry.register(createInformationCollectionCap(llm));
  registry.register(createAnalysisReasoningCap(llm));
  registry.register(createArtifactGenerationCap());

  const runtime = new GraphRuntime(registry);

  return {
    async run(userInput: string): Promise<RuntimeState> {
      const state = runtime.initialState({ userInput } as WorkflowData);

      // 构建 RuntimeContext
      const ctx: RuntimeContext = {
        traceId: "",
        workflowId: "default",
        runId: state.runtime.runId,
        nodeId: "",
        iteration: 0,
        signal: new AbortController().signal,
        llm: {
          complete: llm.complete,
          plan: llm.plan ?? (async () => ({ phases: [] })),
          synthesize: llm.synthesize ?? (async (_, r) => r),
        },
        emit: async (event, _opts) => {
          await eventBus.publish({
            traceId: ctx.traceId,
            eventType: event.eventType ?? "EVENT",
            uiHint: event.uiHint,
            nodeId: ctx.nodeId,
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            payload: event.payload ?? {},
            timestamp: new Date().toISOString(),
          });
        },
        saveArtifact: async (_draft) => "",
      };

      // Orchestrator 编排循环
      const orch = new Orchestrator(registry, ctx, eventBus);
      await orch.initialize(userInput);

      let currentState = state;

      // 先执行入口节点
      currentState = await runtime.executeStep("requirement_parsing", currentState, {
        ...ctx,
        nodeId: "requirement_parsing",
      });

      // 进入编排循环
      let lastNodeId = "requirement_parsing";
      while (orch.hasMoreCandidates(currentState)) {
        // 在生产环境中，这里应等待人工路由决策
        // 当前简化：自动选择第一个 pending 候选
        const suggestions = await orch.suggestRoute(lastNodeId, currentState, "state summary");

        if (suggestions.length === 0) break;

        const nextNode = suggestions[0].nodeId;
        currentState = await runtime.executeStep(nextNode, currentState, {
          ...ctx,
          nodeId: nextNode,
        });
        lastNodeId = nextNode;

        // artifact_generation 是终止节点
        if (nextNode === "artifact_generation") break;
      }

      return currentState;
    },
  };
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```powershell
git add backend/entry/
git commit -m "feat: add workflow entry point with Capability registration and orchestration loop"
```

---

### Task 9: information_processing Capability（增强节点）

**Files:**
- Create: `backend/capabilities/information_processing/prompts.ts`
- Create: `backend/capabilities/information_processing/index.ts`

**Interfaces:**
- Consumes: `rawData`, `config.dimensions` from state.data
- Consumes: `feature_extractor`, `pricing_normalizer` tools (LLM-dependent)
- Produces: `createInformationProcessingCap(llm)` factory → `Capability`

- [ ] **Step 1: 创建 prompts.ts**

```typescript
// backend/capabilities/information_processing/prompts.ts

export const EXTRACT_PROMPT = `你是一个数据提取器。从以下原始竞品信息中提取结构化的对比数据。

对比维度：{dimension}
竞品：{target}
原始信息：
{rawContent}

对每个可识别的属性，提取：
- attribute: 属性名（如 "月费价格"、"免费版功能限制"）
- value: 归一化值（标准化表达，如统一货币和计费周期）
- confidence: 0-1 置信度

输出 JSON: { "records": [{ "attribute": "...", "value": "...", "confidence": 0.9 }] }

规则：
- 只提取原文明确提到的信息，不要推测
- 价格信息要统一货币和计费周期
- 功能描述分解为原子功能点
- confidence < 0.5 的记录不要输出

只输出 JSON。`;
```

- [ ] **Step 2: 创建 Capability 工厂**

```typescript
// backend/capabilities/information_processing/index.ts
import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem, StructuredRecord, ProcessingResult } from "../shared/types.js";
import { EXTRACT_PROMPT } from "./prompts.js";

export function createInformationProcessingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  return {
    id: "information_processing",
    description: "清洗、去重、归一化原始采集数据，转化为结构化可对比格式",
    inputHints: ["rawData", "config"],
    outputHints: ["structuredData"],
    requires: ["information_collection"],
    tools: [],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;

      if (!config || !rawData) return { patch: {}, artifacts: [] };

      const allRecords: StructuredRecord[] = [];

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "processing", dimensions: config.dimensions },
      });

      // 按 (target, dimension) 分组处理
      for (const target of config.targets) {
        for (const dimension of config.dimensions) {
          const items = rawData[dimension]?.filter(i => i.target === target.name) ?? [];
          if (items.length === 0) continue;

          const rawContent = items.map(i => i.content).join("\n---\n");
          const prompt = EXTRACT_PROMPT
            .replace("{dimension}", dimension)
            .replace("{target}", target.name)
            .replace("{rawContent}", rawContent.slice(0, 8000));

          const raw = await llm.complete(prompt);
          const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
          try {
            const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());
            for (const rec of (extracted.records ?? [])) {
              if ((rec.confidence ?? 0) >= 0.5) {
                allRecords.push({
                  target: target.name,
                  dimension,
                  attribute: rec.attribute,
                  value: rec.value,
                  rawValue: rec.rawValue,
                  confidence: rec.confidence,
                  sourceTraceIds: items.map(i => ""), // 简化：实际应从 rawData 中获取 traceId
                });
              }
            }
          } catch {
            // LLM 输出解析失败，跳过
          }

          await ctx.emit({
            uiHint: "node_progress",
            eventType: "NODE_PROGRESS",
            payload: { stage: "processing", target: target.name, dimension, extracted: allRecords.length },
          });
        }
      }

      const result: ProcessingResult = {
        records: allRecords,
        uncoveredDimensions: config.dimensions.filter(
          d => !allRecords.some(r => r.dimension === d)
        ),
      };

      // 按 dimension 分组
      const structuredData: Record<string, StructuredRecord[]> = {};
      for (const rec of allRecords) {
        if (!structuredData[rec.dimension]) structuredData[rec.dimension] = [];
        structuredData[rec.dimension].push(rec);
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { recordCount: allRecords.length, dimensions: Object.keys(structuredData) },
      });

      return { patch: { structuredData }, artifacts: [] };
    },
  };
}
```

- [ ] **Step 3: 更新 workflow.ts 注册 information_processing**

在 `backend/entry/workflow.ts` 的 `createWorkflow` 函数中添加：

```typescript
// 在其他 import 后添加
import { createInformationProcessingCap } from "../capabilities/information_processing/index.js";

// 在其他 registry.register() 后添加
registry.register(createInformationProcessingCap(llm));
```

- [ ] **Step 4: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```powershell
git add backend/capabilities/information_processing/ backend/entry/workflow.ts
git commit -m "feat: add information_processing Capability and wire into workflow"
```

---

### Task 10: 集成验证——端到端测试

**Files:**
- Create: `backend/entry/__tests__/workflow.test.ts`

**Interfaces:**
- Consumes: `createWorkflow` from entry
- Produces: 集成测试验证 5 个 Capability 的端到端数据流

- [ ] **Step 1: 创建 mock LLM client**

```typescript
// backend/entry/__tests__/workflow.test.ts
import { describe, it, expect } from "vitest";
import { createWorkflow } from "../workflow.js";
import type { EventBus } from "../../runtime/index.js";
import type { WorkflowData } from "../../capabilities/shared/types.js";

// Mock LLM: 返回固定输出，验证数据流
function createMockLlm() {
  return {
    async complete(prompt: string): Promise<string> {
      if (prompt.includes("需求解析器")) {
        return JSON.stringify({
          analysisType: "product_comparison",
          targets: [{ name: "微博" }, { name: "知乎" }],
          dimensions: ["functionality", "pricing"],
          outputFormat: ["comparison_matrix", "swot"],
          constraints: {},
        });
      }
      if (prompt.includes("搜索计划")) {
        return JSON.stringify({
          batches: [{
            queries: [
              { target: "微博", dimension: "functionality", query: "微博 会员 功能" },
              { target: "知乎", dimension: "functionality", query: "知乎 盐选 功能" },
            ],
          }],
        });
      }
      if (prompt.includes("竞品分析师")) {
        return JSON.stringify({
          comparisonMatrix: [
            {
              dimension: "functionality",
              attribute: "去广告",
              values: [{ target: "微博", value: "支持" }, { target: "知乎", value: "支持" }],
              winner: null,
              analysis: "两者均支持去广告",
            },
          ],
        });
      }
      if (prompt.includes("SWOT 分析")) {
        return JSON.stringify({
          swot: [
            { category: "strengths", point: "内容丰富", evidence: "对比数据显示功能全面" },
            { category: "weaknesses", point: "价格较高", evidence: "定价数据" },
          ],
        });
      }
      // summary
      return "微博和知乎在会员功能上各有侧重，微博偏向社交增值，知乎偏向内容获取。";
    },
  };
}

// Mock EventBus: 不抛异常即可
function createMockEventBus(): EventBus {
  return {
    async publish(_event: any): Promise<void> { /* no-op */ },
    async subscribe(): Promise<void> { /* no-op */ },
    async unsubscribe(): Promise<void> { /* no-op */ },
  };
}
```

- [ ] **Step 2: 创建端到端测试**

```typescript
// 追加到同一个文件中
describe("Phase 2 全链路 E2E", () => {
  it("should complete product comparison workflow end to end", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("对比微博和知乎的会员功能差异");

    const data = state.data as WorkflowData;

    // 1. config 已生成
    expect(data.config).toBeDefined();
    expect(data.config!.targets).toHaveLength(2);
    expect(data.config!.dimensions).toContain("functionality");

    // 2. rawData 已采集
    expect(data.rawData).toBeDefined();

    // 3. analysisResults 已生成
    expect(data.analysisResults).toBeDefined();
    expect(data.analysisResults!.comparisonMatrix.length).toBeGreaterThan(0);
    expect(data.analysisResults!.summary).toBeTruthy();

    // 4. artifacts 已生成
    expect(data.artifacts).toBeDefined();
    expect(data.artifacts!.length).toBeGreaterThan(0);
    // 至少包含 comparison_matrix 和 summary
    const artifactTypes = data.artifacts!.map(a => a.type);
    expect(artifactTypes).toContain("comparison_matrix");
    expect(artifactTypes).toContain("summary");
    // 至少有一个 SWOT artifact
    expect(artifactTypes).toContain("swot");
  });

  it("should handle empty user input gracefully", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("");
    const data = state.data as WorkflowData;

    expect(data.config).toBeDefined();
  });

  it("should contain source maps in artifacts", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("对比微博和知乎");
    const data = state.data as WorkflowData;

    expect(data.artifacts).toBeDefined();
    for (const artifact of data.artifacts!) {
      expect(artifact.sourceMap).toBeDefined();
      expect(Array.isArray(artifact.sourceMap)).toBe(true);
      expect(artifact.content).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: 安装 vitest**

```powershell
npm install -D vitest
```

- [ ] **Step 4: 添加 test script 到 package.json**

在 `backend/runtime/package.json` 的 `scripts` 中添加：

```json
"test": "vitest run"
```

- [ ] **Step 5: 运行测试**

```powershell
npx vitest run
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/entry/__tests__/ backend/runtime/package.json
git commit -m "test: add E2E workflow tests for Phase 2 Capability chain"
```

---

### Task 11: P1 Tool 实现（增强）

**Files:**
- Create: `backend/tools/feature_extractor/manifest.json`, `backend/tools/feature_extractor/skill.ts`
- Create: `backend/tools/pricing_normalizer/manifest.json`, `backend/tools/pricing_normalizer/skill.ts`
- Create: `backend/tools/markdown_renderer/manifest.json`, `backend/tools/markdown_renderer/skill.ts`

- [ ] **Step 1: feature_extractor**

`manifest.json` 结构同前。`skill.ts`:
```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createFeatureExtractor(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "feature_extractor",
    description: "从产品功能描述文本中提取结构化功能点",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "功能描述文本" },
      },
      required: ["text"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const prompt = `从以下产品功能描述中提取原子功能点列表，每个功能点一句话概括。
输出 JSON: { "features": ["功能点1", "功能点2", ...] }
文本：${params.text}`;
      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
```

- [ ] **Step 2: pricing_normalizer**

```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createPricingNormalizer(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "pricing_normalizer",
    description: "统一货币和计费周期，提取标准化价格层级",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "价格描述文本" },
      },
      required: ["text"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const prompt = `从以下价格信息中提取标准化定价层级。统一为 CNY/月。如果无法确定，标注 confidence 降低。
文本：${params.text}
输出 JSON: { "tiers": [{ "name": "套餐名", "price": 数字, "currency": "CNY", "billingCycle": "monthly", "confidence": 0.9 }] }`;
      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
```

- [ ] **Step 3: markdown_renderer**

```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export const markdownRenderer: Tool = {
  name: "markdown_renderer",
  description: "将结构化数据渲染为格式化的 Markdown 文档",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      sections: { type: "string", description: "章节数组 JSON" },
    },
    required: ["title", "sections"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { title, sections: sectionsJson } = params;
    const sections: { heading: string; body: string }[] =
      typeof sectionsJson === "string" ? JSON.parse(sectionsJson) : sectionsJson;

    const content = [
      `# ${title}`,
      "",
      ...sections.flatMap(s => [`## ${s.heading}`, "", s.body, ""]),
    ].join("\n");

    return { format: "markdown", content };
  },
};
```

- [ ] **Step 4: 验证编译并 commit**

```powershell
npx tsc --noEmit
git add backend/tools/feature_extractor/ backend/tools/pricing_normalizer/ backend/tools/markdown_renderer/
git commit -m "feat: add P1 tools (feature_extractor, pricing_normalizer, markdown_renderer)"
```
