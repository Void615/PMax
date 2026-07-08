# Task 2: Prisma 配置和数据库模型

## 任务描述

配置 Prisma ORM，创建数据库模型，实现 PrismaService 和 PrismaModule。

## 文件操作

- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/infra/database/prisma.module.ts`
- Create: `backend/src/infra/database/prisma.service.ts`

## 接口

- 无前置依赖

## 步骤

- [ ] **Step 1: 创建 Prisma Schema**

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String
  name          String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  workflows     Workflow[]
}

model Workflow {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  name          String
  status        String    @default("pending")
  input         Json?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  events        Event[]
  artifacts     Artifact[]
}

model Event {
  id            String    @id @default(cuid())
  workflowId    String
  workflow      Workflow  @relation(fields: [workflowId], references: [id])
  eventType     String
  nodeId        String
  payload       Json
  timestamp     DateTime  @default(now())
}

model Artifact {
  id            String    @id @default(cuid())
  workflowId    String
  workflow      Workflow  @relation(fields: [workflowId], references: [id])
  type          String
  content       Json
  createdAt     DateTime  @default(now())
}
```

- [ ] **Step 2: 创建 PrismaService**

```typescript
// backend/src/infra/database/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 3: 创建 PrismaModule**

```typescript
// backend/src/infra/database/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 4: 生成 Prisma Client**

Run: `cd backend && npx prisma generate`

Expected: Prisma Client 生成成功

- [ ] **Step 5: 创建数据库迁移**

Run: `cd backend && npx prisma migrate dev --name init`

Expected: 迁移文件创建成功，数据库表创建成功

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/ backend/src/infra/database/
git commit -m "feat: add Prisma schema and database configuration"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- PrismaService 必须实现 OnModuleInit 和 OnModuleDestroy 生命周期钩子
- PrismaModule 必须使用 @Global() 装饰器，以便全局注入
- 数据库模型必须包含 User、Workflow、Event、Artifact 四个表
- 所有表必须包含 id、createdAt、updatedAt 字段
