# Phase 2 后端骨架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Phase 2 后端骨架，实现 NestJS + Prisma + PostgreSQL + Redis 技术栈，完成用户认证、工作流管理、事件持久化等核心功能。

**Architecture:** 采用分层架构，API 层（NestJS）调用核心业务层（现有 Runtime 引擎），基础设施层（Prisma + Redis）提供数据持久化和事件传输。全局 JWT 守卫保护所有需要认证的端点。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, Passport.js, JWT, bcrypt

## Global Constraints

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- 所有 API 端点返回统一响应格式
- 密码必须使用 bcrypt 加密存储
- JWT Token 24 小时过期
- 所有需要认证的端点必须通过 JwtAuthGuard 保护

---

## 文件结构概览

```
backend/
├── src/
│   ├── api/
│   │   ├── auth/                    # 认证模块
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── local.strategy.ts
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   └── roles.guard.ts
│   │   │   └── decorators/
│   │   │       ├── current-user.decorator.ts
│   │   │       └── public.decorator.ts
│   │   ├── workflows/               # 工作流模块
│   │   │   ├── workflows.module.ts
│   │   │   ├── workflows.controller.ts
│   │   │   └── workflows.service.ts
│   │   ├── events/                  # 事件模块
│   │   │   ├── events.module.ts
│   │   │   ├── events.controller.ts
│   │   │   └── events.service.ts
│   │   ├── users/                   # 用户模块
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   └── dto/
│   │   │       ├── create-user.dto.ts
│   │   │       └── update-user.dto.ts
│   │   ├── common/                  # 公共模块
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts
│   │   │   ├── interceptors/
│   │   │   │   └── transform.interceptor.ts
│   │   │   └── guards/
│   │   └── app.module.ts            # 根模块
│   ├── core/                        # 核心业务逻辑（现有）
│   │   ├── runtime/
│   │   ├── capabilities/
│   │   └── tools/
│   ├── infra/                       # 基础设施层
│   │   ├── database/
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts
│   │   └── redis/
│   │       ├── redis.module.ts
│   │       └── redis.service.ts
│   └── main.ts                      # NestJS 入口
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/                            # 测试文件
│   ├── auth/
│   ├── workflows/
│   ├── events/
│   └── users/
├── package.json
└── tsconfig.json
```

---

### Task 1: 项目初始化和依赖安装

**Files:**
- Modify: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/nest-cli.json`

**Interfaces:**
- 无前置依赖

- [ ] **Step 1: 更新 package.json 添加所有依赖**

```json
{
  "name": "@pmax/backend",
  "version": "0.2.0",
  "type": "module",
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
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.1",
    "passport-local": "^1.0.0",
    "bcrypt": "^5.1.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/express": "^4.17.17",
    "@types/passport-jwt": "^3.0.8",
    "@types/passport-local": "^1.0.34",
    "@types/bcrypt": "^5.0.0",
    "@types/node": "^26.0.0",
    "typescript": "^5.4.0",
    "prisma": "^5.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2021",
    "lib": ["ES2021"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: 安装依赖**

Run: `cd backend && npm install`

Expected: 所有依赖安装成功

- [ ] **Step 5: 创建 .env 文件**

```env
DATABASE_URL="postgresql://user:password@localhost:5432/pmax"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRATION="24h"
NODE_ENV="development"
PORT=3000
```

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/nest-cli.json backend/.env
git commit -m "chore: initialize NestJS project with dependencies"
```

---

### Task 2: Prisma 配置和数据库模型

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/infra/database/prisma.module.ts`
- Create: `backend/src/infra/database/prisma.service.ts`

**Interfaces:**
- 无前置依赖

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

---

### Task 3: Redis 配置

**Files:**
- Create: `backend/src/infra/redis/redis.module.ts`
- Create: `backend/src/infra/redis/redis.service.ts`

**Interfaces:**
- 无前置依赖

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

---

### Task 4: 用户模块实现

**Files:**
- Create: `backend/src/api/users/dto/create-user.dto.ts`
- Create: `backend/src/api/users/dto/update-user.dto.ts`
- Create: `backend/src/api/users/users.service.ts`
- Create: `backend/src/api/users/users.controller.ts`
- Create: `backend/src/api/users/users.module.ts`
- Create: `backend/test/users/users.service.spec.ts`

**Interfaces:**
- Consumes: PrismaService (from Task 2)
- Produces: UsersService (供 Auth 模块使用)

- [ ] **Step 1: 创建 DTO**

```typescript
// backend/src/api/users/dto/create-user.dto.ts
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;
}
```

```typescript
// backend/src/api/users/dto/update-user.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;
}
```

- [ ] **Step 2: 创建 UsersService**

```typescript
// backend/src/api/users/users.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('邮箱已存在');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findById(id);

    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  async getUserWorkflows(userId: string) {
    await this.findById(userId);

    return this.prisma.workflow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

- [ ] **Step 3: 创建 UsersController**

```typescript
// backend/src/api/users/users.controller.ts
import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Get(':id/workflows')
  getUserWorkflows(@Param('id') id: string) {
    return this.usersService.getUserWorkflows(id);
  }
}
```

- [ ] **Step 4: 创建 UsersModule**

```typescript
// backend/src/api/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: 创建单元测试**

```typescript
// backend/test/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../../src/api/users/users.service';
import { PrismaService } from '../../src/infra/database/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/users/ backend/test/users/
git commit -m "feat: implement users module with CRUD operations"
```

---

### Task 5: 认证模块实现

**Files:**
- Create: `backend/src/api/auth/decorators/public.decorator.ts`
- Create: `backend/src/api/auth/decorators/current-user.decorator.ts`
- Create: `backend/src/api/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/api/auth/strategies/local.strategy.ts`
- Create: `backend/src/api/auth/guards/jwt-auth.guard.ts`
- Create: `backend/src/api/auth/auth.service.ts`
- Create: `backend/src/api/auth/auth.controller.ts`
- Create: `backend/src/api/auth/auth.module.ts`
- Create: `backend/test/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: UsersService (from Task 4)
- Produces: AuthService, JwtAuthGuard (供其他模块使用)

- [ ] **Step 1: 创建装饰器**

```typescript
// backend/src/api/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```typescript
// backend/src/api/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 2: 创建 JWT Strategy**

```typescript
// backend/src/api/auth/strategies/jwt.strategy.ts
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

- [ ] **Step 3: 创建 Local Strategy**

```typescript
// backend/src/api/auth/strategies/local.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return user;
  }
}
```

- [ ] **Step 4: 创建 JwtAuthGuard**

```typescript
// backend/src/api/auth/guards/jwt-auth.guard.ts
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

- [ ] **Step 5: 创建 AuthService**

```typescript
// backend/src/api/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = { sub: user.id, email: user.email };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(createUserDto: any) {
    const user = await this.usersService.create(createUserDto);
    return this.login(user);
  }
}
```

- [ ] **Step 6: 创建 AuthController**

```typescript
// backend/src/api/auth/auth.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CreateUserDto } from '../users/dto/create-user.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new Error('邮箱或密码错误');
    }
    return this.authService.login(user);
  }

  @Public()
  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return user;
  }
}
```

- [ ] **Step 7: 创建 AuthModule**

```typescript
// backend/src/api/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: process.env.JWT_EXPIRATION || '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 8: 创建单元测试**

```typescript
// backend/test/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/api/auth/auth.service';
import { UsersService } from '../../src/api/users/users.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/api/auth/ backend/test/auth/
git commit -m "feat: implement authentication module with JWT"
```

---

### Task 6: 事件模块实现

**Files:**
- Create: `backend/src/api/events/events.service.ts`
- Create: `backend/src/api/events/events.controller.ts`
- Create: `backend/src/api/events/events.module.ts`
- Create: `backend/test/events/events.service.spec.ts`

**Interfaces:**
- Consumes: PrismaService (from Task 2), RedisService (from Task 3)
- Produces: EventsService (供 Workflows 模块使用)

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

---

### Task 7: 工作流模块实现

**Files:**
- Create: `backend/src/api/workflows/workflows.service.ts`
- Create: `backend/src/api/workflows/workflows.controller.ts`
- Create: `backend/src/api/workflows/workflows.module.ts`
- Create: `backend/test/workflows/workflows.service.spec.ts`

**Interfaces:**
- Consumes: PrismaService (from Task 2), EventsService (from Task 6), Runtime 引擎 (现有)
- Produces: WorkflowsService (供前端调用)

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

---

### Task 8: 公共模块和全局配置

**Files:**
- Create: `backend/src/api/common/filters/http-exception.filter.ts`
- Create: `backend/src/api/common/interceptors/transform.interceptor.ts`
- Create: `backend/src/api/app.module.ts`
- Create: `backend/src/main.ts`

**Interfaces:**
- Consumes: 所有模块 (from Tasks 4-7)
- Produces: AppModule, main.ts (应用入口)

- [ ] **Step 1: 创建全局异常过滤器**

```typescript
// backend/src/api/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'string' ? message : (message as any).message,
    });
  }
}
```

- [ ] **Step 2: 创建响应转换拦截器**

```typescript
// backend/src/api/common/interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  code: number;
  message: string;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        data,
        code: 0,
        message: 'success',
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

- [ ] **Step 3: 创建 AppModule**

```typescript
// backend/src/api/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../infra/database/prisma.module';
import { RedisModule } from '../infra/redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { EventsModule } from './events/events.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WorkflowsModule,
    EventsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: 创建 main.ts**

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './api/app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用 CORS
  app.enableCors();

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/common/ backend/src/api/app.module.ts backend/src/main.ts
git commit -m "feat: add global filters, interceptors, and app module"
```

---

### Task 9: 集成测试

**Files:**
- Create: `backend/test/app.e2e-spec.ts`
- Create: `backend/vitest.config.e2e.ts`

**Interfaces:**
- Consumes: AppModule (from Task 8)

- [ ] **Step 1: 创建 E2E 测试配置**

```typescript
// backend/vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 2: 创建测试设置文件**

```typescript
// backend/test/setup.ts
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.test') });
```

- [ ] **Step 3: 创建 E2E 测试**

```typescript
// backend/test/app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/api/app.module';

describe('AppController (e2e)', () => {
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

  describe('Auth', () => {
    it('/POST auth/register', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
        })
        .expect(201);
    });

    it('/POST auth/login', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);
    });
  });

  describe('Workflows', () => {
    let authToken: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });
      authToken = response.body.data.access_token;
    });

    it('/POST workflows', () => {
      return request(app.getHttpServer())
        .post('/api/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ input: '分析竞品' })
        .expect(201);
    });
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add backend/test/ backend/vitest.config.e2e.ts
git commit -m "test: add integration tests for auth and workflows"
```

---

### Task 10: 文档更新

**Files:**
- Modify: `backend/README.md`
- Modify: `.trae/memory/dev-progress.md`
- Modify: `.trae/memory/change-log.md`

**Interfaces:**
- 无前置依赖

- [ ] **Step 1: 更新 README.md**

在 backend/README.md 中添加：

```markdown
## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL
- Redis

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure your environment variables.

### Database Setup

```bash
npx prisma migrate dev
npx prisma generate
```

### Running the App

```bash
# development
npm run dev

# production
npm run build
npm run start:prod
```

### Testing

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Get current user profile

### Users

- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user
- `GET /api/users/:id/workflows` - Get user's workflows

### Workflows

- `POST /api/workflows` - Create new workflow
- `GET /api/workflows/:id` - Get workflow details
- `SSE /api/workflows/:id/stream` - Stream workflow events
- `POST /api/workflows/:id/route` - Route decision
- `GET /api/workflows/:id/history` - Get workflow history
- `GET /api/workflows/:id/artifacts` - Get workflow artifacts

### Events

- `GET /api/events/:workflowId` - Get workflow events
- `SSE /api/events/:workflowId/stream` - Stream workflow events
```

- [ ] **Step 2: 更新开发进度**

在 `.trae/memory/dev-progress.md` 中更新 Phase 2 进度。

- [ ] **Step 3: 更新变更日志**

在 `.trae/memory/change-log.md` 中添加本次变更记录。

- [ ] **Step 4: Commit**

```bash
git add backend/README.md .trae/memory/
git commit -m "docs: update documentation for Phase 2 backend skeleton"
```

---

## 验证清单

完成所有任务后，执行以下验证：

- [ ] 所有单元测试通过：`npm run test`
- [ ] 所有 E2E 测试通过：`npm run test:e2e`
- [ ] 应用可以正常启动：`npm run dev`
- [ ] 数据库迁移成功：`npx prisma migrate status`
- [ ] API 端点可以正常访问
- [ ] JWT 认证正常工作
- [ ] 事件持久化正常工作
- [ ] SSE 流正常工作
