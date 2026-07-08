# Phase 2 后端骨架技术选型设计

> 最后更新：2026-07-07

## 一、技术栈选型

### 最终技术栈

| 组件 | 技术选择 | 版本/说明 |
|------|----------|-----------|
| **Web 框架** | NestJS | 基于 Express，提供完整架构 |
| **ORM** | Prisma | 类型安全，迁移方便 |
| **数据库** | PostgreSQL | 结构化查询，事件持久化 |
| **事件总线** | Redis | 已有 RedisEventBus |
| **测试** | vitest | 已有配置 |
| **语言** | TypeScript | 已有 |

### 选型理由

1. **NestJS**：提供完整的架构模式（模块、控制器、服务、守卫、拦截器），依赖注入系统便于测试和解耦，TypeScript 原生支持。
2. **Prisma**：类型安全，迁移方便，生态成熟，与 TypeScript 项目完美契合。
3. **PostgreSQL**：适合结构化查询和历史回放，支持复杂查询和事务。
4. **Redis**：已有 RedisEventBus 实现，继续使用保持一致性。

## 二、项目结构调整

### 目录结构

```
backend/
├── src/
│   ├── api/                    # NestJS API 层（新增）
│   │   ├── workflows/          # 工作流模块
│   │   │   ├── workflows.controller.ts
│   │   │   ├── workflows.service.ts
│   │   │   └── workflows.module.ts
│   │   ├── events/             # 事件模块（SSE、历史查询）
│   │   │   ├── events.controller.ts
│   │   │   ├── events.service.ts
│   │   │   └── events.module.ts
│   │   ├── users/              # 用户模块
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.module.ts
│   │   │   └── dto/            # 数据传输对象
│   │   ├── common/             # 公共模块
│   │   │   ├── filters/        # 异常过滤器
│   │   │   ├── interceptors/   # 拦截器
│   │   │   └── guards/         # 守卫
│   │   └── app.module.ts       # 根模块
│   ├── core/                   # 核心业务逻辑（现有代码整合）
│   │   ├── runtime/            # Runtime 引擎（现有）
│   │   ├── capabilities/       # Capability 实现（现有）
│   │   └── tools/              # 工具实现（现有）
│   ├── infra/                  # 基础设施层
│   │   ├── database/           # Prisma 配置
│   │   │   ├── prisma.service.ts
│   │   │   └── schema.prisma
│   │   └── redis/              # Redis 配置
│   └── main.ts                 # NestJS 入口
├── prisma/                     # Prisma 迁移文件
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── package.json
└── tsconfig.json
```

### 与现有代码的集成方式

1. **Runtime 引擎**：保持不变，作为 `core/runtime/` 模块
2. **Capability 和 Tools**：保持不变，作为 `core/capabilities/` 和 `core/tools/`
3. **API 层**：新增 NestJS 模块，调用现有 Runtime 引擎
4. **事件持久化**：在现有 RedisEventBus 基础上，添加 Prisma 持久化逻辑

## 三、用户认证与授权

### 认证方案

采用 **JWT（JSON Web Token）** 认证方案，使用 NestJS 官方推荐的 Passport.js 集成。

**选择 JWT 的理由**：
1. 无状态，适合分布式系统
2. 性能好，无需每次请求查询数据库
3. 易于实现和测试
4. NestJS 生态支持完善

### 认证流程

```
1. 用户登录/注册 → 服务器验证凭据
2. 服务器生成 JWT Token → 返回给客户端
3. 客户端存储 Token（localStorage/cookie）
4. 后续请求携带 Token（Authorization: Bearer <token>）
5. 服务器验证 Token → 解析用户信息
6. 路由守卫检查权限 → 允许/拒绝访问
```

### 实现方案

#### 1. 依赖安装

```json
{
  "dependencies": {
    "@nestjs/passport": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.1",
    "passport-local": "^1.0.0",
    "bcrypt": "^5.1.0"
  },
  "devDependencies": {
    "@types/passport-jwt": "^3.0.8",
    "@types/passport-local": "^1.0.34",
    "@types/bcrypt": "^5.0.0"
  }
}
```

#### 2. 认证模块结构

```
src/api/auth/
├── auth.module.ts           # 认证模块
├── auth.controller.ts       # 认证控制器（登录、注册）
├── auth.service.ts          # 认证服务
├── strategies/
│   ├── jwt.strategy.ts      # JWT 策略
│   └── local.strategy.ts    # 本地策略（用户名密码）
├── guards/
│   ├── jwt-auth.guard.ts    # JWT 认证守卫
│   └── roles.guard.ts       # 角色授权守卫（可选）
└── decorators/
    ├── current-user.decorator.ts  # 获取当前用户装饰器
    └── public.decorator.ts        # 公开端点装饰器
```

#### 3. JWT 策略实现

```typescript
// src/api/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    return user;
  }
}
```

#### 4. JWT 认证守卫

```typescript
// src/api/auth/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 检查是否为公开端点
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('请先登录');
    }
    return user;
  }
}
```

#### 5. 公开端点装饰器

```typescript
// src/api/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

#### 6. 获取当前用户装饰器

```typescript
// src/api/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

### 路由守卫配置

#### 全局守卫注册

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // 全局注册 JWT 守卫
    },
  ],
})
export class AppModule {}
```

#### 端点访问控制

```typescript
// 需要认证的端点（默认）
@Get('profile')
getProfile(@CurrentUser() user: User) {
  return user;
}

// 公开端点（无需认证）
@Public()
@Post('login')
login(@Body() loginDto: LoginDto) {
  return this.authService.login(loginDto);
}

// 公开端点（无需认证）
@Public()
@Post('register')
register(@Body() registerDto: RegisterDto) {
  return this.authService.register(registerDto);
}
```

### API 端点访问控制矩阵

| 端点 | 方法 | 认证要求 | 说明 |
|------|------|----------|------|
| `/api/auth/login` | POST | 公开 | 用户登录 |
| `/api/auth/register` | POST | 公开 | 用户注册 |
| `/api/users/:id` | GET | 认证 | 获取用户信息 |
| `/api/users/:id/workflows` | GET | 认证 | 获取用户工作流列表 |
| `/api/workflows` | POST | 认证 | 创建新工作流 |
| `/api/workflows/:id` | GET | 认证 | 获取工作流详情 |
| `/api/workflows/:id/stream` | GET | 认证 | SSE 实时事件流 |
| `/api/workflows/:id/route` | POST | 认证 | 路由决策 |
| `/api/workflows/:id/history` | GET | 认证 | 事件历史回放 |
| `/api/workflows/:id/artifacts` | GET | 认证 | 获取产物列表 |
| `/api/events/:workflowId` | GET | 认证 | 获取工作流事件 |

### 环境变量配置

```env
# .env
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRATION="24h"  # Token 过期时间
```

### 安全考虑

1. **密码加密**：使用 bcrypt 加密存储密码
2. **Token 过期**：JWT Token 设置 24 小时过期
3. **HTTPS**：生产环境必须使用 HTTPS
4. **CORS**：配置适当的 CORS 策略
5. **Rate Limiting**：登录接口添加速率限制（防止暴力破解）

## 四、API 端点设计

### 工作流模块 (`/api/workflows`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workflows` | POST | 创建新工作流 |
| `/api/workflows/:id` | GET | 获取工作流详情 |
| `/api/workflows/:id/stream` | GET | SSE 实时事件流 |
| `/api/workflows/:id/route` | POST | 路由决策（人工选择） |
| `/api/workflows/:id/history` | GET | 事件历史回放 |
| `/api/workflows/:id/artifacts` | GET | 获取产物列表 |

### 用户模块 (`/api/users`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/users` | POST | 创建用户 |
| `/api/users/:id` | GET | 获取用户信息 |
| `/api/users/:id/workflows` | GET | 获取用户的工作流列表 |

### 事件模块 (`/api/events`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/events/:workflowId` | GET | 获取工作流的所有事件 |
| `/api/events/:workflowId/stream` | GET | SSE 实时事件流（备用） |

## 五、数据库设计

### Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  workflows Workflow[]
}

model Workflow {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  name        String
  status      String   @default("pending")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  events      Event[]
  artifacts   Artifact[]
}

model Event {
  id          String   @id @default(cuid())
  workflowId  String
  workflow    Workflow @relation(fields: [workflowId], references: [id])
  eventType   String
  nodeId      String
  payload     Json
  timestamp   DateTime @default(now())
}

model Artifact {
  id          String   @id @default(cuid())
  workflowId  String
  workflow    Workflow @relation(fields: [workflowId], references: [id])
  type        String
  content     Json
  createdAt   DateTime @default(now())
}
```

### 数据库迁移策略

**开发环境**：
- 应用启动时自动检测并应用待执行的迁移
- 通过 NestJS 生命周期钩子实现

**生产环境**：
- 部署时手动执行迁移（更安全）
- 或通过 CI/CD 流水线自动执行

**迁移命令**：
```bash
# 开发环境：创建迁移
npx prisma migrate dev --name add_workflow_table

# 生产环境：应用迁移
npx prisma migrate deploy

# 查看迁移状态
npx prisma migrate status
```

## 六、错误处理与兜底策略

### 全局异常过滤器

```typescript
// src/api/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : 500;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: exception instanceof Error ? exception.message : 'Internal server error',
    });
  }
}
```

### Runtime 引擎错误处理

- **统一异常拦截**：Orchestrator 降级链验证
- **节点级错误恢复**：CapabilityExecutor 默认集成重试机制
- **超时处理**：默认 maxAttempts=3, timeoutSec=300, backoffBaseSec=2

## 七、事件持久化方案

### 事件持久化服务

```typescript
// src/api/events/events.service.ts
@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async persistEvent(workflowId: string, event: WorkflowEvent) {
    await this.prisma.event.create({
      data: {
        workflowId,
        eventType: event.eventType,
        nodeId: event.nodeId,
        payload: event.payload,
        timestamp: new Date(event.timestamp),
      },
    });
  }

  async getWorkflowHistory(workflowId: string) {
    return this.prisma.event.findMany({
      where: { workflowId },
      orderBy: { timestamp: 'asc' },
    });
  }
}
```

### 与现有 RedisEventBus 集成

```typescript
// src/infra/redis/redis-event-bus.service.ts
@Injectable()
export class RedisEventBusService implements EventBus {
  constructor(
    private redis: Redis,
    private eventsService: EventsService,
  ) {}

  async publish(event: WorkflowEvent, opts?: { persist?: boolean }) {
    // 同步写 Redis
    await this.redis.xadd(`events:${event.workflowId}:${event.runId}`, '*', 'data', JSON.stringify(event));
    await this.redis.publish(`sse:${event.workflowId}`, JSON.stringify(event));

    // 异步持久化到数据库
    if (opts?.persist !== false) {
      await this.eventsService.persistEvent(event.workflowId, event);
    }
  }
}
```

## 八、依赖和配置

### 新增依赖

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/express": "^4.17.17",
    "prisma": "^5.0.0"
  }
}
```

### 环境变量配置

```env
# .env
DATABASE_URL="postgresql://user:password@localhost:5432/pmax"
REDIS_URL="redis://localhost:6379"
NODE_ENV="development"
PORT=3000
```

### 启动脚本

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "start:prod": "node dist/main",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.config.e2e.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

## 九、测试策略

### 单元测试

```typescript
// src/api/workflows/workflows.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowsService } from './workflows.service';

describe('WorkflowsService', () => {
  let service: WorkflowsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowsService],
    }).compile();

    service = module.get<WorkflowsService>(WorkflowsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### 集成测试

```typescript
// test/workflows.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('WorkflowsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/POST workflows', () => {
    return request(app.getHttpServer())
      .post('/api/workflows')
      .send({ input: '分析竞品' })
      .expect(201);
  });
});
```

## 十、部署策略

### 开发环境

1. 启动 PostgreSQL 和 Redis 服务
2. 运行 `npm run prisma:migrate` 应用迁移
3. 运行 `npm run dev` 启动应用

### 生产环境

1. 运行 `npm run build` 构建
2. 运行 `npm run prisma:migrate deploy` 应用迁移
3. 运行 `npm run start:prod` 启动应用

## 十一、与现有 Runtime 引擎的集成

### WorkflowsService 集成示例

```typescript
// src/api/workflows/workflows.service.ts
import { Injectable } from '@nestjs/common';
import { GraphRuntime, Orchestrator, CapabilityRegistry } from '../../core/runtime';
import { createWorkflow } from '../../core/entry/workflow';

@Injectable()
export class WorkflowsService {
  private runtime: GraphRuntime;
  private registry: CapabilityRegistry;

  constructor() {
    // 初始化 Runtime 引擎
    this.registry = new CapabilityRegistry();
    this.runtime = new GraphRuntime(this.registry);
  }

  async createWorkflow(userId: string, input: string) {
    // 创建工作流记录
    const workflow = await this.prisma.workflow.create({
      data: { userId, name: input.substring(0, 50) }
    });

    // 启动异步执行
    this.executeWorkflow(workflow.id, input);

    return workflow;
  }

  private async executeWorkflow(workflowId: string, input: string) {
    // 调用现有 Runtime 引擎
    const workflow = createWorkflow(llmClient, eventBus);
    const result = await workflow.run(input);

    // 持久化事件和产物
    await this.persistEvents(workflowId, result);
  }
}
```

## 十二、总结

本设计文档定义了 Phase 2 后端骨架的技术选型和架构设计，包括：

1. **技术栈**：NestJS + Prisma + PostgreSQL + Redis
2. **项目结构**：分层架构，API 层调用现有 Runtime 引擎
3. **API 端点**：工作流、用户、事件三个模块
4. **数据库设计**：Prisma Schema 和自动迁移策略
5. **错误处理**：全局异常过滤器和 Runtime 引擎错误处理
6. **事件持久化**：Redis 事件总线 + Prisma 持久化
7. **测试策略**：单元测试和集成测试
8. **部署策略**：开发和生产环境配置

该设计保持了与现有 Runtime 引擎的兼容性，同时提供了完整的后端骨架，支持 Phase 2 的产品横向对比功能。
