# Task 9: 集成测试 - 报告

## 实现内容

创建 E2E 测试配置和集成测试，覆盖认证和工作流核心流程。

### 创建的文件
- `backend/test/app.e2e-spec.ts` — 5 个 E2E 测试用例
- `backend/test/setup.ts` — 测试环境变量加载（.env.test）
- `backend/vitest.config.e2e.ts` — E2E 独立 vitest 配置

### 修复的文件
- `backend/tsconfig.json` — 添加 `emitDecoratorMetadata: true`（NestJS DI 必需）

## 测试结果

```
E2E Tests: 5/5 passed
  ✓ /POST auth/register - should register a new user
  ✓ /POST auth/login - should login with valid credentials
  ✓ /POST auth/login - should reject invalid credentials
  ✓ /POST workflows - should create a workflow
  ✓ /POST workflows - should reject without auth token

Unit Tests: 49/49 passed (无回归)
```

输出 pristine，无警告或噪声。

## 关键发现

### `emitDecoratorMetadata` 缺失问题

**现象**：E2E 测试中所有请求返回 500，错误为 `Cannot read properties of undefined (reading 'register')`。

**根因**：`tsconfig.json` 缺少 `emitDecoratorMetadata: true`。NestJS 的 DI 系统依赖 `Reflect.getMetadata('design:paramtypes', ...)` 在运行时解析构造函数参数类型。没有此选项，vitest 使用 esbuild 转换时不会发射装饰器元数据，导致所有依赖注入失败。

**修复**：在 `tsconfig.json` 的 `compilerOptions` 中添加 `"emitDecoratorMetadata": true`。

**影响**：这是一个影响整个后端项目的基础配置修复，不仅限于 E2E 测试。此前单元测试不受影响是因为所有依赖都通过 mock 手动提供，不依赖自动 DI 解析。

## TDD 证据

本任务不要求严格 TDD（任务描述直接提供了测试代码）。但调试过程遵循了科学方法：
1. 运行测试 → 500 错误
2. 添加错误日志 → 发现 `authService` 为 undefined
3. 验证 DI 容器 → `AuthService` 可解析但控制器未注入
4. 检查 tsconfig → 发现缺少 `emitDecoratorMetadata`
5. 修复 → 测试全部通过

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/vitest.config.e2e.ts` | 已存在 | E2E vitest 配置 |
| `backend/test/setup.ts` | 已存在 | 测试环境变量加载 |
| `backend/test/app.e2e-spec.ts` | 修改 | 完整 E2E 测试（5 个用例） |
| `backend/tsconfig.json` | 修改 | 添加 emitDecoratorMetadata |

## 自检发现

1. **`emitDecoratorMetadata` 是关键修复**：没有它，NestJS 在 vitest（esbuild）环境下完全无法工作。这是一个隐蔽但致命的配置缺失。
2. **测试数据清理需要级联删除**：用户关联了 workflow/artifact/event，直接删除用户会违反外键约束。afterAll 中按依赖顺序清理。
3. **`JwtAuthGuard` 的 `Reflector` 注入**：在有 `emitDecoratorMetadata` 的情况下，原始构造函数注入方式正常工作，无需 `new Reflector()` 替代方案。
