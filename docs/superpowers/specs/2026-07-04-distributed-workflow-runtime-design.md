# 分布式工作流运行时重构设计

> 将 DAGents-InsightFlow 的 `runtime_ts` 静态 DAG 运行时改造为基于 Orchestrator 编排的高灵活性分布式工作流运行时。

---

## 一、概述

### 1.1 目标

将当前基于静态 DAG 编译 + gate 节点路由的工作流运行时，重构为以 **Orchestrator Agent** 为中心的动态编排体系。

### 1.2 核心变化

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 图编译 | 一次性全量编译，拓扑固定 | 每次路由后动态增量编译（单节点图） |
| 图结构 | 业务节点 + gate 节点 + 条件边 | 单业务节点 + 单条回 Orchestrator 的条件边 |
| 路由 | 节点内建 RoutePolicy | 外移给 Orchestrator Agent + 人工决策 |
| 暂停 | 仅 gate 节点的 PausePolicy 触发 | 每个节点执行完自动暂停，等待路由决策 |
| 工具 | 硬编码在 agent 实现中 | Skills/MCP 插件化，每需求对应独立目录 |
| 并发 | 无 | 单节点内 LLM 驱动的工具并行调度 |
| gate 节点 | 存在 | 删除 |
| RoutePolicy / PausePolicy | 存在 | 删除 |
| Python 运行时 | `app/core/runtime/` 镜像实现 | 删除 |

### 1.3 编排模式转换

```
旧模式（DAG 编排）:
  template → compile(全量图) → invoke → gate 路由 → 下一个节点

新模式（Orchestrator 编排）:
  Discovery（探测子节点能力）→ Planning（需求拆分 → TaskPlan）
  → Orchestrator 决策 → compile(单节点) → invoke
  → 自动暂停 → 更新 TaskPlan → Orchestrator 再决策
```

---

## 二、模块架构

### 2.1 目录结构

```
runtime_ts/
│
├── engine/                    ← 图执行引擎（极简内核）
│   ├── graph.ts               StateGraph 构建器 + CompiledGraph 执行器
│   ├── checkpointer.ts        Checkpointer 接口
│   └── index.ts
│
├── capability/                ← 原子能力抽象
│   ├── types.ts               Capability / Tool 接口 + CapabilityResult
│   ├── context.ts             RuntimeContext（替代 AgentContext）
│   ├── registry.ts            节点注册表（节点 id → Capability）
│   └── executor.ts            Capability 调用容器（原 node_runner，极薄）
│
├── bus/                       ← 事件管线
│   ├── types.ts               WorkflowEvent / UiHint / EventBus 接口
│   ├── redis_bus.ts           Redis 实现（Stream XADD + Pub/Sub PUBLISH）
│   ├── persister.ts           Redis Stream 消费者 → 批量写 DB
│   └── sse_relay.ts           Redis Pub/Sub 订阅者 → SSE 推送前端
│
├── orchestrator/              ← 总编排器（思考 + 决策 + 路由）
│   ├── types.ts               RouteCandidate / RouteSuggestion / TaskPlan
│   ├── discover.ts            子节点探测（维护注册表感知，分析 Capability 能力画像）
│   ├── planner.ts             需求拆分器（将总需求分解为子节点执行计划）
│   ├── candidate_engine.ts    规则引擎（生成合法候选集）
│   ├── llm_ranker.ts          LLM 排序器（排序 + 理由生成）
│   └── orchestrator.ts        Orchestrator Agent 主入口
│
├── tracing/                   ← 溯源体系
│   ├── trace_id.ts            溯源 ID 生成器（ULID）
│   └── collector.ts           TraceCollector（Redis Stream 消费者 → 溯源存储）
│
├── skills/                    ← 工具可插拔架构
│   ├── loader.ts              Tool 加载器（扫描 tools/ 目录 + 验证 + 注册）
│   └── adapter.ts             MCP 协议适配器 → 标准 Tool 接口
│
├── retry.ts                   ← 重试策略（保留，Capability 可选使用）
├── state.ts                   ← RuntimeState 类型（精简）
└── index.ts                   ← 公共 API 入口
```

### 2.2 目录语义

| 目录 | 含义 | 依赖方向 |
|------|------|---------|
| `engine/` | 引擎层——与业务无关的纯粹图执行能力 | 无外部依赖 |
| `capability/` | 能力层——原子能力的抽象和执行 | → engine |
| `bus/` | 消息总线——事件的生产、传输、消费 | 横向贯穿 |
| `orchestrator/` | 编排层——总指挥：子节点探测 → 需求拆分 → 路由决策 | → capability + bus |
| `tracing/` | 追踪层——全链路溯源 | → bus |
| `skills/` | 工具层——可插拔外部能力 | → capability types |

### 2.3 命名变更

| 旧名 | 新名 | 语义 |
|------|------|------|
| `NodeRunner` | `CapabilityExecutor` | 明确的"调用者"身份，不是"管理者" |
| `EventSink` | — | 已删除 |
| `AgentContext` | `RuntimeContext` | 不再是 Agent 专用，是所有 Capability 的运行时 |
| `NodeSpec` | `Capability` 接口 | 不是"配置项"，是"可执行单元" |
| `EventLogger` | `EventPersister` | 明确异步批量写入身份 |
| `SSEBroadcaster` | `SSERelay` | 明确"中转"而非"广播" |

### 2.4 删除清单

| 文件 | 原因 |
|------|------|
| `policies.ts` | RoutePolicy/PausePolicy 废弃，Orchestrator 接管路由 |
| `context.ts` | EventSink 废弃，AgentContext → RuntimeContext |
| `template.ts` | NodeSpec → Capability 接口，GraphTemplate → CapabilityRegistry |

### 2.5 保留与精简

| 文件 | 处理 |
|------|------|
| `graph.ts` | 精简：去掉 `addConditionalEdges`/`interrupt()`/`GraphInterrupt`/`Command`/`AsyncLocalStorage`；保留 `addNode`/`addEdge`/`compile`/`invoke`/`Checkpointer`/`END` |
| `state.ts` | 精简：control 层去掉 `routeLabel`/`humanDecision`/`lastPause`/`terminalStatus`/`lastDecision` |
| `retry.ts` | 保留，不改 |
| `node_runner.ts` | 重构为 `capability/executor.ts` |

---

## 三、事件管线

### 3.1 架构：Redis 为中心的同步写 + 异步消费

```
Capability.emit()
    │
    ▼ （同步，等待 Redis ACK）
Redis
    │
    ├── Stream XADD ──┬── EventPersister → 批量写 DB（异步消费者组）
    │                 └── TraceCollector → 溯源存储（异步）
    │
    └── Pub/Sub PUBLISH ── SSERelay → SSE 推送前端（实时）
```

### 3.2 技术决策

- **同步写 Redis Stream（XADD）**：保证事件写入顺序，ACK 确认持久化，同机房延时 < 1ms
- **异步消费写 DB**：消费者组模式，多 worker 水平扩展，不阻塞 Capability 执行
- **Pub/Sub 推送 SSE**：Capability 与 SSE 完全解耦，前端通过 `GET /api/workflows/{id}/stream` 建立 SSE 连接，后端通过 Redis 订阅推送
- **并发安全**：Node.js 单线程事件循环 + Redis 单线程顺序处理，天然保证写入顺序

### 3.3 EventBus 接口

```typescript
interface EventBus {
  /** 发布事件到 Redis（同步等待 ACK）+ SSE 广播 */
  publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void>;

  /** 订阅 workflow 实时事件流（SSE 使用） */
  subscribe(workflowId: string, handler: (event: WorkflowEvent) => void): Promise<void>;

  /** 取消订阅 */
  unsubscribe(workflowId: string): Promise<void>;
}
```

### 3.4 WorkflowEvent 格式

```typescript
interface WorkflowEvent {
  traceId: string;              // 唯一溯源 ID（ULID）
  parentTraceId?: string;       // 父溯源 ID（还原树形链路）
  eventType: string;            // 事件类型分类
  uiHint: UiHint;               // 前端渲染指令
  nodeId: string;
  workflowId: string;
  runId: string;
  payload: Record<string, any>; // 各工具/节点的差异化数据
  timestamp: string;            // ISO 8601
}
```

### 3.5 UiHint 枚举

| uiHint | 触发场景 | 前端渲染 |
|--------|---------|---------|
| `tool_call` | 工具开始调用 | 展开子执行框，显示工具名 + 参数 |
| `tool_result` | 工具返回结果 | 子执行框内填充结果数据 |
| `tool_error` | 工具调用失败 | 子执行框标红 + 错误信息 |
| `llm_stream` | LLM 流式输出 token | 流式文本追加 |
| `node_progress` | 节点阶段推进 | 进度条/阶段标签更新 |
| `routing_decision` | Orchestrator 生成候选路由 | 候选节点按钮列表 + 理由 |
| `workflow_paused` | 等待人工路由决策 | 高亮暂停状态 + 决策输入框 |
| `node_completed` | 节点执行完成 | 节点状态变绿 + 输出摘要 |
| `workflow_complete` | 工作流结束 | 终态展示 |
| `workflow_failed` | 工作流失败 | 错误面板 |
| `degradation_notice` | 系统部分降级 | banner/toast 提示，不阻塞操作 |

前端通过 `switch(uiHint)` 选择渲染组件，不感知具体业务逻辑。

---

## 四、Capability 与 Tool 接口

### 4.1 设计理念

**Capability = 业务逻辑 + 事件 + 容错 + 追踪的原子体**

每个 Capability 是完整的、自描述的、可独立部署的原子单元。不依赖外部"管家"替它做事——它自己做。NodeRunner 退化为 Capability 的极薄调用容器。

### 4.2 Capability 接口

```typescript
interface Capability {
  /** 唯一标识，对应工作流节点 ID */
  readonly id: string;

  /** 自然语言能力描述，供 Orchestrator 探测用，如 "竞品信息采集器" */
  readonly description: string;

  /** 宣告输入依赖，如 ["config.competitors", "rawData"] */
  readonly inputHints?: string[];

  /** 宣告产出物，如 ["feature_matrix", "swot"] */
  readonly outputHints?: string[];

  /** 该节点拥有的工具列表（从 tools/ 目录加载） */
  readonly tools: Tool[];

  /** 可选的前置依赖节点 ID（规则引擎使用） */
  readonly requires?: string[];

  /** 执行核心逻辑：自己做 LLM 决策、工具调度、事件发送 */
  execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult>;
}

interface CapabilityResult {
  patch: Record<string, any>;
  artifacts: ArtifactDraft[];
}
```

### 4.3 RuntimeContext

```typescript
interface RuntimeContext {
  traceId: string;
  parentTraceId?: string;
  workflowId: string;
  runId: string;
  nodeId: string;
  iteration: number;

  /** 发射事件到 EventBus（唯一对外通道） */
  emit(event: Partial<WorkflowEvent> & { uiHint: UiHint }, opts?: EmitOptions): Promise<void>;

  /** LLM 客户端 */
  llm: LlmClient;

  /** 显式持久化制品（可选） */
  saveArtifact(draft: ArtifactDraft): Promise<string>;
}

interface EmitOptions {
  /** 是否跳过 DB 持久化（仅 SSE），如 streamToken */
  persist?: boolean;
}
```

### 4.4 Tool 接口

```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;  // JSON Schema

  /** 可自定义的事件展示数据（只返回数据，不发送事件） */
  readonly eventPayloads?: {
    onStart?(params: Record<string, any>): Record<string, any>;
    onComplete?(result: any, durationMs: number): Record<string, any>;
    onError?(error: Error): Record<string, any>;
  };

  /** 执行工具 */
  execute(params: Record<string, any>, ctx: ToolContext): Promise<any>;
}

interface ToolContext {
  traceId: string;
  runId: string;
}
```

### 4.5 事件发送约定

- **Tool 不发送事件**：`eventPayloads` 只返回数据，由 Capability 在 `execute()` 中决定何时调用 `ctx.emit()`
- **Capability 控制事件时机**：每个 Tool 调用前/后，Capability 组装 `WorkflowEvent`（注入 traceId/uiHint/timestamp）后通过 `ctx.emit()` 发送
- **前端只认 uiHint**：Payload 内容由各 Tool/Capability 自定义，前端按 uiHint 选组件渲染

### 4.6 典型执行模式

```typescript
// Capability.execute() 示例
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  ctx.emit({ uiHint: "node_progress", stage: "planning" });

  // 1. LLM 决策工具调用方案
  const plan = await ctx.llm.plan(state, this.tools);

  // 2. 并行执行无依赖工具
  const results = await Promise.all(
    plan.parallel.map(async (call) => {
      const start = Date.now();
      const result = await call.tool.execute(call.params, { traceId: ctx.traceId, runId: ctx.runId });
      ctx.emit({
        uiHint: "tool_result",
        traceId: call.traceId,
        parentTraceId: ctx.traceId,
        payload: call.tool.eventPayloads?.onComplete?.(result, Date.now() - start)
              ?? { toolName: call.tool.name, result },
      });
      return result;
    })
  );

  // 3. LLM 合成
  ctx.emit({ uiHint: "node_progress", stage: "synthesizing" });
  const synthesized = await ctx.llm.synthesize(state, results);

  ctx.emit({ uiHint: "node_completed" });
  return { patch: synthesized, artifacts: [] };
}
```

---

## 五、Skills/MCP 可插拔工具架构

### 5.1 目录约定

```
tools/                                ← 每个 Tool 一个独立目录
├── web_search/
│   ├── manifest.json                 ← 必选：name / description / parameters
│   ├── skill.ts                      ← 可选：本地实现
│   └── mcp.json                      ← 可选：MCP 远程调用描述符
├── pricing_fetch/
│   ├── manifest.json
│   └── mcp.json
├── market_analysis/                  ← 纯 skill
│   ├── manifest.json
│   └── skill.ts
└── supabase_query/                   ← 纯 MCP
    ├── manifest.json
    └── mcp.json

capabilities/                         ← Capability 定义
├── collection/index.ts
├── analysis/index.ts
└── report/index.ts
```

### 5.2 加载逻辑

1. `SkillLoader.scan(toolsDir)` → 遍历 `tools/` 下每个子目录
2. 读取 `manifest.json` → 获取 name / description / parameters
3. 加载 `skill.ts`（本地 execute）+ 解析 `mcp.json`（MCP 远程 execute）→ 组合为标准 Tool
4. 验证 Tool 是否符合接口 → 注册到 ToolRegistry
5. Capability 在定义时引用 Tool 的 name → 从 ToolRegistry 获取

### 5.3 MCP 适配器

```typescript
class McpAdapter {
  /** 将 MCP 工具的 JSON 描述符转换为标准 Tool 接口 */
  static adapt(mcpManifest: McpManifest): Tool {
    return {
      name: mcpManifest.name,
      description: mcpManifest.description,
      parameters: mcpManifest.inputSchema,
      execute: async (params) => mcpClient.call(mcpManifest.name, params),
    };
  }
}
```

MCP Server 的启动和生命周期管理由 `adapter.ts` 负责，对 Capability 透明。

### 5.4 CapabilityRegistry

```typescript
class CapabilityRegistry {
  register(cap: Capability): void;
  get(id: string): Capability | undefined;
  listIds(): string[];
  listAll(): Capability[];
}
```

生产者（SkillLoader）填注册表，消费者（Orchestrator + GraphRuntime）从注册表取。完全解耦。

---

## 六、Orchestrator 总编排器

Orchestrator 是工作流的总指挥，不是一个简单的路由器。它具备**自主思考与决策**能力，是整個编排循环的大脑。

### 6.1 三大核心职责

```
初始化阶段：
  1. 子节点探测（Discovery）  → 认知自己拥有哪些子 Capability
  2. 需求拆分（Planning）     → 将总需求分解为可执行的节点计划

每轮路由阶段：
  3. 动态路由（Routing）      → 基于计划 + 执行上下文生成候选路由
```

### 6.2 子节点探测（Discovery）

Orchestrator 通过 CapabilityRegistry 感知所有已注册的子 Capability，并主动分析每个子节点的能力画像：

```typescript
class CapabilityDiscoverer {
  constructor(private registry: CapabilityRegistry) {}

  /** 生成每个子节点的能力画像，供 Orchestrator 思考用 */
  async discover(): Promise<CapabilityProfile[]> {
    const profiles: CapabilityProfile[] = [];
    for (const cap of this.registry.listAll()) {
      profiles.push({
        id: cap.id,
        description: cap.description,           // Capability 自述：我是什么
        tools: cap.tools.map(t => t.name),       // 我拥有哪些工具
        toolDescriptions: cap.tools.map(t => ({ name: t.name, desc: t.description })),
        inputHints: cap.inputHints,              // 我需要什么输入数据
        outputHints: cap.outputHints,            // 我会产出什么数据
        requires: cap.requires ?? [],            // 我的前置依赖
      });
    }
    return profiles;
  }
}

interface CapabilityProfile {
  id: string;
  description: string;
  tools: string[];
  toolDescriptions: { name: string; desc: string }[];
  inputHints: string[];       // 如 ["config.competitors", "rawData"]
  outputHints: string[];      // 如 ["feature_matrix", "swot"]
  requires: string[];          // 前置节点 ID
}
```

Capability 接口新增字段以支持能力自描述：

```typescript
interface Capability {
  readonly id: string;
  readonly description: string;      // 新增：自然语言描述 "竞品信息采集器"
  readonly inputHints?: string[];    // 新增：宣告输入依赖
  readonly outputHints?: string[];   // 新增：宣告产出物
  readonly tools: Tool[];
  readonly requires?: string[];
  execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult>;
}
```

### 6.3 需求拆分（Planning）

Orchestrator 接收工作流的顶层需求，结合子节点能力画像，将总需求拆分为可执行的节点执行计划（TaskPlan）。这是动态路由的**逻辑基础**——路由不再是无目的的"哪个节点都可以"，而是在计划的指引下推进。

```typescript
class TaskPlanner {
  constructor(private llm: LlmClient) {}

  /**
   * @param requirement  顶层需求描述，如 "对小红书和抖音做全面的竞品分析"
   * @param profiles     所有子节点的能力画像
   * @returns 分解后的执行计划
   */
  async plan(requirement: string, profiles: CapabilityProfile[]): Promise<TaskPlan> {
    const prompt = `
你是一个工作流编排器。你需要将以下总需求分解为一系列子任务，每个子任务对应一个目标子节点。

总需求: ${requirement}

可用的子节点及其能力：
${profiles.map(p => `
- **${p.id}**: ${p.description}
  输入依赖: ${p.inputHints?.join(", ") || "无"}
  产出物: ${p.outputHints?.join(", ") || "无"}
  工具: ${p.toolDescriptions.map(t => `${t.name}(${t.desc})`).join(", ")}
`).join("\n")}

请输出一个执行计划，包含：
1. 大致阶段划分（如：采集 → 分析 → 汇总 → 审查）
2. 每个阶段推荐执行的节点及理由
3. 节点间的数据依赖关系

格式: JSON { phases: [{ name, targetNodes: string[], rationale }], dependencies: { nodeId: string[] } }
`;

    const result = await this.llm.complete(prompt);
    return JSON.parse(result) as TaskPlan;
  }
}

interface TaskPlan {
  /** 阶段划分：高层级的执行路径建议 */
  phases: TaskPhase[];
  /** 节点间数据依赖：{ "report_writing": ["analysis", "feature_analysis"] } */
  dependencies: Record<string, string[]>;
}

interface TaskPhase {
  name: string;              // 阶段名，如 "信息采集"
  targetNodes: string[];     // 该阶段推荐执行的节点
  rationale: string;         // 推荐理由
}
```

**计划与路由的关系：**

- Plan 是**粗粒度的参照系**——告诉 Orchestrator "大致应该走采集 → 分析 → 报告这条线"
- 每轮路由时，CandidateEngine 将 plan 的阶段信息带入候选集排序权重，同一阶段内的节点获得更高优先级
- Plan 不是硬性约束——人工可以在任何时候选择计划外的节点（如回跳重试）
- Plan 随执行推进动态更新（已完成阶段被标记）

### 6.4 Capability 复用

Orchestrator 可以在一个工作流中多次调用同一个 Capability。例如：

```
TaskPlan: 采集 → 分析（竞品A） → 分析（竞品B） → 对比报告

执行序列:
  information_collection（采集A+B数据）
  → analysis（传入竞品A数据）→ 产出 feature_matrix_A
  → analysis（传入竞品B数据）→ 产出 feature_matrix_B
  → report_writing（合并对比）
```

因为 `analysis` 是一个**无状态 Capability**，每次调用传入不同 state 即可产生不同输出。Capability 的 `description`/`inputHints`/`outputHints` 让 Orchestrator 能够推理出这种复用模式。

### 6.5 编排循环

```
初始化阶段（工作流启动时执行一次）:
  Discovery → 获取所有子节点能力画像
  Planning  → 生成 TaskPlan

每轮循环:
  1. 候选生成（规则引擎 + TaskPlan 权重）
  2. LLM 排序 + 理由生成
  3. 推送前端 + 人工决策
  4. 单节点动态编译 + 执行
  5. 更新 TaskPlan 完成状态 → 回到 1
```

### 6.6 Step 1：规则引擎生成候选集

规则引擎将 TaskPlan 的阶段信息纳入候选排序权重：

```typescript
class CandidateEngine {
  generate(
    state: RuntimeState,
    completedNodeId: string,
    registry: CapabilityRegistry,
    plan: TaskPlan                     // 新增：执行计划参照
  ): RouteCandidate[] {
    const executedNodes = state.control?.executedNodes ?? [];
    const currentPhase = this.determineCurrentPhase(plan, executedNodes);
    const allNodes = registry.listIds();

    let candidates = allNodes
      .filter(id => id !== completedNodeId)
      .map(id => ({
        nodeId: id,
        status: executedNodes.includes(id) ? "rerun" : "pending",
        executable: true,
        // 计划权重：当前阶段内的节点得分更高
        planWeight: currentPhase?.targetNodes.includes(id) ? 1.0 : 0.5,
      }));

    candidates = this.filterByDependencies(candidates, state, registry);
    return candidates;
  }
}
```

### 6.7 Step 2：LLM 排序

LLM 接收候选集 + 工作流上下文 + **TaskPlan 的阶段信息**，输出按优先级排序的候选列表 + 一句话理由。Plan 中的推荐节点天然具有更高 base priority。LLM 失败时回退到规则默认顺序（pending 优先于 rerun，plan 内优先于 plan 外），不阻塞流程。

### 6.8 Step 3：前端推送

```typescript
{
  uiHint: "routing_decision",
  payload: {
    completedNode: "analysis",
    currentPhase: "深层分析",                    // 新增：当前所处阶段
    planProgress: {                               // 新增：计划执行进度
      completed: ["information_collection", "analysis"],
      remaining: ["report_writing"],
    },
    suggestions: [
      { nodeId: "report_writing",  priority: 1, reason: "分析数据齐备，建议直接生成报告（当前阶段终节点）" },
      { nodeId: "feature_analysis", priority: 2, reason: "可进一步细化功能维度（回跳深层分析）" },
    ],
    executedNodes: ["information_collection", "analysis"],
  }
}
```

人工点击 → `POST /api/workflows/{id}/route { targetNode: "report_writing" }`

### 6.9 Step 4：动态编译 + 执行

每次只编译一个节点 + END 的微图：

```typescript
async function executeStep(nodeId: string, state: RuntimeState, registry: CapabilityRegistry, ctx: RuntimeContext) {
  const cap = registry.get(nodeId);
  const graph = new StateGraph<RuntimeState>();
  graph.addNode(nodeId, async (s) => cap.execute(s, ctx));
  graph.addEdge(nodeId, END);
  graph.setEntryPoint(nodeId);
  return graph.compile(checkpointer).invoke(state, config);
}
```

### 6.10 终止条件

- 人工选择"终止工作流"
- TaskPlan 所有阶段完成 + 无可执行候选节点
- 完整执行路径可在事后从事件链路中还原

---

## 七、溯源体系

### 7.1 ID 设计

| ID | 语义 | 生成方式 | 生命周期 |
|----|------|---------|---------|
| `workflowId` | 工作流模板 | 创建时分配 | 永久 |
| `runId` | 单次执行 | 每次 execute 生成 UUID | 一次完整执行 |
| `traceId` | 单次操作 | 每次 emit() 自动生成 ULID | 单次事件 |
| `parentTraceId` | 父操作 | 继承自调用方 | 树形链路还原 |

### 7.2 事件链路

```
run_abc123 (runId)
  ├─ NODE_STARTED   traceId=A, parentTraceId=null
  │    ├─ TOOL_CALL   traceId=B, parentTraceId=A
  │    ├─ TOOL_RESULT traceId=C, parentTraceId=A
  │    └─ TOOL_CALL   traceId=D, parentTraceId=A
  ├─ NODE_COMPLETED traceId=E, parentTraceId=null
  ├─ ROUTING        traceId=F, parentTraceId=null
  └─ NODE_STARTED   traceId=G, parentTraceId=null
```

`runId` 是顶层分组键，`parentTraceId` 还原树形链路，`traceId` 是扁平唯一身份证。

### 7.3 TraceCollector

Redis Stream 异步消费者，解析所有事件 → 按 `parentTraceId` 重组为树形链路 → 写入溯源存储。支持全链路查询和审计。

---

## 八、工具并行调度

Capability 内部，LLM 决策出无数据依赖的工具调用组，使用 `Promise.all` 并发执行。暂不实现跨节点 Agent 并发。

```
并行执行示意:
  Node: analysis
    ├─ LLM 决策
    ├─ Tool: search_web    ──┐
    ├─ Tool: pricing_fetch ──┤ Promise.all
    ├─ Tool: review_fetch  ──┘
    └─ LLM 合成 → patch
```

前端渲染为并排的子执行框。

---

## 九、Engine 层精简

### graph.ts 保留

- `StateGraph<T>`：`addNode` / `addEdge` / `setEntryPoint` / `compile`
- `CompiledGraph<T>`：`invoke`
- `Checkpointer` / `Checkpoint`
- `END` 常量

### graph.ts 移除

- `addConditionalEdges`——Orchestrator 替代
- `GraphInterrupt` / `interrupt()`——不再中断
- `Command`——不再 resume
- `AsyncLocalStorage`——不再需要中断上下文

---

## 十、落地优先级

| 优先级 | 模块 | 理由 |
|--------|------|------|
| **P0** | `engine/` 精简 + `state.ts` 精简 | 所有上层依赖 |
| **P0** | `capability/`（types, context, registry, executor） | Capability 接口是核心契约 |
| **P0** | `bus/`——EventBus + Redis | 事件管线是所有模块通信基础 |
| **P1** | `orchestrator/` | 依赖 capability + bus，核心编排逻辑 |
| **P1** | `skills/`——loader + adapter | 依赖 capability types，工具可插拔 |
| **P1** | `tracing/` | 依赖 bus，溯源是增强能力 |
| **P2** | 热插拔、MCP 生命周期管理 | 锦上添花 |
| **P3** | 前端适配新 UiHint + SSE 协议 | 与后端可并行 |

---

## 十一、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 图引擎 | 自研 StateGraph（精简版） | 现有自研引擎足够，无需引入 langgraph |
| 事件总线 | Redis Stream + Pub/Sub | 同步写入低延迟，消费者组支持水平扩展 |
| 溯源 ID | ULID | 字典序排列、URL 安全、毫秒级精度 |
| 工具加载 | 动态 `import()` | 天然支持热插拔和目录约定 |
| MCP 协议 | JSON-RPC 适配器 | 标准 Tool 接口统一本地和远程工具 |
| 运行时语言 | TypeScript（最终版） | Python 版已删除 |
| SSE 推送 | Redis Pub/Sub → 服务端 relay | Capability 与 SSE 完全解耦 |

---

## 十二、错误处理与降级策略

### 12.1 设计原则

每一层都有明确的 fallback 路径，任何单点故障不阻塞工作流主流程。错误事件全部通过 EventBus 发送到前端，保持透明度。

### 12.2 Orchestrator 降级链

Orchestrator 的四个核心操作按顺序执行，每个步骤失败后降级到更简单的下一级：

```
完整路径:   Discovery → Planning → 候选生成 → LLM 排序 → 推送前端
                      │           │           │
                      ▼           ▼           ▼
降级:        跳过 Planning    全节点候选    规则顺序（无 LLM 理由）
```

| 故障点 | 降级行为 | 用户感知 |
|--------|---------|---------|
| Discovery 失败 | 空能力画像，Planning 退化 | 不影响路由，仅缺能力描述 |
| Planning 失败 | 跳过 TaskPlan，候选集无阶段权重 | 路由变成平等候选（flat），仍可手工选 |
| 候选生成失败 | 返回所有注册节点作为候选 | 候选列表可能包含不合理的节点，人工可识别 |
| LLM 排序失败 | 规则排序：pending 优先于 rerun | 候选仍有排序，但缺 LLM 推理的理由文字 |
| 整体 Orchestrator 崩溃 | 返回上一次的候选集 + "系统正在恢复"提示 | 用户可等待重试或手动选择 |

### 12.3 Capability 执行失败

```
Capability.execute() 异常
  ├─ 工具调用失败 → 单工具重试（retry.ts）→ 仍失败 → 工具级错误事件
  ├─ LLM 调用失败 → 重试 → 仍失败 → NodeFatalError
  ├─ 超时 → AbortError → 跳过当前节点
  └─ 全部重试耗尽 → NodeFatalError → 记录到 state.errors
```

节点执行失败后的处理：

1. `ctx.emit({ uiHint: "tool_error", ... })` 或 `ctx.emit({ uiHint: "node_completed", payload: { error } })`
2. 错误信息写入 `state.errors[]`
3. 编排循环继续，进入下一轮 Orchestrator 路由
4. 前端展示失败节点 + 错误详情，用户可选择重试或跳过

### 12.4 EventBus 故障

| 故障 | 降级 |
|------|------|
| Redis 连接断开 | 事件暂存内存队列，定期重连，连上后批量回放 |
| XADD 失败 | 记录到本地日志 + 尝试写入 fallback 文件，不阻塞 Capability |
| SSE 推送失败 | 前端重连时自动获取最近 N 条事件的快照 |
| Persister 写 DB 失败 | XACK 不确认，消费者组自动重试（Redis Stream 天然支持） |

```typescript
class RedisEventBus implements EventBus {
  private pendingQueue: WorkflowEvent[] = [];
  private connected = false;

  async publish(event: WorkflowEvent): Promise<void> {
    if (!this.connected) {
      this.pendingQueue.push(event);  // 内存暂存
      return;
    }
    try {
      await this.redis.xadd(streamKey, '*', 'event', JSON.stringify(event));
      await this.redis.publish(channel, JSON.stringify(event));
    } catch {
      this.pendingQueue.push(event);
      logger.warn('Redis publish failed, queued in memory');
    }
  }
}
```

### 12.5 编译失败

```
GraphRuntime.executeStep(nodeId)
  → registry.get(nodeId)
      ├─ 未找到 → emit ERROR + 跳过 → 下一轮路由
      └─ Capability 不符合接口 → emit ERROR + 跳过
```

### 12.6 AbortSignal 取消

用户通过前端取消正在执行的节点（如超时或误操作）：

```typescript
// RuntimeContext 注入 AbortSignal
interface RuntimeContext {
  signal: AbortSignal;
}

// Capability 内检查
async execute(state, ctx) {
  for (const call of toolCalls) {
    if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    // ...
  }
}
```

AbortError 不被 retry.ts 捕获，直接传播到 CapabilityExecutor → 跳过当前节点 → 进入下一轮 Orchestrator 路由。

### 12.7 降级事件通知

所有降级行为都通过 EventBus 发送标准化降级事件，前端据此展示系统状态：

```typescript
{
  uiHint: "degradation_notice",
  payload: {
    level: "warn",                    // warn | error
    source: "orchestrator.planning",  // 降级来源模块
    message: "规划器暂时不可用，已降级为平等候选模式",
    fallback: "flat_candidates",      // 当前降级策略
  }
}
```

前端不阻塞用户操作，仅显示 banner/toast 提示系统部分降级。

---

## 十三、RuntimeState 最终形态

```typescript
interface RuntimeState {
  data: Record<string, any>;
  control: {
    currentNode: string;
    executionPath: ExecutionStep[];   // 完整执行路径，含每次同节点重试
  };
  runtime: {
    workflowId: string;
    runId: string;
    threadId: string;
  };
  errors: ErrorRecord[];
}

interface ExecutionStep {
  nodeId: string;
  iteration: number;      // 该节点第几次被执行
  startedAt: string;
  completedAt?: string;
}
```

去掉了 `routeLabel`、`humanDecision`、`lastPause`、`lastDecision`、`terminalStatus`、`revisionCount`、`maxRevisions`。终止信号由 Orchestrator 发送 WORKFLOW_COMPLETE / WORKFLOW_FAILED 事件代替。
