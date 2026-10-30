require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');

const app = express();

app.use(express.static('dist'));

function buildTurnCredential() {
    const configuredTtl = Number.parseInt(process.env.TURN_TTL, 10);
    const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 43200;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${crypto.randomBytes(8).toString('hex')}`;
    const credential = crypto
        .createHmac('sha1', process.env.TURN_SECRET)
        .update(username)
        .digest('base64');
    return { username, credential };
}

app.get('/api/ice-servers', (req, res) => {
    const iceServers = [];
    const warnings = [];

    if (process.env.STUN_URL) {
        iceServers.push({ urls: process.env.STUN_URL });
    }

    if (process.env.TURN_URL && process.env.TURN_SECRET) {
        iceServers.push({ urls: process.env.TURN_URL, ...buildTurnCredential() });
    } else if (process.env.TURN_URL) {
        warnings.push('TURN_URL 已配置，但 TURN_SECRET 未配置；浏览器将无法使用 TURN 中继。');
    }

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json({
        iceServers,
        warnings,
        peerjs: {
            path: process.env.PEERJS_PATH,
            key: process.env.PEERJS_KEY
        }
    });
});

const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
    path: '/',
    key: process.env.PEERJS_KEY
});

app.use(process.env.PEERJS_PATH, peerServer);

server.listen(9001, () => {
    console.log('Peerjs已经运行在端口: 9001');
    console.log('PeerJS路径:', process.env.PEERJS_PATH);
    console.log('STUN服务器:', process.env.STUN_URL || '未配置');
    console.log('TURN服务器:', process.env.TURN_URL || '未配置');
    console.log('TURN_SECRET:', process.env.TURN_SECRET ? '已配置' : '未配置');
});

peerServer.on('connection', (client) => {
    console.log('客户端连接:', client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log('客户端断开:', client.getId());
});

peerServer.on('error', (error) => {
    console.log('PeerJS服务器错误:', error);
});
