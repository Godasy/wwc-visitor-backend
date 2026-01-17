// 引入需要的工具包
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 创建后端服务
const app = express();
// 允许前端跨域访问
app.use(cors());
// 支持接收 JSON 格式的数据
app.use(express.json());

// 配置数据库路径，自动创建 database 文件夹
const dbPath = path.join(__dirname, 'database', 'visitor.db');
if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// 连接 SQLite 数据库
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('数据库连接失败：', err.message);
    } else {
        console.log('✅ 数据库连接成功');
        // 创建访客记录表（不存在则创建）
        db.run(`CREATE TABLE IF NOT EXISTS visitors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            visit_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (!err) console.log('✅ 访客表创建成功');
        });
    }
});

// 接口 1：记录访客信息（前端访问时调用）
app.post('/api/record-visitor', (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.json({ success: false, msg: '缺少IP地址' });
    db.run(`INSERT INTO visitors (ip) VALUES (?)`, [ip], (err) => {
        if (err) res.json({ success: false });
        else res.json({ success: true });
    });
});

// 接口 2：获取访客统计数据（后台页面用）
app.get('/api/get-visitor-data', (req, res) => {
    // 获取总访客数
    db.get(`SELECT COUNT(*) AS total FROM visitors`, (err, totalRes) => {
        if (err) return res.json({ success: false });
        // 获取所有访客记录
        db.all(`SELECT * FROM visitors ORDER BY visit_time DESC`, (err, listRes) => {
            res.json({
                success: true,
                totalCount: totalRes.total || 0,
                lastVisit: listRes[0]?.visit_time || '暂无记录',
                ipList: listRes || []
            });
        });
    });
});

// 接口 3：重置访客数据（后台重置按钮用）
app.delete('/api/reset-visitor', (req, res) => {
    db.run(`DELETE FROM visitors`, (err) => {
        if (err) res.json({ success: false });
        else {
            db.run(`VACUUM`, () => res.json({ success: true }));
        }
    });
});

// 配置端口（兼容 Render 动态端口）
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`✅ 后端服务运行在端口 ${port}`);
});