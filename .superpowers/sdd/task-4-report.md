# Task 4: 用户模块实现 - 报告

## 状态: DONE

## 实现内容

完整实现了用户模块，包含以下组件：

1. **CreateUserDto** (`backend/src/api/users/dto/create-user.dto.ts`)
   - email（IsEmail）、password（IsString + MinLength(6)）、name（IsOptional）
2. **UpdateUserDto** (`backend/src/api/users/dto/update-user.dto.ts`)
   - name（IsOptional）
3. **UsersService** (`backend/src/api/users/users.service.ts`)
   - `create`: 检查邮箱唯一性 → bcrypt 加密密码 → 创建用户
   - `findById`: 按 ID 查询，不存在抛 NotFoundException
   - `findByEmail`: 按邮箱查询（返回 null 而非抛异常，供 Auth 模块使用）
   - `update`: 验证用户存在 → 更新
   - `getUserWorkflows`: 验证用户存在 → 查询关联 workflows（按 createdAt 降序）
4. **UsersController** (`backend/src/api/users/users.controller.ts`)
   - `POST /api/users` - 创建用户（@Public()）
   - `GET /api/users/:id` - 查询用户
   - `PATCH /api/users/:id` - 更新用户
   - `GET /api/users/:id/workflows` - 查询用户 workflows
5. **UsersModule** (`backend/src/api/users/users.module.ts`)
   - 导出 UsersService 供 Auth 模块使用

## 额外创建的占位文件

- `backend/src/api/auth/decorators/public.decorator.ts` - IS_PUBLIC_KEY + Public 装饰器
- `backend/src/api/auth/decorators/current-user.decorator.ts` - CurrentUser 参数装饰器

## 安装的依赖

- class-validator
- class-transformer

## 测试

测试文件：`backend/src/api/users/__tests__/users.service.test.ts`

遵循现有 vitest 测试模式（参考 redis.service.test.ts），使用 vi.mock 模拟 bcrypt 和 PrismaService。

测试覆盖：
- create: 成功创建 / 邮箱已存在抛 ConflictException
- findById: 找到用户 / 未找到抛 NotFoundException
- findByEmail: 找到用户 / 返回 null
- update: 成功更新 / 用户不存在抛 NotFoundException
- getUserWorkflows: 返回 workflows / 用户不存在抛 NotFoundException

### 测试结果

```
 ✓ src/api/users/__tests__/users.service.test.ts (10 tests) 3ms
 ✓ src/infra/redis/__tests__/redis.service.test.ts (7 tests) 6ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
   Duration  471ms
```

17/17 通过，输出干净无警告。

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 创建 | `backend/src/api/users/dto/create-user.dto.ts` |
| 创建 | `backend/src/api/users/dto/update-user.dto.ts` |
| 创建 | `backend/src/api/users/users.service.ts` |
| 创建 | `backend/src/api/users/users.controller.ts` |
| 创建 | `backend/src/api/users/users.module.ts` |
| 创建 | `backend/src/api/users/__tests__/users.service.test.ts` |
| 创建 | `backend/src/api/auth/decorators/public.decorator.ts` |
| 创建 | `backend/src/api/auth/decorators/current-user.decorator.ts` |
| 修改 | `backend/package.json` (新增 class-validator, class-transformer) |
| 修改 | `backend/package-lock.json` |

## 自审发现

- 测试位置适配：任务说明中指定 `backend/test/users/users.service.spec.ts`，但现有项目测试遵循 `src/**/__tests__/**/*.test.ts` 模式（vitest.config.ts 中配置），因此调整为 `src/api/users/__tests__/users.service.test.ts` 以保持一致性。
- 测试框架适配：任务说明中使用 jest 语法，但项目使用 vitest，已适配为 vitest API（vi.mock, vi.fn() 等）。
- 目前没有 app.module.ts，UsersModule 尚未注册到根模块，需在后续任务中完成。
