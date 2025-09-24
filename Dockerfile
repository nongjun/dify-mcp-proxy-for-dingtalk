# MCP 代理服务器 Docker 配置
FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache curl

# 设置工作目录
WORKDIR /app

# 复制 package 文件并安装依赖
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# 复制源代码
COPY src/ ./src/
COPY env.example ./.env

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001 -G nodejs

# 设置环境变量
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256 --enable-source-maps"
ENV PORT=3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 暴露端口
EXPOSE 3000

# 切换到非 root 用户
USER nodeuser

# 启动应用
CMD ["node", "src/server.js"]
