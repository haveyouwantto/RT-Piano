// client.js (Updated for Waterfall & IP)

document.addEventListener('DOMContentLoaded', () => {
    // UI 元素
    const statusDiv = document.getElementById('status');
    const midiDeviceSelect = document.getElementById('midi-devices');
    const noteVisualizer = document.getElementById('note-visualizer');
    const clientList = document.getElementById('client-list');
    const JITTER_BUFFER_SECONDS = 0.150;

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
        clientList.innerHTML = '';
        users.forEach(user => {
            // Preserve existing client data like clockOffset when the list updates
            const existingClient = clientData.get(user.id) || {};
            user.cssColor = hsvToHslCss(user.color);
            clientData.set(user.id, { ...user, ...existingClient });

            const li = document.createElement('li');
            const swatch = document.createElement('span');
            swatch.className = 'client-color-swatch';
            swatch.style.backgroundColor = user.cssColor;

            const name = document.createTextNode(user.ip);

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
    const playNoteAudio = (midi, velocity, time) => {
        if (!audioContext) return;

        const gainValue = velocity / 127;
        const freq = Math.pow(2, (midi - 69) / 12) * 440;

        const decayTime = 0.2 * Math.pow(2, (69 - midi) / 24);
        const envelope = audioContext.createGain();
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(gainValue, time + 0.002); // More responsive attack
        envelope.gain.setTargetAtTime(0, time + 0.01, decayTime);

        const oscillator = audioContext.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(freq, time);
        oscillator.connect(envelope).connect(compressor);
        oscillator.start(time);

        // Schedule the stop time far enough in the future to allow for decay
        oscillator.stop(time + decayTime * 5); // Ensure oscillator is cleaned up

        activeAudioNodes.set(midi, { oscillator, envelope });
    };

    const stopNoteAudio = (midi) => {
        const node = activeAudioNodes.get(midi);
        if (node && audioContext) {
            const now = audioContext.currentTime;
            // Smoothly ramp down the volume from its current value
            node.envelope.gain.cancelScheduledValues(now);
            node.envelope.gain.setTargetAtTime(0, now, 0.1); // Fast release
            node.oscillator.stop(now + 0.5); // Stop after release
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
        const { senderId, midiData } = message;
        if (!audioContext) return; // Audio not ready

        let scheduledTime;
        const client = clientData.get(senderId);

        // This should not happen if the server is working correctly, but as a safeguard:
        if (!client) return;

        // If clockOffset is not yet calculated for this client, calculate it now.
        if (client.clockOffset === undefined) {
            // Offset = local time when we received message - time the message was sent + buffer
            client.clockOffset = audioContext.currentTime - midiData.time + JITTER_BUFFER_SECONDS;
            console.log(`Initialized clock offset for ${client.ip}: ${client.clockOffset.toFixed(3)}s`);
        }

        // The scheduled play time on our local AudioContext timeline
        scheduledTime = midiData.time + client.clockOffset;

        // To prevent a flood of notes from a misbehaving client or clock error,
        // don't schedule things too far in the future.
        if (scheduledTime > audioContext.currentTime + 10) {
            console.warn("Note scheduled too far in the future, ignoring.");
            return;
        }

        // If the note is already late, play it ASAP but log the tardiness.
        if (scheduledTime < audioContext.currentTime) {
            console.log(`Note from ${client.ip} is late by ${(audioContext.currentTime - scheduledTime).toFixed(3)}s. Playing now.`);
            scheduledTime = audioContext.currentTime;
        }

        handleMIDIMessage(senderId, midiData, scheduledTime);
    });

    // 本地设备产生的消息
    const getMIDIMessage = (message) => {
        if (!audioContext) initAudioContext();
        // For local messages, the scheduled time is *now*.
        const scheduledTime = audioContext.currentTime;
        const midiData = { command: message.data[0], note: message.data[1], velocity: message.data[2], time: scheduledTime };

        // Handle locally immediately
        handleMIDIMessage(myId, midiData, scheduledTime);

        // Send to server with our precise audioContext timestamp
        socket.emit('midi', midiData);
    };

    const handleMIDIMessage = (senderId, midiData, scheduledTime) => {
        if (!senderId) return;
        const { command, note, velocity } = midiData;

        switch (command & 0xF0) {
            case 0x90: // Note On
                if (velocity > 0) {
                    playNote(note, velocity, senderId, scheduledTime);
                } else {
                    // Note On with velocity 0 is often used as Note Off
                    // stopNote(note);
                }
                break;
            case 0x80: // Note Off
                // stopNote(note);
                break;
        }
    };

    const playNote = (midi, velocity, playerId, scheduledTime) => {
        const client = clientData.get(playerId);
        if (!client) return;

        // Schedule the audio to play at the precise time
        playNoteAudio(midi, velocity, scheduledTime);

        // Schedule the VISUAL update to happen at the same time using setTimeout
        const visualDelayMs = Math.max(0, (scheduledTime - audioContext.currentTime) * 1000);

        setTimeout(() => {
            createNoteVisual(midi, client.cssColor);
        }, visualDelayMs);
    };

    const stopNote = (midi) => {
        // Note Off events are handled immediately upon receipt.
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