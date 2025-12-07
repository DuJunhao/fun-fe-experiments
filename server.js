const express = require('express');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 8080;

// 获取环境变量中的 Bucket 名字
const BUCKET_NAME = process.env.BUCKET_NAME;

// 初始化 GCS 客户端 (在 Cloud Run 上会自动使用服务账号认证)
const storage = new Storage();

// 托管 public 文件夹下的静态文件 (HTML/JS/CSS)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * API: 获取素材库列表
 * 功能：列出 Bucket 里的所有图片，并生成临时访问链接
 */
app.get('/api/images', async (req, res) => {
    try {
        if (!BUCKET_NAME) {
            return res.status(500).json({ error: '服务端未配置 BUCKET_NAME' });
        }

        // 1. 获取 Bucket 下的文件列表
        const [files] = await storage.bucket(BUCKET_NAME).getFiles();

        // 2. 过滤：只保留图片文件 (jpg, png, webp 等)
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
        );

        // 3. 生成签名 URL (让前端可以访问私有 Bucket 里的图片)
        // 并行处理所有图片以加快速度
        const assets = await Promise.all(imageFiles.map(async (file) => {
            // 生成一个有效期为 60 分钟的链接
            const [url] = await file.getSignedUrl({
                version: 'v4',                                                                              
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000,                                                                                                                                                                                                                                     
            });

            return {
                name: file.name,
                url: url
            };
        }));

        // 返回给前端
        res.json(assets);

    } catch (error) {
        console.error('获取图片列表失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 任何其他请求返回 index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// 健康检查接口
// 负载均衡器或 Cloud Run 可以 ping 这个接口来确认服务活着
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});