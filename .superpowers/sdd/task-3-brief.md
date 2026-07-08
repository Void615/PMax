# Task 3: Redis 配置

## 任务描述

配置 Redis 服务，实现 RedisService 和 RedisModule。

## 文件操作

- Create: `backend/src/infra/redis/redis.module.ts`
- Create: `backend/src/infra/redis/redis.service.ts`

## 接口

- 无前置依赖

## 步骤

- [ ] **Step 1: 创建 RedisService**

```typescript
// backend/src/infra/redis/redis.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClientType;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async xadd(key: string, id: string, ...args: string[]) {
    return this.client.xAdd(key, id, args.reduce((acc, val, idx) => {
      if (idx % 2 === 0) {
        acc[val] = args[idx + 1];
      }
      return acc;
    }, {} as Record<string, string>));
  }

  async publish(channel: string, message: string) {
    return this.client.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void) {
    const subscriber = this.client.duplicate();
    await subscriber.connect();
    await subscriber.subscribe(channel, callback);
    return subscriber;
  }
}
```

- [ ] **Step 2: 创建 RedisModule**

```typescript
// backend/src/infra/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/infra/redis/
git commit -m "feat: add Redis service configuration"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- RedisService 必须实现 OnModuleDestroy 生命周期钩子
- RedisModule 必须使用 @Global() 装饰器，以便全局注入
- Redis 连接 URL 从环境变量 REDIS_URL 读取，默认值为 redis://localhost:6379
- 必须提供 xadd、publish、subscribe 方法供事件总线使用
