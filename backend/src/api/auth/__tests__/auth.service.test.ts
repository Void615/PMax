import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcrypt', () => ({
  compare: vi.fn(),
}));

import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';

function createMockUsersService() {
  return {
    findByEmail: vi.fn(),
    create: vi.fn(),
  } as any;
}

function createMockJwtService() {
  return {
    sign: vi.fn(),
  } as any;
}

describe('AuthService', () => {
  let service: AuthService;
  let usersService: ReturnType<typeof createMockUsersService>;
  let jwtService: ReturnType<typeof createMockJwtService>;

  beforeEach(() => {
    vi.clearAllMocks();
    usersService = createMockUsersService();
    jwtService = createMockJwtService();
    service = new AuthService(usersService, jwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user data (without password) when credentials are valid', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed_password',
        name: 'Test',
      };
      usersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password123');

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed_password');
      expect(result).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
      });
      expect(result).not.toHaveProperty('password');
    });

    it('should return null when user is not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('nonexistent@example.com', 'password123');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should return null when password is invalid', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed_password',
      };
      usersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as any).mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrong_password');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access_token and user', async () => {
      const user = { id: 'user-1', email: 'test@example.com' };
      jwtService.sign.mockReturnValue('jwt_token');

      const result = await service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'test@example.com' });
      expect(result).toEqual({
        access_token: 'jwt_token',
        user,
      });
    });
  });

  describe('register', () => {
    it('should create user and return login response', async () => {
      const dto = { email: 'new@example.com', password: 'password123', name: 'New User' };
      const createdUser = { id: 'user-2', ...dto };
      usersService.create.mockResolvedValue(createdUser);
      jwtService.sign.mockReturnValue('jwt_token');

      const result = await service.register(dto);

      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-2', email: 'new@example.com' });
      expect(result).toEqual({
        access_token: 'jwt_token',
        user: createdUser,
      });
    });
  });
});
