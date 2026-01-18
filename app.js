const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();

// 超强跨域配置
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With'],
    maxAge: 86400
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 数据库配置
const dbDir = path.join(__dirname, 'database');
const dbPath = path.join(dbDir, 'visitor.db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// 连接数据库
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ 数据库连接失败：', err.message);
        return;
    }
    console.log('✅ 数据库连接成功（完整后台版）');

    // 创建访客表（新增备注字段）
    const createVisitorTableSql = `
        CREATE TABLE IF NOT EXISTS visitors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL DEFAULT '未知公网IP',
            visit_time DATETIME NOT NULL,
            remark TEXT DEFAULT ''
        )
    `;

    // 创建黑名单表
    const createBlacklistTableSql = `
        CREATE TABLE IF NOT EXISTS blacklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL UNIQUE,
            create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `;

    // 执行建表
    db.run(createVisitorTableSql, (err) => {
        if (err) console.error('❌ 访客表创建失败：', err.message);
        else console.log('✅ 访客表创建/验证成功');
    });

    db.run(createBlacklistTableSql, (err) => {
        if (err) console.error('❌ 黑名单表创建失败：', err.message);
        else console.log('✅ 黑名单表创建/验证成功');
    });
});

// ========== 核心接口：记录访客（过滤黑名单） ==========
app.post('/api/record-visitor', (req, res) => {
    // 1. 获取真实IP
    let realIp = '';
    if (req.headers['x-forwarded-for']) {
        realIp = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim())[0];
    } else if (req.headers['x-real-ip']) {
        realIp = req.headers['x-real-ip'].trim();
    } else if (req.connection && req.connection.remoteAddress) {
        realIp = req.connection.remoteAddress.trim();
    } else if (req.socket && req.socket.remoteAddress) {
        realIp = req.socket.remoteAddress.trim();
    } else {
        realIp = '未知公网IP（兼容模式）';
    }

    // 2. 过滤本地IP
    const localIpReg = /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1|localhost)/i;
    if (localIpReg.test(realIp)) {
        realIp = '服务器内网IP（非访客真实IP）';
    }

    // 3. 检查黑名单
    db.get(`SELECT * FROM blacklist WHERE ip = ?`, [realIp], (err, blacklistItem) => {
        if (err) {
            console.error('❌ 检查黑名单失败：', err.message);
            return res.status(200).json({ success: false, msg: '记录失败' });
        }

        // 若在黑名单，拒绝记录
        if (blacklistItem) {
            return res.status(200).json({ success: false, msg: '该IP已被限制访问' });
        }

        // 4. 时区转换（UTC+8 北京时间）
        const offsetHours = 8;
        const localTime = new Date();
        localTime.setHours(localTime.getUTCHours() + offsetHours);
        const formattedTime = localTime.toISOString().replace('T', ' ').slice(0, 19);

        // 5. 写入数据库
        const insertSql = `INSERT INTO visitors (ip, visit_time) VALUES (?, ?)`;
        db.run(insertSql, [realIp, formattedTime], (err) => {
            if (err) {
                console.error('❌ 写入访客记录失败：', err.message);
                return res.status(200).json({ success: false, msg: '访客记录失败' });
            }

            return res.status(200).json({
                success: true,
                msg: '访客记录成功',
                visitorIp: realIp,
                visitTime: formattedTime
            });
        });
    });
});

// ========== 核心接口：获取访客数据 ==========
app.get('/api/get-visitor-data', (req, res) => {
    const countSql = `SELECT COUNT(*) AS totalCount FROM visitors`;
    db.get(countSql, (err, countResult) => {
        if (err) {
            console.error('❌ 获取总访客数失败：', err.message);
            return res.status(200).json({
                success: true,
                totalCount: 0,
                lastVisit: '暂无有效访客记录',
                ipList: []
            });
        }

        const listSql = `SELECT * FROM visitors ORDER BY visit_time DESC`;
        db.all(listSql, (err, listResult) => {
            if (err) {
                console.error('❌ 获取访客列表失败：', err.message);
                return res.status(200).json({
                    success: true,
                    totalCount: countResult.totalCount || 0,
                    lastVisit: '暂无有效访客记录',
                    ipList: []
                });
            }

            const totalCount = countResult.totalCount || 0;
            const lastVisit = listResult.length > 0 ? listResult[0].visit_time : '暂无有效访客记录';
            const ipList = listResult || [];

            return res.status(200).json({
                success: true,
                totalCount,
                lastVisit,
                ipList
            });
        });
    });
});

// ========== 新增接口：单个删除访客记录 ==========
app.delete('/api/delete-visitor/:id', (req, res) => {
    const { id } = req.params;
    const deleteSql = `DELETE FROM visitors WHERE id = ?`;

    db.run(deleteSql, [id], (err) => {
        if (err) {
            console.error('❌ 删除单条访客记录失败：', err.message);
            return res.status(200).json({ success: false, msg: '删除失败' });
        }

        return res.status(200).json({ success: true, msg: '删除成功' });
    });
});

// ========== 新增接口：批量删除访客记录 ==========
app.delete('/api/batch-delete-visitor', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(200).json({ success: false, msg: '请选择要删除的记录' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const batchDeleteSql = `DELETE FROM visitors WHERE id IN (${placeholders})`;

    db.run(batchDeleteSql, ids, (err) => {
        if (err) {
            console.error('❌ 批量删除访客记录失败：', err.message);
            return res.status(200).json({ success: false, msg: '批量删除失败' });
        }

        return res.status(200).json({ success: true, msg: '批量删除成功' });
    });
});

// ========== 新增接口：编辑访客备注 ==========
app.put('/api/edit-visitor/:id', (req, res) => {
    const { id } = req.params;
    const { remark } = req.body;

    const updateSql = `UPDATE visitors SET remark = ? WHERE id = ?`;
    db.run(updateSql, [remark || '', id], (err) => {
        if (err) {
            console.error('❌ 修改访客备注失败：', err.message);
            return res.status(200).json({ success: false, msg: '备注修改失败' });
        }

        return res.status(200).json({ success: true, msg: '备注修改成功' });
    });
});

// ========== 新增接口：获取黑名单 ==========
app.get('/api/get-blacklist', (req, res) => {
    const listSql = `SELECT ip FROM blacklist ORDER BY create_time DESC`;
    db.all(listSql, (err, result) => {
        if (err) {
            console.error('❌ 获取黑名单失败：', err.message);
            return res.status(200).json({ success: false, blacklist: [] });
        }

        const blacklist = result.map(item => item.ip);
        return res.status(200).json({ success: true, blacklist });
    });
});

// ========== 新增接口：保存黑名单 ==========
app.post('/api/save-blacklist', (req, res) => {
    const { blacklist } = req.body;
    if (!blacklist || !Array.isArray(blacklist)) {
        return res.status(200).json({ success: false, msg: '黑名单数据格式错误' });
    }

    // 先清空原有黑名单
    db.run(`DELETE FROM blacklist`, (err) => {
        if (err) {
            console.error('❌ 清空黑名单失败：', err.message);
            return res.status(200).json({ success: false, msg: '保存黑名单失败' });
        }

        // 批量插入新黑名单
        if (blacklist.length === 0) {
            return res.status(200).json({ success: true, msg: '黑名单保存成功' });
        }

        const insertSql = `INSERT OR IGNORE INTO blacklist (ip, create_time) VALUES (?, CURRENT_TIMESTAMP)`;
        blacklist.forEach(ip => {
            db.run(insertSql, [ip.trim()], (err) => {
                if (err) console.error('❌ 插入黑名单IP失败：', err.message);
            });
        });

        return res.status(200).json({ success: true, msg: '黑名单保存成功' });
    });
});

// ========== 核心接口：重置访客数据 ==========
app.delete('/api/reset-visitor', (req, res) => {
    db.run(`DELETE FROM visitors`, (err) => {
        if (err) {
            console.error('❌ 清空访客记录失败：', err.message);
            return res.status(200).json({ success: false, msg: '访客记录重置失败' });
        }

        db.run(`VACUUM`, (err) => {
            if (err) console.error('❌ 数据库优化失败：', err.message);
            res.status(200).json({ success: true, msg: '访客记录重置成功（数据库已优化）' });
        });
    });
});

// ========== 根路径验证 ==========
app.get('/', (req, res) => {
    return res.status(200).json({
        success: true,
        message: '访客统计服务（完整后台版）运行正常',
        availableApis: [
            { path: '/api/record-visitor', method: 'POST', desc: '记录访客真实IP（过滤黑名单）' },
            { path: '/api/get-visitor-data', method: 'GET', desc: '获取访客统计数据' },
            { path: '/api/delete-visitor/:id', method: 'DELETE', desc: '单个删除访客记录' },
            { path: '/api/batch-delete-visitor', method: 'DELETE', desc: '批量删除访客记录' },
            { path: '/api/edit-visitor/:id', method: 'PUT', desc: '编辑访客备注' },
            { path: '/api/get-blacklist', method: 'GET', desc: '获取黑名单IP列表' },
            { path: '/api/save-blacklist', method: 'POST', desc: '保存黑名单IP列表' },
            { path: '/api/reset-visitor', method: 'DELETE', desc: '重置所有访客记录' }
        ]
    });
});

// ========== 端口配置 ==========
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`✅ 访客统计服务运行在端口 ${port}（完整后台版）`);
});

// ========== 进程退出时关闭数据库 ==========
process.on('exit', () => {
    db.close((err) => {
        if (err) console.error('❌ 数据库连接关闭失败：', err.message);
        else console.log('✅ 数据库连接正常关闭');
    });
});