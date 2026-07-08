# Task 4: 用户模块实现

## 任务描述

实现用户模块，包括 DTO、Service、Controller、Module。

## 文件操作

- Create: `backend/src/api/users/dto/create-user.dto.ts`
- Create: `backend/src/api/users/dto/update-user.dto.ts`
- Create: `backend/src/api/users/users.service.ts`
- Create: `backend/src/api/users/users.controller.ts`
- Create: `backend/src/api/users/users.module.ts`
- Create: `backend/test/users/users.service.spec.ts`

## 接口

- Consumes: PrismaService (from Task 2)
- Produces: UsersService (供 Auth 模块使用)

## 步骤

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

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- DTO 必须使用 class-validator 进行验证
- 密码必须使用 bcrypt 加密存储
- UsersService 必须导出，供 Auth 模块使用
- UsersController 必须使用 @Public() 装饰器标记公开端点
