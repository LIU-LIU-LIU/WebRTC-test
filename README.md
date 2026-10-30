# webrtc测试页

一个基于 PeerJS 和 WebRTC 的屏幕共享测试页。房主可以向多个成员直接推送屏幕和声音，成员可以观看、聊天和查看连接质量。

## 使用

```bash
npm install
npm run build
npm run start
```

浏览器访问 `http://localhost:9001/`。不带 `id` 是房主，带房主生成的 `?id=...` 是成员。

## 配置

首次使用请复制 `.env.example` 为 `.env` 并填写配置。`.env` 只由 Node.js 读取。浏览器通过 `/api/ice-servers` 获取 PeerJS 和 ICE 配置，接口响应不会缓存。屏幕共享要求 HTTPS 或 localhost 安全上下文。

```env
PEERJS_PROT=9001
PEERJS_PATH=/ahapeer
PEERJS_KEY=change-me
STUN_URL=stun:ice.example.com:3478
TURN_URL=turn:ice.example.com:3478
TURN_SECRET=与 coturn static-auth-secret 相同的长随机字符串
TURN_TTL=43200
```

TURN 使用 coturn 的 REST API 认证。后端按请求生成有效期有限的用户名和 HMAC-SHA1 密码，`TURN_SECRET` 不会发送给浏览器。浏览器必须知道 TURN 地址和临时凭据才能建立中继连接，因此地址无法从用户端完全隐藏。

`turnserver.conf` 至少需要：

```ini
listening-port=3478
realm=ice.example.com
fingerprint
use-auth-secret
static-auth-secret=与 .env 的 TURN_SECRET 相同
external-ip=公网IP/内网IP
min-port=50000
max-port=50200
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
user-quota=12
total-quota=100
no-cli
simple-log
```

放行 `3478` 的 UDP/TCP，以及 `50000-50200` 的 UDP。建议使用 systemd 管理 coturn，例如：

设置 `external-ip` 为实际公网 IP 与 coturn 主机内网 IP。若房间用户确需访问私有网络设备，应谨慎评估并调整相应 `denied-peer-ip` 规则。启动前将同一随机密钥分别设置在应用 `.env` 的 `TURN_SECRET` 和 coturn 的 `static-auth-secret`。

```bash
turnserver -c /opt/coturn/etc/turnserver.conf
```

nginx 应保护整个站点、`/api/ice-servers` 和 PeerJS 的 `PEERJS_PATH`，并为 PeerJS WebSocket 转发 `Upgrade` 和 `Connection` 请求头。TURN 的 `3478` 和中继端口是浏览器直连 coturn，不经过 nginx。

项目原来的静态 `TURN_USER` / `TURN_CRED` 不再用于 ICE 配置。切换时先在 coturn 启用 `use-auth-secret` 并设置共享密钥，再在应用 `.env` 设置同一 `TURN_SECRET`，然后重启两端服务。迁移完成后从 `.env` 删除 `TURN_USER` 和 `TURN_CRED`，并撤销 coturn 上的旧账号。不要把 `TURN_SECRET` 提交到 Git。默认凭据有效期 12 小时，应大于房间持续时长；超过有效期后刷新房间以获取新凭据。成员可见的临时凭据在有效期内仍可被复用，nginx 登录校验负责限制谁能获取它。

## 功能

- 房主直连最多 8 位成员，每位成员建立独立的 WebRTC 媒体连接。
- 房主可以开始或停止共享，浏览器分享栏停止也会同步到房间。
- 房间聊天带发送者和时间戳，房主负责广播消息。
- 显示成员数、连接模式、RTT、上下行码率、帧率、分辨率、丢帧、丢包率、抖动和码率限制原因。
- 日志、聊天和画面使用固定区域，移动端自动改为单列布局。

## 限制

当前是一对多直连模式。房主需要同时上传多路视频，适合小规模房间；人数较多或需要降低房主上行带宽时，应升级到 SFU（例如 mediasoup 或 LiveKit）。
