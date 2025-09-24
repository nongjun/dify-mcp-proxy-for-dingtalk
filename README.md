# MCP 代理服务器 V2.0

专为钉钉 AI 助理优化的高性能、高稳定性 MCP 代理服务器。

## 🎯 核心特性

- ✅ **零配置代理**: 自动映射所有 Dify MCP 服务，无需手动配置
- ✅ **钉钉优化**: 35秒响应超时，专门适配钉钉时限要求
- ✅ **异步处理**: 支持 50 并发请求，智能队列管理
- ✅ **智能重试**: 指数退避重试机制，最多 3 次重试
- ✅ **熔断保护**: 自动熔断故障服务，防止级联失败
- ✅ **智能缓存**: 多级缓存策略，显著提升响应速度
- ✅ **专业监控**: 完整的健康检查和状态监控

## 🚀 快速开始

### 1. URL 映射规则

```
Dify 原始地址: http://dify.ireborn.com.cn/mcp/server/{serverId}/mcp
代理后地址:   https://your-domain.com/mcp/{serverId}
```

**示例:**
```
Dify URL: http://dify.ireborn.com.cn/mcp/server/ABC123XYZ/mcp
代理 URL: https://your-domain.com/mcp/ABC123XYZ
```

### 2. 钉钉配置

在钉钉 AI 助理中配置 MCP 服务器：

```json
{
  "mcpServers": {
    "my-workflow": {
      "url": "https://your-domain.com/mcp/ABC123XYZ"
    }
  }
}
```

### 3. Docker 部署（推荐）

```bash
# 克隆项目
git clone <repository-url>
cd mcp-proxy-server

# 使用 Docker Compose 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 4. 本地开发

```bash
# 安装依赖
npm install

# 复制环境配置
cp env.example .env

# 启动开发服务器
npm run dev

# 或生产环境启动
npm start
```

## 📊 监控端点

### 健康检查
```bash
curl http://localhost:3000/health
```

**响应示例:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "2.0.0",
  "memory": {
    "rss": 45,
    "heapUsed": 32,
    "heapTotal": 42
  },
  "stats": {
    "totalRequests": 1250,
    "successRequests": 1230,
    "errorRequests": 20,
    "successRate": "98.40%"
  }
}
```

### 详细状态
```bash
curl http://localhost:3000/status
```

## ⚙️ 配置选项

### 环境变量

```bash
# 基础配置
NODE_ENV=production
PORT=3000

# 性能配置
MAX_CONCURRENT_REQUESTS=50    # 最大并发请求数
REQUEST_TIMEOUT=35000         # 请求超时 (毫秒)
CONNECTION_TIMEOUT=8000       # 连接超时 (毫秒)

# 缓存配置
CACHE_ENABLED=true
CACHE_TTL_INITIALIZE=600      # 初始化缓存时间 (秒)
CACHE_TTL_TOOLS_LIST=300      # 工具列表缓存时间 (秒)

# 重试配置
RETRY_ATTEMPTS=3              # 最大重试次数
RETRY_DELAY=500              # 初始重试延迟 (毫秒)
MAX_RETRY_DELAY=3000         # 最大重试延迟 (毫秒)

# 熔断器配置
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=5   # 失败阈值
CIRCUIT_BREAKER_TIMEOUT=30000 # 恢复超时 (毫秒)

# Dify 配置
DIFY_BASE_URL=http://dify.ireborn.com.cn
```

## 🏗️ 架构设计

```
钉钉 AI 助理 → MCP 代理服务器 → Dify MCP 服务
     ↑              ↑                ↑
  固定URL格式    智能异步转发      自动映射
```

### 核心组件

1. **异步队列管理**: 使用 p-queue 管理并发请求
2. **智能缓存系统**: 基于 node-cache 的多级缓存
3. **熔断器保护**: 自动检测和恢复故障服务
4. **重试机制**: 指数退避重试策略
5. **连接池优化**: HTTP 连接复用和优化

## 📈 性能指标

### 目标性能
- **代理延迟**: < 20ms
- **并发处理**: 50 个同时请求
- **内存使用**: < 200MB
- **CPU 使用**: < 10% (空闲时)

### 稳定性指标
- **可用性**: 99.95%
- **错误率**: < 0.1%
- **超时率**: < 1%
- **缓存命中率**: > 70%

## 🛠️ 部署指南

### 生产环境部署 (120.79.242.43)

1. **准备服务器**
```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker 和 Docker Compose
sudo apt install docker.io docker-compose -y

# 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker
```

2. **部署应用**
```bash
# 上传项目文件到服务器
scp -r mcp-proxy-server/ user@120.79.242.43:/opt/

# 登录服务器
ssh user@120.79.242.43

# 进入项目目录
cd /opt/mcp-proxy-server

# 启动服务
sudo docker-compose up -d

# 查看状态
sudo docker-compose ps
sudo docker-compose logs -f
```

3. **配置反向代理 (Nginx)**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时配置
        proxy_connect_timeout 8s;
        proxy_send_timeout 35s;
        proxy_read_timeout 35s;
    }
}
```

### 迁移到 Dify 服务器 (47.112.29.0)

当测试完成后，按相同步骤部署到 `dify.ireborn.com.cn` 服务器。

## 🔧 故障排除

### 常见问题

1. **连接 Dify 失败**
```bash
# 检查网络连通性
curl -v http://dify.ireborn.com.cn/mcp/server/test/mcp

# 查看容器日志
docker-compose logs mcp-proxy
```

2. **内存使用过高**
```bash
# 查看内存使用
docker stats mcp-proxy-server

# 调整内存限制
# 在 docker-compose.yml 中添加:
# mem_limit: 256m
```

3. **请求超时**
- 检查 `REQUEST_TIMEOUT` 配置
- 查看 Dify 服务器响应时间
- 检查网络延迟

### 日志分析

```bash
# 查看实时日志
docker-compose logs -f --tail=100

# 查看错误日志
docker-compose logs | grep -i error

# 查看性能统计
curl http://localhost:3000/status
```

## 📋 API 文档

### 代理端点

**POST /mcp/{serverId}**

转发 MCP 请求到对应的 Dify 服务器。

**请求格式:**
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {}
  },
  "id": 1
}
```

**响应格式:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {}
  },
  "id": 1
}
```

### 监控端点

- `GET /health` - 健康检查
- `GET /status` - 详细状态信息
- `GET /` - 服务信息

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

MIT License

## 🆘 支持

如有问题，请联系开发团队或创建 Issue。
