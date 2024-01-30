import Peer from 'peerjs';
import './main.css';

let peer;
let peer_id;
let other_peer_id; //对方的PeerID
let localStream;
let dataConnection = null; // 存储数据连接
let rtcConn;//底层的 RTCPeerConnection 对象

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = urlParams.get('id');
    let savedPeerId = sessionStorage.getItem('savedPeerId');

    if (savedPeerId) {
        updateLog("使用存储的 Peer ID:", savedPeerId);
        peer_id = savedPeerId;
    }

    initPeer(savedPeerId, roomId);
	
	// 设置按钮事件
    document.getElementById('up').addEventListener('click', upload_f);
    document.getElementById('do').addEventListener('click', download_f);
    document.getElementById('copy_url').addEventListener('click', copyToClipboard);
    document.getElementById('sendMessage').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // 阻止默认的换行行为
            sendMessage(); // 调用发送消息的函数
        }
    });
	
});

function initPeer(savedPeerId = null, roomId = null) {
    const iceServers = [];
    
	// 如果.env中定义了STUN服务器，添加到iceServers
    if (process.env.STUN_URL) {
        iceServers.push({ urls: process.env.STUN_URL });
    }
	
    // 如果.env中定义了TURN服务器，添加到iceServers
    if (process.env.TURN_URL && process.env.TURN_USER && process.env.TURN_CRED) {
        iceServers.push({
            urls: process.env.TURN_URL,
            username: process.env.TURN_USER,
            credential: process.env.TURN_CRED
        });
    }
	
	peer = new Peer(savedPeerId, {
        host: '/', // 使用相对路径
        port: location.port, // 使用当前窗口的端口
		path: process.env.PEERJS_PATH,
		secure: location.protocol === 'https:', // 如果是 HTTPS，则设置为 true
		key: process.env.PEERJS_KEY,
		config: { 'iceServers': iceServers }
	});

    peer.on('open', (id) => {
        updateLog("Peer 已打开，ID:", id);
        sessionStorage.setItem('savedPeerId', id);
        peer_id = id;
        if (!roomId) {
			updateLog("房主模式，创建房间ID");
            // 如果 URL 中没有 ID，代表是房主，需要创建 ID
            roomId = id;
            const newUrl = `${window.location.origin}${window.location.pathname}?id=${roomId}`;
			document.getElementById("room_url").value = newUrl;
			
			// 在房主模式下，隐藏 remoteVideo 和 do 按钮
            document.getElementById('remoteVideo').style.display = 'none';
            document.getElementById('do').style.display = 'none';
        } else {
			updateLog("加入模式，对方的Peer ID:", roomId);
            // 如果 URL 中有 ID，代表是对端，使用 URL 的 ID 作为对方的 Peer ID
			// 在加入模式下，隐藏 localVideo、up 按钮和 URL 相关元素
            document.getElementById('localVideo').style.display = 'none';
            document.getElementById('up').style.display = 'none';
            document.getElementById('room_url').style.display = 'none';
            document.getElementById('copy_url').style.display = 'none';

            other_peer_id = roomId;
			// 页面加载即开始链接，如果注释则手动点击按钮链接
            download_f(); 
			// 监听数据连接
            setupDataConnection();
        }
    });
	
	// 添加数据连接监听器
    peer.on('connection', (newDataConnection) => {
        updateLog("收到数据连接");
        dataConnection = newDataConnection; // 使用收到的数据连接
        setupDataConnectionHandlers(dataConnection); // 设置数据连接的事件处理
    });
	
	// 给 chatInput 添加键盘事件监听
    document.getElementById('chatInput').addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // 阻止默认的换行行为
            sendMessage(); // 调用发送消息的函数
        }
    });
}


//链接建立
function setupDataConnection() {
	if (!other_peer_id) {
        updateLog("无法建立数据连接，因为没有对方的 Peer ID");
        return;
    }
    dataConnection = peer.connect(other_peer_id); // 加入模式中初始化数据连接
    setupDataConnectionHandlers(dataConnection); // 设置数据连接的事件处理
	
	dataConnection.on('open', () => {
        updateLog("数据连接已打开，发送本地Peer ID");
        dataConnection.send({ type: 'peerId', data: peer_id });
    });
}

//处理消息
function setupDataConnectionHandlers(connection) {
    connection.on('data', (message) => {
        if (message.type === 'chatMessage') {
            let chatBox = document.getElementById('chatBox');
            chatBox.value += other_peer_id + ': ' + message.data + '\n'; // 显示聊天消息
        } else if (message.type === 'peerId') {
            // 处理首次连接时接收的 Peer ID
            updateLog("对方的 Peer ID:", message.data);
            other_peer_id = message.data;
			// 在接收到对方的 Peer ID 后，尝试发送本地流
            upload_f();
        }
    });
    connection.on('close', () => {
        updateLog("数据连接已关闭");
        
    });

    connection.on('error', (error) => {
        updateLog("数据连接错误:", error);
        
    });
}


// 发送聊天消息
function sendMessage() {
    let chatInput = document.getElementById('chatInput');
    if (chatInput.value.trim() === '') return;

    if (!dataConnection || dataConnection.peerConnection.iceConnectionState !== "connected") {
        updateLog("无法发送消息，因为数据连接未建立或已断开");
        return;
    }

    let message = chatInput.value;
    dataConnection.send({ type: 'chatMessage', data: message }); // 包装消息和类型

    let chatBox = document.getElementById('chatBox');
    chatBox.value += '我: ' + message + '\n';

	chatBox.scrollTop = chatBox.scrollHeight; // 滚动到底部
    chatInput.value = ''; // 清空输入框
}


function copyToClipboard() {
    var text = document.getElementById('room_url').value;
    navigator.clipboard.writeText(text).then(() => {
        updateLog('文本已成功复制到剪切板');
    }).catch(err => {
        updateLog('无法复制文本: ', err);
    });
}

//发送本地流
async function upload_f() {
    // 如果本地流不存在，则尝试获取并播放
    if (!localStream) {
        updateLog("尝试获取本地流");
        try {
            localStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
					echoCancellation: false, // 开启回声消除
					noiseSuppression: false, // 开启噪声抑制
					autoGainControl: false, // 开启自动增益控制
					sampleRate: 48000, // 设置较高的采样率
					sampleSize: 24,		//采样位数
					channelCount: 2 // 设置双声道
				}
            });
            document.getElementById('localVideo').srcObject = localStream;
			
            // 为每个轨道添加结束事件的监听器
            localStream.getTracks().forEach(track => {
                track.onended = () => {
                    updateLog("共享已停止");
                    localStream = null; // 清空本地流
                    document.getElementById('localVideo').srcObject = null; // 清空视频元素的源
                    // 执行其他必要的清理操作
                };
            });
        } catch (error) {
            updateLog('获取屏幕流失败:', error);
            alert('无法获取屏幕共享。请确保给予了相应权限。');
            return;
        }
    }

    // 检查是否有对方的 Peer ID
    if (!other_peer_id) {
        updateLog("未获取到对方的 Peer ID，暂不发送流");
        return;
    }

    updateLog("已经链接，开始推流");
    const call = peer.call(other_peer_id, localStream);
    updateLog("呼叫对方，Peer ID:", other_peer_id);

	// 获取RTCPeerConnection实例
    const peerConnection = call.peerConnection;

    // 找到音频轨道的RTCRtpSender
    const audioTrack = localStream.getAudioTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track === audioTrack);

    // 修改参数
    const params = sender.getParameters();
    if (!params.encodings) {
        params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = 128000;
    sender.setParameters(params);

    call.on('error', (err) => {
        updateLog('呼叫错误:', err);
    });
}


// 接收远程流
function download_f() {
    updateLog("准备接收远程流");
    peer.on('call', (call) => {
        updateLog("收到呼叫");

        call.answer(null); // 回答呼叫时不发送本地流

        call.on('stream', (remoteStream) => {
            updateLog("远程流已接收");
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = remoteStream;
            remoteVideo.play().catch(err => {
                updateLog('自动播放失败:', err);
            });
			//在相应的回调中获取 RTCPeerConnection 对象
			rtcConn = call.peerConnection;
			updateStatus(rtcConn);
        });

        call.on('error', (err) => {
            updateLog('接收远程流错误:', err);
        });
    });

    remoteVideo.play().catch(err => {
        updateLog('自动播放失败:', err);
    });
}

function updateLog(...args) {
    const logElement = document.getElementById('log');
    const message = args.join(' '); // 将所有参数连接成一个字符串
    logElement.value += message + '\n'; // 添加新消息
    logElement.scrollTop = logElement.scrollHeight; // 滚动到底部
}


function updateStatus(rtcConn){
	// 更新连接状态
    rtcConn.onconnectionstatechange = function() {
        document.getElementById('status').value = ('连接状态：' + rtcConn.connectionState);
    };

	// 更新连接模式
	rtcConn.onicecandidate = function(event) {
		if (event.candidate) {
			let mode;
			if (event.candidate.type === 'relay') {
				mode = '通过 TURN 服务器中继';
				// 显示详细的 ICE 候选信息
				let details = `候选类型: ${event.candidate.type}, 地址: ${event.candidate.address}, 端口: ${event.candidate.port}, 协议: ${event.candidate.protocol}`;
				document.getElementById('mode').value = '连接模式：' + mode + '，' + details;
			} else {
				mode = 'P2P 直连';
				document.getElementById('mode').value = '连接模式：' + mode;
			}
		}
	};


    // 更新连接速率（这需要定期更新，例如每秒）
    setInterval(() => {
        rtcConn.getStats(null).then(stats => {
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && !report.isRemote) {
                    const currentSpeed = report.bytesReceived / report.timestamp;
                    document.getElementById('speed').value = ('下载速率：' + currentSpeed.toFixed(2) + ' bytes/s');
                }
                if (report.type === 'outbound-rtp' && !report.isRemote) {
                    const currentSpeed = report.bytesSent / report.timestamp;
                    document.getElementById('speed').value = ('上传速率：' + currentSpeed.toFixed(2) + ' bytes/s');
                }
            });
        });
    }, 1000);
}
