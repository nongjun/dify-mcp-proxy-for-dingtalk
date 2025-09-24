/**
 * MCP 代理服务器核心逻辑模块
 * 处理异步队列、重试机制和请求转发
 */

const axios = require('axios');
const axiosRetry = require('axios-retry');
const PQueue = require('p-queue');
const http = require('http');
const https = require('https');

const CacheManager = require('./cache');
const { CircuitBreakerManager } = require('./circuit-breaker');
const { handleProxyError, createErrorResponse, ErrorCodes } = require('./errors');

class ProxyManager {
  constructor(options = {}) {
    // 配置参数
    this.config = {
      maxConcurrentRequests: options.maxConcurrentRequests || 50,
      requestTimeout: options.requestTimeout || 35000,
      connectionTimeout: options.connectionTimeout || 8000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 500,
      maxRetryDelay: options.maxRetryDelay || 3000,
      difyBaseUrl: options.difyBaseUrl || 'http://dify.ireborn.com.cn',
      ...options
    };
    
    // 初始化组件
    this.cacheManager = new CacheManager();
    this.circuitBreakerManager = new CircuitBreakerManager({
      failureThreshold: 5,
      recoveryTimeout: 30000
    });
    
    // 全局请求队列
    this.globalQueue = new PQueue({
      concurrency: this.config.maxConcurrentRequests,
      timeout: 40000,
      throwOnTimeout: true
    });
    
    // 每个服务器的独立队列
    this.serverQueues = new Map();
    
    // 配置 HTTP 代理
    this.setupHttpAgent();
    
    // 配置 axios 重试
    this.setupAxiosRetry();
    
    console.log('代理管理器已初始化', {
      maxConcurrent: this.config.maxConcurrentRequests,
      requestTimeout: this.config.requestTimeout,
      retryAttempts: this.config.retryAttempts
    });
  }
  
  /**
   * 设置 HTTP 连接代理
   */
  setupHttpAgent() {
    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 100,
      maxFreeSockets: 20,
      timeout: this.config.connectionTimeout,
      freeSocketTimeout: 15000
    });
    
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 100,
      maxFreeSockets: 20,
      timeout: this.config.connectionTimeout,
      freeSocketTimeout: 15000
    });
  }
  
  /**
   * 设置 axios 重试配置
   */
  setupAxiosRetry() {
    axiosRetry(axios, {
      retries: this.config.retryAttempts,
      retryDelay: (retryCount) => {
        const delay = Math.min(
          this.config.retryDelay * Math.pow(2, retryCount - 1),
          this.config.maxRetryDelay
        );
        console.log(`重试第 ${retryCount} 次，延迟 ${delay}ms`);
        return delay;
      },
      retryCondition: (error) => {
        // 只重试网络错误和 5xx 服务器错误
        const isRetryable = axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                           (error.response && error.response.status >= 500);
        
        if (isRetryable) {
          console.log('检测到可重试错误:', error.code || error.message);
        }
        
        return isRetryable;
      }
    });
  }
  
  /**
   * 获取服务器专用队列
   * @param {string} serverId - 服务器 ID
   * @returns {PQueue} 队列实例
   */
  getServerQueue(serverId) {
    if (!this.serverQueues.has(serverId)) {
      const queue = new PQueue({
        concurrency: 10,    // 每个服务器最大并发 10
        timeout: 40000,
        throwOnTimeout: true
      });
      
      this.serverQueues.set(serverId, queue);
      console.log(`创建服务器队列: ${serverId}`);
    }
    
    return this.serverQueues.get(serverId);
  }
  
  /**
   * 获取请求优先级
   * @param {string} method - MCP 方法名
   * @returns {number} 优先级值（越高越优先）
   */
  getPriority(method) {
    const priorities = {
      'initialize': 10,      // 最高优先级
      'tools/list': 8,       // 高优先级
      'tools/call': 5,       // 普通优先级
      'notifications/initialized': 7
    };
    
    return priorities[method] || 1;
  }
  
  /**
   * 验证 MCP 请求格式
   * @param {Object} mcpRequest - MCP 请求对象
   * @returns {boolean} 是否有效
   */
  isValidMCPRequest(mcpRequest) {
    return mcpRequest &&
           mcpRequest.jsonrpc === '2.0' &&
           typeof mcpRequest.method === 'string' &&
           (mcpRequest.id !== undefined);
  }
  
  /**
   * 处理代理请求（主入口）
   * @param {string} serverId - 服务器 ID
   * @param {Object} mcpRequest - MCP 请求对象
   * @returns {Promise<Object>} 响应结果
   */
  async processRequest(serverId, mcpRequest) {
    const startTime = Date.now();
    
    try {
      // 1. 验证请求格式
      if (!this.isValidMCPRequest(mcpRequest)) {
        return createErrorResponse(
          ErrorCodes.INVALID_REQUEST,
          '无效的 MCP 请求格式',
          null,
          mcpRequest.id
        );
      }
      
      // 2. 检查缓存
      const cached = this.cacheManager.get(serverId, mcpRequest);
      if (cached) {
        console.log(`缓存命中: ${serverId}:${mcpRequest.method}`);
        return cached;
      }
      
      // 3. 获取熔断器
      const circuitBreaker = this.circuitBreakerManager.getBreaker(serverId);
      
      // 4. 通过全局队列处理请求
      const result = await this.globalQueue.add(
        () => circuitBreaker.execute(() => this.forwardRequest(serverId, mcpRequest)),
        { 
          priority: this.getPriority(mcpRequest.method)
        }
      );
      
      // 5. 缓存成功响应
      this.cacheManager.set(serverId, mcpRequest, result);
      
      const duration = Date.now() - startTime;
      console.log(`请求完成: ${serverId}:${mcpRequest.method}, 耗时: ${duration}ms`);
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`请求失败: ${serverId}:${mcpRequest.method}, 耗时: ${duration}ms`, error.message);
      
      // 处理熔断器错误
      if (error.code === 'CIRCUIT_BREAKER_OPEN') {
        return createErrorResponse(
          ErrorCodes.CIRCUIT_BREAKER_OPEN,
          error.message,
          { server_id: serverId },
          mcpRequest.id
        );
      }
      
      return handleProxyError(error, serverId);
    }
  }
  
  /**
   * 转发请求到 Dify
   * @param {string} serverId - 服务器 ID
   * @param {Object} mcpRequest - MCP 请求对象
   * @returns {Promise<Object>} Dify 响应
   */
  async forwardRequest(serverId, mcpRequest) {
    const difyUrl = `${this.config.difyBaseUrl}/mcp/server/${serverId}/mcp`;
    
    const axiosConfig = {
      timeout: this.config.requestTimeout,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MCP-Proxy-Stable/2.0',
        'Accept': 'application/json'
      },
      // 禁用自动解压缩，避免潜在问题
      decompress: false
    };
    
    console.log(`转发请求: ${mcpRequest.method} -> ${difyUrl}`);
    
    try {
      const response = await axios.post(difyUrl, mcpRequest, axiosConfig);
      
      // 验证响应格式
      if (response.data && typeof response.data === 'object') {
        return response.data;
      }
      
      throw new Error('Dify 返回了无效的响应格式');
      
    } catch (error) {
      console.error(`转发失败: ${serverId}:${mcpRequest.method}`, {
        error: error.message,
        code: error.code,
        status: error.response?.status
      });
      
      throw error;
    }
  }
  
  /**
   * 获取代理统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      queues: {
        global: {
          size: this.globalQueue.size,
          pending: this.globalQueue.pending,
          concurrency: this.globalQueue.concurrency
        },
        servers: Array.from(this.serverQueues.entries()).map(([serverId, queue]) => ({
          serverId,
          size: queue.size,
          pending: queue.pending
        }))
      },
      cache: this.cacheManager.getStats(),
      circuitBreakers: this.circuitBreakerManager.getStats()
    };
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    // 清空所有队列
    this.globalQueue.clear();
    this.serverQueues.forEach(queue => queue.clear());
    
    // 清空缓存
    this.cacheManager.clearAll();
    
    // 重置熔断器
    this.circuitBreakerManager.resetAll();
    
    console.log('代理管理器资源已清理');
  }
}

module.exports = ProxyManager;
