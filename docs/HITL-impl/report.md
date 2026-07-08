# HITL 人在回路 — 实现报告

> 基于事件溯源（Event Sourcing）模式，实现工作流执行中的人工决策暂停、任意回跳、级联失效清除。
> 不改动 `backend/runtime/` 任何文件。

---

## 一、设计决策

| 维度 | 决策 |
|------|------|
| 暂停粒度 | 每个路由决策点（Orchestrator suggestRoute 后） |
| 超时策略 | 无限等待 |
| 回跳自由度 | 任意前序节点 |
| 回跳数据策略 | 清除下游所有 outputHints，自然流转重执行 |
| 状态管理 | Event 表 append-only + fold 纯函数投影 |

---

## 二、架构

```
Event 表 (PostgreSQL, append-only)
     │
     ▼  loadEventStream()
Runner 启动 ──→ fold 投影 RuntimeState ──→ 定位恢复点
     │
     ▼  编排循环
executeStep → appendEvent("node.executed") → suggestRoute
     │
     ▼  暂停
appendEvent("route.required") → Redis SUBSCRIBE → SSE 推送前端
     │
     ▼  人工操作
POST /route → appendEvent("human.continued" / "human.backjumped")
           → Redis PUBLISH 唤醒 Runner
     │
     ▼  恢复
fold 投影处理回跳清除 → executeStep → 自然流转
     │
     ▼  终止
artifact_generation → appendEvent("workflow.completed")
```

---

## 三、核心机制

### 3.1 事件溯源投影

事件即真相源。`fold` 是纯函数：`(state, event, registry) → newState`。

```typescript
fold(state, "node.executed")     → state with new execution step
fold(state, "human.continued")   → state with updated currentNode
fold(state, "human.backjumped")  → state with truncated path + cleared downstream data
fold(state, "route.required")    → state unchanged (passthrough)
```

### 3.2 暂停/唤醒机制

编排循环在每个节点完成后的 `suggestRoute()` 处分岔：

1. Runner 发射 `route.required` 事件 → SSE → 前端渲染决策面板
2. Runner 调用 `waitForHumanDecision()` → Redis SUBSCRIBE `workflow:{id}:decision` 等待
3. 用户点击 → `POST /api/workflows/:id/route` → 写入事件 + Redis PUBLISH 唤醒
4. Runner 收到决策 → fold 投影 → 继续执行

### 3.3 回跳

`human.backjumped(targetNode)` 触发：

1. 截断 executionPath 到 targetNode
2. 收集 targetNode 之后所有节点的 outputHints
3. 从 state.data 中删除这些 key
4. 编排循环从 targetNode 重新执行

下游节点因数据缺失，自然流转时会重新执行（级联重算）。同一节点多次执行通过 `iteration` 字段区分。

### 3.4 恢复点定位

Runner 启动时从事件流末尾推导恢复点：

- 无历史事件 → 新工作流，从 `requirement_parsing` 开始
- 最后事件是 `human.continued/backjumped` → 已有决策，执行 targetNode
- 最后事件是 `route.required` → 等待决策
- 最后事件是 `completed/failed/cancelled` → 已终止，不执行
- 进程崩溃 → 重启后 loadEventStream → fold 重放到崩溃前状态 → 从恢复点继续

---

## 四、文件清单

| 文件 | 操作 | 行数 | 说明 |
|------|------|------|------|
| `backend/src/workflow/events.ts` | 新建 | 103 | 7 种事件类型 + fold + countIterations + getOutputKeys |
| `backend/src/workflow/runner.ts` | 新建 | 123 | runWorkflow async generator + RunnerDeps 接口 |
| `backend/prisma/schema.prisma` | 修改 | +3 | Workflow 加 `pausedAt`, `currentNode` |
| `backend/entry/workflow.ts` | 修改 | 24(精简) | createWorkflow → createRegistry 工厂 |
| `backend/src/api/workflows/workflows.service.ts` | 修改 | 224 | routeDecision/cancel 接线 + Redis 唤醒 + RunnerDeps |
| `backend/src/api/workflows/workflows.controller.ts` | 修改 | +10 | cancel 端点 + route body 更新 |
| `backend/src/api/workflows/__tests__/workflows-hitl.test.ts` | 新建 | 194 | 10 个 fold/级联测试 |
| `backend/entry/__tests__/workflow.test.ts` | 修改 | 重写 | E2E 适配 runner + auto-continue mock |

**Runtime 目录零改动。**

---

## 五、API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `POST /api/workflows/:id/route` | POST | 路由决策 `{ targetNode, action?: "continue" \| "backjump" }` |
| `POST /api/workflows/:id/cancel` | POST | 终止工作流（AbortSignal + status=cancelled） |

---

## 六、测试覆盖

| 测试文件 | 用例数 | 内容 |
|----------|--------|------|
| `workflows-hitl.test.ts` | 10 | fold 投影（node.executed/human.continued/human.backjumped/passthrough）、countIterations、getOutputKeys |
| `workflow.test.ts` | 2 | 完整 E2E（事件链验证/空输入处理） |
| **全量** | **66** | 9 个测试文件，全部通过 |

---

## 七、事件流示例

### 正常执行

```
1. node.executed("requirement_parsing", iter=0)
2. route.required → SSE 推送到前端
3. human.continued("information_collection")
4. node.executed("information_collection", iter=0)
5. route.required → SSE
6. human.continued("information_processing")
7. node.executed("information_processing", iter=0)
8. route.required → SSE
9. human.continued("analysis_reasoning")
10.node.executed("analysis_reasoning", iter=0)
11.route.required → SSE
12.human.continued("artifact_generation")
13.node.executed("artifact_generation", iter=0)
14.workflow.completed
```

### 含回跳

```
... (同正常执行到第 8 步)
9. human.backjumped("information_collection")  ← 回跳
10.node.executed("information_collection", iter=1)  ← 重新执行
11.route.required → SSE
12.human.continued("information_processing")
13.node.executed("information_processing", iter=1)  ← 级联重执行
...
```

---

## 八、与后续能力的衔接

| 后续能力 | 本设计的支撑 |
|----------|-------------|
| **僵死检测** | Workflow.pausedAt 已就位，定时扫描超时 paused 状态 |
| **工作流重启** | fold 重放事件流即恢复，无需额外开发 |
| **崩溃恢复** | Event 表持久化 + Runner 启动自动 fold 恢复 |
| **审计/溯源** | Event 表即完整时间线，可 fold 到任意事件索引 |
| **前端渲染** | SSE 推送所有事件，按 executionPath + max iteration 区分有效/废弃 |

---

## 九、提交记录

```
8af824a feat: add pausedAt and currentNode fields to Workflow for HITL
9559024 feat: add WorkflowLifecycleEvent types and fold projection for HITL
88bbe08 feat: add event-driven runWorkflow loop with pause/resume for HITL
267d481 refactor: simplify entry to factory-only, delegate orchestration to runner
e2f935e feat: wire routeDecision/cancel with Redis wake-up for HITL
4bb390a feat: add cancel endpoint and update route decision body for HITL
8a9f16d test: add unit tests for fold projection and HITL cascade invalidation
44e7878 feat: wire routeDecision/cancel with Redis wake-up for HITL
b222d63 test: update entry workflow test for HITL runner pattern
5ed7f61 docs: update change log and dev progress for HITL implementation
```
Branch: `feat/p2-HITL` | Base: `main` (c8d515c) | Tests: 66/66 pass
