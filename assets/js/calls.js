/**
 * Модуль звонков: конфиг, WebRTC (режим webrtc_only), UI входящего/активного вызова.
 * Зависит: API_BASE, apiRequest (app.js), загрузка после chat.js для доступа к данным беседы.
 * Версия: 2025-02-12 (аватар при выкл. видео)
 */
(function() {
    'use strict';

    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || (typeof document !== 'undefined' && document.body && document.body.getAttribute('data-base-url')) || '';
    const userUuid = typeof document !== 'undefined' && document.body && document.body.dataset ? (document.body.dataset.userUuid || '') : '';
    const C = (typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.calls) || {};
    const Call = (typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.call) || {};
    function callsL(key, fallback) { return (C[key] !== undefined && C[key] !== '') ? C[key] : (fallback || ''); }
    /** Для меток с переносом строки: в PHP в одинарных кавычках \n — два символа; конвертируем в <br> для отображения. Экранирует HTML. */
    function callsLabelBr(str) {
        if (str == null || str === '') return '';
        var t = String(str).replace(/\\n/g, '\n');
        t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return t.replace(/\n/g, '<br>');
    }

    let callConfig = null;
    let callState = {
        callId: null,
        conversationId: null,
        peerUuid: null,
        withVideo: false,
        isCaller: false,
        localStream: null,
        remoteStream: null,
        pc: null,
        durationStart: null,
        durationTimer: null,
        pendingInvite: null,
        pendingOffer: null,
        incomingCallMinimized: null,
        joiningOngoingCall: false,
        groupCallId: null,
        peers: null,
        participantUuids: [],
        participantGuestIds: [],
        guestDisplayNames: {},
        iceBuffer: [],
        peerIceBuffers: null,
        recording: false,
        recordingType: null,
        mediaRecorder: null,
        recordedChunks: [],
        recordingStream: null,
        peerMuted: null,
        peerMutedMap: null,
        _speakingContext: null,
        _speakingAnalyser: null,
        _speakingSource: null,
        _speakingRafId: null,
        _groupSpeakingAnalysers: null,
        _groupSpeakingRafId: null,
        screenStream: null,
        isSharingScreen: false,
        _hadVideoBeforeShare: false,
        remoteScreenSharing: false,
        peerScreenSharing: null,
        facingMode: 'user',
        callMinimized: false,
    };

    function getVideoConstraints() {
        var base = { facingMode: callState.facingMode || 'user' };
        if (typeof base.width === 'undefined') {
            base.width = { ideal: 640 };
            base.height = { ideal: 480 };
        }
        return base;
    }

    var SPEAKING_THRESHOLD = 25;
    var ringtoneAudioContext = null;

    function unlockRingtoneAudioContext() {
        if (ringtoneAudioContext) return;
        var C = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
        if (!C) return;
        try {
            ringtoneAudioContext = new C();
            if (ringtoneAudioContext.state === 'suspended' && typeof ringtoneAudioContext.resume === 'function') {
                ringtoneAudioContext.resume().catch(function() {});
            }
        } catch (e) {}
    }

    function onceUnlockAudioContext() {
        unlockRingtoneAudioContext();
        document.removeEventListener('click', onceUnlockAudioContext, true);
        document.removeEventListener('touchstart', onceUnlockAudioContext, true);
        document.removeEventListener('keydown', onceUnlockAudioContext, true);
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('click', onceUnlockAudioContext, { passive: true, once: true, capture: true });
        document.addEventListener('touchstart', onceUnlockAudioContext, { passive: true, once: true, capture: true });
        document.addEventListener('keydown', onceUnlockAudioContext, { passive: true, once: true, capture: true });
    }

    var MUTED_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5 5zM4.27 3L3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08L19.73 21 21 19.73l-9-9L4.27 3z"/></svg>';

    function apiRequest(url, options = {}) {
        if (typeof window.apiRequest === 'function') return window.apiRequest(url, options);
        return fetch(url, { credentials: 'include', ...options }).then(function(r) {
            if (!r.ok) throw new Error(r.statusText || 'Request failed');
            return r.json();
        });
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    /**
     * Загрузить конфиг звонков с сервера.
     */
    function loadConfig() {
        if (!API_BASE) return Promise.resolve(null);
        return fetch(API_BASE + '/api/calls.php?action=config', { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(res) {
                if (res && res.success && res.data) {
                    callConfig = res.data;
                    return callConfig;
                }
                return null;
            })
            .catch(function() { return null; });
    }

    /**
     * Инициализация: загрузка конфига, создание DOM для модалок и панели.
     */
    function init() {
        if (callConfig !== null) return Promise.resolve(callConfig);
        return loadConfig().then(function(cfg) {
            ensureCallUI();
            if (window.chatModule && typeof window.chatModule.refreshChatHeader === 'function') {
                window.chatModule.refreshChatHeader();
            }
            return cfg;
        });
    }

    function getStunConfig() {
        const stun = (callConfig && callConfig.stun) ? callConfig.stun : 'stun:stun.l.google.com:19302';
        return { iceServers: [{ urls: stun }] };
    }

    function serializeSdp(desc) {
        if (!desc) return null;
        return { type: desc.type, sdp: desc.sdp || '' };
    }

    function sendSignaling(conversationId, targetKey, payload) {
        if (!API_BASE || !conversationId || !targetKey) return Promise.reject(new Error('Missing params'));
        const url = API_BASE + '/api/calls.php?action=signaling';
        const body = { conversation_id: conversationId };
        if (String(targetKey).indexOf('guest_') === 0) {
            body.target_guest_id = parseInt(targetKey.replace('guest_', ''), 10);
        } else {
            body.target_uuid = targetKey;
        }
        if (payload.sdp) body.sdp = serializeSdp(payload.sdp);
        if (payload.ice) body.ice = payload.ice;
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return apiRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    }

    function endCallApi(callId) {
        if (!API_BASE || !callId) return Promise.resolve();
        return fetch(API_BASE + '/api/calls.php?action=end', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call_id: callId }),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function cleanupCall() {
        if (callState.durationTimer) {
            clearInterval(callState.durationTimer);
            callState.durationTimer = null;
        }
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(function(t) { t.stop(); });
            callState.localStream = null;
        }
        if (callState.pc) {
            callState.pc.close();
            callState.pc = null;
        }
        if (callState.peers) {
            callState.peers.forEach(function(p) { if (p && p.pc) p.pc.close(); });
            callState.peers.clear();
        }
        callState.remoteStream = null;
        callState.callId = null;
        callState.conversationId = null;
        callState.peerUuid = null;
        callState.durationStart = null;
        callState.groupCallId = null;
        callState.peers = null;
        callState.participantUuids = [];
        callState.participantGuestIds = [];
        callState.guestDisplayNames = {};
        callState.iceBuffer = [];
        callState.peerIceBuffers = null;
        callState.peerMuted = null;
        callState.peerMutedMap = null;
        if (callState.screenStream) {
            callState.screenStream.getTracks().forEach(function(t) { t.stop(); });
            callState.screenStream = null;
        }
        callState.isSharingScreen = false;
        callState.remoteScreenSharing = false;
        callState.peerScreenSharing = null;
        var panel = document.getElementById('callPanel');
        if (panel) { panel.classList.remove('call-panel-remote-screen-share'); panel.classList.remove('call-panel-local-screen-share'); }
        var gp = document.getElementById('groupCallPanel');
        if (gp) gp.classList.remove('group-call-local-screen-share');
        document.querySelectorAll('.group-call-remote-slot-screen-share').forEach(function(el) { el.classList.remove('group-call-remote-slot-screen-share'); });
        stopSpeakingMonitor();
        stopRecordingIfActive(true);
        hideRecordingBanner();
        hideIncomingModal();
        var endCallModal = document.getElementById('modalEndCallChoice');
        if (endCallModal) endCallModal.classList.add('is-hidden');
        hideCallPanel();
        hideGroupCallPanel();
    }

    function isMediaRecorderSupported() {
        return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
    }

    function getRecordingMimeType(audioOnly) {
        if (!isMediaRecorderSupported()) return '';
        if (audioOnly && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (audioOnly && MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (!audioOnly && MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) return 'video/webm;codecs=vp9,opus';
        if (!audioOnly && MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
        return audioOnly ? 'audio/webm' : 'video/webm';
    }

    function createRecordingStream1v1(type) {
        var local = callState.localStream;
        var remoteV = document.getElementById('callPanelRemoteVideo');
        var remote = callState.remoteStream || (remoteV && remoteV.srcObject);
        if (!local) return null;
        if (!remote || typeof remote.getAudioTracks !== 'function') remote = null;
        var audioOnly = (type === 'audio');
        try {
            var outStream = new MediaStream();
            var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);

            if (Ctx) {
                var ctx = new Ctx();
                var dest = ctx.createMediaStreamDestination();
                var localSrc = ctx.createMediaStreamSource(local);
                localSrc.connect(dest);
                if (remote && remote.getAudioTracks().length) {
                    var remoteSrc = ctx.createMediaStreamSource(remote);
                    remoteSrc.connect(dest);
                }
                dest.stream.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                callState._recordingAudioContext = ctx;
            } else {
                local.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                if (remote && remote.getAudioTracks()) {
                    remote.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                }
            }

            if (!audioOnly) {
                var localV = document.getElementById('callPanelLocalVideo');
                if ((localV && localV.videoWidth) || (remoteV && remoteV.videoWidth)) {
                    var canvas = document.createElement('canvas');
                    canvas.width = 1280;
                    canvas.height = 720;
                    var ctx2d = canvas.getContext('2d');
                    callState._recordingCanvas = canvas;

                    function drawVideoFit(video, dx, dy, dw, dh) {
                        var vw = video.videoWidth;
                        var vh = video.videoHeight;
                        if (vw <= 0 || vh <= 0) return;
                        var scale = Math.min(dw / vw, dh / vh);
                        var drawW = vw * scale;
                        var drawH = vh * scale;
                        var x = dx + (dw - drawW) / 2;
                        var y = dy + (dh - drawH) / 2;
                        ctx2d.drawImage(video, x, y, drawW, drawH);
                    }
                    function drawFrame() {
                        ctx2d.fillStyle = '#000';
                        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
                        if (remoteV && remoteV.videoWidth > 0) {
                            drawVideoFit(remoteV, 0, 0, canvas.width, canvas.height);
                        }
                        if (localV && localV.videoWidth > 0) {
                            drawVideoFit(localV, canvas.width - 256, 16, 240, 135);
                        }
                        callState._recordingRafId = requestAnimationFrame(drawFrame);
                    }
                    drawFrame();
                    var canvasStream = canvas.captureStream(25);
                    canvasStream.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                } else {
                    local.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                    if (remote && remote.getVideoTracks()) {
                        remote.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                    }
                }
            }
            if (outStream.getTracks().length === 0) return null;
            return outStream;
        } catch (e) {
            console.error('createRecordingStream1v1:', e);
            return null;
        }
    }

    function createRecordingStreamGroup(type) {
        var local = callState.localStream;
        var peers = callState.peers;
        if (!local) return null;
        var audioOnly = (type === 'audio');
        try {
            var outStream = new MediaStream();
            var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
            if (Ctx) {
                var ctx = new Ctx();
                var dest = ctx.createMediaStreamDestination();
                var localSrc = ctx.createMediaStreamSource(local);
                localSrc.connect(dest);
                if (peers && peers.forEach) {
                    peers.forEach(function(peer) {
                        var stream = peer.videoEl && peer.videoEl.srcObject;
                        if (stream && stream.getAudioTracks && stream.getAudioTracks().length) {
                            var src = ctx.createMediaStreamSource(stream);
                            src.connect(dest);
                        }
                    });
                }
                dest.stream.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                callState._recordingAudioContext = ctx;
            } else {
                local.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                if (peers && peers.forEach) {
                    peers.forEach(function(peer) {
                        var stream = peer.videoEl && peer.videoEl.srcObject;
                        if (stream && stream.getAudioTracks) {
                            stream.getAudioTracks().forEach(function(t) { outStream.addTrack(t); });
                        }
                    });
                }
            }
            if (!audioOnly) {
                var panel = document.getElementById('groupCallPanel');
                var localV = panel ? panel.querySelector('.group-call-local-video') : null;
                var remoteSlots = panel ? panel.querySelectorAll('.group-call-remote-slot video') : [];
                if ((localV && localV.videoWidth) || (remoteSlots.length && remoteSlots[0].videoWidth)) {
                    var canvas = document.createElement('canvas');
                    canvas.width = 1280;
                    canvas.height = 720;
                    var ctx2d = canvas.getContext('2d');
                    callState._recordingCanvas = canvas;
                    function drawVideoFitGroup(video, dx, dy, dw, dh) {
                        var vw = video.videoWidth;
                        var vh = video.videoHeight;
                        if (vw <= 0 || vh <= 0) return;
                        var scale = Math.min(dw / vw, dh / vh);
                        var drawW = vw * scale;
                        var drawH = vh * scale;
                        var x = dx + (dw - drawW) / 2;
                        var y = dy + (dh - drawH) / 2;
                        ctx2d.drawImage(video, x, y, drawW, drawH);
                    }
                    function drawFrameGroup() {
                        ctx2d.fillStyle = '#000';
                        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
                        var col = 0;
                        var row = 0;
                        var cellW = remoteSlots.length ? Math.min(640, Math.floor(canvas.width / Math.max(1, Math.ceil(Math.sqrt(remoteSlots.length + 1))))) : canvas.width;
                        var cellH = Math.floor(cellW * 9 / 16);
                        if (localV && localV.videoWidth > 0) {
                            drawVideoFitGroup(localV, col * cellW, row * cellH, cellW, cellH);
                            col++;
                        }
                        for (var i = 0; i < remoteSlots.length; i++) {
                            var v = remoteSlots[i];
                            if (v && v.videoWidth > 0) {
                                drawVideoFitGroup(v, col * cellW, row * cellH, cellW, cellH);
                                col++;
                                if (col * cellW >= canvas.width) { col = 0; row++; }
                            }
                        }
                        callState._recordingRafId = requestAnimationFrame(drawFrameGroup);
                    }
                    drawFrameGroup();
                    var canvasStream = canvas.captureStream(25);
                    canvasStream.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                } else {
                    local.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                    if (peers && peers.forEach) {
                        peers.forEach(function(peer) {
                            var stream = peer.videoEl && peer.videoEl.srcObject;
                            if (stream && stream.getVideoTracks) {
                                stream.getVideoTracks().forEach(function(t) { outStream.addTrack(t); });
                            }
                        });
                    }
                }
            }
            if (outStream.getTracks().length === 0) return null;
            return outStream;
        } catch (e) {
            console.error('createRecordingStreamGroup:', e);
            return null;
        }
    }

    function downloadRecordedBlob(blob, type) {
        var suffix = type === 'video' ? 'video' : 'audio';
        var now = new Date();
        var name = 'call-recording-' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0') + '-' + suffix + '.webm';
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
    }

    function recordingStartedApi() {
        if (!API_BASE || !callState.conversationId) return Promise.resolve();
        var body = { conversation_id: callState.conversationId };
        if (callState.callId) body.call_id = callState.callId;
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return fetch(API_BASE + '/api/calls.php?action=recording_started', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function recordingStoppedApi() {
        if (!API_BASE || !callState.conversationId) return Promise.resolve();
        var body = { conversation_id: callState.conversationId };
        if (callState.callId) body.call_id = callState.callId;
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return fetch(API_BASE + '/api/calls.php?action=recording_stopped', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function screenShareStartedApi() {
        if (!API_BASE || !callState.conversationId) return Promise.resolve();
        var body = { conversation_id: callState.conversationId };
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return fetch(API_BASE + '/api/calls.php?action=screen_share_start', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function screenShareStoppedApi() {
        if (!API_BASE || !callState.conversationId) return Promise.resolve();
        var body = { conversation_id: callState.conversationId };
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return fetch(API_BASE + '/api/calls.php?action=screen_share_stop', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function sendMuteStateApi(muted) {
        if (!API_BASE || !callState.conversationId) return Promise.resolve();
        var body = { conversation_id: callState.conversationId, muted: !!muted };
        if (callState.groupCallId) body.group_call_id = callState.groupCallId;
        return fetch(API_BASE + '/api/calls.php?action=call_muted', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function(r) { return r.json(); }).catch(function() {});
    }

    function stopRecordingIfActive(offerDownload) {
        if (!callState.recording || !callState.mediaRecorder) return;
        var rec = callState.mediaRecorder;
        var type = callState.recordingType;
        callState.mediaRecorder = null;
        callState.recording = false;
        callState.recordingType = null;
        if (callState.recordingStream) {
            callState.recordingStream.getTracks().forEach(function(t) { t.stop(); });
            callState.recordingStream = null;
        }
        if (callState._recordingRafId) {
            cancelAnimationFrame(callState._recordingRafId);
            callState._recordingRafId = null;
        }
        callState._recordingCanvas = null;
        if (callState._recordingAudioContext && typeof callState._recordingAudioContext.close === 'function') {
            callState._recordingAudioContext.close();
            callState._recordingAudioContext = null;
        }
        rec.onstop = function() {
            if (offerDownload && callState.recordedChunks && callState.recordedChunks.length) {
                var blob = new Blob(callState.recordedChunks, { type: rec.mimeType || getRecordingMimeType(type === 'audio') || 'audio/webm' });
                downloadRecordedBlob(blob, type);
            }
            callState.recordedChunks = [];
            recordingStoppedApi();
            updateRecordingUI();
            updateGroupRecordingUI();
        };
        try {
            if (rec.state !== 'inactive') rec.stop();
        } catch (e) {
            rec.onstop();
        }
        updateRecordingUI();
    }

    function startRecordingGroup(type) {
        if (callState.recording || !callState.groupCallId) return;
        var stream = createRecordingStreamGroup(type);
        if (!stream || !stream.getTracks().length) return;
        var audioOnly = (type === 'audio');
        var mimeType = getRecordingMimeType(audioOnly);
        if (!isMediaRecorderSupported()) return;
        callState.recordingStream = stream;
        callState.recordingType = type;
        callState.recordedChunks = [];
        var recorder;
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        } catch (e) {
            recorder = new MediaRecorder(stream);
        }
        recorder.ondataavailable = function(ev) {
            if (ev.data && ev.data.size) callState.recordedChunks.push(ev.data);
        };
        recorder.onstop = function() {
            if (callState.recordedChunks.length) {
                var blob = new Blob(callState.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
                downloadRecordedBlob(blob, type);
            }
            if (callState.recordingStream) {
                callState.recordingStream.getTracks().forEach(function(t) { t.stop(); });
                callState.recordingStream = null;
            }
            if (callState._recordingRafId) {
                cancelAnimationFrame(callState._recordingRafId);
                callState._recordingRafId = null;
            }
            callState._recordingCanvas = null;
            if (callState._recordingAudioContext && typeof callState._recordingAudioContext.close === 'function') {
                callState._recordingAudioContext.close();
                callState._recordingAudioContext = null;
            }
            callState.recording = false;
            callState.recordingType = null;
            callState.recordedChunks = [];
            callState.mediaRecorder = null;
            recordingStoppedApi();
            updateGroupRecordingUI();
        };
        callState.mediaRecorder = recorder;
        callState.recording = true;
        recorder.start(1000);
        recordingStartedApi();
        updateGroupRecordingUI();
    }

    function startRecording1v1(type) {
        if (callState.recording || callState.groupCallId) return;
        var stream = createRecordingStream1v1(type);
        if (!stream || !stream.getTracks().length) return;
        var audioOnly = (type === 'audio');
        var mimeType = getRecordingMimeType(audioOnly);
        if (!isMediaRecorderSupported()) return;
        callState.recordingStream = stream;
        callState.recordingType = type;
        callState.recordedChunks = [];
        var recorder;
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        } catch (e) {
            recorder = new MediaRecorder(stream);
        }
        recorder.ondataavailable = function(ev) {
            if (ev.data && ev.data.size) callState.recordedChunks.push(ev.data);
        };
        recorder.onstop = function() {
            if (callState.recordedChunks.length) {
                var blob = new Blob(callState.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
                downloadRecordedBlob(blob, type);
            }
            if (callState.recordingStream) {
                callState.recordingStream.getTracks().forEach(function(t) { t.stop(); });
                callState.recordingStream = null;
            }
            if (callState._recordingRafId) {
                cancelAnimationFrame(callState._recordingRafId);
                callState._recordingRafId = null;
            }
            callState._recordingCanvas = null;
            if (callState._recordingAudioContext && typeof callState._recordingAudioContext.close === 'function') {
                callState._recordingAudioContext.close();
                callState._recordingAudioContext = null;
            }
            callState.recording = false;
            callState.recordingType = null;
            callState.recordedChunks = [];
            callState.mediaRecorder = null;
            recordingStoppedApi();
            updateRecordingUI();
        };
        callState.mediaRecorder = recorder;
        callState.recording = true;
        recorder.start(1000);
        recordingStartedApi();
        updateRecordingUI();
    }

    function updateRecordingUI() {
        var panel = document.getElementById('callPanel');
        if (!panel) return;
        var wrap = document.getElementById('callPanelRecordingWrap');
        var startWrap = document.getElementById('callPanelRecordingStartWrap');
        var stopBtn = document.getElementById('btnCallRecordingStop');
        if (!wrap) return;
        var rec = !!callState.recording;
        if (rec) {
            if (startWrap) startWrap.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-flex';
            wrap.classList.add('call-panel-recording-active');
        } else {
            if (startWrap) startWrap.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'none';
            wrap.classList.remove('call-panel-recording-active');
        }
        var btn = document.getElementById('btnCallRecord');
        if (btn) {
            btn.classList.toggle('btn-call-off', !rec);
            btn.classList.toggle('btn-call-on', rec);
            btn.title = rec ? callsL('recording_on', 'Запись вкл.') : callsL('recording_off', 'Запись выкл.');
            var lbl = btn.querySelector('.btn-call-label');
            if (lbl) lbl.textContent = rec ? callsL('recording_on', 'Запись вкл.') : callsL('recording_off', 'Запись выкл.');
        }
    }

    function updateGroupRecordingUI() {
        var panel = document.getElementById('groupCallPanel');
        if (!panel) return;
        var wrap = document.getElementById('groupCallRecordingWrap');
        var startWrap = document.getElementById('groupCallRecordingStartWrap');
        var stopBtn = document.getElementById('btnGroupCallRecordingStop');
        if (!wrap) return;
        var rec = !!callState.recording;
        if (rec) {
            if (startWrap) startWrap.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-flex';
            wrap.classList.add('call-panel-recording-active');
        } else {
            if (startWrap) startWrap.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'none';
            wrap.classList.remove('call-panel-recording-active');
        }
        var btn = document.getElementById('btnGroupCallRecord');
        if (btn) {
            btn.classList.toggle('btn-call-off', !rec);
            btn.classList.toggle('btn-call-on', rec);
            var lbl = btn.querySelector('.btn-call-label');
            if (lbl) lbl.textContent = rec ? callsL('recording_on', 'Запись вкл.') : callsL('recording_off', 'Запись выкл.');
        }
    }

    function showRecordingBanner(text) {
        var panel = document.getElementById('callPanel');
        var groupPanel = document.getElementById('groupCallPanel');
        var banner = document.getElementById('callRecordingBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'callRecordingBanner';
            banner.className = 'call-recording-banner';
            banner.setAttribute('aria-live', 'polite');
        }
        var targetInner = callState.groupCallId && groupPanel
            ? groupPanel.querySelector('.group-call-inner')
            : panel ? panel.querySelector('.call-panel-inner') : null;
        var targetBefore = targetInner ? targetInner.querySelector('.call-panel-actions-bar') : null;
        if (banner.parentNode) banner.parentNode.removeChild(banner);
        if (targetInner && targetBefore) targetInner.insertBefore(banner, targetBefore);
        banner.textContent = text || callsL('recording_banner', 'Идёт запись');
        banner.style.display = 'block';
    }

    function hideRecordingBanner() {
        var banner = document.getElementById('callRecordingBanner');
        if (banner) banner.style.display = 'none';
    }

    var incomingCallRingTimer = null;
    var incomingCallNotification = null;

    function stopIncomingCallAlerts() {
        if (incomingCallRingTimer) {
            clearInterval(incomingCallRingTimer);
            incomingCallRingTimer = null;
        }
        if (incomingCallNotification && typeof incomingCallNotification.close === 'function') {
            incomingCallNotification.close();
            incomingCallNotification = null;
        }
    }

    function playBeepWithContext(ctx) {
        if (!ctx || ctx.state === 'closed') return;
        try {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) {}
    }

    function playRingtoneBeep() {
        if (!ringtoneAudioContext || ringtoneAudioContext.state === 'closed') return;
        if (ringtoneAudioContext.state === 'suspended') {
            return;
        }
        playBeepWithContext(ringtoneAudioContext);
    }

    function showIncomingModal(data) {
        ensureCallUI();
        const modal = document.getElementById('modalIncomingCall');
        if (!modal) return;
        callState.incomingCallMinimized = null;
        stopIncomingCallAlerts();
        const nameEl = document.getElementById('incomingCallName');
        const typeEl = document.getElementById('incomingCallType');
        const avatarEl = document.getElementById('incomingCallAvatar');
        const callerName = (data.caller_name != null) ? String(data.caller_name) : callsL('incoming_call', 'Входящий звонок');
        const callType = data.with_video ? (Call.video || 'Видеозвонок') : (Call.voice || 'Голосовой звонок');
        if (nameEl) nameEl.textContent = escapeHtml(callerName);
        if (typeEl) typeEl.textContent = callType;
        if (avatarEl) {
            if (data.caller_avatar) {
                avatarEl.innerHTML = '<img src="' + escapeHtml(data.caller_avatar) + '" alt="">';
            } else {
                var letter = callerName ? String(callerName).trim().charAt(0).toUpperCase() : '?';
                if (!letter || letter === '') letter = '?';
                avatarEl.innerHTML = '<span class="incoming-call-avatar-placeholder">' + escapeHtml(letter) + '</span>';
            }
        }
        modal.classList.remove('is-hidden');
        modal.dataset.callId = (data.call_id != null) ? String(data.call_id) : '';
        modal.dataset.callerUuid = (data.caller_uuid != null) ? data.caller_uuid : '';
        modal.dataset.conversationId = (data.conversation_id != null) ? String(data.conversation_id) : '';
        modal.dataset.withVideo = data.with_video ? '1' : '0';

        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
                incomingCallNotification = new Notification(callsL('incoming_call', 'Входящий звонок'), {
                    body: callerName + ' • ' + callType,
                    icon: (document.querySelector('link[rel="icon"]') && document.querySelector('link[rel="icon"]').href) || undefined,
                    tag: 'incoming-call-' + (data.call_id || ''),
                    requireInteraction: true,
                });
                incomingCallNotification.onclick = function() { window.focus(); if (incomingCallNotification) incomingCallNotification.close(); };
            } catch (e) {}
        }
        playRingtoneBeep();
        incomingCallRingTimer = setInterval(playRingtoneBeep, 1500);
    }

    function hideIncomingModal() {
        const modal = document.getElementById('modalIncomingCall');
        if (modal) modal.classList.add('is-hidden');
        stopIncomingCallAlerts();
        callState.incomingCallMinimized = null;
    }

    function stopSpeakingMonitor() {
        if (callState._speakingRafId) {
            cancelAnimationFrame(callState._speakingRafId);
            callState._speakingRafId = null;
        }
        if (callState._speakingSource) {
            try { callState._speakingSource.disconnect(); } catch (e) {}
            callState._speakingSource = null;
        }
        callState._speakingAnalyser = null;
        if (callState._speakingContext && typeof callState._speakingContext.close === 'function') {
            callState._speakingContext.close().catch(function() {});
            callState._speakingContext = null;
        }
        if (callState._groupSpeakingRafId) {
            cancelAnimationFrame(callState._groupSpeakingRafId);
            callState._groupSpeakingRafId = null;
        }
        if (callState._groupSpeakingAnalysers) {
            callState._groupSpeakingAnalysers.forEach(function(obj) {
                try { if (obj.source) obj.source.disconnect(); } catch (e) {}
                if (obj.ctx && typeof obj.ctx.close === 'function') obj.ctx.close().catch(function() {});
            });
            callState._groupSpeakingAnalysers.clear();
            callState._groupSpeakingAnalysers = null;
        }
        var el = document.getElementById('callPanelPeerAvatar');
        if (el) el.classList.remove('call-panel-avatar-speaking');
        var panel = document.getElementById('groupCallPanel');
        if (panel) panel.querySelectorAll('.group-call-avatar-slot').forEach(function(s) { s.classList.remove('group-call-avatar-speaking'); });
    }

    function getAudioLevelFromStream(stream) {
        if (!stream || !stream.getAudioTracks().length) return 0;
        try {
            var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
            if (!Ctx) return 0;
            var ctx = new Ctx();
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function() {});
            var src = ctx.createMediaStreamSource(stream);
            var analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            src.connect(analyser);
            var data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            var sum = 0;
            for (var i = 0; i < data.length; i++) sum += data[i];
            ctx.close();
            return data.length ? sum / data.length : 0;
        } catch (e) { return 0; }
    }

    function getAudioLevelFromAnalyser(analyser) {
        if (!analyser) return 0;
        var data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        return data.length ? sum / data.length : 0;
    }

    function startSpeakingMonitor1v1() {
        if (!callState.remoteStream || callState.withVideo || callState.groupCallId) return;
        var panel = document.getElementById('callPanel');
        if (!panel || !panel.classList.contains('call-panel-visible')) return;
        try {
            var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
            if (!Ctx) return;
            if (callState._speakingContext) return;
            var ctx = new Ctx();
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function() {});
            var src = ctx.createMediaStreamSource(callState.remoteStream);
            var analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;
            src.connect(analyser);
            callState._speakingContext = ctx;
            callState._speakingSource = src;
            callState._speakingAnalyser = analyser;
            var avatarEl = document.getElementById('callPanelPeerAvatar');
            function tick() {
                if (!callState._speakingAnalyser || !avatarEl) return;
                var level = getAudioLevelFromAnalyser(callState._speakingAnalyser);
                avatarEl.classList.toggle('call-panel-avatar-speaking', level > SPEAKING_THRESHOLD);
                callState._speakingRafId = requestAnimationFrame(tick);
            }
            tick();
        } catch (e) { console.debug('startSpeakingMonitor1v1', e); }
    }

    function startSpeakingMonitorGroup() {
        if (!callState.peers || callState.withVideo) return;
        var panel = document.getElementById('groupCallPanel');
        if (!panel || !panel.classList.contains('group-call-visible')) return;
        if (callState._groupSpeakingAnalysers) return;
        callState._groupSpeakingAnalysers = new Map();
        var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
        if (!Ctx) return;
        callState.peers.forEach(function(peer, peerUuid) {
            var stream = peer.videoEl && peer.videoEl.srcObject;
            if (!stream || !stream.getAudioTracks().length) return;
            try {
                var ctx = new Ctx();
                if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function() {});
                var src = ctx.createMediaStreamSource(stream);
                var analyser = ctx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.7;
                src.connect(analyser);
                callState._groupSpeakingAnalysers.set(peerUuid, { ctx: ctx, source: src, analyser: analyser });
            } catch (err) {}
        });
        function tick() {
            if (!callState._groupSpeakingAnalysers || !callState.peers) return;
            var container = document.getElementById('groupCallAudioView');
            if (!container) return;
            var Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || null);
            callState.peers.forEach(function(peer, peerUuid) {
                var stream = peer.videoEl && peer.videoEl.srcObject;
                if (stream && stream.getAudioTracks().length && !callState._groupSpeakingAnalysers.has(peerUuid)) {
                    try {
                        if (Ctx) {
                            var ctx = new Ctx();
                            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function() {});
                            var src = ctx.createMediaStreamSource(stream);
                            var analyser = ctx.createAnalyser();
                            analyser.fftSize = 256;
                            analyser.smoothingTimeConstant = 0.7;
                            src.connect(analyser);
                            callState._groupSpeakingAnalysers.set(peerUuid, { ctx: ctx, source: src, analyser: analyser });
                        }
                    } catch (err) {}
                }
            });
            callState._groupSpeakingAnalysers.forEach(function(obj, peerUuid) {
                var level = getAudioLevelFromAnalyser(obj.analyser);
                var slot = container.querySelector('.group-call-avatar-slot[data-peer-uuid="' + peerUuid + '"]');
                if (slot) slot.classList.toggle('group-call-avatar-speaking', level > SPEAKING_THRESHOLD);
            });
            callState._groupSpeakingRafId = requestAnimationFrame(tick);
        }
        tick();
    }

    function getPeerDisplayInfo(peerUuidOrKey) {
        if (!peerUuidOrKey) return { name: '—', avatar: null };
        if (String(peerUuidOrKey).indexOf('guest_') === 0) {
            var name = (callState.guestDisplayNames && callState.guestDisplayNames[peerUuidOrKey]) || callsL('guest', 'Гость');
            return { name: name, avatar: null };
        }
        var list = (window.chatModule && typeof window.chatModule.conversations === 'function') ? window.chatModule.conversations() : [];
        var conv = list && list.find(function(c) { return c.other_user && c.other_user.uuid === peerUuidOrKey; });
        if (conv && conv.other_user) {
            var name = (conv.other_user.display_name || conv.other_user.username || '').trim() || callsL('participant', 'Участник');
            return { name: name, avatar: conv.other_user.avatar || null };
        }
        var contacts = (window.chatModule && typeof window.chatModule.contacts === 'function') ? window.chatModule.contacts() : [];
        var contact = contacts && contacts.find(function(c) { return c.uuid === peerUuidOrKey; });
        if (contact) {
            var n = (contact.display_name || contact.username || '').trim() || callsL('participant', 'Участник');
            return { name: n, avatar: contact.avatar || null };
        }
        return { name: callsL('participant', 'Участник'), avatar: null };
    }

    function getGroupCallTitle() {
        var list = (window.chatModule && typeof window.chatModule.conversations === 'function') ? window.chatModule.conversations() : [];
        var conv = list && list.find(function(c) { return c.id === callState.conversationId; });
        return (conv && (conv.name || (conv.other_user && (conv.other_user.display_name || conv.other_user.username)))) ? conv.name || (conv.other_user.display_name || conv.other_user.username) : callsL('group_call_title', 'Групповой звонок');
    }

    /** Возвращает true, если у нас есть локальный видео-трек и он включён (камера вкл). */
    function isLocalCameraOn() {
        if (!callState.localStream) return false;
        var vt = callState.localStream.getVideoTracks()[0];
        return !!(vt && vt.enabled);
    }

    /** Обновляет только видимость своего превью (PIP) в звонке 1-на-1. Не трогает блок с видео собеседника. */
    function updateLocalPipVisibility1v1() {
        var pip = document.getElementById('callPanelLocalPip');
        var localV = document.getElementById('callPanelLocalVideo');
        var track = callState.localStream && callState.localStream.getVideoTracks()[0];
        var on = !!(track && track.enabled);
        if (localV) {
            localV.srcObject = on ? callState.localStream : null;
            if (on) localV.play().catch(function() {});
        }
        if (pip) pip.style.display = on ? '' : 'none';
    }

    /** Обновляет только видимость своего превью в групповом звонке. Не трогает видео других участников. */
    function updateLocalPipVisibilityGroup() {
        var localV = document.querySelector('#groupCallPanel .group-call-local-video');
        var pipWrap = document.getElementById('groupCallLocalPipWrap');
        var track = callState.localStream && callState.localStream.getVideoTracks()[0];
        var on = !!(track && track.enabled);
        if (localV) {
            localV.srcObject = on ? callState.localStream : null;
            if (on) localV.play().catch(function() {});
        }
        if (pipWrap) pipWrap.style.display = on ? '' : 'none';
    }

    function updateCallPanelVideoUI(withVideo) {
        const panel = document.getElementById('callPanel');
        if (!panel) return;
        panel.classList.toggle('call-panel-with-video', !!withVideo);
        panel.classList.toggle('call-panel-audio', !withVideo);
        var wrap = document.getElementById('callPanelVideoWrap');
        if (wrap) wrap.style.display = withVideo ? 'block' : 'none';
        var audioView = document.getElementById('callPanelAudioView');
        var videoOff = false;
        if (withVideo && callState.remoteStream) {
            var vt = callState.remoteStream.getVideoTracks()[0];
            videoOff = !callState.remoteScreenSharing && (!vt || vt.muted);
        }
        if (audioView) {
            if (!withVideo) {
                audioView.style.display = 'flex';
            } else {
                audioView.style.display = videoOff ? 'flex' : 'none';
            }
        }
        panel.classList.toggle('call-panel-remote-video-off', !!videoOff);
        var localV = document.getElementById('callPanelLocalVideo');
        if (localV && callState.localStream) {
            if (withVideo) {
                var vt = callState.localStream.getVideoTracks()[0];
                if (vt) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
            } else {
                localV.srcObject = null;
            }
        } else if (localV && !withVideo) localV.srcObject = null;
        var pip = document.getElementById('callPanelLocalPip');
        if (pip && withVideo) pip.style.display = isLocalCameraOn() ? '' : 'none';
    }

    function setCallPanelDurationText(text) {
        var ids = ['callPanelDuration', 'callPanelDurationAfterStatus', 'callPanelDurationInVideo', 'callMinimizedDuration'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = text;
        });
    }

    function getCallDisplayName() {
        if (callState.groupCallId) return getGroupCallTitle();
        return getPeerDisplayInfo(callState.peerUuid).name;
    }

    function updateCallMinimizedBar() {
        var bar = document.getElementById('callMinimizedBar');
        if (!bar || !bar.classList.contains('call-minimized-bar-visible')) return;
        var nameEl = document.getElementById('callMinimizedName');
        if (nameEl) nameEl.textContent = getCallDisplayName();
        if (callState.durationStart) {
            var sec = Math.floor((Date.now() - callState.durationStart) / 1000);
            var m = Math.floor(sec / 60);
            var s = sec % 60;
            setCallPanelDurationText(m + ':' + (s < 10 ? '0' : '') + s);
        }
    }

    function showCallMinimizedBar() {
        var bar = document.getElementById('callMinimizedBar');
        if (!bar) return;
        var nameEl = document.getElementById('callMinimizedName');
        if (nameEl) nameEl.textContent = getCallDisplayName();
        updateCallMinimizedBar();
        bar.classList.add('call-minimized-bar-visible');
        var mc = document.querySelector('.messenger-container');
        if (mc) mc.classList.add('has-call-minimized-bar');
    }

    function hideCallMinimizedBar() {
        var bar = document.getElementById('callMinimizedBar');
        if (bar) bar.classList.remove('call-minimized-bar-visible');
        var mc = document.querySelector('.messenger-container');
        if (mc) mc.classList.remove('has-call-minimized-bar');
        callState.callMinimized = false;
    }

    function minimizeActiveCall() {
        if (!callState.callId && !callState.groupCallId) return;
        callState.callMinimized = true;
        var panel = document.getElementById('callPanel');
        var groupPanel = document.getElementById('groupCallPanel');
        if (callState.groupCallId && groupPanel) {
            groupPanel.classList.add('call-panel-minimized');
        } else if (panel) {
            panel.classList.add('call-panel-minimized');
        }
        showCallMinimizedBar();
    }

    function expandActiveCall() {
        callState.callMinimized = false;
        var panel = document.getElementById('callPanel');
        var groupPanel = document.getElementById('groupCallPanel');
        if (panel) panel.classList.remove('call-panel-minimized');
        if (groupPanel) groupPanel.classList.remove('call-panel-minimized');
        hideCallMinimizedBar();
    }

    /**
     * Запуск таймера длительности звонка 1-на-1 (вызывается когда собеседник подключился и идёт медиа).
     */
    function startCallDurationTimer() {
        if (callState.durationTimer) return;
        if (!document.getElementById('callPanelDuration')) return;
        callState.durationStart = Date.now();
        setCallPanelDurationText('0:00');
        callState.durationTimer = setInterval(function() {
            if (!callState.durationStart) return;
            const sec = Math.floor((Date.now() - callState.durationStart) / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            setCallPanelDurationText(m + ':' + (s < 10 ? '0' : '') + s);
        }, 1000);
    }

    function setCallPanelWaitingState(waiting) {
        var wrap = document.getElementById('callPanelPeerAvatarWrap');
        if (wrap) wrap.classList.toggle('call-panel-avatar-waiting', !!waiting);
        if (waiting) setCallPanelDurationText(callsL('waiting_answer', 'Ожидание ответа'));
    }

    function updateCallPanelPeerAvatar() {
        var container = document.getElementById('callPanelPeerAvatar');
        if (!container) return;
        var info = getPeerDisplayInfo(callState.peerUuid);
        var letter = (info.name && info.name.charAt(0)) ? info.name.charAt(0).toUpperCase() : '?';
        if (info.avatar) {
            container.innerHTML = '<img src="' + escapeHtml(info.avatar) + '" alt="">';
        } else {
            container.innerHTML = '<span class="call-panel-avatar-peer-placeholder">' + escapeHtml(letter) + '</span>';
        }
        var audioMuted = true;
        if (callState.peerMuted === true) audioMuted = true;
        else if (callState.peerMuted === false) audioMuted = false;
        else if (callState.remoteStream) {
            var at = callState.remoteStream.getAudioTracks();
            if (at && at.length > 0) audioMuted = !!at[0].muted;
        }
        var wrap = document.getElementById('callPanelPeerAvatarWrap');
        if (wrap) wrap.classList.toggle('call-panel-avatar-muted', !!audioMuted);
        var statusEl = document.getElementById('callPanelPeerAudioStatus');
        if (statusEl) {
            if (!callState.remoteStream) {
                statusEl.innerHTML = '';
            } else {
                var micLabel = audioMuted ? callsL('mic_off', 'Микрофон выкл.') : callsL('mic_on', 'Микрофон вкл.');
                var micClass = audioMuted ? 'peer-mic-off' : 'peer-mic-on';
                statusEl.innerHTML = '<span class="peer-mic-icon ' + micClass + '" role="img" aria-label="' + escapeHtml(micLabel) + '" title="' + escapeHtml(micLabel) + '"></span>';
            }
        }
    }

    function showCallPanel(withVideo) {
        const panel = document.getElementById('callPanel');
        if (!panel) return;
        panel.classList.toggle('call-panel-with-video', !!withVideo);
        panel.classList.toggle('call-panel-audio', !withVideo);
        var wrap = document.getElementById('callPanelVideoWrap');
        if (wrap) wrap.style.display = 'block';
        var titleEl = document.getElementById('callPanelTitle');
        var peerName = getPeerDisplayInfo(callState.peerUuid).name;
        if (titleEl) titleEl.textContent = peerName;
        var remoteNameEl = document.getElementById('callPanelRemoteName');
        if (remoteNameEl) remoteNameEl.textContent = peerName;
        var peerNameEl = document.getElementById('callPanelPeerName');
        if (peerNameEl) peerNameEl.textContent = peerName;
        setCallPanelDurationText(callState.remoteStream ? '0:00' : callsL('waiting_answer', 'Ожидание ответа'));
        setCallPanelWaitingState(!callState.remoteStream);
        if (callState.remoteStream) startCallDurationTimer();
        updateCallPanelPeerAvatar();
        var addBtn = document.getElementById('btnCallAddParticipant');
        if (addBtn) addBtn.style.display = callState.groupCallId ? 'none' : 'inline-flex';
        var leftSection = panel.querySelector('.call-panel-actions-left');
        if (leftSection) leftSection.style.display = callState.groupCallId ? 'none' : 'flex';
        panel.classList.add('call-panel-visible');
        if (withVideo) {
            updateCallPanelRemoteStatus();
            updateCallPanelVideoUI(true);
            var localV = document.getElementById('callPanelLocalVideo');
            if (localV && callState.localStream && callState.localStream.getVideoTracks().length > 0) {
                localV.muted = true;
                var stream = callState.localStream;
                localV.srcObject = stream;
                function ensureVideoPlay() {
                    if (localV.srcObject === stream) localV.play().catch(function() {});
                }
                requestAnimationFrame(function() { requestAnimationFrame(ensureVideoPlay); });
                setTimeout(ensureVideoPlay, 350);
                panel.addEventListener('transitionend', function onTransitionEnd(ev) {
                    if (ev.propertyName === 'transform') {
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        ensureVideoPlay();
                    }
                });
            }
        }
        updateVideoButtonStates();
        updateScreenShareButtonStates();
        updateRecordingUI();
    }

    function hideCallPanel() {
        const panel = document.getElementById('callPanel');
        if (panel) {
            panel.classList.remove('call-panel-visible');
            panel.classList.remove('call-panel-minimized');
        }
        hideCallMinimizedBar();
        const localV = document.getElementById('callPanelLocalVideo');
        const remoteV = document.getElementById('callPanelRemoteVideo');
        const remoteA = document.getElementById('callPanelRemoteAudio');
        if (localV && localV.srcObject) { localV.srcObject = null; }
        if (remoteV && remoteV.srcObject) { remoteV.srcObject = null; }
        if (remoteA && remoteA.srcObject) { remoteA.srcObject = null; }
    }

    function getGroupCallGrid() {
        const panel = document.getElementById('groupCallPanel');
        return panel ? panel.querySelector('.group-call-grid') : null;
    }

    function updateGroupCallAudioAvatars() {
        var container = document.getElementById('groupCallAudioView');
        if (!container) return;
        if (!callState.peerMutedMap) callState.peerMutedMap = new Map();
        container.innerHTML = '';
        var peerKeys = (callState.participantUuids || []).filter(function(u) { return u !== userUuid; }).concat(
            (callState.participantGuestIds || []).map(function(id) { return 'guest_' + id; })
        );
        peerKeys.forEach(function(peerKey) {
            var info = getPeerDisplayInfo(peerKey);
            var letter = (info.name && info.name.charAt(0)) ? info.name.charAt(0).toUpperCase() : '?';
            var slot = document.createElement('div');
            slot.className = 'group-call-avatar-slot';
            slot.dataset.peerUuid = peerKey;
            var audioMuted = true;
            if (callState.peerMutedMap && callState.peerMutedMap.has(peerKey)) {
                audioMuted = callState.peerMutedMap.get(peerKey) === true;
            } else {
                var peer = callState.peers && callState.peers.get(peerKey);
                if (peer && peer.videoEl && peer.videoEl.srcObject) {
                    var at = peer.videoEl.srcObject.getAudioTracks();
                    if (at && at.length > 0) audioMuted = !!at[0].muted;
                }
            }
            if (audioMuted) slot.classList.add('group-call-avatar-muted');
            var avatarHtml = info.avatar
                ? '<div class="group-call-avatar-peer"><img src="' + escapeHtml(info.avatar) + '" alt=""></div>'
                : '<div class="group-call-avatar-peer"><span class="group-call-avatar-placeholder">' + escapeHtml(letter) + '</span></div>';
            var mutedSvg = '<span class="group-call-avatar-muted-indicator" aria-hidden="true">' + MUTED_ICON_SVG + '</span>';
            var audioStatus = audioMuted ? callsL('audio_off', 'Аудио выкл') : callsL('audio_on', 'Аудио вкл');
            slot.innerHTML = avatarHtml + mutedSvg + '<span class="group-call-avatar-slot-name">' + escapeHtml(info.name) + '</span><span class="group-call-avatar-slot-audio-status">' + escapeHtml(audioStatus) + '</span>';
            container.appendChild(slot);
        });
    }

    function showGroupCallPanel(withVideo) {
        const panel = document.getElementById('groupCallPanel');
        if (!panel) return;
        panel.classList.toggle('group-call-with-video', !!withVideo);
        panel.classList.toggle('group-call-audio', !withVideo);
        var videoWrap = panel.querySelector('.group-call-video-wrap');
        if (videoWrap) videoWrap.style.display = withVideo ? 'block' : 'none';
        var audioView = document.getElementById('groupCallAudioView');
        if (audioView) audioView.style.display = withVideo ? 'none' : 'flex';
        var titleEl = document.getElementById('groupCallTitle');
        if (titleEl) titleEl.textContent = getGroupCallTitle();
        panel.querySelector('.group-call-duration').textContent = '0:00';
        callState.durationStart = Date.now();
        if (callState.durationTimer) clearInterval(callState.durationTimer);
        callState.durationTimer = setInterval(function() {
            if (!callState.durationStart) return;
            const sec = Math.floor((Date.now() - callState.durationStart) / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            const text = m + ':' + (s < 10 ? '0' : '') + s;
            const el = panel.querySelector('.group-call-duration');
            if (el) el.textContent = text;
            var minEl = document.getElementById('callMinimizedDuration');
            if (minEl && callState.callMinimized) minEl.textContent = text;
        }, 1000);
        updateGroupCallAudioAvatars();
        panel.classList.add('group-call-visible');
        if (withVideo) {
            var localV = panel.querySelector('.group-call-local-video');
            if (localV && callState.localStream && callState.localStream.getVideoTracks().length > 0) {
                localV.muted = true;
                var stream = callState.localStream;
                localV.srcObject = stream;
                function ensureVideoPlay() {
                    if (localV.srcObject === stream) localV.play().catch(function() {});
                }
                requestAnimationFrame(function() { requestAnimationFrame(ensureVideoPlay); });
                setTimeout(ensureVideoPlay, 350);
                panel.addEventListener('transitionend', function onTransitionEnd(ev) {
                    if (ev.propertyName === 'transform') {
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        ensureVideoPlay();
                    }
                });
            }
        }
        updateVideoButtonStates();
        updateScreenShareButtonStates();
        updateGroupRecordingUI();
        if (!withVideo) startSpeakingMonitorGroup();
    }

    function hideGroupCallPanel() {
        const panel = document.getElementById('groupCallPanel');
        if (!panel) return;
        panel.classList.remove('group-call-visible');
        panel.classList.remove('call-panel-minimized');
        hideCallMinimizedBar();
        const grid = panel.querySelector('.group-call-grid');
        if (grid) {
            grid.querySelectorAll('.group-call-remote-slot').forEach(function(w) {
                var v = w.querySelector('video');
                if (v && v.srcObject) v.srcObject = null;
                w.remove();
            });
        }
        const localV = panel.querySelector('.group-call-local-video');
        if (localV && localV.srcObject) localV.srcObject = null;
    }

    function addGroupCallRemoteSlot(peerKey) {
        const grid = getGroupCallGrid();
        if (!grid) return null;
        const wrap = document.createElement('div');
        wrap.className = 'group-call-remote-slot';
        wrap.dataset.peerUuid = peerKey;
        if (callState.peerScreenSharing && callState.peerScreenSharing.get(peerKey)) wrap.classList.add('group-call-remote-slot-screen-share');
        const video = document.createElement('video');
        video.className = 'group-call-remote-video';
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        const nameLabel = document.createElement('span');
        nameLabel.className = 'group-call-remote-slot-name';
        nameLabel.textContent = getPeerDisplayInfo(peerKey).name || (String(peerKey).indexOf('guest_') === 0 ? callsL('guest', 'Гость') : callsL('participant', 'Участник'));
        const statusLabel = document.createElement('span');
        statusLabel.className = 'group-call-remote-slot-status';
        wrap.appendChild(video);
        wrap.appendChild(nameLabel);
        wrap.appendChild(statusLabel);
        grid.appendChild(wrap);
        return video;
    }

    function updateGroupCallSlotStatus(peerKey) {
        const wrap = document.querySelector('.group-call-remote-slot[data-peer-uuid="' + peerKey + '"]');
        if (!wrap) return;
        const statusEl = wrap.querySelector('.group-call-remote-slot-status');
        if (!statusEl) return;
        let audioText = callsL('audio_off', 'Аудио выкл');
        const signalingMuted = callState.peerMutedMap && callState.peerMutedMap.has(peerKey) ? callState.peerMutedMap.get(peerKey) : null;
        if (signalingMuted === true) audioText = callsL('audio_off', 'Аудио выкл');
        else if (signalingMuted === false) audioText = callsL('audio_on', 'Аудио вкл');
        else {
            const videoEl = wrap.querySelector('video');
            if (videoEl && videoEl.srcObject) {
                const at = videoEl.srcObject.getAudioTracks();
                if (at && at.length > 0 && !at[0].muted) audioText = callsL('audio_on', 'Аудио вкл');
            }
        }
        statusEl.textContent = audioText;
    }

    function removeGroupCallRemoteSlot(peerKey) {
        const grid = getGroupCallGrid();
        if (!grid) return;
        const slots = grid.querySelectorAll('.group-call-remote-slot');
        slots.forEach(function(wrap) {
            if (wrap.dataset.peerUuid === peerKey) wrap.remove();
        });
    }

    function makePiPDraggable(pipEl, containerSelector) {
        if (!pipEl) return;
        var container = containerSelector ? document.querySelector(containerSelector) : pipEl.parentElement;
        var dragging = false;
        var startX, startY, startLeft, startTop;

        function getBounds() {
            if (!container) return { w: window.innerWidth, h: window.innerHeight, left: 0, top: 0 };
            var r = container.getBoundingClientRect();
            return { w: r.width, h: r.height, left: r.left, top: r.top };
        }

        function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

        function onPointerDown(e) {
            e.preventDefault();
            dragging = true;
            var r = pipEl.getBoundingClientRect();
            var b = getBounds();
            startLeft = r.left - b.left;
            startTop = r.top - b.top;
            startX = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
            startY = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
        }
        function onPointerMove(e) {
            if (!dragging) return;
            var x = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
            var y = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
            var dx = x - startX;
            var dy = y - startY;
            var b = getBounds();
            var pw = pipEl.offsetWidth;
            var ph = pipEl.offsetHeight;
            var left = clamp(startLeft + dx, 0, b.w - pw);
            var top = clamp(startTop + dy, 0, b.h - ph);
            pipEl.style.right = 'auto';
            pipEl.style.bottom = 'auto';
            pipEl.style.left = left + 'px';
            pipEl.style.top = top + 'px';
        }
        function onPointerUp() {
            dragging = false;
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchmove', onPointerMove, { passive: false });
            document.removeEventListener('touchend', onPointerUp);
        }
        pipEl.addEventListener('mousedown', function(e) { onPointerDown(e); document.addEventListener('mousemove', onPointerMove); document.addEventListener('mouseup', onPointerUp); });
        pipEl.addEventListener('touchstart', function(e) { onPointerDown(e); document.addEventListener('touchmove', onPointerMove, { passive: false }); document.addEventListener('touchend', onPointerUp); }, { passive: false });
    }

    function initCallPanelPiPDrag() {
        var pip = document.getElementById('callPanelLocalPip');
        makePiPDraggable(pip, '.call-panel-content');
    }

    function initGroupCallPiPDrag() {
        var pip = document.getElementById('groupCallLocalPipWrap');
        makePiPDraggable(pip, '.group-call-content');
    }

    function ensureCallUI() {
        if (document.getElementById('modalIncomingCall')) return;
        const body = document.body;
        const incoming = document.createElement('div');
        incoming.id = 'modalIncomingCall';
        incoming.className = 'modal modal-incoming-call modal-incoming-call-fullscreen is-hidden';
        incoming.setAttribute('role', 'dialog');
        incoming.setAttribute('aria-modal', 'true');
        incoming.innerHTML = '<div class="modal-content modal-incoming-call-content"><div class="modal-header"><h3>' + callsL('incoming_title', 'Входящий вызов') + '</h3></div><div class="modal-body"><div class="incoming-call-avatar-wrap" id="incomingCallAvatarWrap"><div class="incoming-call-avatar" id="incomingCallAvatar"><span class="incoming-call-avatar-placeholder" id="incomingCallAvatarPlaceholder">?</span></div></div><p class="incoming-call-name" id="incomingCallName">—</p><p class="incoming-call-type" id="incomingCallType">' + (Call.voice || 'Голосовой звонок') + '</p><div class="modal-actions incoming-call-actions"><button type="button" class="btn btn-secondary btn-call-minimize" id="btnIncomingMinimize" aria-label="' + callsL('minimize', 'Свернуть') + '">' + callsL('minimize', 'Свернуть') + '</button><button type="button" class="btn btn-danger btn-call-decline" id="btnIncomingDecline" aria-label="' + callsL('decline', 'Отклонить') + '">' + callsL('decline', 'Отклонить') + '</button><button type="button" class="btn btn-primary btn-call-accept" id="btnIncomingAccept" aria-label="' + callsL('accept', 'Принять') + '">' + callsL('accept', 'Принять') + '</button></div></div></div>';
        body.appendChild(incoming);

        const panel = document.createElement('div');
        panel.id = 'callPanel';
        panel.className = 'call-panel';
        panel.innerHTML = '<button type="button" class="call-panel-minimize-corner" id="btnCallMinimize" title="' + callsL('minimize', 'Свернуть') + '" aria-label="' + callsL('minimize', 'Свернуть') + '">−</button>' +
            '<div class="call-panel-inner">' +
            '<div class="call-panel-header"><span class="call-panel-title" id="callPanelTitle">—</span><span class="call-panel-duration" id="callPanelDuration">0:00</span></div>' +
            '<div class="call-panel-content">' +
            '<div class="call-panel-video-wrap" id="callPanelVideoWrap"><div class="call-panel-audio-view" id="callPanelAudioView"><audio id="callPanelRemoteAudio" autoplay playsinline class="call-panel-audio-visually-hidden"></audio><div class="call-panel-avatar-peer-wrap" id="callPanelPeerAvatarWrap"><div class="call-panel-avatar-peer" id="callPanelPeerAvatar"><span class="call-panel-avatar-peer-placeholder" id="callPanelPeerAvatarPlaceholder">?</span></div></div><div class="call-panel-peer-status-name"><span class="call-panel-peer-status" id="callPanelPeerAudioStatus"></span><span class="call-panel-peer-name" id="callPanelPeerName"></span></div><span class="call-panel-duration-after-status" id="callPanelDurationAfterStatus">0:00</span></div><video id="callPanelRemoteVideo" playsinline autoplay></video><div class="call-panel-remote-name-wrap"><span class="call-panel-remote-status-name"><span class="call-panel-remote-status" id="callPanelRemoteStatus"></span><span class="call-panel-remote-name" id="callPanelRemoteName"></span></span><span class="call-panel-remote-duration" id="callPanelDurationInVideo">0:00</span></div><div class="call-panel-local-pip" id="callPanelLocalPip"><video id="callPanelLocalVideo" playsinline muted></video><button type="button" class="btn-call-switch-camera-on-pip" id="btnCallSwitchCamera" title="' + callsL('switch_camera', 'Переключить камеру') + '" aria-label="' + callsL('switch_camera', 'Переключить камеру') + '" class="is-hidden">🔄</button></div></div>' +
            '</div>' +
            '<div class="call-panel-actions-bar">' +
            '<div class="call-panel-actions-left"><div class="call-panel-actions-group call-panel-actions-participants"><button type="button" class="btn-call-toggle" id="btnCallAddParticipant" title="' + callsL('invite', 'Пригласить') + '" aria-label="' + callsL('invite', 'Пригласить') + '" class="is-hidden">👤+<span class="btn-call-label">' + callsL('invite', 'Пригласить') + '</span></button></div></div>' +
            '<div class="call-panel-actions-center">' +
            '<div class="call-panel-actions-group call-panel-actions-media"><button type="button" class="btn-call-toggle btn-call-audio" id="btnCallMute" title="' + callsL('mic_off', 'Микрофон выкл.') + '" aria-label="' + callsL('microphone', 'Микрофон') + '">🎤<span class="btn-call-label">' + callsL('mic_off_label', 'Микрофон выкл.') + '</span></button><button type="button" class="btn-call-toggle btn-call-video" id="btnCallVideo" title="' + callsL('camera_off', 'Камера выкл.') + '" aria-label="' + callsL('camera', 'Камера') + '">📹<span class="btn-call-label">' + callsLabelBr(callsL('camera_off_label', 'Камера\nвыкл.')) + '</span></button><button type="button" class="btn-call-toggle btn-call-screenshare" id="btnCallShareScreen" title="' + callsL('screen_not_sharing', 'Не делимся экраном') + '" aria-label="' + callsL('screen', 'Экран') + '" class="is-hidden">🖥️<span class="btn-call-label">' + callsLabelBr(callsL('screen_not_sharing_label', 'Не делимся\nэкраном')) + '</span></button></div>' +
            '<div class="call-panel-actions-group call-panel-actions-recording"><div class="call-panel-recording-wrap" id="callPanelRecordingWrap" title="' + callsL('recording_saving_hint', 'Запись сохраняется на ваше устройство после нажатия «Остановить запись»') + '"><div class="call-panel-recording-start-wrap" id="callPanelRecordingStartWrap"><button type="button" class="btn-call-toggle btn-call-record call-recording-desktop" id="btnCallRecord" title="' + callsL('recording_off', 'Запись выкл.') + '" aria-label="' + callsL('recording', 'Запись') + '">⏺<span class="btn-call-label">' + callsL('recording_off', 'Запись выкл.') + '</span></button><div class="call-recording-mobile-wrap"><button type="button" class="btn-call-toggle btn-call-record" id="btnCallRecordMobile" aria-label="' + callsL('recording', 'Запись') + '">⏺</button><div class="call-recording-mobile-dropdown" id="callRecordingMobileDropdown"><button type="button" class="call-recording-option" data-type="audio">' + callsL('recording_only_audio', 'Только аудио') + '</button><button type="button" class="call-recording-option" data-type="video">' + callsL('recording_audio_video', 'Аудио + Видео') + '</button></div></div></div><button type="button" class="btn-call-toggle btn-call-recording-stop" id="btnCallRecordingStop" title="' + callsL('stop_recording', 'Остановить запись') + '" aria-label="' + callsL('stop_recording', 'Остановить запись') + '" class="is-hidden">' + callsL('stop_recording_btn', '● Остановить') + '</button></div></div>' +
            '</div>' +
            '<div class="call-panel-actions-right"><div class="call-panel-actions-group call-panel-actions-end"><button type="button" class="btn-call-hangup" id="btnCallHangup" title="' + callsL('end_call', 'Закончить звонок') + '" aria-label="' + callsL('end_call', 'Закончить звонок') + '">📞<span class="btn-call-label">' + callsL('end_call', 'Закончить звонок') + '</span></button></div></div>' +
            '</div></div>';
        body.appendChild(panel);
        initCallPanelPiPDrag();

        var groupPanel = document.createElement('div');
        groupPanel.id = 'groupCallPanel';
        groupPanel.className = 'group-call-panel';
        groupPanel.innerHTML = '<button type="button" class="call-panel-minimize-corner" id="btnGroupCallMinimize" title="' + callsL('minimize', 'Свернуть') + '" aria-label="' + callsL('minimize', 'Свернуть') + '">−</button>' +
            '<div class="group-call-inner">' +
            '<div class="group-call-header"><span class="group-call-title" id="groupCallTitle">' + callsL('group_call_title', 'Групповой звонок') + '</span><span class="group-call-duration" id="groupCallDuration">0:00</span></div>' +
            '<div class="group-call-content">' +
            '<div class="group-call-audio-view" id="groupCallAudioView"></div>' +
            '<div class="group-call-video-wrap"><div class="group-call-video-area"><div class="group-call-grid"></div></div><div class="group-call-local-pip-wrap" id="groupCallLocalPipWrap"><video class="group-call-local-video" playsinline muted></video><button type="button" class="btn-call-switch-camera-on-pip" id="btnGroupCallSwitchCamera" title="' + callsL('switch_camera', 'Переключить камеру') + '" aria-label="' + callsL('switch_camera', 'Переключить камеру') + '" class="is-hidden">🔄</button></div></div>' +
            '</div>' +
            '<div class="call-panel-actions-bar">' +
            '<div class="call-panel-actions-left"><div class="call-panel-actions-group call-panel-actions-participants"><button type="button" class="btn-call-toggle" id="btnGroupCallParticipants" title="' + callsL('invite', 'Пригласить') + '" aria-label="' + callsL('invite', 'Пригласить') + '">👥<span class="btn-call-label">' + callsL('invite', 'Пригласить') + '</span></button></div></div>' +
            '<div class="call-panel-actions-center">' +
            '<div class="call-panel-actions-group call-panel-actions-media"><button type="button" class="btn-call-toggle btn-call-audio" id="btnGroupCallMute" title="' + callsL('mic_off', 'Микрофон выкл.') + '" aria-label="' + callsL('microphone', 'Микрофон') + '">🎤<span class="btn-call-label">' + callsL('mic_off_label', 'Микрофон выкл.') + '</span></button><button type="button" class="btn-call-toggle btn-call-video" id="btnGroupCallVideo" title="' + callsL('camera_off', 'Камера выкл.') + '" aria-label="' + callsL('camera', 'Камера') + '">📹<span class="btn-call-label">' + callsLabelBr(callsL('camera_off_label', 'Камера\nвыкл.')) + '</span></button><button type="button" class="btn-call-toggle btn-call-screenshare" id="btnGroupCallShareScreen" title="' + callsL('screen_not_sharing', 'Не делимся экраном') + '" aria-label="' + callsL('screen', 'Экран') + '" class="is-hidden">🖥️<span class="btn-call-label">' + callsLabelBr(callsL('screen_not_sharing_label', 'Не делимся\nэкраном')) + '</span></button></div>' +
            '<div class="call-panel-actions-group call-panel-actions-recording"><div class="call-panel-recording-wrap" id="groupCallRecordingWrap" title="' + callsL('recording_saving_hint_group', 'Запись сохраняется на устройство') + '"><div class="call-panel-recording-start-wrap" id="groupCallRecordingStartWrap"><button type="button" class="btn-call-toggle btn-call-record call-recording-desktop" id="btnGroupCallRecord" aria-label="' + callsL('recording', 'Запись') + '">⏺<span class="btn-call-label">' + callsL('recording_off', 'Запись выкл.') + '</span></button><div class="call-recording-mobile-wrap"><button type="button" class="btn-call-toggle btn-call-record" id="btnGroupCallRecordMobile" aria-label="' + callsL('recording', 'Запись') + '">⏺</button><div class="call-recording-mobile-dropdown" id="groupRecordingMobileDropdown"><button type="button" class="call-recording-option" data-type="audio">' + callsL('recording_only_audio', 'Только аудио') + '</button><button type="button" class="call-recording-option" data-type="video">' + callsL('recording_audio_video', 'Аудио + Видео') + '</button></div></div></div><button type="button" class="btn-call-toggle btn-call-recording-stop" id="btnGroupCallRecordingStop" aria-label="' + callsL('stop_recording', 'Остановить запись') + '" class="is-hidden">' + callsL('stop_recording_btn', '● Остановить') + '</button></div></div>' +
            '</div>' +
            '<div class="call-panel-actions-right"><div class="call-panel-actions-group call-panel-actions-end"><button type="button" class="btn-call-hangup" id="btnGroupCallHangup" title="' + callsL('end_call', 'Закончить звонок') + '" aria-label="' + callsL('end_call', 'Закончить звонок') + '">📞<span class="btn-call-label">' + callsL('end_call', 'Закончить звонок') + '</span></button></div></div>' +
            '</div></div>';
        body.appendChild(groupPanel);
        initGroupCallPiPDrag();

        var minimizedBar = document.createElement('div');
        minimizedBar.id = 'callMinimizedBar';
        minimizedBar.className = 'call-minimized-bar';
        var messengerContainer = document.querySelector('.messenger-container');
        if (messengerContainer) {
            var contentRow = document.querySelector('.messenger-content-row');
            if (!contentRow) {
                contentRow = document.createElement('div');
                contentRow.className = 'messenger-content-row';
                while (messengerContainer.firstChild) {
                    contentRow.appendChild(messengerContainer.firstChild);
                }
                messengerContainer.appendChild(contentRow);
            }
            messengerContainer.insertBefore(minimizedBar, messengerContainer.firstChild);
        } else {
            body.insertBefore(minimizedBar, body.firstChild);
        }
        minimizedBar.setAttribute('role', 'button');
        minimizedBar.setAttribute('tabindex', '0');
        minimizedBar.setAttribute('aria-label', callsL('expand_call', 'Развернуть звонок'));
        minimizedBar.innerHTML = '<span class="call-minimized-bar-name" id="callMinimizedName">—</span><span class="call-minimized-bar-duration" id="callMinimizedDuration">0:00</span><button type="button" class="call-minimized-bar-hangup" id="callMinimizedBarHangup" title="' + callsL('end_call', 'Закончить звонок') + '" aria-label="' + callsL('end_call', 'Закончить звонок') + '">📞</button>';
        minimizedBar.addEventListener('click', function(e) {
            if (callState.callMinimized && !e.target.closest('.call-minimized-bar-hangup')) expandActiveCall();
        });
        minimizedBar.addEventListener('keydown', function(e) {
            if ((e.key === 'Enter' || e.key === ' ') && callState.callMinimized && !e.target.closest('.call-minimized-bar-hangup')) {
                e.preventDefault();
                expandActiveCall();
            }
        });
        document.getElementById('callMinimizedBarHangup').addEventListener('click', function(e) {
            e.stopPropagation();
            if (callState.groupCallId) {
                openEndCallChoiceModal();
            } else {
                if (callState.callId) endCallApi(callState.callId);
                cleanupCall();
            }
        });
        document.getElementById('btnCallMinimize').addEventListener('click', function() { minimizeActiveCall(); });
        document.getElementById('btnGroupCallMinimize').addEventListener('click', function() { minimizeActiveCall(); });

        var endCallChoiceModal = document.createElement('div');
        endCallChoiceModal.id = 'modalEndCallChoice';
        endCallChoiceModal.className = 'modal modal-end-call-choice is-hidden';
        endCallChoiceModal.setAttribute('role', 'dialog');
        endCallChoiceModal.setAttribute('aria-modal', 'true');
        endCallChoiceModal.setAttribute('aria-labelledby', 'modalEndCallChoiceTitle');
        endCallChoiceModal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 id="modalEndCallChoiceTitle">' + callsL('end_call_modal_title', 'Завершить звонок') + '</h3><button type="button" class="modal-close" id="modalEndCallChoiceClose" aria-label="' + callsL('close', 'Закрыть') + '">&times;</button></div><div class="modal-body"><p class="modal-hint">' + callsL('end_call_modal_hint', 'Выйти только из звонка или завершить звонок для всех участников?') + '</p><div class="modal-actions modal-actions-end-call"><button type="button" class="btn btn-secondary" id="modalEndCallChoiceLeave">' + callsL('leave_call', 'Выйти из звонка') + '</button><button type="button" class="btn btn-danger btn-call-end-all" id="modalEndCallChoiceEndAll">' + callsL('end_for_all', 'Завершить для всех') + '</button></div></div></div>';
        body.appendChild(endCallChoiceModal);

        function openEndCallChoiceModal() {
            if (!callState.groupCallId) return;
            endCallChoiceModal.classList.remove('is-hidden');
        }
        function closeEndCallChoiceModal() {
            endCallChoiceModal.classList.add('is-hidden');
        }

        document.getElementById('btnGroupCallHangup').addEventListener('click', function() {
            if (callState.groupCallId) openEndCallChoiceModal();
            else cleanupCall();
        });
        document.getElementById('modalEndCallChoiceClose').addEventListener('click', closeEndCallChoiceModal);
        endCallChoiceModal.addEventListener('click', function(e) {
            if (e.target === endCallChoiceModal) closeEndCallChoiceModal();
        });
        document.getElementById('modalEndCallChoiceLeave').addEventListener('click', function() {
            closeEndCallChoiceModal();
            if (callState.groupCallId) leaveGroupCall();
        });
        document.getElementById('modalEndCallChoiceEndAll').addEventListener('click', function() {
            closeEndCallChoiceModal();
            if (callState.groupCallId) endGroupCallForAll();
        });
        document.getElementById('btnGroupCallMute').addEventListener('click', function() {
            if (callState.localStream) {
                var audio = callState.localStream.getAudioTracks()[0];
                if (audio) {
                    audio.enabled = !audio.enabled;
                    this.classList.toggle('btn-call-muted', !audio.enabled);
                    this.classList.toggle('btn-call-unmuted', audio.enabled);
                    this.title = audio.enabled ? callsL('mic_on', 'Микрофон вкл.') : callsL('mic_off', 'Микрофон выкл.');
                    var lbl = this.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = audio.enabled ? callsL('mic_on_label', 'Микрофон вкл.') : callsL('mic_off_label', 'Микрофон выкл.');
                    sendMuteStateApi(!audio.enabled);
                }
            }
        });
        document.getElementById('btnGroupCallVideo').addEventListener('click', function() {
            toggleLocalCameraGroup();
        });
        var btnGroupShareScreen = document.getElementById('btnGroupCallShareScreen');
        if (btnGroupShareScreen) {
            btnGroupShareScreen.style.display = isDisplayMediaSupported() ? 'inline-flex' : 'none';
            btnGroupShareScreen.addEventListener('click', function() {
                if (callState.isSharingScreen) stopScreenShareGroup(); else startScreenShareGroup();
            });
        }
        var btnGroupSwitchCamera = document.getElementById('btnGroupCallSwitchCamera');
        if (btnGroupSwitchCamera) {
            ['mousedown', 'touchstart'].forEach(function(ev) {
                btnGroupSwitchCamera.addEventListener(ev, function(e) { e.stopPropagation(); }, { passive: true });
            });
            btnGroupSwitchCamera.addEventListener('click', function() {
                if (!callState.localStream || callState.isSharingScreen || !callState.withVideo || !callState.peers) return;
                var vt = callState.localStream.getVideoTracks()[0];
                if (!vt) return;
                var prevFacing = callState.facingMode;
                callState.facingMode = callState.facingMode === 'user' ? 'environment' : 'user';
                var constraints = { video: { facingMode: callState.facingMode } };
                navigator.mediaDevices.getUserMedia({ video: constraints.video }).then(function(vStream) {
                    var newTrack = vStream.getVideoTracks()[0];
                    if (!newTrack) {
                        callState.facingMode = prevFacing;
                        return;
                    }
                    vt.stop();
                    callState.localStream.removeTrack(vt);
                    callState.localStream.addTrack(newTrack);
                    var localV = document.querySelector('#groupCallPanel .group-call-local-video');
                    if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
                    var renegotiatePromises = [];
                    callState.peers.forEach(function(peer, peerKey) {
                        if (!peer.pc) return;
                        var videoTransceiver = peer.pc.getTransceivers && peer.pc.getTransceivers().find(function(t) {
                            return t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
                        });
                        if (videoTransceiver && videoTransceiver.sender) {
                            renegotiatePromises.push(
                                videoTransceiver.sender.replaceTrack(newTrack).then(function() {
                                    return peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); });
                                }).then(function() {
                                    return sendSignaling(callState.conversationId, peerKey, { sdp: peer.pc.localDescription });
                                })
                            );
                        }
                    });
                    Promise.all(renegotiatePromises).catch(function() {});
                }).catch(function(err) {
                    callState.facingMode = prevFacing;
                    console.error('Switch camera failed:', err);
                    if (typeof window.showToast === 'function') {
                        window.showToast(callsL('switch_camera_error', 'Не удалось переключить камеру'));
                    }
                });
            });
        }
        var groupRecWrap = document.getElementById('groupCallRecordingWrap');
        if (groupRecWrap) groupRecWrap.style.display = isMediaRecorderSupported() ? 'flex' : 'none';
        document.getElementById('btnGroupCallRecord').addEventListener('click', function() {
            if (!callState.recording && callState.groupCallId) startRecordingGroup(callState.withVideo ? 'video' : 'audio');
        });
        var btnGroupRecordMobile = document.getElementById('btnGroupCallRecordMobile');
        var groupRecordingMobileDropdown = document.getElementById('groupRecordingMobileDropdown');
        if (btnGroupRecordMobile && groupRecordingMobileDropdown) {
            btnGroupRecordMobile.addEventListener('click', function(e) {
                if (callState.recording || !callState.groupCallId) return;
                if (!callState.withVideo) {
                    startRecordingGroup('audio');
                    return;
                }
                e.stopPropagation();
                groupRecordingMobileDropdown.classList.toggle('call-recording-dropdown-open');
            });
            groupRecordingMobileDropdown.querySelectorAll('.call-recording-option').forEach(function(opt) {
                opt.addEventListener('click', function() {
                    var type = this.getAttribute('data-type') || 'audio';
                    startRecordingGroup(type);
                    groupRecordingMobileDropdown.classList.remove('call-recording-dropdown-open');
                });
            });
            (function() {
                var mobileWrap = btnGroupRecordMobile.closest('.call-recording-mobile-wrap');
                document.addEventListener('click', function(e) {
                    if (mobileWrap && !mobileWrap.contains(e.target)) {
                        groupRecordingMobileDropdown.classList.remove('call-recording-dropdown-open');
                    }
                });
            })();
        }
        document.getElementById('btnGroupCallRecordingStop').addEventListener('click', function() {
            stopRecordingIfActive(true);
        });

        var addParticipantModal = document.createElement('div');
        addParticipantModal.id = 'modalAddParticipant';
        addParticipantModal.className = 'modal modal-add-participant';
        addParticipantModal.classList.add('is-hidden');
        addParticipantModal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3>' + callsL('add_participant_title', 'Пригласить') + '</h3><button type="button" class="modal-close" id="modalAddParticipantClose" aria-label="' + callsL('close', 'Закрыть') + '">&times;</button></div><div class="modal-body">' +
            '<div class="add-participant-tabs" role="tablist">' +
            '<button type="button" class="add-participant-tab active" role="tab" id="addParticipantTabContacts" data-tab="contacts" aria-selected="true">' + callsL('contacts_tab', 'Контакты') + '</button>' +
            '<button type="button" class="add-participant-tab" role="tab" id="addParticipantTabGuests" data-tab="guests" aria-selected="false">' + callsL('guests_tab', 'Гости') + '</button>' +
            '</div>' +
            '<div class="add-participant-panel add-participant-panel-contacts" id="addParticipantPanelContacts" role="tabpanel">' +
            '<div class="add-participant-list-section"><h4 class="add-participant-list-title" id="addParticipantListTitle">' + callsL('add_to_call', 'Добавить в звонок') + '</h4><ul id="modalAddParticipantList"></ul></div></div>' +
            '<div class="add-participant-panel add-participant-panel-guests" id="addParticipantPanelGuests" role="tabpanel" hidden>' +
            '<div class="add-participant-share-block"><p class="share-link-hint">' + callsL('share_link_hint', 'Ссылка на звонок. По ссылке можно войти в аккаунт или присоединиться как гость.') + '</p><div class="form-group share-link-expiry-wrap"><label for="addParticipantShareExpiry">' + callsL('expiry_label', 'Срок действия') + '</label><select id="addParticipantShareExpiry" class="form-control"><option value="3600">' + callsL('expiry_1h', '1 час') + '</option><option value="86400" selected>' + callsL('expiry_24h', '24 часа') + '</option><option value="604800">' + callsL('expiry_7d', '7 дней') + '</option></select></div><div class="share-link-field-wrap"><input type="text" id="addParticipantShareUrl" class="form-control" readonly placeholder="' + callsL('get_link_placeholder', 'Нажмите «Получить ссылку»') + '"></div><div class="modal-actions share-link-actions"><button type="button" class="btn btn-primary" id="addParticipantShareGet">' + callsL('get_link_btn', 'Получить ссылку') + '</button><button type="button" class="btn btn-secondary" id="addParticipantShareCopy" class="is-hidden">' + callsL('copy_btn', 'Копировать') + '</button><button type="button" class="btn btn-secondary" id="addParticipantShareRevoke" class="is-hidden">' + callsL('revoke_btn', 'Отозвать') + '</button></div></div></div>' +
            '</div></div></div></div>';
        body.appendChild(addParticipantModal);

        (function initAddParticipantTabs() {
            var tabs = addParticipantModal.querySelectorAll('.add-participant-tab');
            var panels = {
                contacts: document.getElementById('addParticipantPanelContacts'),
                guests: document.getElementById('addParticipantPanelGuests')
            };
            tabs.forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var tabName = this.dataset.tab;
                    tabs.forEach(function(t) {
                        t.classList.toggle('active', t === tab);
                        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
                    });
                    if (panels.contacts) {
                        panels.contacts.hidden = tabName !== 'contacts';
                    }
                    if (panels.guests) {
                        panels.guests.hidden = tabName !== 'guests';
                    }
                });
            });
        })();

        function loadInviteModalShareLink() {
            var groupCallId = callState.groupCallId;
            var callId = callState.callId;
            if (!groupCallId && !callId) return Promise.resolve();
            var body = groupCallId ? { group_call_id: groupCallId } : { call_id: callId };
            var expiryEl = document.getElementById('addParticipantShareExpiry');
            var expiresInSec = expiryEl ? parseInt(expiryEl.value, 10) : 86400;
            if (expiresInSec > 0) body.expires_in_sec = expiresInSec;
            return apiRequest(API_BASE + '/api/calls.php?action=call_link_create', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
                .then(function(res) {
                    if (!res || !res.success || !res.data) throw new Error(res && res.error ? res.error : callsL('create_link_error', 'Не удалось создать ссылку'));
                    var url = res.data.join_url;
                    var token = res.data.link_token;
                    var urlEl = document.getElementById('addParticipantShareUrl');
                    var copyBtn = document.getElementById('addParticipantShareCopy');
                    var revokeBtn = document.getElementById('addParticipantShareRevoke');
                    if (urlEl) urlEl.value = url;
                    addParticipantModal.dataset.linkToken = token || '';
                    if (copyBtn) copyBtn.style.display = 'inline-block';
                    if (revokeBtn) revokeBtn.style.display = 'inline-block';
                });
        }

        function openInviteModal() {
            var listEl = document.getElementById('modalAddParticipantList');
            var listTitleEl = document.getElementById('addParticipantListTitle');
            var urlEl = document.getElementById('addParticipantShareUrl');
            var copyBtn = document.getElementById('addParticipantShareCopy');
            var revokeBtn = document.getElementById('addParticipantShareRevoke');
            if (urlEl) urlEl.value = '';
            if (copyBtn) copyBtn.style.display = 'none';
            if (revokeBtn) revokeBtn.style.display = 'none';
            addParticipantModal.dataset.linkToken = '';

            if (callState.groupCallId) {
                if (listTitleEl) listTitleEl.textContent = callsL('participants_title', 'Участники звонка');
                loadInviteModalShareLink().catch(function(err) {
                    if (err && err.message) alert(err.message);
                });
                if (listEl && callState.conversationId) {
                    apiRequest(API_BASE + '/api/calls.php?action=group_status&conversation_id=' + callState.conversationId)
                        .then(function(res) {
                            if (!listEl) return;
                            if (!res || !res.success || !res.data) {
                                listEl.innerHTML = '<li class="muted">' + callsL('load_participants_error', 'Не удалось загрузить участников') + '</li>';
                                return;
                            }
                            var participants = res.data.participants || [];
                            var guests = res.data.guests || [];
                            var items = [];
                            items.push('<li class="group-call-participant-item group-call-participant-self"><span class="group-call-participant-avatar"><span class="group-call-participant-avatar-placeholder">В</span></span><span class="group-call-participant-name">' + callsL('you', 'Вы') + '</span></li>');
                            participants.forEach(function(p) {
                                if (p.user_uuid === userUuid) return;
                                var name = p.display_name || callsL('participant', 'Участник');
                                var letter = (name || '').trim().charAt(0).toUpperCase();
                                var avatarHtml = p.avatar ? '<img src="' + escapeHtml(p.avatar) + '" alt="">' : '<span class="group-call-participant-avatar-placeholder">' + escapeHtml(letter) + '</span>';
                                items.push('<li class="group-call-participant-item"><span class="group-call-participant-avatar">' + avatarHtml + '</span><span class="group-call-participant-name">' + escapeHtml(name) + '</span></li>');
                            });
                            guests.forEach(function(g) {
                                var name = g.display_name || callsL('guest', 'Гость');
                                var letter = (name || '').trim().charAt(0).toUpperCase();
                                var avatarHtml = '<span class="group-call-participant-avatar-placeholder">' + escapeHtml(letter) + '</span>';
                                items.push('<li class="group-call-participant-item group-call-participant-guest"><span class="group-call-participant-avatar">' + avatarHtml + '</span><span class="group-call-participant-name">' + escapeHtml(name) + '</span></li>');
                            });
                            listEl.innerHTML = items.length ? items.join('') : '<li class="muted">' + callsL('no_participants', 'Нет участников') + '</li>';
                        })
                        .catch(function() {
                            if (listEl) listEl.innerHTML = '<li class="muted">' + callsL('load_error', 'Не удалось загрузить') + '</li>';
                        });
                } else if (listEl) {
                    listEl.innerHTML = '<li class="muted">' + callsL('no_participants', 'Нет участников') + '</li>';
                }
            } else {
                if (listTitleEl) listTitleEl.textContent = callsL('add_to_call', 'Добавить в звонок');
                loadInviteModalShareLink().catch(function(err) {
                    if (err && err.message) alert(err.message);
                });
                var peerUuid = callState.peerUuid;
                var contactsList = (window.chatModule && typeof window.chatModule.contacts === 'function') ? window.chatModule.contacts() : [];
                listEl.innerHTML = '';
                contactsList.forEach(function(c) {
                    if (c.uuid === peerUuid || c.uuid === userUuid) return;
                    var li = document.createElement('li');
                    li.textContent = (c.display_name || c.username || c.uuid || '').trim() || c.uuid;
                    li.dataset.uuid = c.uuid;
                    li.style.cursor = 'pointer';
                    li.addEventListener('click', function() {
                        var u = this.dataset.uuid;
                        addParticipantModal.classList.add('is-hidden');
                        if (u) addParticipantToCall(u).catch(function(e) { console.error(e); });
                    });
                    listEl.appendChild(li);
                });
                if (listEl.children.length === 0) listEl.innerHTML = '<li class="muted">' + callsL('no_contacts', 'Нет контактов для добавления') + '</li>';
            }
            addParticipantModal.classList.remove('is-hidden');
        }

        document.getElementById('btnCallAddParticipant').addEventListener('click', openInviteModal);
        document.getElementById('btnGroupCallParticipants').addEventListener('click', openInviteModal);

        document.getElementById('addParticipantShareGet').addEventListener('click', function() {
            loadInviteModalShareLink().catch(function(err) {
                alert(err.message || err.error || callsL('create_link_error', 'Не удалось создать ссылку'));
            });
        });
        document.getElementById('addParticipantShareCopy').addEventListener('click', function() {
            var input = document.getElementById('addParticipantShareUrl');
            var copyBtn = this;
            if (!input || !input.value) return;
            input.select();
            input.setSelectionRange(0, 99999);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(input.value).then(function() {
                    copyBtn.textContent = callsL('copied_btn', 'Скопировано');
                    setTimeout(function() { copyBtn.textContent = callsL('copy_btn', 'Копировать'); }, 2000);
                }).catch(function() {
                    try { document.execCommand('copy'); copyBtn.textContent = callsL('copied_btn', 'Скопировано'); setTimeout(function() { copyBtn.textContent = callsL('copy_btn', 'Копировать'); }, 2000); } catch (e) {}
                });
            } else {
                try {
                    document.execCommand('copy');
                    copyBtn.textContent = callsL('copied_btn', 'Скопировано');
                    setTimeout(function() { copyBtn.textContent = callsL('copy_btn', 'Копировать'); }, 2000);
                } catch (e) {}
            }
        });
        document.getElementById('addParticipantShareRevoke').addEventListener('click', function() {
            var token = addParticipantModal.dataset.linkToken;
            if (!token) return;
            var revokeBtn = this;
            revokeBtn.disabled = true;
            apiRequest(API_BASE + '/api/calls.php?action=call_link_revoke', { method: 'POST', body: JSON.stringify({ link_token: token }), headers: { 'Content-Type': 'application/json' } })
                .then(function() {
                    document.getElementById('addParticipantShareUrl').value = '';
                    revokeBtn.style.display = 'none';
                    document.getElementById('addParticipantShareCopy').style.display = 'none';
                    addParticipantModal.dataset.linkToken = '';
                })
                .catch(function(err) {
                    alert(err.message || err.error || callsL('revoke_error', 'Не удалось отозвать'));
                })
                .then(function() { revokeBtn.disabled = false; });
        });

        document.getElementById('modalAddParticipantClose').addEventListener('click', function() { addParticipantModal.classList.add('is-hidden'); });

        document.getElementById('btnIncomingDecline').addEventListener('click', function() {
            if (ringtoneAudioContext && ringtoneAudioContext.state === 'suspended' && typeof ringtoneAudioContext.resume === 'function') {
                ringtoneAudioContext.resume().then(function() {}, function() {});
            }
            var modal = document.getElementById('modalIncomingCall');
            var callId = modal ? parseInt(modal.dataset.callId, 10) : 0;
            callState.pendingInvite = null;
            callState.pendingOffer = null;
            callState.incomingCallMinimized = null;
            hideIncomingModal();
            if (callId > 0 && API_BASE) {
                fetch(API_BASE + '/api/calls.php?action=call_decline', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ call_id: callId }),
                }).catch(function() {});
            }
            if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                window.chatModule.loadConversations();
            }
        });
        document.getElementById('btnIncomingMinimize').addEventListener('click', function() {
            var modal = document.getElementById('modalIncomingCall');
            if (!modal) return;
            var callId = parseInt(modal.dataset.callId, 10) || 0;
            var conversationId = parseInt(modal.dataset.conversationId, 10) || 0;
            var callerUuid = modal.dataset.callerUuid || '';
            var withVideo = modal.dataset.withVideo === '1';
            var callerName = (document.getElementById('incomingCallName') && document.getElementById('incomingCallName').textContent) || '';
            var callerAvatar = null;
            var avatarEl = document.getElementById('incomingCallAvatar');
            if (avatarEl && avatarEl.querySelector('img')) {
                var img = avatarEl.querySelector('img');
                if (img.src) callerAvatar = img.src;
            }
            callState.incomingCallMinimized = {
                call_id: callId,
                conversation_id: conversationId,
                caller_uuid: callerUuid,
                with_video: withVideo,
                caller_name: callerName,
                caller_avatar: callerAvatar,
            };
            modal.classList.add('is-hidden');
            stopIncomingCallAlerts();
            if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                window.chatModule.loadConversations();
            }
            if (window.chatModule && typeof window.chatModule.refreshChatHeader === 'function') {
                window.chatModule.refreshChatHeader();
            }
        });
        document.getElementById('btnIncomingAccept').addEventListener('click', function() {
            if (ringtoneAudioContext && ringtoneAudioContext.state === 'suspended' && typeof ringtoneAudioContext.resume === 'function') {
                ringtoneAudioContext.resume().then(function() {}, function() {});
            }
            const modal = document.getElementById('modalIncomingCall');
            if (!modal) return;
            const callId = parseInt(modal.dataset.callId, 10);
            const callerUuid = modal.dataset.callerUuid || '';
            const conversationId = parseInt(modal.dataset.conversationId, 10);
            const withVideo = modal.dataset.withVideo === '1';
            hideIncomingModal();
            acceptCall(callId, callerUuid, conversationId, withVideo);
        });

        document.getElementById('btnCallHangup').addEventListener('click', function() {
            if (callState.callId) endCallApi(callState.callId);
            cleanupCall();
        });

        document.getElementById('btnCallMute').addEventListener('click', function() {
            if (callState.localStream) {
                const audio = callState.localStream.getAudioTracks()[0];
                if (audio) {
                    audio.enabled = !audio.enabled;
                    this.classList.toggle('btn-call-muted', !audio.enabled);
                    this.classList.toggle('btn-call-unmuted', audio.enabled);
                    this.title = audio.enabled ? callsL('mic_on', 'Микрофон вкл.') : callsL('mic_off', 'Микрофон выкл.');
                    var lbl = this.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = audio.enabled ? callsL('mic_on_label', 'Микрофон вкл.') : callsL('mic_off_label', 'Микрофон выкл.');
                    sendMuteStateApi(!audio.enabled);
                }
            }
        });
        document.getElementById('btnCallVideo').addEventListener('click', function() {
            if (callState.groupCallId) return;
            toggleLocalCamera1v1();
        });
        var btnCallShareScreen = document.getElementById('btnCallShareScreen');
        if (btnCallShareScreen) {
            btnCallShareScreen.style.display = isDisplayMediaSupported() ? 'inline-flex' : 'none';
            btnCallShareScreen.addEventListener('click', function() {
                if (callState.groupCallId) return;
                if (callState.isSharingScreen) stopScreenShare1v1(); else startScreenShare1v1();
            });
        }
        var btnCallSwitchCamera = document.getElementById('btnCallSwitchCamera');
        if (btnCallSwitchCamera) {
            ['mousedown', 'touchstart'].forEach(function(ev) {
                btnCallSwitchCamera.addEventListener(ev, function(e) { e.stopPropagation(); }, { passive: true });
            });
            btnCallSwitchCamera.addEventListener('click', function() {
                if (callState.groupCallId || !callState.localStream || callState.isSharingScreen || !callState.withVideo || !callState.pc) return;
                var vt = callState.localStream.getVideoTracks()[0];
                if (!vt) return;
                var prevFacing = callState.facingMode;
                callState.facingMode = callState.facingMode === 'user' ? 'environment' : 'user';
                var constraints = { video: { facingMode: callState.facingMode } };
                navigator.mediaDevices.getUserMedia({ video: constraints.video }).then(function(vStream) {
                    var newTrack = vStream.getVideoTracks()[0];
                    if (!newTrack) {
                        callState.facingMode = prevFacing;
                        return;
                    }
                    vt.stop();
                    callState.localStream.removeTrack(vt);
                    callState.localStream.addTrack(newTrack);
                    var localV = document.getElementById('callPanelLocalVideo');
                    if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
                    var sender = callState.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                    if (sender) sender.replaceTrack(newTrack).then(function() {
                        return callState.pc.createOffer().then(function(offer) { return callState.pc.setLocalDescription(offer); });
                    }).then(function() {
                        return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
                    }).catch(function() {});
                }).catch(function(err) {
                    callState.facingMode = prevFacing;
                    console.error('Switch camera failed:', err);
                    if (typeof window.showToast === 'function') {
                        window.showToast(callsL('switch_camera_error', 'Не удалось переключить камеру'));
                    }
                });
            });
        }

        var recWrap = document.getElementById('callPanelRecordingWrap');
        if (recWrap) recWrap.style.display = isMediaRecorderSupported() ? 'flex' : 'none';
        document.getElementById('btnCallRecord').addEventListener('click', function() {
            if (!callState.recording) startRecording1v1(callState.withVideo ? 'video' : 'audio');
        });
        var btnCallRecordMobile = document.getElementById('btnCallRecordMobile');
        var callRecordingMobileDropdown = document.getElementById('callRecordingMobileDropdown');
        if (btnCallRecordMobile && callRecordingMobileDropdown) {
            btnCallRecordMobile.addEventListener('click', function(e) {
                if (callState.recording) return;
                if (!callState.withVideo) {
                    startRecording1v1('audio');
                    return;
                }
                e.stopPropagation();
                callRecordingMobileDropdown.classList.toggle('call-recording-dropdown-open');
            });
            callRecordingMobileDropdown.querySelectorAll('.call-recording-option').forEach(function(opt) {
                opt.addEventListener('click', function() {
                    var type = this.getAttribute('data-type') || 'audio';
                    startRecording1v1(type);
                    callRecordingMobileDropdown.classList.remove('call-recording-dropdown-open');
                });
            });
            (function() {
                var mobileWrap = btnCallRecordMobile.closest('.call-recording-mobile-wrap');
                document.addEventListener('click', function(e) {
                    if (mobileWrap && !mobileWrap.contains(e.target)) {
                        callRecordingMobileDropdown.classList.remove('call-recording-dropdown-open');
                    }
                });
            })();
        }
        document.getElementById('btnCallRecordingStop').addEventListener('click', function() {
            stopRecordingIfActive(true);
        });
    }

    function flushIceBuffer(pc) {
        if (!callState.iceBuffer.length || !pc) return;
        callState.iceBuffer.forEach(function(c) {
            pc.addIceCandidate(new RTCIceCandidate(c)).catch(function() {});
        });
        callState.iceBuffer = [];
    }

    function flushPeerIceBuffer(peerUuid) {
        if (!callState.peerIceBuffers) return;
        var buf = callState.peerIceBuffers.get(peerUuid);
        if (!buf || !buf.length) return;
        var peer = callState.peers && callState.peers.get(peerUuid);
        if (!peer || !peer.pc) return;
        buf.forEach(function(c) {
            peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function() {});
        });
        callState.peerIceBuffers.set(peerUuid, []);
    }

    function createPeerConnection(conversationId, peerUuid, withVideo) {
        const pc = new RTCPeerConnection(getStunConfig());
        pc.onicecandidate = function(ev) {
            if (ev.candidate) sendSignaling(conversationId, peerUuid, { ice: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }).catch(function() {});
        };
        pc.ontrack = function(ev) {
            if (!ev.streams || !ev.streams[0]) return;
            var stream = ev.streams[0];
            callState.remoteStream = stream;
            if (ev.track.kind === 'video' && !callState.withVideo) {
                callState.withVideo = true;
                updateCallPanelVideoUI(true);
            }
            var remoteV = document.getElementById('callPanelRemoteVideo');
            if (remoteV) {
                remoteV.srcObject = stream;
                remoteV.play().catch(function() {});
            }
            var remoteA = document.getElementById('callPanelRemoteAudio');
            if (remoteA) {
                remoteA.srcObject = stream;
                remoteA.play().catch(function() {});
            }
            setCallPanelWaitingState(false);
            setCallPanelDurationText('0:00');
            startCallDurationTimer();
            updateCallPanelPeerAvatar();
            updateCallPanelRemoteStatus();
            var track = ev.track;
            if (track && typeof track.addEventListener === 'function') {
                track.addEventListener('mute', updateCallPanelRemoteStatus);
                track.addEventListener('unmute', updateCallPanelRemoteStatus);
            }
            if (stream && typeof stream.addEventListener === 'function') {
                stream.addEventListener('removetrack', function() { updateCallPanelRemoteStatus(); updateCallPanelVideoUI(true); });
            }
            startSpeakingMonitor1v1();
        };
        return pc;
    }

    function updateCallPanelRemoteStatus() {
        var statusEl = document.getElementById('callPanelRemoteStatus');
        if (!statusEl) return;
        if (!callState.remoteStream) {
            statusEl.innerHTML = '';
            var peerStatusEl = document.getElementById('callPanelPeerAudioStatus');
            if (peerStatusEl) peerStatusEl.innerHTML = '';
            var panel = document.getElementById('callPanel');
            if (panel) panel.classList.remove('call-panel-remote-video-off');
            return;
        }
        var audioMuted = true;
        if (callState.peerMuted === true) audioMuted = true;
        else if (callState.peerMuted === false) audioMuted = false;
        else {
            var at = callState.remoteStream.getAudioTracks();
            if (at && at.length > 0 && !at[0].muted) audioMuted = false;
        }
        var micLabel = audioMuted ? callsL('mic_off', 'Микрофон выкл.') : callsL('mic_on', 'Микрофон вкл.');
        var micClass = audioMuted ? 'peer-mic-off' : 'peer-mic-on';
        var iconHtml = '<span class="peer-mic-icon ' + micClass + '" role="img" aria-label="' + escapeHtml(micLabel) + '" title="' + escapeHtml(micLabel) + '"></span>';
        statusEl.innerHTML = iconHtml;
        var peerStatusEl = document.getElementById('callPanelPeerAudioStatus');
        if (peerStatusEl) peerStatusEl.innerHTML = iconHtml;
        var vt = callState.remoteStream.getVideoTracks()[0];
        var videoOff = callState.withVideo && !callState.remoteScreenSharing && (!vt || vt.muted);
        var panel = document.getElementById('callPanel');
        if (panel) panel.classList.toggle('call-panel-remote-video-off', !!videoOff);
        var audioView = document.getElementById('callPanelAudioView');
        if (audioView && callState.withVideo) audioView.style.display = videoOff ? 'flex' : 'none';
    }

    /**
     * Переключить только свою камеру в звонке 1-на-1. Влияет только на свой превью; видео собеседника не трогаем.
     */
    function toggleLocalCamera1v1() {
        if (callState.groupCallId || !callState.localStream) return;
        var vt = callState.localStream.getVideoTracks()[0];
        if (vt) {
            vt.enabled = !vt.enabled;
            updateLocalPipVisibility1v1();
            updateVideoButtonStates();
        } else {
            switchCallToVideo();
        }
    }

    /**
     * Переключить звонок 1-на-1 с аудио на видео (включить камеру).
     * Проверяем именно наличие локального видеотрека, а не withVideo — иначе второй пользователь не сможет включить камеру, если первый уже включил (withVideo уже true из-за удалённого потока).
     */
    function switchCallToVideo() {
        if (callState.localStream && callState.localStream.getVideoTracks().length > 0) return Promise.resolve();
        if (!callState.pc || !callState.peerUuid || !callState.localStream) return Promise.resolve();
        return navigator.mediaDevices.getUserMedia({ video: getVideoConstraints() }).then(function(videoStream) {
            var videoTrack = videoStream.getVideoTracks()[0];
            if (!videoTrack) return;
            callState.localStream.addTrack(videoTrack);
            callState.pc.addTrack(videoTrack, callState.localStream);
            callState.withVideo = true;
            updateCallPanelVideoUI(true);
            return callState.pc.createOffer();
        }).then(function(offer) {
            return callState.pc.setLocalDescription(offer);
        }).then(function() {
            return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
        }).then(function() {
            updateVideoButtonStates();
        }).catch(function(err) {
            console.error('switchCallToVideo:', err);
        });
    }

    /**
     * Переключить звонок 1-на-1 с видео на аудио (выключить камеру).
     */
    function switchCallToAudio() {
        if (!callState.withVideo || !callState.pc || !callState.peerUuid || !callState.localStream) return Promise.resolve();
        var videoTrack = callState.localStream.getVideoTracks()[0];
        if (!videoTrack) { callState.withVideo = false; updateCallPanelVideoUI(false); updateVideoButtonStates(); return Promise.resolve(); }
        var sender = callState.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
        if (sender) callState.pc.removeTrack(sender);
        videoTrack.stop();
        callState.localStream.removeTrack(videoTrack);
        callState.withVideo = false;
        updateCallPanelVideoUI(false);
        return callState.pc.createOffer().then(function(offer) {
            return callState.pc.setLocalDescription(offer);
        }).then(function() {
            return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
        }).then(function() {
            updateVideoButtonStates();
        }).catch(function(err) {
            console.error('switchCallToAudio:', err);
        });
    }

    function isDisplayMediaSupported() {
        return typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
    }

    /**
     * Поделиться экраном в звонке 1-на-1.
     * При уже включённом видео используем replaceTrack, чтобы не менять SDP и избежать ERROR_CONTENT.
     */
    function startScreenShare1v1() {
        if (!isDisplayMediaSupported() || !callState.pc || !callState.peerUuid || !callState.localStream || !callState.conversationId || callState.groupCallId) return Promise.resolve();
        if (callState.isSharingScreen) return Promise.resolve();
        callState._hadVideoBeforeShare = callState.withVideo;
        return navigator.mediaDevices.getDisplayMedia({ video: true }).then(function(screenStream) {
            callState.screenStream = screenStream;
            callState.isSharingScreen = true;
            var screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return Promise.reject(new Error('Нет видеотрека'));
            screenTrack.onended = function() { stopScreenShare1v1(); };
            var sender = callState.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
            var videoTrack = callState.localStream.getVideoTracks()[0];
            if (sender && videoTrack) {
                videoTrack.stop();
                callState.localStream.removeTrack(videoTrack);
                callState.localStream.addTrack(screenTrack);
                return sender.replaceTrack(screenTrack).then(function() {
                    callState.withVideo = true;
                    updateCallPanelVideoUI(true);
                    var localV = document.getElementById('callPanelLocalVideo');
                    if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
                    updateScreenShareButtonStates();
                    var p = document.getElementById('callPanel');
                    if (p) p.classList.add('call-panel-local-screen-share');
                });
            }
            if (videoTrack) {
                callState.localStream.removeTrack(videoTrack);
                videoTrack.stop();
            }
            callState.localStream.addTrack(screenTrack);
            callState.pc.addTrack(screenTrack, callState.localStream);
            callState.withVideo = true;
            updateCallPanelVideoUI(true);
            var localV = document.getElementById('callPanelLocalVideo');
            if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
            updateScreenShareButtonStates();
            var p = document.getElementById('callPanel');
            if (p) p.classList.add('call-panel-local-screen-share');
            return callState.pc.createOffer();
        }).then(function(offer) {
            if (offer) {
                return callState.pc.setLocalDescription(offer).then(function() {
                    return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
                });
            }
        }).then(function() {
            return screenShareStartedApi();
        }).catch(function(err) {
            if (callState.screenStream) {
                callState.screenStream.getTracks().forEach(function(t) { t.stop(); });
                callState.screenStream = null;
            }
            callState.isSharingScreen = false;
            var pErr = document.getElementById('callPanel');
            if (pErr) pErr.classList.remove('call-panel-local-screen-share');
            if (err && err.name !== 'NotAllowedError') console.error('startScreenShare1v1:', err);
        });
    }

    /**
     * Остановить демонстрацию экрана в звонке 1-на-1.
     * При возврате к камере используем replaceTrack, чтобы не менять SDP.
     */
    function stopScreenShare1v1() {
        if (!callState.pc || !callState.peerUuid || !callState.localStream || !callState.conversationId || callState.groupCallId) return Promise.resolve();
        if (!callState.isSharingScreen) return Promise.resolve();
        var sender = callState.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
        if (callState.screenStream) {
            callState.screenStream.getTracks().forEach(function(t) { t.stop(); });
            callState.screenStream = null;
        }
        callState.localStream.getVideoTracks().forEach(function(t) { callState.localStream.removeTrack(t); });
        callState.isSharingScreen = false;
        screenShareStoppedApi();
        var panel1 = document.getElementById('callPanel');
        if (panel1) panel1.classList.remove('call-panel-local-screen-share');
        var hadVideoBeforeShare = callState._hadVideoBeforeShare;
        callState.withVideo = false;
        updateCallPanelVideoUI(false);
        var localV = document.getElementById('callPanelLocalVideo');
        if (localV) localV.srcObject = null;
        updateScreenShareButtonStates();
        if (hadVideoBeforeShare && sender) {
            return navigator.mediaDevices.getUserMedia({ video: getVideoConstraints() }).then(function(videoStream) {
                var videoTrack = videoStream.getVideoTracks()[0];
                if (!videoTrack) return;
                callState.localStream.addTrack(videoTrack);
                return sender.replaceTrack(videoTrack).then(function() {
                    callState.withVideo = true;
                    updateCallPanelVideoUI(true);
                    if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
                    updateVideoButtonStates();
                });
            }).catch(function(err) {
                console.error('stopScreenShare1v1:', err);
            });
        }
        if (sender) callState.pc.removeTrack(sender);
        return callState.pc.createOffer().then(function(offer) {
            return callState.pc.setLocalDescription(offer);
        }).then(function() {
            return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
        }).then(function() {
            updateVideoButtonStates();
        }).catch(function(err) {
            console.error('stopScreenShare1v1:', err);
        });
    }

    /**
     * Поделиться экраном в групповом звонке.
     */
    function startScreenShareGroup() {
        if (!isDisplayMediaSupported() || !callState.localStream || !callState.peers || !callState.conversationId || !callState.groupCallId) return Promise.resolve();
        if (callState.isSharingScreen) return Promise.resolve();
        callState._hadVideoBeforeShare = callState.withVideo;
        return navigator.mediaDevices.getDisplayMedia({ video: true }).then(function(screenStream) {
            callState.screenStream = screenStream;
            callState.isSharingScreen = true;
            var screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return Promise.reject(new Error('Нет видеотрека'));
            screenTrack.onended = function() { stopScreenShareGroup(); };
            var videoTrack = callState.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                callState.localStream.removeTrack(videoTrack);
            }
            callState.localStream.addTrack(screenTrack);
            callState.withVideo = true;
            var panel = document.getElementById('groupCallPanel');
            if (panel) {
                panel.classList.add('group-call-with-video');
                panel.classList.add('group-call-local-screen-share');
                var vw = panel.querySelector('.group-call-video-wrap');
                if (vw) vw.style.display = 'flex';
            }
            var localV = document.querySelector('#groupCallPanel .group-call-local-video');
            if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
            var renegotiatePromises = [];
            callState.peers.forEach(function(peer, peerKey) {
                if (peer.pc) {
                    var sender = peer.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                    if (sender) peer.pc.removeTrack(sender);
                    peer.pc.addTrack(screenTrack, callState.localStream);
                    renegotiatePromises.push(
                        peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); })
                            .then(function() { return sendSignaling(callState.conversationId, peerKey, { sdp: peer.pc.localDescription }); })
                    );
                }
            });
            updateScreenShareButtonStates();
            return Promise.all(renegotiatePromises).then(function() { return screenShareStartedApi(); });
        }).catch(function(err) {
            if (callState.screenStream) {
                callState.screenStream.getTracks().forEach(function(t) { t.stop(); });
                callState.screenStream = null;
            }
            callState.isSharingScreen = false;
            var panelErr = document.getElementById('groupCallPanel');
            if (panelErr) panelErr.classList.remove('group-call-local-screen-share');
            if (err && err.name !== 'NotAllowedError') console.error('startScreenShareGroup:', err);
        });
    }

    /**
     * Остановить демонстрацию экрана в групповом звонке.
     */
    function stopScreenShareGroup() {
        if (!callState.localStream || !callState.peers || !callState.conversationId || !callState.groupCallId) return Promise.resolve();
        if (!callState.isSharingScreen) return Promise.resolve();
        var hadVideoBeforeShare = callState._hadVideoBeforeShare;
        screenShareStoppedApi();
        if (callState.screenStream) {
            callState.screenStream.getTracks().forEach(function(t) { t.stop(); });
            callState.screenStream = null;
        }
        callState.isSharingScreen = false;
        var screenTrack = callState.localStream.getVideoTracks()[0];
        if (screenTrack) callState.localStream.removeTrack(screenTrack);
        callState.withVideo = false;
        var renegotiatePromises = [];
        callState.peers.forEach(function(peer, peerKey) {
            if (peer.pc) {
                var sender = peer.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                if (sender) peer.pc.removeTrack(sender);
                renegotiatePromises.push(
                    peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); })
                        .then(function() { return sendSignaling(callState.conversationId, peerKey, { sdp: peer.pc.localDescription }); })
                );
            }
        });
        updateGroupCallVideoUI(false);
        var groupPanel = document.getElementById('groupCallPanel');
        if (groupPanel) groupPanel.classList.remove('group-call-local-screen-share');
        var localV = document.querySelector('#groupCallPanel .group-call-local-video');
        if (localV) localV.srcObject = null;
        updateScreenShareButtonStates();
        return Promise.all(renegotiatePromises).then(function() {
            if (hadVideoBeforeShare) {
                return navigator.mediaDevices.getUserMedia({ video: getVideoConstraints() }).then(function(videoStream) {
                    var videoTrack = videoStream.getVideoTracks()[0];
                    if (!videoTrack) return;
                    callState.localStream.addTrack(videoTrack);
                    callState.withVideo = true;
                    updateGroupCallVideoUI(true);
                    if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
                    var addPromises = [];
                    callState.peers.forEach(function(peer, peerKey) {
                        if (peer.pc) {
                            peer.pc.addTrack(videoTrack, callState.localStream);
                            addPromises.push(
                                peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); })
                                    .then(function() { return sendSignaling(callState.conversationId, peerKey, { sdp: peer.pc.localDescription }); })
                            );
                        }
                    });
                    return Promise.all(addPromises);
                });
            }
        }).then(function() { updateVideoButtonStates(); }).catch(function(err) {
            console.error('stopScreenShareGroup:', err);
        });
    }

    /**
     * Переключить только свою камеру в групповом звонке. Влияет только на свой превью; видео других не трогаем.
     */
    function toggleLocalCameraGroup() {
        if (!callState.groupCallId || !callState.localStream) return;
        var vt = callState.localStream.getVideoTracks()[0];
        if (vt) {
            vt.enabled = !vt.enabled;
            updateLocalPipVisibilityGroup();
            updateVideoButtonStates();
        } else {
            switchGroupCallToVideo();
        }
    }

    /**
     * Переключить групповой звонок на видео.
     */
    function switchGroupCallToVideo() {
        if (callState.withVideo || !callState.localStream || !callState.peers || !callState.conversationId) return Promise.resolve();
        return navigator.mediaDevices.getUserMedia({ video: getVideoConstraints() }).then(function(videoStream) {
            var videoTrack = videoStream.getVideoTracks()[0];
            if (!videoTrack) return;
            callState.localStream.addTrack(videoTrack);
            callState.withVideo = true;
            var panel = document.getElementById('groupCallPanel');
            if (panel) {
                panel.classList.add('group-call-with-video');
                var wrap = panel.querySelector('.group-call-video-wrap');
                if (wrap) wrap.style.display = 'flex';
            }
            var localV = document.querySelector('#groupCallPanel .group-call-local-video');
            if (localV) { localV.srcObject = callState.localStream; localV.play().catch(function(){}); }
            var renegotiatePromises = [];
            callState.peers.forEach(function(peer, peerUuid) {
                if (!peer.pc) return;
                var pc = peer.pc;
                var existingVideoSender = pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                if (existingVideoSender) {
                    renegotiatePromises.push(
                        existingVideoSender.replaceTrack(videoTrack).then(function() {
                            return pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); })
                                .then(function() { return sendSignaling(callState.conversationId, peerUuid, { sdp: pc.localDescription }); });
                        })
                    );
                } else {
                    var transceiver = pc.getTransceivers().find(function(t) { return t.receiver && t.receiver.track && t.receiver.track.kind === 'video'; });
                    if (!transceiver && typeof pc.addTransceiver === 'function') {
                        transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
                        var setTrackPromise = transceiver.sender ? transceiver.sender.replaceTrack(videoTrack) : Promise.resolve();
                        renegotiatePromises.push(
                            setTrackPromise.then(function() {
                                return pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); })
                                    .then(function() { return sendSignaling(callState.conversationId, peerUuid, { sdp: pc.localDescription }); });
                            })
                        );
                    } else {
                        pc.addTrack(videoTrack, callState.localStream);
                        renegotiatePromises.push(
                            pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); })
                                .then(function() { return sendSignaling(callState.conversationId, peerUuid, { sdp: pc.localDescription }); })
                        );
                    }
                }
            });
            return Promise.all(renegotiatePromises);
        }).then(function() {
            updateVideoButtonStates();
        }).catch(function(err) {
            console.error('switchGroupCallToVideo:', err);
        });
    }

    /**
     * Переключить групповой звонок на аудио.
     */
    function switchGroupCallToAudio() {
        if (!callState.withVideo || !callState.localStream || !callState.peers) return Promise.resolve();
        var videoTrack = callState.localStream.getVideoTracks()[0];
        if (!videoTrack) { callState.withVideo = false; updateGroupCallVideoUI(false); updateVideoButtonStates(); return Promise.resolve(); }
        var renegotiatePromises = [];
        callState.peers.forEach(function(peer, peerUuid) {
            if (peer.pc) {
                var sender = peer.pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                if (sender) peer.pc.removeTrack(sender);
                renegotiatePromises.push(
                    peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); })
                        .then(function() { return sendSignaling(callState.conversationId, peerUuid, { sdp: peer.pc.localDescription }); })
                );
            }
        });
        videoTrack.stop();
        callState.localStream.removeTrack(videoTrack);
        callState.withVideo = false;
        updateGroupCallVideoUI(false);
        return Promise.all(renegotiatePromises).then(function() { updateVideoButtonStates(); }).catch(function(err) {
            console.error('switchGroupCallToAudio:', err);
        });
    }

    function updateGroupCallVideoUI(withVideo) {
        var panel = document.getElementById('groupCallPanel');
        if (!panel) return;
        panel.classList.toggle('group-call-with-video', !!withVideo);
        panel.classList.toggle('group-call-audio', !withVideo);
        var wrap = panel.querySelector('.group-call-video-wrap');
        if (wrap) wrap.style.display = withVideo ? 'block' : 'none';
        var audioView = document.getElementById('groupCallAudioView');
        if (audioView) audioView.style.display = withVideo ? 'none' : 'flex';
        var localV = panel.querySelector('.group-call-local-video');
        if (localV && !withVideo) localV.srcObject = null;
        if (withVideo) updateLocalPipVisibilityGroup();
    }

    function updateVideoButtonStates() {
        var cameraOn = isLocalCameraOn();
        var btn1 = document.getElementById('btnCallVideo');
        if (btn1) {
            btn1.classList.toggle('btn-call-off', !cameraOn);
            btn1.classList.toggle('btn-call-on', cameraOn);
            btn1.title = cameraOn ? callsL('camera_on', 'Камера вкл.') : callsL('camera_off', 'Камера выкл.');
            btn1.setAttribute('aria-label', cameraOn ? callsL('camera_on', 'Камера вкл.') : callsL('camera_off', 'Камера выкл.'));
            var lbl = btn1.querySelector('.btn-call-label');
            if (lbl) lbl.innerHTML = callsLabelBr(cameraOn ? callsL('camera_on_label', 'Камера\nвкл.') : callsL('camera_off_label', 'Камера\nвыкл.'));
        }
        var btn2 = document.getElementById('btnGroupCallVideo');
        if (btn2) {
            btn2.classList.toggle('btn-call-off', !cameraOn);
            btn2.classList.toggle('btn-call-on', cameraOn);
            btn2.title = cameraOn ? callsL('camera_on', 'Камера вкл.') : callsL('camera_off', 'Камера выкл.');
            btn2.setAttribute('aria-label', cameraOn ? callsL('camera_on', 'Камера вкл.') : callsL('camera_off', 'Камера выкл.'));
            var lbl2 = btn2.querySelector('.btn-call-label');
            if (lbl2) lbl2.innerHTML = callsLabelBr(cameraOn ? callsL('camera_on_label', 'Камера\nвкл.') : callsL('camera_off_label', 'Камера\nвыкл.'));
        }
        var switch1 = document.getElementById('btnCallSwitchCamera');
        if (switch1) switch1.style.display = (callState.withVideo && cameraOn) ? 'inline-flex' : 'none';
        var switch2 = document.getElementById('btnGroupCallSwitchCamera');
        if (switch2) switch2.style.display = (callState.withVideo && cameraOn) ? 'inline-flex' : 'none';
    }

    function updateScreenShareButtonStates() {
        var sharing = !!callState.isSharingScreen;
        var btn1 = document.getElementById('btnCallShareScreen');
        if (btn1) {
            btn1.classList.toggle('btn-call-off', !sharing);
            btn1.classList.toggle('btn-call-on', sharing);
            btn1.title = sharing ? callsL('screen_sharing', 'Делимся экраном') : callsL('screen_not_sharing', 'Не делимся экраном');
            btn1.setAttribute('aria-label', sharing ? callsL('screen_sharing', 'Делимся экраном') : callsL('screen_not_sharing', 'Не делимся экраном'));
            var lbl = btn1.querySelector('.btn-call-label');
            if (lbl) lbl.innerHTML = callsLabelBr(sharing ? callsL('screen_sharing_label', 'Делимся\nэкраном') : callsL('screen_not_sharing_label', 'Не делимся\nэкраном'));
        }
        var btn2 = document.getElementById('btnGroupCallShareScreen');
        if (btn2) {
            btn2.classList.toggle('btn-call-off', !sharing);
            btn2.classList.toggle('btn-call-on', sharing);
            btn2.title = sharing ? callsL('screen_sharing', 'Делимся экраном') : callsL('screen_not_sharing', 'Не делимся экраном');
            btn2.setAttribute('aria-label', sharing ? callsL('screen_sharing', 'Делимся экраном') : callsL('screen_not_sharing', 'Не делимся экраном'));
            var lbl2 = btn2.querySelector('.btn-call-label');
            if (lbl2) lbl2.innerHTML = callsLabelBr(sharing ? callsL('screen_sharing_label', 'Делимся\nэкраном') : callsL('screen_not_sharing_label', 'Не делимся\nэкраном'));
        }
    }

    function createPeerConnectionForGroup(peerUuid) {
        const convId = callState.conversationId;
        const videoEl = addGroupCallRemoteSlot(peerUuid);
        const pc = new RTCPeerConnection(getStunConfig());
        pc.onicecandidate = function(ev) {
            if (ev.candidate) sendSignaling(convId, peerUuid, { ice: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }).catch(function() {});
        };
        pc.ontrack = function(ev) {
            if (videoEl && ev.streams && ev.streams[0]) {
                videoEl.srcObject = ev.streams[0];
                videoEl.play().catch(function() {});
                updateGroupCallSlotStatus(peerUuid);
                var track = ev.track;
                if (track && typeof track.addEventListener === 'function') {
                    track.addEventListener('mute', function() { updateGroupCallSlotStatus(peerUuid); });
                    track.addEventListener('unmute', function() { updateGroupCallSlotStatus(peerUuid); });
                }
            }
        };
        if (!callState.peers) callState.peers = new Map();
        callState.peers.set(peerUuid, { pc: pc, videoEl: videoEl });
        if (!callState.peerIceBuffers) callState.peerIceBuffers = new Map();
        callState.peerIceBuffers.set(peerUuid, []);
        return pc;
    }

    function startGroupCall(conversationId, withVideo) {
        if (!conversationId) return Promise.reject(new Error('conversationId required'));
        return init().then(function() {
            return apiRequest(API_BASE + '/api/calls.php?action=group_start', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, with_video: withVideo }),
                headers: { 'Content-Type': 'application/json' },
            });
        }).then(function(res) {
            if (!res || !res.success || !res.data || !res.data.group_call_id) throw new Error(callsL('start_group_call_error', 'Не удалось начать групповой звонок'));
            var groupCallId = res.data.group_call_id;
            return navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? getVideoConstraints() : false }).then(function(stream) {
                callState.groupCallId = groupCallId;
                callState.conversationId = conversationId;
                callState.withVideo = withVideo;
                callState.localStream = stream;
                callState.peers = new Map();
                callState.participantUuids = [userUuid];
                var localV = document.querySelector('#groupCallPanel .group-call-local-video');
                if (localV) { localV.srcObject = stream; localV.play().catch(function(){}); }
                showGroupCallPanel(withVideo);
                var muteBtn = document.getElementById('btnGroupCallMute');
                if (muteBtn) {
                    muteBtn.classList.add('btn-call-unmuted');
                    var lbl = muteBtn.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = callsL('mic_on_label', 'Микрофон вкл.');
                    muteBtn.title = callsL('mic_on', 'Микрофон вкл.');
                }
                sendMuteStateApi(false);
                return stream;
            }, function(err) {
                var msg = (err && err.name === 'NotReadableError') || (err && err.message && err.message.indexOf('in use') !== -1)
                    ? callsL('media_in_use', 'Камера или микрофон заняты. Закройте другие вкладки или приложения, использующие устройство.')
                    : (err && err.message) || callsL('media_access_error', 'Не удалось получить доступ к камере/микрофону');
                return Promise.reject(new Error(msg));
            });
        });
    }

    function joinGroupCall(conversationIdOrGroupCallId, withVideo) {
        var body = {};
        if (typeof conversationIdOrGroupCallId === 'number' && conversationIdOrGroupCallId > 0) {
            body.conversation_id = conversationIdOrGroupCallId;
        } else {
            body.group_call_id = conversationIdOrGroupCallId;
        }
        return init().then(function() {
            return apiRequest(API_BASE + '/api/calls.php?action=group_join', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            });
        }).then(function(res) {
            if (!res || !res.success || !res.data) throw new Error(callsL('join_error', 'Не удалось присоединиться'));
            var data = res.data;
            var groupCallId = data.group_call_id;
            var conversationId = data.conversation_id;
            var participants = data.participants || [];
            return navigator.mediaDevices.getUserMedia({ audio: true, video: data.with_video ? getVideoConstraints() : false }).then(function(stream) {
                callState.groupCallId = groupCallId;
                callState.conversationId = conversationId;
                callState.withVideo = !!data.with_video;
                callState.localStream = stream;
                callState.peers = new Map();
                callState.participantUuids = participants.map(function(p) { return p.user_uuid; }).filter(function(u) { return u !== userUuid; });
                callState.participantGuestIds = (data.guests || []).map(function(g) { return g.id; });
                callState.guestDisplayNames = {};
                (data.guests || []).forEach(function(g) { callState.guestDisplayNames['guest_' + g.id] = g.display_name || callsL('guest', 'Гость'); });
                var localV = document.querySelector('#groupCallPanel .group-call-local-video');
                if (localV) { localV.srcObject = stream; localV.play().catch(function(){}); }
                showGroupCallPanel(callState.withVideo);
                var muteBtn = document.getElementById('btnGroupCallMute');
                if (muteBtn) {
                    muteBtn.classList.add('btn-call-unmuted');
                    var lbl = muteBtn.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = callsL('mic_on_label', 'Микрофон вкл.');
                    muteBtn.title = callsL('mic_on', 'Микрофон вкл.');
                }
                sendMuteStateApi(false);
                var convId = conversationId;
                var createOfferFor = function(peerKey) {
                    var pc = createPeerConnectionForGroup(peerKey);
                    callState.localStream.getTracks().forEach(function(t) { pc.addTrack(t, callState.localStream); });
                    return pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                        return sendSignaling(convId, peerKey, { sdp: pc.localDescription });
                    });
                };
                var chain = Promise.resolve();
                callState.participantUuids.forEach(function(uuid) {
                    if (uuid === userUuid) return;
                    chain = chain.then(function() { return createOfferFor(uuid); });
                });
                (data.guests || []).forEach(function(g) {
                    chain = chain.then(function() { return createOfferFor('guest_' + g.id); });
                });
                return chain;
            }, function(err) {
                var msg = (err && err.name === 'NotReadableError') || (err && err.message && err.message.indexOf('in use') !== -1)
                    ? callsL('media_in_use', 'Камера или микрофон заняты. Закройте другие вкладки или приложения, использующие устройство.')
                    : (err && err.message) || callsL('media_access_error', 'Не удалось получить доступ к камере/микрофону');
                return Promise.reject(new Error(msg));
            });
        });
    }

    function leaveGroupCall() {
        if (!callState.groupCallId || !API_BASE) return Promise.resolve();
        return fetch(API_BASE + '/api/calls.php?action=group_leave', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_call_id: callState.groupCallId }),
        }).then(function() { cleanupCall(); }).catch(function() { cleanupCall(); });
    }

    function endGroupCallForAll() {
        if (!callState.groupCallId || !API_BASE) return Promise.resolve();
        return fetch(API_BASE + '/api/calls.php?action=group_end', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_call_id: callState.groupCallId }),
        }).then(function() { cleanupCall(); }).catch(function() { cleanupCall(); });
    }

    function startCall(conversationId, calleeUuid, withVideo) {
        if (!conversationId || !calleeUuid) return Promise.reject(new Error('conversationId and calleeUuid required'));
        return init().then(function() {
            return apiRequest(API_BASE + '/api/calls.php?action=start', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, callee_uuid: calleeUuid, with_video: withVideo }),
                headers: { 'Content-Type': 'application/json' },
            });
        }).then(function(res) {
            if (!res || !res.success || !res.data || !res.data.call_id) throw new Error(callsL('start_call_error', 'Не удалось начать звонок'));
            const callId = res.data.call_id;
            return apiRequest(API_BASE + '/api/calls.php?action=invite', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, callee_uuid: calleeUuid, with_video: withVideo, call_id: callId }),
                headers: { 'Content-Type': 'application/json' },
            }).then(function() { return callId; });
        }).then(function(callId) {
            callState.callId = callId;
            callState.conversationId = conversationId;
            callState.peerUuid = calleeUuid;
            callState.withVideo = withVideo;
            callState.isCaller = true;

            return navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? getVideoConstraints() : false }).then(function(stream) {
                callState.localStream = stream;
                const localV = document.getElementById('callPanelLocalVideo');
                if (localV) { localV.srcObject = stream; localV.muted = true; localV.play().catch(function(){}); }

                callState.pc = createPeerConnection(conversationId, calleeUuid, withVideo);
                stream.getTracks().forEach(function(t) { callState.pc.addTrack(t, stream); });

                return callState.pc.createOffer();
            }).then(function(offer) {
                return callState.pc.setLocalDescription(offer);
            }).then(function() {
                return sendSignaling(conversationId, calleeUuid, { sdp: callState.pc.localDescription });
            }).then(function() {
                showCallPanel(withVideo);
                var muteBtn = document.getElementById('btnCallMute');
                if (muteBtn) {
                    muteBtn.classList.add('btn-call-unmuted');
                    var lbl = muteBtn.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = callsL('mic_on_label', 'Микрофон вкл.');
                    muteBtn.title = callsL('mic_on', 'Микрофон вкл.');
                }
                sendMuteStateApi(false);
                updateVideoButtonStates();
            });
        });
    }

    function acceptCall(callId, callerUuid, conversationId, withVideo) {
        callState.callId = callId;
        callState.conversationId = conversationId;
        callState.peerUuid = callerUuid;
        callState.withVideo = withVideo;
        callState.isCaller = false;

        navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? getVideoConstraints() : false }).then(function(stream) {
            callState.localStream = stream;
            const localV = document.getElementById('callPanelLocalVideo');
            if (localV) { localV.srcObject = stream; localV.muted = true; localV.play().catch(function(){}); }

            callState.pc = createPeerConnection(conversationId, callerUuid, withVideo);
            stream.getTracks().forEach(function(t) { callState.pc.addTrack(t, stream); });

            var offer = callState.pendingOffer;
            callState.pendingOffer = null;
            function afterShowPanel() {
                var muteBtn = document.getElementById('btnCallMute');
                if (muteBtn) {
                    muteBtn.classList.add('btn-call-unmuted');
                    var lbl = muteBtn.querySelector('.btn-call-label');
                    if (lbl) lbl.textContent = callsL('mic_on_label', 'Микрофон вкл.');
                    muteBtn.title = callsL('mic_on', 'Микрофон вкл.');
                }
                sendMuteStateApi(false);
                updateVideoButtonStates();
            }
            if (offer) {
                return callState.pc.setRemoteDescription(new RTCSessionDescription(offer)).then(function() {
                    return callState.pc.createAnswer();
                }).then(function(answer) {
                    return callState.pc.setLocalDescription(answer);
                }).then(function() {
                    return sendSignaling(conversationId, callerUuid, { sdp: callState.pc.localDescription });
                }).then(function() {
                    showCallPanel(withVideo);
                    afterShowPanel();
                });
            } else {
                showCallPanel(withVideo);
                afterShowPanel();
            }
        }).catch(function(err) {
            console.error('Accept call error:', err);
            cleanupCall();
        });
    }

    /**
     * Вызывается из websocket/client.js при событиях call.invite, call.sdp, call.ice, call.end
     */
    function onWebSocketEvent(type, data) {
        if (!data) return;
        const myUuid = userUuid || (document.body && document.body.dataset ? document.body.dataset.userUuid : '') || '';
        const toMe = (data.to_uuid === myUuid || data.callee_uuid === myUuid);

        if (type === 'call.invite') {
            if (data.callee_uuid !== myUuid) return;
            callState.pendingInvite = { call_id: data.call_id, caller_uuid: data.caller_uuid, conversation_id: data.conversation_id, with_video: !!data.with_video };
            callState.pendingOffer = null;
            var name = callsL('incoming_call', 'Входящий звонок');
            var avatar = null;
            if (window.chatModule && typeof window.chatModule.conversations === 'function' && data.caller_uuid) {
                var list = window.chatModule.conversations();
                var conv = list && list.find(function(c) { return c.other_user && c.other_user.uuid === data.caller_uuid; });
                if (conv && (conv.other_user || conv.name)) {
                    name = (conv.other_user && (conv.other_user.display_name || conv.other_user.username)) || conv.name || name;
                    avatar = (conv.other_user && conv.other_user.avatar) || conv.avatar || null;
                }
            }
            showIncomingModal({
                call_id: data.call_id,
                caller_uuid: data.caller_uuid,
                conversation_id: data.conversation_id,
                with_video: data.with_video,
                caller_name: name,
                caller_avatar: avatar,
            });
            return;
        }

        if (type === 'call.sdp' && toMe && data.sdp && !callState.groupCallId) {
            var sdp = data.sdp;
            if (sdp.type === 'offer') {
                if (callState.pc) {
                    callState.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function() {
                        flushIceBuffer(callState.pc);
                        return callState.pc.createAnswer();
                    }).then(function(answer) {
                        return callState.pc.setLocalDescription(answer);
                    }).then(function() {
                        return sendSignaling(callState.conversationId, callState.peerUuid, { sdp: callState.pc.localDescription });
                    }).catch(function() {});
                } else if (callState.pendingInvite && data.from_uuid === callState.pendingInvite.caller_uuid) {
                    callState.pendingOffer = sdp;
                    if (callState.joiningOngoingCall) {
                        var inv = callState.pendingInvite;
                        callState.joiningOngoingCall = false;
                        callState.pendingInvite = null;
                        acceptCall(inv.call_id, inv.caller_uuid, inv.conversation_id, inv.with_video);
                    }
                }
            } else if (sdp.type === 'answer' && callState.pc) {
                callState.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function() {
                    flushIceBuffer(callState.pc);
                }).catch(function() {});
            }
            return;
        }

        if (type === 'call.ice' && toMe && data.ice && !callState.groupCallId) {
            if (callState.pc) {
                var cand = data.ice;
                callState.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function() {
                    callState.iceBuffer.push(cand);
                });
            }
            return;
        }

        if (type === 'call.resend_offer') {
            var resendCallId = data.call_id != null ? parseInt(data.call_id, 10) : 0;
            if (resendCallId && resendCallId === callState.callId && callState.isCaller && callState.pc && callState.pc.localDescription && data.callee_uuid) {
                sendSignaling(callState.conversationId, data.callee_uuid, { sdp: callState.pc.localDescription }).catch(function() {});
            }
            return;
        }

        if (type === 'call.rejected') {
            var rejectedCallId = data.call_id != null ? parseInt(data.call_id, 10) : 0;
            if (rejectedCallId && callState.isCaller && callState.callId === rejectedCallId) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Собеседник отклонил вызов');
                }
                cleanupCall();
            }
            return;
        }

        if (type === 'call.end') {
            var convId = callState.conversationId || (callState.pendingInvite && callState.pendingInvite.conversation_id) || (data.conversation_id != null ? parseInt(data.conversation_id, 10) : 0);
            if (data.call_id === callState.callId || (data.call_id && !callState.callId && callState.pendingInvite && callState.pendingInvite.call_id === data.call_id)) {
                cleanupCall();
            }
            if (callState.incomingCallMinimized && callState.incomingCallMinimized.call_id && parseInt(callState.incomingCallMinimized.call_id, 10) === parseInt(data.call_id, 10)) {
                callState.incomingCallMinimized = null;
                if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                    window.chatModule.loadConversations();
                }
            }
            if (callState.joiningOngoingCall && data.call_id && callState.pendingInvite && callState.pendingInvite.call_id === data.call_id) {
                callState.joiningOngoingCall = false;
                callState.pendingInvite = null;
            }
            if (convId && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('callEnded', { detail: { conversation_id: convId } }));
            }
            return;
        }

        if (type === 'call.muted') {
            var fromKey = data.from_guest_id != null ? ('guest_' + data.from_guest_id) : (data.from_uuid || data.user_uuid);
            var muted = !!data.muted;
            if (callState.groupCallId) {
                if (!callState.peerMutedMap) callState.peerMutedMap = new Map();
                callState.peerMutedMap.set(fromKey, muted);
                var slot = document.querySelector('.group-call-avatar-slot[data-peer-uuid="' + fromKey + '"]');
                if (slot) {
                    var audioMuted = muted;
                    slot.classList.toggle('group-call-avatar-muted', !!audioMuted);
                    var audioStatusEl = slot.querySelector('.group-call-avatar-slot-audio-status');
                    if (audioStatusEl) audioStatusEl.textContent = audioMuted ? callsL('audio_off', 'Аудио выкл') : callsL('audio_on', 'Аудио вкл');
                }
                updateGroupCallSlotStatus(fromKey);
            } else if (fromKey === callState.peerUuid) {
                callState.peerMuted = muted;
                updateCallPanelPeerAvatar();
                updateCallPanelRemoteStatus();
            }
            return;
        }

        if (type === 'call.screen_share') {
            var fromUuid = data.from_uuid;
            var sharing = !!data.screen_share;
            if (fromUuid === myUuid) return;
            if (callState.groupCallId) {
                if (data.group_call_id !== callState.groupCallId) return;
                if (!callState.peerScreenSharing) callState.peerScreenSharing = new Map();
                callState.peerScreenSharing.set(fromUuid, sharing);
                var videoSlot = document.querySelector('.group-call-remote-slot[data-peer-uuid="' + fromUuid + '"]');
                if (videoSlot) videoSlot.classList.toggle('group-call-remote-slot-screen-share', sharing);
            } else if (fromUuid === callState.peerUuid) {
                callState.remoteScreenSharing = sharing;
                var panel = document.getElementById('callPanel');
                if (panel) panel.classList.toggle('call-panel-remote-screen-share', sharing);
                updateCallPanelRemoteStatus();
            }
            return;
        }

        if (type === 'call.recording.started') {
            if (data.recording_by_uuid === myUuid) return;
            var inCall = !!(callState.callId || callState.groupCallId);
            if (!inCall) return;
            var recordingByTemplate = callsL('recording_by', '%s ведёт запись');
            var label = recordingByTemplate.replace('%s', callState.groupCallId ? callsL('participant', 'Участник') : callsL('participant', 'Собеседник'));
            if (callState.groupCallId && data.recording_by_uuid && window.chatModule && typeof window.chatModule.conversations === 'function') {
                var list = window.chatModule.conversations();
                var conv = list && list.find(function(c) { return c.other_user && c.other_user.uuid === data.recording_by_uuid; });
                if (!conv && window.chatModule.contacts) {
                    var contacts = window.chatModule.contacts();
                    var contact = contacts && contacts.find(function(c) { return c.uuid === data.recording_by_uuid; });
                    if (contact) label = recordingByTemplate.replace('%s', contact.display_name || contact.username || callsL('participant', 'Участник'));
                } else if (conv && conv.other_user) {
                    label = recordingByTemplate.replace('%s', conv.other_user.display_name || conv.other_user.username || callsL('participant', 'Участник'));
                }
            } else if (!callState.groupCallId && window.chatModule && typeof window.chatModule.conversations === 'function' && callState.peerUuid === data.recording_by_uuid) {
                var list = window.chatModule.conversations();
                var c = list && list.find(function(conv) { return conv.other_user && conv.other_user.uuid === data.recording_by_uuid; });
                if (c && (c.other_user.display_name || c.other_user.username)) label = recordingByTemplate.replace('%s', c.other_user.display_name || c.other_user.username);
            }
            showRecordingBanner(label);
            return;
        }

        if (type === 'call.recording.stopped') {
            hideRecordingBanner();
            return;
        }

        if (type === 'call.converted_to_group') {
            if (!callState.callId || !callState.pc) return;
            callState.groupCallId = data.group_call_id;
            callState.conversationId = data.new_conversation_id;
            callState.participantUuids = (data.participants || []).concat(data.invited || []);
            callState.peers = new Map();
            var otherUuid = callState.peerUuid;
            if (otherUuid) {
                var videoEl = addGroupCallRemoteSlot(otherUuid);
                callState.peers.set(otherUuid, { pc: callState.pc, videoEl: videoEl });
                if (callState.remoteStream && videoEl) videoEl.srcObject = callState.remoteStream;
            }
            callState.pc = null;
            callState.remoteStream = null;
            callState.peerUuid = null;
            hideCallPanel();
            showGroupCallPanel(callState.withVideo);
            var localV = document.querySelector('#groupCallPanel .group-call-local-video');
            if (callState.localStream && localV) localV.srcObject = callState.localStream;
            if (window.websocketModule && typeof window.websocketModule.subscribe === 'function') {
                window.websocketModule.subscribe(data.new_conversation_id);
            }
            return;
        }

        if (type === 'call.group.started') {
            if (data.created_by_uuid === myUuid) return;
            if (window.chatModule && typeof window.chatModule.onGroupCallStarted === 'function') {
                window.chatModule.onGroupCallStarted(data);
            }
            return;
        }

        if (type === 'call.group.joined' && callState.groupCallId && data.group_call_id === callState.groupCallId) {
            var joinedUuid = data.user_uuid;
            if (joinedUuid === myUuid) return;
            if (callState.peers && callState.peers.has(joinedUuid)) return;
            callState.participantUuids.push(joinedUuid);
            var pc = createPeerConnectionForGroup(joinedUuid);
            callState.localStream.getTracks().forEach(function(t) { pc.addTrack(t, callState.localStream); });
            updateGroupCallAudioAvatars();
            return;
        }

        if (type === 'call.group.left' && callState.groupCallId && data.group_call_id === callState.groupCallId) {
            var leftUuid = data.user_uuid;
            var p = callState.peers && callState.peers.get(leftUuid);
            if (p && p.pc) p.pc.close();
            if (callState.peers) callState.peers.delete(leftUuid);
            callState.participantUuids = callState.participantUuids.filter(function(u) { return u !== leftUuid; });
            removeGroupCallRemoteSlot(leftUuid);
            updateGroupCallAudioAvatars();
            return;
        }

        if (type === 'call.group.guest_joined' && callState.groupCallId && data.group_call_id === callState.groupCallId) {
            var guestId = data.guest_id;
            var displayName = data.display_name || callsL('guest', 'Гость');
            var peerKey = 'guest_' + guestId;
            if (callState.peers && callState.peers.has(peerKey)) return;
            callState.guestDisplayNames = callState.guestDisplayNames || {};
            callState.guestDisplayNames[peerKey] = displayName;
            callState.participantGuestIds = callState.participantGuestIds || [];
            if (callState.participantGuestIds.indexOf(guestId) === -1) callState.participantGuestIds.push(guestId);
            if (callState.localStream) {
                var pc = createPeerConnectionForGroup(peerKey);
                callState.localStream.getTracks().forEach(function(t) { pc.addTrack(t, callState.localStream); });
                pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                    return sendSignaling(callState.conversationId, peerKey, { sdp: pc.localDescription });
                }).catch(function() {});
            }
            updateGroupCallAudioAvatars();
            return;
        }

        if (type === 'call.group.guest_left' && callState.groupCallId && data.group_call_id === callState.groupCallId) {
            var leftGuestId = data.guest_id;
            var peerKey = 'guest_' + leftGuestId;
            var p = callState.peers && callState.peers.get(peerKey);
            if (p && p.pc) p.pc.close();
            if (callState.peers) callState.peers.delete(peerKey);
            callState.participantGuestIds = (callState.participantGuestIds || []).filter(function(id) { return id !== leftGuestId; });
            if (callState.guestDisplayNames) delete callState.guestDisplayNames[peerKey];
            removeGroupCallRemoteSlot(peerKey);
            updateGroupCallAudioAvatars();
            return;
        }

        if (type === 'call.group.ended' && callState.groupCallId && data.group_call_id === callState.groupCallId) {
            var cid = callState.conversationId;
            cleanupCall();
            try {
                window.dispatchEvent(new CustomEvent('groupCallEnded', { detail: { conversation_id: cid } }));
            } catch (e) {}
            return;
        }

        if ((type === 'call.sdp' || type === 'call.ice') && callState.groupCallId && toMe) {
            var fromKey = data.from_guest_id != null ? ('guest_' + data.from_guest_id) : (data.from_uuid || '');
            if (!fromKey) return;
            var peer = callState.peers && callState.peers.get(fromKey);
            if (type === 'call.sdp' && data.sdp) {
                if (!peer || !peer.pc) {
                    if (data.sdp.type === 'offer' && callState.localStream) {
                        var pc = createPeerConnectionForGroup(fromKey);
                        callState.localStream.getTracks().forEach(function(t) { pc.addTrack(t, callState.localStream); });
                        peer = callState.peers.get(fromKey);
                        if (data.from_guest_id != null) {
                            if (!callState.participantGuestIds) callState.participantGuestIds = [];
                            if (callState.participantGuestIds.indexOf(data.from_guest_id) === -1) callState.participantGuestIds.push(data.from_guest_id);
                            if (data.display_name && callState.guestDisplayNames) callState.guestDisplayNames[fromKey] = data.display_name;
                        } else if (callState.participantUuids.indexOf(fromKey) === -1) {
                            callState.participantUuids.push(fromKey);
                        }
                    } else return;
                }
                if (peer && peer.pc) {
                    peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function() {
                        flushPeerIceBuffer(fromKey);
                        if (data.sdp.type === 'offer') {
                            return peer.pc.createAnswer().then(function(a) { return peer.pc.setLocalDescription(a); }).then(function() {
                                return sendSignaling(callState.conversationId, fromKey, { sdp: peer.pc.localDescription });
                            });
                        }
                    }).catch(function() {});
                }
            } else if (type === 'call.ice' && data.ice) {
                if (!peer || !peer.pc) {
                    if (!callState.peerIceBuffers) callState.peerIceBuffers = new Map();
                    var buf = callState.peerIceBuffers.get(fromKey);
                    if (buf) buf.push(data.ice); else callState.peerIceBuffers.set(fromKey, [data.ice]);
                    return;
                }
                var cand = data.ice;
                peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function() {
                    if (callState.peerIceBuffers) {
                        var buf = callState.peerIceBuffers.get(fromKey);
                        if (buf) buf.push(cand); else callState.peerIceBuffers.set(fromKey, [cand]);
                    }
                });
            }
            return;
        }
    }

    function getGroupCallStatus(conversationId) {
        if (!API_BASE || !conversationId) return Promise.resolve(null);
        return fetch(API_BASE + '/api/calls.php?action=group_status&conversation_id=' + conversationId, { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(res) { return res && res.success && res.data && res.data.active ? res.data : null; })
            .catch(function() { return null; });
    }

    function getActiveCallStatus(conversationId) {
        if (!API_BASE || !conversationId) return Promise.resolve(null);
        return fetch(API_BASE + '/api/calls.php?action=call_status&conversation_id=' + conversationId, { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(res) { return res && res.success && res.data && res.data.active ? res.data : null; })
            .catch(function() { return null; });
    }

    function waitForWebSocket(maxMs) {
        var limit = maxMs || 8000;
        return new Promise(function(resolve, reject) {
            if (window.websocketModule && typeof window.websocketModule.isConnected === 'function' && window.websocketModule.isConnected()) {
                resolve();
                return;
            }
            var deadline = Date.now() + limit;
            var t = setInterval(function() {
                if (window.websocketModule && typeof window.websocketModule.isConnected === 'function' && window.websocketModule.isConnected()) {
                    clearInterval(t);
                    resolve();
                    return;
                }
                if (Date.now() >= deadline) {
                    clearInterval(t);
                    reject(new Error('Нет соединения в реальном времени. Подождите несколько секунд и попробуйте снова.'));
                }
            }, 200);
        });
    }

    function showCallPanelForJoining(callId, callerUuid, conversationId, withVideo) {
        ensureCallUI();
        callState.callId = callId;
        callState.conversationId = conversationId;
        callState.peerUuid = callerUuid;
        callState.withVideo = !!withVideo;
        callState.isCaller = false;
        showCallPanel(!!withVideo);
    }

    function joinOngoingCall(callId, callerUuid, conversationId, withVideo) {
        if (!API_BASE || !callId || !callerUuid || !conversationId) return Promise.reject(new Error('Не указаны параметры звонка'));
        return init().then(function() {
            return waitForWebSocket(8000);
        }).then(function() {
            if (window.websocketModule && typeof window.websocketModule.subscribe === 'function' && conversationId) {
                window.websocketModule.subscribe(conversationId);
            }
            callState.pendingInvite = { call_id: callId, caller_uuid: callerUuid, conversation_id: conversationId, with_video: !!withVideo };
            callState.joiningOngoingCall = true;
            return apiRequest(API_BASE + '/api/calls.php?action=call_request_offer', {
                method: 'POST',
                body: JSON.stringify({ call_id: callId }),
                headers: { 'Content-Type': 'application/json' },
            });
        }).then(function() {
            return new Promise(function(resolve, reject) {
                var timeout = setTimeout(function() {
                    if (callState.joiningOngoingCall || (callState.pendingInvite && callState.pendingInvite.call_id === callId)) {
                        callState.joiningOngoingCall = false;
                        callState.pendingInvite = null;
                        reject(new Error('Время ожидания истекло. Убедитесь, что собеседник в звонке, и попробуйте ещё раз.'));
                    }
                }, 25000);
                var check = setInterval(function() {
                    if (callState.callId === callId) {
                        clearInterval(check);
                        clearTimeout(timeout);
                        resolve();
                    }
                }, 200);
            });
        }).catch(function(err) {
            callState.joiningOngoingCall = false;
            callState.pendingInvite = null;
            return Promise.reject(err);
        });
    }

    function addParticipantToCall(inviteeUuid) {
        if (!callState.callId || !inviteeUuid || !API_BASE) return Promise.reject(new Error('Нет активного звонка или не указан участник'));
        return apiRequest(API_BASE + '/api/calls.php?action=call_add_participant', {
            method: 'POST',
            body: JSON.stringify({ call_id: callState.callId, invitee_uuid: inviteeUuid }),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    function getCallInvites() {
        if (!API_BASE) return Promise.resolve([]);
        return fetch(API_BASE + '/api/calls.php?action=call_invites', { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(res) { return res && res.success && res.data && res.data.invites ? res.data.invites : []; })
            .catch(function() { return []; });
    }

    function getIncomingCallMinimized() {
        return callState.incomingCallMinimized || null;
    }

    function restoreIncomingModal() {
        var min = callState.incomingCallMinimized;
        if (!min) return false;
        showIncomingModal({
            call_id: min.call_id,
            caller_uuid: min.caller_uuid,
            conversation_id: min.conversation_id,
            with_video: min.with_video,
            caller_name: min.caller_name,
            caller_avatar: min.caller_avatar,
        });
        callState.pendingInvite = { call_id: min.call_id, caller_uuid: min.caller_uuid, conversation_id: min.conversation_id, with_video: min.with_video };
        if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
            window.chatModule.loadConversations();
        }
        return true;
    }

    function acceptCallFromMinimized() {
        var min = callState.incomingCallMinimized;
        if (!min || !min.call_id || !min.caller_uuid || min.conversation_id == null) return Promise.reject(new Error('Нет свёрнутого входящего звонка'));
        var callId = parseInt(min.call_id, 10);
        var conversationId = parseInt(min.conversation_id, 10);
        callState.incomingCallMinimized = null;
        hideIncomingModal();
        if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
            window.chatModule.loadConversations();
        }
        return Promise.resolve(acceptCall(callId, min.caller_uuid, conversationId, !!min.with_video));
    }

    window.Calls = {
        init: init,
        getConfig: function() { return callConfig; },
        getCallMode: function() { return (callConfig && callConfig.call_mode) || 'webrtc_only'; },
        isAvailable: function() { return !!callConfig && (callConfig.call_mode === 'sip' || callConfig.call_mode === 'webrtc_only'); },
        startCall: startCall,
        startGroupCall: startGroupCall,
        joinGroupCall: joinGroupCall,
        leaveGroupCall: leaveGroupCall,
        getGroupCallStatus: getGroupCallStatus,
        getActiveCallStatus: getActiveCallStatus,
        showCallPanelForJoining: showCallPanelForJoining,
        joinOngoingCall: joinOngoingCall,
        addParticipantToCall: addParticipantToCall,
        getCallInvites: getCallInvites,
        onWebSocketEvent: onWebSocketEvent,
        isInGroupCall: function() { return !!callState.groupCallId; },
        isInCall: function() { return !!(callState.callId || callState.groupCallId); },
        getIncomingCallMinimized: getIncomingCallMinimized,
        restoreIncomingModal: restoreIncomingModal,
        acceptCallFromMinimized: acceptCallFromMinimized,
        clearIncomingCallMinimized: function() { callState.incomingCallMinimized = null; },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init(); });
    } else {
        init();
    }
})();
