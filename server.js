/**
 * MCP 代理服务器主程序
 * 专为钉钉 AI 助理优化的高性能、高稳定性代理服务
 */

const express = require('express');
const dotenv = require('dotenv');
const ProxyManager = require('./proxy');

// 加载环境变量
dotenv.config();

class MCPProxyServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    // 初始化代理管理器
    this.proxyManager = new ProxyManager({
      maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 50,
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 35000,
      connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT) || 8000,
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
      retryDelay: parseInt(process.env.RETRY_DELAY) || 500,
      maxRetryDelay: parseInt(process.env.MAX_RETRY_DELAY) || 3000,
      difyBaseUrl: process.env.DIFY_BASE_URL || 'http://dify.ireborn.com.cn'
    });
    
    // 服务器统计
    this.stats = {
      startTime: Date.now(),
      totalRequests: 0,
      successRequests: 0,
      errorRequests: 0
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.setupGracefulShutdown();
  }
  
  /**
   * 设置中间件
   */
  setupMiddleware() {
    // 请求体解析
    this.app.use(express.json({ 
      limit: '1mb',
      strict: true 
    }));
    
    // CORS 支持
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      
      next();
    });
    
    // 请求日志和统计
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      this.stats.totalRequests++;
      
      // 记录请求
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
      
      // 响应完成后记录统计
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        
        if (status >= 200 && status < 400) {
          this.stats.successRequests++;
        } else {
          this.stats.errorRequests++;
        }
        
        console.log(`[${new Date().toISOString()}] ${status} ${req.method} ${req.url} - ${duration}ms`);
      });
      
      next();
    });
  }
  
  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查端点
    this.app.get('/health', (req, res) => {
      const uptime = Date.now() - this.stats.startTime;
      const memoryUsage = process.memoryUsage();
      
      res.json({
        status: 'healthy',
        uptime: Math.floor(uptime / 1000),
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
        },
        stats: {
          ...this.stats,
          successRate: this.stats.totalRequests > 0 ? 
            ((this.stats.successRequests / this.stats.totalRequests) * 100).toFixed(2) + '%' : '0%'
        },
        proxy: this.proxyManager.getStats()
      });
    });
    
    // 代理状态端点
    this.app.get('/status', (req, res) => {
      res.json({
        proxy: this.proxyManager.getStats(),
        server: {
          uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
          requests: this.stats
        }
      });
    });
    
    // 核心 MCP 代理路由
    this.app.post('/mcp/:serverId', async (req, res) => {
      const { serverId } = req.params;
      const mcpRequest = req.body;
      
      // 设置响应头
      res.setHeader('Content-Type', 'application/json');
      
      try {
        console.log(`处理 MCP 请求: ${serverId}:${mcpRequest?.method}`);
        
        // 通过代理管理器处理请求
        const result = await this.proxyManager.processRequest(serverId, mcpRequest);
        
        res.json(result);
        
      } catch (error) {
        console.error(`MCP 代理错误: ${serverId}`, error);
        
        // 返回标准错误响应
        const errorResponse = {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "内部服务器错误",
            data: { 
              server_id: serverId,
              error_type: error.name || 'UnknownError'
            }
          },
          id: mcpRequest?.id || null
        };
        
        res.status(500).json(errorResponse);
      }
    });
    
    // 根路径信息
    this.app.get('/', (req, res) => {
      res.json({
        name: 'MCP Proxy Server',
        version: '2.0.0',
        description: 'High-performance MCP proxy server optimized for DingTalk AI Assistant',
        endpoints: {
          proxy: 'POST /mcp/{serverId}',
          health: 'GET /health',
          status: 'GET /status'
        },
        usage: {
          dify_url_format: 'http://dify.ireborn.com.cn/mcp/server/{serverId}/mcp',
          proxy_url_format: 'https://your-domain.com/mcp/{serverId}',
          example: {
            dify: 'http://dify.ireborn.com.cn/mcp/server/ABC123XYZ/mcp',
            proxy: 'https://your-domain.com/mcp/ABC123XYZ'
          }
        }
      });
    });
    
    // 404 处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Method not found",
          data: { path: req.originalUrl }
        },
        id: null
      });
    });
  }
  
  /**
   * 设置错误处理
   */
  setupErrorHandling() {
    // JSON 解析错误处理
    this.app.use((error, req, res, next) => {
      if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error",
            data: { details: "Invalid JSON format" }
          },
          id: null
        });
      }
      
      next(error);
    });
    
    // 全局错误处理
    this.app.use((error, req, res, next) => {
      console.error('未处理的错误:', error);
      
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: { 
            error_type: error.name || 'UnknownError'
          }
        },
        id: null
      });
    });
    
    // 未捕获异常处理
    process.on('uncaughtException', (error) => {
      console.error('未捕获异常:', error);
      this.gracefulShutdown('SIGTERM');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('未处理的 Promise 拒绝:', reason);
      console.error('Promise:', promise);
    });
  }
  
  /**
   * 设置优雅关闭
   */
  setupGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`收到 ${signal} 信号，开始优雅关闭...`);
        this.gracefulShutdown(signal);
      });
    });
  }
  
  /**
   * 优雅关闭服务器
   * @param {string} signal - 关闭信号
   */
  gracefulShutdown(signal) {
    console.log(`开始优雅关闭 (${signal})...`);
    
    // 停止接受新连接
    if (this.server) {
      this.server.close(() => {
        console.log('HTTP 服务器已关闭');
        
        // 清理代理管理器资源
        if (this.proxyManager) {
          this.proxyManager.cleanup();
        }
        
        console.log('优雅关闭完成');
        process.exit(0);
      });
      
      // 强制关闭超时
      setTimeout(() => {
        console.error('强制关闭服务器');
        process.exit(1);
      }, 10000);
    } else {
      process.exit(0);
    }
  }
  
  /**
   * 启动服务器
   */
  start() {
    this.server = this.app.listen(this.port, '0.0.0.0', () => {
      console.log('='.repeat(60));
      console.log('🚀 MCP 代理服务器已启动');
      console.log('='.repeat(60));
      console.log(`📡 监听端口: ${this.port}`);
      console.log(`🌍 服务地址: http://0.0.0.0:${this.port}`);
      console.log(`📊 健康检查: http://0.0.0.0:${this.port}/health`);
      console.log(`📈 状态监控: http://0.0.0.0:${this.port}/status`);
      console.log('='.repeat(60));
      console.log('💡 使用说明:');
      console.log('   Dify URL: http://dify.ireborn.com.cn/mcp/server/{serverId}/mcp');
      console.log('   代理 URL: http://your-domain.com/mcp/{serverId}');
      console.log('='.repeat(60));
    });
    
    // 服务器错误处理
    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${this.port} 已被占用`);
      } else {
        console.error('❌ 服务器启动错误:', error);
      }
      process.exit(1);
    });
  }
}

// 启动服务器
if (require.main === module) {
  const server = new MCPProxyServer();
  server.start();
}

module.exports = MCPProxyServer;
