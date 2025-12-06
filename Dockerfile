# 使用官方轻量级 Node.js 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 并安装依赖
# 这一步单独做是为了利用 Docker 的缓存机制，加速构建
COPY package.json ./
RUN npm install --production

# 复制所有源代码
COPY . .

# Cloud Run 默认监听 8080，这里只是声明
EXPOSE 8080

# 启动命令
CMD ["npm", "start"]