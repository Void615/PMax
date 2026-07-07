/**
 * 节点执行重试机制。
 *
 * 提供带指数退避的重试执行器 executeWithRetry 和
 * 专用异常 NodeFatalError（重试耗尽时抛出）。
 */

/** 默认单次超时（秒）。 */
const NODE_TIMEOUT = 300;
/** 默认最大重试次数。 */
const MAX_RETRIES = 3;

/**
 * 节点在耗尽所有重试次数后仍然失败时抛出。
 *
 * 携带最后一次异常供上层解包。
 */
export class NodeFatalError extends Error {
    constructor(
        public readonly node: string,
        public readonly attempts: number,
        public readonly lastError: Error
    ) {
        super(`节点 '${node}' 在 ${attempts} 次重试后仍然失败: ${lastError}`);
        this.name = "NodeFatalError";
    }

    /** 从 lastError 提取错误码。 */
    get errorCode(): string {
        if (this.isAppException(this.lastError)) {
            return this.lastError.errorCode;
        }
        return this.lastError.constructor.name;
    }

    /** 从 lastError 提取人类可读的错误消息。 */
    get errorMessage(): string {
        if (this.isAppException(this.lastError)) {
            return this.lastError.message;
        }
        return String(this.lastError);
    }

    /** 从 lastError 提取附加详情。 */
    get errorDetails(): Record<string, any> | undefined {
        if (this.isAppException(this.lastError)) {
            return this.lastError.details;
        }
        return undefined;
    }

    /** 三元组 (errorCode, errorMessage, errorDetails)。 */
    get errorInfo(): [string, string, Record<string, any> | undefined] {
        return [this.errorCode, this.errorMessage, this.errorDetails];
    }

    /** 类型守卫：检查是否为 AppException 风格的异常。 */
    private isAppException(
        e: Error
    ): e is Error & { errorCode: string; details?: Record<string, any> } {
        return "errorCode" in e;
    }
}

/** 重试策略配置。 */
export interface RetryPolicyConfig {
    maxAttempts?: number;
    timeoutSec?: number;
    backoffBaseSec?: number;
}

/** 事件日志接口（由调用方提供实现）。 */
export interface RetryEventLogger {
    logNodeError(payload: {
        errorCode: string;
        errorMessage: string;
        retryCount: number;
        maxRetries: number;
    }): Promise<void>;
}

/**
 * 带指数退避的节点执行器。
 *
 * 重试策略：
 *   - 单次超时: retryPolicy.timeoutSec 或 300s
 *   - 最大重试: retryPolicy.maxAttempts 或 3
 *   - 退避等待: 第 n 次失败后等待 backoffBaseSec^n 秒
 *   - GraphInterrupt 直接传播，不参与重试
 *   - 全部重试耗尽后抛出 NodeFatalError
 *
 * @param nodeFn       async callable(state) -> dict，单次 agent 调用
 * @param state        传入 nodeFn 的当前状态
 * @param nodeName     节点标识（日志 + 异常）
 * @param eventLogger  事件日志器
 * @param retryPolicy  重试配置
 * @returns nodeFn 的返回值
 */
export async function executeWithRetry<T extends Record<string, any>>(
    nodeFn: (state: T) => Promise<Record<string, any>>,
    state: T,
    nodeName: string,
    eventLogger: RetryEventLogger,
    retryPolicy?: RetryPolicyConfig
): Promise<Record<string, any>> {
    const maxRetries = retryPolicy?.maxAttempts ?? MAX_RETRIES;
    const timeout = retryPolicy?.timeoutSec ?? NODE_TIMEOUT;
    const backoffBase = retryPolicy?.backoffBaseSec ?? 2;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await withTimeout(
                nodeFn(state),
                timeout * 1000,
                `节点 ${nodeName} 执行超时 (${timeout}s)`
            );
            return result;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));

            const innerCode =
                e instanceof Error && "errorCode" in e
                    ? (e as any).errorCode
                    : e instanceof Error
                        ? e.constructor.name
                        : "UnknownError";

            await eventLogger.logNodeError({
                errorCode: innerCode,
                errorMessage: String(e).slice(0, 500),
                retryCount: attempt,
                maxRetries,
            });

            if (attempt < maxRetries) {
                await sleep(Math.pow(backoffBase, attempt) * 1000);
                continue;
            }
            break;
        }
    }

    throw new NodeFatalError(nodeName, maxRetries, lastError!);
}

/** 带超时的 Promise 包装。 */
function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/** 异步等待。 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
