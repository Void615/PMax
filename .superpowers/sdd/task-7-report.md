# Task 7 Report: 工作流模块实现

## Status: DONE

## 实现内容

### WorkflowsService (`backend/src/api/workflows/workflows.service.ts`)
- `createWorkflow(userId, input)`: 创建工作流记录（截取前 50 字符作为名称），异步触发工作流执行
- `getWorkflow(id)`: 查询单个工作流（含 events 和 artifacts 关联），不存在时抛 NotFoundException
- `getWorkflowHistory(id)`: 通过 EventsService 获取工作流事件历史
- `getWorkflowArtifacts(id)`: 查询工作流的产物列表（按 createdAt 降序）
- `routeDecision(workflowId, nodeId)`: 路由决策占位实现，返回 accepted 状态
- `executeWorkflow(workflowId, input)`: 私有方法，通过 `createWorkflow` 桥接 Runtime 引擎异步执行工作流，管理工作流状态（pending→running→completed/failed），保存产物，错误时发布失败事件

### WorkflowsController (`backend/src/api/workflows/workflows.controller.ts`)
- `POST /api/workflows`: 创建工作流（需要认证）
- `GET /api/workflows/:id`: 查询工作流详情
- `SSE /api/workflows/:id/stream`: SSE 流式事件推送
- `POST /api/workflows/:id/route`: 路由决策
- `GET /api/workflows/:id/history`: 事件历史
- `GET /api/workflows/:id/artifacts`: 产物列表

### WorkflowsModule (`backend/src/api/workflows/workflows.module.ts`)
- 导入 EventsModule，注册 WorkflowsController 和 WorkflowsService

### 测试 (`backend/src/api/workflows/__tests__/workflows.service.test.ts`)
- 10 个测试用例，覆盖全部公开方法

## 测试结果

```
Test Files  5 passed (5)
     Tests  39 passed (39)
  Duration  806ms
```

全部 39 个测试通过（含新增 10 个 + 已有 29 个），无警告或噪声输出。

## 文件变更

| 文件 | 操作 |
|------|------|
| `backend/src/api/workflows/workflows.service.ts` | 创建 |
| `backend/src/api/workflows/workflows.controller.ts` | 创建 |
| `backend/src/api/workflows/workflows.module.ts` | 创建 |
| `backend/src/api/workflows/__tests__/workflows.service.test.ts` | 创建 |

## Commit

- `ff41656` feat: implement workflows module with runtime integration

## 自审发现

1. **Import 路径调整**：任务简报中的 import 路径 `../../core/runtime` 和 `../../core/entry/workflow` 不存在于项目中。实际路径为 `../../../runtime/index.js` 和 `../../../entry/workflow.js`（相对于 `backend/src/api/workflows/`）。已使用正确路径。

2. **测试文件位置调整**：任务简报指定 `backend/test/workflows/workflows.service.spec.ts`，但 vitest 配置（`include: ["src/**/__tests__/**/*.test.ts"]`）只扫描 `src/` 目录下的 `__tests__/` 文件。为保证测试可被 vitest 发现执行，改为 `backend/src/api/workflows/__tests__/workflows.service.test.ts`，与现有测试模式一致。

3. **TS6059 rootDir 警告**：`workflows.service.ts` 导入 `runtime/` 和 `entry/` 目录会触发 TS6059（文件不在 rootDir 下）。这是项目已有的架构问题（runtime 和 entry 位于 `src/` 外），不是本次变更引入的。现有代码（如 entry/workflow.ts）也存在相同的 TS6059 错误。

4. **routeDecision 占位实现**：按任务简报保留为 TODO 占位，返回 `{ workflowId, nodeId, status: 'accepted' }`。

## 关注点

- 无阻塞性问题。
- WorkflowsModule 尚未注册到 AppModule（项目中尚无 `app.module.ts`），需在后续任务中集成。
