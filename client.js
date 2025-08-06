// client.js (Updated for Waterfall & IP)

document.addEventListener('DOMContentLoaded', () => {
    // UI 元素
    const statusDiv = document.getElementById('status');
    const midiDeviceSelect = document.getElementById('midi-devices');
    const noteVisualizer = document.getElementById('note-visualizer');
    const clientList = document.getElementById('client-list');

    // 状态与配置
    let audioContext;
    let compressor;
    const activeAudioNodes = new Map();
    const midiKeyColors = new Array(128); // 存储每个MIDI音符的颜色
    let myId = null;
    let midiAccess = null;
    let clientData = new Map(); // 存储所有用户数据 {id, ip, color}

    // 1. Socket.IO 连接
    const socket = io();

    socket.on('connect', () => statusDiv.textContent = '服务器已连接！');
    socket.on('disconnect', () => statusDiv.textContent = '与服务器断开连接。');
    socket.on('your-id', (id) => myId = id);

    // 更新用户列表
    socket.on('update-user-list', (users) => {
        clientData.clear();
        clientList.innerHTML = '';
        users.forEach(user => {
            clientData.set(user.id, user); // 存储完整用户数据

            const li = document.createElement('li');
            const swatch = document.createElement('span');
            swatch.className = 'client-color-swatch';
            swatch.style.backgroundColor = hsvToHslCss(user.color);

            const name = document.createTextNode(`用户: ${user.ip}`);

            li.appendChild(swatch);
            li.appendChild(name);

            if (user.id === myId) {
                li.classList.add('you');
                li.appendChild(document.createTextNode(' (你)'));
            }
            clientList.appendChild(li);
        });
    });

    // 2. 音频与MIDI初始化
    const initAudioContext = () => {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                compressor = audioContext.createDynamicsCompressor();
                compressor.connect(audioContext.destination);
                statusDiv.textContent = '音频已就绪。请选择MIDI设备。';
            } catch (e) { alert('此浏览器不支持Web Audio API'); }
        }
    };
    document.body.addEventListener('click', initAudioContext, { once: true });

    // 3. 辅助函数
    const midiToNoteName = (midi) => {
        const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(midi / 12) - 1;
        return names[midi % 12] + octave;
    };


    /**
     * 将HSV颜色对象转换为CSS HSL字符串
     * @param {{h: number, s: number, v: number}} hsv HSV颜色对象
     * @returns {string} CSS hsl(h, s, l) 字符串
     */
    function hsvToHslCss({ h, s, v }) {
        const l = v * (1 - s / 2);
        const s_hsl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
        return `hsl(${h}, ${s_hsl * 100}%, ${l * 100}%)`;
    }

    const isSharp = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);

    // 4. 音频播放逻辑
    const playNoteAudio = (midi, velocity) => {
        if (!audioContext) return;

        const gainValue = velocity / 127;
        const freq = Math.pow(2, (midi - 69) / 12) * 440;

        const time = audioContext.currentTime;
        const decayTime = 0.3 * Math.pow(2, (69 - midi) / 24);
        const envelope = audioContext.createGain();
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.setTargetAtTime(gainValue, time, 0.002);
        envelope.gain.setTargetAtTime(0, time + 0.01, decayTime);

        const oscillator = audioContext.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(freq, time);
        oscillator.connect(envelope).connect(compressor);
        oscillator.start(time);

        activeAudioNodes.set(midi, { oscillator, envelope });
    };

    const stopNoteAudio = (midi) => {
        const node = activeAudioNodes.get(midi);
        if (node && audioContext) {
            const now = audioContext.currentTime;
            node.envelope.gain.cancelScheduledValues(now);
            node.envelope.gain.setValueAtTime(node.envelope.gain.value, now);
            node.envelope.gain.linearRampToValueAtTime(0, now + 0.3);
            node.oscillator.stop(now + 0.3);
            activeAudioNodes.delete(midi);
        }
    };

    // 5. 瀑布流视觉逻辑
    const createNoteVisual = (midi, color) => {
        midiKeyColors[midi] = color; // 存储音符颜色
    };

    const releaseNoteVisual = (midi) => {
        midiKeyColors[midi] = "black"; // 清除音符颜色
    };

    // 6. 动画循环
    const canvasCtx = noteVisualizer.getContext('2d');
    const updateWaterfall = () => {
        // 把之前的内容下移1像素
        const canvasWidth = noteVisualizer.clientWidth;
        const canvasHeight = noteVisualizer.clientHeight;
        canvasCtx.drawImage(noteVisualizer, 0, 1, canvasWidth, canvasHeight);
        canvasCtx.fillStyle = '#00000010';
        canvasCtx.fillRect(0, 0, canvasWidth, 1); // 顶部覆盖一层半透明黑色，制造淡出效果

        for (let midi = 0; midi < 128; midi++) {
            const color = midiKeyColors[midi];
            if (color) {
                const w = canvasWidth / 128;
                const x = midi * w;
                canvasCtx.fillStyle = color;
                canvasCtx.fillRect(x, 0, w, 1);
                midiKeyColors[midi] = null; // 清除颜色以便下次不再绘制
            }
        }
        requestAnimationFrame(updateWaterfall);
    };

    const resizeObserver = new ResizeObserver(() => {
        const width = noteVisualizer.clientWidth;
        const height = noteVisualizer.clientHeight;
        noteVisualizer.width = width;
        noteVisualizer.height = height;
    });
    resizeObserver.observe(noteVisualizer);

    // 7. MIDI 消息处理
    const onMIDISuccess = (access) => {
        midiAccess = access;
        statusDiv.textContent = '成功访问MIDI！';
        const inputs = midiAccess.inputs.values();
        midiDeviceSelect.innerHTML = '';
        if (midiAccess.inputs.size === 0) {
            midiDeviceSelect.innerHTML = '<option>未检测到设备</option>';
            statusDiv.textContent = '请连接MIDI设备并刷新。';
            return;
        }
        for (const input of inputs) {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name;
            midiDeviceSelect.appendChild(option);
        }
        listenToSelectedDevice(); // 自动监听第一个设备
        midiDeviceSelect.addEventListener('change', listenToSelectedDevice);
    };

    const onMIDIFailure = (msg) => statusDiv.textContent = `无法访问MIDI设备: ${msg}`;

    const listenToSelectedDevice = () => {
        for (const input of midiAccess.inputs.values()) input.onmidimessage = null;
        const selectedInput = midiAccess.inputs.get(midiDeviceSelect.value);
        if (selectedInput) {
            statusDiv.textContent = `正在监听: ${selectedInput.name}`;
            selectedInput.onmidimessage = getMIDIMessage;
        }
    };

    socket.on('midi', (message) => {
        let delayTime = 0;
        const baseLatency = 0.1; // 基础延迟，单位为秒
        const playerId = message.senderId;
        const client = clientData.get(playerId);
        const now = audioContext.currentTime;
        const time = message.midiData.time || now; // 使用消息中的时间戳或当前时间
        if (playerId !== myId) {
            const lastEventTime = client?.lastEventTime || 0;
            const lastEventLocalTime = client?.lastEventLocalTime || audioContext.currentTime;

            const timeDelta = time - lastEventTime;
            const localTimeDelta = now - lastEventLocalTime;
            // 计算延迟时间，确保不会小于0
            delayTime = timeDelta - localTimeDelta;
            console.log(delayTime)

            // 更新该用户的最后事件时间
            if (client) {
                client.lastEventTime = time;
                client.lastEventLocalTime = now;
            }
        }
        delayTime += baseLatency; // 添加基础延迟

        if (delayTime < 0) {
            delayTime = 0;
        }

        if (delayTime > 0) {
            setTimeout(() => {
                handleMIDIMessage(message);
            }, delayTime);
        }else {
            handleMIDIMessage(message);
        }
    });

    // 本地设备产生的消息
    const getMIDIMessage = (message) => {
        if (!audioContext) initAudioContext();
        const midiData = { command: message.data[0], note: message.data[1], velocity: message.data[2], time: audioContext.currentTime };
        // 本地消息直接用自己的ID处理，并发送给服务器
        handleMIDIMessage({ senderId: myId, midiData: midiData });
        socket.emit('midi', midiData);
    };

    const handleMIDIMessage = ({ senderId, midiData }) => {
        if (!senderId) return; // 如果没有发送者ID，则忽略
        const { command, note, velocity, time } = midiData;
        switch (command & 0xF0) {
            case 0x90: // Note On
                velocity > 0 ? playNote(note, velocity, senderId, time) : stopNote(note);
                break;
            case 0x80: // Note Off
                stopNote(note);
                break;
        }
    };

    const playNote = (midi, velocity, playerId, time) => {
        // 同一用户弹奏自己已按下的音符时，先停止旧的
        // if (visualNotes.has(midi)) {
        //     stopNote(midi);
        // }

        const baseLatency = 0; // 基础延迟，单位为秒
        const now = audioContext.currentTime;
        const client = clientData.get(playerId);

        playNoteAudio(midi, velocity);
        createNoteVisual(midi, hsvToHslCss(client.color));
    };

    const stopNote = (midi) => {
        stopNoteAudio(midi);
        releaseNoteVisual(midi);
    };


    // 8. 启动
    navigator.requestMIDIAccess?.({ sysex: false }).then(onMIDISuccess, onMIDIFailure);
    startAnimationLoop();

    function startAnimationLoop() {
        requestAnimationFrame(updateWaterfall);
    }

    function acquireWakelock() {
        if ('wakeLock' in navigator) {
            try {
                navigator.wakeLock.request('screen').then(lock => {
                    lock.addEventListener('release', e => {
                        console.log("wakelock released");
                    })
                });
            } catch (error) {
                console.error(error);
            }
        }
    }

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === 'visible') {
            acquireWakelock();
        }
    });
    acquireWakelock();
});