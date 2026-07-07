# PMax 通用 Agentic Workflow 设计

> 面向产品经理竞品分析系统的通用化工作流设计。采用"粗粒度通用 Capability + Skills/Tools 差异化"策略，以 5 个核心节点覆盖横向对比、发展决策、产业趋势三大业务场景。

---

## 一、设计理念

**核心原则**：Capability 节点是稳定的、跨场景通用的；业务差异性通过节点内部的 Tools 组合和 LLM prompt 来消化。

**编排模式**：Orchestrator 动态编排——节点执行顺序不固定，由 Orchestrator 结合 TaskPlan 和当前执行上下文决策。支持跳过、回跳、重复执行。

---

## 二、节点总览

```
需求解析（固定入口）
  │
  ▼ Orchestrator 决策
  ├─→ 信息采集（可多轮：先背景后产品，或分竞品多次采集）
  │     │
  │     ▼
  ├─→ 信息处理（依赖采集完成，清洗/去重/归一化）
  │     │
  │     ▼
  ├─→ 分析推理（场景相关分析逻辑，最"重"的节点）
  │     │
  │     ▼
  └─→ 产物生成（终止节点，格式化输出）
```

---

## 三、Capability 节点详细定义

### 3.1 需求解析 (Requirement Parsing)

**ID**：`requirement_parsing`

**职责**：理解用户自然语言输入，提取结构化分析参数。始终作为工作流入口节点。

| 维度 | 说明 |
|------|------|
| 输入 | 用户原始需求文本（如"帮我对比小红书和抖音的电商功能"） |
| 产出 | `config.analysisType`（`product_comparison` / `development_decision` / `industry_trend`） |
| | `config.targets[]`（竞品/产品名称列表） |
| | `config.dimensions[]`（对比维度：功能/定价/UX/市场规模/政策等） |
| | `config.contextScope[]`（背景信息范围：行业/政策/市场/技术等） |
| | `config.outputFormat[]`（产物格式：对比矩阵/SWOT/趋势报告/策略文档） |
| | `config.constraints{}`（可选约束：时间范围、地域、语言等） |
| Tool | `llm_structured_extract`（LLM 结构化信息提取） |
| inputHints | —（入口节点，无外部输入依赖） |
| outputHints | `config` |
| requires | — |

**差异化**：无。该节点对所有场景完全通用。

---

### 3.2 信息采集 (Information Collection)

**ID**：`information_collection`

**职责**：基于分析参数，从多源渠道采集原始信息。支持多轮执行（先背景后产品，或分竞品逐个采集）。

| 维度 | 说明 |
|------|------|
| 输入 | `config.targets[]`, `config.dimensions[]`, `config.contextScope[]`, `config.constraints{}` |
| 产出 | `rawData.{target}.{source}[]`（每条记录含：原始内容、来源 URL、采集时间戳、可信度标记） |
| | `rawData.context.{scope}[]`（行业背景、政策法规、市场数据等） |
| 通用 Tool | `web_search`, `web_scrape` |
| 横向对比 Tool | `product_feature_search`, `pricing_fetch`, `app_store_review_fetch` |
| 发展决策 Tool | `company_profile_fetch`, `market_share_lookup`，复用行业背景 Tool |
| 产业趋势 Tool | `industry_report_fetch`, `policy_search`, `market_data_fetch`, `news_aggregate` |
| inputHints | `config` |
| outputHints | `rawData` |
| requires | `requirement_parsing` |

**差异化方式**：Orchestrator 根据 `config.analysisType` 和 `config.contextScope` 决定该节点的 Tools 加载列表和执行次数。

---

### 3.3 信息处理 (Information Processing)

**ID**：`information_processing`

**职责**：清洗、去重、归一化原始采集数据，将非结构化/半结构化的原始信息转化为可对比的结构化格式。

| 维度 | 说明 |
|------|------|
| 输入 | `rawData.*` |
| 产出 | `structuredData.{dimension}[]`（每条记录含：target、value、unit/normalized_value、source link） |
| 通用 Tool | `text_cleaner`, `dedup_filter` |
| 横向对比 Tool | `pricing_normalizer`（货币/计费单位统一）, `feature_extractor`（功能点结构化提取） |
| 发展决策 Tool | `competitiveness_scorer`（竞争力指标量化）, `market_position_mapper` |
| 产业趋势 Tool | `timeline_builder`（时序数据对齐）, `metric_normalizer`（跨源指标统一） |
| inputHints | `rawData`, `config.dimensions` |
| outputHints | `structuredData` |
| requires | `information_collection` |

**差异化方式**：根据 `config.dimensions` 决定归一化的维度和方法。

**可选性**：简单对比场景可被 Orchestrator 跳过，直接由分析推理节点消化原始数据。

---

### 3.4 分析推理 (Analysis & Reasoning)

**ID**：`analysis_reasoning`

**职责**：对结构化数据执行场景相关的分析逻辑，是整个工作流中最"重"的节点。

| 维度 | 说明 |
|------|------|
| 输入 | `structuredData.*`, `rawData.*`（兜底）, `config.analysisType` |
| 产出 | `analysisResults.{type}` |
| | 横向对比产出：`featureComparison[]`, `swot[{target, strengths, weaknesses, opportunities, threats}]` |
| | 发展决策产出：`gapAnalysis[]`, `opportunityMap[]`, `strategicOptions[]` |
| | 产业趋势产出：`pestAnalysis{}`, `industryChainMap`, `marketSizeTrends[]`, `competitiveLandscape{}` |
| 通用 Tool | `matrix_builder` |
| 横向对比 Tool | `swot_generator`, `feature_differ` |
| 发展决策 Tool | `gap_identifier`, `opportunity_mapper`, `strategy_formulator` |
| 产业趋势 Tool | `pest_analyzer`, `trend_extrapolator`, `landscape_analyzer` |
| inputHints | `structuredData`, `rawData`, `config.analysisType` |
| outputHints | `analysisResults` |
| requires | `information_processing`（或 `information_collection` 如跳过处理） |

**差异化方式**：`config.analysisType` 驱动 LLM 选择完全不同的推理 prompt 和 Tool 组合。这是业务差异性最大的节点，但通过 Tool 抽象保持 Capability 接口统一。

---

### 3.5 产物生成 (Artifact Generation)

**ID**：`artifact_generation`

**职责**：将分析结果格式化为最终可交付产物。工作流终止节点。

| 维度 | 说明 |
|------|------|
| 输入 | `analysisResults.*`, `config.outputFormat[]`, `config.targets[]` |
| 产出 | `artifacts[{type, format, title, content, sourceMap[{conclusion, sourceUrl, sourceExcerpt}]}]` |
| 通用 Tool | `markdown_renderer`, `table_composer` |
| 横向对比 Tool | `comparison_table_builder`, `swot_visualizer` |
| 发展决策 Tool | `strategy_doc_composer`, `roadmap_renderer` |
| 产业趋势 Tool | `report_composer`, `chart_generator`, `pdf_exporter` |
| inputHints | `analysisResults`, `config.outputFormat` |
| outputHints | `artifacts` |
| requires | `analysis_reasoning` |

**差异化方式**：根据 `config.outputFormat[]` 选择对应的渲染 Tool。

**溯源支持**：每个产物的每条结论，必须附带 `sourceMap`，指向原始信息来源，实现全链路可溯源。

---

## 四、场景覆盖矩阵

| 场景 | 需求解析 | 信息采集 | 信息处理 | 分析推理 | 产物生成 |
|------|:--:|:--:|:--:|:--:|:--:|
| 产品横向对比 | ✓ | 产品功能/定价 | 功能/定价归一化 | 多维对比 + SWOT | 对比矩阵 + SWOT 图 |
| 产品发展决策 | ✓ | 产品+行业背景 | 竞争力指标归一化 | 差距识别 + 策略推导 | 机会地图 + 策略路径 |
| 产业趋势分析 | ✓ | 行业/政策/市场 | 时序/跨源归一化 | PEST + 趋势 + 格局 | 趋势报告 + 数据图表 |

---

## 五、编排规则

### 5.1 执行顺序约束

由 TaskPlanner 根据场景生成推荐路径：

- **横向对比**：需求解析 → 信息采集 → 信息处理 → 分析推理 → 产物生成
- **发展决策**：需求解析 → 信息采集（先背景后产品）→ 信息处理 → 分析推理 → 产物生成
- **产业趋势**：需求解析 → 信息采集（多轮）→ 信息处理 → 分析推理 → 产物生成

### 5.2 动态行为

- **跳过**：简单输入数据已足够时，Orchestrator 可跳过信息处理节点。
- **回跳**：分析推理发现数据不足时，可回跳到信息采集节点补充数据。
- **重复**：信息采集节点可按 target 拆分多轮执行（如竞品 A → 竞品 B → 竞品 C）。
- **终止条件**：产物生成后自动终止，或人工选择终止。

### 5.3 人在回路决策点

- 需求解析完成后：确认结构化参数是否正确
- 信息采集完成后：审查原始数据是否充分，决定是否补充采集
- 分析推理完成后：审查分析结果是否合理，决定是否回跳调整
- 每个路由决策点：Orchestrator 推送 `routing_decision` 事件，人工确认后继续

---

## 六、与现有 Runtime v2 架构的关系

本设计的 5 个 Capability 节点均实现为 [Capability 接口](file:///e:/dev/PMax/docs/runtime_design/README.md#L53-L62)，注册到 CapabilityRegistry，由 Orchestrator 的 Discovery → Planning → Routing 循环驱动。

- `requirement_parsing` 固定为 `setEntryPoint`
- 其余 4 个节点由 Orchestrator 动态路由选择
- 每个节点的 Tools 通过 SkillLoader 从 `tools/` 目录加载
- 所有节点的执行事件通过 EventBus → SSE 推送前端

---

## 七、后续扩展

- 新增业务场景时，只需新增对应 Tools，无需新增 Capability 节点。
- 若未来出现 5 节点无法覆盖的场景（如"用户反馈情感分析"），可注册新的 Capability 到 Registry 中，Orchestrator 自动感知。
- Capability 间数据通过 `RuntimeState.data` 传递，保持松耦合。
