# PMax 开发进度

> 最后更新：2026-07-08 20:11（HITL 收尾）

## 开发阶段与目标

### At Present

Phase 2

---

### Phase 1：基础设施 & 技术验证

**目标**：完成系统架构设计与核心基础设施搭建，验证关键技术可行性。

**任务清单**：

- [x] **P1.1 业务场景明确化**：确定 Phase 2 首发场景为"产品横向对比",锁定"功能对比矩阵"和"SWOT 矩阵"两种产物格式。
- [x] **P1.2 系统架构设计**：Orchestrator 编排模式、Capability 原子能力抽象、事件总线、Skills 可插拔架构——已完成设计文档。
- [x] **P1.3 Runtime 引擎 v2 重构**：从静态 DAG 编译模式重构为 Orchestrator 动态编排模式（`backend/runtime/`）。
  - [x] engine/ — 极简 StateGraph（单节点动态编译）
  - [x] capability/ — Capability 接口 + Registry + Executor
  - [x] bus/ — RedisEventBus + Persister + SSERelay
  - [x] orchestrator/ — Discovery + Planner + CandidateEngine + LlmRanker
  - [x] tracing/ — traceId/ULID + TraceCollector
  - [x] skills/ — SkillLoader + McpAdapter
  - [x] retry.ts + state.ts + graph_runtime.ts
  - [x] Capability 工厂模式 + 5 节点通用工作流全部实现并通过 E2E 测试验证

---

### Phase 2：核心链路——产品横向对比

**目标**：完成"产品横向对比"场景从需求输入到产物输出的完整闭环。

**任务清单**：

**2.1 Capability 实现**（按数据流顺序）：

- [x] **P2.1.1 需求解析 Capability**：解析用户输入的分析需求，提取竞品列表、对比维度、产物格式等结构化参数。产出：`config.competitors[]`, `config.dimensions[]`, `config.outputFormat`。
- [x] **P2.1.2 信息采集 Capability**：基于竞品列表 + 对比维度，调用搜索/爬取 Tools 采集原始信息。产出：`rawData.{competitor}.{dimension}[]`。
- [x] **P2.1.3 分析对比 Capability**：对采集数据进行维度化对比分析，LLM 驱动的归纳和差异识别。产出：`feature_matrix`, `swot_matrix`。
- [x] **P2.1.4 产物生成 Capability**：将分析结果格式化为最终产物（Markdown 表格 / JSON / 可导出格式）。产出：`artifacts[]`。

**2.2 Tools 实现**（Capability 依赖的工具集）：

- [x] **P2.2.0 llm_structured_extract Tool**：LLM 结构化 JSON 提取工具（manifest.json + skill.ts，工厂函数模式）。
- [x] **P2.2.1 Web Search Tool**：通用网页搜索工具（对接 DDG Instant Answer API，零外部依赖）。
- [x] **P2.2.2 Web Scrape Tool**：单页内容抓取与清洗工具（@mozilla/readability + jsdom，含噪音过滤）。
- [x] **P2.2.3 5 个 P0 Tools 全部完成**：web_search、web_scrape、matrix_builder、swot_generator、table_composer。

**2.3 后端集成**：

- [x] **P2.3.1 API 端点**：`POST /api/workflows`（创建） + `GET /api/workflows/{id}/stream`（SSE） + `POST /api/workflows/{id}/route`（路由决策） + `GET /api/workflows/{id}/history`（事件回放）。
- [x] **P2.3.2 错误处理与兜底**：统一异常拦截（AllExceptionsFilter）、全局守卫（JwtAuthGuard）、节点级错误恢复（CapabilityExecutor 重试机制）。
- [x] **P2.3.3 事件持久化**：Redis → PostgreSQL 异步写入落地 + 历史查询（EventsService + Prisma）。

**2.4 人在回路集成**：

- [x] **P2.4.1 关键决策点暂停**：事件溯源模式实现路由决策暂停，Redis Pub/Sub 唤醒机制。
- [x] **P2.4.2 中间结果审查**：支持任意回跳 + 级联失效清除，fold 纯函数投影。

**2.5 前端实现**：

- [ ] **P2.5.1 分析需求输入页**：竞品名称/URL 输入、对比维度选择（功能/定价/用户体验等）、产物类型选择。
- [ ] **P2.5.2 工作流执行面板**：节点状态展示（pending/running/completed/failed）、SSE 实时进度、工具调用子面板。
- [ ] **P2.5.3 路由决策面板**：Orchestrator 候选节点展示 + 人工选择交互。
- [ ] **P2.5.4 产物展示页**：对比矩阵表格渲染、SWOT 矩阵可视化、产物导出（PDF/Excel）。
- [ ] **P2.5.5 溯源链表面板**：事件时间线 + 原始来源链接展示。

---

### Phase 3：分析能力深化 & 质量体系

**目标**：扩展分析场景、建立产物质量评估机制、优化 P2 已知不足。

**任务清单**：

**3.1 新增分析场景**：

- [ ] **P3.1.1 产品发展决策 Capability**：基于竞品对比结果 + 行业背景数据，产出差异化机会地图、定位声明、发展策略路径。
- [ ] **P3.1.2 产业趋势分析 Capability**：PEST 分析、产业链结构、市场规模与变化、竞争格局分析。
- [ ] **P3.1.3 新增配套 Tools**：行业报告搜索、新闻舆情聚合、数据可视化等。

**3.2 产物质量评估**：

- [ ] **P3.2.1 评估指标体系**：定义完整性（是否覆盖所有指定维度）、一致性（数据间无矛盾）、可溯源比例（多少结论有来源链接）等指标。
- [ ] **P3.2.2 自动评估 Capability**：在每个分析节点后自动运行评估，产出质量报告。
- [ ] **P3.2.3 评估结果反馈循环**：质量不达标时触发自动重试或提醒人工介入。

**3.3 持久化信息数据库**：

- [ ] **P3.3.1 结构化存储**：分析结果、原始数据、产物版本的结构化持久化。
- [ ] **P3.3.2 检索能力**：基于向量数据库的语义检索 + 关键词全文检索。
- [ ] **P3.3.3 知识积累与复用**：历史分析结果自动索引，新分析时可引用历史数据作为基线。

**3.4 P2 优化**：

- [ ] **P3.4.1 性能优化**：大规模竞品（>10 个）分析场景的并行采集和结果聚合优化。
- [ ] **P3.4.2 产物模板系统**：支持用户自定义产物模板（对比表列定义、报告章节结构等）。
- [ ] **P3.4.3 前端交互优化**：基于 P2 使用反馈改进 UX。

---

### 后续 Phase（远期规划）

- **多用户协作**：分析项目共享、评论、版本对比。
- **定时监控**：竞品动态自动追踪与变更提醒。
- **多语言支持**：国际化信息采集与分析。
- **自定义 Capability 市场**：允许用户/第三方开发和注册自定义分析能力。

---

## 三、当前状态汇总

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| Phase 1 | ✅ 完成 | 100%（Runtime v2 + 5 节点通用工作流 + E2E 测试全部通过） |
| Phase 2 | 进行中 | ~85%（8 个 Tools 全部完成，5/5 Capability 全部实现，后端骨架 10/10 Task 全部完成，HITL 人在回路闭环（事件溯源 + 暂停/唤醒 + 回跳），后端集成完成，**待前端开发（P2.5.1-P2.5.5）**） |
| Phase 3 | 未开始 | 0% |
