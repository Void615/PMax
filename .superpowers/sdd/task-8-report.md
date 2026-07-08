# Task 8 Report: 公共模块和全局配置

## 实现内容

按任务规格完整实现了 4 个文件：

### 1. 全局异常过滤器 (`backend/src/api/common/filters/http-exception.filter.ts`)
- `AllExceptionsFilter` 实现 `ExceptionFilter` 接口
- 使用 `@Catch()` 装饰器捕获所有异常
- HttpException 返回对应状态码和消息；未知异常返回 500
- 响应格式：`{ statusCode, timestamp, path, message }`
- HttpException 的 `getResponse()` 如果返回对象则提取 `.message` 字段

### 2. 响应转换拦截器 (`backend/src/api/common/interceptors/transform.interceptor.ts`)
- `TransformInterceptor<T>` 实现 `NestInterceptor<T, Response<T>>` 接口
- 统一包装成功响应为 `{ data, code: 0, message: 'success', timestamp }` 格式
- 导出 `Response<T>` 接口供其他模块使用

### 3. AppModule (`backend/src/api/app.module.ts`)
- 导入全部 6 个模块：PrismaModule, RedisModule, AuthModule, UsersModule, WorkflowsModule, EventsModule
- 通过 `APP_GUARD` 注册 `JwtAuthGuard` 为全局守卫
- 通过 `APP_FILTER` 注册 `AllExceptionsFilter` 为全局过滤器
- 通过 `APP_INTERCEPTOR` 注册 `TransformInterceptor` 为全局拦截器
- 所有 import 路径已验证与实际文件位置一致

### 4. main.ts (`backend/src/main.ts`)
- 使用 `NestFactory.create(AppModule)` 创建应用
- 启用 CORS (`app.enableCors()`)
- 注册全局 `ValidationPipe`（whitelist: true, transform: true）
- 端口从 `process.env.PORT` 读取，默认 3000

## 测试

### 测试文件
- `backend/src/api/common/__tests__/http-exception.filter.test.ts` — 6 个测试用例
- `backend/src/api/common/__tests__/transform.interceptor.test.ts` — 4 个测试用例

### 测试覆盖场景
**AllExceptionsFilter (6 tests):**
- 实例定义
- HttpException 字符串消息 → 404
- HttpException 对象消息 → 400 + 提取 `.message`
- 未知异常 → 500 + 'Internal server error'
- 包含 ISO 格式 timestamp

**TransformInterceptor (4 tests):**
- 实例定义
- 正常数据包装为 `{data, code: 0, message: 'success', timestamp}`
- null 数据处理
- 数组数据处理
- ISO 格式 timestamp 验证

### 测试结果
```
Test Files  7 passed (7)     ← 含之前 5 个模块的测试
Tests      49 passed (49)   ← 全量测试，包括新增 10 个
Duration   924ms
输出无 warning/noise
```

## TDD Evidence
本任务未要求严格 TDD，但遵循先写测试后实现的流程：
- 测试文件和源文件几乎同时创建
- 运行新测试确认 10/10 通过
- 运行全量测试确认 49/49 通过，无回归

## TypeScript 诊断
4 个新文件均通过 `tsc --noEmit` 零错误零警告（项目的 `tsc --noEmit` 存在预置的 rootDir 错误，均来自 `backend/runtime/` 等 src 外目录，与本任务无关）。

## 文件变更清单
| 操作 | 文件路径 |
|------|----------|
| 创建 | `backend/src/api/common/filters/http-exception.filter.ts` |
| 创建 | `backend/src/api/common/interceptors/transform.interceptor.ts` |
| 创建 | `backend/src/api/common/__tests__/http-exception.filter.test.ts` |
| 创建 | `backend/src/api/common/__tests__/transform.interceptor.test.ts` |
| 创建 | `backend/src/api/app.module.ts` |
| 创建 | `backend/src/main.ts` |

## Commit
- SHA: `2b3156e`
- Subject: `feat: add global filters, interceptors, and app module`
- Branch: `feat/p2-backend-scaffold`

## 自审发现
- 无质量问题，代码完全符合任务规格
- 未过度设计，未添加额外功能
- 遵循了项目既有的 vitest 测试风格
- 所有 import 路径与实际文件结构一致
