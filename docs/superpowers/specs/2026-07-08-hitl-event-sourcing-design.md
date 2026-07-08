# HITL 人在回路 — 事件溯源设计

> 基于事件溯源（Event Sourcing）模式，实现工作流执行中的人工决策暂停、任意回跳、级联失效清除。
> 不改动 `backend/runtime/` 任何文件。

---

## 一、需求摘要

| 维度 | 决策 |
|------|------|
| 暂停粒度 | 每个路由决策点（Orchestrator suggestRoute 后） |
| 超时策略 | 无限等待 |
| 回跳自由度 | 任意前序节点 |
| 回跳数据策略 | 清除下游所有 outputHints，自然流转重执行 |
| 状态持久化 | Event 表 append-only，fold 纯函数投影 |

---

## 二、架构概览

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

### 组件

| 组件 | 文件 | 职责 |
|------|------|------|
| 事件类型 + fold | `backend/src/workflow/events.ts` | 事件类型定义、fold 纯函数投影、回跳清除逻辑 |
| 编排 Runner | `backend/src/workflow/runner.ts` | 事件加载 → 投影 → 编排循环 → 暂停/恢复 |

### 改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/workflow/events.ts` | 新建 | 事件类型 + fold + 回跳清除 |
| `backend/src/workflow/runner.ts` | 新建 | 事件驱动编排循环 + waitForHumanDecision |
| `prisma/schema.prisma` | 修改 | Workflow 加 `pausedAt`, `currentNode` |
| `backend/entry/workflow.ts` | 修改 | 删除 while 循环，改为委托 Runner |
| `backend/src/api/workflows/workflows.service.ts` | 修改 | routeDecision/cancel 接线 + Redis 唤醒 |
| `backend/src/api/workflows/workflows.controller.ts` | 修改 | 新增 cancel 端点 |

**`backend/runtime/` 零改动。**

---

## 三、数据模型

### Prisma Schema 变更

```prisma
model Workflow {
  // ... 现有字段 ...
  status      String    @default("pending")
  // 新增：
  // status 可用值: pending | running | paused | completed | failed | cancelled
  currentNode String?    // 当前/最后执行节点 ID，恢复定位
  pausedAt    DateTime?  // 暂停时间戳
}
```

### 新增 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `POST /api/workflows/:id/route` | POST | 已有，改造为写入事件 + Redis 唤醒 |
| `POST /api/workflows/:id/cancel` | POST | 新增，终止工作流 |

### routeDecision Body

```typescript
{
  targetNode: string;                   // 目标节点 ID
  action: "continue" | "backjump";      // 继续 or 回跳
}
```

---

## 四、事件定义

```typescript
// backend/src/workflow/events.ts

type WorkflowLifecycleEvent =
  | { type: "node.executed";      nodeId: string; iteration: number; outputKeys: string[] }
  | { type: "route.required";     completedNode: string; suggestions: RouteSuggestion[] }
  | { type: "human.continued";    targetNode: string }
  | { type: "human.backjumped";   targetNode: string }
  | { type: "workflow.completed" }
  | { type: "workflow.failed";    error: string }
  | { type: "workflow.cancelled" };
```

事件通过 `EventsService` 持久化到 `Event` 表，复用现有 `{ eventType, nodeId, payload, timestamp }` 结构。

---

## 五、fold 投影函数

纯函数：输入当前 `RuntimeState` + 一个事件 + `CapabilityRegistry`，输出新 `RuntimeState`。

```typescript
function fold(
  state: RuntimeState,
  event: WorkflowLifecycleEvent,
  registry: CapabilityRegistry
): RuntimeState {
  switch (event.type) {
    case "node.executed":
      return {
        ...state,
        control: {
          ...state.control,
          currentNode: event.nodeId,
          executionPath: [
            ...state.control.executionPath,
            {
              nodeId: event.nodeId,
              iteration: event.iteration,
              startedAt: "",
              completedAt: new Date().toISOString(),
            },
          ],
        },
      };

    case "human.backjumped": {
      const idx = state.control.executionPath.findIndex(
        s => s.nodeId === event.targetNode
      );
      if (idx === -1) return state;

      const downstream = state.control.executionPath.slice(idx + 1);
      const staleKeys = new Set<string>();
      for (const s of downstream) {
        (registry.get(s.nodeId)?.outputHints ?? []).forEach(k => staleKeys.add(k));
      }

      return {
        ...state,
        data: omitKeys(state.data, [...staleKeys]),
        control: {
          ...state.control,
          currentNode: event.targetNode,
          executionPath: state.control.executionPath.slice(0, idx + 1),
        },
      };
    }

    case "human.continued":
      return {
        ...state,
        control: { ...state.control, currentNode: event.targetNode },
      };

    // route.required / workflow.completed / failed / cancelled 不改 state
    default:
      return state;
  }
}
```

### 回跳清除逻辑

回跳节点后的所有 Capability 会被重新执行，因此其所有 `outputHints` 声明产出 key 全部从 `state.data` 中清除。自然流转时重新执行会自动填充新数据。

### 恢复点定位

Runner 启动时从事件流末尾事件推导恢复点：

| 最后事件 | 恢复行为 |
|----------|----------|
| `node.executed({ nodeId: "X" })` | 从 suggestRoute 开始，completedNode=X |
| `route.required` | 等待人工决策，不执行任何节点 |
| `human.continued / human.backjumped` | 执行 targetNode |
| `workflow.completed / failed / cancelled` | 不再执行，直接返回 |
| 无事件（新工作流） | 从 initialState + requirement_parsing 开始 |

---

## 六、Runner 编排循环

```typescript
// backend/src/workflow/runner.ts

async function* runWorkflow(
  workflowId: string,
  userInput: string,
  registry: CapabilityRegistry,
  ctx: RuntimeContext,
  eventBus: EventBus
): AsyncGenerator<void> {

  // 1. 加载事件流 + 投影状态
  const pastEvents = await loadEventStream(workflowId);
  let state = initialState(userInput);
  for (const e of pastEvents) state = fold(state, e, registry);

  // 2. 定位恢复点
  const lastEvent = pastEvents.at(-1);
  let currentNode: string | null = null;

  if (!lastEvent) {
    // 全新工作流：执行入口节点
    currentNode = "requirement_parsing";
  } else if (lastEvent.type === "human.continued" || lastEvent.type === "human.backjumped") {
    currentNode = lastEvent.targetNode;
  } else if (lastEvent.type === "route.required") {
    // 等待人工决策
    currentNode = null;
  } else {
    // 已终止，不执行
    return;
  }

  const orch = new Orchestrator(registry, ctx, eventBus);
  await orch.initialize(userInput);

  // 3. 编排循环
  while (currentNode) {
    // 执行节点
    state = await executeStep(currentNode, state, ctx);
    const iteration = countIterations(state, currentNode);
    yield appendEvent("node.executed", { nodeId: currentNode, iteration, outputKeys: getOutputKeys(currentNode, registry) });

    // 终止检查
    if (currentNode === "artifact_generation") {
      yield appendEvent("workflow.completed");
      break;
    }

    // 路由
    const suggestions = await orch.suggestRoute(currentNode, state, "state summary");
    yield appendEvent("route.required", { completedNode: currentNode, suggestions });

    // 等待人工决策（Redis Pub/Sub gate）
    const decision = await waitForHumanDecision(workflowId);
    const eventType = decision.action === "backjump" ? "human.backjumped" : "human.continued";
    yield appendEvent(eventType, { targetNode: decision.targetNode });

    state = fold(state, { type: eventType, targetNode: decision.targetNode } as any, registry);
    currentNode = decision.targetNode;
  }
}
```

### waitForHumanDecision

```typescript
function waitForHumanDecision(workflowId: string): Promise<Decision> {
  return new Promise((resolve) => {
    const channel = `workflow:${workflowId}:decision`;
    redis.subscribe(channel, (msg) => {
      redis.unsubscribe(channel);
      resolve(JSON.parse(msg));
    });
  });
}
```

### routeDecision API 实现

```typescript
async routeDecision(workflowId: string, targetNode: string, action: "continue" | "backjump") {
  // 1. 追加决策事件
  const eventType = action === "backjump" ? "human.backjumped" : "human.continued";
  await this.eventsService.appendEvent(workflowId, { type: eventType, targetNode });

  // 2. 更新 DB 状态（解除暂停）
  await this.prisma.workflow.update({
    where: { id: workflowId },
    data: { status: "running", pausedAt: null, currentNode: targetNode },
  });

  // 3. 唤醒 Runner
  await this.redis.publish(`workflow:${workflowId}:decision`, JSON.stringify({ action, targetNode }));
}
```

---

## 七、事件流示例

### 正常执行

```
1. node.executed { nodeId: "requirement_parsing",    iteration: 0 }
2. route.required  { completedNode: "requirement_parsing", suggestions: [...] }
3. human.continued { targetNode: "information_collection" }
4. node.executed { nodeId: "information_collection", iteration: 0 }
5. route.required  { completedNode: "information_collection", suggestions: [...] }
6. human.continued { targetNode: "information_processing" }
7. node.executed { nodeId: "information_processing", iteration: 0 }
8. route.required  { completedNode: "information_processing", suggestions: [...] }
9. human.continued { targetNode: "analysis_reasoning" }
10.node.executed { nodeId: "analysis_reasoning", iteration: 0 }
11.route.required  { completedNode: "analysis_reasoning", suggestions: [...] }
12.human.continued { targetNode: "artifact_generation" }
13.node.executed { nodeId: "artifact_generation", iteration: 0 }
14.workflow.completed
```

### 含回跳

```
1. node.executed { nodeId: "requirement_parsing",    iteration: 0 }
2. route.required  { completedNode: "requirement_parsing", suggestions: [...] }
3. human.continued { targetNode: "information_collection" }
4. node.executed { nodeId: "information_collection", iteration: 0 }
5. route.required  { completedNode: "information_collection", suggestions: [...] }
6. human.continued { targetNode: "information_processing" }
7. node.executed { nodeId: "information_processing", iteration: 0 }
8. route.required  { completedNode: "information_processing", suggestions: [...] }
9. human.backjumped { targetNode: "information_collection" }  ← 回跳
10.node.executed { nodeId: "information_collection", iteration: 1 }  ← 重新执行(iter+1)
11.route.required  { completedNode: "information_collection", suggestions: [...] }
12.human.continued { targetNode: "information_processing" }
13.node.executed { nodeId: "information_processing", iteration: 1 }  ← 级联重执行
...
```

---

## 八、错误处理

| 场景 | 处理 |
|------|------|
| Runner 进程崩溃 | 重启后 loadEventStream → fold 投影到崩溃前状态 → 从恢复点继续 |
| Capability 执行失败 | CapabilityExecutor 重试 3 次 → 失败则 appendEvent("workflow.failed")，不阻塞 |
| Redis Pub/Sub 失联 | waitForHumanDecision 不超时，持续等待；routeDecision API 重连后唤醒 |
| 回跳到不存在的节点 | fold 中 idx === -1 → 不修改 state，返回原状态 |
| 重复 routeDecision 调用 | DB status 已非 paused 时拒绝，返回 409 |
| AbortSignal 触发取消 | RuntimeContext.signal 已存在，追加 workflow.cancelled 后退出循环 |

---

## 九、与后续能力的衔接

| 后续能力 | 本设计的支撑 |
|----------|-------------|
| 僵死检测 | Workflow.pausedAt 已就位，定时任务扫描 pausedAt 超阈值即可 |
| 工作流重启 | fold 重放事件流即恢复状态，无需额外开发 |
| 崩溃恢复 | Event 表持久化 + Runner 重启时自动恢复 |
| 审计/溯源 | Event 表即完整时间线，可按事件索引查询任意时刻状态 |
| 前端渲染 | SSE 推送所有事件，前端按 executionPath + max iteration 区分有效/废弃记录 |
