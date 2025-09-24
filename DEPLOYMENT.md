# MCP 代理服务器部署指南

本文档详细说明如何在生产环境中部署 MCP 代理服务器。

## 🎯 部署目标

1. **测试环境**: 120.79.242.43 服务器
2. **生产环境**: dify.ireborn.com.cn (47.112.29.0) 服务器

## 📋 部署前准备

### 系统要求

- **操作系统**: Ubuntu 20.04+ / CentOS 8+ / Debian 11+
- **内存**: 最少 1GB，推荐 2GB+
- **CPU**: 最少 1 核，推荐 2 核+
- **磁盘**: 最少 10GB 可用空间
- **网络**: 能访问 dify.ireborn.com.cn

### 必需软件

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y docker.io docker-compose curl git

# CentOS/RHEL
sudo yum install -y docker docker-compose curl git

# 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker

# 将用户添加到 docker 组 (可选)
sudo usermod -aG docker $USER
```

## 🚀 快速部署

### 方法 1: 使用 Docker Compose (推荐)

```bash
# 1. 上传项目文件到服务器
# 可以使用 scp, rsync, 或 git clone

# 2. 进入项目目录
cd mcp-proxy-server

# 3. 复制环境配置
cp env.example .env

# 4. 编辑配置 (可选)
nano .env

# 5. 启动服务
docker-compose up -d

# 6. 验证部署
curl http://localhost:3000/health
```

### 方法 2: 直接 Docker 运行

```bash
# 构建镜像
docker build -t mcp-proxy-server .

# 运行容器
docker run -d \
  --name mcp-proxy-server \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DIFY_BASE_URL=http://dify.ireborn.com.cn \
  mcp-proxy-server

# 查看日志
docker logs -f mcp-proxy-server
```

## 🔧 详细配置

### 环境变量配置

创建 `.env` 文件或在 docker-compose.yml 中配置：

```bash
# 基础配置
NODE_ENV=production
PORT=3000

# 性能优化
MAX_CONCURRENT_REQUESTS=50
REQUEST_TIMEOUT=35000
CONNECTION_TIMEOUT=8000

# 缓存设置
CACHE_ENABLED=true
CACHE_TTL_INITIALIZE=600
CACHE_TTL_TOOLS_LIST=300

# 重试机制
RETRY_ATTEMPTS=3
RETRY_DELAY=500
MAX_RETRY_DELAY=3000

# 熔断器保护
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=30000

# Dify 服务器地址
DIFY_BASE_URL=http://dify.ireborn.com.cn
```

### Docker Compose 完整配置

```yaml
version: '3.8'

services:
  mcp-proxy:
    build: .
    container_name: mcp-proxy-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - MAX_CONCURRENT_REQUESTS=50
      - REQUEST_TIMEOUT=35000
      - CONNECTION_TIMEOUT=8000
      - RETRY_ATTEMPTS=3
      - RETRY_DELAY=500
      - MAX_RETRY_DELAY=3000
      - CACHE_ENABLED=true
      - CACHE_TTL_INITIALIZE=600
      - CACHE_TTL_TOOLS_LIST=300
      - CIRCUIT_BREAKER_ENABLED=true
      - CIRCUIT_BREAKER_THRESHOLD=5
      - CIRCUIT_BREAKER_TIMEOUT=30000
      - DIFY_BASE_URL=http://dify.ireborn.com.cn
    volumes:
      - /etc/localtime:/etc/localtime:ro
    networks:
      - mcp-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    # 资源限制 (可选)
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'
        reservations:
          memory: 128M
          cpus: '0.25'

networks:
  mcp-network:
    driver: bridge
```

## 🌐 反向代理配置

### Nginx 配置

创建 `/etc/nginx/sites-available/mcp-proxy` 文件：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名
    
    # 访问日志
    access_log /var/log/nginx/mcp-proxy.access.log;
    error_log /var/log/nginx/mcp-proxy.error.log;
    
    # 代理配置
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
        
        # 超时配置 (重要!)
        proxy_connect_timeout 8s;
        proxy_send_timeout 35s;
        proxy_read_timeout 35s;
        
        # 缓冲区配置
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }
    
    # 健康检查端点
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }
}
```

启用配置：

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/mcp-proxy /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx
```

### SSL/HTTPS 配置 (推荐)

使用 Let's Encrypt 获取免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo crontab -e
# 添加以下行:
# 0 12 * * * /usr/bin/certbot renew --quiet
```

## 📊 监控和日志

### 基础监控

```bash
# 查看服务状态
docker-compose ps

# 查看实时日志
docker-compose logs -f

# 查看资源使用
docker stats mcp-proxy-server

# 健康检查
curl http://localhost:3000/health

# 详细状态
curl http://localhost:3000/status
```

### 日志管理

配置日志轮转：

```bash
# 创建 logrotate 配置
sudo nano /etc/logrotate.d/mcp-proxy

# 添加内容:
/var/log/nginx/mcp-proxy.*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload nginx
    endscript
}
```

### 性能监控脚本

创建简单的监控脚本：

```bash
#!/bin/bash
# monitor.sh

echo "=== MCP 代理服务器状态 ==="
echo "时间: $(date)"
echo ""

# 检查容器状态
echo "容器状态:"
docker-compose ps

echo ""

# 检查健康状态
echo "健康检查:"
curl -s http://localhost:3000/health | jq .

echo ""

# 检查资源使用
echo "资源使用:"
docker stats --no-stream mcp-proxy-server

echo ""

# 检查最近的错误日志
echo "最近错误 (最近10条):"
docker-compose logs --tail=10 | grep -i error
```

## 🚨 故障排除

### 常见问题和解决方案

1. **服务启动失败**
```bash
# 查看详细错误
docker-compose logs

# 检查端口占用
sudo netstat -tlnp | grep 3000

# 检查权限
ls -la /var/run/docker.sock
```

2. **连接 Dify 失败**
```bash
# 测试网络连通性
curl -v http://dify.ireborn.com.cn/health

# 检查 DNS 解析
nslookup dify.ireborn.com.cn

# 检查防火墙
sudo ufw status
```

3. **内存使用过高**
```bash
# 查看内存使用
free -h
docker stats

# 重启服务
docker-compose restart

# 调整内存限制
# 在 docker-compose.yml 中添加 mem_limit: 256m
```

4. **请求超时**
```bash
# 检查超时配置
grep -r TIMEOUT .env

# 测试响应时间
time curl http://localhost:3000/health

# 查看 Nginx 配置
sudo nginx -T | grep timeout
```

### 紧急恢复

```bash
# 快速重启
docker-compose restart

# 完全重新部署
docker-compose down
docker-compose up -d

# 清理并重新构建
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 🔄 更新部署

### 滚动更新

```bash
# 1. 备份当前版本
docker-compose down
cp -r . ../mcp-proxy-server-backup-$(date +%Y%m%d)

# 2. 更新代码
git pull  # 或上传新版本

# 3. 重新构建和部署
docker-compose build
docker-compose up -d

# 4. 验证更新
curl http://localhost:3000/health
```

### 回滚操作

```bash
# 如果更新失败，快速回滚
docker-compose down
cp -r ../mcp-proxy-server-backup-YYYYMMDD/* .
docker-compose up -d
```

## 📈 性能优化

### 系统级优化

```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 优化网络参数
echo "net.core.somaxconn = 65535" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65535" >> /etc/sysctl.conf
sysctl -p
```

### Docker 优化

```bash
# 配置 Docker daemon
sudo nano /etc/docker/daemon.json

{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}

sudo systemctl restart docker
```

## 🔒 安全配置

### 基础安全

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 配置防火墙
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# 禁用不必要的服务
sudo systemctl disable apache2  # 如果有的话
```

### Docker 安全

```bash
# 使用非 root 用户运行容器 (已在 Dockerfile 中配置)
# 限制容器权限
docker run --security-opt=no-new-privileges ...

# 定期更新基础镜像
docker-compose build --pull
```

## 📋 部署检查清单

### 部署前检查

- [ ] 服务器满足系统要求
- [ ] Docker 和 Docker Compose 已安装
- [ ] 网络能访问 dify.ireborn.com.cn
- [ ] 端口 3000 未被占用
- [ ] 环境变量配置正确

### 部署后验证

- [ ] 容器正常启动 (`docker-compose ps`)
- [ ] 健康检查通过 (`curl /health`)
- [ ] 能正常处理 MCP 请求
- [ ] 日志无严重错误
- [ ] 内存和 CPU 使用正常
- [ ] 反向代理配置正确 (如果使用)

### 生产环境额外检查

- [ ] SSL 证书配置正确
- [ ] 日志轮转配置
- [ ] 监控告警设置
- [ ] 备份策略制定
- [ ] 应急预案准备

这个部署指南涵盖了从基础部署到生产环境优化的所有关键步骤，确保 MCP 代理服务器能够稳定运行在目标服务器上。
