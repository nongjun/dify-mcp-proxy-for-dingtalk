/**
 * MCP 代理服务器缓存管理模块
 * 提供智能缓存策略，提升响应速度
 */

const NodeCache = require('node-cache');
const crypto = require('crypto');

class CacheManager {
  constructor() {
    // 初始化缓存实例
    this.cache = new NodeCache({
      stdTTL: 300,              // 默认 TTL 5分钟
      checkperiod: 60,          // 每分钟检查过期键
      useClones: false,         // 性能优化：不克隆对象
      maxKeys: 1000            // 最大缓存键数量
    });
    
    // 不同方法的缓存时间配置（秒）
    this.cacheTTL = {
      'initialize': 600,        // 初始化缓存 10分钟
      'tools/list': 300,        // 工具列表缓存 5分钟
      'tools/call': 0           // 工具调用不缓存
    };
    
    // 缓存统计
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0
    };
  }
  
  /**
   * 生成缓存键
   * @param {string} serverId - 服务器 ID
   * @param {Object} mcpRequest - MCP 请求对象
   * @returns {string} 缓存键
   */
  generateCacheKey(serverId, mcpRequest) {
    const { method, params } = mcpRequest;
    const paramsHash = params ? 
      crypto.createHash('md5').update(JSON.stringify(params)).digest('hex') : 
      'no-params';
    
    return `${serverId}:${method}:${paramsHash}`;
  }
  
  /**
   * 检查是否应该缓存该方法
   * @param {string} method - MCP 方法名
   * @returns {boolean} 是否应该缓存
   */
  shouldCache(method) {
    const ttl = this.cacheTTL[method];
    return ttl !== undefined && ttl > 0;
  }
  
  /**
   * 获取方法的缓存 TTL
   * @param {string} method - MCP 方法名
   * @returns {number} TTL（秒）
   */
  getCacheTTL(method) {
    return this.cacheTTL[method] || 0;
  }
  
  /**
   * 从缓存获取数据
   * @param {string} serverId - 服务器 ID
   * @param {Object} mcpRequest - MCP 请求对象
   * @returns {Object|null} 缓存的响应或 null
   */
  get(serverId, mcpRequest) {
    if (!this.shouldCache(mcpRequest.method)) {
      return null;
    }
    
    const key = this.generateCacheKey(serverId, mcpRequest);
    const cached = this.cache.get(key);
    
    if (cached) {
      this.stats.hits++;
      console.log(`缓存命中: ${key}`);
      return cached;
    }
    
    this.stats.misses++;
    return null;
  }
  
  /**
   * 设置缓存数据
   * @param {string} serverId - 服务器 ID
   * @param {Object} mcpRequest - MCP 请求对象
   * @param {Object} response - 响应数据
   */
  set(serverId, mcpRequest, response) {
    if (!this.shouldCache(mcpRequest.method)) {
      return;
    }
    
    // 只缓存成功的响应
    if (response.error) {
      return;
    }
    
    const key = this.generateCacheKey(serverId, mcpRequest);
    const ttl = this.getCacheTTL(mcpRequest.method);
    
    this.cache.set(key, response, ttl);
    this.stats.sets++;
    console.log(`缓存设置: ${key}, TTL: ${ttl}秒`);
  }
  
  /**
   * 清除特定服务器的所有缓存
   * @param {string} serverId - 服务器 ID
   */
  clearServerCache(serverId) {
    const keys = this.cache.keys();
    const serverKeys = keys.filter(key => key.startsWith(serverId + ':'));
    
    serverKeys.forEach(key => this.cache.del(key));
    console.log(`清除服务器 ${serverId} 的 ${serverKeys.length} 个缓存项`);
  }
  
  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 ?
      (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      keys: this.cache.keys().length
    };
  }
  
  /**
   * 清除所有缓存
   */
  clearAll() {
    this.cache.flushAll();
    console.log('已清除所有缓存');
  }
}

module.exports = CacheManager;
