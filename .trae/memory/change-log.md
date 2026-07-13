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

## 2026-07-12 22:35
- 概述：web_search / web_scrape 从占位桩替换为真实实现，新增 Agent 层集成测试
- 详细描述：
  1. web_search：TDD 方式将 stub 替换为 DuckDuckGo Instant Answer API（零外部依赖，Node fetch + 8s 超时 + 网络异常降级）。5 个单元测试覆盖 DDG 三级数据源解析、maxResults 截断、空响应、网络异常、HTTP 错误。
  2. web_scrape：TDD 方式将 stub 替换为 @mozilla/readability + jsdom 实现（10s 超时、Content-Type 检测、Readability 解析 fallback）。5 个单元测试。
  3. 新增 CollectAgent（agents/collect-agent.ts）：编排 web_search → web_scrape 调用链，产出 SearchReport。
  4. 新增搜索→抓取集成测试（tools/__tests__/search-scrape-integration.test.ts）：4 个用例覆盖链路完整性、多页面区别、死链降级、maxPages 限制。
  5. 配套修改：vitest.config 添加 tools 目录、tsconfig.json 添加 types: node、package.json 新增 test:file 脚本和 jsdom/readability 依赖、workflow.test.ts 添加 fetch mock。
  6. 全量 80/80 测试通过。已知：E2E POST /api/workflows 返回 500 为预先存在问题。
- 影响的文件：
  - 修改：backend/tools/web_search/skill.ts
  - 新建：backend/tools/web_search/__tests__/skill.test.ts
  - 修改：backend/tools/web_scrape/skill.ts
  - 新建：backend/tools/web_scrape/__tests__/skill.test.ts
  - 新建：backend/agents/collect-agent.ts
  - 新建：backend/tools/__tests__/search-scrape-integration.test.ts
  - 修改：backend/vitest.config.ts、backend/tsconfig.json、backend/package.json、backend/package-lock.json、backend/entry/__tests__/workflow.test.ts
  - 新建：docs/superpowers/plans/2026-07-11-web-search-real-impl.md
- 副作用：web_search / web_scrape 现在发起真实 HTTP 请求，测试环境中需 mock global.fetch
- 其他信息：分支 feat/p2-tools-implements，Commits d8fdeac..7a55a9b（8 个）

## 2026-07-13 16:18
- 概述：重构 requirement_parsing Capability 为 ROUND_DEFS 驱动的多轮澄清对话
- 详细描述：
  1. 新增 ClarificationRound、ClarificationRoundDef 类型和 ROUND_DEFS 轮次定义表（shared/types.ts）
  2. UiHint 新增 clarification_asked 和 quality_warning 两种事件提示（bus/types.ts）
  3. 新增 clarification.required / clarification.provided 生命周期事件和 HumanClarification 类型（events.ts）
  4. 新增 7 个 per-round 澄清 prompt 模板（requirement_parsing/prompts.ts）
  5. requirement_parsing 完全重写为三阶段状态机（scene_selection → clarification_loop → confirming），轮次序列由 ROUND_DEFS[analysisType] 驱动，不硬编码轮次数
  6. runner.ts while 循环新增 intra-node clarification 暂停/恢复机制（检测 _rpState → emit clarification.required → 暂停等用户输入 → fold clarification.provided → continue 重新进入同一节点）
  7. WorkflowsService 新增 submitClarification / waitForHumanClarification（Redis pub/sub on workflow:{id}:clarification channel）
  8. WorkflowsController 新增 POST /:id/clarification 端点
  9. 更新 E2E 测试支持 6 轮 auto-clarification 回复
  10. 新增 clarification 单元测试 4 个用例（首轮场景选择、完整 6 轮流程、回跳修改、幂等完成状态）
  11. 设计文档同步：docs/capabilities_design/ 新增 DESIGN.md（概要）、CAPABILITY_WORKFLOW_SPEC_P1/P2.md（详细工作流）、TOOL_SPEC.md（19 个 Tool 规格）；docs/UIHints/ 新增 UIHINT_SPEC.md（事件-前端组件映射）
  12. 全量 80/80 测试通过，TS 编译零新增错误
- 影响的文件：
  - 新建：backend/capabilities/requirement_parsing/__tests__/clarification.test.ts
  - 新建：docs/capabilities_design/DESIGN.md、CAPABILITY_WORKFLOW_SPEC_P1.md、CAPABILITY_WORKFLOW_SPEC_P2.md、TOOL_SPEC.md
  - 新建：docs/UIHints/UIHINT_SPEC.md
  - 新建：docs/superpowers/plans/2026-07-13-requirement-parsing-rework.md
  - 修改：backend/capabilities/shared/types.ts（ClarificationRound 等新类型 + ROUND_DEFS）
  - 修改：backend/runtime/bus/types.ts（UiHint ×2）
  - 修改：backend/src/workflow/events.ts（WorkflowLifecycleEvent ×2 + HumanClarification + fold 分支）
  - 修改：backend/src/workflow/runner.ts（RunnerDeps 扩展 + clarification 暂停循环）
  - 修改：backend/capabilities/requirement_parsing/index.ts（完全重写）
  - 修改：backend/capabilities/requirement_parsing/prompts.ts（单 prompt → 7 个 per-round prompts）
  - 修改：backend/src/api/workflows/workflows.service.ts（submitClarification + waitForHumanClarification）
  - 修改：backend/src/api/workflows/workflows.controller.ts（/:id/clarification 端点）
  - 修改：backend/entry/__tests__/workflow.test.ts（适配 6 轮 auto-clarification）
  - 修改：backend/vitest.config.ts（include capabilities/** tests）
- 副作用：runner.ts 的 while 循环新增 _rpState 检测分支，仅当 Capability 产出 _rpState 时触发，不影响其他 Capability 的正常路由暂停流程
- 其他信息：分支 feat/capability-workflow-implement，Commits 7ec2114..d30c112（8 个）

## 2026-07-13 17:24
- 概述：完成全部 5 个 Capability 的 Tool 化重构
- 详细描述：
  **information_collection 重构（3 commits）：**
  1. 新增 4 个 Tool：competitor_url_resolver（URL 发现）、search_planner（搜索计划）、credibility_scorer（可信度评分）、sufficiency_checker（充分性检查）
  2. Capability 重写：移除 llm.complete() 裸调，web_scrape 正式接入（搜索→Top-2 URL→全文抓取），最多 2 轮采集循环
  3. 清理旧的 SEARCH_PLAN_PROMPT / SUFFICIENCY_PROMPT 死代码

  **information_processing 重构（3 commits）：**
  1. 改写 2 个已有 Tool（pricing_normalizer、feature_extractor）统一为 records 返回格式 + 新增 2 个 Tool（entity_resolver 实体对齐、conflict_detector 冲突检测）
  2. StructuredRecord 新增 status 字段，ProcessingResult 新增 coverageMatrix/conflictCount/conflicts，新增 ConflictReport 类型
  3. Capability 重写：按维度路由提取 → 实体对齐 → 冲突检测 → 覆盖矩阵

  **analysis_reasoning 重构（3 commits）：**
  1. 扩展 matrix_builder/swot_generator 参数（dimensions/coverageContext/confidencePenalty 等）+ 新增 2 个 Tool（insight_extractor 差异化洞察、comparison_summarizer 综合摘要）
  2. 新增 Insight 类型，AnalysisResult 扩展 insights/analysisReport 字段
  3. Capability 重写：数据质量预检（不均衡/冲突/降级）→ 4 个 Tool 全链路，零 llm.complete() 裸调

  **artifact_generation 重构（2 commits）：**
  1. 新增 source_map_builder Tool（纯规则，无 LLM），SourceMapEntry 新增 credibility 字段
  2. Artifact.type 新增 "insight_report" 和 "report"，OutputFormat 新增 "insight_report"
  3. Capability 重写：溯源链构建 → 按 outputFormat 路由（table_composer / SWOT 模板 / insight 模板 / markdown_renderer），markdown_renderer 正式接入
  4. 删除 source_map.ts（逻辑迁移至 Tool）

  全量 80/80 测试通过，TS 编译零新增错误。
- 影响的文件：
  - 新建：backend/tools/competitor_url_resolver/、backend/tools/search_planner/、backend/tools/credibility_scorer/、backend/tools/sufficiency_checker/（各含 manifest.json + skill.ts + prompts.ts，credibility_scorer 无 prompts.ts）
  - 新建：backend/tools/entity_resolver/、backend/tools/conflict_detector/（各含 manifest.json + skill.ts + prompts.ts）
  - 新建：backend/tools/insight_extractor/、backend/tools/comparison_summarizer/（各含 manifest.json + skill.ts + prompts.ts）
  - 新建：backend/tools/source_map_builder/（manifest.json + skill.ts）
  - 新建：backend/tools/matrix_builder/prompts.ts、backend/tools/swot_generator/prompts.ts、backend/tools/pricing_normalizer/prompts.ts、backend/tools/feature_extractor/prompts.ts
  - 修改：backend/capabilities/shared/types.ts（SearchQuery/SearchBatch/SearchPlan/CollectionReport/Insight/ConflictReport 类型；StructuredRecord.status、ProcessingResult 扩展、AnalysisResult 扩展、Artifact.type 扩展、OutputFormat 扩展、SourceMapEntry.credibility）
  - 修改：backend/capabilities/information_collection/index.ts（完全重写）
  - 修改：backend/capabilities/information_collection/prompts.ts（清理为占位文件）
  - 修改：backend/capabilities/information_processing/index.ts（完全重写）
  - 修改：backend/capabilities/analysis_reasoning/index.ts（完全重写）
  - 修改：backend/capabilities/analysis_reasoning/prompts.ts（清理为占位文件）
  - 修改：backend/capabilities/artifact_generation/index.ts（完全重写）
  - 删除：backend/capabilities/artifact_generation/source_map.ts
  - 修改：backend/tools/pricing_normalizer/skill.ts + manifest.json（参数/返回格式统一）
  - 修改：backend/tools/feature_extractor/skill.ts + manifest.json（参数/返回格式统一）
  - 修改：backend/tools/matrix_builder/skill.ts + manifest.json（参数扩展）
  - 修改：backend/tools/swot_generator/skill.ts + manifest.json（参数扩展）
  - 修改：backend/tools/table_composer/skill.ts（highlights 参数）
  - 修改：backend/entry/__tests__/workflow.test.ts（mock LLM 适配所有新 Tool）
- 副作用：全部 5 个 Capability 的 execute() 均不再包含任何 llm.complete() 裸调，所有 LLM 调用通过 Tool.execute() 完成
- 其他信息：分支 feat/capability-workflow-implement，Commits b647b99..e230b52（12 个），累计 20 commits
