import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from '../filters/http-exception.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockRequest = {
      url: '/test-path',
    };
    mockHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue(mockResponse),
        getRequest: vi.fn().mockReturnValue(mockRequest),
      }),
    };
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should handle HttpException with string message', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        path: '/test-path',
        message: 'Not Found',
      }),
    );
  });

  it('should handle HttpException with object response', () => {
    const exception = new HttpException(
      { message: 'Validation failed', error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        path: '/test-path',
        message: 'Validation failed',
      }),
    );
  });

  it('should handle unknown exceptions as 500', () => {
    const exception = new Error('Unexpected error');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        path: '/test-path',
        message: 'Internal server error',
      }),
    );
  });

  it('should include timestamp in response', () => {
    const exception = new HttpException('Error', HttpStatus.BAD_REQUEST);

    filter.catch(exception, mockHost);

    const callArgs = mockResponse.json.mock.calls[0][0];
    expect(callArgs.timestamp).toBeDefined();
    expect(new Date(callArgs.timestamp).toISOString()).toBe(callArgs.timestamp);
  });
});
