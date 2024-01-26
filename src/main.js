let peer;
let peer_id;
let other_peer_id; //对方的PeerID
let localStream;
let dataConnection = null; // 存储数据连接

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = urlParams.get('id');
    let savedPeerId = sessionStorage.getItem('savedPeerId');

    if (savedPeerId) {
        updateLog("使用存储的 Peer ID:", savedPeerId);
        peer_id = savedPeerId;
    }

    initPeer(savedPeerId, roomId);
});

function initPeer(savedPeerId = null, roomId = null) {
    peer = new Peer(savedPeerId);
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
                audio: true
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
