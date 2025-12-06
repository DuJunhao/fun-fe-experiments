const express = require('express');
const path = require('path');
const app = express();

// Cloud Run 会通过环境变量注入 PORT，默认为 8080
const port = process.env.PORT || 8080;

// 设置静态文件目录，指向 public 文件夹
app.use(express.static(path.join(__dirname, 'public')));

// 所有请求都返回 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});