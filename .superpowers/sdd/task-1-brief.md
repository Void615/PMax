# Task 1: 项目初始化和依赖安装

## 任务描述

初始化 NestJS 项目，安装所有必要的依赖，创建项目配置文件。

## 文件操作

- Modify: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/nest-cli.json`

## 接口

- 无前置依赖

## 步骤

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

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- 所有 API 端点返回统一响应格式
- 密码必须使用 bcrypt 加密存储
- JWT Token 24 小时过期
- 所有需要认证的端点必须通过 JwtAuthGuard 保护
