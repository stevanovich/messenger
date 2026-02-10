/**
 * Звонок для гостя (страница call-room.php).
 * Параметры из URL: guest_token, group_call_id, conversation_id, with_video, ws_guest_token.
 * Подключается к WebSocket по ws_guest_token, обмен SDP/ICE через API signaling_guest.
 */
(function() {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    var guestToken = params.get('guest_token') || '';
    var groupCallId = parseInt(params.get('group_call_id'), 10) || 0;
    var conversationId = parseInt(params.get('conversation_id'), 10) || 0;
    var withVideo = params.get('with_video') === '1' || params.get('with_video') === 'true';
    var wsGuestToken = params.get('ws_guest_token') || '';

    var container = document.querySelector('.call-room-container');
    var baseUrl = (container && container.dataset && container.dataset.baseUrl) || (document.body && document.body.dataset && document.body.dataset.baseUrl) || (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, ''));
    var wsUrl = (container && container.dataset && container.dataset.wsUrl) || (document.body && document.body.dataset && document.body.dataset.wsUrl) || '';

    var myGuestId = null;
    var localStream = null;
    var screenStream = null;
    var isSharingScreen = false;
    var hadVideoBeforeShare = false;
    var currentFacingMode = 'user';
    var peers = new Map();
    var peerIceBuffers = new Map();
    var peerNames = {};
    var ws = null;
    var authenticated = false;
    var callStartTime = null;
    var durationInterval = null;

    var STUN = 'stun:stun.l.google.com:19302';

    function getStunConfig() {
        return { iceServers: [{ urls: STUN }] };
    }

    function apiRequest(url, options) {
        options = options || {};
        options.credentials = options.credentials || 'include';
        return fetch(url, options).then(function(r) { return r.json(); });
    }

    function sendSignalingGuest(targetUuid, targetGuestId, payload) {
        var body = { guest_token: guestToken, group_call_id: groupCallId };
        if (targetGuestId) body.target_guest_id = targetGuestId;
        else body.target_uuid = targetUuid;
        if (payload.sdp) body.sdp = payload.sdp.type ? { type: payload.sdp.type, sdp: payload.sdp.sdp || '' } : payload.sdp;
        if (payload.ice) body.ice = payload.ice;
        return apiRequest(baseUrl + '/api/calls.php?action=signaling_guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    function sendMuteStateGuest(muted) {
        if (!groupCallId || !guestToken) return Promise.resolve();
        return apiRequest(baseUrl + '/api/calls.php?action=call_muted_guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guest_token: guestToken, group_call_id: groupCallId, muted: !!muted }),
        }).catch(function() {});
    }

    function peerKey(uuidOrGuestId, isGuest) {
        return isGuest ? ('guest_' + uuidOrGuestId) : uuidOrGuestId;
    }

    function createPeerConnection(targetKey, isGuest) {
        if (peers.has(targetKey)) return peers.get(targetKey).pc;
        var targetUuid = isGuest ? null : targetKey;
        var targetGuestId = isGuest ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
        var videoEl = document.createElement('video');
        videoEl.className = 'call-room-remote-video';
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('autoplay', '');
        var nameLabel = document.createElement('span');
        nameLabel.className = 'call-room-remote-slot-name';
        nameLabel.textContent = peerNames[targetKey] || (isGuest ? 'Гость' : 'Участник');
        var wrap = document.createElement('div');
        wrap.className = 'call-room-remote-slot';
        wrap.dataset.peerKey = targetKey;
        wrap.appendChild(videoEl);
        wrap.appendChild(nameLabel);
        var grid = document.getElementById('callRoomGrid');
        if (grid) grid.appendChild(wrap);

        var pc = new RTCPeerConnection(getStunConfig());
        pc.onicecandidate = function(ev) {
            if (ev.candidate) {
                sendSignalingGuest(targetUuid, targetGuestId || undefined, { ice: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }).catch(function() {});
            }
        };
        pc.ontrack = function(ev) {
            if (ev.streams && ev.streams[0]) {
                videoEl.srcObject = ev.streams[0];
                videoEl.play().catch(function() {});
            }
        };
        peers.set(targetKey, { pc: pc, videoEl: videoEl });
        peerIceBuffers.set(targetKey, []);
        return pc;
    }

    function removePeer(targetKey) {
        var p = peers.get(targetKey);
        if (p && p.pc) p.pc.close();
        peers.delete(targetKey);
        peerIceBuffers.delete(targetKey);
        var wrap = document.querySelector('.call-room-remote-slot[data-peer-key="' + targetKey + '"]');
        if (wrap) wrap.remove();
    }

    function flushIceBuffer(targetKey) {
        var buf = peerIceBuffers.get(targetKey);
        if (!buf || !buf.length) return;
        var p = peers.get(targetKey);
        if (!p || !p.pc) return;
        buf.forEach(function(c) {
            p.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function() {});
        });
        peerIceBuffers.set(targetKey, []);
    }

    function isDisplayMediaSupported() {
        return typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
    }

    function createOfferFor(targetKey, isGuest) {
        var pc = createPeerConnection(targetKey, isGuest);
        if (!localStream) return Promise.resolve();
        localStream.getTracks().forEach(function(t) {
            var alreadySent = pc.getSenders().some(function(s) { return s.track === t; });
            if (!alreadySent) pc.addTrack(t, localStream);
        });
        return pc.createOffer().then(function(offer) {
            return pc.setLocalDescription(offer);
        }).then(function() {
            var targetUuid = isGuest ? null : targetKey;
            var targetGuestId = isGuest ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
            return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: pc.localDescription });
        });
    }

    function renegotiateAllPeers() {
        var chain = Promise.resolve();
        peers.forEach(function(peer, targetKey) {
            if (!peer.pc || !localStream) return;
            chain = chain.then(function() {
                var isGuest = targetKey.indexOf('guest_') === 0;
                var targetUuid = isGuest ? null : targetKey;
                var targetGuestId = isGuest ? parseInt(targetKey.replace('guest_', ''), 10) : undefined;
                return peer.pc.createOffer().then(function(offer) { return peer.pc.setLocalDescription(offer); }).then(function() {
                    return sendSignalingGuest(targetUuid, targetGuestId, { sdp: peer.pc.localDescription });
                });
            });
        });
        return chain;
    }

    function startScreenShareGuest() {
        if (!isDisplayMediaSupported() || !localStream || !groupCallId) return Promise.resolve();
        if (isSharingScreen) return Promise.resolve();
        hadVideoBeforeShare = !!localStream.getVideoTracks().length;
        return navigator.mediaDevices.getDisplayMedia({ video: true }).then(function(stream) {
            screenStream = stream;
            isSharingScreen = true;
            var screenTrack = stream.getVideoTracks()[0];
            if (!screenTrack) return Promise.reject(new Error('Нет видеотрека'));
            screenTrack.onended = function() { stopScreenShareGuest(); };
            var videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                localStream.removeTrack(videoTrack);
            }
            localStream.addTrack(screenTrack);
            var localVideoEl = document.getElementById('callRoomLocalVideo');
            if (localVideoEl) { localVideoEl.srcObject = localStream; localVideoEl.play().catch(function(){}); }
            var renegotiatePromises = [];
            peers.forEach(function(peer, targetKey) {
                if (!peer.pc) return;
                var pc = peer.pc;
                var videoSender = pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
                var videoTransceiver = pc.getTransceivers && pc.getTransceivers().find(function(t) {
                    return t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
                });
                if (videoSender) {
                    renegotiatePromises.push(
                        videoSender.replaceTrack(screenTrack).then(function() {
                            var targetUuid = targetKey.indexOf('guest_') === 0 ? null : targetKey;
                            var targetGuestId = targetKey.indexOf('guest_') === 0 ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
                            return pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                                return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: pc.localDescription });
                            });
                        })
                    );
                } else if (videoTransceiver && videoTransceiver.sender) {
                    renegotiatePromises.push(
                        videoTransceiver.sender.replaceTrack(screenTrack).then(function() {
                            var targetUuid = targetKey.indexOf('guest_') === 0 ? null : targetKey;
                            var targetGuestId = targetKey.indexOf('guest_') === 0 ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
                            return pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                                return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: pc.localDescription });
                            });
                        })
                    );
                } else {
                    pc.addTrack(screenTrack, localStream);
                    var targetUuid = targetKey.indexOf('guest_') === 0 ? null : targetKey;
                    var targetGuestId = targetKey.indexOf('guest_') === 0 ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
                    renegotiatePromises.push(
                        pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                            return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: pc.localDescription });
                        })
                    );
                }
            });
            updateScreenShareButtonGuest();
            return Promise.all(renegotiatePromises);
        }).catch(function(err) {
            if (screenStream) {
                screenStream.getTracks().forEach(function(t) { t.stop(); });
                screenStream = null;
            }
            isSharingScreen = false;
            if (err && err.name !== 'NotAllowedError') console.error('startScreenShareGuest:', err);
        });
    }

    function stopScreenShareGuest() {
        if (!localStream || !groupCallId) return Promise.resolve();
        if (!isSharingScreen) return Promise.resolve();
        if (screenStream) {
            screenStream.getTracks().forEach(function(t) { t.stop(); });
            screenStream = null;
        }
        isSharingScreen = false;
        var screenTrack = localStream.getVideoTracks()[0];
        if (screenTrack) localStream.removeTrack(screenTrack);
        var localVideoEl = document.getElementById('callRoomLocalVideo');
        if (localVideoEl) localVideoEl.srcObject = null;
        updateScreenShareButtonGuest();
        var renegotiatePromises = [];
        peers.forEach(function(peer, targetKey) {
            if (!peer.pc) return;
            var pc = peer.pc;
            var sender = pc.getSenders().find(function(s) { return s.track && s.track.kind === 'video'; });
            if (sender) {
                pc.removeTrack(sender);
                var targetUuid = targetKey.indexOf('guest_') === 0 ? null : targetKey;
                var targetGuestId = targetKey.indexOf('guest_') === 0 ? parseInt(targetKey.replace('guest_', ''), 10) : 0;
                renegotiatePromises.push(
                    pc.createOffer().then(function(offer) { return pc.setLocalDescription(offer); }).then(function() {
                        return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: pc.localDescription });
                    })
                );
            }
        });
        return Promise.all(renegotiatePromises).then(function() {
            if (hadVideoBeforeShare) {
                return navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } }).then(function(videoStream) {
                    var videoTrack = videoStream.getVideoTracks()[0];
                    if (!videoTrack) return;
                    localStream.addTrack(videoTrack);
                    if (localVideoEl) { localVideoEl.srcObject = localStream; localVideoEl.play().catch(function(){}); }
                    var replacePromises = [];
                    peers.forEach(function(p, targetKey) {
                        if (!p.pc) return;
                        var pc = p.pc;
                        var videoTransceiver = pc.getTransceivers && pc.getTransceivers().find(function(t) {
                            return t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
                        });
                        if (videoTransceiver && videoTransceiver.sender) {
                            replacePromises.push(
                                videoTransceiver.sender.replaceTrack(videoTrack)
                            );
                        } else {
                            pc.addTrack(videoTrack, localStream);
                        }
                    });
                    return Promise.all(replacePromises).then(function() {
                        return renegotiateAllPeers();
                    });
                });
            }
        }).catch(function(err) { console.error('stopScreenShareGuest:', err); });
    }

    function updateScreenShareButtonGuest() {
        var btn = document.getElementById('callRoomShareScreen');
        if (!btn) return;
        btn.classList.toggle('btn-call-off', !!isSharingScreen);
        btn.title = isSharingScreen ? 'Остановить демонстрацию экрана' : 'Поделиться экраном';
        btn.setAttribute('aria-label', isSharingScreen ? 'Остановить демонстрацию' : 'Поделиться экраном');
    }

    function formatDuration(ms) {
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function startDurationTimer() {
        var durEl = document.getElementById('callRoomDuration');
        if (!durEl) return;
        function tick() {
            if (!callStartTime) return;
            durEl.textContent = formatDuration(Date.now() - callStartTime);
        }
        tick();
        durationInterval = setInterval(tick, 1000);
    }

    function stopDurationTimer() {
        if (durationInterval) {
            clearInterval(durationInterval);
            durationInterval = null;
        }
    }

    function connectWs() {
        if (!wsUrl || !wsGuestToken) return Promise.reject(new Error('Нет WebSocket URL или токена'));
        return new Promise(function(resolve, reject) {
            ws = new WebSocket(wsUrl);
            ws.onopen = function() {
                ws.send(JSON.stringify({ type: 'auth', token: wsGuestToken }));
            };
            ws.onmessage = function(ev) {
                var msg = null;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                var type = msg.type, data = msg.data || msg;
                if (type === 'auth_ok') {
                    authenticated = true;
                    myGuestId = data.guest_id;
                    resolve();
                    return;
                }
                if (type === 'auth_error') {
                    reject(new Error(data.message || 'Ошибка авторизации'));
                    return;
                }
                if (type === 'call.group.ended' && data.group_call_id === groupCallId) {
                    document.getElementById('callRoomStatus').textContent = 'Звонок завершён.';
                    setTimeout(function() { window.location.href = baseUrl + '/'; }, 2000);
                    return;
                }
                if (type === 'call.group.left' && data.group_call_id === groupCallId) {
                    var key = data.user_uuid;
                    if (key) removePeer(key);
                    return;
                }
                if (type === 'call.group.guest_left' && data.group_call_id === groupCallId) {
                    var gkey = 'guest_' + data.guest_id;
                    removePeer(gkey);
                    return;
                }
                if (type === 'call.group.joined' && data.group_call_id === groupCallId) {
                    var joinedUuid = data.user_uuid;
                    if (joinedUuid) createOfferFor(joinedUuid, false).catch(function() {});
                    return;
                }
                if (type === 'call.group.guest_joined' && data.group_call_id === groupCallId) {
                    var gid = data.guest_id;
                    if (data.display_name) peerNames['guest_' + gid] = data.display_name;
                    if (gid !== myGuestId) createOfferFor('guest_' + gid, true).catch(function() {});
                    return;
                }
                if (type === 'call.sdp' && data.to_guest_id === myGuestId && data.sdp) {
                    var fromKey = data.from_guest_id != null ? ('guest_' + data.from_guest_id) : (data.from_uuid || '');
                    if (!fromKey) return;
                    var isGuest = data.from_guest_id != null;
                    var peer = peers.get(fromKey);
                    if (!peer || !peer.pc) {
                        createPeerConnection(fromKey, isGuest);
                        peer = peers.get(fromKey);
                    }
                    if (!peer || !peer.pc) return;
                    if (localStream && data.sdp.type === 'offer') {
                        try {
                            localStream.getTracks().forEach(function(t) {
                                var alreadySent = peer.pc.getSenders().some(function(s) { return s.track === t; });
                                if (!alreadySent) peer.pc.addTrack(t, localStream);
                            });
                        } catch (e) {}
                    }
                    peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function() {
                        flushIceBuffer(fromKey);
                        if (data.sdp.type === 'offer') {
                            return peer.pc.createAnswer().then(function(a) { return peer.pc.setLocalDescription(a); }).then(function() {
                                var targetUuid = isGuest ? null : fromKey;
                                var targetGuestId = isGuest ? data.from_guest_id : 0;
                                return sendSignalingGuest(targetUuid, targetGuestId || undefined, { sdp: peer.pc.localDescription });
                            });
                        }
                    }).catch(function() {});
                    return;
                }
                if (type === 'call.ice' && data.to_guest_id === myGuestId && data.ice) {
                    var fromKey = data.from_guest_id != null ? ('guest_' + data.from_guest_id) : (data.from_uuid || '');
                    if (!fromKey) return;
                    var peer = peers.get(fromKey);
                    if (peer && peer.pc) {
                        peer.pc.addIceCandidate(new RTCIceCandidate(data.ice)).catch(function() {
                            var buf = peerIceBuffers.get(fromKey);
                            if (buf) buf.push(data.ice); else peerIceBuffers.set(fromKey, [data.ice]);
                        });
                    } else {
                        var b = peerIceBuffers.get(fromKey);
                        if (b) b.push(data.ice); else peerIceBuffers.set(fromKey, [data.ice]);
                    }
                }
            };
            ws.onerror = function() { reject(new Error('WebSocket ошибка')); };
            ws.onclose = function() {
                if (!authenticated) reject(new Error('Соединение закрыто'));
            };
        });
    }

    function run() {
        if (!guestToken || !groupCallId) return;
        var statusEl = document.getElementById('callRoomStatus');
        var gridEl = document.getElementById('callRoomGrid');
        var localVideoEl = document.getElementById('callRoomLocalVideo');
        var leaveBtn = document.getElementById('callRoomLeaveBtn');
        var muteBtn = document.getElementById('callRoomMute');

        statusEl.textContent = 'Подключение…';

        connectWs().then(function() {
            return apiRequest(baseUrl + '/api/calls.php?action=group_status_guest&guest_token=' + encodeURIComponent(guestToken) + '&group_call_id=' + groupCallId);
        }).then(function(res) {
            if (!res || !res.success || !res.data) throw new Error('Не удалось загрузить участников');
            var data = res.data;
            (data.participants || []).forEach(function(p) {
                if (p.user_uuid) peerNames[p.user_uuid] = p.display_name || 'Участник';
            });
            (data.guests || []).forEach(function(g) {
                if (g.id) peerNames['guest_' + g.id] = g.display_name || 'Гость';
            });
            statusEl.textContent = 'Вы в звонке.';
            callStartTime = Date.now();
            startDurationTimer();
            setTimeout(function() {
                if (statusEl.textContent === 'Вы в звонке.') statusEl.style.visibility = 'hidden';
            }, 2000);
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }).then(function(stream) {
            localStream = stream;
            stream.getAudioTracks().forEach(function(t) { t.enabled = false; });
            if (muteBtn) muteBtn.classList.add('btn-call-off');
            sendMuteStateGuest(true);
            if (localVideoEl) {
                localVideoEl.srcObject = stream;
                localVideoEl.muted = true;
                localVideoEl.play().catch(function() {});
            }
            return apiRequest(baseUrl + '/api/calls.php?action=group_status_guest&guest_token=' + encodeURIComponent(guestToken) + '&group_call_id=' + groupCallId);
        }).then(function(res) {
            if (!res || !res.success || !res.data) return;
            var data = res.data;
            var chain = Promise.resolve();
            (data.participants || []).forEach(function(p) {
                var uuid = p.user_uuid;
                if (uuid) chain = chain.then(function() { return createOfferFor(uuid, false); });
            });
            (data.guests || []).forEach(function(g) {
                if (g.id !== myGuestId) chain = chain.then(function() { return createOfferFor('guest_' + g.id, true); });
            });
            return chain.then(function() {
                updateScreenShareButtonGuest();
                var videoBtn = document.getElementById('callRoomVideo');
                var switchCameraBtn = document.getElementById('callRoomSwitchCamera');
                if (videoBtn && withVideo) {
                    videoBtn.style.display = 'inline-flex';
                    if (switchCameraBtn) switchCameraBtn.style.display = 'inline-flex';
                    videoBtn.addEventListener('click', function() {
                        if (!localStream) return;
                        var vt = localStream.getVideoTracks()[0];
                        if (vt) {
                            vt.enabled = !vt.enabled;
                            videoBtn.classList.toggle('btn-call-off', !vt.enabled);
                            if (localVideoEl) { localVideoEl.srcObject = localStream; localVideoEl.play().catch(function(){}); }
                            renegotiateAllPeers();
                        } else {
                            navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } }).then(function(vStream) {
                                var track = vStream.getVideoTracks()[0];
                                if (!track) return;
                                localStream.addTrack(track);
                                if (localVideoEl) { localVideoEl.srcObject = localStream; localVideoEl.play().catch(function(){}); }
                                videoBtn.classList.remove('btn-call-off');
                                var replacePromises = [];
                                peers.forEach(function(peer, targetKey) {
                                    if (!peer.pc) return;
                                    var pc = peer.pc;
                                    var videoTransceiver = pc.getTransceivers && pc.getTransceivers().find(function(t) {
                                        return t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
                                    });
                                    if (videoTransceiver && videoTransceiver.sender) {
                                        replacePromises.push(videoTransceiver.sender.replaceTrack(track));
                                    } else {
                                        pc.addTrack(track, localStream);
                                    }
                                });
                                Promise.all(replacePromises).then(function() { renegotiateAllPeers(); }).catch(function() { renegotiateAllPeers(); });
                            }).catch(function() {});
                        }
                    });
                }
                if (switchCameraBtn && withVideo) {
                    switchCameraBtn.addEventListener('click', function() {
                        if (!localStream || isSharingScreen) return;
                        var vt = localStream.getVideoTracks()[0];
                        if (!vt) return;
                        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
                        navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } }).then(function(vStream) {
                            var newTrack = vStream.getVideoTracks()[0];
                            if (!newTrack) return;
                            vt.stop();
                            localStream.removeTrack(vt);
                            localStream.addTrack(newTrack);
                            if (localVideoEl) { localVideoEl.srcObject = localStream; localVideoEl.play().catch(function(){}); }
                            var replacePromises = [];
                            peers.forEach(function(peer) {
                                if (!peer.pc) return;
                                var pc = peer.pc;
                                var videoTransceiver = pc.getTransceivers && pc.getTransceivers().find(function(t) {
                                    return t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
                                });
                                if (videoTransceiver && videoTransceiver.sender) {
                                    replacePromises.push(videoTransceiver.sender.replaceTrack(newTrack));
                                }
                            });
                            Promise.all(replacePromises).then(function() { renegotiateAllPeers(); }).catch(function() { renegotiateAllPeers(); });
                        }).catch(function() {});
                    });
                }
            });
        }).catch(function(err) {
            statusEl.textContent = (err && err.message) || 'Ошибка подключения';
        });

        if (leaveBtn) {
            leaveBtn.addEventListener('click', function() {
                leaveBtn.disabled = true;
                stopDurationTimer();
                if (screenStream) screenStream.getTracks().forEach(function(t) { t.stop(); });
                if (localStream) localStream.getTracks().forEach(function(t) { t.stop(); });
                peers.forEach(function(p) { if (p.pc) p.pc.close(); });
                if (ws) ws.close();
                apiRequest(baseUrl + '/api/calls.php?action=group_leave_guest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guest_token: guestToken }),
                }).then(function() {
                    window.location.href = baseUrl + '/';
                }).catch(function() {
                    window.location.href = baseUrl + '/';
                });
            });
        }

        if (muteBtn) {
            muteBtn.addEventListener('click', function() {
                if (!localStream) return;
                var t = localStream.getAudioTracks()[0];
                if (t) {
                    t.enabled = !t.enabled;
                    muteBtn.classList.toggle('btn-call-off', !t.enabled);
                    sendMuteStateGuest(!t.enabled);
                }
            });
        }

        var shareScreenBtn = document.getElementById('callRoomShareScreen');
        if (shareScreenBtn) {
            shareScreenBtn.style.display = isDisplayMediaSupported() ? 'inline-flex' : 'none';
            shareScreenBtn.addEventListener('click', function() {
                if (!localStream) return;
                if (isSharingScreen) stopScreenShareGuest(); else startScreenShareGuest();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
