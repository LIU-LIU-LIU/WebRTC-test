import Peer from 'peerjs';
import './main.css';

const MAX_MEMBERS = 8;
const HEARTBEAT_INTERVAL = 3000;
const HEARTBEAT_TIMEOUT = 15000;
const members = new Map();
let peer;
let peerId;
let roomId;
let isHost = false;
let memberIndex = 0;
let localStream = null;
let hostConnection = null;
let localNick = '';
let sharing = false;
let roster = [];
let remoteCall = null;
let sessionEnded = false;
let capturePending = false;
let lastHostSeen = 0;
let heartbeatTimer = null;
const rejectedPeers = new Set();
let autoScroll = true;
const video = document.getElementById('video');

document.getElementById('startShare').addEventListener('click', startSharing);
document.getElementById('stopShare').addEventListener('click', stopSharing);
document.getElementById('leave').addEventListener('click', leaveRoom);
document.getElementById('reconnect').addEventListener('click', () => location.reload());
document.getElementById('fullscreen').addEventListener('click', toggleFullscreen);
document.getElementById('copyUrl').addEventListener('click', copyRoomUrl);
document.getElementById('chatForm').addEventListener('submit', sendChat);
document.getElementById('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('chatForm').requestSubmit();
    }
});
document.getElementById('chatBox').addEventListener('scroll', event => {
    const box = event.currentTarget;
    autoScroll = box.scrollHeight - box.scrollTop - box.clientHeight < 36;
    if (autoScroll) document.getElementById('newMessages').hidden = true;
});
document.getElementById('newMessages').addEventListener('click', () => {
    document.getElementById('chatBox').scrollTop = document.getElementById('chatBox').scrollHeight;
    autoScroll = true;
    document.getElementById('newMessages').hidden = true;
});
document.getElementById('copyLog').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.getElementById('log').textContent); log('日志已复制'); }
    catch (error) { log('复制日志失败:', error.message); }
});
document.getElementById('clearLog').addEventListener('click', () => { document.getElementById('log').textContent = ''; });
video.addEventListener('playing', () => { document.getElementById('playButton').hidden = true; });
document.getElementById('playButton').addEventListener('click', () => video.play().catch(error => log('播放失败:', error.message)));
window.addEventListener('pagehide', () => {
    clearInterval(heartbeatTimer);
    peer?.destroy();
});

initialize();

async function initialize() {
    const params = new URLSearchParams(location.search);
    roomId = params.get('id');
    isHost = !roomId;
    setStatus('准备连接', 'neutral');
    try {
        const response = await fetch('/api/ice-servers', { cache: 'no-store' });
        if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
        const config = await response.json();
        if (!config.peerjs?.path || !config.peerjs?.key) throw new Error('PeerJS 配置不完整');
        config.iceServers.forEach((server, index) => log(`ICE ${index + 1}: ${server.urls}`));
        if (config.warnings) config.warnings.forEach(warning => log(warning));
        const storedId = sessionStorage.getItem('savedPeerId');
        peer = new Peer(storedId === roomId ? undefined : storedId || undefined, {
            host: location.hostname,
            port: location.port || (location.protocol === 'https:' ? 443 : 80),
            path: config.peerjs.path,
            secure: location.protocol === 'https:',
            key: config.peerjs.key,
            config: { iceServers: config.iceServers, iceTransportPolicy: 'all' }
        });
        peer.on('open', onPeerOpen);
        peer.on('connection', onIncomingData);
        peer.on('call', onIncomingCall);
        peer.on('error', error => { log('PeerJS 错误:', error.type, error.message); setStatus('连接错误', 'bad'); });
        peer.on('disconnected', () => {
            if (!sessionEnded) {
                setStatus('信令服务器断开', 'bad');
                document.getElementById('reconnect').hidden = false;
                log('PeerJS 信令连接断开');
            }
        });
        peer.on('close', () => { if (!sessionEnded) setStatus('连接已关闭', 'bad'); });
    } catch (error) {
        log('初始化失败:', error.message);
        setStatus('配置加载失败，请刷新', 'bad');
        document.getElementById('emptyHint').textContent = '无法连接服务器，请登录后刷新页面';
    }
}

function onPeerOpen(id) {
    peerId = id;
    sessionStorage.setItem('savedPeerId', id);
    if (!heartbeatTimer) heartbeatTimer = setInterval(checkRoomConnections, HEARTBEAT_INTERVAL);
    if (isHost) {
        roomId = id;
        localNick = '房主';
        document.getElementById('identity').textContent = '当前用户：房主';
        document.getElementById('roomUrl').value = `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`;
        document.getElementById('copyUrl').disabled = false;
        document.getElementById('startShare').disabled = false;
        document.getElementById('chatInput').disabled = false;
        document.getElementById('sendMessage').disabled = false;
        document.getElementById('chatState').textContent = '房间已就绪';
        document.getElementById('emptyHint').textContent = '点击“开始共享”，选择需要分享的屏幕或窗口';
        setStatus('房间已创建', 'good');
        log('房间创建成功，房间 ID:', id);
        renderRoster();
    } else {
        document.getElementById('startShare').hidden = true;
        document.getElementById('invite').hidden = true;
        document.getElementById('audioHint').hidden = true;
        localNick = '连接中';
        document.getElementById('identity').textContent = '当前用户：正在加入房间';
        document.getElementById('leave').hidden = false;
        document.getElementById('emptyHint').textContent = '正在连接房主…';
        setStatus('正在加入房间', 'warning');
        joinHost();
    }
}

function joinHost() {
    hostConnection = peer.connect(roomId, { reliable: true });
    bindDataConnection(hostConnection);
    hostConnection.on('open', () => {
        hostConnection.send({ type: 'hello' });
        log('已连接房主，等待房间名单');
    });
}

function onIncomingData(connection) {
    if (!isHost || rejectedPeers.has(connection.peer)) {
        connection.on('open', () => {
            connection.send({ type: 'kick' });
            setTimeout(() => connection.close(), 300);
        });
        return;
    }
    bindDataConnection(connection);
}

function bindDataConnection(connection) {
    connection.on('data', packet => {
        if (!packet || typeof packet !== 'object') return;
        if (isHost) {
            const member = members.get(connection.peer);
            if (member?.connection === connection) member.lastSeen = Date.now();
        } else if (connection === hostConnection) lastHostSeen = Date.now();
        if (isHost) handleHostPacket(connection, packet);
        else if (connection === hostConnection) handleMemberPacket(packet);
    });
    connection.on('close', () => {
        if (isHost && members.get(connection.peer)?.connection === connection) removeMember(connection.peer, '连接断开');
        else if (!isHost && connection === hostConnection && !sessionEnded) hostLeft();
    });
    connection.on('error', error => log('数据连接错误:', error.message));
}

function checkRoomConnections() {
    if (sessionEnded) return;
    const now = Date.now();
    if (isHost) {
        for (const member of members.values()) {
            if (now - member.lastSeen > HEARTBEAT_TIMEOUT) {
                removeMember(member.id, '连接超时');
                member.connection.close();
            } else if (member.connection.open) member.connection.send({ type: 'ping' });
        }
    } else if (lastHostSeen) {
        if (now - lastHostSeen > HEARTBEAT_TIMEOUT) hostLeft();
        else if (hostConnection?.open) hostConnection.send({ type: 'ping' });
    }
}

function handleHostPacket(connection, packet) {
    if (packet.type === 'ping') {
        if (members.get(connection.peer)?.connection === connection) connection.send({ type: 'pong' });
    } else if (packet.type === 'hello') {
        if (members.get(connection.peer)?.connection === connection) return;
        if (members.size >= MAX_MEMBERS && !members.has(connection.peer)) {
            connection.send({ type: 'full' });
            setTimeout(() => connection.close(), 300);
            return;
        }
        const previous = members.get(connection.peer);
        previous?.call?.close();
        previous?.connection?.close();
        const nick = previous?.nick || `成员${++memberIndex}`;
        members.set(connection.peer, { id: connection.peer, nick, connection, call: null, metrics: null, state: 'connected', lastSeen: Date.now() });
        connection.send({ type: 'welcome', nick, host: '房主', sharing });
        log(`${nick} 加入房间`);
        addSystemMessage(`${nick} 加入房间`);
        broadcast({ type: 'system', text: `${nick} 加入房间` });
        broadcastRoster();
        if (sharing) callMember(members.get(connection.peer));
    } else if (packet.type === 'chat') {
        const member = members.get(connection.peer);
        if (!member || member.connection !== connection || typeof packet.text !== 'string' || !packet.text.trim()) return;
        broadcastChat({ from: member.nick, text: packet.text.slice(0, 2000), ts: Date.now(), peerId: member.id });
    }
}

function handleMemberPacket(packet) {
    if (sessionEnded) return;
    if (packet.type === 'ping') {
        if (hostConnection?.open) hostConnection.send({ type: 'pong' });
    } else if (packet.type === 'full') {
        sessionEnded = true;
        setStatus('房间已满', 'bad');
        document.getElementById('emptyHint').textContent = '房间成员已满，请稍后再试';
        hostConnection?.close();
        document.getElementById('reconnect').hidden = false;
    } else if (packet.type === 'welcome') {
        localNick = packet.nick;
        document.getElementById('identity').textContent = `当前用户：${localNick}`;
        document.getElementById('chatInput').disabled = false;
        document.getElementById('sendMessage').disabled = false;
        document.getElementById('chatState').textContent = '已连接';
        setStatus('已加入房间', 'good');
        document.getElementById('emptyHint').textContent = '房主未在共享';
        if (packet.sharing) document.getElementById('emptyHint').textContent = '房主正在建立画面连接…';
        log(`已加入房间，身份：${localNick}`);
    } else if (packet.type === 'roster') {
        roster = packet.members || [];
        document.getElementById('population').textContent = `房主 1 · 成员 ${roster.length}`;
        renderMemberList();
    } else if (packet.type === 'chat') {
        appendChat(packet.from, packet.text, packet.ts, packet.peerId === peerId);
    } else if (packet.type === 'system') {
        addSystemMessage(packet.text);
    } else if (packet.type === 'streamState') {
        document.getElementById('sharingState').textContent = packet.sharing ? '共享中' : '未共享';
        if (!packet.sharing) clearRemoteStream();
        else document.getElementById('emptyHint').textContent = '房主正在连接画面…';
    } else if (packet.type === 'kick') {
        sessionEnded = true;
        setStatus('你已被房主移出房间', 'bad');
        hostConnection?.close();
        peer?.destroy();
        document.getElementById('chatInput').disabled = true;
        document.getElementById('sendMessage').disabled = true;
        clearRemoteStream();
        addSystemMessage('你已被房主移出房间');
    }
}

async function startSharing() {
    if (!isHost || sharing || capturePending) return;
    capturePending = true;
    document.getElementById('startShare').disabled = true;
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        video.srcObject = localStream;
        video.muted = true;
        document.getElementById('emptyState').hidden = true;
        localStream.getVideoTracks().forEach(track => track.addEventListener('ended', stopSharing, { once: true }));
        sharing = true;
        document.getElementById('sharingState').textContent = '共享中';
        document.getElementById('startShare').hidden = true;
        document.getElementById('stopShare').hidden = false;
        document.getElementById('audioHint').textContent = localStream.getAudioTracks().length ? '正在共享屏幕音频' : '此来源未共享音频';
        broadcast({ type: 'streamState', sharing: true });
        for (const member of members.values()) callMember(member);
        log(`开始共享，轨道数：${localStream.getTracks().length}，观众：${members.size}`);
    } catch (error) {
        log('未开始共享:', error.message);
    } finally {
        capturePending = false;
        document.getElementById('startShare').disabled = false;
    }
}

function stopSharing() {
    if (!sharing && !localStream) return;
    sharing = false;
    const stream = localStream;
    localStream = null;
    stream?.getTracks().forEach(track => track.stop());
    for (const member of members.values()) {
        member.call?.close();
        member.call = null;
        member.metrics = null;
        member.state = 'connected';
    }
    video.srcObject = null;
    video.muted = false;
    document.getElementById('emptyState').hidden = false;
    document.getElementById('emptyHint').textContent = '点击“开始共享”，选择需要分享的屏幕或窗口';
    document.getElementById('sharingState').textContent = '未共享';
    document.getElementById('startShare').hidden = false;
    document.getElementById('stopShare').hidden = true;
    document.getElementById('audioHint').textContent = '共享声音需在浏览器中勾选';
    broadcast({ type: 'streamState', sharing: false });
    renderRoster();
    renderHostMetrics();
    log('已停止共享');
}

function callMember(member) {
    if (!sharing || !localStream || !member.connection?.open || member.call) return;
    const call = peer.call(member.id, localStream);
    if (!call) return;
    member.call = call;
    attachCallMetrics(call, true, member);
    call.on('close', () => {
        if (member.call === call) { member.call = null; member.metrics = null; renderHostMetrics(); }
    });
    const audioSender = call.peerConnection.getSenders().find(sender => sender.track?.kind === 'audio');
    if (audioSender) {
        const params = audioSender.getParameters();
        if (params.encodings?.length) {
            params.encodings[0].maxBitrate = 128000;
            audioSender.setParameters(params).catch(error => log('设置音频码率失败:', error.message));
        }
    }
    call.on('error', error => log(`呼叫 ${member.nick} 失败:`, error.message));
}

function onIncomingCall(call) {
    if (isHost || call.peer !== roomId || sessionEnded) { call.close(); return; }
    remoteCall?.close();
    remoteCall = call;
    call.answer();
    call.on('stream', stream => {
        video.srcObject = stream;
        document.getElementById('emptyState').hidden = true;
        video.muted = false;
        video.play().catch(() => { document.getElementById('playButton').hidden = false; });
        document.getElementById('sharingState').textContent = '正在接收';
        log('已接收房主画面');
    });
    call.on('close', () => {
        if (remoteCall === call) { remoteCall = null; clearRemoteStream(); }
    });
    call.on('error', error => log('接收画面错误:', error.message));
    attachCallMetrics(call, false, null);
}

function attachCallMetrics(call, sender, member) {
    const connection = call.peerConnection;
    if (!connection) return;
    const state = { previous: new Map(), lastAt: performance.now(), startedAt: performance.now() };
    const timer = setInterval(async () => {
        if (connection.connectionState === 'closed' || connection.signalingState === 'closed') { clearInterval(timer); return; }
        try {
            const reports = await connection.getStats();
            const result = collectMetrics(reports, state, sender);
            if (member) {
                if (member.call !== call) return;
                member.metrics = result;
                renderMemberList();
                renderHostMetrics();
            }
            else {
                if (remoteCall !== call) return;
                renderMetrics(result);
            }
        } catch (error) { log('读取连接指标失败:', error.message); clearInterval(timer); }
    }, 1000);
    call.on('close', () => clearInterval(timer));
    call.on('error', () => clearInterval(timer));
    connection.addEventListener('connectionstatechange', () => {
        if (member) { member.state = connection.connectionState; renderRoster(); }
        else if (!sessionEnded && remoteCall === call) {
            const map = { connected: ['已连接', 'good'], connecting: ['连接中', 'warning'], disconnected: ['连接中断', 'bad'], failed: ['连接失败', 'bad'], closed: ['已关闭', 'neutral'] };
            const [label, tone] = map[connection.connectionState] || ['连接中', 'warning'];
            setStatus(label, tone);
        }
    });
}

function collectMetrics(reports, state, sender) {
    const values = [...reports.values()];
    const transport = values.find(item => item.type === 'transport' && item.selectedCandidatePairId);
    const pair = (transport && reports.get(transport.selectedCandidatePairId)) || values.find(item => item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded');
    const local = pair && reports.get(pair.localCandidateId);
    const remote = pair && reports.get(pair.remoteCandidateId);
    let mode = '--';
    if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') mode = 'TURN 中继';
    else if (local?.candidateType === 'srflx' || remote?.candidateType === 'srflx') mode = 'STUN 辅助 P2P';
    else if (pair) mode = 'P2P 直连';
    const rtpType = sender ? 'outbound-rtp' : 'inbound-rtp';
    const videoReport = values.find(item => item.type === rtpType && (item.kind === 'video' || item.mediaType === 'video') && !item.isRemote);
    const audioReport = values.find(item => item.type === rtpType && (item.kind === 'audio' || item.mediaType === 'audio') && !item.isRemote);
    const now = performance.now();
    const elapsed = Math.max(.001, (now - state.lastAt) / 1000);
    const rate = (key, report) => {
        if (!report) return 0;
        const total = report[key] || 0;
        const previous = state.previous.get(report.id) ?? total;
        state.previous.set(report.id, total);
        return Math.max(0, (total - previous) * 8 / elapsed / 1000);
    };
    const feedback = sender && videoReport ? reports.get(videoReport.remoteId) || values.find(item => item.type === 'remote-inbound-rtp' && item.localId === videoReport.id) : videoReport;
    const packetLost = feedback?.packetsLost || 0;
    const packetsReceived = feedback?.packetsReceived ?? videoReport?.packetsSent ?? 0;
    const priorLoss = state.previous.get('lost') ?? packetLost;
    const priorReceived = state.previous.get('received') ?? packetsReceived;
    const lostDelta = Math.max(0, packetLost - priorLoss);
    const receivedDelta = Math.max(0, packetsReceived - priorReceived);
    state.previous.set('lost', packetLost);
    state.previous.set('received', packetsReceived);
    state.lastAt = now;
    const codec = videoReport && reports.get(videoReport.codecId);
    const emitted = videoReport?.jitterBufferEmittedCount;
    const bufferDelay = videoReport?.jitterBufferDelay;
    const emittedDelta = emitted - (state.previous.get('emitted') ?? emitted);
    const bufferDelta = bufferDelay - (state.previous.get('bufferDelay') ?? bufferDelay);
    state.previous.set('emitted', emitted);
    state.previous.set('bufferDelay', bufferDelay);
    const jitterBuffer = emittedDelta > 0 ? bufferDelta / emittedDelta * 1000 : null;
    const loss = feedback?.packetsLost == null ? null : lostDelta + receivedDelta ? lostDelta * 100 / (lostDelta + receivedDelta) : 0;
    const videoKbps = rate(sender ? 'bytesSent' : 'bytesReceived', videoReport);
    const audioKbps = rate(sender ? 'bytesSent' : 'bytesReceived', audioReport);
    return {
        mode, rtt: pair?.currentRoundTripTime == null ? null : Math.round(pair.currentRoundTripTime * 1000),
        videoKbps, audioKbps, upload: sender ? (videoKbps + audioKbps) * 125 : 0, download: sender ? 0 : (videoKbps + audioKbps) * 125,
        fps: videoReport?.framesPerSecond ?? null, dropped: videoReport?.framesDropped ?? null,
        width: videoReport?.frameWidth ?? null, height: videoReport?.frameHeight ?? null,
        loss,
        jitter: audioReport?.jitter ?? feedback?.jitter ?? null,
        quality: videoReport?.qualityLimitationReason || (sender ? '--' : 'none'), codec: codec?.mimeType?.replace('video/', '') || '--', jitterBuffer,
        duration: (now - state.startedAt) / 1000
    };
}

function renderMetrics(data) {
    data = {
        mode: '--', rtt: null, videoKbps: null, audioKbps: null, upload: null, download: null,
        fps: null, width: null, height: null, dropped: null, loss: null, jitter: null,
        jitterBuffer: null, codec: '--', quality: '--', ...data
    };
    const num = (value, digits = 0) => value == null || Number.isNaN(value) ? null : value.toFixed(digits);
    const quality = ({ none: '无限制', cpu: 'CPU 受限', bandwidth: '带宽受限', other: '其他' })[data.quality] || data.quality || '--';
    const tone = (value, good, warn) => value == null ? '' : value <= good ? 'good' : value <= warn ? 'warning' : 'bad';
    const speed = formatSpeed(data.upload || data.download);
    const [speedValue, speedUnit] = speed.split(' ');
    // [名称, 数值, 单位, 状态色]
    const specs = [
        ['连接模式', data.mode, '', data.mode === 'TURN 中继' ? 'warning' : data.mode === '--' ? '' : 'good'],
        ['往返延迟 RTT', data.rtt == null ? null : String(data.rtt), 'ms', tone(data.rtt, 80, 200)],
        [data.download ? '下载速度' : '上传速度', speedValue === '--' ? null : speedValue, speedUnit || '', ''],
        ['视频码率', num(data.videoKbps), 'kbps', ''],
        ['音频码率', num(data.audioKbps), 'kbps', ''],
        ['分辨率', data.width ? `${data.width}×${data.height}` : null, '', ''],
        ['帧率', num(data.fps), 'fps', data.fps == null ? '' : data.fps >= 24 ? 'good' : data.fps >= 15 ? 'warning' : 'bad'],
        ['丢包率', num(data.loss, 1), '%', tone(data.loss, 1, 5)],
        ['累计丢帧', data.dropped == null ? null : String(data.dropped), '帧', ''],
        ['音频抖动', num(data.jitter == null ? null : data.jitter * 1000), 'ms', tone(data.jitter == null ? null : data.jitter * 1000, 30, 80)],
        ['抖动缓冲', num(data.jitterBuffer), 'ms', tone(data.jitterBuffer, 100, 300)],
        ['视频编码', data.codec === '--' ? null : data.codec, '', ''],
        ['画质限制', data.quality === '--' ? null : quality, '', data.quality === 'none' ? 'good' : data.quality === '--' ? '' : 'warning'],
        ['已连接时长', formatDuration(data.duration), '', '']
    ];
    document.getElementById('metrics').replaceChildren(...specs.map(([name, value, unit, level]) => {
        const item = document.createElement('div'); item.className = `metric ${level}`.trim();
        const dl = document.createElement('dl'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
        dt.textContent = name; dd.textContent = value ?? '--';
        if (value != null && unit) { const small = document.createElement('small'); small.textContent = unit; dd.append(small); }
        item.title = `${name}：${value ?? '--'}${unit ? ` ${unit}` : ''}`; dl.append(dt, dd); item.append(dl); return item;
    }));
}

function formatDuration(seconds) {
    if (seconds == null) return null;
    const pad = value => String(value).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(Math.floor(seconds % 60))}`;
}

function maxOf(values) {
    const valid = values.filter(value => value != null && !Number.isNaN(value));
    return valid.length ? Math.max(...valid) : null;
}

function formatSpeed(bytes) {
    if (bytes == null) return '--';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB/s` : `${(bytes / 1024).toFixed(1)} KB/s`;
}

function renderHostMetrics() {
    const active = [...members.values()].map(member => member.metrics).filter(Boolean);
    const modes = [...new Set(active.map(item => item.mode))];
    const rtts = active.map(item => item.rtt).filter(value => value != null);
    const first = active[0] || {};
    renderMetrics({
        ...first,
        mode: modes.join(' / ') || '--', rtt: rtts.length ? Math.max(...rtts) : null,
        videoKbps: active.length ? active.reduce((total, item) => total + item.videoKbps, 0) : null,
        audioKbps: active.length ? active.reduce((total, item) => total + item.audioKbps, 0) : null,
        upload: active.reduce((total, item) => total + item.upload, 0), download: 0,
        loss: maxOf(active.map(item => item.loss)), jitter: maxOf(active.map(item => item.jitter)),
        dropped: null, jitterBuffer: null, duration: maxOf(active.map(item => item.duration))
    });
    document.getElementById('metricsHint').textContent = active.length
        ? `发送汇总（${active.length} 位观众）· 延迟、丢包、抖动取最差值 · 速度为总上传`
        : '暂无观众接收画面 · 开始共享并有成员加入后显示';
}

function sendChat(event) {
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (isHost) broadcastChat({ from: '房主', text, ts: Date.now(), peerId });
    else if (hostConnection?.open) hostConnection.send({ type: 'chat', text });
    else return;
    input.value = '';
    input.focus();
}

function broadcastChat(message) {
    appendChat(message.from, message.text, message.ts, message.peerId === peerId);
    broadcast({ type: 'chat', ...message });
}

function appendChat(from, text, ts, own) {
    const box = document.getElementById('chatBox');
    const item = document.createElement('article'); item.className = `message${own ? ' own' : ''}`;
    const meta = document.createElement('div'); meta.className = 'message-meta';
    meta.textContent = `${from} · ${new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })}`;
    const body = document.createElement('div'); body.className = 'message-body'; body.textContent = text;
    item.append(meta, body); box.append(item); keepChatAtBottom();
}

function addSystemMessage(text) {
    const item = document.createElement('div'); item.className = 'system-message'; item.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${text}`;
    document.getElementById('chatBox').append(item); keepChatAtBottom();
}

function keepChatAtBottom() {
    const box = document.getElementById('chatBox');
    if (autoScroll) box.scrollTop = box.scrollHeight;
    else document.getElementById('newMessages').hidden = false;
}

function broadcast(packet) { for (const member of members.values()) if (member.connection.open) member.connection.send(packet); }

function broadcastRoster() {
    const list = [...members.values()].map(({ id, nick, state, metrics }) => ({ id, nick, state: state || 'connecting', metrics }));
    roster = list;
    broadcast({ type: 'roster', members: list });
    document.getElementById('population').textContent = `房主 1 · 成员 ${members.size}`;
    renderMemberList();
}

function renderRoster() {
    if (isHost) document.getElementById('population').textContent = `房主 1 · 成员 ${members.size}`;
    renderMemberList();
}

function renderMemberList() {
    const container = document.getElementById('members');
    const list = [{ id: isHost ? peerId : 'host', nick: '房主', state: 'connected' }, ...(isHost ? [...members.values()] : roster)];
    if (!list.length) {
        const empty = document.createElement('div'); empty.className = 'member-stats'; empty.textContent = '房间暂时只有房主'; container.replaceChildren(empty); return;
    }
    container.replaceChildren(...list.map(member => {
        const row = document.createElement('div'); row.className = 'member';
        const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = member.nick.slice(-1);
        const info = document.createElement('div'); info.className = 'member-info';
        const name = document.createElement('div'); name.className = 'member-name'; name.textContent = `${member.nick}${member.id === peerId ? '（你）' : ''}`;
        const stats = document.createElement('div'); stats.className = 'member-stats';
        const metric = member.metrics;
        stats.textContent = `${stateLabel(member.state)}${metric ? ` · ${metric.mode} · RTT ${metric.rtt == null ? '--' : `${metric.rtt}ms`} · ${metric.videoKbps.toFixed(0)} kbps` : ''}`;
        info.append(name, stats); row.append(avatar, info);
        if (isHost && member.id !== peerId && member.id !== 'host') {
            const kick = document.createElement('button'); kick.textContent = '移出'; kick.setAttribute('aria-label', `移出${member.nick}`);
            kick.addEventListener('click', () => kickMember(member.id)); row.append(kick);
        }
        return row;
    }));
}

function stateLabel(state) { return ({ connected: '已连接', connecting: '连接中', disconnected: '中断', failed: '失败', closed: '已关闭' })[state] || '连接中'; }

function kickMember(id) {
    const member = members.get(id);
    if (!member) return;
    rejectedPeers.add(id);
    member.connection.send({ type: 'kick' });
    setTimeout(() => member.connection.close(), 300);
    member.call?.close();
    removeMember(id, '被房主移出');
}

function removeMember(id, reason) {
    const member = members.get(id);
    if (!member) return;
    member.call?.close();
    members.delete(id);
    renderHostMetrics();
    log(`${member.nick} ${reason}`);
    addSystemMessage(`${member.nick} ${reason}`);
    broadcastRoster();
    broadcast({ type: 'system', text: `${member.nick} ${reason}` });
}

function clearRemoteStream() {
    if (isHost) return;
    const call = remoteCall;
    remoteCall = null;
    call?.close();
    video.srcObject = null;
    document.getElementById('emptyState').hidden = false;
    document.getElementById('playButton').hidden = true;
    document.getElementById('sharingState').textContent = '未共享';
    document.getElementById('emptyHint').textContent = '房主未在共享';
    renderMetrics({ mode: '--' });
}

function hostLeft() {
    sessionEnded = true;
    setStatus('房主已离开', 'bad');
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendMessage').disabled = true;
    document.getElementById('reconnect').hidden = false;
    clearRemoteStream();
    document.getElementById('emptyHint').textContent = '房主已离开房间';
    document.getElementById('population').textContent = '房主 0 · 成员 0';
    document.getElementById('members').replaceChildren();
    document.getElementById('chatState').textContent = '已断开';
    addSystemMessage('房主已离开房间');
}

function leaveRoom() {
    sessionEnded = true;
    hostConnection?.close();
    peer?.destroy();
    setStatus('已离开房间', 'neutral');
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendMessage').disabled = true;
    document.getElementById('reconnect').hidden = false;
    clearRemoteStream();
    document.getElementById('population').textContent = '房主 0 · 成员 0';
    document.getElementById('members').replaceChildren();
}

async function copyRoomUrl() {
    try { await navigator.clipboard.writeText(document.getElementById('roomUrl').value); log('邀请链接已复制'); }
    catch (error) { log('复制链接失败:', error.message); }
}

async function toggleFullscreen() {
    const stage = document.getElementById('stage');
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
    } catch (error) { log('全屏切换失败:', error.message); }
}

function setStatus(text, tone) {
    const badge = document.getElementById('status');
    badge.textContent = text;
    badge.className = `badge ${tone}`;
}

function log(...parts) {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${parts.map(part => part instanceof Error ? part.message : String(part)).join(' ')}`;
    const node = document.getElementById('log');
    node.textContent += `${line}\n`;
    node.textContent = node.textContent.split('\n').slice(-301).join('\n');
    node.scrollTop = node.scrollHeight;
}

renderMetrics({ mode: '--' });
