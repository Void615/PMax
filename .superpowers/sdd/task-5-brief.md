# Task 5: 认证模块实现

## 任务描述

实现用户认证模块，包括 JWT 策略、本地策略、守卫、装饰器、AuthService、AuthController。

## 文件操作

- Create: `backend/src/api/auth/decorators/public.decorator.ts`
- Create: `backend/src/api/auth/decorators/current-user.decorator.ts`
- Create: `backend/src/api/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/api/auth/strategies/local.strategy.ts`
- Create: `backend/src/api/auth/guards/jwt-auth.guard.ts`
- Create: `backend/src/api/auth/auth.service.ts`
- Create: `backend/src/api/auth/auth.controller.ts`
- Create: `backend/src/api/auth/auth.module.ts`
- Create: `backend/test/auth/auth.service.spec.ts`

## 接口

- Consumes: UsersService (from Task 4)
- Produces: AuthService, JwtAuthGuard (供其他模块使用)

## 注意

Task 4 已经创建了占位文件：
- `backend/src/api/auth/decorators/public.decorator.ts`
- `backend/src/api/auth/decorators/current-user.decorator.ts`

你需要更新这些文件，添加完整的实现。

## 步骤

- [ ] **Step 1: 更新装饰器文件**

```typescript
// backend/src/api/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```typescript
// backend/src/api/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 2: 创建 JWT Strategy**

```typescript
// backend/src/api/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    return user;
  }
}
```

- [ ] **Step 3: 创建 Local Strategy**

```typescript
// backend/src/api/auth/strategies/local.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return user;
  }
}
```

- [ ] **Step 4: 创建 JwtAuthGuard**

```typescript
// backend/src/api/auth/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('请先登录');
    }
    return user;
  }
}
```

- [ ] **Step 5: 创建 AuthService**

```typescript
// backend/src/api/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = { sub: user.id, email: user.email };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(createUserDto: any) {
    const user = await this.usersService.create(createUserDto);
    return this.login(user);
  }
}
```

- [ ] **Step 6: 创建 AuthController**

```typescript
// backend/src/api/auth/auth.controller.ts
import { Controller, Post, Body, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CreateUserDto } from '../users/dto/create-user.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new Error('邮箱或密码错误');
    }
    return this.authService.login(user);
  }

  @Public()
  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return user;
  }
}
```

- [ ] **Step 7: 创建 AuthModule**

```typescript
// backend/src/api/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: process.env.JWT_EXPIRATION || '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 8: 创建单元测试**

```typescript
// backend/test/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/api/auth/auth.service';
import { UsersService } from '../../src/api/users/users.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/api/auth/ backend/test/auth/
git commit -m "feat: implement authentication module with JWT"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- JWT Token 24 小时过期
- 密码必须使用 bcrypt 验证
- JwtAuthGuard 必须支持 @Public() 装饰器
- AuthModule 必须导出 AuthService
