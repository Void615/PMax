# 分布式工作流运行时重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `runtime_ts` 从静态 DAG 运行时重构为基于 Orchestrator 编排的分布式工作流运行时。

**Architecture:** 分层架构：engine（图引擎）→ capability（原子能力）→ orchestrator（编排器），bus（事件管线）横向贯穿。核心变化：gate 节点删除，单节点动态编译，Redis Stream 事件管线，Capability 自主执行。

**Tech Stack:** TypeScript, Redis (ioredis), ULID (ulidx), graph.ts 自研引擎

---

## Phase 1: P0 基石 —— engine / state / capability / bus

### Task 1: 删除废弃文件 + 创建新目录

**Files:**
- Delete: `backend/runtime_ts/policies.ts`
- Delete: `backend/runtime_ts/context.ts`
- Delete: `backend/runtime_ts/template.ts`
- Create directories: `backend/runtime_ts/engine/`, `backend/runtime_ts/capability/`, `backend/runtime_ts/bus/`, `backend/runtime_ts/orchestrator/`, `backend/runtime_ts/tracing/`, `backend/runtime_ts/skills/`

- [ ] **Step 1: 删除废弃文件**

```bash
Remove-Item -Path "backend/runtime_ts/policies.ts", "backend/runtime_ts/context.ts", "backend/runtime_ts/template.ts" -Force
```

- [ ] **Step 2: 创建新目录**

```bash
mkdir -p backend/runtime_ts/engine
mkdir -p backend/runtime_ts/capability
mkdir -p backend/runtime_ts/bus
mkdir -p backend/runtime_ts/orchestrator
mkdir -p backend/runtime_ts/tracing
mkdir -p backend/runtime_ts/skills
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: delete deprecated files and create new module directories"
```

---

### Task 2: 精简 state.ts

**Files:**
- Modify: `backend/runtime_ts/state.ts`

**Produces:** `RuntimeState` 类型（v2 精简版）

- [ ] **Step 1: 更新 RuntimeState 接口**

`backend/runtime_ts/state.ts`:

```typescript
/**
 * 图运行时状态类型（v2 精简版）。
 *
 * data 由 Capability 读写。
 * control 由 Orchestrator + CapabilityExecutor 维护。
 * runtime 每次执行初始化一次。
 * errors 由 CapabilityExecutor 追加。
 */

export interface RuntimeState {
  data: Record<string, any>;
  control: {
    currentNode: string;
    executionPath: ExecutionStep[];
  };
  runtime: {
    workflowId: string;
    runId: string;
    threadId: string;
  };
  errors: ErrorRecord[];
}

export interface ExecutionStep {
  nodeId: string;
  iteration: number;
  startedAt: string;
  completedAt?: string;
}

export interface ErrorRecord {
  nodeId: string;
  traceId: string;
  errorCode: string;
  errorMessage: string;
  timestamp: string;
  details?: Record<string, any>;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/state.ts
git commit -m "refactor: slim down RuntimeState to v2 spec"
```

---

### Task 3: 精简 graph.ts → engine/graph.ts

**Files:**
- Move & Modify: `backend/runtime_ts/graph.ts` → `backend/runtime_ts/engine/graph.ts`

**Consumes:** nothing external

**Produces:** `StateGraph<T>`, `CompiledGraph<T>`, `Checkpointer`, `Checkpoint`, `GraphConfig`, `END`

- [ ] **Step 1: 移动文件**

```bash
Move-Item -Path "backend/runtime_ts/graph.ts" -Destination "backend/runtime_ts/engine/graph.ts"
```

- [ ] **Step 2: 删除不需要的内容**

修改 `backend/runtime_ts/engine/graph.ts`：移除 `addConditionalEdges` 方法、`GraphInterrupt` 类、`interrupt()` 函数、`Command` 类、`AsyncLocalStorage` 相关代码、`Router` 类型、`NodeHandler` 类型中的 `InterruptContext` 引用、`gateRouter`/`gateMapping` 方法（已在 graph_runtime.ts 中，这里 graph.ts 本身没有）。

实际 graph.ts 中需要删除的：
- `addConditionalEdges` 方法
- `GraphInterrupt` 类
- `interrupt()` 函数
- `Command` 类
- `AsyncLocalStorage` 相关代码（`AsyncStore` 接口、`FallbackAsyncLocalStorage` 类、`asyncLocalStorage` 变量、`InterruptContext` 接口）
- `Router` 类型

保留：
- `StateGraph<T>` 类（含 `addNode`、`addEdge`、`setEntryPoint`、`compile`）
- `CompiledGraph<T>` 类（只保留 `invoke` 的 `!isResume && !isRecover` 分支，无 checkpoint 裸执行）
- `Checkpointer` 接口
- `Checkpoint` 接口
- `GraphConfig` 接口
- `END` 常量

删除后 `CompiledGraph.invoke` 应简化为：

```typescript
async invoke(input: T, config: GraphConfig): Promise<T> {
  let state = input;
  let currentNode = this.entryPoint;

  while (currentNode !== END) {
    const handler = this.nodes.get(currentNode);
    if (!handler) throw new Error(`Unknown node: ${currentNode}`);
    state = await handler(state);
    currentNode = this.edges.get(currentNode) ?? END;
  }

  return state;
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

预期：当前有 import 引用旧路径导致错误，后续任务逐一修复。

- [ ] **Step 4: 提交**

```bash
git add backend/runtime_ts/engine/graph.ts backend/runtime_ts/graph.ts
git commit -m "refactor: move graph.ts to engine/ and strip conditional edges + interrupt"
```

---

### Task 4: 创建 engine/checkpointer.ts

**Files:**
- Create: `backend/runtime_ts/engine/checkpointer.ts`

**Produces:** `Checkpointer`, `Checkpoint`（从 graph.ts 独立）

- [ ] **Step 1: 独立的 checkpointer 模块**

`backend/runtime_ts/engine/checkpointer.ts`:

```typescript
/**
 * 检查点持久化接口。
 * 由调用方提供具体实现（Postgres / Redis / 内存等）。
 */

export interface Checkpoint {
  state: any;
  nextNode: string;
}

export interface Checkpointer {
  save(threadId: string, checkpoint: Checkpoint): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;
}
```

- [ ] **Step 2: graph.ts 改为从 checkpointer.ts import**

在 `backend/runtime_ts/engine/graph.ts` 中：

```typescript
import type { Checkpointer, Checkpoint } from "./checkpointer.js";
```

删除 graph.ts 中原有的 `Checkpoint` 和 `Checkpointer` 接口定义。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 4: 提交**

```bash
git add backend/runtime_ts/engine/
git commit -m "refactor: extract Checkpointer to engine/checkpointer.ts"
```

---

### Task 5: 创建 engine/index.ts

**Files:**
- Create: `backend/runtime_ts/engine/index.ts`

- [ ] **Step 1: 导出 engine 层公共 API**

`backend/runtime_ts/engine/index.ts`:

```typescript
export { StateGraph, CompiledGraph, END } from "./graph.js";
export type { Checkpointer, Checkpoint } from "./checkpointer.js";
export type { GraphConfig } from "./graph.js";
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/engine/index.ts
git commit -m "feat: add engine/index.ts barrel export"
```

---

### Task 6: 创建 capability/types.ts

**Files:**
- Create: `backend/runtime_ts/capability/types.ts`

**Produces:** `Capability`, `Tool`, `ToolContext`, `CapabilityResult`, `ArtifactDraft`, `NodeMetrics`

- [ ] **Step 1: 定义核心接口**

`backend/runtime_ts/capability/types.ts`:

```typescript
import type { RuntimeState } from "../state.js";
import type { RuntimeContext } from "./context.js";

/**
 * Capability = 业务逻辑 + 事件 + 容错 + 追踪的原子体。
 * 每个 Capability 是完整、自描述、可独立部署的原子单元。
 */
export interface Capability {
  readonly id: string;
  readonly description: string;
  readonly inputHints?: string[];
  readonly outputHints?: string[];
  readonly tools: Tool[];
  readonly requires?: string[];
  execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult>;
}

export interface CapabilityResult {
  patch: Record<string, any>;
  artifacts: ArtifactDraft[];
}

/**
 * Tool = 独立目录组织的原子工具能力（skill 或 MCP）。
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;

  readonly eventPayloads?: {
    onStart?(params: Record<string, any>): Record<string, any>;
    onComplete?(result: any, durationMs: number): Record<string, any>;
    onError?(error: Error): Record<string, any>;
  };

  execute(params: Record<string, any>, ctx: ToolContext): Promise<any>;
}

export interface ToolContext {
  traceId: string;
  runId: string;
}

/**
 * 制品草稿 —— Capability 产出的持久化数据。
 */
export interface ArtifactDraft {
  artifactType: string;
  title: string;
  content: Record<string, any>;
  createdByNode: string;
  contentText?: string;
}

/**
 * 单次执行的指标快照（可选）。
 */
export interface NodeMetrics {
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  modelName: string;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/capability/types.ts
git commit -m "feat: add Capability and Tool interface types"
```

---

### Task 7: 创建 capability/context.ts

**Files:**
- Create: `backend/runtime_ts/capability/context.ts`

**Consumes:** `bus/types.ts` (WorkflowEvent, UiHint, EventBus)

**Produces:** `RuntimeContext`, `EmitOptions`

> 注：`bus/types.ts` 在 Task 10 创建，`RuntimeContext` 类型定义在本任务中与 EventBus 是单向类型依赖，可先声明局部接口占位，后续 Task 10 完成后导入替换。

- [ ] **Step 1: 定义 RuntimeContext**

`backend/runtime_ts/capability/context.ts`:

```typescript
import type { EventBus, WorkflowEvent, UiHint } from "../bus/types.js";
import type { ArtifactDraft } from "./types.js";

export interface EmitOptions {
  persist?: boolean;
}

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<any>;
  synthesize(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export interface RuntimeContext {
  traceId: string;
  parentTraceId?: string;
  workflowId: string;
  runId: string;
  nodeId: string;
  iteration: number;
  signal: AbortSignal;

  /** 发射事件到 EventBus */
  emit(event: Partial<WorkflowEvent> & { uiHint: UiHint }, opts?: EmitOptions): Promise<void>;

  /** LLM 客户端 */
  llm: LlmClient;

  /** 显式持久化制品 */
  saveArtifact(draft: ArtifactDraft): Promise<string>;
}
```

- [ ] **Step 2: 验证编译**

当前会因 `bus/types.ts` 不存在而报错——预期行为，Task 10 创建后解决。

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

Expected: FAIL with "Cannot find module '../bus/types.js'"

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/capability/context.ts
git commit -m "feat: add RuntimeContext type with EmitOptions"
```

---

### Task 8: 创建 capability/registry.ts

**Files:**
- Create: `backend/runtime_ts/capability/registry.ts`

**Consumes:** `capability/types.ts` (Capability)

**Produces:** `CapabilityRegistry`

- [ ] **Step 1: 实现注册表**

`backend/runtime_ts/capability/registry.ts`:

```typescript
import type { Capability } from "./types.js";

export class CapabilityRegistry {
  private caps = new Map<string, Capability>();

  register(cap: Capability): void {
    if (this.caps.has(cap.id)) {
      throw new Error(`Duplicate capability: ${cap.id}`);
    }
    this.caps.set(cap.id, cap);
  }

  get(id: string): Capability | undefined {
    return this.caps.get(id);
  }

  listIds(): string[] {
    return [...this.caps.keys()];
  }

  listAll(): Capability[] {
    return [...this.caps.values()];
  }

  remove(id: string): boolean {
    return this.caps.delete(id);
  }

  clear(): void {
    this.caps.clear();
  }
}
```

- [ ] **Step 2: 测试注册表**

手动验证（不写 .ts 测试文件，用 tsc 检查类型安全）：

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/capability/registry.ts
git commit -m "feat: add CapabilityRegistry"
```

---

### Task 9: 创建 capability/executor.ts

**Files:**
- Create: `backend/runtime_ts/capability/executor.ts`

**Consumes:** `capability/types.ts`, `capability/context.ts`, `state.ts`

**Produces:** `CapabilityExecutor`

- [ ] **Step 1: 实现极薄调用容器**

`backend/runtime_ts/capability/executor.ts`:

```typescript
import type { Capability } from "./types.js";
import type { RuntimeContext } from "./context.js";
import type { RuntimeState, ErrorRecord } from "../state.js";

export class CapabilityExecutor {
  constructor(private readonly registry: { get(id: string): Capability | undefined }) {}

  async execute(
    nodeId: string,
    state: RuntimeState,
    ctx: RuntimeContext
  ): Promise<RuntimeState> {
    const cap = this.registry.get(nodeId);
    if (!cap) {
      const error: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: "CAPABILITY_NOT_FOUND",
        errorMessage: `Capability not found: ${nodeId}`,
        timestamp: new Date().toISOString(),
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, error],
      };
    }

    try {
      const step: ExecutionStep = {
        nodeId,
        iteration: (state.control.executionPath?.filter(s => s.nodeId === nodeId).length ?? 0),
        startedAt: new Date().toISOString(),
      };

      const result = await cap.execute(state, ctx);

      step.completedAt = new Date().toISOString();
      const newControl = {
        currentNode: nodeId,
        executionPath: [...(state.control.executionPath ?? []), step],
      };

      return {
        data: { ...state.data, ...result.patch },
        control: newControl,
        runtime: state.runtime,
        errors: state.errors,
      };
    } catch (e) {
      const errorRecord: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: e instanceof Error ? e.constructor.name : "NODE_ERROR",
        errorMessage: String(e).slice(0, 1000),
        timestamp: new Date().toISOString(),
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, errorRecord],
      };
    }
  }
}

import type { ExecutionStep } from "../state.js";
```

等等，上面的代码有 import 顺序问题。修正版本：

```typescript
import type { Capability } from "./types.js";
import type { RuntimeContext } from "./context.js";
import type { RuntimeState, ErrorRecord, ExecutionStep } from "../state.js";

export class CapabilityExecutor {
  constructor(private readonly registry: { get(id: string): Capability | undefined }) {}

  async execute(
    nodeId: string,
    state: RuntimeState,
    ctx: RuntimeContext
  ): Promise<RuntimeState> {
    const cap = this.registry.get(nodeId);
    if (!cap) {
      const error: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: "CAPABILITY_NOT_FOUND",
        errorMessage: `Capability not found: ${nodeId}`,
        timestamp: new Date().toISOString(),
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, error],
      };
    }

    try {
      const step: ExecutionStep = {
        nodeId,
        iteration: (state.control.executionPath?.filter(s => s.nodeId === nodeId).length ?? 0),
        startedAt: new Date().toISOString(),
      };

      const result = await cap.execute(state, ctx);

      step.completedAt = new Date().toISOString();
      const newControl = {
        currentNode: nodeId,
        executionPath: [...(state.control.executionPath ?? []), step],
      };

      return {
        data: { ...state.data, ...result.patch },
        control: newControl,
        runtime: state.runtime,
        errors: state.errors,
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return state; // 被取消，状态不变
      }
      const errorRecord: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: e instanceof Error ? e.constructor.name : "NODE_ERROR",
        errorMessage: String(e).slice(0, 1000),
        timestamp: new Date().toISOString(),
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, errorRecord],
      };
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/capability/executor.ts
git commit -m "feat: add CapabilityExecutor"
```

---

### Task 10: 创建 bus/types.ts

**Files:**
- Create: `backend/runtime_ts/bus/types.ts`

**Produces:** `WorkflowEvent`, `UiHint`, `EventBus`

- [ ] **Step 1: 定义事件中线类型**

`backend/runtime_ts/bus/types.ts`:

```typescript
export type UiHint =
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "llm_stream"
  | "node_progress"
  | "routing_decision"
  | "workflow_paused"
  | "node_completed"
  | "workflow_complete"
  | "workflow_failed"
  | "degradation_notice";

export interface WorkflowEvent {
  traceId: string;
  parentTraceId?: string;
  eventType: string;
  uiHint: UiHint;
  nodeId: string;
  workflowId: string;
  runId: string;
  payload: Record<string, any>;
  timestamp: string;
}

export interface EventBus {
  publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void>;
  subscribe(workflowId: string, handler: (event: WorkflowEvent) => void): Promise<void>;
  unsubscribe(workflowId: string): Promise<void>;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/bus/types.ts
git commit -m "feat: add WorkflowEvent, UiHint, and EventBus types"
```

---

### Task 11: 创建 bus/redis_bus.ts

**Files:**
- Create: `backend/runtime_ts/bus/redis_bus.ts`

**Consumes:** `bus/types.ts` (EventBus, WorkflowEvent)

**Produces:** `RedisEventBus` implements EventBus

- [ ] **Step 1: 实现 RedisEventBus**

`backend/runtime_ts/bus/redis_bus.ts`:

```typescript
import type { EventBus, WorkflowEvent } from "./types.js";

interface RedisClient {
  xadd(key: string, id: string, ...args: string[]): Promise<string>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  on(event: string, handler: (channel: string, message: string) => void): void;
  unsubscribe(channel: string): Promise<void>;
  quit(): Promise<void>;
}

export class RedisEventBus implements EventBus {
  private pendingQueue: WorkflowEvent[] = [];
  private connected = false;
  private handlers = new Map<string, Set<(event: WorkflowEvent) => void>>();

  constructor(private readonly redis: RedisClient) {}

  async connect(): Promise<void> {
    this.connected = true;
    // 回放积压事件
    while (this.pendingQueue.length > 0) {
      const event = this.pendingQueue.shift()!;
      await this.publish(event);
    }
  }

  async publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void> {
    if (!this.connected) {
      this.pendingQueue.push(event);
      return;
    }

    const data = JSON.stringify(event);
    try {
      if (opts?.persist !== false) {
        const streamKey = `events:${event.workflowId}:${event.runId}`;
        await this.redis.xadd(streamKey, "*", "event", data);
      }
      const channel = `sse:${event.workflowId}:${event.runId}`;
      await this.redis.publish(channel, data);
    } catch (err) {
      this.pendingQueue.push(event);
      console.warn("Redis publish failed, queued in memory", err);
    }
  }

  async subscribe(
    workflowId: string,
    handler: (event: WorkflowEvent) => void
  ): Promise<void> {
    const channel = `sse:${workflowId}`;
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.redis.subscribe(channel);
      this.redis.on("message", (ch, msg) => {
        const handlers = this.handlers.get(ch);
        if (handlers) {
          try {
            const event = JSON.parse(msg) as WorkflowEvent;
            for (const h of handlers) h(event);
          } catch { /* skip malformed messages */ }
        }
      });
    }
    this.handlers.get(channel)!.add(handler);
  }

  async unsubscribe(workflowId: string): Promise<void> {
    const channel = `sse:${workflowId}`;
    this.handlers.delete(channel);
    await this.redis.unsubscribe(channel);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/bus/redis_bus.ts
git commit -m "feat: add RedisEventBus with Stream + Pub/Sub"
```

---

### Task 12: 创建 bus/persister.ts

**Files:**
- Create: `backend/runtime_ts/bus/persister.ts`

- [ ] **Step 1: 实现 EventPersister**

`backend/runtime_ts/bus/persister.ts`:

```typescript
import type { WorkflowEvent } from "./types.js";

interface RedisClient {
  xreadgroup(
    group: string,
    consumer: string,
    keys: string[],
    ids: string[],
    options?: { COUNT?: number; BLOCK?: number }
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
}

interface DbPersister {
  insertEvents(events: WorkflowEvent[]): Promise<void>;
}

export class EventPersister {
  private running = false;
  private consumerName: string;

  constructor(
    private readonly redis: RedisClient,
    private readonly db: DbPersister,
    private readonly groupName: string = "event-persisters",
    private readonly batchSize: number = 10,
    private readonly blockMs: number = 5000
  ) {
    this.consumerName = `consumer-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const streams = await this.redis.xreadgroup(
          this.groupName,
          this.consumerName,
          ["events:>"],
          [">"],
          { COUNT: this.batchSize, BLOCK: this.blockMs }
        );

        if (!streams) continue;

        for (const [, messages] of streams) {
          const events: WorkflowEvent[] = [];
          const ids: string[] = [];

          for (const [id, fields] of messages) {
            const eventStr = fields[fields.indexOf("event") + 1];
            if (eventStr) {
              try {
                events.push(JSON.parse(eventStr));
                ids.push(id);
              } catch { /* skip */ }
            }
          }

          if (events.length > 0) {
            await this.db.insertEvents(events);
            // ACK after successful insert
            for (const streamKey of streams.map(s => s[0])) {
              for (const id of ids) {
                await this.redis.xack(streamKey, this.groupName, id);
              }
            }
          }
        }
      } catch (err) {
        console.error("EventPersister loop error", err);
        await this.sleep(1000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/bus/persister.ts
git commit -m "feat: add EventPersister (Redis Stream consumer → DB)"
```

---

### Task 13: 创建 bus/sse_relay.ts

**Files:**
- Create: `backend/runtime_ts/bus/sse_relay.ts`

- [ ] **Step 1: 实现 SSERelay**

`backend/runtime_ts/bus/sse_relay.ts`:

```typescript
import type { EventBus, WorkflowEvent } from "./types.js";

export interface SseConnection {
  write(data: string): void;
  end(): void;
  on(event: "close", handler: () => void): void;
}

export class SSERelay {
  private connections = new Map<string, Set<SseConnection>>();

  constructor(private readonly eventBus: EventBus) {}

  async registerConnection(workflowId: string, conn: SseConnection): Promise<void> {
    if (!this.connections.has(workflowId)) {
      this.connections.set(workflowId, new Set());
      await this.eventBus.subscribe(workflowId, (event: WorkflowEvent) => {
        this.broadcast(workflowId, event);
      });
    }

    this.connections.get(workflowId)!.add(conn);

    // SSE 格式: data: {...}\n\n
    conn.write(`data: ${JSON.stringify({ uiHint: "connected", workflowId })}\n\n`);

    conn.on("close", () => {
      const set = this.connections.get(workflowId);
      if (set) {
        set.delete(conn);
        if (set.size === 0) {
          this.connections.delete(workflowId);
          this.eventBus.unsubscribe(workflowId).catch(() => {});
        }
      }
    });
  }

  private broadcast(workflowId: string, event: WorkflowEvent): void {
    const set = this.connections.get(workflowId);
    if (!set) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of set) {
      try {
        conn.write(data);
      } catch {
        set.delete(conn);
      }
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/bus/sse_relay.ts
git commit -m "feat: add SSERelay for frontend event streaming"
```

---

### Task 14: 清理并更新 index.ts

**Files:**
- Modify: `backend/runtime_ts/index.ts`

- [ ] **Step 1: 更新公共 API 入口**

`backend/runtime_ts/index.ts`:

```typescript
/**
 * 多 Agent 编排运行时 —— 可复用的分布式工作流执行引擎。
 *
 * 公共 API:
 *
 *   engine/:   StateGraph, CompiledGraph, Checkpointer, END
 *   capability/: Capability, Tool, RuntimeContext, CapabilityRegistry, CapabilityExecutor
 *   bus/:      WorkflowEvent, UiHint, EventBus, RedisEventBus, SSERelay
 *   orchestrator/: Orchestrator
 *   tracing/:  TraceId
 *   retry.ts:  NodeFatalError, executeWithRetry
 */

// ── engine ──
export { StateGraph, CompiledGraph, END } from "./engine/graph.js";
export type { Checkpointer, Checkpoint } from "./engine/checkpointer.js";
export type { GraphConfig } from "./engine/graph.js";

// ── capability ──
export { CapabilityRegistry } from "./capability/registry.js";
export { CapabilityExecutor } from "./capability/executor.js";
export type {
  Capability,
  Tool,
  ToolContext,
  CapabilityResult,
  ArtifactDraft,
  NodeMetrics,
} from "./capability/types.js";
export type { RuntimeContext, EmitOptions, LlmClient } from "./capability/context.js";

// ── bus ──
export type { WorkflowEvent, UiHint, EventBus } from "./bus/types.js";
export { RedisEventBus } from "./bus/redis_bus.js";
export { EventPersister } from "./bus/persister.js";
export { SSERelay } from "./bus/sse_relay.js";

// ── retry ──
export { NodeFatalError, executeWithRetry } from "./retry.js";
export type { RetryPolicyConfig, RetryEventLogger } from "./retry.js";

// ── state ──
export type { RuntimeState, ExecutionStep, ErrorRecord } from "./state.js";
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

预期：部分 import 路径链现在可解析（bus/types → capability/context），但 graph_runtime.ts 和 node_runner.ts 尚在旧位置引用 agentContext 等废弃类型导致警告。这些将在后续任务重写时修复。

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/index.ts
git commit -m "refactor: update index.ts barrel exports for v2 modules"
```

---

## Phase 2: P1 核心 —— Orchestrator + Skills + Tracing

### Task 15: 创建 orchestrator/types.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/types.ts`

**Produces:** `RouteCandidate`, `RouteSuggestion`, `TaskPlan`, `TaskPhase`, `CapabilityProfile`

- [ ] **Step 1: 定义编排类型**

`backend/runtime_ts/orchestrator/types.ts`:

```typescript
export interface CapabilityProfile {
  id: string;
  description: string;
  tools: string[];
  toolDescriptions: { name: string; desc: string }[];
  inputHints: string[];
  outputHints: string[];
  requires: string[];
}

export interface RouteCandidate {
  nodeId: string;
  status: "pending" | "rerun";
  executable: boolean;
  planWeight: number;
}

export interface RouteSuggestion {
  nodeId: string;
  priority: number;
  reason: string;
}

export interface TaskPhase {
  name: string;
  targetNodes: string[];
  rationale: string;
}

export interface TaskPlan {
  phases: TaskPhase[];
  dependencies: Record<string, string[]>;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/types.ts
git commit -m "feat: add Orchestrator types (RouteCandidate, TaskPlan)"
```

---

### Task 16: 创建 orchestrator/discover.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/discover.ts`

**Consumes:** CapabilityRegistry (from capability/registry.ts), types from orchestrator/types.ts

**Produces:** `CapabilityDiscoverer`

- [ ] **Step 1: 实现子节点探测**

`backend/runtime_ts/orchestrator/discover.ts`:

```typescript
import type { CapabilityRegistry } from "../capability/registry.js";
import type { CapabilityProfile } from "./types.js";

export class CapabilityDiscoverer {
  constructor(private readonly registry: CapabilityRegistry) {}

  discover(): CapabilityProfile[] {
    const profiles: CapabilityProfile[] = [];
    for (const cap of this.registry.listAll()) {
      profiles.push({
        id: cap.id,
        description: cap.description,
        tools: cap.tools.map(t => t.name),
        toolDescriptions: cap.tools.map(t => ({ name: t.name, desc: t.description })),
        inputHints: cap.inputHints ?? [],
        outputHints: cap.outputHints ?? [],
        requires: cap.requires ?? [],
      });
    }
    return profiles;
  }

  /** 降级：返回空画像列表 */
  discoverSafe(): CapabilityProfile[] {
    try {
      return this.discover();
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/discover.ts
git commit -m "feat: add CapabilityDiscoverer"
```

---

### Task 17: 创建 orchestrator/planner.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/planner.ts`

**Consumes:** orchestrator/types.ts, capability/context.ts (LlmClient)

**Produces:** `TaskPlanner`

- [ ] **Step 1: 实现需求拆分器**

`backend/runtime_ts/orchestrator/planner.ts`:

```typescript
import type { LlmClient } from "../capability/context.js";
import type { CapabilityProfile, TaskPlan } from "./types.js";

const PLANNING_PROMPT = `你是一个工作流编排器。你需要将以下总需求分解为一系列子任务，每个子任务对应一个目标子节点。

总需求: {requirement}

可用的子节点及其能力：
{profiles}

请输出一个执行计划，包含：
1. 大致阶段划分（如：采集 → 分析 → 汇总 → 审查）
2. 每个阶段推荐执行的节点及理由
3. 节点间的数据依赖关系

格式: JSON
{
  "phases": [{ "name": "阶段名", "targetNodes": ["nodeId"], "rationale": "理由" }],
  "dependencies": { "nodeId": ["依赖的nodeId"] }
}`;

export class TaskPlanner {
  constructor(private readonly llm: LlmClient) {}

  async plan(requirement: string, profiles: CapabilityProfile[]): Promise<TaskPlan | null> {
    const profilesText = profiles.map(p =>
      `- **${p.id}**: ${p.description}\n` +
      `  输入依赖: ${p.inputHints.join(", ") || "无"}\n` +
      `  产出物: ${p.outputHints.join(", ") || "无"}\n` +
      `  工具: ${p.toolDescriptions.map(t => `${t.name}(${t.desc})`).join(", ")}`
    ).join("\n\n");

    const prompt = PLANNING_PROMPT
      .replace("{requirement}", requirement)
      .replace("{profiles}", profilesText);

    try {
      const result = await this.llm.complete(prompt);
      return JSON.parse(result) as TaskPlan;
    } catch {
      return null;  // 降级：返回 null，Orchestrator 使用 flat 候选
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/planner.ts
git commit -m "feat: add TaskPlanner with LLM requirement decomposition"
```

---

### Task 18: 创建 orchestrator/candidate_engine.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/candidate_engine.ts`

**Consumes:** orchestrator/types.ts, capability/registry.ts, state.ts

**Produces:** `CandidateEngine`

- [ ] **Step 1: 实现候选人引擎**

`backend/runtime_ts/orchestrator/candidate_engine.ts`:

```typescript
import type { CapabilityRegistry } from "../capability/registry.js";
import type { RuntimeState } from "../state.js";
import type { RouteCandidate, TaskPlan } from "./types.js";

export class CandidateEngine {
  generate(
    state: RuntimeState,
    completedNodeId: string,
    registry: CapabilityRegistry,
    plan: TaskPlan | null
  ): RouteCandidate[] {
    const executedNodes = state.control.executionPath?.map(s => s.nodeId) ?? [];
    const allNodes = registry.listIds();
    const currentPhase = plan ? this.determineCurrentPhase(plan, executedNodes) : null;

    let candidates = allNodes
      .filter(id => id !== completedNodeId)
      .map(id => ({
        nodeId: id,
        status: (executedNodes.includes(id) ? "rerun" : "pending") as "pending" | "rerun",
        executable: true,
        planWeight: currentPhase?.targetNodes.includes(id) ? 1.0 : 0.5,
      }));

    candidates = this.filterByCapability(candidates, registry);
    return candidates;
  }

  /** 降级：返回全量候选 */
  generateSafe(
    state: RuntimeState,
    completedNodeId: string,
    registry: CapabilityRegistry,
    plan: TaskPlan | null
  ): RouteCandidate[] {
    try {
      return this.generate(state, completedNodeId, registry, plan);
    } catch {
      return registry.listIds()
        .filter(id => id !== completedNodeId)
        .map(id => ({
          nodeId: id,
          status: "pending" as const,
          executable: true,
          planWeight: 0.5,
        }));
    }
  }

  private determineCurrentPhase(
    plan: TaskPlan,
    executedNodes: string[]
  ): TaskPlan["phases"][number] | null {
    for (const phase of plan.phases) {
      const allDone = phase.targetNodes.every(n => executedNodes.includes(n));
      if (!allDone) return phase;
    }
    return plan.phases[plan.phases.length - 1] ?? null;
  }

  private filterByCapability(
    candidates: RouteCandidate[],
    registry: CapabilityRegistry
  ): RouteCandidate[] {
    return candidates.filter(c => {
      const cap = registry.get(c.nodeId);
      return cap != null;
    });
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/candidate_engine.ts
git commit -m "feat: add CandidateEngine with plan-weighted filtering"
```

---

### Task 19: 创建 orchestrator/llm_ranker.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/llm_ranker.ts`

**Consumes:** orchestrator/types.ts, capability/context.ts

**Produces:** `LlmRanker`

- [ ] **Step 1: 实现 LLM 排序器**

`backend/runtime_ts/orchestrator/llm_ranker.ts`:

```typescript
import type { LlmClient } from "../capability/context.js";
import type { RouteCandidate, RouteSuggestion, TaskPlan } from "./types.js";

const RANKING_PROMPT = `当前工作流已完成节点: {completedNodes}
当前数据产出: {stateSummary}
当前阶段: {currentPhase}
推荐执行计划: {planSummary}

可选的下游节点: {candidates}

请按推荐优先级排序，并为每个节点生成一句话理由。
格式: JSON [{ "nodeId": "string", "priority": number, "reason": "string" }]`;

export class LlmRanker {
  constructor(private readonly llm: LlmClient) {}

  async rank(
    candidates: RouteCandidate[],
    stateSummary: string,
    plan: TaskPlan | null
  ): Promise<RouteSuggestion[]> {
    const candidateList = candidates
      .sort((a, b) => b.planWeight - a.planWeight)
      .map(c => c.nodeId)
      .join(", ");

    const completedNodes = candidates
      .filter(c => c.status === "rerun")
      .map(c => c.nodeId)
      .join(", ");

    const currentPhaseName = plan?.phases.find(p =>
      !p.targetNodes.every(n => candidates.some(c => c.nodeId === n && c.status === "rerun"))
    )?.name ?? "未知阶段";

    const planSummary = plan?.phases
      .map(p => `${p.name}: ${p.targetNodes.join(", ")}`)
      .join(" → ") ?? "无计划";

    const prompt = RANKING_PROMPT
      .replace("{completedNodes}", completedNodes || "无")
      .replace("{stateSummary}", stateSummary)
      .replace("{currentPhase}", currentPhaseName)
      .replace("{planSummary}", planSummary)
      .replace("{candidates}", candidateList);

    try {
      const result = await this.llm.complete(prompt);
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed as RouteSuggestion[];
    } catch { /* fall through to fallback */ }

    return this.fallbackRank(candidates);
  }

  /** 降级排序：按权重降序 */
  private fallbackRank(candidates: RouteCandidate[]): RouteSuggestion[] {
    return [...candidates]
      .sort((a, b) => b.planWeight - a.planWeight)
      .map((c, i) => ({
        nodeId: c.nodeId,
        priority: i + 1,
        reason: c.status === "pending" ? "建议执行" : "可重新执行",
      }));
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/llm_ranker.ts
git commit -m "feat: add LlmRanker with priority fallback"
```

---

### Task 20: 创建 orchestrator/orchestrator.ts

**Files:**
- Create: `backend/runtime_ts/orchestrator/orchestrator.ts`

**Consumes:** All orchestrator/ modules, capability/, bus/, state.ts

**Produces:** `Orchestrator`

- [ ] **Step 1: 实现 Orchestrator 主入口**

`backend/runtime_ts/orchestrator/orchestrator.ts`:

```typescript
import { CapabilityDiscoverer } from "./discover.js";
import { TaskPlanner } from "./planner.js";
import { CandidateEngine } from "./candidate_engine.js";
import { LlmRanker } from "./llm_ranker.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { RuntimeContext } from "../capability/context.js";
import type { RuntimeState } from "../state.js";
import type { EventBus } from "../bus/types.js";
import type { TaskPlan, RouteSuggestion, CapabilityProfile } from "./types.js";

export class Orchestrator {
  private readonly discoverer: CapabilityDiscoverer;
  private readonly planner: TaskPlanner;
  private readonly candidateEngine: CandidateEngine;
  private readonly ranker: LlmRanker;
  private profiles: CapabilityProfile[] = [];
  private taskPlan: TaskPlan | null = null;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly ctx: RuntimeContext,
    private readonly eventBus: EventBus
  ) {
    this.discoverer = new CapabilityDiscoverer(registry);
    this.planner = new TaskPlanner(ctx.llm);
    this.candidateEngine = new CandidateEngine();
    this.ranker = new LlmRanker(ctx.llm);
  }

  /** 初始化：探测子节点能力 + 生成执行计划 */
  async initialize(requirement: string): Promise<void> {
    this.profiles = this.discoverer.discoverSafe();
    this.taskPlan = await this.planner.plan(requirement, this.profiles);

    if (!this.taskPlan) {
      await this.eventBus.publish({
        traceId: this.ctx.traceId,
        eventType: "DEGRADATION",
        uiHint: "degradation_notice",
        nodeId: "__orchestrator__",
        workflowId: this.ctx.workflowId,
        runId: this.ctx.runId,
        payload: {
          level: "warn",
          source: "orchestrator.planning",
          message: "规划器暂时不可用，已降级为平等候选模式",
          fallback: "flat_candidates",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 生成下一轮路由建议 */
  async suggestRoute(
    completedNodeId: string,
    state: RuntimeState,
    stateSummary: string
  ): Promise<RouteSuggestion[]> {
    const candidates = this.candidateEngine.generateSafe(
      state,
      completedNodeId,
      this.registry,
      this.taskPlan
    );

    const suggestions = await this.ranker.rank(candidates, stateSummary, this.taskPlan);

    await this.eventBus.publish({
      traceId: this.ctx.traceId,
      eventType: "ROUTING",
      uiHint: "routing_decision",
      nodeId: completedNodeId,
      workflowId: this.ctx.workflowId,
      runId: this.ctx.runId,
      payload: {
        completedNode: completedNodeId,
        currentPhase: this.taskPlan?.phases.find(p =>
          !p.targetNodes.every(n => state.control.executionPath?.some(s => s.nodeId === n))
        )?.name ?? "未知阶段",
        planProgress: {
          completed: state.control.executionPath?.map(s => s.nodeId) ?? [],
          remaining: this.registry.listIds().filter(
            id => !state.control.executionPath?.some(s => s.nodeId === id)
          ),
        },
        suggestions,
        executedNodes: state.control.executionPath?.map(s => s.nodeId) ?? [],
      },
      timestamp: new Date().toISOString(),
    });

    return suggestions;
  }

  /** 是否有更多候选节点 */
  hasMoreCandidates(state: RuntimeState): boolean {
    const executed = new Set(state.control.executionPath?.map(s => s.nodeId) ?? []);
    const remaining = this.registry.listIds().filter(id => !executed.has(id));
    return remaining.length > 0;
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/orchestrator/orchestrator.ts
git commit -m "feat: add Orchestrator with Discovery → Planning → Routing loop"
```

---

### Task 21: 创建 skills/loader.ts

**Files:**
- Create: `backend/runtime_ts/skills/loader.ts`

**Consumes:** capability/types.ts (Tool)

**Produces:** `SkillLoader`

- [ ] **Step 1: 实现 Tool 加载器**

`backend/runtime_ts/skills/loader.ts`:

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool } from "../capability/types.js";

interface ManifoldJson {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export class SkillLoader {
  constructor(private readonly toolsDir: string) {}

  async loadAll(): Promise<Tool[]> {
    const tools: Tool[] = [];
    const entries = await fs.readdir(this.toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const toolDir = path.join(this.toolsDir, entry.name);
      try {
        const tool = await this.loadTool(toolDir);
        if (tool) tools.push(tool);
      } catch (err) {
        console.warn(`Failed to load tool: ${entry.name}`, err);
      }
    }

    return tools;
  }

  private async loadTool(toolDir: string): Promise<Tool | null> {
    const manifestPath = path.join(toolDir, "manifest.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf-8")
    ) as ManifoldJson;

    // 加载本地 skill
    let execute: Tool["execute"];
    const skillPath = path.join(toolDir, "skill.js");
    try {
      const mod = await import(skillPath);
      execute = mod.default ?? mod.execute;
    } catch {
      // 纯 MCP，由 adapter 提供 execute
      execute = async () => { throw new Error("No local skill implementation"); };
    }

    return {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.parameters,
      execute,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/skills/loader.ts
git commit -m "feat: add SkillLoader for filesystem-based tool discovery"
```

---

### Task 22: 创建 skills/adapter.ts

**Files:**
- Create: `backend/runtime_ts/skills/adapter.ts`

- [ ] **Step 1: 实现 MCP Adapter**

`backend/runtime_ts/skills/adapter.ts`:

```typescript
import type { Tool } from "../capability/types.js";

export interface McpManifold {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverCommand?: string;
  serverArgs?: string[];
}

export interface McpClientLike {
  call(toolName: string, params: Record<string, any>): Promise<any>;
}

export class McpAdapter {
  constructor(private readonly mcpClient: McpClientLike) {}

  adapt(manifest: McpManifold): Tool {
    return {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.inputSchema,
      execute: async (params: Record<string, any>) => {
        return this.mcpClient.call(manifest.name, params);
      },
    };
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/skills/adapter.ts
git commit -m "feat: add McpAdapter for MCP protocol → standard Tool"
```

---

### Task 23: 创建 tracing/trace_id.ts

**Files:**
- Create: `backend/runtime_ts/tracing/trace_id.ts`

**Produces:** `generateTraceId`, `generateRunId`

- [ ] **Step 1: 实现 ULID 溯源 ID 生成器**

`backend/runtime_ts/tracing/trace_id.ts`:

```typescript
/** ULID 风格的时间排序随机 ID（不引入外部依赖的简化版） */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36).padStart(10, "0");
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
  return timestamp + random;
}

export function generateRunId(): string {
  // 使用 crypto.randomUUID 或 fallback
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/tracing/trace_id.ts
git commit -m "feat: add ULID trace_id and UUID run_id generators"
```

---

### Task 24: 创建 tracing/collector.ts

**Files:**
- Create: `backend/runtime_ts/tracing/collector.ts`

- [ ] **Step 1: 实现 TraceCollector**

`backend/runtime_ts/tracing/collector.ts`:

```typescript
import type { WorkflowEvent } from "../bus/types.js";

export interface TraceNode {
  event: WorkflowEvent;
  children: TraceNode[];
}

export interface TraceStore {
  saveTree(runId: string, tree: TraceNode): Promise<void>;
}

export class TraceCollector {
  constructor(private readonly store: TraceStore) {}

  /** 将扁平事件列表重组为树形链路 */
  buildTree(events: WorkflowEvent[]): TraceNode[] {
    const roots: TraceNode[] = [];
    const map = new Map<string, TraceNode>();

    for (const event of events) {
      const node: TraceNode = { event, children: [] };
      map.set(event.traceId, node);
    }

    for (const event of events) {
      const node = map.get(event.traceId);
      if (!node) continue;

      if (event.parentTraceId && map.has(event.parentTraceId)) {
        map.get(event.parentTraceId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async collect(runId: string, events: WorkflowEvent[]): Promise<void> {
    const tree = this.buildTree(events);
    await this.store.saveTree(runId, tree[0] ?? null as any);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/tracing/collector.ts
git commit -m "feat: add TraceCollector for tree-structured audit trails"
```

---

### Task 25: 更新 index.ts 补充 P1 导出

**Files:**
- Modify: `backend/runtime_ts/index.ts`

- [ ] **Step 1: 追加 Orchestrator / Tracing / Skills 导出**

在 `backend/runtime_ts/index.ts` 末尾追加：

```typescript
// ── orchestrator ──
export { Orchestrator } from "./orchestrator/orchestrator.js";
export { CapabilityDiscoverer } from "./orchestrator/discover.js";
export { TaskPlanner } from "./orchestrator/planner.js";
export { CandidateEngine } from "./orchestrator/candidate_engine.js";
export { LlmRanker } from "./orchestrator/llm_ranker.js";
export type {
  RouteCandidate,
  RouteSuggestion,
  TaskPlan,
  TaskPhase,
  CapabilityProfile,
} from "./orchestrator/types.js";

// ── skills ──
export { SkillLoader } from "./skills/loader.js";
export { McpAdapter } from "./skills/adapter.js";
export type { McpManifold, McpClientLike } from "./skills/adapter.js";

// ── tracing ──
export { generateTraceId, generateRunId } from "./tracing/trace_id.js";
export { TraceCollector } from "./tracing/collector.js";
export type { TraceNode, TraceStore } from "./tracing/collector.js";
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/index.ts
git commit -m "refactor: add P1 exports (Orchestrator, Skills, Tracing)"
```

---

## Phase 3: P2 增强 —— MCP 生命周期 + 热插拔

### Task 26: MCP 生命周期管理

**Files:**
- Modify: `backend/runtime_ts/skills/adapter.ts`

- [ ] **Step 1: 添加 MCP Server 生命周期**

追加到 `backend/runtime_ts/skills/adapter.ts`：

```typescript
export interface McpProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export class McpProcessManager {
  private processes = new Map<string, McpProcess>();

  async launch(manifest: McpManifold): Promise<void> {
    // Stub: MCP 服务进程的实际启动由外部实现
    // 这里提供接口框架
  }

  async shutdown(toolName: string): Promise<void> {
    const proc = this.processes.get(toolName);
    if (proc) await proc.stop();
    this.processes.delete(toolName);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.processes.values()].map(p => p.stop()));
    this.processes.clear();
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/skills/adapter.ts
git commit -m "feat: add McpProcessManager lifecycle interface"
```

---

### Task 27: 热插拔支持

**Files:**
- Modify: `backend/runtime_ts/skills/loader.ts`

- [ ] **Step 1: 添加文件监听 + 热重载**

追加到 `backend/runtime_ts/skills/loader.ts`：

```typescript
import { watch } from "node:fs";

export class SkillLoader {
  // ... existing code ...

  watch(callback: (toolName: string, action: "added" | "removed" | "changed") => void): () => void {
    const watcher = watch(this.toolsDir, { recursive: false }, async (event, filename) => {
      if (!filename) return;
      try {
        if (event === "rename") {
          // 检查目录是否仍存在
          const dirPath = path.join(this.toolsDir, filename);
          const exists = await fs.access(dirPath).then(() => true).catch(() => false);
          callback(filename, exists ? "added" : "removed");
        } else {
          callback(filename, "changed");
        }
      } catch { /* ignore */ }
    });

    return () => watcher.close();
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/skills/loader.ts
git commit -m "feat: add hot-reload file watcher to SkillLoader"
```

---

## Phase 4: P3 清理 —— GraphRuntime 重写

### Task 28: 重写 graph_runtime.ts 为 GraphRuntime

**Files:**
- Modify: `backend/runtime_ts/graph_runtime.ts`

**Consumes:** engine/, capability/, bus/

**Produces:** `GraphRuntime` v2

- [ ] **Step 1: 重写为单节点编译 + Capability 执行**

`backend/runtime_ts/graph_runtime.ts`:

```typescript
import { StateGraph, END } from "./engine/graph.js";
import type { Checkpointer, GraphConfig } from "./engine/graph.js";
import { CapabilityExecutor } from "./capability/executor.js";
import { CapabilityRegistry } from "./capability/registry.js";
import type { RuntimeContext } from "./capability/context.js";
import type { EventBus } from "./bus/types.js";
import type { RuntimeState, ExecutionStep } from "./state.js";
import { generateTraceId, generateRunId } from "./tracing/trace_id.js";

export class GraphRuntime {
  private readonly executor: CapabilityExecutor;
  private readonly runId: string;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly checkpointer?: Checkpointer
  ) {
    this.executor = new CapabilityExecutor(registry);
    this.runId = generateRunId();
  }

  get config(): GraphConfig {
    return {
      configurable: { threadId: this.runId },
    };
  }

  initialState(data: Record<string, any>): RuntimeState {
    return {
      data,
      control: {
        currentNode: "",
        executionPath: [] as ExecutionStep[],
      },
      runtime: {
        workflowId: "",
        runId: this.runId,
        threadId: this.runId,
      },
      errors: [],
    };
  }

  /** 动态编译并执行单个节点 */
  async executeStep(
    nodeId: string,
    state: RuntimeState,
    ctx: RuntimeContext
  ): Promise<RuntimeState> {
    const graph = new StateGraph<RuntimeState>();

    graph.addNode(nodeId, async (s) => {
      return this.executor.execute(nodeId, s, ctx);
    });
    graph.addEdge(nodeId, END);
    graph.setEntryPoint(nodeId);

    const compiled = graph.compile(this.checkpointer);

    // 执行前保存 checkpoint
    if (this.checkpointer) {
      await this.checkpointer.save(this.runId, {
        state,
        nextNode: nodeId,
      });
    }

    return compiled.invoke(state, this.config);
  }

  /** 从 checkpoint 恢复 */
  async recover(): Promise<RuntimeState | null> {
    if (!this.checkpointer) return null;
    const checkpoint = await this.checkpointer.load(this.runId);
    if (!checkpoint) return null;
    return checkpoint.state as RuntimeState;
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add backend/runtime_ts/graph_runtime.ts
git commit -m "refactor: rewrite GraphRuntime for single-node dynamic compilation"
```

---

### Task 29: 删除 node_runner.ts

**Files:**
- Delete: `backend/runtime_ts/node_runner.ts`

CapabilityExecutor 已在 Task 9 实现，旧 NodeRunner 废弃。

- [ ] **Step 1: 删除**

```bash
Remove-Item -Path "backend/runtime_ts/node_runner.ts" -Force
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "refactor: remove deprecated node_runner.ts (replaced by CapabilityExecutor)"
```

---

### Task 30: 最终验证编译

- [ ] **Step 1: 全量编译检查**

```bash
npx tsc --noEmit -p backend/runtime_ts/tsconfig.json
```

Expected: Zero errors.

- [ ] **Step 2: 检查删除遗漏的 import 引用**

确认以下文件已不存在：
- `backend/runtime_ts/policies.ts`
- `backend/runtime_ts/context.ts`
- `backend/runtime_ts/template.ts`
- `backend/runtime_ts/node_runner.ts`

确认所有模块的 import 路径指向新目录。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: final cleanup and verification pass"
```

---

## Phase 5: 文档

### Task 31: 更新 package.json exports

**Files:**
- Modify: `backend/runtime_ts/package.json`

- [ ] **Step 1: 确保 exports 字段正确**

```json
{
  "main": "./index.js",
  "types": "./index.ts"
}
```

- [ ] **Step 2: 提交**

```bash
git add backend/runtime_ts/package.json
git commit -m "chore: update package.json exports"
```

---

## 附录 A: 未覆盖项

| 项 | 状态 |
|----|------|
| graph_runtime.ts 中的 deleted import（context.ts, template.ts） | 已重写 graph_runtime.ts |
| policies.ts 导出的 `assignCompetitorGroups` / `removeCompetitorsFromGroups` | 随 policies.ts 删除，业务层自行维护 |
| retry.ts NodeFatalError | 保留，未改动 |
| Python runtime 删除 | 用户已手动完成 |

---

## 附录 B: 模块依赖图

```
orchestrator/orchestrator.ts
  ├── orchestrator/discover.ts      → capability/registry.ts
  ├── orchestrator/planner.ts       → capability/context.ts (LlmClient)
  ├── orchestrator/candidate_engine → capability/registry.ts, state.ts
  ├── orchestrator/llm_ranker       → capability/context.ts (LlmClient)
  └── bus/types.ts (EventBus)

capability/executor.ts
  ├── capability/types.ts
  ├── capability/context.ts
  └── state.ts

capability/context.ts
  └── bus/types.ts

capability/registry.ts
  └── capability/types.ts

bus/redis_bus.ts
  └── bus/types.ts

bus/sse_relay.ts
  └── bus/types.ts (EventBus)

engine/graph.ts
  └── engine/checkpointer.ts

tracing/collector.ts
  └── bus/types.ts

graph_runtime.ts
  ├── engine/graph.ts
  ├── capability/executor.ts
  ├── capability/registry.ts
  └── tracing/trace_id.ts
```
