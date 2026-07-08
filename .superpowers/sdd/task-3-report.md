# Task 3 Report: Redis 配置

## 实现内容

按照任务规格实现了 Redis 服务和模块：

1. **RedisService** (`backend/src/infra/redis/redis.service.ts`)
   - 使用 `redis` 包的 `createClient` 创建 Redis 客户端
   - 连接 URL 从环境变量 `REDIS_URL` 读取，默认值 `redis://localhost:6379`
   - 实现 `OnModuleDestroy` 生命周期钩子，模块销毁时断开连接
   - 提供 `getClient()` 方法返回底层客户端
   - 提供 `xadd()` 方法（将交替参数转为对象）供事件流使用
   - 提供 `publish()` / `subscribe()` 方法供 Pub/Sub 使用

2. **RedisModule** (`backend/src/infra/redis/redis.module.ts`)
   - 使用 `@Global()` 装饰器实现全局注入
   - 导出 `RedisService` 供其他模块使用

3. **测试** (`backend/src/infra/redis/__tests__/redis.service.test.ts`)
   - 7 个单元测试，mock `redis` 模块验证所有方法行为

4. **配置调整**
   - `tsconfig.json`: 添加 `experimentalDecorators: true`（NestJS 装饰器支持 + vitest Oxc 转换器需要）
   - `vitest.config.ts`: 新建根级 vitest 配置，include 指向 `src/**/__tests__/**/*.test.ts`
   - `package.json`: 添加 `redis` 依赖

## 测试结果

```
7/7 tests passing, output pristine
```

## TDD 证据

- **RED**: 首次运行测试因 vitest Oxc 转换器不支持未声明的 legacy decorators 报 `SyntaxError: Invalid or unexpected token`
- **GREEN**: 在 `tsconfig.json` 添加 `experimentalDecorators: true` 后，所有 7 个测试通过

## 变更文件

| 文件 | 操作 |
|------|------|
| `backend/src/infra/redis/redis.service.ts` | 创建 |
| `backend/src/infra/redis/redis.module.ts` | 创建 |
| `backend/src/infra/redis/__tests__/redis.service.test.ts` | 创建 |
| `backend/vitest.config.ts` | 创建 |
| `backend/tsconfig.json` | 修改（添加 experimentalDecorators） |
| `backend/package.json` | 修改（添加 redis 依赖） |
| `backend/package-lock.json` | 修改 |

## 自审发现

1. **import type 修正**: 原始规格中 `RedisClientType` 作为值导入，实际运行时该类型不存在于 JS 运行时，使用 `import { createClient, type RedisClientType }` 修正
2. **experimentalDecorators**: 原始 tsconfig 缺少此选项，vitest 4.x 的 Oxc 转换器需要此配置才能正确处理 NestJS 装饰器
3. **vitest.config.ts**: 新建根级配置以支持 `src/` 目录下的测试文件发现

## 提交

- SHA: `146361c`
- Subject: `feat: add Redis service configuration and tests`
- 分支: `feat/p2-backend-scaffold`
