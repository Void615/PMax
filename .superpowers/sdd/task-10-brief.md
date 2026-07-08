# Task 10: 文档更新

## 任务描述

更新 README、开发进度和变更日志。

## 文件操作

- Modify: `backend/README.md`
- Modify: `.trae/memory/dev-progress.md`
- Modify: `.trae/memory/change-log.md`

## 接口

- 无前置依赖

## 步骤

- [ ] **Step 1: 更新 README.md**

在 backend/README.md 中添加：

```markdown
## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL
- Redis

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure your environment variables.

### Database Setup

```bash
npx prisma migrate dev
npx prisma generate
```

### Running the App

```bash
# development
npm run dev

# production
npm run build
npm run start:prod
```

### Testing

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Get current user profile

### Users

- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user
- `GET /api/users/:id/workflows` - Get user's workflows

### Workflows

- `POST /api/workflows` - Create new workflow
- `GET /api/workflows/:id` - Get workflow details
- `SSE /api/workflows/:id/stream` - Stream workflow events
- `POST /api/workflows/:id/route` - Route decision
- `GET /api/workflows/:id/history` - Get workflow history
- `GET /api/workflows/:id/artifacts` - Get workflow artifacts

### Events

- `GET /api/events/:workflowId` - Get workflow events
- `SSE /api/events/:workflowId/stream` - Stream workflow events
```

- [ ] **Step 2: 更新开发进度**

在 `.trae/memory/dev-progress.md` 中更新 Phase 2 进度。

- [ ] **Step 3: 更新变更日志**

在 `.trae/memory/change-log.md` 中添加本次变更记录。

- [ ] **Step 4: Commit**

```bash
git add backend/README.md .trae/memory/
git commit -m "docs: update documentation for Phase 2 backend skeleton"
```

## 全局约束

- 使用中文记录开发进度和变更日志
- README 使用英文
- 变更日志格式必须符合规范
