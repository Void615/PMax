# Task 7: 工作流模块实现

## 任务描述

实现工作流模块，包括创建、查询、SSE 流、路由决策、历史回放、产物获取。

## 文件操作

- Create: `backend/src/api/workflows/workflows.service.ts`
- Create: `backend/src/api/workflows/workflows.controller.ts`
- Create: `backend/src/api/workflows/workflows.module.ts`
- Create: `backend/test/workflows/workflows.service.spec.ts`

## 接口

- Consumes: PrismaService (from Task 2), EventsService (from Task 6), Runtime 引擎 (现有)
- Produces: WorkflowsService (供前端调用)

## 步骤

- [ ] **Step 1: 创建 WorkflowsService**

```typescript
// backend/src/api/workflows/workflows.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { EventsService } from '../events/events.service';
import { GraphRuntime, CapabilityRegistry } from '../../core/runtime';
import { createWorkflow } from '../../core/entry/workflow';

@Injectable()
export class WorkflowsService {
  private registry: CapabilityRegistry;

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
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

    // 异步执行工作流
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

  async routeDecision(workflowId: string, nodeId: string) {
    // TODO: 实现路由决策逻辑
    return { workflowId, nodeId, status: 'accepted' };
  }

  private async executeWorkflow(workflowId: string, input: string) {
    try {
      // 更新状态为运行中
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'running' },
      });

      // 创建 Runtime 实例
      const runtime = new GraphRuntime(this.registry);

      // 创建 EventBus 包装器
      const eventBus = {
        publish: async (event: any) => {
          await this.eventsService.publishEvent(workflowId, event);
        },
      };

      // 创建 LLM 客户端（占位）
      const llmClient = {
        complete: async (prompt: string) => 'LLM response placeholder',
      };

      // 执行工作流
      const workflow = createWorkflow(llmClient, eventBus);
      const result = await workflow.run(input);

      // 保存产物
      await this.prisma.artifact.create({
        data: {
          workflowId,
          type: 'analysis_result',
          content: result.data,
        },
      });

      // 更新状态为完成
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'completed' },
      });
    } catch (error) {
      // 更新状态为失败
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'failed' },
      });

      // 发布错误事件
      await this.eventsService.publishEvent(workflowId, {
        eventType: 'workflow_failed',
        nodeId: 'system',
        payload: { error: error.message },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

- [ ] **Step 2: 创建 WorkflowsController**

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
  routeDecision(@Param('id') id: string, @Body() body: { nodeId: string }) {
    return this.workflowsService.routeDecision(id, body.nodeId);
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

- [ ] **Step 3: 创建 WorkflowsModule**

```typescript
// backend/src/api/workflows/workflows.module.ts
import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
```

- [ ] **Step 4: 创建单元测试**

```typescript
// backend/test/workflows/workflows.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowsService } from '../../src/api/workflows/workflows.service';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { EventsService } from '../../src/api/events/events.service';

describe('WorkflowsService', () => {
  let service: WorkflowsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        {
          provide: PrismaService,
          useValue: {
            workflow: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            artifact: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: EventsService,
          useValue: {
            publishEvent: jest.fn(),
            getWorkflowEvents: jest.fn(),
            subscribeToWorkflow: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkflowsService>(WorkflowsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/workflows/ backend/test/workflows/
git commit -m "feat: implement workflows module with runtime integration"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- WorkflowsService 必须调用现有 Runtime 引擎执行工作流
- 事件必须通过 EventsService 发布
- 工作流状态必须正确更新（pending -> running -> completed/failed）
- 错误必须被捕获并记录
