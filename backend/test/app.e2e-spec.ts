import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/api/app.module';
import { PrismaService } from '../src/infra/database/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testEmail = `e2e-test-${Date.now()}@example.com`;
  const testPassword = 'password123';
  const testName = 'E2E Test User';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // 清理测试数据（先删子表再删父表）
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      await prisma.artifact.deleteMany({ where: { workflow: { userId: user.id } } });
      await prisma.event.deleteMany({ where: { workflow: { userId: user.id } } });
      await prisma.workflow.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await app.close();
  });

  describe('Auth', () => {
    it('/POST auth/register - should register a new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: testEmail, password: testPassword, name: testName });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe(testEmail);
      expect(response.body.code).toBe(0);
      expect(response.body.message).toBe('success');
    });

    it('/POST auth/login - should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(201);

      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data.user.email).toBe(testEmail);
    });

    it('/POST auth/login - should reject invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: 'wrong-password' })
        .expect(401);

      expect(response.body).toHaveProperty('statusCode', 401);
    });
  });

  describe('Workflows', () => {
    let authToken: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });
      authToken = response.body.data.access_token;
    });

    it('/POST workflows - should create a workflow', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ input: '分析竞品' })
        .expect(201);

      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('分析竞品');
      expect(response.body.code).toBe(0);
    });

    it('/POST workflows - should reject without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/workflows')
        .send({ input: '分析竞品' })
        .expect(401);
    });
  });
});
