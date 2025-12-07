const express = require('express');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 8080;

// 获取环境变量
const BUCKET_NAME = process.env.BUCKET_NAME;

// --- 1. 优先处理 API 和 健康检查 (放在最前面) ---

// 健康检查 (必须在 catch-all 之前)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API 接口
app.get('/api/images', async (req, res) => {
    // ... 你的 GCS 代码保持不变 ...
    try {
        if (!BUCKET_NAME) {
            return res.status(500).json({ error: '服务端未配置 BUCKET_NAME' });
        }
        const storage = new Storage();
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();
        const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name));
        
        const assets = await Promise.all(imageFiles.map(async (file) => {
            const [url] = await file.getSignedUrl({
                version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000,
            });
            return { name: file.name, url: url };
        }));
        res.json(assets);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- 2. 静态资源托管 ---
// 确保 Docker 里的路径是对的。__dirname 是 server.js 所在的目录
app.use(express.static(path.join(__dirname, 'public')));

// --- 3. 兜底路由 (放在最后) ---
// 任何没被上面捕获的请求，都返回 index.html
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    
    // 增加一个简单的错误打印，方便去 Cloud Run 日志排查
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("发送 index.html 失败:", err);
            res.status(404).send("404 Not Found: index.html 丢失或路径错误");
        }
    });
});

// --- 4. 启动服务 ---
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Current directory: ${__dirname}`); // 打印一下当前目录，方便调试
});