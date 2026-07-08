# Task 6: 事件模块实现

## 任务描述

实现事件模块，包括事件持久化、Redis 发布/订阅、SSE 流。

## 文件操作

- Create: `backend/src/api/events/events.service.ts`
- Create: `backend/src/api/events/events.controller.ts`
- Create: `backend/src/api/events/events.module.ts`
- Create: `backend/test/events/events.service.spec.ts`

## 接口

- Consumes: PrismaService (from Task 2), RedisService (from Task 3)
- Produces: EventsService (供 Workflows 模块使用)

## 步骤

- [ ] **Step 1: 创建 EventsService**

```typescript
// backend/src/api/events/events.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async persistEvent(workflowId: string, event: any) {
    return this.prisma.event.create({
      data: {
        workflowId,
        eventType: event.eventType,
        nodeId: event.nodeId,
        payload: event.payload,
        timestamp: new Date(event.timestamp),
      },
    });
  }

  async getWorkflowEvents(workflowId: string) {
    return this.prisma.event.findMany({
      where: { workflowId },
      orderBy: { timestamp: 'asc' },
    });
  }

  async publishEvent(workflowId: string, event: any) {
    // 持久化到数据库
    await this.persistEvent(workflowId, event);

    // 发布到 Redis
    await this.redis.publish(`sse:${workflowId}`, JSON.stringify(event));

    return event;
  }

  async subscribeToWorkflow(workflowId: string, callback: (event: any) => void) {
    return this.redis.subscribe(`sse:${workflowId}`, (message) => {
      callback(JSON.parse(message));
    });
  }
}
```

- [ ] **Step 2: 创建 EventsController**

```typescript
// backend/src/api/events/events.controller.ts
import { Controller, Get, Param, Sse } from '@nestjs/common';
import { EventsService } from './events.service';
import { Observable } from 'rxjs';

@Controller('api/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':workflowId')
  getWorkflowEvents(@Param('workflowId') workflowId: string) {
    return this.eventsService.getWorkflowEvents(workflowId);
  }

  @Sse(':workflowId/stream')
  streamWorkflowEvents(@Param('workflowId') workflowId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.eventsService.subscribeToWorkflow(workflowId, (event) => {
        subscriber.next({ data: event } as MessageEvent);
      });
    });
  }
}
```

- [ ] **Step 3: 创建 EventsModule**

```typescript
// backend/src/api/events/events.module.ts
import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
```

- [ ] **Step 4: 创建单元测试**

```typescript
// backend/test/events/events.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../../src/api/events/events.service';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { RedisService } from '../../src/infra/redis/redis.service';

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: PrismaService,
          useValue: {
            event: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            publish: jest.fn(),
            subscribe: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/events/ backend/test/events/
git commit -m "feat: implement events module with persistence and SSE"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- EventsService 必须导出，供 Workflows 模块使用
- 事件必须同时持久化到数据库和发布到 Redis
- SSE 流必须使用 @Sse() 装饰器
