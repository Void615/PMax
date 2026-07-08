# Task 9: 集成测试

## 任务描述

创建 E2E 测试配置和集成测试。

## 文件操作

- Create: `backend/test/app.e2e-spec.ts`
- Create: `backend/vitest.config.e2e.ts`

## 接口

- Consumes: AppModule (from Task 8)

## 步骤

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

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- E2E 测试必须使用 supertest
- 测试必须覆盖认证和工作流的核心流程
- 测试配置必须独立于单元测试配置
