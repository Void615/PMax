# Task 6: 事件模块实现 — 报告

## 实施内容

按计划实现了事件模块，包含以下文件：

### EventsService (`backend/src/api/events/events.service.ts`)
- `persistEvent(workflowId, event)` — 持久化事件到 PostgreSQL（通过 Prisma）
- `getWorkflowEvents(workflowId)` — 查询工作流的所有事件（按时间升序）
- `publishEvent(workflowId, event)` — 先持久化再发布到 Redis 频道 `sse:{workflowId}`
- `subscribeToWorkflow(workflowId, callback)` — 订阅 Redis 频道，自动解析 JSON 回调

### EventsController (`backend/src/api/events/events.controller.ts`)
- `GET /api/events/:workflowId` — 查询工作流事件历史
- `SSE /api/events/:workflowId/stream` — 实时事件流（使用 `@Sse()` 装饰器 + RxJS Observable）

### EventsModule (`backend/src/api/events/events.module.ts`)
- 注册 Controller 和 Service，导出 EventsService 供后续 Workflows 模块使用

### 单元测试 (`backend/src/api/events/__tests__/events.service.test.ts`)
- 7 个测试用例，覆盖所有方法和关键路径

## 测试结果

```
Tests  29 passed (29)  — 包含全部既有测试 + 7 个新增 EventsService 测试
Duration  580ms
输出整洁，无警告
```

### 新增测试覆盖
| 方法 | 测试用例 |
|------|----------|
| persistEvent | 持久化事件到数据库 |
| getWorkflowEvents | 返回事件列表（按时间排序）、空列表处理 |
| publishEvent | 持久化 + Redis 发布组合验证 |
| subscribeToWorkflow | Redis 频道订阅、JSON 解析回调验证 |

## TDD 证据

本任务未要求严格 TDD 流程，但测试与实现同步编写并验证通过。

## 文件变更

| 文件 | 操作 |
|------|------|
| `backend/src/api/events/events.service.ts` | 创建 |
| `backend/src/api/events/events.controller.ts` | 创建 |
| `backend/src/api/events/events.module.ts` | 创建 |
| `backend/src/api/events/__tests__/events.service.test.ts` | 创建 |

## Commit

- `d1f217c` feat: implement events module with persistence and SSE
- 分支：`feat/p2-backend-scaffold`

## 自审发现

- **代码风格一致性**：测试使用 Vitest（`vi.fn()` / `vi.clearAllMocks()`）+ 直接实例化模式，与既有 users/auth 测试完全一致。任务 brief 中指定 Jest 语法和 `test/` 目录，已按实际项目规范调整。
- **目录结构**：测试放在 `__tests__/` 子目录而非计划中的 `backend/test/events/`，与既有模式一致。
- **无 `.env` 或敏感文件提交**。
- **EventsModule 已导出 EventsService**，满足全局约束"供 Workflows 模块使用"。
- **SSE 流未实现清理逻辑**（客户端断开时 Redis subscriber 不会自动 unsubscribe）。这是已知限制，后续 Workflows 模块集成时需补充 cleanup。

## 关注点

- SSE Observable 在客户端断开连接时不会自动取消 Redis 订阅，可能导致连接泄漏。建议在后续 task 中通过 NestJS 生命周期或 `finalize()` 操作符处理。
