// 引入需要的工具包
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();

// 加强跨域配置
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 配置数据库（和之前一致，无需修改）
const dbPath = path.join(__dirname, 'database', 'visitor.db');
if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('数据库连接失败：', err.message);
    else {
        console.log('✅ 数据库连接成功');
        db.run(`CREATE TABLE IF NOT EXISTS visitors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            visit_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (!err) console.log('✅ 访客表创建成功');
        });
    }
});

// ========== 核心修改：后端直接获取真实 IP，无需前端传参 ==========
app.post('/api/record-visitor', (req, res) => {
    // 后端获取真实访客 IP（兼容代理和直接访问）
    const realIp = req.headers['x-forwarded-for'] || req.ip || '未知IP';
    // 处理 IP 格式（x-forwarded-for 可能是多个 IP，取第一个）
    const visitorIp = realIp.split(',')[0].trim();

    db.run(`INSERT INTO visitors (ip) VALUES (?)`, [visitorIp], (err) => {
        if (err) {
            console.error('写入数据库失败：', err.message);
            return res.status(200).json({ success: false, msg: '记录失败' });
        }
        res.status(200).json({ success: true, msg: '记录成功' });
    });
});

// 其他接口（get-visitor-data / reset-visitor）和之前一致，无需修改
app.get('/api/get-visitor-data', (req, res) => {
    db.get(`SELECT COUNT(*) AS total FROM visitors`, (err, totalRes) => {
        if (err) {
            return res.status(200).json({
                success: false,
                totalCount: 0,
                lastVisit: '暂无记录',
                ipList: []
            });
        }
        db.all(`SELECT * FROM visitors ORDER BY visit_time DESC`, (err, listRes) => {
            if (err) {
                return res.status(200).json({
                    success: false,
                    totalCount: totalRes.total || 0,
                    lastVisit: '暂无记录',
                    ipList: []
                });
            }
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

app.delete('/api/reset-visitor', (req, res) => {
    db.run(`DELETE FROM visitors`, (err) => {
        if (err) {
            console.error('清空数据库失败：', err.message);
            return res.status(200).json({ success: false });
        }
        db.run(`VACUUM`, () => {
            res.status(200).json({ success: true });
        });
    });
});

// 根路径提示
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: '访客统计后端服务正常运行（后端获取IP版）',
        apis: [
            '/api/record-visitor（POST，无需传参）',
            '/api/get-visitor-data（GET）',
            '/api/reset-visitor（DELETE）'
        ]
    });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`✅ 后端服务运行在端口 ${port}（后端获取IP版）`);
});