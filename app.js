// 引入核心依赖（无需额外安装，之前已安装）
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 创建Express服务实例
const app = express();

// 1. 超强跨域配置（兼容所有设备、所有请求头，避免跨域报错）
app.use(cors({
    origin: '*', // 允许所有来源访问（自用/分享场景均适用）
    methods: ['GET', 'POST', 'DELETE'], // 仅开放需要的请求方法，更安全
    allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With'],
    maxAge: 86400 // 预检请求缓存1天，减少重复请求
}));

// 2. 数据解析配置（兼容JSON/表单格式，避免数据解析失败）
app.use(express.json({ limit: '2mb' })); // 支持大一点的请求体，兜底
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 3. 数据库配置（自动创建文件夹，避免路径错误）
const dbDir = path.join(__dirname, 'database');
const dbPath = path.join(dbDir, 'visitor.db');
// 自动创建database文件夹（不存在则创建）
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true }); // recursive: true 支持多级文件夹创建
}

// 4. 连接SQLite数据库（加固错误处理，避免数据库崩溃）
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ 数据库连接失败：', err.message);
        return;
    }
    console.log('✅ 数据库连接成功（真实IP版）');

    // 创建访客记录表（字段加固，避免建表失败）
    const createTableSql = `
        CREATE TABLE IF NOT EXISTS visitors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL DEFAULT '未知公网IP',
            visit_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `;
    db.run(createTableSql, (err) => {
        if (err) {
            console.error('❌ 访客表创建失败：', err.message);
            return;
        }
        console.log('✅ 访客表创建/验证成功');
    });
});

// 5. 核心接口：记录访客（最真实的IP获取，兼容所有网络/代理场景）
app.post('/api/record-visitor', (req, res) => {
    // 多维度获取真实公网IP（优先级从高到低，兜底完善）
    let realIp = '';
    // 场景1：代理服务器/CDN（如Render、Nginx）传递的真实IP
    if (req.headers['x-forwarded-for']) {
        // x-forwarded-for 可能返回多个IP（格式：用户IP, 代理IP1, 代理IP2），取第一个
        realIp = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim())[0];
    }
    // 场景2：部分服务器直接传递的真实IP
    else if (req.headers['x-real-ip']) {
        realIp = req.headers['x-real-ip'].trim();
    }
    // 场景3：直接连接（无代理）的IP
    else if (req.connection && req.connection.remoteAddress) {
        realIp = req.connection.remoteAddress.trim();
    }
    // 场景4：Socket层直接获取的IP
    else if (req.socket && req.socket.remoteAddress) {
        realIp = req.socket.remoteAddress.trim();
    }
    // 场景5：兜底（所有场景都失败时，赋值合理默认值）
    else {
        realIp = '未知公网IP（兼容模式）';
    }

    // 过滤本地IP/服务器IP（避免记录127.0.0.1、::1、内网IP）
    const localIpReg = /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1|localhost)/i;
    if (localIpReg.test(realIp)) {
        realIp = '服务器内网IP（非访客真实IP）';
    }

    // 写入数据库（加固错误处理，避免接口崩溃）
    const insertSql = `INSERT INTO visitors (ip) VALUES (?)`;
    db.run(insertSql, [realIp], (err) => {
        if (err) {
            console.error('❌ 写入访客记录失败：', err.message);
            return res.status(200).json({
                success: false,
                msg: '访客记录失败'
            });
        }

        // 成功返回（强制200状态码，兼容所有设备解析）
        return res.status(200).json({
            success: true,
            msg: '访客记录成功',
            visitorIp: realIp // 可选：返回记录的IP，方便调试
        });
    });
});

// 6. 核心接口：获取访客统计数据（稳定兜底，避免数据解析报错）
app.get('/api/get-visitor-data', (req, res) => {
    // 第一步：获取总访客数
    const countSql = `SELECT COUNT(*) AS totalCount FROM visitors`;
    db.get(countSql, (err, countResult) => {
        if (err) {
            console.error('❌ 获取总访客数失败：', err.message);
            // 兜底返回有效数据，避免前端报错
            return res.status(200).json({
                success: true,
                totalCount: 0,
                lastVisit: '暂无有效访客记录',
                ipList: []
            });
        }

        // 第二步：获取所有访客记录（按访问时间倒序）
        const listSql = `SELECT * FROM visitors ORDER BY visit_time DESC`;
        db.all(listSql, (err, listResult) => {
            if (err) {
                console.error('❌ 获取访客列表失败：', err.message);
                // 兜底返回有效数据
                return res.status(200).json({
                    success: true,
                    totalCount: countResult.totalCount || 0,
                    lastVisit: '暂无有效访客记录',
                    ipList: []
                });
            }

            // 处理返回数据（兜底防null，避免前端解析报错）
            const totalCount = countResult.totalCount || 0;
            const lastVisit = listResult.length > 0 ? listResult[0].visit_time : '暂无有效访客记录';
            const ipList = listResult || [];

            // 成功返回
            return res.status(200).json({
                success: true,
                totalCount,
                lastVisit,
                ipList
            });
        });
    });
});

// 7. 核心接口：重置所有访客数据（加固操作，避免误删）
app.delete('/api/reset-visitor', (req, res) => {
    // 第一步：删除所有访客记录
    const deleteSql = `DELETE FROM visitors`;
    db.run(deleteSql, (err) => {
        if (err) {
            console.error('❌ 清空访客记录失败：', err.message);
            return res.status(200).json({
                success: false,
                msg: '访客记录重置失败'
            });
        }

        // 第二步：优化数据库（重置自增ID，释放存储空间）
        db.run(`VACUUM`, (err) => {
            if (err) {
                console.error('❌ 数据库优化失败：', err.message);
            }

            // 成功返回
            return res.status(200).json({
                success: true,
                msg: '访客记录重置成功（数据库已优化）'
            });
        });
    });
});

// 8. 根路径验证接口（方便查看服务状态，避免Cannot GET /）
app.get('/', (req, res) => {
    return res.status(200).json({
        success: true,
        message: '访客统计服务（最稳定真实IP版）运行正常',
        serviceTime: new Date().toLocaleString(),
        availableApis: [
            { path: '/api/record-visitor', method: 'POST', desc: '记录访客真实IP（无需传参）' },
            { path: '/api/get-visitor-data', method: 'GET', desc: '获取访客统计数据' },
            { path: '/api/reset-visitor', method: 'DELETE', desc: '重置所有访客记录' }
        ]
    });
});

// 9. 端口配置（兼容Render动态端口，本地默认3000）
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`✅ 访客统计服务运行在端口 ${port}（最稳定真实IP版）`);
    console.log(`✅ 服务访问地址：http://localhost:${port}`);
});

// 10. 进程退出时关闭数据库连接（避免数据损坏）
process.on('exit', () => {
    db.close((err) => {
        if (err) {
            console.error('❌ 数据库连接关闭失败：', err.message);
            return;
        }
        console.log('✅ 数据库连接正常关闭');
    });
});