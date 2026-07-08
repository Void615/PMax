# Task 5 Report: 认证模块实现

## 状态：DONE

## 实现内容

实现了完整的 AuthModule 认证链路，包含 JWT 认证、本地策略、守卫、装饰器、AuthService 和 AuthController。

### 文件变更

| 操作 | 文件路径 |
|------|----------|
| 创建 | `backend/src/api/auth/strategies/jwt.strategy.ts` |
| 创建 | `backend/src/api/auth/strategies/local.strategy.ts` |
| 创建 | `backend/src/api/auth/guards/jwt-auth.guard.ts` |
| 创建 | `backend/src/api/auth/auth.service.ts` |
| 创建 | `backend/src/api/auth/auth.controller.ts` |
| 创建 | `backend/src/api/auth/auth.module.ts` |
| 创建 | `backend/src/api/auth/__tests__/auth.service.test.ts` |
| 已存在（Task 4 已实现） | `backend/src/api/auth/decorators/public.decorator.ts` |
| 已存在（Task 4 已实现） | `backend/src/api/auth/decorators/current-user.decorator.ts` |

### 测试结果

```
Test Files  3 passed (3)
     Tests  23 passed (23)
  Duration  411ms
```

Auth 测试（6/6 通过）：
- validateUser: 凭证正确时返回去除密码的用户数据
- validateUser: 用户不存在时返回 null
- validateUser: 密码错误时返回 null
- login: 返回 access_token 和 user
- register: 创建用户后返回登录响应
- 基本定义检查

### 与任务规格的偏差

1. **测试文件路径**：任务规格指定 `backend/test/auth/auth.service.spec.ts`，但遵循项目现有约定改为 `backend/src/api/auth/__tests__/auth.service.test.ts`，因为 vitest 配置为 `include: ["src/**/__tests__/**/*.test.ts"]`。

2. **测试框架**：任务规格使用 jest 语法，但项目实际使用 vitest。测试已适配为 vitest（`vi.fn()` 替代 `jest.fn()`，直接实例化替代 NestJS TestingModule）。

3. **AuthController 错误处理**：任务规格中 login 端点使用 `throw new Error('邮箱或密码错误')`，改为 `throw new UnauthorizedException('邮箱或密码错误')` 以返回正确的 HTTP 401 状态码。

## 自审

- ✅ 完整性：所有 9 个文件均已实现/确认
- ✅ 密码验证：使用 bcrypt.compare
- ✅ JWT 过期：24h（通过 signOptions 和 JwtStrategy ignoreExpiration: false）
- ✅ JwtAuthGuard 支持 @Public() 装饰器
- ✅ AuthModule 导出 AuthService
- ✅ 遵循现有代码风格和命名约定
- ✅ TypeScript 严格模式兼容
- ✅ 测试输出干净无警告
