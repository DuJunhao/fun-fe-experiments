const express = require('express');
const path = require('path');
const fs = require('fs'); // 引入文件系统模块
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 8080;
const BUCKET_NAME = process.env.BUCKET_NAME;

// --- 🔍 关键调试代码：启动时打印文件列表 ---
const publicPath = path.join(__dirname, 'public');
console.log(`[DEBUG] 正在检查静态文件目录: ${publicPath}`);

if (fs.existsSync(publicPath)) {
    const files = fs.readdirSync(publicPath);
    console.log(`[DEBUG] public 文件夹里的文件:`, files); // 看看这里有没有 index.html
} else {
    console.error(`[ERROR] 严重错误：容器里找不到 public 文件夹！`);
    console.error(`[ERROR] 当前目录 (__dirname) 是: ${__dirname}`);
    console.error(`[ERROR] 当前目录下的所有文件:`, fs.readdirSync(__dirname));
}
// ------------------------------------------

// 1. 健康检查 (最优先)
app.get('/health', (req, res) => res.status(200).send('OK'));

// 2. 静态资源
app.use(express.static(publicPath));

// 3. API 接口
app.get('/api/images', async (req, res) => {
    // ... 保持你之前的逻辑不变 ...
    try {
        if (!BUCKET_NAME) return res.status(500).json({ error: 'Bucket未配置' });
        const storage = new Storage();
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();
        const imageFiles = files.filter(f => /\.(jpg|png|gif|webp)$/i.test(f.name));
        const assets = await Promise.all(imageFiles.map(async f => {
             const [url] = await f.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 3600 * 1000 });
             return { name: f.name, url };
        }));
        res.json(assets);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. 兜底路由 (打印详细错误)
app.get('*', (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`
            <h1>404 Error</h1>
            <p>后端服务正常运行，但找不到 index.html</p>
            <p>Debug info: Public path is ${publicPath}</p>
        `);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});