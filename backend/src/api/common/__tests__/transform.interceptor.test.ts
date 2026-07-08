import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { TransformInterceptor } from '../interceptors/transform.interceptor';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<any>;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should wrap response data with standard format', () => {
    const mockContext = {} as any;
    const testData = { id: 1, name: 'test' };
    const mockCallHandler = {
      handle: () => of(testData),
    };

    let result: any;
    interceptor.intercept(mockContext, mockCallHandler).subscribe(data => {
      result = data;
    });

    expect(result).toEqual({
      data: testData,
      code: 0,
      message: 'success',
      timestamp: expect.any(String),
    });
  });

  it('should handle null data', () => {
    const mockContext = {} as any;
    const mockCallHandler = {
      handle: () => of(null),
    };

    let result: any;
    interceptor.intercept(mockContext, mockCallHandler).subscribe(data => {
      result = data;
    });

    expect(result).toEqual({
      data: null,
      code: 0,
      message: 'success',
      timestamp: expect.any(String),
    });
  });

  it('should handle array data', () => {
    const mockContext = {} as any;
    const testData = [{ id: 1 }, { id: 2 }];
    const mockCallHandler = {
      handle: () => of(testData),
    };

    let result: any;
    interceptor.intercept(mockContext, mockCallHandler).subscribe(data => {
      result = data;
    });

    expect(result.data).toEqual(testData);
    expect(result.code).toBe(0);
  });

  it('should include valid ISO timestamp', () => {
    const mockContext = {} as any;
    const mockCallHandler = {
      handle: () => of('data'),
    };

    let result: any;
    interceptor.intercept(mockContext, mockCallHandler).subscribe(data => {
      result = data;
    });

    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
