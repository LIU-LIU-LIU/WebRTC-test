require('dotenv').config();

const express = require('express');
const { ExpressPeerServer } = require('peer');
const app = express();

// 设置静态文件目录
app.use(express.static('dist'));

// 创建一个 HTTP 服务器
const http = require('http');
const server = http.createServer(app);

// 创建 PeerJS 服务器
const peerServer = ExpressPeerServer(server, {
  path: "/",
  key: process.env.PEERJS_KEY
});

// 挂载 PeerJS 服务器到 Express 上
app.use(process.env.PEERJS_PATH, peerServer);

// 监听端口
server.listen(9001, () => {
  console.log('Peerjs已经运行在端口:' + process.env.PEERJS_PROT);
});