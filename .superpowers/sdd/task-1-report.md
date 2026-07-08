# Task 1 Report: 项目初始化和依赖安装

## 实施内容

按照 task-1-brief.md 完成 NestJS 项目的初始化和依赖安装。

### Step 1: 更新 package.json

将 `backend/package.json` 从仅有 vitest 的最小配置升级为完整的 NestJS 项目配置：

- **name**: `@pmax/backend`
- **type**: `module`（ESM）
- **scripts**: dev/build/start/test/test:e2e/prisma:generate/prisma:migrate/prisma:studio
- **dependencies**: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/passport, @nestjs/jwt, @prisma/client, passport, passport-jwt, passport-local, bcrypt, reflect-metadata, rxjs
- **devDependencies**: @nestjs/cli, @nestjs/schematics, @types/express, @types/passport-jwt, @types/passport-local, @types/bcrypt, @types/node, typescript, prisma, vitest

### Step 2: 创建 tsconfig.json

- target: ES2021, module: ESNext, moduleResolution: bundler
- strict: true, esModuleInterop: true
- outDir: ./dist, rootDir: ./src
- paths: `@/*` → `src/*`

### Step 3: 创建 nest-cli.json

- sourceRoot: src
- compilerOptions.deleteOutDir: true

### Step 4: 安装依赖

`npm install` 成功完成，424 packages installed。关键版本：
- NestJS: 10.4.22
- Prisma Client: 5.22.0
- Passport: 0.6.0
- Vitest: 4.1.10

存在一些已知的 deprecation warnings（inflight, npmlog, rimraf@3 等），均来自 NestJS v10 的传递依赖，不影响功能。

### Step 5: 更新 .env 配置

- **未覆盖** 现有 `backend/.env`（含真实凭据），仅追加了 `NODE_ENV` 和 `PORT` 变量
- 更新 `backend/.env.example` 增加 `JWT_SECRET`、`JWT_EXPIRATION`、`NODE_ENV`、`PORT` 变量
- **注意**：task brief 要求 commit .env，但项目规则明确禁止提交 .env，已遵循安全最佳实践排除 .env

### Step 6: 提交

- 分支: `feat/p2-backend-scaffold`（已存在，非 main）
- Commit: `79517b9` — `chore: initialize NestJS project with dependencies`
- 暂存文件: backend/package.json, backend/package-lock.json, backend/tsconfig.json, backend/nest-cli.json, backend/.env.example
- **未提交** .env（安全考虑）

## 测试

本 Task 为项目初始化任务，无业务逻辑代码，不涉及测试编写。依赖安装已通过 `npm install` 成功验证（exit code 0，424 packages），关键包版本已确认正确。

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| backend/package.json | 修改 | 升级为完整 NestJS 项目配置 |
| backend/package-lock.json | 创建 | npm install 自动生成 |
| backend/tsconfig.json | 创建 | TypeScript 编译配置 |
| backend/nest-cli.json | 创建 | NestJS CLI 配置 |
| backend/.env.example | 修改 | 增加 JWT_SECRET/JWT_EXPIRATION/NODE_ENV/PORT |
| backend/.env | 修改 | 追加 NODE_ENV/PORT（未提交） |

## 自审发现

1. **.env 安全处理**：task brief 指定 `git add backend/.env`，但这违反了项目 `.gitignore` 规则和 AGENTS.md 中"永远不要提交到 repo"的安全约束。已正确排除 .env。
2. **deprecation warnings**：npm install 产生的 5 个 deprecation warning 均来自 NestJS v10 生态的传递依赖（inflight, npmlog, rimraf@3, glob@7, are-we-there-yet, gauge），这是 NestJS 10.x 已知问题，预计 NestJS 11 将解决。当前不影响功能。
3. **安全漏洞**：npm audit 报告 22 个 vulnerability（3 low, 11 moderate, 8 high），同样来自传递依赖。建议后续通过 `npm audit fix` 处理，但不阻塞当前任务。
