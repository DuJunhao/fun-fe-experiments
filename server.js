const express = require('express');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 8080;
const BUCKET_NAME = process.env.BUCKET_NAME;

// --- 🔍 调试代码保持不变 ---
const publicPath = path.join(__dirname, 'public');
console.log(`[DEBUG] 检查目录: ${publicPath}`);
if (fs.existsSync(publicPath)) {
    console.log(`[DEBUG] 文件列表:`, fs.readdirSync(publicPath));
} else {
    console.error(`[ERROR] public 文件夹丢失！`);
}
// -------------------------

// 1. 健康检查
app.get('/health', (req, res) => res.status(200).send('OK'));

// 2. 静态资源
app.use(express.static(publicPath));

// 3. API 接口 
app.get('/api/images', async (req, res) => {
    try {
        if (!BUCKET_NAME) return res.status(500).json({ error: 'Bucket未配置' });
        
        const storage = new Storage();
        // 1. 动态获取 Bucket 里的文件列表 (保持动态性)
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();
        
        // 2. 过滤图片
        const imageFiles = files.filter(f => /\.(jpg|png|gif|webp)$/i.test(f.name));
        
        // 3. --- 核心修改：拼接 static 域名 ---
        const assets = imageFiles.map(f => {
            return { 
                name: f.name, 
                // 这里把 f.name (例如 "christa/1.jpg") 拼接到 static 域名后
                // 结果: https://static.refinefuture.com/christa/1.jpg
                url: `https://static.refinefuture.com/${f.name}` 
            };
        });

        res.json(assets);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: e.message }); 
    }
});

// 4. 兜底路由
app.get('*', (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('404 Not Found: index.html missing');
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});