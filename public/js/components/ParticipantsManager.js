'use strict';

/**
 * ParticipantsManager
 *
 * Manages all participant/peer-related functionality: participant list rendering,
 * peer actions (mute/hide/ban/eject), peer info updates, participant search/filter,
 * moderation controls, geolocation, and participant count tracking.
 * Extracted from RoomClient.js and Room.js participant-related methods.
 */
class ParticipantsManager {
    /**
     * @param {Object} eventBus - Application event bus for cross-component communication
     * @param {Object} roomState - Shared room state object
     * @param {Object} domCache - DOM element cache with get(id) method
     */
    constructor(eventBus, roomState, domCache) {
        this.eventBus = eventBus;
        this.roomState = roomState;
        this.dom = domCache;

        this.socketManager = null;
        this.rc = null;
        this.socket = null;

        // Participant state
        this.participantsCount = 0;
        this.isParticipantsListOpen = false;
        this.isToggleRaiseHand = false;
        this.isToggleUnreadMsg = false;
        this.isParticipantsOpen = false;

        // Moderator state
        this._moderator = {
            audio_cant_unmute: false,
            video_cant_unhide: false,
            screen_cant_share: false,
            chat_cant_privately: false,
            chat_cant_chatgpt: false,
            chat_cant_deep_seek: false,
            media_cant_sharing: false,
        };

        // Bound socket handlers
        this._handleRefreshParticipantsCount = null;
        this._handlePeerAction = null;
        this._handleUpdatePeerInfo = null;
        this._handleUpdateRoomModerator = null;
        this._handleUpdateRoomModeratorALL = null;
    }

    /**
     * Initialize the manager with socket and RoomClient references.
     * @param {Object} socketManager - Socket manager or raw socket
     * @param {Object} rc - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.socketManager = socketManager;
        this.rc = rc;
        this.socket = socketManager.socket || socketManager;

        this._bindSocketEvents();
    }

    // ####################################################
    // SOCKET EVENT BINDINGS
    // ####################################################

    _bindSocketEvents() {
        this._handleRefreshParticipantsCount = (data) => {
            console.log('ParticipantsManager: SocketOn Participants Count:', data);
            this.participantsCount = data.peer_counts;
            this.rc.participantsCount = this.participantsCount;
            if (this.roomState.isBroadcastingEnabled) {
                if (this.isParticipantsListOpen) this.getRoomParticipants();
                if (typeof wbUpdate === 'function') wbUpdate();
                if (this.rc && typeof this.rc.editorUpdate === 'function') this.rc.editorUpdate();
            } else {
                if (typeof adaptAspectRatio === 'function') adaptAspectRatio(this.participantsCount);
            }
        };

        this._handlePeerAction = (data) => {
            console.log('ParticipantsManager: SocketOn Peer action:', data);
            this.peerAction(data.from_peer_name, data.peer_id, data.action, false, data.broadcast, true, data.message);
        };

        this._handleUpdatePeerInfo = (data) => {
            console.log('ParticipantsManager: SocketOn Peer info update:', data);
            this.updatePeerInfo(data.peer_name, data.peer_id, data.type, data.status, false, data.peer_presenter);
        };

        this._handleUpdateRoomModerator = (data) => {
            console.log('ParticipantsManager: SocketOn Update Room Moderator:', data);
            this.handleUpdateRoomModerator(data);
        };

        this._handleUpdateRoomModeratorALL = (data) => {
            console.log('ParticipantsManager: SocketOn Update Room Moderator ALL:', data);
            this.handleUpdateRoomModeratorALL(data);
        };

        this.socket.on('refreshParticipantsCount', this._handleRefreshParticipantsCount);
        this.socket.on('peerAction', this._handlePeerAction);
        this.socket.on('updatePeerInfo', this._handleUpdatePeerInfo);
        this.socket.on('updateRoomModerator', this._handleUpdateRoomModerator);
        this.socket.on('updateRoomModeratorALL', this._handleUpdateRoomModeratorALL);
    }

    // ####################################################
    // PARTICIPANT COUNT
    // ####################################################

    refreshParticipantsCount(count, adapt = true) {
        this.participantsCount = count;
        if (adapt && typeof adaptAspectRatio === 'function') {
            adaptAspectRatio(count);
        }
    }

    emitRefreshParticipantsCount() {
        this.socket.emit('refreshParticipantsCount');
    }

    thereAreParticipants() {
        return (this.rc && this.rc.consumers && this.rc.consumers.size > 0) || this.participantsCount > 1;
    }

    // ####################################################
    // ROOM PARTICIPANTS LIST (from Room.js)
    // ####################################################

    async getRoomParticipants() {
        const peers = await this._getRoomPeers();
        const lists = this.getParticipantsList(peers);
        this.participantsCount = peers.size;

        const participantsList = this.dom.get('participantsList');
        if (participantsList) {
            participantsList.innerHTML = lists;
            this._handleDropdownHover(participantsList.querySelectorAll('.dropdown'));
        }

        this.refreshParticipantsCount(this.participantsCount, false);
        this.setParticipantsTippy(peers);
        console.log('*** Refresh Chat participant lists ***');
    }

    async _getRoomPeers() {
        if (this.rc && typeof this.rc.socket !== 'undefined') {
            return await this.rc.socket.request('getRoomPeers');
        }
        return await this.socket.request('getRoomPeers');
    }

    async saveRoomPeers() {
        const peers = await this._getRoomPeers();
        let peersToSave = [];
        for (let peer of Array.from(peers.keys())) {
            peersToSave.push(peers.get(peer).peer_info);
        }
        if (typeof saveObjToJsonFile === 'function') {
            saveObjToJsonFile(peersToSave, 'PARTICIPANTS');
        }
    }

    async getRemotePeerInfo(peer_id) {
        const peers = await this._getRoomPeers();
        for (let peer of Array.from(peers.keys())) {
            const peer_info = peers.get(peer).peer_info;
            if (peer_id === peer_info.peer_id) {
                return peer_info;
            }
        }
        return null;
    }

    getParticipantsList(peers) {
        let li = '';
        const rc = this.rc;
        const socketId = this.socket.id;
        const isRulesActive = this.roomState.isRulesActive;
        const isPresenter = this.roomState.isPresenter;
        const isBroadcastingEnabled = this.roomState.isBroadcastingEnabled;
        const BUTTONS = this.roomState.BUTTONS || (typeof window !== 'undefined' ? window.BUTTONS : {});
        const _PEER = this.roomState._PEER || (typeof window !== 'undefined' ? window._PEER : {});
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});

        const chatGPT = BUTTONS.chat && BUTTONS.chat.chatGPT !== undefined ? BUTTONS.chat.chatGPT : true;

        // CHAT-GPT
        if (chatGPT) {
            const chatgpt_active = rc.chatPeerName === 'ChatGPT' ? ' active' : '';
            li = `
            <li
                id="ChatGPT"
                data-to-id="ChatGPT"
                data-to-name="ChatGPT"
                class="clearfix${chatgpt_active}"
                onclick="rc.showPeerAboutAndMessages(this.id, 'ChatGPT', '', event)"
            >
                <img
                    src="${image.chatgpt}"
                    alt="avatar"
                />
                <div class="about">
                    <div class="name">ChatGPT</div>
                    <div class="status"><i class="fa fa-circle online"></i> online</div>
                </div>
            </li>`;
        }

        const deepSeek = BUTTONS.chat && BUTTONS.chat.deepSeek !== undefined ? BUTTONS.chat.deepSeek : true;

        // DEEP-SEEK
        if (deepSeek) {
            const deepSeek_active = rc.chatPeerName === 'DeepSeek' ? ' active' : '';
            li += `
            <li
                id="DeepSeek"
                data-to-id="DeepSeek"
                data-to-name="DeepSeek"
                class="clearfix${deepSeek_active}"
                onclick="rc.showPeerAboutAndMessages(this.id, 'DeepSeek', '', event)"
            >
                <img
                    src="${image.deepSeek}"
                    alt="avatar"
                />
                <div class="about">
                    <div class="name">DeepSeek</div>
                    <div class="status"><i class="fa fa-circle online"></i> online</div>
                </div>
            </li>`;
        }

        const public_chat_active = rc.chatPeerName === 'all' ? ' active' : '';

        // ALL (Public chat)
        li += `
        <li id="all"
            data-to-id="all"
            data-to-name="all"
            class="clearfix${public_chat_active}"
            onclick="rc.showPeerAboutAndMessages(this.id, 'all', '', event)"
        >
            <img
                src="${image.all}"
                alt="avatar"
            />
            <div class="about">
                <div class="name">Public chat</div>
                <div class="status"> <i class="fa fa-circle online"></i> online ${this.participantsCount} <span id="all-unread-count" class="unread-count hidden"></span></div>
            </div>`;

        // ONLY PRESENTER CAN EXECUTE THIS CMD
        if (!isRulesActive || isPresenter) {
            li += `
            <div class="dropdown">
                <button
                    class="dropdown-toggle"
                    type="button"
                    id="${socketId}-chatDropDownMenu"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    style="float: right"
                >
                <i class="fas fa-bars"></i>
                </button>
                <ul class="dropdown-menu text-start" aria-labelledby="${socketId}-chatDropDownMenu">`;

            li += `<li><button class="ml5" id="muteAllParticipantsButton" onclick="rc.peerAction('me','${socketId}','mute',true,true)">${_PEER.audioOff} Mute all participants</button></li>`;
            li += `<li><button class="ml5" id="hideAllParticipantsButton" onclick="rc.peerAction('me','${socketId}','hide',true,true)">${_PEER.videoOff} Hide all participants</button></li>`;
            li += `<li><button class="ml5" id="stopAllParticipantsButton" onclick="rc.peerAction('me','${socketId}','stop',true,true)">${_PEER.screenOff} Stop all screens sharing</button></li>`;

            if (BUTTONS.participantsList && BUTTONS.participantsList.sendFileAllButton) {
                li += `<li><button class="btn-sm ml5" id="sendAllButton" onclick="rc.selectFileToShare('${socketId}', true)">${_PEER.sendFile} Share file to all</button></li>`;
            }

            li += `<li><button class="btn-sm ml5" id="sendVideoToAll" onclick="rc.shareVideo('all');">${_PEER.sendVideo} Share audio/video to all</button></li>`;

            if (BUTTONS.participantsList && BUTTONS.participantsList.ejectAllButton) {
                li += `<li><button class="btn-sm ml5" id="ejectAllButton" onclick="rc.peerAction('me','${socketId}','eject',true,true)">${_PEER.ejectPeer} Eject all participants</button></li>`;
            }

            li += `</ul>
            </div>

            <br/>

            <div class="about-buttons mt5">
                <button class="ml5" id="muteAllButton" onclick="rc.peerAction('me','${socketId}','mute',true,true)">${_PEER.audioOff}</button>
                <button class="ml5" id="hideAllButton" onclick="rc.peerAction('me','${socketId}','hide',true,true)">${_PEER.videoOff}</button>
                <button class="ml5" id="stopAllButton" onclick="rc.peerAction('me','${socketId}','stop',true,true)">${_PEER.screenOff}</button>
            </div>`;
        }

        li += `
        </li>
        `;

        // PEERS IN THE CURRENT ROOM
        for (const peer of Array.from(peers.keys())) {
            const peer_info = peers.get(peer).peer_info;
            console.log('PEER-INFO------->', peer_info);
            const peer_name = peer_info.peer_name;
            const peer_avatar = peer_info.peer_avatar;
            const peer_name_limited = peer_name.length > 15 ? peer_name.substring(0, 10) + '*****' : peer_name;
            const peer_audio = peer_info.peer_audio ? _PEER.audioOn : _PEER.audioOff;
            const peer_video = peer_info.peer_video ? _PEER.videoOn : _PEER.videoOff;
            const peer_screen = peer_info.peer_screen ? _PEER.screenOn : _PEER.screenOff;
            const peer_hand = peer_info.peer_hand ? _PEER.raiseHand : _PEER.lowerHand;
            const peer_ban = _PEER.banPeer;
            const peer_eject = _PEER.ejectPeer;
            const peer_geoLocation = _PEER.geoLocation;
            const peer_sendFile = _PEER.sendFile;
            const peer_id = peer_info.peer_id;
            const avatarImg = this.getParticipantAvatar(peer_name, peer_avatar);

            const peer_chat_active = rc.chatPeerId === peer_id ? ' active' : '';

            // NOT ME
            if (socketId !== peer_id) {
                if (isRulesActive && isPresenter) {
                    li += this._buildPresenterPeerItem(
                        peer_id, peer_name, peer_name_limited, peer_avatar, avatarImg,
                        peer_audio, peer_video, peer_screen, peer_hand, peer_ban, peer_eject,
                        peer_geoLocation, peer_sendFile, peer_chat_active, peer_info, BUTTONS, _PEER
                    );
                } else {
                    li += this._buildGuestPeerItem(
                        peer_id, peer_name, peer_name_limited, peer_avatar, avatarImg,
                        peer_audio, peer_video, peer_screen, peer_hand, peer_sendFile,
                        peer_chat_active, peer_info, isBroadcastingEnabled, BUTTONS, _PEER
                    );
                }
            }
        }
        return li;
    }

    _buildPresenterPeerItem(
        peer_id, peer_name, peer_name_limited, peer_avatar, avatarImg,
        peer_audio, peer_video, peer_screen, peer_hand, peer_ban, peer_eject,
        peer_geoLocation, peer_sendFile, peer_chat_active, peer_info, BUTTONS, _PEER
    ) {
        let li = `
        <li
            id='${peer_id}'
            data-to-id="${peer_id}"
            data-to-name="${peer_name}"
            class="clearfix${peer_chat_active}"
            onclick="rc.showPeerAboutAndMessages(this.id, '${peer_name}', '${peer_avatar}', event)"
        >
            <img
                src="${avatarImg}"
                alt="avatar"
            />
            <div class="about">
                <div class="name">${peer_name_limited}</div>
                <div class="status"> <i class="fa fa-circle online"></i> online <i id="${peer_id}-unread-msg" class="fas fa-comments hidden"></i> <span id="${peer_id}-unread-count" class="unread-count hidden"></span> </div>
            </div>

            <div class="dropdown">
                <button
                    class="dropdown-toggle"
                    type="button"
                    id="${peer_id}-chatDropDownMenu"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    style="float: right"
                >
                <i class="fas fa-bars"></i>
                </button>
                <ul class="dropdown-menu text-start" aria-labelledby="${peer_id}-chatDropDownMenu">`;

        li += `<li><button class="ml5" id='${peer_id}___pAudioMute' onclick="rc.peerAction('me',this.id,'mute')">${_PEER.audioOn} Toggle audio</button></li>`;
        li += `<li><button class="ml5" id='${peer_id}___pVideoHide' onclick="rc.peerAction('me',this.id,'hide')">${_PEER.videoOn} Toggle video</button></li>`;
        li += `<li><button class="ml5" id='${peer_id}___pScreenStop' onclick="rc.peerAction('me',this.id,'stop')">${_PEER.screenOn} Toggle screen</button></li>`;

        if (BUTTONS.participantsList && BUTTONS.participantsList.sendFileButton) {
            li += `<li><button class="btn-sm ml5" id='${peer_id}___shareFile' onclick="rc.selectFileToShare('${peer_id}', false)">${peer_sendFile} Share file</button></li>`;
        }

        li += `<li><button class="btn-sm ml5" id="${peer_id}___sendVideoTo" onclick="rc.shareVideo('${peer_id}');">${_PEER.sendVideo} Share audio/video</button></li>`;

        if (BUTTONS.participantsList && BUTTONS.participantsList.geoLocationButton) {
            li += `<li><button class="btn-sm ml5" id='${peer_id}___geoLocation' onclick="rc.askPeerGeoLocation(this.id)">${peer_geoLocation} Get geolocation</button></li>`;
        }
        if (BUTTONS.participantsList && BUTTONS.participantsList.banButton) {
            li += `<li><button class="btn-sm ml5" id='${peer_id}___pBan' onclick="rc.peerAction('me',this.id,'ban')">${peer_ban} Ban participant</button></li>`;
        }
        if (BUTTONS.participantsList && BUTTONS.participantsList.ejectButton) {
            li += `<li><button class="btn-sm ml5" id='${peer_id}___pEject' onclick="rc.peerAction('me',this.id,'eject')">${peer_eject} Eject participant</button></li>`;
        }

        li += `</ul>
            </div>

            <br/>

            <div class="about-buttons mt5">
                <button class="ml5" id='${peer_id}___pAudio' onclick="rc.peerAction('me',this.id,'mute')">${peer_audio}</button>
                <button class="ml5" id='${peer_id}___pVideo' onclick="rc.peerAction('me',this.id,'hide')">${peer_video}</button>
                <button class="ml5" id='${peer_id}___pScreen' onclick="rc.peerAction('me',this.id,'stop')">${peer_screen}</button>
        `;

        if (peer_info.peer_hand) {
            li += `
                <button class="ml5" >${peer_hand}</button>`;
        }

        li += `
            </div>
        </li>
        `;

        return li;
    }

    _buildGuestPeerItem(
        peer_id, peer_name, peer_name_limited, peer_avatar, avatarImg,
        peer_audio, peer_video, peer_screen, peer_hand, peer_sendFile,
        peer_chat_active, peer_info, isBroadcastingEnabled, BUTTONS, _PEER
    ) {
        let li = `
        <li
            id='${peer_id}'
            data-to-id="${peer_id}"
            data-to-name="${peer_name}"
            class="clearfix${peer_chat_active}"
            onclick="rc.showPeerAboutAndMessages(this.id, '${peer_name}', '${peer_avatar}', event)"
        >
        <img
            src="${avatarImg}"
            alt="avatar"
        />
            <div class="about">
                <div class="name">${peer_name_limited}</div>
                <div class="status"> <i class="fa fa-circle online"></i> online <i id="${peer_id}-unread-msg" class="fas fa-comments hidden"></i> <span id="${peer_id}-unread-count" class="unread-count hidden"></span> </div>
            </div>
        `;

        // NO ROOM BROADCASTING
        if (!isBroadcastingEnabled) {
            li += `
            <div class="dropdown">
                <button
                    class="dropdown-toggle"
                    type="button"
                    id="${peer_id}-chatDropDownMenu"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    style="float: right"
                >
                <i class="fas fa-bars"></i>
                </button>
                <ul class="dropdown-menu text-start" aria-labelledby="${peer_id}-chatDropDownMenu">`;

            if (BUTTONS.participantsList && BUTTONS.participantsList.sendFileButton) {
                li += `<li><button class="btn-sm ml5" id='${peer_id}___shareFile' onclick="rc.selectFileToShare('${peer_id}', false)">${peer_sendFile} Share file</button></li>`;
            }

            li += `<li><button class="btn-sm ml5" id="${peer_id}___sendVideoTo" onclick="rc.shareVideo('${peer_id}');">${_PEER.sendVideo} Share Audio/Video</button></li>
                </ul>
            </div>
            `;
        }

        li += `
            <br/>

            <div class="about-buttons mt5">
                <button class="ml5" id='${peer_id}___pAudio' onclick="rc.peerGuestNotAllowed('audio')">${peer_audio}</button>
                <button class="ml5" id='${peer_id}___pVideo' onclick="rc.peerGuestNotAllowed('video')">${peer_video}</button>
                <button class="ml5" id='${peer_id}___pScreen' onclick="rc.peerGuestNotAllowed('screen')">${peer_screen}</button>
                `;

        if (peer_info.peer_hand) {
            li += `
                <button class="ml5" >${peer_hand}</button>`;
        }

        li += `
            </div>
        </li>
        `;

        return li;
    }

    // ####################################################
    // PARTICIPANT TOOLTIPS
    // ####################################################

    setParticipantsTippy(peers) {
        const isMobileDevice = this.roomState.isMobileDevice;
        if (isMobileDevice) return;

        if (typeof setTippy === 'function') {
            setTippy('muteAllButton', 'Mute all participants', 'top');
            setTippy('hideAllButton', 'Hide all participants', 'top');
            setTippy('stopAllButton', 'Stop screen share to all participants', 'top');
        }

        for (let peer of Array.from(peers.keys())) {
            const peer_info = peers.get(peer).peer_info;
            const peer_id = peer_info.peer_id;

            const peerAudioBtn = this.rc.getId(peer_id + '___pAudio');
            const peerVideoBtn = this.rc.getId(peer_id + '___pVideo');
            const peerScreenBtn = this.rc.getId(peer_id + '___pScreen');

            if (typeof setTippy === 'function') {
                if (peerAudioBtn) setTippy(peerAudioBtn.id, 'Mute', 'top');
                if (peerVideoBtn) setTippy(peerVideoBtn.id, 'Hide', 'top');
                if (peerScreenBtn) setTippy(peerScreenBtn.id, 'Stop', 'top');
            }
        }
    }

    // ####################################################
    // PARTICIPANT AVATAR
    // ####################################################

    getParticipantAvatar(peerName, peerAvatar = false) {
        if (peerAvatar && this.rc.isImageURL(peerAvatar)) {
            return peerAvatar;
        }
        if (this.rc.isValidEmail(peerName)) {
            return this.rc.genGravatar(peerName);
        }
        return this.rc.genAvatarSvg(peerName, 32);
    }

    // ####################################################
    // PEER ACTIONS (from RoomClient.js)
    // ####################################################

    async peerAction(from_peer_name, id, action, emit = true, broadcast = false, info = true, msg = '') {
        const words = id.split('___');
        const peer_id = words[0];
        const rc = this.rc;
        const isRulesActive = this.roomState.isRulesActive;
        const isPresenter = this.roomState.isPresenter;
        const isBroadcastingEnabled = this.roomState.isBroadcastingEnabled;
        const _PEER = this.roomState._PEER || (typeof window !== 'undefined' ? window._PEER : {});
        const html = this.roomState.html || (typeof window !== 'undefined' ? window.html : {});
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const mediaType = this.roomState.mediaType || (typeof window !== 'undefined' ? window.mediaType : {});

        if (emit) {
            // send...
            const data = {
                from_peer_name: rc.peer_name,
                from_peer_id: rc.peer_id,
                from_peer_uuid: rc.peer_uuid,
                to_peer_uuid: '',
                peer_id: peer_id,
                action: action,
                message: '',
                broadcast: broadcast,
            };
            console.log('peerAction', data);

            if (!this.thereAreParticipants()) {
                if (info) return rc.userLog('info', 'No participants detected', 'top-end');
            }
            if (!broadcast) {
                switch (action) {
                    case 'mute':
                        const audioMessage =
                            'The participant has been muted, and only they have the ability to unmute themselves';
                        if (isBroadcastingEnabled) {
                            const peerAudioButton = rc.getId(data.peer_id + '___pAudio');
                            if (peerAudioButton) {
                                const peerAudioIcon = peerAudioButton.querySelector('i');
                                if (peerAudioIcon && peerAudioIcon.classList.contains('red')) {
                                    if (isRulesActive && isPresenter) {
                                        data.action = 'unmute';
                                        return this.confirmPeerAction(data.action, data);
                                    }
                                    return rc.userLog('info', audioMessage, 'top-end');
                                }
                            }
                        } else {
                            const peerAudioStatus = rc.getId(data.peer_id + '__audio');
                            if (!peerAudioStatus || peerAudioStatus.className == html.audioOff) {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'unmute';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return rc.userLog('info', audioMessage, 'top-end');
                            }
                        }
                        break;
                    case 'hide':
                        const videoMessage =
                            'The participant is currently hidden, and only they have the option to unhide themselves';
                        if (isBroadcastingEnabled) {
                            const peerVideoButton = rc.getId(data.peer_id + '___pVideo');
                            if (peerVideoButton) {
                                const peerVideoIcon = peerVideoButton.querySelector('i');
                                if (peerVideoIcon && peerVideoIcon.classList.contains('red')) {
                                    if (isRulesActive && isPresenter) {
                                        data.action = 'unhide';
                                        return this.confirmPeerAction(data.action, data);
                                    }
                                    return rc.userLog('info', videoMessage, 'top-end');
                                }
                            }
                        } else {
                            const peerVideoOff = rc.getId(data.peer_id + '__videoOff');
                            if (peerVideoOff) {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'unhide';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return rc.userLog('info', videoMessage, 'top-end');
                            }
                        }
                    case 'stop':
                        const screenMessage =
                            'The participant screen is not shared, only the participant can initiate sharing';
                        const peerScreenButton = rc.getId(id);
                        if (peerScreenButton) {
                            const peerScreenStatus = peerScreenButton.querySelector('i');
                            if (peerScreenStatus && peerScreenStatus.classList.contains('red')) {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'start';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return rc.userLog('info', screenMessage, 'top-end');
                            }
                        }
                        break;
                    case 'ban':
                        if (!isRulesActive || isPresenter) {
                            const peer_info = await this.getRemotePeerInfo(peer_id);
                            console.log('BAN PEER', peer_info);
                            if (peer_info) {
                                data.to_peer_uuid = peer_info.peer_uuid;
                                return this.confirmPeerAction(data.action, data);
                            }
                        }
                        break;
                    default:
                        break;
                }
            }
            this.confirmPeerAction(data.action, data);
        } else {
            // receive...
            const peerActionAllowed = peer_id === rc.peer_id || broadcast;
            switch (action) {
                case 'ban':
                    if (peerActionAllowed) {
                        const message = `Will ban you from the room${
                            msg ? `<br><br><span class="red">Reason: ${msg}</span>` : ''
                        }`;
                        rc.exit(true);
                        rc.sound(action);
                        this.peerActionProgress(from_peer_name, message, 5000, action);
                    }
                    break;
                case 'eject':
                    if (peerActionAllowed) {
                        const message = `Will eject you from the room${
                            msg ? `<br><br><span class="red">Reason: ${msg}</span>` : ''
                        }`;
                        rc.exit(true);
                        rc.sound(action);
                        this.peerActionProgress(from_peer_name, message, 5000, action);
                    }
                    break;
                case 'mute':
                    if (peerActionAllowed) {
                        if (rc.producerExist(mediaType.audio)) {
                            await rc.pauseProducer(mediaType.audio);
                            this.updatePeerInfo(rc.peer_name, rc.peer_id, 'audio', false);
                            rc.userLog(
                                'warning',
                                from_peer_name + '  ' + _PEER.audioOff + ' has closed yours audio',
                                'top-end',
                                10000
                            );
                        }
                    }
                    break;
                case 'unmute':
                    if (peerActionAllowed) {
                        this._peerMediaStartConfirm(
                            mediaType.audio,
                            image.unmute,
                            'Enable Microphone',
                            'Allow the presenter to enable your microphone?'
                        );
                    }
                    break;
                case 'hide':
                    if (peerActionAllowed) {
                        rc.closeProducer(mediaType.video, 'moderator');
                        rc.userLog(
                            'warning',
                            from_peer_name + '  ' + _PEER.videoOff + ' has closed yours video',
                            'top-end',
                            10000
                        );
                    }
                    break;
                case 'unhide':
                    if (peerActionAllowed) {
                        this._peerMediaStartConfirm(
                            mediaType.video,
                            image.unhide,
                            'Enable Camera',
                            'Allow the presenter to enable your camera?'
                        );
                    }
                    break;
                case 'stop':
                    if (rc.isScreenShareSupported) {
                        if (peerActionAllowed) {
                            rc.closeProducer(mediaType.screen, 'moderator');
                            rc.userLog(
                                'warning',
                                from_peer_name + '  ' + _PEER.screenOff + ' has closed yours screen share',
                                'top-end',
                                10000
                            );
                        }
                    }
                    break;
                case 'start':
                    if (peerActionAllowed) {
                        this._peerMediaStartConfirm(
                            mediaType.screen,
                            image.start,
                            'Start Screen share',
                            'Allow the presenter to start your screen share?'
                        );
                    }
                    break;
                default:
                    break;
            }
        }
    }

    _peerMediaStartConfirm(type, imageUrl, title, text) {
        const rc = this.rc;
        const mediaType = this.roomState.mediaType || (typeof window !== 'undefined' ? window.mediaType : {});
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');

        if (typeof sound === 'function') sound('notify');

        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: imageUrl,
            title: title,
            text: text,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(async (result) => {
            if (result.isConfirmed) {
                const microphoneSelect = this.dom.get('microphoneSelect');
                const videoSelect = this.dom.get('videoSelect');
                switch (type) {
                    case mediaType.audio:
                        rc.producerExist(mediaType.audio)
                            ? await rc.resumeProducer(mediaType.audio)
                            : await rc.produce(mediaType.audio, microphoneSelect ? microphoneSelect.value : null);
                        this.updatePeerInfo(rc.peer_name, rc.peer_id, 'audio', true);
                        break;
                    case mediaType.video:
                        await rc.produce(mediaType.video, videoSelect ? videoSelect.value : null);
                        break;
                    case mediaType.screen:
                        await rc.produce(mediaType.screen);
                        break;
                    default:
                        break;
                }
            }
        });
    }

    peerActionProgress(tt, msg, time, action = 'na') {
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const self = this;

        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            icon: action == 'eject' ? 'warning' : 'success',
            title: tt,
            html: msg,
            timer: time,
            timerProgressBar: true,
            didOpen: () => {
                Swal.showLoading();
            },
        }).then(() => {
            switch (action) {
                case 'refresh':
                    self.getRoomParticipants();
                    break;
                case 'ban':
                case 'eject':
                    self.rc.exit();
                    break;
                default:
                    break;
            }
        });
    }

    confirmPeerAction(action, data) {
        console.log('Confirm peer action', action);
        const rc = this.rc;
        const self = this;
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const _PEER = this.roomState._PEER || (typeof window !== 'undefined' ? window._PEER : {});

        switch (action) {
            case 'ban':
                let banConfirmed = false;
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: image.forbidden,
                    title: 'Ban current participant',
                    input: 'text',
                    inputPlaceholder: 'Ban reason',
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            banConfirmed = true;
                            const message = result.value;
                            if (message) data.message = message;
                            self.socket.emit('peerAction', data);
                            let peer = rc.getId(data.peer_id);
                            if (peer) {
                                peer.parentNode.removeChild(peer);
                                self.participantsCount--;
                                self.refreshParticipantsCount(self.participantsCount);
                            }
                        }
                    })
                    .then(() => {
                        if (banConfirmed) self.peerActionProgress(action, 'In progress, wait...', 6000, 'refresh');
                    });
                break;
            case 'eject':
                let ejectConfirmed = false;
                let whoEject = data.broadcast ? 'All participants except yourself?' : 'current participant?';
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: data.broadcast ? image.users : image.user,
                    title: 'Eject ' + whoEject,
                    input: 'text',
                    inputPlaceholder: 'Eject reason',
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            ejectConfirmed = true;
                            const message = result.value;
                            if (message) data.message = message;
                            if (!data.broadcast) {
                                self.socket.emit('peerAction', data);
                                let peer = rc.getId(data.peer_id);
                                if (peer) {
                                    peer.parentNode.removeChild(peer);
                                    self.participantsCount--;
                                    self.refreshParticipantsCount(self.participantsCount);
                                }
                            } else {
                                self.socket.emit('peerAction', data);
                                let actionButton = rc.getId(action + 'AllButton');
                                if (actionButton) actionButton.style.display = 'none';
                                self.participantsCount = 1;
                                self.refreshParticipantsCount(self.participantsCount);
                            }
                        }
                    })
                    .then(() => {
                        if (ejectConfirmed) self.peerActionProgress(action, 'In progress, wait...', 6000, 'refresh');
                    });
                break;
            case 'mute':
            case 'unmute':
            case 'hide':
            case 'unhide':
            case 'stop':
            case 'start':
                let muteHideStopConfirmed = false;
                let who = data.broadcast ? 'everyone except yourself?' : 'current participant?';
                let imageUrl, title, text;
                switch (action) {
                    case 'mute':
                        imageUrl = image.mute;
                        title = 'Mute ' + who;
                        text =
                            'Once muted, only the presenter will be able to unmute participants, but participants can unmute themselves at any time';
                        break;
                    case 'unmute':
                        imageUrl = image.unmute;
                        title = 'Unmute ' + who;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    case 'hide':
                        title = 'Hide ' + who;
                        imageUrl = image.hide;
                        text =
                            'Once hidden, only the presenter will be able to unhide participants, but participants can unhide themselves at any time';
                        break;
                    case 'unhide':
                        title = 'Unhide ' + who;
                        imageUrl = image.unhide;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    case 'stop':
                        imageUrl = image.stop;
                        title = 'Stop screen share to the ' + who;
                        text =
                            "Once stopped, only the presenter will be able to start the participants' screens, but participants can start their screens themselves at any time";
                        break;
                    case 'start':
                        imageUrl = image.start;
                        title = 'Start screen share to the ' + who;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    default:
                        break;
                }
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: imageUrl,
                    title: title,
                    text: text,
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            muteHideStopConfirmed = true;
                            if (!data.broadcast) {
                                switch (action) {
                                    case 'mute':
                                        let peerAudioButton = rc.getId(data.peer_id + '___pAudio');
                                        if (peerAudioButton) peerAudioButton.innerHTML = _PEER.audioOff;
                                        break;
                                    case 'hide':
                                        let peerVideoButton = rc.getId(data.peer_id + '___pVideo');
                                        if (peerVideoButton) peerVideoButton.innerHTML = _PEER.videoOff;
                                        break;
                                    case 'stop':
                                        let peerScreenButton = rc.getId(data.peer_id + '___pScreen');
                                        if (peerScreenButton) peerScreenButton.innerHTML = _PEER.screenOff;
                                        break;
                                    default:
                                        break;
                                }
                                self.socket.emit('peerAction', data);
                            } else {
                                self.socket.emit('peerAction', data);
                                let actionButton = rc.getId(action + 'AllButton');
                                if (actionButton) actionButton.style.display = 'none';
                            }
                        }
                    })
                    .then(() => {
                        if (muteHideStopConfirmed)
                            self.peerActionProgress(action, 'In progress, wait...', 2000, 'refresh');
                    });
                break;
            default:
                break;
        }
    }

    peerGuestNotAllowed(action) {
        console.log('peerGuestNotAllowed', action);
        const rc = this.rc;
        switch (action) {
            case 'audio':
                rc.userLog('warning', 'Only the presenter can mute/unmute participants', 'top-end');
                break;
            case 'video':
                rc.userLog('warning', 'Only the presenter can hide/show participants', 'top-end');
                break;
            case 'screen':
                rc.userLog('warning', 'Only the presenter can start/stop the screen of participants', 'top-end');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // SEARCH / FILTER PEERS
    // ####################################################

    searchPeer() {
        const searchParticipantsFromList = this.dom.get('searchParticipantsFromList');
        if (!searchParticipantsFromList) return;
        const searchFilter = searchParticipantsFromList.value.toUpperCase();
        const participantsList = this.dom.get('participantsList');
        if (!participantsList) return;
        const participantsListItems = participantsList.getElementsByTagName('li');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const participantName = li.getAttribute('data-to-name');
            if (!participantName) continue;
            const shouldDisplay = participantName.toUpperCase().includes(searchFilter);
            li.style.display = shouldDisplay ? '' : 'none';
        }
    }

    toggleRaiseHands() {
        const participantsList = this.dom.get('participantsList');
        if (!participantsList) return;
        const participantsListItems = participantsList.getElementsByTagName('li');
        const participantsRaiseHandBtn = this.dom.get('participantsRaiseHandBtn');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const hasPulsateClass = li.querySelector('i.pulsate') !== null;
            const shouldDisplay = (hasPulsateClass && !this.isToggleRaiseHand) || this.isToggleRaiseHand;
            li.style.display = shouldDisplay ? '' : 'none';
        }
        this.isToggleRaiseHand = !this.isToggleRaiseHand;
        if (typeof setColor === 'function' && participantsRaiseHandBtn) {
            setColor(participantsRaiseHandBtn, this.isToggleRaiseHand ? 'lime' : 'white');
        }
    }

    toggleUnreadMsg() {
        const participantsList = this.dom.get('participantsList');
        if (!participantsList) return;
        const participantsListItems = participantsList.getElementsByTagName('li');
        const participantsUnreadMessagesBtn = this.dom.get('participantsUnreadMessagesBtn');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const shouldDisplay =
                (li.classList.contains('pulsate') && !this.isToggleUnreadMsg) || this.isToggleUnreadMsg;
            li.style.display = shouldDisplay ? '' : 'none';
        }
        this.isToggleUnreadMsg = !this.isToggleUnreadMsg;
        if (typeof setColor === 'function' && participantsUnreadMessagesBtn) {
            setColor(participantsUnreadMessagesBtn, this.isToggleUnreadMsg ? 'lime' : 'white');
        }
    }

    // ####################################################
    // SHOW PEER ABOUT AND MESSAGES
    // ####################################################

    showPeerAboutAndMessages(peer_id, peer_name, peer_avatar = false, event = null) {
        const rc = this.rc;
        rc.hidePeerMessages();

        rc.chatPeerId = peer_id;
        rc.chatPeerName = peer_name;
        rc.chatPeerAvatar = peer_avatar;

        const chatAbout = rc.getId('chatAbout');
        const participant = rc.getId(peer_id);
        const participantsList = rc.getId('participantsList');
        const chatPrivateMessages = rc.getId('chatPrivateMessages');
        const messagePrivateListItems = chatPrivateMessages.getElementsByTagName('li');
        const participantsListItems = participantsList.getElementsByTagName('li');
        const avatarImg = this.getParticipantAvatar(peer_name, peer_avatar);
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const isChatGPTOn = this.roomState.isChatGPTOn;
        const isDeepSeekOn = this.roomState.isDeepSeekOn;

        const generateChatAboutHTML = (imgSrc, title, status = 'online', participants = '') => {
            const isSensitiveChat = !['all', 'ChatGPT', 'DeepSeek'].includes(peer_id) && title.length > 15;
            const truncatedTitle = isSensitiveChat ? `${title.substring(0, 10)}*****` : title;
            return `
                <a data-toggle="modal" data-target="#view_info">
                    <img src="${imgSrc}" alt="avatar" />
                </a>
                <div class="chat-about">
                    <h6 class="mb-0">${truncatedTitle}</h6>
                    <span class="status">
                        <i class="fa fa-circle ${status}"></i> ${status} ${participants}
                    </span>
                </div>
            `;
        };

        // CURRENT SELECTED PEER
        for (let i = 0; i < participantsListItems.length; i++) {
            participantsListItems[i].classList.remove('active');
        }

        // Clear pulsate and unread indicators for selected peer
        const selectedLi = rc.getId(peer_id);
        if (selectedLi) selectedLi.classList.remove('pulsate');

        if (!['all', 'ChatGPT', 'DeepSeek'].includes(peer_id)) {
            const unreadMsg = rc.getId(`${peer_id}-unread-msg`);
            if (unreadMsg) unreadMsg.classList.add('hidden');
        }

        // Clear unread count badge for selected peer
        if (rc.unreadMessageCounts) rc.unreadMessageCounts[peer_id] = 0;
        if (typeof rc.updateUnreadCountBadge === 'function') rc.updateUnreadCountBadge(peer_id);

        if (participant) participant.classList.add('active');

        // Reset AI chat flags (via roomState for shared state)
        if (typeof window !== 'undefined') {
            window.isChatGPTOn = false;
            window.isDeepSeekOn = false;
        }

        console.log('Display messages', peer_id);

        switch (peer_id) {
            case 'ChatGPT':
                if (this._moderator.chat_cant_chatgpt) {
                    return (typeof userLog === 'function')
                        ? userLog('warning', 'The moderator does not allow you to chat with ChatGPT', 'top-end', 6000)
                        : null;
                }
                if (typeof window !== 'undefined') window.isChatGPTOn = true;
                chatAbout.innerHTML = generateChatAboutHTML(image.chatgpt, 'ChatGPT');
                rc.getId('chatGPTMessages').style.display = 'block';
                break;
            case 'DeepSeek':
                if (this._moderator.chat_cant_deep_seek) {
                    return (typeof userLog === 'function')
                        ? userLog('warning', 'The moderator does not allow you to chat with DeepSeek', 'top-end', 6000)
                        : null;
                }
                if (typeof window !== 'undefined') window.isDeepSeekOn = true;
                chatAbout.innerHTML = generateChatAboutHTML(image.deepSeek, 'DeepSeek');
                rc.getId('deepSeekMessages').style.display = 'block';
                break;
            case 'all':
                chatAbout.innerHTML = generateChatAboutHTML(image.all, 'Public chat', 'online', this.participantsCount);
                rc.getId('chatPublicMessages').style.display = 'block';
                break;
            default:
                if (this._moderator.chat_cant_privately) {
                    return (typeof userLog === 'function')
                        ? userLog('warning', 'The moderator does not allow you to chat privately', 'top-end', 6000)
                        : null;
                }
                chatAbout.innerHTML = generateChatAboutHTML(avatarImg, peer_name);
                chatPrivateMessages.style.display = 'block';
                for (let i = 0; i < messagePrivateListItems.length; i++) {
                    const li = messagePrivateListItems[i];
                    const itemFromId = li.getAttribute('data-from-id');
                    const itemToId = li.getAttribute('data-to-id');
                    const shouldDisplay =
                        (itemFromId && itemFromId.includes(peer_id)) || (itemToId && itemToId.includes(peer_id));
                    li.style.display = shouldDisplay ? '' : 'none';
                }
                break;
        }

        const clickedElement = event ? event.target : null;
        if (!event || (clickedElement.tagName != 'BUTTON' && clickedElement.tagName != 'I')) {
            const plist = this.dom.get('plist');
            if ((rc.isMobileDevice || rc.isChatPinned) && (!plist || !plist.classList.contains('hidden'))) {
                rc.toggleShowParticipants();
            }
        }
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(peer_name, peer_id, type, status, emit = true, presenter = false) {
        const rc = this.rc;
        const isBroadcastingEnabled = this.roomState.isBroadcastingEnabled;
        const _PEER = this.roomState._PEER || (typeof window !== 'undefined' ? window._PEER : {});
        const _EVENTS = this.roomState._EVENTS || (typeof window !== 'undefined' ? window._EVENTS : {});
        const mediaType = this.roomState.mediaType || (typeof window !== 'undefined' ? window.mediaType : {});

        if (emit) {
            switch (type) {
                case 'audio':
                    rc.setIsAudio(peer_id, status);
                    break;
                case 'video':
                    rc.setIsVideo(status);
                    break;
                case 'screen':
                    rc.setIsScreen(status);
                    break;
                case 'hand':
                    rc.peer_info.peer_hand = status;
                    const peer_hand = rc.getPeerHandBtn(peer_id);
                    if (status) {
                        if (peer_hand) peer_hand.style.display = 'flex';
                        rc.event(_EVENTS.raiseHand);
                        rc.sound('raiseHand');
                    } else {
                        if (peer_hand) peer_hand.style.display = 'none';
                        rc.event(_EVENTS.lowerHand);
                    }
                    break;
                default:
                    break;
            }
            const data = {
                room_id: rc.room_id,
                peer_name: peer_name,
                peer_id: peer_id,
                type: type,
                status: status,
                broadcast: true,
            };
            this.socket.emit('updatePeerInfo', data);
        } else {
            const canUpdateMediaStatus = !isBroadcastingEnabled || (isBroadcastingEnabled && presenter);
            switch (type) {
                case 'audio':
                    if (canUpdateMediaStatus) rc.setPeerAudio(peer_id, status);
                    break;
                case 'video':
                    break;
                case 'screen':
                    break;
                case 'hand':
                    const peer_hand = rc.getPeerHandBtn(peer_id);
                    if (status) {
                        if (peer_hand) peer_hand.style.display = 'flex';
                        rc.userLog(
                            'warning',
                            peer_name + '  ' + _PEER.raiseHand + ' has raised the hand',
                            'top-end',
                            10000
                        );
                        rc.sound('raiseHand');
                    } else {
                        if (peer_hand) peer_hand.style.display = 'none';
                    }
                    break;
                default:
                    break;
            }
        }
        if (this.isParticipantsListOpen) this.getRoomParticipants();
    }

    checkPeerInfoStatus(peer_info) {
        let peer_id = peer_info.peer_id;
        let peer_hand_status = peer_info.peer_hand;
        if (peer_hand_status) {
            let peer_hand = this.rc.getPeerHandBtn(peer_id);
            if (peer_hand) peer_hand.style.display = 'flex';
        }
    }

    // ####################################################
    // PEER INFO DISPLAY
    // ####################################################

    popupPeerInfo(id, peer_info) {
        const rc = this.rc;
        if (rc.showPeerInfo && !rc.isMobileDevice) {
            const peerInfoFormatted = this.getPeerUiInfos(peer_info);
            rc.setTippy(
                id,
                `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5;">${peerInfoFormatted}</div>`,
                'top-start',
                true
            );
        }
    }

    getPeerUiInfos(peer_info) {
        const info = peer_info || (this.rc ? this.rc.peer_info : {});
        const {
            join_data_time,
            peer_name,
            peer_presenter,
            is_desktop_device,
            is_mobile_device,
            is_tablet_device,
            is_ipad_pro_device,
            os_name,
            os_version,
            browser_name,
            browser_version,
        } = info;

        const emojiPeerInfo = [
            { label: 'Join Time', value: join_data_time, emoji: '\u23F0' },
            { label: 'Name', value: peer_name, emoji: '\uD83D\uDC64' },
            { label: 'Presenter', value: peer_presenter ? 'Yes' : 'No', emoji: peer_presenter ? '\u2B50' : '\uD83C\uDF99' },
            { label: 'Desktop Device', value: is_desktop_device ? 'Yes' : 'No', emoji: '\uD83D\uDCBB' },
            { label: 'Mobile Device', value: is_mobile_device ? 'Yes' : 'No', emoji: '\uD83D\uDCF1' },
            { label: 'Tablet Device', value: is_tablet_device ? 'Yes' : 'No', emoji: '\uD83D\uDCF2' },
            { label: 'iPad Pro', value: is_ipad_pro_device ? 'Yes' : 'No', emoji: '\uD83D\uDCF1' },
            { label: 'OS', value: `${os_name} ${os_version}`, emoji: '\uD83D\uDDA5\uFE0F' },
            { label: 'Browser', value: `${browser_name} ${browser_version}`, emoji: '\uD83C\uDF10' },
        ];

        return emojiPeerInfo.map((item) => `${item.emoji} <b>${item.label}:</b> ${item.value}`).join('<br/>');
    }

    // ####################################################
    // PEER GEOLOCATION
    // ####################################################

    askPeerGeoLocation(id) {
        const words = id.split('___');
        const peer_id = words[0];
        const rc = this.rc;
        const cmd = {
            type: 'geoLocation',
            from_peer_name: rc.peer_name,
            from_peer_id: rc.peer_id,
            peer_id: peer_id,
            broadcast: false,
        };
        rc.emitCmd(cmd);
        this.peerActionProgress(
            'Geolocation',
            'Geolocation requested. Please wait for confirmation...',
            6000,
            'geolocation'
        );
    }

    sendPeerGeoLocation(peer_id, type, data) {
        const rc = this.rc;
        const cmd = {
            type: type,
            from_peer_name: rc.peer_name,
            from_peer_id: rc.peer_id,
            peer_id: peer_id,
            data: data,
            broadcast: false,
        };
        rc.emitCmd(cmd);
    }

    confirmPeerGeoLocation(cmd) {
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});

        if (typeof sound === 'function') sound('notify');

        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.geolocation,
            position: 'center',
            title: 'Geo Location',
            html: `Would you like to share your location to ${cmd.from_peer_name}?`,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            result.isConfirmed
                ? this._getPeerGeoLocation(cmd.from_peer_id)
                : this._denyPeerGeoLocation(cmd.from_peer_id);
        });
    }

    _getPeerGeoLocation(peer_id, options = {}) {
        const self = this;
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const geoLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                    };
                    console.log('GeoLocation --->', geoLocation);
                    self.sendPeerGeoLocation(peer_id, 'geoLocationOK', geoLocation);
                },
                function (error) {
                    let geoError = error;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            geoError = 'User denied the request for Geolocation';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            geoError = 'Location information is unavailable';
                            break;
                        case error.TIMEOUT:
                            geoError = 'The request to get user location timed out';
                            break;
                        default:
                            geoError = 'An unknown error occurred';
                            break;
                    }
                    self.sendPeerGeoLocation(peer_id, 'geoLocationKO', geoError);
                },
                options
            );
        } else {
            self.sendPeerGeoLocation(peer_id, 'geoLocationKO', 'Geolocation is not supported');
        }
    }

    _denyPeerGeoLocation(peer_id) {
        this.sendPeerGeoLocation(peer_id, 'geoLocationKO', 'User denied the request for Geolocation');
    }

    // ####################################################
    // MODERATOR
    // ####################################################

    updateRoomModerator(data) {
        const isRulesActive = this.roomState.isRulesActive;
        const isPresenter = this.roomState.isPresenter;
        if (!isRulesActive || isPresenter) {
            const moderator = this._getModeratorData(data);
            this.socket.emit('updateRoomModerator', moderator);
        }
    }

    updateRoomModeratorALL(data) {
        const isRulesActive = this.roomState.isRulesActive;
        const isPresenter = this.roomState.isPresenter;
        if (!isRulesActive || isPresenter) {
            const moderator = this._getModeratorData(data);
            this.socket.emit('updateRoomModeratorALL', moderator);
        }
    }

    _getModeratorData(data) {
        const rc = this.rc;
        return {
            peer_name: rc.peer_name,
            peer_uuid: rc.peer_uuid,
            moderator: data,
        };
    }

    handleUpdateRoomModerator(data) {
        const rc = this.rc;
        switch (data.type) {
            case 'audio_cant_unmute':
                this._moderator.audio_cant_unmute = data.status;
                if (this._moderator.audio_cant_unmute) {
                    const tabAudioDevicesBtn = this.dom.get('tabAudioDevicesBtn');
                    if (tabAudioDevicesBtn) tabAudioDevicesBtn.classList.add('hidden');
                } else {
                    const tabAudioDevicesBtn = this.dom.get('tabAudioDevicesBtn');
                    if (tabAudioDevicesBtn) tabAudioDevicesBtn.classList.remove('hidden');
                }
                rc.roomMessage('audio_cant_unmute', data.status);
                break;
            case 'video_cant_unhide':
                this._moderator.video_cant_unhide = data.status;
                if (this._moderator.video_cant_unhide) {
                    const tabVideoDevicesBtn = this.dom.get('tabVideoDevicesBtn');
                    if (tabVideoDevicesBtn) tabVideoDevicesBtn.classList.add('hidden');
                } else {
                    const tabVideoDevicesBtn = this.dom.get('tabVideoDevicesBtn');
                    if (tabVideoDevicesBtn) tabVideoDevicesBtn.classList.remove('hidden');
                }
                rc.roomMessage('video_cant_unhide', data.status);
                break;
            case 'screen_cant_share':
                this._moderator.screen_cant_share = data.status;
                rc.roomMessage('screen_cant_share', data.status);
                break;
            case 'chat_cant_privately':
                this._moderator.chat_cant_privately = data.status;
                rc.roomMessage('chat_cant_privately', data.status);
                break;
            case 'chat_cant_chatgpt':
                this._moderator.chat_cant_chatgpt = data.status;
                rc.roomMessage('chat_cant_chatgpt', data.status);
                break;
            case 'media_cant_sharing':
                this._moderator.media_cant_sharing = data.status;
                rc.roomMessage('media_cant_sharing', data.status);
                break;
            default:
                break;
        }
    }

    handleUpdateRoomModeratorALL(data) {
        this._moderator = data;
        console.log('Update Room Moderator data all', this._moderator);
    }

    getModerator() {
        console.log('Get Moderator', this._moderator);
        return this._moderator;
    }

    // ####################################################
    // PARTICIPANT TOGGLE (from RoomClient.js)
    // ####################################################

    toggleShowParticipants() {
        const rc = this.rc;
        const plist = rc.getId('plist');
        const chat = rc.getId('chat');
        plist.classList.toggle('hidden');
        const isParticipantsListHidden = !this._isPlistOpen();
        chat.style.marginLeft = isParticipantsListHidden ? 0 : '300px';
        chat.style.borderLeft = isParticipantsListHidden ? 'none' : '1px solid rgb(255 255 255 / 32%)';
        if (rc.isChatPinned) {
            if (typeof elemDisplay === 'function') elemDisplay(chat.id, isParticipantsListHidden);
        }
        if (!rc.isChatPinned) {
            if (typeof elemDisplay === 'function') elemDisplay(chat.id, true);
        }
        rc.toggleChatHistorySize(isParticipantsListHidden && (rc.isChatPinned || rc.isChatMaximized));
        plist.style.width = rc.isChatPinned || rc.isMobileDevice ? '100%' : '300px';
        plist.style.position = rc.isMobileDevice ? 'fixed' : 'absolute';
        if (typeof rc.updateChatFooterVisibility === 'function') rc.updateChatFooterVisibility();
    }

    _isPlistOpen() {
        const plist = this.dom.get('plist');
        return plist && !plist.classList.contains('hidden');
    }

    async toggleParticipants() {
        const rc = this.rc;
        this.isParticipantsOpen = !this.isParticipantsOpen;
        if (!this.isParticipantsOpen && rc.isChatOpen) {
            rc.toggleChat();
            return;
        }
        if (!rc.isChatOpen) {
            rc.toggleChat();
            await rc.sleep(500);
        }
        const isDesktopDevice = this.roomState.isDesktopDevice || (typeof window !== 'undefined' ? window.isDesktopDevice : false);
        if ((isDesktopDevice && rc.isChatPinned) || !isDesktopDevice) {
            this.toggleShowParticipants();
        }
    }

    // ####################################################
    // PEER INFO LOCAL STORAGE
    // ####################################################

    updatePeerInfoInLocalStorage() {
        const rc = this.rc;
        try {
            localStorage.setItem('sfu_peer_info', JSON.stringify(rc.peer_info));
        } catch (e) {
            console.warn('Unable to save peer_info to localStorage:', e);
        }
    }

    getPeerInfoFromLocalStorage() {
        try {
            const sfu_peer_info = localStorage.getItem('sfu_peer_info');
            return sfu_peer_info ? JSON.parse(sfu_peer_info) : null;
        } catch (e) {
            console.warn('Unable to get sfu_peer_info from localStorage:', e);
            return null;
        }
    }

    removePeerInfoFromLocalStorage() {
        try {
            localStorage.removeItem('sfu_peer_info');
        } catch (e) {
            console.warn('Unable to remove sfu_peer_info from localStorage:', e);
        }
    }

    // ####################################################
    // HELPERS
    // ####################################################

    _handleDropdownHover(dropdowns) {
        if (typeof handleDropdownHover === 'function') {
            handleDropdownHover(dropdowns);
            return;
        }
        // Fallback: basic hover handling
        dropdowns.forEach((dropdown) => {
            dropdown.addEventListener('mouseenter', () => {
                const menu = dropdown.querySelector('.dropdown-menu');
                if (menu) menu.classList.add('show');
            });
            dropdown.addEventListener('mouseleave', () => {
                const menu = dropdown.querySelector('.dropdown-menu');
                if (menu) menu.classList.remove('show');
            });
        });
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    close() {
        // Remove socket listeners
        if (this.socket) {
            if (this._handleRefreshParticipantsCount) {
                this.socket.off('refreshParticipantsCount', this._handleRefreshParticipantsCount);
            }
            if (this._handlePeerAction) {
                this.socket.off('peerAction', this._handlePeerAction);
            }
            if (this._handleUpdatePeerInfo) {
                this.socket.off('updatePeerInfo', this._handleUpdatePeerInfo);
            }
            if (this._handleUpdateRoomModerator) {
                this.socket.off('updateRoomModerator', this._handleUpdateRoomModerator);
            }
            if (this._handleUpdateRoomModeratorALL) {
                this.socket.off('updateRoomModeratorALL', this._handleUpdateRoomModeratorALL);
            }
        }

        // Clear references
        this._handleRefreshParticipantsCount = null;
        this._handlePeerAction = null;
        this._handleUpdatePeerInfo = null;
        this._handleUpdateRoomModerator = null;
        this._handleUpdateRoomModeratorALL = null;
        this.socketManager = null;
        this.rc = null;
        this.socket = null;

        console.log('ParticipantsManager closed');
    }
}
