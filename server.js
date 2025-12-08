const express = require('express');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 8080;
const BUCKET_NAME = process.env.BUCKET_NAME;

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// --- 1. 原有的图片接口 (保持不变) ---
app.get('/api/images', async (req, res) => {
    try {
        if (!BUCKET_NAME) return res.status(500).json({ error: 'Bucket未配置' });
        const storage = new Storage();
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();
        
        // 只过滤图片
        const imageFiles = files.filter(f => /\.(jpg|png|gif|webp)$/i.test(f.name));
        
        const assets = imageFiles.map(f => ({ 
            name: f.name, 
            url: `https://static.refinefuture.com/${f.name}` 
        }));

        res.json(assets);
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// --- 2. 【新增】背景音乐接口 ---
app.get('/api/music', async (req, res) => {
    try {
        if (!BUCKET_NAME) return res.status(500).json({ error: 'Bucket未配置' });
        
        const storage = new Storage();
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();

        // 【核心】过滤出 mp3 文件
        // 这里假设桶里只有一个 mp3，或者我们取第一个找到的
        const musicFile = files.find(f => f.name.toLowerCase().endsWith('.mp3'));

        if (musicFile) {
            // 返回 CDN 拼接后的地址
            res.json({
                name: musicFile.name,
                url: `https://static.refinefuture.com/${musicFile.name}`
            });
        } else {
            res.status(404).json({ error: 'Bucket里没有MP3文件' });
        }

    } catch (e) {
        console.error("获取音乐失败:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- 3. 兜底路由 ---
app.get('*', (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send('404 Not Found');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});