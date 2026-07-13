# PMax 变更日志

## 2026-07-07 15:42
- 概述：新增 Phase 2 共享类型定义
- 详细描述：创建 WorkflowData 等 12 个跨 Capability 共享类型，定义 RuntimeState.data 数据契约。
- 影响的文件：
  - 创建：backend/capabilities/shared/types.ts
- 副作用：无
- 其他信息：Commit ddec163

## 2026-07-07 15:49
- 概述：新增 llm_structured_extract Tool
- 详细描述：通过工厂函数 createLlmStructuredExtract(llm) 闭包注入 LLM 客户端，从文本中提取结构化 JSON。
- 影响的文件：
  - 创建：backend/tools/llm_structured_extract/manifest.json
  - 创建：backend/tools/llm_structured_extract/skill.ts
- 副作用：无
- 其他信息：Commit 7f81502

## 2026-07-07 15:52
- 概述：新增 5 个 P0 Tools
- 详细描述：web_search、web_scrape、table_composer（纯常量）；matrix_builder、swot_generator（LLM 工厂函数）。每个 Tool 含 manifest.json + skill.ts。
- 影响的文件：
  - 创建：backend/tools/web_search/manifest.json, skill.ts
  - 创建：backend/tools/web_scrape/manifest.json, skill.ts
  - 创建：backend/tools/matrix_builder/manifest.json, skill.ts
  - 创建：backend/tools/swot_generator/manifest.json, skill.ts
  - 创建：backend/tools/table_composer/manifest.json, skill.ts
- 副作用：无
- 其他信息：Commit 08c9774

## 2026-07-07 15:55
- 概述：新增 requirement_parsing Capability
- 详细描述：createRequirementParsingCap(llm) 工厂函数，利用 llm_structured_extract 工具从用户输入提取结构化分析参数，含合法性校验和事件发射。
- 影响的文件：
  - 创建：backend/capabilities/requirement_parsing/prompts.ts
  - 创建：backend/capabilities/requirement_parsing/index.ts
- 副作用：无
- 其他信息：Commit 2d35efc

## 2026-07-07 15:57
- 概述：新增 information_collection Capability
- 详细描述：createInformationCollectionCap(llm) 工厂函数，LLM 生成搜索计划 → 按 batch 并行搜索 → 结果按 dimension 分组为 rawData。
- 影响的文件：
  - 创建：backend/capabilities/information_collection/prompts.ts
  - 创建：backend/capabilities/information_collection/index.ts
- 副作用：无
- 其他信息：Commit 46a08e0

## 2026-07-07 16:01
- 概述：新增 analysis_reasoning Capability
- 详细描述：createAnalysisReasoningCap(llm) 工厂函数，三阶段流水线：对比矩阵 → SWOT 并行生成 → LLM 综合归纳摘要。支持 structuredData 优先降级 rawData。
- 影响的文件：
  - 创建：backend/capabilities/analysis_reasoning/prompts.ts
  - 创建：backend/capabilities/analysis_reasoning/index.ts
- 副作用：无
- 其他信息：Commit 127ad24

## 2026-07-07 16:03
- 概述：新增 artifact_generation Capability
- 详细描述：createArtifactGenerationCap() 工厂函数（无 LLM 注入）。三阶段产出：对比矩阵 Markdown 表格 → 每个竞品 SWOT → 综合分析摘要。含 buildSourceMap 溯源映射。发射 workflow_complete 终止事件。
- 影响的文件：
  - 创建：backend/capabilities/artifact_generation/index.ts
  - 创建：backend/capabilities/artifact_generation/source_map.ts
- 副作用：无
- 其他信息：Commit 1425bef

## 2026-07-07 16:06
- 概述：新增 workflow 工作流入口
- 详细描述：createWorkflow(llm, eventBus) 函数，注册 4 个核心 Capability，创建 GraphRuntime，运行 Orchestrator 编排循环（先 requirement_parsing 入口，然后自动路由，artifact_generation 终止）。
- 影响的文件：
  - 创建：backend/entry/workflow.ts
- 副作用：无
- 其他信息：Commit 07fce56

## 2026-07-07 16:09
- 概述：新增 information_processing Capability，接入 workflow
- 详细描述：createInformationProcessingCap(llm) 工厂函数，在 information_collection 和 analysis_reasoning 之间对原始数据按 (target, dimension) 进行 LLM 驱动的结构化提取。同步更新 workflow.ts 注册该 Capability。
- 影响的文件：
  - 创建：backend/capabilities/information_processing/prompts.ts
  - 创建：backend/capabilities/information_processing/index.ts
  - 修改：backend/entry/workflow.ts
- 副作用：无
- 其他信息：Commit c99d483

## 2026-07-07 16:14
- 概述：新增 Phase 2 全链路 E2E 测试
- 详细描述：使用 vitest 创建 3 个测试用例：(1) 完整横向对比工作流全链路验证；(2) 空输入优雅降级；(3) 产物 sourceMap 溯源验证。使用 mock LLM（按 prompt 关键词分发 JSON 响应）和 mock EventBus。安装 vitest，新增 test 脚本。3/3 测试通过。
- 影响的文件：
  - 创建：backend/entry/__tests__/workflow.test.ts
  - 创建：backend/runtime/vitest.config.ts
  - 修改：backend/runtime/package.json
  - 创建：backend/runtime/package-lock.json
- 副作用：无
- 其他信息：Commit 961ad10

## 2026-07-07 16:18
- 概述：新增 3 个 P1 增强 Tools
- 详细描述：feature_extractor（LLM 工厂，提取原子功能点）、pricing_normalizer（LLM 工厂，统一货币/计费周期）、markdown_renderer（纯常量，结构化数据渲染 Markdown）。每个 Tool 含 manifest.json + skill.ts。
- 影响的文件：
  - 创建：backend/tools/feature_extractor/manifest.json, skill.ts
  - 创建：backend/tools/pricing_normalizer/manifest.json, skill.ts
  - 创建：backend/tools/markdown_renderer/manifest.json, skill.ts
- 副作用：无
- 其他信息：Phase 2 全部 11 个 Task 完成。Commit ed7d708

## 2026-07-07 19:07
- 概述：NestJS 项目初始化和依赖安装（Phase 2 后端骨架 Task 1）
- 详细描述：将 backend/package.json 升级为完整的 NestJS 项目配置，添加 NestJS 核心、Passport/JWT 认证、Prisma ORM、bcrypt、vitest 等依赖。创建 tsconfig.json（ESM + bundler 模式）和 nest-cli.json。更新 .env.example 增加 JWT_SECRET/JWT_EXPIRATION/NODE_ENV/PORT 变量。
- 影响的文件：
  - 修改：backend/package.json
  - 创建：backend/tsconfig.json
  - 创建：backend/nest-cli.json
  - 修改：backend/.env.example
- 副作用：无
- 其他信息：Commit 79517b9

## 2026-07-07 19:16
- 概述：Prisma 配置和数据库模型（Phase 2 后端骨架 Task 2）
- 详细描述：配置 Prisma ORM 连接 PostgreSQL，创建 User/Workflow/Event/Artifact 四个数据模型及其关联关系。实现 PrismaService（继承 PrismaClient，管理连接生命周期）和 PrismaModule（全局模块）。生成 Prisma Client，数据库迁移已同步。
- 影响的文件：
  - 创建：backend/prisma/schema.prisma
  - 创建：backend/src/infra/database/prisma.service.ts
  - 创建：backend/src/infra/database/prisma.module.ts
  - 已存在：backend/prisma/migrations/20260707111314_init/migration.sql
- 副作用：无
- 其他信息：Commit 1fcf5c9

## 2026-07-07 19:34
- 概述：Redis 服务配置（Phase 2 后端骨架 Task 3）
- 详细描述：创建 RedisService（使用 redis 包，实现 xadd/publish/subscribe 方法，OnModuleDestroy 生命周期钩子）和 RedisModule（@Global() 全局模块）。安装 redis@6.1.0 依赖。添加 vitest.config.ts 根级配置。在 tsconfig.json 添加 experimentalDecorators 以支持 NestJS 装饰器。编写 7 个单元测试（mock redis 模块），全部通过。
- 影响的文件：
  - 创建：backend/src/infra/redis/redis.service.ts
  - 创建：backend/src/infra/redis/redis.module.ts
  - 创建：backend/src/infra/redis/__tests__/redis.service.test.ts
  - 创建：backend/vitest.config.ts
  - 修改：backend/tsconfig.json（添加 experimentalDecorators）
  - 修改：backend/package.json（添加 redis 依赖）
  - 修改：backend/package-lock.json
- 副作用：tsconfig.json 新增 experimentalDecorators 选项，影响整个后端项目的 TypeScript 编译行为
- 其他信息：Commit 146361c

## 2026-07-07 19:39
- 概述：用户模块实现（Phase 2 后端骨架 Task 4）
- 详细描述：实现 UsersModule，包含 CreateUserDto/UpdateUserDto（class-validator 验证）、UsersService（CRUD + bcrypt 加密 + 邮箱唯一性检查）、UsersController（REST 端点）、Auth 装饰器占位文件（Public/CurrentUser）。编写 10 个 vitest 单元测试覆盖全部方法和异常场景，全部通过。安装 class-validator/class-transformer 依赖。
- 影响的文件：
  - 创建：backend/src/api/users/dto/create-user.dto.ts
  - 创建：backend/src/api/users/dto/update-user.dto.ts
  - 创建：backend/src/api/users/users.service.ts
  - 创建：backend/src/api/users/users.controller.ts
  - 创建：backend/src/api/users/users.module.ts
  - 创建：backend/src/api/users/__tests__/users.service.test.ts
  - 创建：backend/src/api/auth/decorators/public.decorator.ts
  - 创建：backend/src/api/auth/decorators/current-user.decorator.ts
  - 修改：backend/package.json, backend/package-lock.json
- 副作用：无
- 其他信息：Commit 8985b44

## 2026-07-07 19:46
- 概述：认证模块实现（Phase 2 后端骨架 Task 5）
- 详细描述：实现 AuthModule 完整认证链路。JWT Strategy（Bearer Token 提取 + 用户验证）、Local Strategy（邮箱密码登录）、JwtAuthGuard（全局守卫，支持 @Public() 跳过认证）、AuthService（validateUser + login + register）、AuthController（POST /api/auth/login、POST /api/auth/register、GET /api/auth/profile）。编写 6 个 vitest 单元测试覆盖 validateUser（成功/用户不存在/密码错误）、login、register，全部通过。
- 影响的文件：
  - 创建：backend/src/api/auth/strategies/jwt.strategy.ts
  - 创建：backend/src/api/auth/strategies/local.strategy.ts
  - 创建：backend/src/api/auth/guards/jwt-auth.guard.ts
  - 创建：backend/src/api/auth/auth.service.ts
  - 创建：backend/src/api/auth/auth.controller.ts
  - 创建：backend/src/api/auth/auth.module.ts
  - 创建：backend/src/api/auth/__tests__/auth.service.test.ts
  - 已存在（无需修改）：backend/src/api/auth/decorators/public.decorator.ts
  - 已存在（无需修改）：backend/src/api/auth/decorators/current-user.decorator.ts
- 副作用：无
- 其他信息：Commit 58ce738

## 2026-07-07 19:51
- 概述：事件模块实现（Phase 2 后端骨架 Task 6）
- 详细描述：实现 EventsModule，包含 EventsService（事件持久化 + Redis 发布/订阅）、EventsController（REST 查询 + SSE 流式推送）。EventsService 为后续 Workflows 模块提供事件总线能力。编写 7 个 vitest 单元测试覆盖 persistEvent/getWorkflowEvents/publishEvent/subscribeToWorkflow 全部方法，全部通过。
- 影响的文件：
  - 创建：backend/src/api/events/events.service.ts
  - 创建：backend/src/api/events/events.controller.ts
  - 创建：backend/src/api/events/events.module.ts
  - 创建：backend/src/api/events/__tests__/events.service.test.ts
- 副作用：无
- 其他信息：Commit d1f217c

## 2026-07-07 19:57
- 概述：工作流模块实现（Phase 2 后端骨架 Task 7）
- 详细描述：实现 WorkflowsModule，包含 WorkflowsService（工作流 CRUD + 运行时集成 + 路由决策 + 历史回放 + 产物获取）、WorkflowsController（REST 端点 + SSE 流式推送）。WorkflowsService 通过 createWorkflow 桥接现有 Runtime 引擎，异步执行工作流并管理状态（pending→running→completed/failed）。编写 10 个 vitest 单元测试覆盖全部公开方法，全部通过。
- 影响的文件：
  - 创建：backend/src/api/workflows/workflows.service.ts
  - 创建：backend/src/api/workflows/workflows.controller.ts
  - 创建：backend/src/api/workflows/workflows.module.ts
  - 创建：backend/src/api/workflows/__tests__/workflows.service.test.ts
- 副作用：无
- 其他信息：Commit ff41656

## 2026-07-07 20:03
- 概述：公共模块和全局配置（Phase 2 后端骨架 Task 8）
- 详细描述：创建 AllExceptionsFilter（全局异常过滤器，处理 HttpException 和未知异常，返回统一错误格式）、TransformInterceptor（全局响应转换拦截器，包装成功响应为 {data, code, message, timestamp} 格式）、AppModule（导入全部 6 个模块，注册 JwtAuthGuard/AllExceptionsFilter/TransformInterceptor 为全局 provider）、main.ts（应用入口，启用 CORS + ValidationPipe）。编写 10 个 vitest 单元测试覆盖过滤器和拦截器全部场景，全部通过。全量测试 49/49 通过。
- 影响的文件：
  - 创建：backend/src/api/common/filters/http-exception.filter.ts
  - 创建：backend/src/api/common/interceptors/transform.interceptor.ts
  - 创建：backend/src/api/common/__tests__/http-exception.filter.test.ts
  - 创建：backend/src/api/common/__tests__/transform.interceptor.test.ts
  - 创建：backend/src/api/app.module.ts
  - 创建：backend/src/main.ts
- 副作用：无
- 其他信息：Commit 2b3156e

## 2026-07-07 20:39
- 概述：集成测试配置和 E2E 测试（Phase 2 后端骨架 Task 9）
- 详细描述：创建 E2E 测试配置（vitest.config.e2e.ts + test/setup.ts），编写5个 E2E 测试用例覆盖认证（注册/登录/错误密码）和工作流（创建/未认证拒绝）。发现并修复 tsconfig.json 缺少 `emitDecoratorMetadata: true` 的关键问题（NestJS DI 在 vitest/esbuild 环境下无法工作）。测试数据清理使用级联删除避免外键约束冲突。5/5 E2E 测试 + 49/49 单元测试全部通过。
- 影响的文件：
  - 已存在（修改）：backend/test/app.e2e-spec.ts
  - 已存在（无需修改）：backend/test/setup.ts
  - 已存在（无需修改）：backend/vitest.config.e2e.ts
  - 修改：backend/tsconfig.json（添加 emitDecoratorMetadata: true）
- 副作用：tsconfig.json 新增 emitDecoratorMetadata 选项，影响整个后端项目的 TypeScript 编译行为
- 其他信息：Commit 208b7fc

## 2026-07-07 20:45
- 概述：文档更新（Phase 2 后端骨架 Task 10）
- 详细描述：创建 backend/README.md，包含 Getting Started（Prerequisites、Installation、Configuration、Database Setup、Running、Testing）和完整 API Endpoints 文档（Auth/Users/Workflows/Events）。更新 dev-progress.md 反映后端骨架 10/10 Task 全部完成。Phase 2 后端骨架阶段收尾。
- 影响的文件：
  - 创建：backend/README.md
  - 修改：.trae/memory/dev-progress.md
  - 修改：.trae/memory/change-log.md
- 副作用：无
- 其他信息：Phase 2 后端骨架 10/10 Task 全部完成。Commit aeb9810

## 2026-07-08 19:20
- 概述：Workflow 表新增 HITL 暂停/恢复字段
- 详细描述：在 Workflow 模型中添加 currentNode（当前执行节点 ID，恢复定位用）和 pausedAt（暂停时间戳）两个可选字段，更新 status 注释枚举所有可能值（pending | running | paused | completed | failed | cancelled）。迁移文件自动生成并已应用到数据库。
- 影响的文件：
  - 修改：backend/prisma/schema.prisma
  - 创建：backend/prisma/migrations/20260708111508_add_workflow_hitl_fields/migration.sql
- 副作用：无
- 其他信息：HITL Phase 2 Task 1/9。Commit 8af824a

## 2026-07-08 20:06
- 概述：实现 HITL 人在回路 — 事件溯源模式全链路
- 详细描述：新增 events.ts（事件类型定义 + fold 纯函数投影 + 回跳级联清除）、runner.ts（事件驱动编排循环 + RunnerDeps 接口）。简化 entry/workflow.ts 为 createRegistry 工厂。WorkflowsService 接入 Redis Pub/Sub 暂停/唤醒机制、routeDecision（含 backjump）、cancelWorkflow（AbortSignal）。新增 HITL 单元测试 10 个 + 更新 E2E 测试。全量 66 测试通过，TS 编译零错误。
- 影响的文件：
  - 新建：backend/src/workflow/events.ts, backend/src/workflow/runner.ts
  - 修改：backend/entry/workflow.ts, backend/src/api/workflows/workflows.service.ts, workflows.controller.ts
  - 新建：backend/src/api/workflows/__tests__/workflows-hitl.test.ts
  - 修改：backend/entry/__tests__/workflow.test.ts
- 副作用：entry/workflow.ts 删除 createWorkflow 编排循环，外部需改用 createRegistry + runWorkflow
- 其他信息：不改动 backend/runtime/ 任何文件。Commits: 8af824a..deef4ef

## 2026-07-08 20:11
- 概述：HITL 人在回路实现收尾
- 详细描述：全量测试 66/66 通过，类型编译无误。完成开发进度更新（P2.4.1/P2.4.2 标记完成）、实现报告（/docs/HITL-impl/report.md）。分支 feat/p2-HITL，基于 main (c8d515c)，9 个 Task 全完成。
- 影响的文件：
  - 新建：docs/HITL-impl/report.md
  - 修改：.trae/memory/dev-progress.md, .trae/memory/change-log.md
- 副作用：无
- 其他信息：HITL 全链路实现闭环。Commit deef4ef..HEAD
