# Runtime 运行时引擎 v2

## 概述

`runtime_ts` 是多 Agent 编排系统（DAGents-InsightFlow）的分布式工作流运行时引擎，负责工作流节点的编排执行、事件传输和溯源追踪。

v2 版本从静态 DAG 编译模式重构为 **Orchestrator 编排模式**——工作流图不再一次性编译全量拓扑，而是在运行时由 Orchestrator Agent 逐节点决策路由，每次动态编译单个节点执行。

## 核心理念：Capability = 独立原子单元

每个业务节点被抽象为 **Capability**——一个包含业务逻辑、事件发射、容错处理和追踪能力的完整原子体。Capability 不依赖外部"管理器"替它做事，它是自描述的、可独立测试的、可热插拔的。

```
传统模式:  NodeRunner 替节点管理一切
v2 模式:   Capability 自己管理自己，Executor 只是轻量调用容器
```

## 模块架构

```
runtime_ts/
├── engine/         图引擎（极简内核）
├── capability/     原子能力抽象
├── bus/            事件管线（Redis Stream + Pub/Sub）
├── orchestrator/   动态路由编排
├── tracing/        全链路溯源
├── skills/         工具可插拔架构
├── state.ts        运行时状态
├── retry.ts        重试机制
├── graph_runtime.ts  入口编排器
└── index.ts        Barrel exports
```

## 一、engine/ — 图引擎

极简 StateGraph 实现，仅支持 `addNode → addEdge → compile → invoke`。

**导出：**
- `StateGraph<T>` — 图构建器（addNode / addEdge / setEntryPoint / compile）
- `CompiledGraph<T>` — 可执行图（invoke）
- `Checkpointer<T>` — 检查点持久化接口
- `END` — 图终止常量

**已移除的能力：**
- `addConditionalEdges` — 条件边，由 Orchestrator 替代
- `interrupt()` / `GraphInterrupt` — 人工中断，由每节点后暂停替代
- `Command` / resume — 不再需要恢复机制

## 二、capability/ — 原子能力

### Capability 接口

```typescript
interface Capability {
  id: string;                   // 唯一标识
  description: string;           // 能力描述（供 Orchestrator 感知）
  inputHints?: string[];         // 输入依赖提示
  outputHints?: string[];        // 产出物提示
  tools: Tool[];                 // 注册的工具列表
  requires?: string[];           // 前置依赖节点
  execute(state, ctx): Promise<CapabilityResult>;
}
```

### Tool 接口

每个 Tool 是一个独立目录，包含 `manifest.json` + 可选的 `skill.ts` 或 `mcp.json`：

```typescript
interface Tool {
  name: string;
  description: string;           // LLM function calling 使用
  parameters: Record<string, any>;
  eventPayloads?: {              // 工具特定的事件数据（不负责发送）
    onStart?(params): Record;
    onComplete?(result, durationMs): Record;
    onError?(error): Record;
  };
  execute(params, ctx): Promise<any>;
}
```

### 工具目录结构

```
tools/
├── web_search/
│   ├── manifest.json           # 工具元信息
│   └── skill.ts                # 本地实现
├── pricing_fetch/
│   ├── manifest.json
│   └── mcp.json                # MCP 远程调用
└── supabase_query/
    ├── manifest.json
    └── mcp.json
```

### CapabilityRegistry

全局注册表，所有 Capability 通过它注册和发现。Orchestrator 用它构建候选节点集，GraphRuntime 用它查找目标节点。

### CapabilityExecutor

极薄的调用容器，负责：
1. 从 Registry 查找 Capability
2. 调用 `executeWithRetry` 包装执行
3. 截获 AbortError（用户取消）和 NodeFatalError（重试耗尽）
4. 组装 RuntimeState

**重试策略**：默认 maxAttempts=3, timeoutSec=300, backoffBaseSec=2，可通过构造函数配置。

## 三、bus/ — 事件管线

### 架构

```
Capability.ctx.emit() → EventBus.publish() → Redis
                                              ├── XADD events:{wid}:{rid}  → Persister → DB（异步）
                                              └── PUBLISH sse:{wid}        → SSERelay → 前端（实时）
```

### EventBus 接口

```typescript
interface EventBus {
  publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void>;
  subscribe(workflowId: string, handler): Promise<void>;
  unsubscribe(workflowId: string): Promise<void>;
}
```

### RedisEventBus

- **同步写 Redis**：XADD + PUBLISH 一次完成，< 1ms 延迟
- **断连降级**：事件暂存内存队列（上限 10,000），重连后批量回放
- **Persist 标记**：`opts.persist = false` 时仅推送 SSE，不写入 Stream（如 `llm_stream`）

### SSERelay

- 前端 `GET /api/workflows/{id}/stream` → 建立 SSE 连接 → Redis SUBSCRIBE
- 连接断开自动清理，广播失败自动移除死连接
- Capability 完全感知不到 SSE——事件通过 Redis Pub/Sub 解耦

### EventPersister

Redis Stream 消费者组，批量异步写入 DB。支持水平扩展（多 worker 通过 Consumer Group 分担）。

### WorkflowEvent 格式

```typescript
interface WorkflowEvent {
  traceId: string;
  parentTraceId?: string;
  eventType: string;
  uiHint: UiHint;              // 前端渲染指令
  nodeId: string;
  workflowId: string;
  runId: string;
  payload: Record<string, any>;
  timestamp: string;
}
```

### UiHint 枚举

| 值 | 触发场景 | 前端渲染 |
|----|---------|---------|
| `tool_call` | 工具开始调用 | 展开子执行框 |
| `tool_result` | 工具返回结果 | 填充结果数据 |
| `tool_error` | 工具调用失败 | 标红 + 重试按钮 |
| `llm_stream` | LLM 流式输出 | 流式文本追加 |
| `node_progress` | 节点阶段推进 | 进度条更新 |
| `routing_decision` | Orchestrator 生成候选 | 候选按钮列表 |
| `workflow_paused` | 等待人工决策 | 高亮暂停状态 |
| `node_completed` | 节点执行完成 | 状态变绿 |
| `workflow_complete` | 工作流结束 | 终态展示 |
| `workflow_failed` | 工作流失败 | 错误面板 |
| `degradation_notice` | 系统部分降级 | banner/toast |

## 四、orchestrator/ — 动态路由

### Orchestrator 职责

Orchestrator 是整个工作流的**总编排者**，不只做路由决策：

1. **Discovery** — 探测注册表中所有 Capability 的能力画像
2. **Planning** — 基于总需求 + 能力画像，用 LLM 生成执行计划（TaskPlan）
3. **Routing** — 每节点后生成候选路由方案，推送前端供人工决策

### 编排循环

```
1. 初始化: Discovery → Planning → 生成 TaskPlan
2. 循环:
   a. 人工选择目标节点
   b. GraphRuntime.compile(targetNode) → invoke
   c. 节点完成后 → Orchestrator 生成候选路由
   d. 规则过滤 + LLM 排序 → 推送前端
   e. 人工决策 → 回到步骤 a
```

### 降级链

```
完整: Discovery → Planning → 候选生成 → LLM 排序 → 推送
降级:  跳过 Planning   全节点候选   规则顺序（无理由）
```

任何单点故障不阻塞主流程，降级行为通过 `degradation_notice` 事件通知前端。

### 子节点探测（CapabilityDiscoverer）

从 Registry 读取所有 Capability 的 `description` / `inputHints` / `outputHints` / `tools`，生成 `CapabilityProfile[]` 供 Planner 使用。

### 需求拆分（TaskPlanner）

利用 LLM 将总需求分解为多阶段执行计划：

```typescript
interface TaskPlan {
  phases: [{ name: "采集", targetNodes: ["collection"], rationale: "..." }];
  dependencies: { "analysis": ["collection"] };
}
```

Plan 的 targetNodes 在候选引擎中获得更高权重（planWeight = 1.0 vs 0.5）。

### 候选引擎（CandidateEngine）

- 排除当前节点 → 标记 pending/rerun → 应用 Plan 权重 → 过滤不可用的 Capability
- 降级模式：返回所有已注册节点

### LLM 排序器（LlmRanker）

- 接收候选集 + 工作流上下文 + TaskPlan，LLM 按优先级排序并生成理由
- LLM 失败 → 回退到规则排序（pending 优先于 rerun，plan 内优先于 plan 外）

## 五、tracing/ — 全链路溯源

### traceId 设计

- `traceId` — 单次事件的 ULID（独立唯一标识）
- `parentTraceId` — 父事件 traceId（用于树形链路重组）
- `runId` — 单次工作流执行 UUID（顶层分组键）

```
run_abc123 (runId)
  ├─ NODE_STARTED  traceId=ULID1, parentTraceId=null
  │   ├─ TOOL_CALL  traceId=ULID2, parentTraceId=ULID1
  │   └─ TOOL_RES   traceId=ULID3, parentTraceId=ULID1
  ├─ NODE_COMPLETED traceId=ULID4, parentTraceId=null
  └─ ROUTING       traceId=ULID5, parentTraceId=null
```

### TraceCollector

从扁平事件列表按 `parentTraceId` 重组树形链路 → 写入 TraceStore。

## 六、skills/ — 工具可插拔

### SkillLoader

- 扫描 `tools/` 目录 → 读取 `manifest.json` → 动态 `import("skill.js")` → 注册为 Tool
- **热插拔**：`watch()` 方法监听目录变化，回调通知外部重新注册

### McpAdapter

- 将 MCP 工具描述符包装为标准化 Tool 接口
- `McpProcessManager`：MCP 服务进程生命周期管理（启动/停止/检测）

## 七、GraphRuntime — 入口编排器

```typescript
const runtime = new GraphRuntime(registry, checkpointer?);

// 初始化状态
const state = runtime.initialState({ requirement: "分析竞品" });

// 初始化 Orchestrator
const orch = new Orchestrator(runtime.registry, ctx, eventBus);
await orch.initialize(state.data.requirement);

// 编排循环
while (true) {
  const suggestions = await orch.suggestRoute(completedNode, state, summary);
  if (!orch.hasMoreCandidates(state)) break;
  // 人工选择 targetNode...
  state = await runtime.executeStep(targetNode, state, ctx);
}
```

- `executeStep(nodeId, state, ctx)` — 编译单节点图 → invoke → 返回新 state
- `recover()` — 从 checkpoint 恢复（checkpointer 已配置时）

## 八、RuntimeState

```typescript
interface RuntimeState {
  data: Record<string, any>;         // Capability 读写的业务数据
  control: {
    currentNode: string;             // 当前执行的节点
    executionPath: ExecutionStep[];  // 完整执行路径（含重试记录）
  };
  runtime: {
    workflowId: string;
    runId: string;
    threadId: string;
  };
  errors: ErrorRecord[];
}
```

## 依赖关系

```
orchestrator → capability → engine
bus 横向贯穿所有层
tracing 依赖 bus
skills 依赖 capability types
```

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 图编译 | 单节点动态编译 | 消除条件边 + gate，每次 O(1) 开销 |
| 事件传输 | Redis Stream + Pub/Sub | 同步写入保证顺序，异步消费解耦 |
| SSE | Redis Pub/Sub 中转 | Capability 不直接接触 SSE 连接 |
| 路由 | 规则引擎 + LLM 排序 | 规则保证候选合法性，LLM 提供智能排序 |
| 重试 | 指数退避 + 可配置策略 | CapabilityExecutor 默认集成 |
| 工具 | 目录扫描 + 动态 import | 零运行时依赖，支持热插拔 |
