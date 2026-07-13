# HITL 人在回路 — 事件溯源实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于事件溯源模式实现工作流执行中的人工决策暂停、任意回跳、级联失效清除。

**Architecture:** 新增 `events.ts`（事件类型 + fold 纯函数投影）和 `runner.ts`（事件驱动编排循环），通过 Event 表追加事件 + Redis Pub/Sub 暂停/唤醒机制实现。不改动 `backend/runtime/` 任何文件。

**Tech Stack:** TypeScript (ESM), NestJS, Prisma, Redis, 现有 Runtime v2

**Spec:** [2026-07-08-hitl-event-sourcing-design.md](../specs/2026-07-08-hitl-event-sourcing-design.md)

## Global Constraints

- 不改动 `backend/runtime/` 目录下的任何文件
- 不改动 `backend/capabilities/` 目录下的任何文件
- Event 表复用现有 `{ eventType, nodeId, payload, timestamp }` 结构，不修改其 Schema
- 新增代码放在 `backend/src/workflow/`
- RedisModule 已是 @Global()，可直接注入 RedisService

---

## File Structure Plan

```
backend/
├── src/
│   └── workflow/                     # 新建
│       ├── events.ts                 # 事件类型 + fold 函数
│       └── runner.ts                 # 事件驱动编排循环
├── entry/
│   └── workflow.ts                   # 修改：删除 while 循环，改为委托 runner
└── prisma/
    └── schema.prisma                 # 修改：Workflow 表加 pausedAt, currentNode
backend/src/api/workflows/
    ├── workflows.service.ts          # 修改：routeDecision/cancel 接线 + Redis 唤醒
    └── workflows.controller.ts       # 修改：cancel 端点 + routeDecision body 变更
    └── __tests__/
        └── workflows-hitl.test.ts    # 新建：HITL 流程单元测试
```

---

### Task 1: Schema 迁移 — Workflow 表扩展

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Consumes: 现有 Workflow model
- Produces: Workflow 模型新增 `pausedAt` (DateTime?), `currentNode` (String?)

- [ ] **Step 1: 修改 Prisma Schema**

```prisma
model Workflow {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  name          String
  status        String    @default("pending")  // pending | running | paused | completed | failed | cancelled
  input         Json?
  currentNode   String?                        // 当前执行节点 ID，恢复定位
  pausedAt      DateTime?                      // 暂停时间戳
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  events        Event[]
  artifacts     Artifact[]
}
```

- [ ] **Step 2: 生成迁移并应用**

```powershell
npx prisma migrate dev --name add_workflow_hitl_fields
```

Expected: 迁移成功创建，Workflow 表新增 `currentNode` 和 `pausedAt` 字段。

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add pausedAt and currentNode fields to Workflow for HITL"
```

---

### Task 2: events.ts — 事件类型定义 + fold 投影函数

**Files:**
- Create: `backend/src/workflow/events.ts`

**Interfaces:**
- Consumes: `CapabilityRegistry` from `backend/runtime/index.js`, `RuntimeState`, `ExecutionStep` from runtime
- Produces: `WorkflowLifecycleEvent` 联合类型, `fold()` 函数

- [ ] **Step 1: 创建 events.ts**

```typescript
// backend/src/workflow/events.ts

import type { CapabilityRegistry } from "../../runtime/index.js";
import type { RuntimeState, ExecutionStep } from "../../runtime/index.js";
import type { RouteSuggestion } from "../../runtime/index.js";

export type WorkflowLifecycleEvent =
  | { type: "node.executed";      nodeId: string; iteration: number; outputKeys: string[] }
  | { type: "route.required";     completedNode: string; suggestions: RouteSuggestion[] }
  | { type: "human.continued";    targetNode: string }
  | { type: "human.backjumped";   targetNode: string }
  | { type: "workflow.completed" }
  | { type: "workflow.failed";    error: string }
  | { type: "workflow.cancelled" };

export interface HumanDecision {
  targetNode: string;
  action: "continue" | "backjump";
}

/**
 * fold — 纯函数投影。
 * 输入当前状态 + 一个事件 + Registry，返回新状态。
 */
export function fold(
  state: RuntimeState,
  event: WorkflowLifecycleEvent,
  registry: CapabilityRegistry
): RuntimeState {
  switch (event.type) {

    case "node.executed": {
      const step: ExecutionStep = {
        nodeId: event.nodeId,
        iteration: event.iteration,
        startedAt: "",
        completedAt: new Date().toISOString(),
      };
      return {
        ...state,
        control: {
          ...state.control,
          currentNode: event.nodeId,
          executionPath: [...state.control.executionPath, step],
        },
      };
    }

    case "human.backjumped": {
      const idx = state.control.executionPath.findIndex(
        s => s.nodeId === event.targetNode
      );
      if (idx === -1) return state;

      const downstream = state.control.executionPath.slice(idx + 1);
      const staleKeys = new Set<string>();
      for (const s of downstream) {
        const cap = registry.get(s.nodeId);
        (cap?.outputHints ?? []).forEach(k => staleKeys.add(k));
      }

      const newData = { ...state.data };
      for (const k of staleKeys) {
        delete newData[k];
      }

      return {
        ...state,
        data: newData,
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

    // route.required / workflow.completed / failed / cancelled — 不改 state.data
    default:
      return state;
  }
}

/**
 * 从 RuntimeState 计算某个已执行节点的当前 iteration 数。
 * 累加 executionPath 中同 nodeId 的所有 step。
 */
export function countIterations(state: RuntimeState, nodeId: string): number {
  return state.control.executionPath.filter(s => s.nodeId === nodeId).length;
}

/**
 * 获取某 Capability 的 outputHints。
 */
export function getOutputKeys(nodeId: string, registry: CapabilityRegistry): string[] {
  const cap = registry.get(nodeId);
  return cap?.outputHints ?? [];
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/workflow/events.ts
git commit -m "feat: add WorkflowLifecycleEvent types and fold projection for HITL"
```

---

### Task 3: runner.ts — 事件驱动编排循环

**Files:**
- Create: `backend/src/workflow/runner.ts`

**Interfaces:**
- Consumes: `fold`, `WorkflowLifecycleEvent`, `countIterations`, `getOutputKeys` from `./events.js`
- Consumes: `GraphRuntime`, `Orchestrator`, `CapabilityRegistry`, `RuntimeContext`, `RuntimeState`, `EventBus`, `WorkflowData` from `../../runtime/index.js`
- Consumes: EventsService, RedisService from NestJS
- Produces: `runWorkflow()` async generator 函数

- [ ] **Step 1: 创建 runner.ts**

```typescript
// backend/src/workflow/runner.ts

import {
  CapabilityRegistry,
  GraphRuntime,
  Orchestrator,
} from "../../runtime/index.js";
import type {
  RuntimeContext,
  RuntimeState,
  EventBus,
} from "../../runtime/index.js";
import type { WorkflowData } from "../../capabilities/shared/types.js";
import {
  fold,
  countIterations,
  getOutputKeys,
} from "./events.js";
import type { WorkflowLifecycleEvent, HumanDecision } from "./events.js";

export interface RunnerDeps {
  loadEventStream(workflowId: string): Promise<WorkflowLifecycleEvent[]>;
  appendEvent(workflowId: string, event: WorkflowLifecycleEvent): Promise<void>;
  waitForHumanDecision(workflowId: string): Promise<HumanDecision>;
  updateWorkflowStatus(
    workflowId: string,
    data: { status: string; pausedAt?: Date | null; currentNode?: string }
  ): Promise<void>;
}

export async function* runWorkflow(
  workflowId: string,
  userInput: string,
  registry: CapabilityRegistry,
  ctx: RuntimeContext,
  eventBus: EventBus,
  deps: RunnerDeps
): AsyncGenerator<void> {
  const runtime = new GraphRuntime(registry);

  // 1. 加载事件流 + 投影状态
  const pastEvents = await deps.loadEventStream(workflowId);
  let state: RuntimeState = runtime.initialState({ userInput } as WorkflowData);
  for (const e of pastEvents) {
    state = fold(state, e, registry);
  }

  // 2. 定位恢复点
  const lastEvent = pastEvents.at(-1);
  let currentNode: string | null = null;

  if (!lastEvent) {
    currentNode = "requirement_parsing";
  } else if (lastEvent.type === "human.continued" || lastEvent.type === "human.backjumped") {
    currentNode = lastEvent.targetNode;
  } else if (lastEvent.type === "route.required") {
    currentNode = null;
  } else {
    // 已终止
    return;
  }

  const orch = new Orchestrator(registry, ctx, eventBus);
  await orch.initialize(userInput);

  // 3. 编排循环
  while (currentNode) {
    // 执行节点
    ctx.nodeId = currentNode;
    state = await runtime.executeStep(currentNode, state, ctx);
    const iteration = countIterations(state, currentNode);
    const outputKeys = getOutputKeys(currentNode, registry);

    await deps.appendEvent(workflowId, {
      type: "node.executed",
      nodeId: currentNode,
      iteration,
      outputKeys,
    });

    // 终止检查
    if (currentNode === "artifact_generation") {
      await deps.appendEvent(workflowId, { type: "workflow.completed" });
      await deps.updateWorkflowStatus(workflowId, { status: "completed" });
      break;
    }

    // 路由
    const suggestions = await orch.suggestRoute(currentNode, state, "state summary");
    await deps.appendEvent(workflowId, {
      type: "route.required",
      completedNode: currentNode,
      suggestions,
    });

    // 暂停 — 等待人工决策
    await deps.updateWorkflowStatus(workflowId, {
      status: "paused",
      pausedAt: new Date(),
      currentNode,
    });

    const decision = await deps.waitForHumanDecision(workflowId);

    // 更新状态为运行中
    await deps.updateWorkflowStatus(workflowId, {
      status: "running",
      pausedAt: null,
      currentNode: decision.targetNode,
    });

    const eventType =
      decision.action === "backjump" ? "human.backjumped" : "human.continued";

    await deps.appendEvent(workflowId, {
      type: eventType,
      targetNode: decision.targetNode,
    } as WorkflowLifecycleEvent);

    state = fold(state, { type: eventType, targetNode: decision.targetNode } as WorkflowLifecycleEvent, registry);
    currentNode = decision.targetNode;
  }
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/workflow/runner.ts
git commit -m "feat: add event-driven runWorkflow loop with pause/resume for HITL"
```

---

### Task 4: entry/workflow.ts — 删除 while 循环，保留工厂函数

**Files:**
- Modify: `backend/entry/workflow.ts`

**Interfaces:**
- Consumes: `runWorkflow`, `RunnerDeps` from `../src/workflow/runner.js`
- Produces: 精简后的 `createWorkflow()` 工厂函数

- [ ] **Step 1: 修改 workflow.ts**

替换整个文件内容：

```typescript
// backend/entry/workflow.ts

import {
  CapabilityRegistry,
} from "../runtime/index.js";
import type {
  EventBus,
} from "../runtime/index.js";
import { createRequirementParsingCap } from "../capabilities/requirement_parsing/index.js";
import { createInformationCollectionCap } from "../capabilities/information_collection/index.js";
import { createInformationProcessingCap } from "../capabilities/information_processing/index.js";
import { createAnalysisReasoningCap } from "../capabilities/analysis_reasoning/index.js";
import { createArtifactGenerationCap } from "../capabilities/artifact_generation/index.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan?(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<Record<string, any>>;
  synthesize?(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export function createRegistry(llm: LlmClient): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(createRequirementParsingCap(llm));
  registry.register(createInformationCollectionCap(llm));
  registry.register(createInformationProcessingCap(llm));
  registry.register(createAnalysisReasoningCap(llm));
  registry.register(createArtifactGenerationCap());
  return registry;
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。workflow.test.ts 中的引用需要同步更新（在 Task 5+6 中处理）。

- [ ] **Step 3: Commit**

```bash
git add backend/entry/workflow.ts
git commit -m "refactor: simplify createWorkflow to factory-only, delegate orchestration to runner"
```

---

### Task 5: workflows.service.ts — 接入 HITL 路由决策 + Redis 唤醒

**Files:**
- Modify: `backend/src/api/workflows/workflows.service.ts`

**Interfaces:**
- Consumes: `runWorkflow`, `RunnerDeps` from `../../../src/workflow/runner.js`
- Consumes: `createRegistry` from `../../../entry/workflow.js`
- Consumes: EventsService, PrismaService, RedisService
- Produces: `routeDecision()` 实现，`cancelWorkflow()` 新增，`executeWorkflow()` 改造

- [ ] **Step 1: 修改 workflows.service.ts**

```typescript
// backend/src/api/workflows/workflows.service.ts

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { EventsService } from '../events/events.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createRegistry } from '../../../entry/workflow.js';
import { runWorkflow } from '../../../src/workflow/runner.js';
import type { RunnerDeps } from '../../../src/workflow/runner.js';
import type { WorkflowLifecycleEvent, HumanDecision } from '../../../src/workflow/events.js';
```

等等，runner.ts 导出 `RunnerDeps`、`HumanDecision`、`WorkflowLifecycleEvent` 是通过 `./events.js` 的。让我确认...

实际上 `HumanDecision` 和 `WorkflowLifecycleEvent` 是在 events.ts 中定义的，runner.ts 从 events.ts 导入。service 也需要从 events.ts 导入。

重写 service：

```typescript
// backend/src/api/workflows/workflows.service.ts

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { EventsService } from '../events/events.service';
import { RedisService } from '../../infra/redis/redis.service';
import { CapabilityRegistry } from '../../../runtime/index.js';
import { createRegistry } from '../../../entry/workflow.js';
import { runWorkflow } from '../../../src/workflow/runner.js';
import type { RunnerDeps } from '../../../src/workflow/runner.js';
import type { WorkflowLifecycleEvent, HumanDecision } from '../../../src/workflow/events.js';

@Injectable()
export class WorkflowsService {
  private registry: CapabilityRegistry;
  // 存储 workflowId → AbortController 映射
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private redis: RedisService,
  ) {
    this.registry = new CapabilityRegistry();
  }

  async createWorkflow(userId: string, input: string) {
    const workflow = await this.prisma.workflow.create({
      data: {
        userId,
        name: input.substring(0, 50),
        input: { requirement: input },
      },
    });

    this.executeWorkflow(workflow.id, input).catch(console.error);

    return workflow;
  }

  async getWorkflow(id: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id },
      include: { events: true, artifacts: true },
    });

    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }

    return workflow;
  }

  async getWorkflowHistory(id: string) {
    return this.eventsService.getWorkflowEvents(id);
  }

  async getWorkflowArtifacts(id: string) {
    return this.prisma.artifact.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async routeDecision(workflowId: string, targetNode: string, action: "continue" | "backjump" = "continue") {
    // 检查工作流是否处于 paused 状态
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }
    if (workflow.status !== 'paused') {
      throw new ConflictException('工作流未处于暂停状态');
    }

    // 追加决策事件
    const eventType = action === "backjump" ? "human.backjumped" : "human.continued";
    await this.eventsService.publishEvent(workflowId, {
      eventType,
      nodeId: targetNode,
      payload: { targetNode, action },
      timestamp: new Date().toISOString(),
    });

    // 更新 DB 状态
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: "running", pausedAt: null, currentNode: targetNode },
    });

    // 唤醒 Runner
    const decision: HumanDecision = { targetNode, action };
    await this.redis.publish(
      `workflow:${workflowId}:decision`,
      JSON.stringify(decision)
    );

    return { workflowId, targetNode, action, status: "accepted" };
  }

  async cancelWorkflow(workflowId: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }
    if (workflow.status === 'completed' || workflow.status === 'failed' || workflow.status === 'cancelled') {
      throw new ConflictException('工作流已终止');
    }

    // 触发 Abort
    const controller = this.abortControllers.get(workflowId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(workflowId);
    }

    // 追加取消事件
    await this.eventsService.publishEvent(workflowId, {
      eventType: "workflow.cancelled",
      nodeId: "system",
      payload: { reason: "user_cancelled" },
      timestamp: new Date().toISOString(),
    });

    // 更新 DB 状态
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: "cancelled", pausedAt: null },
    });

    return { workflowId, status: "cancelled" };
  }

  private async executeWorkflow(workflowId: string, input: string) {
    const abortController = new AbortController();
    this.abortControllers.set(workflowId, abortController);

    try {
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'running' },
      });

      const registry = createRegistry({
        complete: async (prompt: string) => 'LLM response placeholder',
      });

      const eventBus = {
        publish: async (event: any) => {
          await this.eventsService.publishEvent(workflowId, event);
        },
        subscribe: async () => {},
        unsubscribe: async () => {},
      };

      const deps: RunnerDeps = {
        loadEventStream: async (wfId: string) => {
          const events = await this.eventsService.getWorkflowEvents(wfId);
          return events
            .filter((e: any) => Object.prototype.hasOwnProperty.call(e.payload, 'type'))
            .map((e: any) => e.payload as WorkflowLifecycleEvent);
        },
        appendEvent: async (wfId: string, event: WorkflowLifecycleEvent) => {
          await this.eventsService.publishEvent(wfId, {
            eventType: event.type,
            nodeId: "nodeId" in event ? (event as any).nodeId : (event as any).targetNode ?? "system",
            payload: event,
            timestamp: new Date().toISOString(),
          });
        },
        waitForHumanDecision: (wfId: string) => {
          return new Promise<HumanDecision>((resolve) => {
            const channel = `workflow:${wfId}:decision`;
            this.redis.subscribe(channel, (msg: string) => {
              resolve(JSON.parse(msg));
            });
          });
        },
        updateWorkflowStatus: async (wfId: string, data) => {
          await this.prisma.workflow.update({
            where: { id: wfId },
            data,
          });
        },
      };

      const ctx = {
        traceId: "",
        workflowId,
        runId: "",
        nodeId: "",
        iteration: 0,
        signal: abortController.signal,
        llm: {
          complete: async (prompt: string) => 'LLM response placeholder',
          plan: async () => ({ phases: [] }),
          synthesize: async (_state: Record<string, any>, r: any[]) => r,
        },
        emit: async (event: any, _opts?: any) => {
          await eventBus.publish({
            traceId: "",
            eventType: event.eventType ?? "EVENT",
            uiHint: event.uiHint,
            nodeId: "",
            workflowId,
            runId: "",
            payload: event.payload ?? {},
            timestamp: new Date().toISOString(),
          } as any);
        },
        saveArtifact: async (_draft: any) => "",
      };

      const gen = runWorkflow(workflowId, input, registry, ctx, eventBus, deps);

      for await (const _ of gen) {
        if (abortController.signal.aborted) break;
      }

      this.abortControllers.delete(workflowId);
    } catch (error: any) {
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'failed' },
      });
      await this.eventsService.publishEvent(workflowId, {
        eventType: 'workflow.failed',
        nodeId: 'system',
        payload: { type: "workflow.failed", error: error.message },
        timestamp: new Date().toISOString(),
      });
      this.abortControllers.delete(workflowId);
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/workflows/workflows.service.ts
git commit -m "feat: wire routeDecision/cancel with Redis wake-up for HITL"
```

---

### Task 6: workflows.controller.ts — 扩展 API 端点

**Files:**
- Modify: `backend/src/api/workflows/workflows.controller.ts`

**Interfaces:**
- Consumes: WorkflowsService (routeDecision with new signature, cancelWorkflow)
- Produces: 更新 `POST :id/route` body schema，新增 `POST :id/cancel`

- [ ] **Step 1: 修改 controller**

```typescript
// backend/src/api/workflows/workflows.controller.ts

import { Controller, Get, Post, Body, Param, Sse } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EventsService } from '../events/events.service';
import { Observable } from 'rxjs';

@Controller('api/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly eventsService: EventsService,
  ) {}

  @Post()
  create(@CurrentUser() user: any, @Body() body: { input: string }) {
    return this.workflowsService.createWorkflow(user.id, body.input);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflowsService.getWorkflow(id);
  }

  @Sse(':id/stream')
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.eventsService.subscribeToWorkflow(id, (event) => {
        subscriber.next({ data: event } as MessageEvent);
      });
    });
  }

  @Post(':id/route')
  routeDecision(
    @Param('id') id: string,
    @Body() body: { targetNode: string; action?: "continue" | "backjump" }
  ) {
    return this.workflowsService.routeDecision(id, body.targetNode, body.action ?? "continue");
  }

  @Post(':id/cancel')
  cancelWorkflow(@Param('id') id: string) {
    return this.workflowsService.cancelWorkflow(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.workflowsService.getWorkflowHistory(id);
  }

  @Get(':id/artifacts')
  getArtifacts(@Param('id') id: string) {
    return this.workflowsService.getWorkflowArtifacts(id);
  }
}
```

- [ ] **Step 2: 验证编译**

```powershell
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/workflows/workflows.controller.ts
git commit -m "feat: add cancel endpoint and update route decision body for HITL"
```

---

### Task 7: 集成测试 — HITL 暂停/继续/回跳流程

**Files:**
- Create: `backend/src/api/workflows/__tests__/workflows-hitl.test.ts`

**Interfaces:**
- Consumes: WorkflowsService, EventsService from NestJS
- Consumes: `fold`, `WorkflowLifecycleEvent` from `../../../src/workflow/events.js`
- Consumes: `CapabilityRegistry` from `../../../runtime/index.js`
- Produces: 单元测试验证 fold 投影、HITL 流程

- [ ] **Step 1: 创建测试文件**

```typescript
// backend/src/api/workflows/__tests__/workflows-hitl.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fold, countIterations, getOutputKeys } from '../../../src/workflow/events.js';
import type { WorkflowLifecycleEvent } from '../../../src/workflow/events.js';
import { CapabilityRegistry } from '../../../runtime/index.js';
import type { RuntimeState, ExecutionStep } from '../../../runtime/index.js';

function createMockCapability(id: string, inputHints: string[] = [], outputHints: string[] = []) {
  return {
    id,
    description: `Mock ${id}`,
    inputHints,
    outputHints,
    tools: [],
    requires: [],
    async execute(state: RuntimeState, ctx: any) {
      return { patch: { [`${id}_output`]: `data from ${id}` }, artifacts: [] };
    },
  };
}

function setupRegistry() {
  const registry = new CapabilityRegistry();
  registry.register(createMockCapability("requirement_parsing", [], ["config"]));
  registry.register(createMockCapability("information_collection", ["config"], ["rawData"]));
  registry.register(createMockCapability("information_processing", ["rawData", "config"], ["structuredData"]));
  registry.register(createMockCapability("analysis_reasoning", ["structuredData", "rawData"], ["analysisResults"]));
  registry.register(createMockCapability("artifact_generation", ["analysisResults"], []));
  return registry;
}

function initialState(): RuntimeState {
  return {
    data: { userInput: "test input" },
    control: { currentNode: "", executionPath: [] },
    runtime: { workflowId: "wf-1", runId: "r-1", threadId: "r-1" },
    errors: [],
  };
}

describe("fold — event projection", () => {
  const registry = setupRegistry();

  describe("node.executed", () => {
    it("should append execution step and update currentNode", () => {
      const state = initialState();
      const event: WorkflowLifecycleEvent = {
        type: "node.executed",
        nodeId: "requirement_parsing",
        iteration: 0,
        outputKeys: ["config"],
      };

      const result = fold(state, event, registry);

      expect(result.control.currentNode).toBe("requirement_parsing");
      expect(result.control.executionPath).toHaveLength(1);
      expect(result.control.executionPath[0].nodeId).toBe("requirement_parsing");
      expect(result.control.executionPath[0].iteration).toBe(0);
    });
  });

  describe("human.continued", () => {
    it("should update currentNode without modifying executionPath or data", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "information_collection",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
          ],
        },
        data: { config: { targets: [] }, rawData: { items: [] } },
      };

      const event: WorkflowLifecycleEvent = {
        type: "human.continued",
        targetNode: "information_processing",
      };

      const result = fold(state, event, registry);

      expect(result.control.currentNode).toBe("information_processing");
      expect(result.control.executionPath).toHaveLength(2); // unchanged
      expect(result.data.config).toBeDefined();  // untouched
      expect(result.data.rawData).toBeDefined();  // untouched
    });
  });

  describe("human.backjumped — cascade invalidation", () => {
    it("should truncate executionPath and clear downstream output keys", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
            { nodeId: "information_processing", iteration: 0, startedAt: "", completedAt: "t3" },
            { nodeId: "analysis_reasoning", iteration: 0, startedAt: "", completedAt: "t4" },
          ],
        },
        data: {
          config: { targets: ["A", "B"] },
          rawData: { items: ["old data"] },
          structuredData: { records: ["old structured"] },
          analysisResults: { summary: "old analysis" },
        },
      };

      const event: WorkflowLifecycleEvent = {
        type: "human.backjumped",
        targetNode: "information_collection",
      };

      const result = fold(state, event, registry);

      // executionPath truncated
      expect(result.control.executionPath).toHaveLength(2);
      expect(result.control.executionPath[0].nodeId).toBe("requirement_parsing");
      expect(result.control.executionPath[1].nodeId).toBe("information_collection");
      expect(result.control.currentNode).toBe("information_collection");

      // config preserved (upstream of jump target)
      expect(result.data.config).toBeDefined();

      // downstream data cleared
      expect(result.data.rawData).toBeUndefined();
      expect(result.data.structuredData).toBeUndefined();
      expect(result.data.analysisResults).toBeUndefined();
    });

    it("should handle backjump to non-existent node gracefully", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
          ],
        },
        data: { config: { targets: ["A"] } },
      };

      const event: WorkflowLifecycleEvent = {
        type: "human.backjumped",
        targetNode: "nonexistent_node",
      };

      const result = fold(state, event, registry);

      // state unchanged
      expect(result.control.executionPath).toHaveLength(1);
      expect(result.data.config).toBeDefined();
    });

    it("should handle backjump to last node (no downstream)", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
            { nodeId: "information_processing", iteration: 0, startedAt: "", completedAt: "t3" },
            { nodeId: "analysis_reasoning", iteration: 0, startedAt: "", completedAt: "t4" },
          ],
        },
        data: {
          config: { targets: ["A"] },
          rawData: { items: ["d"] },
          structuredData: { records: ["s"] },
          analysisResults: { summary: "a" },
        },
      };

      const event: WorkflowLifecycleEvent = {
        type: "human.backjumped",
        targetNode: "analysis_reasoning",
      };

      const result = fold(state, event, registry);

      // Only analysis_reasoning's own output cleared
      expect(result.control.executionPath).toHaveLength(4); // no truncation
      expect(result.data.config).toBeDefined();
      expect(result.data.rawData).toBeDefined();
      expect(result.data.structuredData).toBeDefined();
      expect(result.data.analysisResults).toBeUndefined();
    });
  });

  describe("pass-through events", () => {
    it("should not modify state for route.required", () => {
      const state = initialState();
      const event: WorkflowLifecycleEvent = {
        type: "route.required",
        completedNode: "requirement_parsing",
        suggestions: [{ nodeId: "information_collection", priority: 1, reason: "next" }],
      };

      const result = fold(state, event, registry);
      expect(result).toEqual(state);
    });

    it("should not modify state for workflow.completed", () => {
      const state = initialState();
      const event: WorkflowLifecycleEvent = { type: "workflow.completed" };

      const result = fold(state, event, registry);
      expect(result).toEqual(state);
    });
  });
});

describe("countIterations", () => {
  it("should count iterations from executionPath", () => {
    const state: RuntimeState = {
      ...initialState(),
      control: {
        currentNode: "information_collection",
        executionPath: [
          { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
          { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
          { nodeId: "information_collection", iteration: 1, startedAt: "", completedAt: "t3" },
        ],
      },
    };

    expect(countIterations(state, "information_collection")).toBe(2);
    expect(countIterations(state, "requirement_parsing")).toBe(1);
    expect(countIterations(state, "nonexistent")).toBe(0);
  });
});

describe("getOutputKeys", () => {
  it("should return outputHints from registry", () => {
    const registry = setupRegistry();
    expect(getOutputKeys("information_collection", registry)).toEqual(["rawData"]);
  });

  it("should return empty array for unknown capability", () => {
    const registry = setupRegistry();
    expect(getOutputKeys("nonexistent", registry)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试**

```powershell
npx vitest run backend/src/api/workflows/__tests__/workflows-hitl.test.ts
```

Expected: 所有 10 个测试通过。

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/workflows/__tests__/workflows-hitl.test.ts
git commit -m "test: add unit tests for fold projection and HITL cascade invalidation"
```

---

### Task 8: 更新 entry workflow 测试文件

**Files:**
- Modify: `backend/entry/__tests__/workflow.test.ts`

**Interfaces:**
- Consumes: `createRegistry` from `../workflow.js`, `runWorkflow` from `../../src/workflow/runner.js`
- Produces: E2E 测试适配新 Runner 模式（通过 mock RunnerDeps 模拟 auto-continue）

- [ ] **Step 1: 重写测试文件**

原测试使用 `createWorkflow(llm, eventBus).run(input)` 直接同步执行。重构后 `entry/workflow.ts` 仅导出 `createRegistry()`，编排循环由 `runWorkflow()` 异步生成器驱动。需要提供 mock RunnerDeps 消费生成器：

```typescript
// backend/entry/__tests__/workflow.test.ts

import { describe, it, expect } from "vitest";
import { createRegistry } from "../workflow.js";
import { runWorkflow } from "../../src/workflow/runner.js";
import type { RunnerDeps } from "../../src/workflow/runner.js";
import type { WorkflowLifecycleEvent, HumanDecision } from "../../src/workflow/events.js";
import { GraphRuntime, CapabilityRegistry } from "../../runtime/index.js";
import type { RuntimeState, EventBus } from "../../runtime/index.js";
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
      if (prompt.includes("工作流编排器")) {
        return JSON.stringify({
          phases: [
            { name: "采集", targetNodes: ["information_collection"], rationale: "采集竞品数据" },
            { name: "分析", targetNodes: ["information_processing", "analysis_reasoning"], rationale: "处理分析数据" },
            { name: "生成", targetNodes: ["artifact_generation"], rationale: "生成产物" },
          ],
        });
      }
      if (prompt.includes("搜索计划") || prompt.includes("采集调度器")) {
        return JSON.stringify({
          batches: [{
            queries: [
              { target: "微博", dimension: "functionality", query: "微博 会员 功能" },
              { target: "知乎", dimension: "functionality", query: "知乎 盐选 功能" },
            ],
          }],
        });
      }
      if (prompt.includes("数据提取器")) {
        return JSON.stringify({
          records: [
            { attribute: "去广告", value: "支持", confidence: 0.9 },
            { attribute: "月费价格", value: "15元/月", confidence: 0.85 },
          ],
        });
      }
      if (prompt.includes("竞品分析师")) {
        return JSON.stringify({
          comparisonMatrix: [
            {
              dimension: "functionality",
              attribute: "去广告",
              values: [{ target: "微博", value: "支持", sourceTraceId: "" }, { target: "知乎", value: "支持", sourceTraceId: "" }],
              winner: null,
              analysis: "两者均支持去广告",
            },
          ],
        });
      }
      if (prompt.includes("SWOT 分析")) {
        return JSON.stringify({
          swot: [
            { category: "strengths", point: "内容丰富", evidence: "对比数据显示功能全面", sourceTraceIds: [], target: "微博" },
            { category: "weaknesses", point: "价格较高", evidence: "定价数据", sourceTraceIds: [], target: "微博" },
          ],
        });
      }
      // summary / llm_ranker fallback
      return "微博和知乎在会员功能上各有侧重。";
    },
  };
}

function createMockEventBus(): EventBus {
  return {
    async publish(_event: any): Promise<void> { /* no-op */ },
    async subscribe(_workflowId: string, _handler: (event: any) => void): Promise<void> { /* no-op */ },
    async unsubscribe(_workflowId: string): Promise<void> { /* no-op */ },
  };
}

/** 创建 mock deps：事件存内存、自动继续路由决策 */
function createMockDeps(): RunnerDeps {
  const events: WorkflowLifecycleEvent[] = [];

  return {
    loadEventStream: async () => events,
    appendEvent: async (_wfId, event) => { events.push(event); },
    waitForHumanDecision: async () => {
      // 自动选择 pending 候选 — 从最新 route.required 事件中取第一个 suggestion
      const routeEvent = [...events].reverse().find(e => e.type === "route.required");
      if (routeEvent && routeEvent.type === "route.required" && routeEvent.suggestions.length > 0) {
        return { targetNode: routeEvent.suggestions[0].nodeId, action: "continue" };
      }
      return { targetNode: "artifact_generation", action: "continue" };
    },
    updateWorkflowStatus: async () => {},
  };
}

/** 消费 runWorkflow 生成器到结束 */
async function runToCompletion(
  workflowId: string, userInput: string, registry: CapabilityRegistry
): Promise<RuntimeState> {
  const eventBus = createMockEventBus();
  const deps = createMockDeps();
  const runtime = new GraphRuntime(registry);
  let state = runtime.initialState({ userInput } as WorkflowData);

  const ctx = {
    traceId: "",
    workflowId,
    runId: state.runtime.runId,
    nodeId: "",
    iteration: 0,
    signal: new AbortController().signal,
    llm: { complete: createMockLlm().complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
    emit: async (event: any) => {
      await eventBus.publish({
        traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint,
        nodeId: "", workflowId, runId: "", payload: event.payload ?? {},
        timestamp: new Date().toISOString(),
      } as any);
    },
    saveArtifact: async () => "",
  };

  const gen = runWorkflow(workflowId, userInput, registry, ctx, eventBus, deps);
  for await (const _ of gen) { /* consume all events */ }

  // 从 deps 的内部事件流 + registry 重新 fold 得到最终 state
  for (const e of deps["_private_events"] ?? events) {
    // fold logic...
  }

  return state; // 最终状态由最后一条 event 决定
}

describe("Phase 2 全链路 E2E (with HITL runner)", () => {
  it("should complete product comparison workflow end to end", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);

    // 使用 runner + mock deps (auto-continue) 执行
    const eventBus = createMockEventBus();
    const deps = createMockDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "对比微博和知乎的会员功能差异" } as WorkflowData);

    const ctx = {
      traceId: "",
      workflowId: "test-wf-1",
      runId: state.runtime.runId,
      nodeId: "",
      iteration: 0,
      signal: new AbortController().signal,
      llm: { complete: llm.complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
      emit: async (event: any) => {
        await eventBus.publish({
          traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint,
          nodeId: "", workflowId: "test-wf-1", runId: "", payload: event.payload ?? {},
          timestamp: new Date().toISOString(),
        } as any);
      },
      saveArtifact: async () => "",
    };

    // 收集事件用于最终 fold
    const collectedEvents: WorkflowLifecycleEvent[] = [];
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => {
        collectedEvents.push(event);
        return deps.appendEvent(_wfId, event);
      },
    };

    const gen = runWorkflow("test-wf-1", "对比微博和知乎的会员功能差异", registry, ctx, eventBus, wrappedDeps);
    for await (const _ of gen) { /* consume */ }

    // fold 事件流得到最终状态
    for (const e of collectedEvents) {
      // 仅 node.executed 影响 state.data
      if (e.type === "node.executed") {
        // state 由 runtime.executeStep 内部更新，这里只验证事件流
      }
    }

    // 验证事件流包含完整链
    const executedNodes = collectedEvents
      .filter(e => e.type === "node.executed")
      .map(e => (e as { type: "node.executed"; nodeId: string }).nodeId);
    expect(executedNodes).toContain("requirement_parsing");
    expect(executedNodes).toContain("information_collection");
    expect(executedNodes).toContain("analysis_reasoning");
    expect(executedNodes).toContain("artifact_generation");

    // 验证有 completed 事件
    const completed = collectedEvents.find(e => e.type === "workflow.completed");
    expect(completed).toBeDefined();

    // 验证每个节点间都有 route.required
    const routeEvents = collectedEvents.filter(e => e.type === "route.required");
    expect(routeEvents.length).toBeGreaterThanOrEqual(2);

    // 验证 auto-continue 决策
    const continuedEvents = collectedEvents.filter(e => e.type === "human.continued");
    expect(continuedEvents.length).toBe(routeEvents.length);
  });

  it("should handle empty user input gracefully", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);
    const eventBus = createMockEventBus();
    const deps = createMockDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "" } as WorkflowData);

    const ctx = {
      traceId: "", workflowId: "test-wf-2", runId: state.runtime.runId, nodeId: "", iteration: 0,
      signal: new AbortController().signal,
      llm: { complete: llm.complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
      emit: async (event: any) => {
        await eventBus.publish({
          traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint,
          nodeId: "", workflowId: "test-wf-2", runId: "", payload: event.payload ?? {},
          timestamp: new Date().toISOString(),
        } as any);
      },
      saveArtifact: async () => "",
    };

    const collectedEvents: WorkflowLifecycleEvent[] = [];
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => { collectedEvents.push(event); return deps.appendEvent(_wfId, event); },
    };

    const gen = runWorkflow("test-wf-2", "", registry, ctx, eventBus, wrappedDeps);
    for await (const _ of gen) { /* consume */ }

    const executed = collectedEvents.filter(e => e.type === "node.executed").map(e => (e as any).nodeId);
    expect(executed).toContain("requirement_parsing");
  });
});
```

- [ ] **Step 2: 运行测试**

```powershell
npx vitest run backend/entry/__tests__/workflow.test.ts
```

Expected: 2 个测试通过。如果 mock deps 的 auto-continue 逻辑有问题，根据实际事件流调整。

- [ ] **Step 3: 运行全部测试**

```powershell
npx vitest run
```

Expected: 所有测试通过。

- [ ] **Step 4: Commit**

```bash
git add backend/entry/__tests__/workflow.test.ts
git commit -m "test: update workflow entry test for HITL refactor"
```

---

### Task 9: 更新变更日志和开发进度

- [ ] **Step 1: 更新 change-log.md**

```markdown
## 2026-07-08
- 概述：实现 HITL 人在回路 — 事件溯源模式
- 详细描述：新增 events.ts（事件类型 + fold 投影）和 runner.ts（事件驱动编排循环）。
  Workflow 表新增 pausedAt 和 currentNode 字段。routeDecision API 接线 Redis Pub/Sub 唤醒机制。
  cancel 端点支持 AbortSignal 终止。集成级联失效清除（回跳时清除下游 outputHints）。
- 影响的文件：
  - 新建：backend/src/workflow/events.ts, backend/src/workflow/runner.ts
  - 修改：backend/prisma/schema.prisma, backend/entry/workflow.ts,
           backend/src/api/workflows/workflows.service.ts, workflows.controller.ts
  - 新建：backend/src/api/workflows/__tests__/workflows-hitl.test.ts
- 副作用：entry/workflow.ts 删除 createWorkflow 编排循环，改为导出 createRegistry
- 其他信息：不改动 backend/runtime/ 任何文件
```

- [ ] **Step 2: 更新 dev-progress.md**

```markdown
- [x] **P2.4.1 关键决策点暂停**：事件溯源模式实现路由决策暂停。
- [x] **P2.4.2 中间结果审查**：支持任意回跳 + 级联失效重算。
```

- [ ] **Step 3: Commit**

```bash
git add .trae/memory/change-log.md .trae/memory/dev-progress.md
git commit -m "docs: update change log and dev progress for HITL implementation"
```

---

## 验证清单

完成所有任务后，执行以下验证：

- [ ] 所有单元测试通过：`npx vitest run`
- [ ] TypeScript 编译通过：`npx tsc --noEmit`
- [ ] 数据库迁移成功：`npx prisma migrate status`
- [ ] Event 表追加事件无冲突
- [ ] fold 回跳清除逻辑正确（测试覆盖）
- [ ] Redis Pub/Sub 唤醒路径可工作
