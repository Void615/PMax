# Task 8: 公共模块和全局配置

## 任务描述

创建公共模块（异常过滤器、拦截器）、AppModule 和 main.ts 入口。

## 文件操作

- Create: `backend/src/api/common/filters/http-exception.filter.ts`
- Create: `backend/src/api/common/interceptors/transform.interceptor.ts`
- Create: `backend/src/api/app.module.ts`
- Create: `backend/src/main.ts`

## 接口

- Consumes: 所有模块 (from Tasks 4-7)
- Produces: AppModule, main.ts (应用入口)

## 步骤

- [ ] **Step 1: 创建全局异常过滤器**

```typescript
// backend/src/api/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'string' ? message : (message as any).message,
    });
  }
}
```

- [ ] **Step 2: 创建响应转换拦截器**

```typescript
// backend/src/api/common/interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  code: number;
  message: string;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        data,
        code: 0,
        message: 'success',
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

- [ ] **Step 3: 创建 AppModule**

```typescript
// backend/src/api/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../infra/database/prisma.module';
import { RedisModule } from '../infra/redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { EventsModule } from './events/events.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WorkflowsModule,
    EventsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: 创建 main.ts**

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './api/app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用 CORS
  app.enableCors();

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/common/ backend/src/api/app.module.ts backend/src/main.ts
git commit -m "feat: add global filters, interceptors, and app module"
```

## 全局约束

- 使用 TypeScript 严格模式
- 遵循现有项目代码风格和命名约定
- AppModule 必须注册所有模块
- JwtAuthGuard 必须作为全局守卫注册
- AllExceptionsFilter 必须作为全局过滤器注册
- TransformInterceptor 必须作为全局拦截器注册
- main.ts 必须启用 CORS 和 ValidationPipe
