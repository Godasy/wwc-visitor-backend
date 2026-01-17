// 引入需要的工具包
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 创建后端服务
const app = express();

// 修复：加强跨域配置，兼容手机各种请求头
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

// 支持接收 JSON 格式的数据
app.use(express.json({ limit: '1mb' }));
// 兼容表单格式数据（兜底）
app.use(express.urlencoded({ extended: true }));

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

// 修复：接口加固，避免空IP写入，返回明确状态
app.post('/api/record-visitor', (req, res) => {
    const { ip } = req.body;
    // 兜底：若 IP 为空，赋值默认值
    const visitorIp = ip || '未知IP（手机端）';

    db.run(`INSERT INTO visitors (ip) VALUES (?)`, [visitorIp], (err) => {
        if (err) {
            console.error('写入数据库失败：', err.message);
            return res.status(200).json({ success: false, msg: '记录失败' });
        }
        // 强制返回 200 状态，兼容手机端 fetch 解析
        res.status(200).json({ success: true, msg: '记录成功' });
    });
});

// 修复：返回数据兜底，避免手机端解析报错
app.get('/api/get-visitor-data', (req, res) => {
    // 获取总访客数
    db.get(`SELECT COUNT(*) AS total FROM visitors`, (err, totalRes) => {
        if (err) {
            console.error('获取总访客数失败：', err.message);
            return res.status(200).json({
                success: false,
                totalCount: 0,
                lastVisit: '暂无记录',
                ipList: []
            });
        }

        // 获取所有访客记录
        db.all(`SELECT * FROM visitors ORDER BY visit_time DESC`, (err, listRes) => {
            if (err) {
                console.error('获取访客列表失败：', err.message);
                return res.status(200).json({
                    success: false,
                    totalCount: totalRes.total || 0,
                    lastVisit: '暂无记录',
                    ipList: []
                });
            }

            // 兜底：避免数据为 null 导致手机端解析报错
            const visitorData = {
                success: true,
                totalCount: totalRes.total || 0,
                lastVisit: (listRes[0]?.visit_time) || '暂无记录',
                ipList: listRes || []
            };

            res.status(200).json(visitorData);
        });
    });
});

// 修复：重置接口加固，返回明确状态
app.delete('/api/reset-visitor', (req, res) => {
    db.run(`DELETE FROM visitors`, (err) => {
        if (err) {
            console.error('清空数据库失败：', err.message);
            return res.status(200).json({ success: false });
        }

        // 重置自增 ID
        db.run(`VACUUM`, () => {
            res.status(200).json({ success: true });
        });
    });
});

// 修复：根路径添加提示，避免 Cannot GET /，方便验证
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: '访客统计后端服务正常运行（手机端兼容版）',
        apis: [
            '/api/record-visitor（POST）',
            '/api/get-visitor-data（GET）',
            '/api/reset-visitor（DELETE）'
        ]
    });
});

// 配置端口（兼容 Render 动态端口）
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`✅ 后端服务运行在端口 ${port}（手机端兼容版）`);
});