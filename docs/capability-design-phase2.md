# Phase 2 Capability 全链路设计

> 基于[通用 Agentic Workflow 设计](./general-workflow-design.md)，针对"产品横向对比"场景的 5 个 Capability 详细实现方案。

---

## 一、目录结构

```
backend/
├── runtime/                          # 现有 Runtime v2（不变）
├── capabilities/                     # Capability 实现（新增）
│   ├── requirement_parsing/
│   │   ├── index.ts                  # Capability 导出
│   │   ├── prompts.ts                # LLM prompt 模板
│   │   └── types.ts                  # 本节点专用类型
│   ├── information_collection/
│   │   ├── index.ts
│   │   ├── prompts.ts
│   │   ├── types.ts
│   │   └── tool_decider.ts           # 按 analysisType 决策工具集
│   ├── information_processing/
│   │   ├── index.ts
│   │   ├── prompts.ts
│   │   └── types.ts
│   ├── analysis_reasoning/
│   │   ├── index.ts
│   │   ├── prompts.ts
│   │   ├── types.ts
│   │   └── matrix_builder.ts         # 对比矩阵专用逻辑
│   └── artifact_generation/
│       ├── index.ts
│       ├── prompts.ts
│       ├── types.ts
│       └── source_map.ts             # 溯源映射
└── tools/                            # Tool 实现（新增）
    ├── web_search/
    │   ├── manifest.json
    │   └── skill.ts
    ├── web_scrape/
    │   ├── manifest.json
    │   └── skill.ts
    ├── feature_extractor/
    │   ├── manifest.json
    │   └── skill.ts
    ├── pricing_normalizer/
    │   ├── manifest.json
    │   └── skill.ts
    ├── swot_generator/
    │   ├── manifest.json
    │   └── skill.ts
    ├── matrix_builder/
    │   ├── manifest.json
    │   └── skill.ts
    ├── markdown_renderer/
    │   ├── manifest.json
    │   └── skill.ts
    └── table_composer/
        ├── manifest.json
        └── skill.ts
```

---

## 二、Capability 详细设计

### 2.1 需求解析 (requirement_parsing)

**设计目标**：将用户自由文本转化为结构化分析参数，为后续所有节点提供统一输入契约。

#### 2.1.1 接口定义

```typescript
// types.ts
interface RequirementConfig {
  analysisType: "product_comparison";
  targets: Target[];
  dimensions: Dimension[];
  outputFormat: OutputFormat[];
  constraints: AnalysisConstraints;
}

interface Target {
  name: string;               // 竞品名称
  url?: string;               // 竞品网站/App Store 链接
  category?: string;          // 品类（IM/电商/短视频等）
}

type Dimension = 
  | "functionality" | "pricing" | "user_experience"
  | "market_position" | "technology" | string;

type OutputFormat = "comparison_matrix" | "swot" | "feature_list" | "report";

interface AnalysisConstraints {
  timeRange?: { from?: string; to?: string };
  regions?: string[];
  languages?: string[];
  maxCompetitors?: number;
}
```

#### 2.1.2 执行流程

```
用户输入
  │
  ▼
LLM 结构化提取 (llm_structured_extract)
  ├─ 识别 targets（显式 + 隐式推断）
  ├─ 识别 dimensions（显式 + 按行业常识补全）
  ├─ 识别 outputFormat（默认对比矩阵 + SWOT）
  └─ 提取约束条件
  │
  ▼
合法性校验
  ├─ targets 数量 ≥ 2
  ├─ dimensions 非空
  └─ 不合法 → 通过事件提示用户补充
  │
  ▼
emit "routing_decision"（推送 config 供人工确认）
  │
  ▼
写入 state.data.config
```

#### 2.1.3 事件

| 事件 | uiHint | 时机 |
|------|--------|------|
| 开始解析 | `node_progress` | execute 入口 |
| 解析完成 | `node_progress` | 结构化提取完毕，附 `config` 摘要 |
| 需补充信息 | `workflow_paused` | targets 不足或 dimensions 为空时 |
| 节点完成 | `node_completed` | 写入 state 后 |

#### 2.1.4 错误处理

- LLM 调用失败 → 重试 2 次 → 仍失败则返回 `NodeFatalError`
- 用户输入过于模糊 → 推送 `workflow_paused` + 追问提示，等待用户补充

---

### 2.2 信息采集 (information_collection)

**设计目标**：按竞品 × 维度网格采集原始信息，支持单轮批量采集或多轮分竞品采集。

#### 2.2.1 数据结构

```typescript
// types.ts
interface RawDataItem {
  target: string;
  dimension: string;
  content: string;               // 原始文本
  sourceUrl: string;
  sourceTitle?: string;
  retrievedAt: string;           // ISO 8601
  credibility: "high" | "medium" | "low" | "unknown";
}

interface CollectionResult {
  items: RawDataItem[];
  uncoveredDimensions: string[]; // 未采集到数据的维度
  summary: string;               // 采集概况摘要
}
```

#### 2.2.2 执行流程

```
从 state.data.config 读取 targets + dimensions
  │
  ▼
tool_decider.ts: 按 analysisType 决定工具集
  ├─ 横向对比 → [web_search, web_scrape]
  │
  ▼
LLM 决策：生成搜索计划
  ├─ 对每个 (target, dimension) 组合生成搜索 query
  ├─ 识别无依赖的并行搜索组
  └─ 估算所需轮次
  │
  ▼
并行执行搜索（Promise.all）
  ├─ 每个 Tool 调用 emit tool_call → tool_result
  ├─ 超时 30s/条，失败标记降级
  └─ 记录每条结果的来源 URL
  │
  ▼
LLM 评估采集充分性
  ├─ 覆盖度：targets × dimensions 中有多少有数据
  ├─ 可信度：来源质量评估
  └─ 不够 → emit "routing_decision" 询问是否补充
  │
  ▼
写入 state.data.rawData
```

#### 2.2.3 工具决策表

```typescript
// tool_decider.ts
function selectTools(config: RequirementConfig): string[] {
  const tools = ["web_search", "web_scrape"]; // 通用基础
  // 未来扩展按 analysisType 和 dimensions 条件加载专用 Tool
  return tools;
}
```

#### 2.2.4 LLM Prompt 设计要点

```typescript
// prompts.ts 核心指令
const SEARCH_PLAN_PROMPT = `
你是一个竞品信息采集的调度器。你需要为以下采集任务生成搜索计划。

竞品列表：{targets}
对比维度：{dimensions}

对每个 (竞品, 维度) 组合，生成 1-2 个搜索 query。
识别哪些 query 可以并行执行（彼此无依赖）。

输出 JSON: {
  "batches": [
    { "queries": [{ "target": "...", "dimension": "...", "query": "..." }] }
  ]
}

规则：
- 搜索 query 要具体，包含竞品名称 + 具体维度关键词
- 优先搜索官方来源（官网、应用商店页面）
- 每个 batch 内的 queries 可以并行
`;
```

#### 2.2.5 事件

| 事件 | uiHint | 时机 |
|------|--------|------|
| 开始采集 | `node_progress` | 展示采集计划概要 |
| 工具调用 | `tool_call` | 每个搜索/抓取开始 |
| 工具结果 | `tool_result` | 每个搜索/抓取结束，附带结果摘要 |
| 采集充分性评估 | `routing_decision` | 一轮采集完成后，询问是否补充 |
| 节点完成 | `node_completed` | 数据写入 state 后 |

#### 2.2.6 错误处理

- 单次搜索超时 30s → 标记该条为 `credibility: "low"`，继续剩余
- 搜索 API 配额耗尽 → 降级为 `degradation_notice` 事件，提示用户稍后补充
- 全部搜索失败 → `NodeFatalError`

---

### 2.3 信息处理 (information_processing)

**设计目标**：清洗原始数据，提取结构化信息点，生成可对比的归一化数据。

#### 2.3.1 数据结构

```typescript
// types.ts
interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;           // 具体属性名，如 "月费价格"、"支持平台"
  value: string;               // 归一化后的值
  rawValue?: string;           // 原始文本值
  confidence: number;          // 0-1，提取置信度
  sourceTraceIds: string[];    // 回溯到 rawData items
}

interface ProcessingResult {
  records: StructuredRecord[];
  uncoveredDimensions: string[];
}
```

#### 2.3.2 执行流程

```
从 state.data 读取 rawData + config.dimensions
  │
  ▼
按 dimension 分组处理（可并行）
  │
  ├─ functionality → feature_extractor tool
  │    对每个竞品的功能描述文本提取结构化功能点
  │
  ├─ pricing → pricing_normalizer tool
  │    统一货币、计费周期，提取价格层级
  │
  └─ 其他维度 → LLM 通用提取
  │
  ▼
去重与合并
  ├─ 同一 (target, dimension, attribute) 多条来源 → 合并去重
  └─ 标记冲突数据（同一属性多源不一致）
  │
  ▼
写入 state.data.structuredData
```

#### 2.3.3 LLM Prompt 设计要点

```typescript
// prompts.ts
const EXTRACT_PROMPT = `
你是一个数据提取器。请从以下原始竞品信息中提取结构化的对比数据。

对比维度：{dimension}
竞品：{target}
原始信息：
{rawContent}

对于每个可识别的属性，提取：
- attribute: 属性名（如 "月费价格"、"免费版功能限制"）
- value: 归一化值（如下划线分隔的标准化表达）
- confidence: 0-1 置信度

输出 JSON: { "records": [{ "attribute": "...", "value": "...", "confidence": 0.9 }] }

规则：
- 只提取原文中明确提到的信息，不要推测
- 价格信息要统一货币和计费周期
- 功能描述分解为原子功能点（如"多端同步"而非"支持多端同步且体验流畅"）
- confidence < 0.5 的记录不要输出
`;
```

#### 2.3.4 事件

| 事件 | uiHint | 时机 |
|------|--------|------|
| 开始处理 | `node_progress` | 显示处理维度列表 |
| 维度处理进度 | `node_progress` | 每完成一个维度 |
| 工具调用 | `tool_call/tool_result` | feature_extractor / pricing_normalizer |
| 节点完成 | `node_completed` | 附带结构化数据摘要 |

#### 2.3.5 可选性

Orchestrator 可在以下情况跳过本节点：
- `rawData` 数据量小且结构简单
- 用户选择"快速对比"模式

跳过本节点时，`analysis_reasoning` 直接消费 `rawData` 而非 `structuredData`。

---

### 2.4 分析推理 (analysis_reasoning)

**设计目标**：执行对比分析和 SWOT 生成，是整个链路中业务逻辑最重的节点。

#### 2.4.1 数据结构

```typescript
// types.ts
interface FeatureComparison {
  dimension: string;
  attribute: string;
  values: { target: string; value: string; sourceTraceId: string }[];
  winner?: string;              // 该维度表现最佳的竞品
  analysis: string;             // 分析说明
}

interface SWOTEntry {
  category: "strengths" | "weaknesses" | "opportunities" | "threats";
  target: string;
  point: string;
  evidence: string;             // 支撑证据
  sourceTraceIds: string[];
}

interface AnalysisResult {
  comparisonMatrix: FeatureComparison[];
  swot: SWOTEntry[];
  summary: string;              // 综合分析摘要
}
```

#### 2.4.2 执行流程

```
从 state.data 读取 structuredData（或 rawData 降级）+ config
  │
  ▼
Phase 1: 多维对比分析
  ├─ matrix_builder tool（按维度生成对比条目）
  │    每个 attribute 行 → 各 target 的值列
  ├─ LLM 识别差异点 + 标注 winner
  └─ 产出 comparisonMatrix[]
  │
  ▼
Phase 2: SWOT 分析（每个竞品独立，可并行）
  ├─ swot_generator tool（每个 target 一次）
  ├─ 基于对比数据 + 行业常识
  └─ 产出 swot[]
  │
  ▼
Phase 3: LLM 综合归纳
  ├─ 整理所有分析片段
  ├─ 生成 200 字以内的综合分析摘要
  └─ 产出 summary
  │
  ▼
写入 state.data.analysisResults
```

#### 2.4.3 LLM Prompt 设计要点

```typescript
// prompts.ts - 对比分析 prompt
const COMPARISON_PROMPT = `
你是一个竞品分析师。基于以下结构化对比数据，生成对比分析报告。

竞品：{targets}
维度：{dimensions}
数据：{structuredData}

对每个属性，输出：
- 各竞品的取值
- 最佳表现者（winner），如无明显优胜者可设为 null
- 一句分析说明（指出差异原因或值得关注的点）

输出 JSON: { "comparisonMatrix": [...] }
`;

// prompts.ts - SWOT prompt
const SWOT_PROMPT = `
你是一个竞品分析师。基于以下对比数据，为竞品 {target} 生成 SWOT 分析。

对比数据：{comparisonMatrix}

输出 JSON: { "swot": [
  { "category": "strengths"|"weaknesses"|"opportunities"|"threats", 
    "point": "...", "evidence": "..." }
] }

规则：
- 每类至少 2 条，不超过 5 条
- S/W 基于内部数据（功能、定价、体验对比）
- O/T 基于外部环境（市场趋势、差异化机会）
- evidence 必须引用于对比数据中的具体条目
`;
```

#### 2.4.4 事件

| 事件 | uiHint | 时机 |
|------|--------|------|
| 开始分析 | `node_progress` | 展示分析阶段 |
| 对比矩阵生成 | `tool_result` | matrix_builder 完成 |
| SWOT 生成 | `tool_result` | 每个 target 的 SWOT 完成 |
| LLM 流式输出 | `llm_stream` | 综合归纳时 |
| 节点完成 | `node_completed` | 附分析摘要 |

#### 2.4.5 错误处理

- matrix_builder 或 swot_generator 失败 → 单 Tool 重试 → 仍失败则跳过该条目 + 标记
- LLM 综合归纳失败 → 回退为碎片化结果直接输出
- 全部 sub-phase 失败 → `NodeFatalError`

---

### 2.5 产物生成 (artifact_generation)

**设计目标**：将分析结果渲染为可交付产物（对比矩阵表格 + SWOT 图表 + 溯源链接）。

#### 2.5.1 数据结构

```typescript
// types.ts
interface Artifact {
  type: "comparison_matrix" | "swot" | "summary";
  format: "markdown" | "html" | "json";
  title: string;
  content: string;               // 渲染后的正文
  sourceMap: SourceMapEntry[];    // 溯源映射
}

interface SourceMapEntry {
  conclusionFragment: string;     // 产物中的结论片段
  sourceUrl: string;
  sourceExcerpt: string;          // 原始来源摘要
  traceId: string;                // 回溯到 WorkflowEvent
}
```

#### 2.5.2 执行流程

```
从 state.data 读取 analysisResults + config.outputFormat
  │
  ▼
Phase 1: 对比矩阵渲染 (comparison_matrix)
  ├─ table_composer tool → Markdown/HTML 表格
  ├─ 行 = attribute，列 = targets
  └─ sourceMap 产出
  │
  ▼
Phase 2: SWOT 渲染（每个竞品）
  ├─ markdown_renderer tool → 四象限列表
  └─ sourceMap 产出
  │
  ▼
Phase 3: 综合分析摘要
  ├─ markdown_renderer → 格式化段落
  └─ sourceMap 产出
  │
  ▼
写入 state.data.artifacts
  │
  ▼
emit "workflow_complete"
```

#### 2.5.3 溯源映射生成

```typescript
// source_map.ts
function buildSourceMap(
  analysisResults: AnalysisResult,
  rawData: RawDataItem[]
): SourceMapEntry[] {
  const map: SourceMapEntry[] = [];
  for (const entry of analysisResults.comparisonMatrix) {
    for (const val of entry.values) {
      const src = rawData.find(r => r.traceId === val.sourceTraceId);
      if (src) {
        map.push({
          conclusionFragment: `${entry.attribute}: ${val.target}=${val.value}`,
          sourceUrl: src.sourceUrl,
          sourceExcerpt: truncate(src.content, 200),
          traceId: val.sourceTraceId,
        });
      }
    }
  }
  return map;
}
```

#### 2.5.4 事件

| 事件 | uiHint | 时机 |
|------|--------|------|
| 开始生成 | `node_progress` | 展示产物类型列表 |
| 工具调用/结果 | `tool_call/tool_result` | 每个 table_composer / markdown_renderer |
| 节点完成 | `node_completed` | 附产物预览 |
| 工作流完成 | `workflow_complete` | 全部产物生成完毕 |

#### 2.5.5 错误处理

- 单产物渲染失败 → 跳过该产物，继续渲染其他
- 全部产物渲染失败 → `NodeFatalError`
- 产物过大（> 10MB）→ 截断 + 提示用户调整维度

---

## 三、全链路数据流

```
用户输入 "对比微博和知乎的会员定价和功能差异"
  │
  ▼
┌────────────────────────────────────────────────────┐
│ requirement_parsing                                 │
│   input:  用户文本                                   │
│   output: config {                                  │
│     analysisType: "product_comparison"              │
│     targets: ["微博", "知乎"]                        │
│     dimensions: ["functionality", "pricing"]         │
│     outputFormat: ["comparison_matrix", "swot"]     │
│   }                                                 │
│   events: node_progress → routing_decision          │
│           → node_completed                          │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ information_collection                              │
│   input:  config.targets, config.dimensions         │
│   output: rawData {                                 │
│     微博.functionality[]: 会员权益列表、功能描述      │
│     微博.pricing[]: 会员价格、套餐信息                │
│     知乎.functionality[]: 盐选权益、功能描述          │
│     知乎.pricing[]: 盐选价格、套餐信息                │
│   }                                                 │
│   events: tool_call/tool_result × N                 │
│           → node_completed                          │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ information_processing                              │
│   input:  rawData                                   │
│   output: structuredData {                          │
│     functionality[{target, attribute, value}]:      │
│       微博: 去广告 ✓,  微博: 编辑已发 ✓             │
│       知乎: 去广告 ✓,  知乎: 内容编辑 ✗             │
│     pricing[{target, attribute, value}]:            │
│       微博: 月费¥15,  微博: 年费¥118               │
│       知乎: 月费¥19,  知乎: 年费¥198               │
│   }                                                 │
│   events: tool_call/tool_result → node_completed    │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ analysis_reasoning                                  │
│   input:  structuredData                            │
│   output: analysisResults {                         │
│     comparisonMatrix[{dimension, attribute,         │
│       values[{target, value}], winner, analysis}]   │
│     swot[{target, category, point, evidence}]       │
│     summary: "微博会员在社区功能上更丰富..."         │
│   }                                                 │
│   events: tool_call/tool_result                     │
│           llm_stream → node_completed               │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ artifact_generation                                 │
│   input:  analysisResults, config.outputFormat      │
│   output: artifacts[{type, format, content,         │
│             sourceMap}]                             │
│   events: tool_call/tool_result                     │
│           → node_completed → workflow_complete      │
└────────────────────────────────────────────────────┘
```

---

## 四、State 数据契约

所有 Capability 共享 `RuntimeState.data` 的以下 key：

```typescript
// 整个工作流共享的 data shape
interface WorkflowData {
  // requirement_parsing 写入
  config?: RequirementConfig;

  // information_collection 写入
  rawData?: Record<string, RawDataItem[]>;

  // information_processing 写入（可选）
  structuredData?: Record<string, StructuredRecord[]>;

  // analysis_reasoning 写入
  analysisResults?: AnalysisResult;

  // artifact_generation 写入
  artifacts?: Artifact[];
}
```

Capability 通过 `inputHints` / `outputHints` 声明读写契约，Orchestrator 据此验证依赖满足性。

---

## 五、Tool 清单与优先级

| 优先级 | Tool | 用途 | 被哪个 Capability 使用 |
|--------|------|------|----------------------|
| P0 | `llm_structured_extract` | LLM 结构化提取 | requirement_parsing |
| P0 | `web_search` | 通用网页搜索 | information_collection |
| P0 | `web_scrape` | 单页内容抓取清洗 | information_collection |
| P0 | `matrix_builder` | 对比矩阵生成 | analysis_reasoning |
| P0 | `swot_generator` | SWOT 分析生成 | analysis_reasoning |
| P0 | `table_composer` | Markdown/HTML 表格渲染 | artifact_generation |
| P1 | `feature_extractor` | 功能点结构化提取 | information_processing |
| P1 | `pricing_normalizer` | 价格归一化 | information_processing |
| P1 | `markdown_renderer` | Markdown 格式化渲染 | artifact_generation |

---

## 六、实现优先级

```
1. requirement_parsing（入口，独立性强，可先行验证）
   └─ 依赖：llm_structured_extract tool
   
2. information_collection（核心数据源，后续节点依赖它）
   └─ 依赖：web_search + web_scrape tools
   
3. analysis_reasoning（核心业务逻辑，可直接消费 rawData）
   └─ 依赖：matrix_builder + swot_generator tools
   
4. artifact_generation（终点节点，消费分析结果即可独立开发）
   └─ 依赖：table_composer + markdown_renderer tools
   
5. information_processing（增强型节点，可最后开发）
   └─ 依赖：feature_extractor + pricing_normalizer tools

建议开发路径：
Step 1: 先打通 1→2→3→4 的最小闭环（跳过 information_processing）
Step 2: 验证端到端可用后，加入 information_processing 提升数据质量
```
