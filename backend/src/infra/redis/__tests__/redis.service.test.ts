import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: vi.fn(),
    quit: vi.fn(),
    xAdd: vi.fn(),
    publish: vi.fn(),
    duplicate: vi.fn(() => ({
      connect: vi.fn(),
      subscribe: vi.fn(),
    })),
  })),
}));

import { createClient } from 'redis';
import { RedisService } from '../redis.service.js';

describe('RedisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create client with default URL and connect on construction', () => {
    const service = new RedisService();
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
  });

  it('should create client with REDIS_URL from env', () => {
    const original = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://custom:6380';
    new RedisService();
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://custom:6380' });
    process.env.REDIS_URL = original;
  });

  it('should return client via getClient', () => {
    const service = new RedisService();
    expect(service.getClient()).toBeDefined();
  });

  it('should convert alternating args to object for xadd', async () => {
    const service = new RedisService();
    const client = service.getClient() as any;
    client.xAdd.mockResolvedValue('1-0');
    const result = await service.xadd('stream', '*', 'f1', 'v1', 'f2', 'v2');
    expect(client.xAdd).toHaveBeenCalledWith('stream', '*', { f1: 'v1', f2: 'v2' });
    expect(result).toBe('1-0');
  });

  it('should call client.publish for publish', async () => {
    const service = new RedisService();
    const client = service.getClient() as any;
    client.publish.mockResolvedValue(1);
    const result = await service.publish('ch', 'msg');
    expect(client.publish).toHaveBeenCalledWith('ch', 'msg');
    expect(result).toBe(1);
  });

  it('should duplicate client and subscribe for subscribe', async () => {
    const service = new RedisService();
    const client = service.getClient() as any;
    const callback = vi.fn();
    const subscriber = await service.subscribe('ch', callback);
    expect(client.duplicate).toHaveBeenCalled();
    expect(subscriber).toBeDefined();
  });

  it('should quit client on module destroy', async () => {
    const service = new RedisService();
    const client = service.getClient() as any;
    await service.onModuleDestroy();
    expect(client.quit).toHaveBeenCalled();
  });
});
