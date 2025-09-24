/**
 * MCP 代理服务器熔断器模块
 * 提供服务保护机制，防止级联故障
 */

class CircuitBreaker {
  constructor(serverId, options = {}) {
    this.serverId = serverId;
    
    // 配置参数
    this.failureThreshold = options.failureThreshold || 5;    // 失败阈值
    this.recoveryTimeout = options.recoveryTimeout || 30000;  // 恢复超时 30秒
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 监控周期 1分钟
    
    // 状态管理
    this.state = 'CLOSED';        // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;        // 失败计数
    this.successCount = 0;        // 成功计数
    this.nextAttempt = Date.now(); // 下次尝试时间
    this.lastFailureTime = null;   // 最后失败时间
    
    // 统计信息
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      circuitBreakerTrips: 0
    };
    
    console.log(`熔断器已初始化: ${serverId}, 失败阈值: ${this.failureThreshold}`);
  }
  
  /**
   * 执行受保护的函数
   * @param {Function} fn - 要执行的异步函数
   * @returns {Promise} 执行结果
   */
  async execute(fn) {
    this.stats.totalRequests++;
    
    // 检查熔断器状态
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const error = new Error(`熔断器开启 - 服务 ${this.serverId} 暂时不可用`);
        error.code = 'CIRCUIT_BREAKER_OPEN';
        throw error;
      }
      
      // 尝试半开状态
      this.state = 'HALF_OPEN';
      console.log(`熔断器半开: ${this.serverId}`);
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }
  
  /**
   * 处理成功情况
   */
  onSuccess() {
    this.stats.totalSuccesses++;
    this.successCount++;
    
    if (this.state === 'HALF_OPEN') {
      // 半开状态下成功，重置为关闭状态
      this.reset();
      console.log(`熔断器重置为关闭状态: ${this.serverId}`);
    } else if (this.state === 'CLOSED') {
      // 关闭状态下的成功，重置失败计数
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }
  
  /**
   * 处理失败情况
   * @param {Error} error - 错误对象
   */
  onFailure(error) {
    this.stats.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    console.log(`熔断器记录失败: ${this.serverId}, 失败次数: ${this.failureCount}/${this.failureThreshold}`);
    
    // 检查是否需要打开熔断器
    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.trip();
    } else if (this.state === 'HALF_OPEN') {
      // 半开状态下失败，立即打开熔断器
      this.trip();
    }
  }
  
  /**
   * 触发熔断器（打开状态）
   */
  trip() {
    this.state = 'OPEN';
    this.nextAttempt = Date.now() + this.recoveryTimeout;
    this.stats.circuitBreakerTrips++;
    
    console.log(`熔断器已打开: ${this.serverId}, 将在 ${this.recoveryTimeout/1000}秒 后尝试恢复`);
  }
  
  /**
   * 重置熔断器到关闭状态
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
  }
  
  /**
   * 获取熔断器状态
   * @returns {Object} 状态信息
   */
  getState() {
    return {
      serverId: this.serverId,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      stats: { ...this.stats }
    };
  }
  
  /**
   * 检查熔断器是否允许请求通过
   * @returns {boolean} 是否允许请求
   */
  canExecute() {
    if (this.state === 'CLOSED') {
      return true;
    }
    
    if (this.state === 'OPEN') {
      return Date.now() >= this.nextAttempt;
    }
    
    if (this.state === 'HALF_OPEN') {
      return true;
    }
    
    return false;
  }
  
  /**
   * 强制重置熔断器（用于管理操作）
   */
  forceReset() {
    this.reset();
    console.log(`熔断器强制重置: ${this.serverId}`);
  }
}

/**
 * 熔断器管理器
 * 管理多个服务的熔断器实例
 */
class CircuitBreakerManager {
  constructor(defaultOptions = {}) {
    this.breakers = new Map();
    this.defaultOptions = {
      failureThreshold: 5,
      recoveryTimeout: 30000,
      monitoringPeriod: 60000,
      ...defaultOptions
    };
  }
  
  /**
   * 获取或创建服务的熔断器
   * @param {string} serverId - 服务 ID
   * @param {Object} options - 熔断器选项
   * @returns {CircuitBreaker} 熔断器实例
   */
  getBreaker(serverId, options = {}) {
    if (!this.breakers.has(serverId)) {
      const breakerOptions = { ...this.defaultOptions, ...options };
      const breaker = new CircuitBreaker(serverId, breakerOptions);
      this.breakers.set(serverId, breaker);
    }
    
    return this.breakers.get(serverId);
  }
  
  /**
   * 获取所有熔断器状态
   * @returns {Object} 所有熔断器状态
   */
  getAllStates() {
    const states = {};
    for (const [serverId, breaker] of this.breakers) {
      states[serverId] = breaker.getState();
    }
    return states;
  }
  
  /**
   * 重置所有熔断器
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.forceReset();
    }
    console.log('所有熔断器已重置');
  }
  
  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalBreakers: this.breakers.size,
      openBreakers: 0,
      halfOpenBreakers: 0,
      closedBreakers: 0,
      totalTrips: 0
    };
    
    for (const breaker of this.breakers.values()) {
      const state = breaker.getState();
      stats.totalTrips += state.stats.circuitBreakerTrips;
      
      switch (state.state) {
        case 'OPEN':
          stats.openBreakers++;
          break;
        case 'HALF_OPEN':
          stats.halfOpenBreakers++;
          break;
        case 'CLOSED':
          stats.closedBreakers++;
          break;
      }
    }
    
    return stats;
  }
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager
};
