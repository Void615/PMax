# UiHint 事件规格文档

> 定义 PMax 所有的 `UiHint` 类型、对应的 `eventType`、payload 结构、以及前端渲染的组件映射。
> 本文档与 `CAPABILITY_WORKFLOW_SPEC_P1/P2.md` 中的事件调用点配套。

## 设计约束

- 每个 `ctx.emit()` 调用必须携带 `uiHint` 和 `eventType`。
- `uiHint` 决定前端渲染哪个组件，`eventType` 决定事件的业务语义（过滤/分组/持久化查询）。
- `payload` 字段前端可安全使用，后端不保证向后兼容。
- `traceId` 和 `parentTraceId` 构成事件树，前端可据此恢复对话上下文。

---

## UiHint 枚举

```typescript
export type UiHint =
  // 工具交互
  | "tool_call"              // 调用工具前
  | "tool_result"            // 工具调用完成后
  | "tool_error"             // 工具调用失败（预留）

  // LLM 流式输出（预留）
  | "llm_stream"

  // 节点生命周期
  | "node_progress"          // 节点内阶段推进
  | "node_completed"         // 节点执行完成

  // 工作流生命周期
  | "workflow_paused"        // 工作流暂停（路由/澄清/错误）
  | "workflow_complete"      // 工作流终止
  | "workflow_failed"        // 工作流致命错误

  // 路由
  | "routing_decision"       // Orchestrator 路由决策
  | "degradation_notice"     // 降级通知

  // 澄清对话（requirement_parsing 多轮）
  | "clarification_asked"    // 代理发出澄清问题（前端渲染交互组件）
  | "clarification_answered" // 用户已回答（前端渲染对话记录）→ 复用 node_progress 组件

  // 质量告警
  | "quality_warning";       // 充分性/冲突/数据不均衡告警
```

---

## 事件 payload 规格

### tool_call / tool_result / tool_error

```typescript
// tool_call — 工具调用前
{
  uiHint: "tool_call",
  eventType: "TOOL_CALL",
  payload: {
    toolName: string,         // manifest.json name，如 "web_search"
    params?: Record<string, any>,  // 调用参数摘要（防泄露：不传敏感字段）
    context?: string,          // 可选:"对竞品A的功能特性搜索"
    batchIndex?: number,       // 可选:处于第几个 batch
    totalBatches?: number,     // 可选:总 batch 数
  }
}

// tool_result — 工具调用完成后
{
  uiHint: "tool_result",
  eventType: "TOOL_RESULT",
  payload: {
    toolName: string,
    durationMs: number,        // 执行耗时
    result?: {                 // 结果摘要
      itemCount?: number,      // 搜索:返回结果数
      title?: string,          // scrape:页面标题
      length?: number,         // scrape:内容长度
      url?: string,            // scrape/resolve:URL
      recordCount?: number,    // extract:提取记录数
      conflictCount?: number,  // conflict:冲突数
      score?: number,          // sufficiency:评分
      format?: string,         // render:产物格式
      rowCount?: number,       // matrix:对比行数
      insightCount?: number,   // insight:洞察条数
    },
    error?: {                  // 仅 error 时存在
      message: string,
      code?: string,
    },
  }
}

// tool_error — 工具调用异常（预留，当前 tool 内部 catch 后通过 tool_result + error 字段返回）
{
  uiHint: "tool_error",
  eventType: "TOOL_ERROR",
  payload: {
    toolName: string,
    error: { message: string, code?: string },
  }
}
```

### node_progress / node_completed

```typescript
// node_progress — 节点内阶段推进
{
  uiHint: "node_progress",
  eventType: "NODE_PROGRESS",
  payload: {
    stage: string,             // 阶段标识，如 "url_discovery"、"planning"、"collecting"、"scoring"、"extracting"、"comparing"
    message?: string,          // 人类可读的描述，如 "正在发现竞品官方 URL..."
    percentage?: number,       // 0-100 估算进度（可选）
    // 阶段特定字段:
    round?: number,            // collection round
    batchIndex?: number,       // 当前 batch
    totalBatches?: number,     // 总 batch 数
    target?: string,           // 当前处理的 target
    dimension?: string,        // 当前处理的 dimension
    itemCount?: number,        // 已采集/已处理条数
  }
}

// node_completed — 节点执行完成
{
  uiHint: "node_completed",
  eventType: "NODE_COMPLETED",
  payload: {
    summary: string,           // "解析完成：3 个竞品，2 个维度"
    // 节点特定摘要（前端可渲染到节点卡片上）:
    config?: Partial<RequirementConfig>,     // requirement_parsing
    report?: {                              // information_collection
      totalItems: number,
      sufficiencyScore: number,
      sufficiencyVerdict: string,
    },
    recordCount?: number,                    // information_processing
    conflictCount?: number,                  // information_processing
    dimensions?: string[],                   // information_processing
    coverageMatrix?: Record<string, any>,    // information_processing
    conclusionCount?: number,                // analysis_reasoning
    overallConfidence?: string,              // analysis_reasoning
    artifactCount?: number,                  // artifact_generation
    sourceMapCount?: number,                 // artifact_generation
  }
}
```

### workflow_paused / workflow_complete / workflow_failed

```typescript
// workflow_paused — 工作流暂停
{
  uiHint: "workflow_paused",
  eventType: "WORKFLOW_PAUSED",
  payload: {
    reason: string,            // "routing" | "clarification" | "error"
    message?: string,          // 人类可读的暂停原因
    // routing 特定:
    suggestions?: { nodeId: string; priority: number; reason: string }[],
    // clarification 特定:
    round?: number,
    questionType?: string,
  }
}

// workflow_complete — 工作流终止
{
  uiHint: "workflow_complete",
  eventType: "WORKFLOW_COMPLETE",
  payload: {
    artifactCount: number,
    sourceMapCount: number,
    overallConfidence: "high" | "medium" | "low",
  }
}

// workflow_failed — 工作流致命错误
{
  uiHint: "workflow_failed",
  eventType: "WORKFLOW_FAILED",
  payload: {
    error: string,
    errorCode?: string,
    nodeId?: string,           // 失败的节点
  }
}
```

### routing_decision / degradation_notice

```typescript
// routing_decision — Orchestrator 路由决策
{
  uiHint: "routing_decision",
  eventType: "ROUTING_DECISION",
  payload: {
    completedNode: string,
    currentPhase: string,
    planProgress: { completed: string[], remaining: string[] },
    suggestions: { nodeId: string; priority: number; reason: string }[],
    executedNodes: string[],
  }
}

// degradation_notice — 降级通知
{
  uiHint: "degradation_notice",
  eventType: "DEGRADATION_NOTICE",
  payload: {
    level: "warn" | "error",
    source: string,            // "orchestrator.planning" | "llm_ranker" | ...
    message: string,
    fallback: string,          // 降级后的策略
  }
}
```

### clarification_asked / clarification_answered

```typescript
// clarification_asked — 代理发出澄清问题（前端渲染交互组件）
{
  uiHint: "clarification_asked",
  eventType: "CLARIFICATION_ASKED",
  payload: {
    round: number,                        // 当前是第几轮
    questionType: "scene_selection" | "targets" | "dimensions" | "output_format" | "constraints" | "confirm_preview",
    agentPrompt: string,                  // 代理提问文本（Markdown）
    inputType: "single_select" | "multi_select" | "free_text" | "confirm_actions",
    options?: {                           // inputType 为 select 时使用
      key: string;
      label: string;
      description?: string;
    }[],
    skippable?: boolean,                  // true 时渲染"跳过"按钮
    current?: Record<string, any>,        // confirm_preview 时展示已收集的 config 预览
  }
}

// clarification_answered — 用户已回答
// 复用 node_progress uiHint，eventType 区分
{
  uiHint: "node_progress",               // 复用，前端渲染为轻量对话记录卡片
  eventType: "CLARIFICATION_ANSWERED",
  payload: {
    round: number,
    questionType: string,
    userResponse: string,                 // 用户的回答文本
    extractedDelta: Record<string, any>,  // 从本轮回答中提取的结构化增量
    timestamp: string,
  }
}
```

### quality_warning

```typescript
// quality_warning — 充分性/冲突/数据不均衡告警
{
  uiHint: "quality_warning",
  eventType: "SUFFICIENCY_WARNING" | "DATA_IMBALANCE_WARNING",
  payload: {
    level: "warn" | "info",
    message: string,                      // 人类可读的告警描述
    // SUFFICIENCY_WARNING 特定:
    score?: number,
    perDimension?: Record<string, { coverage: string; missingTargets: string[] }>,
    suggestions?: string[],
    // DATA_IMBALANCE_WARNING 特定:
    warnings?: string[],
  }
}
```

---

## 前端组件映射

| UiHint | eventType 子类型 | 前端组件 | 交互性 |
|--------|-----------------|----------|--------|
| `tool_call` | TOOL_CALL | `<ToolCallCard />` — 图标 + toolName + spinner | 无 |
| `tool_result` | TOOL_RESULT | `<ToolResultCard />` — 图标 + toolName + 结果摘要 + 耗时 | 无 |
| `tool_error` | TOOL_ERROR | `<ToolErrorCard />` — 同上但红色 + 错误信息 | 无 |
| `node_progress` | NODE_PROGRESS | `<NodeProgressBar />` — 阶段标签 + 进度条 + message | 无 |
| `node_progress` | CLARIFICATION_ANSWERED | `<ClarificationRecord />` — 对话气泡（非交互） | 无 |
| `node_completed` | NODE_COMPLETED | `<NodeCompletedChip />` — 节点完成标签 + summary | 无 |
| `workflow_paused` | WORKFLOW_PAUSED | `<WorkflowPausedBanner />` — 暂停提示横幅 | 无 |
| `workflow_complete` | WORKFLOW_COMPLETE | `<WorkflowCompletePage />` — 产物列表 + 溯源统计 | 可交互（产物查看/导出） |
| `workflow_failed` | WORKFLOW_FAILED | `<WorkflowFailedPage />` — 错误信息 + 重试按钮 | 可交互（重试） |
| `routing_decision` | ROUTING_DECISION | `<RoutingDecisionPanel />` — 路由建议卡片列表 | **可交互（选择下一步）** |
| `degradation_notice` | DEGRADATION_NOTICE | `<DegradationBanner />` — 降级提示横幅 | 无 |
| `clarification_asked` | CLARIFICATION_ASKED | `<ClarificationDialog />` — 根据 inputType 渲染不同子组件 | **可交互（提交答案/确认）** |
| `quality_warning` | SUFFICIENCY_WARNING | `<QualityWarningBanner />` — 黄色告警横幅 | 无 |
| `quality_warning` | DATA_IMBALANCE_WARNING | `<QualityWarningBanner />` — 黄色告警横幅（同上组件） | 无 |

### ClarificationDialog 子组件（按 inputType）

| inputType | 子组件 | 说明 |
|-----------|--------|------|
| `single_select` | `<RadioGroup />` | 单选按钮组，`options` 作为选项 |
| `multi_select` | `<CheckboxGroup />` + `<TagInput />` | 多选框组 + 自定义输入标签 |
| `free_text` | `<TextArea />` + 可选的 `<SkipButton />` | 文本框，skippable 时加跳过按钮 |
| `confirm_actions` | `<ConfigPreview />` + `<ButtonGroup />` | 完整 config 预览 + 确认/修改/取消三按钮 |

---

## 事件流示意（横向产品对比，3 竞品 × 3 维度）

```
CLARIFICATION_ASKED (scene_selection)         ← 前端渲染 RadioGroup
CLARIFICATION_ANSWERED                        ← 前端渲染对话气泡
CLARIFICATION_ASKED (targets)                 ← 前端渲染 TextArea
CLARIFICATION_ANSWERED
CLARIFICATION_ASKED (dimensions)              ← 前端渲染 CheckboxGroup
CLARIFICATION_ANSWERED
CLARIFICATION_ASKED (output_format)           ← 前端渲染 CheckboxGroup
CLARIFICATION_ANSWERED
CLARIFICATION_ASKED (constraints, skippable)  ← 前端渲染 TextArea + Skip
CLARIFICATION_ANSWERED
CLARIFICATION_ASKED (confirm_preview)         ← 前端渲染 ConfigPreview + 按钮组
CLARIFICATION_ANSWERED
NODE_COMPLETED (requirement_parsing)

ROUTING_DECISION                              ← 前端渲染路由卡片
  → 用户点击 "下一步"
  
NODE_PROGRESS (url_discovery)                 ← 前端渲染进度条
TOOL_CALL (competitor_url_resolver) ×3        ← 前端渲染 3 个 tool 卡片 (spinner)
TOOL_RESULT (competitor_url_resolver) ×3      ← spinner → result
TOOL_CALL (search_planner)                    ← 前端渲染 tool 卡片
TOOL_RESULT (search_planner)                  ← spinner → result
TOOL_CALL (web_search) ×9                     ← 3竞品×3维度=9个 (可聚合)
TOOL_RESULT (web_search) ×9
TOOL_CALL (web_scrape) ×18                    ← 9×2=18个
TOOL_RESULT (web_scrape) ×18
TOOL_CALL (credibility_scorer) ×18            ← 18个
TOOL_RESULT (credibility_scorer) ×18
QUALITY_WARNING (SUFFICIENCY_WARNING)         ← 可选:黄色告警
TOOL_CALL (sufficiency_checker)
TOOL_RESULT (sufficiency_checker)
NODE_COMPLETED (information_collection)

ROUTING_DECISION                              ← 用户点击 "下一步"

NODE_PROGRESS (processing)                    ← 进度条: "processing"
TOOL_CALL (feature/pricing extractor) ×9      ← 3竞品×3维度=9个
TOOL_RESULT ×9
TOOL_CALL (entity_resolver) ×3                ← 每个维度一次
TOOL_RESULT ×3
TOOL_CALL (conflict_detector)                 ← 全部数据一次
TOOL_RESULT
NODE_COMPLETED (information_processing)

ROUTING_DECISION

NODE_PROGRESS (comparison)                    ← 进度条
QUALITY_WARNING (DATA_IMBALANCE_WARNING)      ← 可选
TOOL_CALL (matrix_builder)
TOOL_RESULT
TOOL_CALL (swot_generator) ×3                 ← 并行，3个
TOOL_RESULT ×3
TOOL_CALL (insight_extractor)
TOOL_RESULT
TOOL_CALL (comparison_summarizer)
TOOL_RESULT
NODE_COMPLETED (analysis_reasoning)

ROUTING_DECISION
  → 用户点击 "下一步" 或自动继续

NODE_PROGRESS (rendering)                     ← 进度条
TOOL_CALL (source_map_builder)
TOOL_RESULT
TOOL_CALL (table_composer)                    ← 如 outputFormat 含 comparison_matrix
TOOL_RESULT
TOOL_CALL (markdown_renderer)                 ← 如 outputFormat 含 report
TOOL_RESULT
WORKFLOW_COMPLETE                             ← 前端渲染产物展示页
```

**事件总量:** 澄清阶段 ~12 个 + 采集阶段 ~65 个 + 处理阶段 ~30 个 + 分析阶段 ~15 个 + 产物阶段 ~6 个 ≈ **130 个事件**，分布在 2-3 分钟内，SSE 无压力。

---

## 前端渲染策略建议

1. **聚合 threshold:** information_collection 期间的 `tool_call`/`tool_result` 如超过 10 个同类 Tool 且间隔 < 500ms，聚合为 `<BatchProgressCard count={n} tool="web_search" />` 展示总数和完成数。
2. **节点折叠:** 已完成的节点折叠为 summary 行，当前节点展开显示 tool 卡片流。
3. **错误处理:** `tool_error` 和 `quality_warning` 在对应行高亮，不阻塞整体渲染。
