import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcrypt', () => ({
  hash: vi.fn(),
}));

import * as bcrypt from 'bcrypt';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';

function createMockPrisma() {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workflow: {
      findMany: vi.fn(),
    },
  } as any;
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new UsersService(prisma);
  });

  describe('create', () => {
    it('should create a new user with hashed password', async () => {
      const dto = { email: 'test@example.com', password: 'password123', name: 'Test' };
      const hashedPassword = 'hashed_password';
      const createdUser = { id: 'user-1', ...dto, password: hashedPassword };

      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as any).mockResolvedValue(hashedPassword);
      prisma.user.create.mockResolvedValue(createdUser);

      const result = await service.create(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: dto.email } });
      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { ...dto, password: hashedPassword },
      });
      expect(result).toEqual(createdUser);
    });

    it('should throw ConflictException when email already exists', async () => {
      const dto = { email: 'existing@example.com', password: 'password123' };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: dto.email });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('邮箱已存在');
    });
  });

  describe('findById', () => {
    it('should return a user when found', async () => {
      const user = { id: 'user-1', email: 'test@example.com' };
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.findById('nonexistent')).rejects.toThrow('用户不存在');
    });
  });

  describe('findByEmail', () => {
    it('should return a user when found by email', async () => {
      const user = { id: 'user-1', email: 'test@example.com' };
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(result).toEqual(user);
    });

    it('should return null when user not found by email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update user name', async () => {
      const existingUser = { id: 'user-1', name: 'Old Name' };
      const updatedUser = { id: 'user-1', name: 'New Name' };
      prisma.user.findUnique.mockResolvedValue(existingUser);
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.update('user-1', { name: 'New Name' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New Name' },
      });
      expect(result).toEqual(updatedUser);
    });

    it('should throw NotFoundException when updating non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'Name' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserWorkflows', () => {
    it('should return workflows for a user', async () => {
      const user = { id: 'user-1' };
      const workflows = [
        { id: 'wf-1', userId: 'user-1', name: 'Test Workflow' },
      ];
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.workflow.findMany.mockResolvedValue(workflows);

      const result = await service.getUserWorkflows('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(prisma.workflow.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(workflows);
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserWorkflows('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
