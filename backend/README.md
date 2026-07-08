# PMax Backend

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
