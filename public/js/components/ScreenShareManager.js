'use strict';

/**
 * ScreenShareManager
 *
 * Encapsulates all screen-sharing-related logic previously spread across
 * RoomClient.js and Room.js, including:
 *   - Screen share prompt on join
 *   - Toggle screen sharing from the init/lobby UI
 *   - Screen media constraints
 *   - setVideoOff / removeVideoOff (avatar placeholder when video is off)
 *   - setIsScreen, setIsVideo, sendVideoOff helpers
 *   - Socket signalling for setVideoOff
 */
class ScreenShareManager {
    /**
     * @param {EventTarget|EventEmitter} eventBus  – shared event bus
     * @param {object}                   roomState – shared room state bag
     * @param {Map<string, HTMLElement>}  domCache  – element cache (get by id)
     */
    constructor(eventBus, roomState, domCache) {
        this.eventBus = eventBus;
        this.roomState = roomState;
        this.dom = domCache;

        // Populated by init()
        this.socket = null;
        this.rc = null;
    }

    // ####################################################
    // INITIALISATION
    // ####################################################

    /**
     * Wire up socket events and keep a back-reference to the
     * legacy RoomClient instance for things we have not yet
     * migrated (userLog, sound, produce, event, getId, …).
     *
     * @param {object} socketManager – socket.io client instance
     * @param {object} rc            – RoomClient instance
     */
    init(socketManager, rc) {
        this.socket = socketManager;
        this.rc = rc;
    }

    // ####################################################
    // SCREEN CONSTRAINTS
    // ####################################################

    /**
     * Build the MediaStreamConstraints object for screen capture.
     *
     * Reads the current screenFps and screenQuality selects from the DOM
     * and returns constraints suitable for navigator.mediaDevices.getDisplayMedia().
     *
     * @returns {{ audio: boolean, video: object }}
     */
    getScreenConstraints() {
        const screenFps = this.dom.get('screenFps');
        const screenQuality = this.dom.get('screenQuality');

        const selectedValue = this.rc.getSelectedIndexValue(screenFps);
        const customFrameRate = parseInt(selectedValue, 10);

        const screenResolutionMap = this.rc.getResolutionMap();

        // Default to Full HD
        const [width, height] = screenResolutionMap[screenQuality.value] || [1920, 1080];

        const videoConstraints = {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: customFrameRate || 30 },
        };

        return {
            audio: true,
            video: videoConstraints,
        };
    }

    // ####################################################
    // SHARE SCREEN ON JOIN
    // ####################################################

    /**
     * Prompt the user to share their screen immediately after joining.
     *
     * Only available on desktop browsers that support getDisplayMedia.
     * Shows a SweetAlert confirmation dialog to handle browsers that
     * require transient user activation (Safari, Firefox).
     */
    shareScreen() {
        const startScreenButton = this.dom.get('startScreenButton');

        if (
            !this.rc.isMobileDevice &&
            (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia)
        ) {
            this.rc.sound('open');
            Swal.fire({
                background: swalBackground,
                position: 'center',
                icon: 'question',
                text: 'Do you want to share your screen?',
                showDenyButton: true,
                confirmButtonText: 'Yes',
                denyButtonText: 'No',
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    if (startScreenButton) startScreenButton.click();
                    console.log('11 ----> Screen is on');
                } else {
                    console.log('11 ----> Screen is on');
                }
            });
        } else {
            console.log('11 ----> Screen is off');
        }
    }

    // ####################################################
    // TOGGLE SCREEN SHARING (INIT / LOBBY UI)
    // ####################################################

    /**
     * Toggle screen sharing from the pre-join (init/lobby) UI.
     *
     * When enabled, captures the display media and attaches it to the
     * init video element. When disabled, reverts to the webcam stream.
     *
     * @param {object} opts
     * @param {MediaStream|null} opts.initStream        – current init media stream
     * @param {HTMLVideoElement} opts.initVideo         – the preview video element
     * @param {boolean}          opts.joinRoomWithScreen – current toggle state
     * @param {boolean}          opts.isVideoAllowed    – whether video is permitted
     * @param {object}           opts.localStorageSettings – user's persisted settings
     * @param {Function}         opts.stopTracks        – helper to stop all tracks
     * @param {Function}         opts.initVideoContainerShow – show the init video container
     * @param {Function}         opts.checkInitVideo    – restore webcam preview
     * @param {Function}         opts.show              – show element helper
     * @param {Function}         opts.hide              – hide element helper
     * @param {Function}         opts.disable           – disable element helper
     * @param {Function}         opts.elemDisplay       – toggle element display
     * @returns {Promise<{ initStream: MediaStream|null, joinRoomWithScreen: boolean }>}
     */
    async toggleScreenSharing(opts) {
        const {
            initStream,
            initVideo,
            joinRoomWithScreen,
            isVideoAllowed,
            localStorageSettings,
            stopTracks,
            initVideoContainerShow,
            checkInitVideo,
            show,
            hide,
            disable,
            elemDisplay,
        } = opts;

        let stream = initStream;
        let screenOn = joinRoomWithScreen;

        if (stream) {
            await stopTracks(stream);
            elemDisplay('initVideo', true);
            initVideoContainerShow();
        }

        screenOn = !screenOn;

        if (screenOn) {
            const defaultFrameRate = { ideal: 30 };
            const videoFpsSelect = this.dom.get('videoFps');
            const selectedValue = videoFpsSelect.options[localStorageSettings.screen_fps].value;
            const customFrameRate = parseInt(selectedValue, 10);
            const frameRate = selectedValue === 'max' ? defaultFrameRate : customFrameRate;

            const initStartScreenButton = this.dom.get('initStartScreenButton');
            const initStopScreenButton = this.dom.get('initStopScreenButton');
            const initVideoSelect = this.dom.get('initVideoSelect');
            const initVideoButton = this.dom.get('initVideoButton');
            const initAudioVideoButton = this.dom.get('initAudioVideoButton');
            const initVideoAudioRefreshButton = this.dom.get('initVideoAudioRefreshButton');
            const initVirtualBackgroundButton = this.dom.get('initVirtualBackgroundButton');

            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    audio: true,
                    video: { frameRate: frameRate },
                });
                if (initVideo.classList.contains('mirror')) {
                    initVideo.classList.toggle('mirror');
                }
                initVideo.srcObject = screenStream;
                stream = screenStream;
                console.log('04.6 ----> Success attached init screen video stream', stream);
                show(initStopScreenButton);
                hide(initStartScreenButton);
                disable(initVideoSelect, true);
                disable(initVideoButton, true);
                disable(initAudioVideoButton, true);
                disable(initVideoAudioRefreshButton, true);
                disable(initVirtualBackgroundButton, true);
            } catch (error) {
                console.error('[Error] toggleScreenSharing', error);
                screenOn = false;
                checkInitVideo(isVideoAllowed);
            }
        } else {
            const initStartScreenButton = this.dom.get('initStartScreenButton');
            const initStopScreenButton = this.dom.get('initStopScreenButton');
            const initVideoSelect = this.dom.get('initVideoSelect');
            const initVideoButton = this.dom.get('initVideoButton');
            const initAudioVideoButton = this.dom.get('initAudioVideoButton');
            const initVideoAudioRefreshButton = this.dom.get('initVideoAudioRefreshButton');
            const initVirtualBackgroundButton = this.dom.get('initVirtualBackgroundButton');

            checkInitVideo(isVideoAllowed);
            hide(initStopScreenButton);
            show(initStartScreenButton);
            disable(initVideoSelect, false);
            disable(initVideoButton, false);
            disable(initAudioVideoButton, false);
            disable(initVideoAudioRefreshButton, false);
            disable(initVirtualBackgroundButton, false);
        }

        return { initStream: stream, joinRoomWithScreen: screenOn };
    }

    // ####################################################
    // SET VIDEO OFF (AVATAR PLACEHOLDER)
    // ####################################################

    /**
     * Create the "video off" avatar placeholder for a peer whose
     * camera is not active. Builds the full DOM subtree including
     * the avatar image, username label, hand-raise icon, audio
     * controls, action buttons (send file/message/video, ban, eject,
     * geolocation) and pitch meter.
     *
     * @param {object}  peer_info  – peer info object from the server
     * @param {boolean} remotePeer – true if this is a remote participant
     */
    setVideoOff(peer_info, remotePeer = false) {
        let d, vb, i, h, au, sf, sm, sv, gl, ban, ko, p, pm, pb, pv, st, ri;

        const { peer_id, peer_name, peer_avatar, peer_audio, peer_presenter } = peer_info;

        this.removeVideoOff(peer_id);

        d = document.createElement('div');
        d.className = 'Camera';
        d.id = peer_id + '__videoOff';

        vb = document.createElement('div');
        vb.id = peer_id + '__vb';
        vb.className = 'videoMenuBar hidden';

        au = this.rc.createButton(peer_id + '__audio', peer_audio ? html.audioOn : html.audioOff);

        pv = document.createElement('input');
        pv.id = peer_id + '___pVolume';
        pv.type = 'range';
        pv.min = 0;
        pv.max = 100;
        pv.value = 100;

        if (remotePeer) {
            sf = this.rc.createButton('remotePeer___' + peer_id + '___sendFile', html.sendFile);
            sm = this.rc.createButton('remotePeer___' + peer_id + '___sendMsg', html.sendMsg);
            sv = this.rc.createButton('remotePeer___' + peer_id + '___sendVideo', html.sendVideo);
            gl = this.rc.createButton('remotePeer___' + peer_id + '___geoLocation', html.geolocation);
            ban = this.rc.createButton('remotePeer___' + peer_id + '___ban', html.ban);
            ko = this.rc.createButton('remotePeer___' + peer_id + '___kickOut', html.kickOut);
        } else {
            st = this.rc.createElement(peer_id + '__sessionTime', 'span', 'current-session-time notranslate');
        }

        i = document.createElement('img');
        i.className = 'videoAvatarImage center';
        i.id = peer_id + '__img';

        p = document.createElement('p');
        p.id = peer_id + '__name';
        p.className = html.userName;
        p.innerText = (peer_presenter ? '⭐️ ' : '') + peer_name + (remotePeer ? '' : ' (me) ');

        if (!remotePeer) {
            ri = this.rc.createElement(peer_id + '__recIndicator', 'span', 'rec-indicator');
            ri.innerHTML = '🔴 ';
            p.appendChild(ri);
            if (this.rc._isRecording) ri.classList.add('active');
        }

        h = document.createElement('i');
        h.id = peer_id + '__hand';
        h.className = html.userHand;

        pm = document.createElement('div');
        pb = document.createElement('div');
        pm.setAttribute('id', peer_id + '__pitchMeter');
        pb.setAttribute('id', peer_id + '__pitchBar');
        pm.className = 'speechbar';
        pb.className = 'bar';
        pb.style.height = '1%';
        pm.appendChild(pb);

        if (remotePeer) {
            BUTTONS.videoOff.ejectButton && vb.appendChild(ko);
            BUTTONS.videoOff.banButton && vb.appendChild(ban);
            BUTTONS.videoOff.geolocationButton && vb.appendChild(gl);
            BUTTONS.videoOff.sendVideoButton && vb.appendChild(sv);
            BUTTONS.videoOff.sendFileButton && vb.appendChild(sf);
            BUTTONS.videoOff.sendMessageButton && vb.appendChild(sm);
        }
        BUTTONS.videoOff.audioVolumeInput && vb.appendChild(pv);

        vb.appendChild(au);
        if (!remotePeer) vb.appendChild(st);

        d.appendChild(i);
        d.appendChild(p);
        d.appendChild(h);
        d.appendChild(pm);

        const hideVideoMenu = () => {
            if (vb && !vb.classList.contains('hidden')) {
                hide(vb);
                setCamerasBorderNone();
            }
        };

        if (this.rc.isMobileDevice) {
            vb.classList.add('mobile-floating');
            document.body.appendChild(vb);
        } else {
            vb.classList.remove('mobile-floating');
            d.appendChild(vb);
            d.addEventListener('mouseleave', hideVideoMenu);
        }
        vb.addEventListener('click', (e) => e.stopPropagation());

        this.rc.videoMediaContainer.appendChild(d);
        BUTTONS.videoOff.muteAudioButton && this.rc.handleAU(au.id);

        if (remotePeer) {
            this.rc.handleCV('remotePeer___' + pv.id);
            this.rc.handleSM(sm.id);
            this.rc.handleSF(sf.id);
            this.rc.handleSV(sv.id);
            this.rc.handleGL(gl.id);
            this.rc.handleBAN(ban.id);
            this.rc.handleKO(ko.id);
        } else {
            this.rc.handlePV(this.rc.audioConsumers.get(pv.id) + '___' + pv.id);
        }

        this.rc.handleVB(d.id, vb.id);
        this.rc.handleDD(d.id, peer_id, !remotePeer);
        this.rc.popupPeerInfo(p.id, peer_info);
        this.rc.checkPeerInfoStatus(peer_info);
        this.rc.setVideoAvatarImgName(i.id, peer_name, peer_avatar);
        this.rc.getId(i.id).style.display = 'block';

        if (isParticipantsListOpen) getRoomParticipants();

        if (!this.rc.isMobileDevice && remotePeer) {
            this.rc.setTippy(sm.id, 'Send message', 'bottom');
            this.rc.setTippy(sf.id, 'Send file', 'bottom');
            this.rc.setTippy(sv.id, 'Send video', 'bottom');
            this.rc.setTippy(au.id, 'Mute', 'bottom');
            this.rc.setTippy(pv.id, '🔊 Volume', 'bottom');
            this.rc.setTippy(gl.id, 'Geolocation', 'bottom');
            this.rc.setTippy(ban.id, 'Ban', 'bottom');
            this.rc.setTippy(ko.id, 'Eject', 'bottom');
        }

        remotePeer ? this.rc.setPeerAudio(peer_id, peer_audio) : this.rc.setIsAudio(peer_id, peer_audio);

        handleAspectRatio();

        console.log('[setVideoOff] Video-element-count', this.rc.videoMediaContainer.childElementCount);

        wbUpdate();

        this.rc.editorUpdate();

        this.rc.handleHideMe();
    }

    /**
     * Remove the "video off" avatar placeholder for a given peer.
     *
     * @param {string} peer_id – the peer's socket ID
     */
    removeVideoOff(peer_id) {
        const pvOff = this.rc.getId(peer_id + '__videoOff');
        const vb = this.rc.getId(peer_id + '__vb');

        if (vb) vb.parentNode.removeChild(vb);

        if (pvOff) {
            pvOff.parentNode.removeChild(pvOff);
            handleAspectRatio();
            console.log('[removeVideoOff] Video-element-count', this.rc.videoMediaContainer.childElementCount);
            if (peer_id != this.rc.peer_id) this.rc.sound('left');
        }
    }

    // ####################################################
    // SET IS VIDEO / SCREEN HELPERS
    // ####################################################

    /**
     * Update local video state. If video is turned off, creates the
     * avatar placeholder and notifies other peers.
     *
     * @param {boolean} status – true if video is now on, false if off
     */
    setIsVideo(status) {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && isPresenter)) {
            this.rc.peer_info.peer_video = status;
            if (!this.rc.peer_info.peer_video) {
                console.log('Set local video enabled: ' + status);
                this.setVideoOff(this.rc.peer_info, false);
                this.sendVideoOff();
            }
        }
    }

    /**
     * Update local screen-share state. If screen sharing ends and
     * the webcam is also off, creates the avatar placeholder and
     * notifies other peers.
     *
     * @param {boolean} status – true if screen is now on, false if off
     */
    setIsScreen(status) {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && isPresenter)) {
            this.rc.peer_info.peer_screen = status;
            if (!this.rc.peer_info.peer_screen && !this.rc.peer_info.peer_video) {
                console.log('Set local screen enabled: ' + status);
                this.setVideoOff(this.rc.peer_info, false);
                this.sendVideoOff();
            }
        }
    }

    /**
     * Emit the setVideoOff socket event to inform other peers
     * that this user's video is off.
     */
    sendVideoOff() {
        this.socket.emit('setVideoOff', this.rc.peer_info);
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    /**
     * Tear down any resources held by this manager.
     * Unregisters socket listeners related to screen sharing.
     */
    close() {
        if (this.socket) {
            this.socket.off('setVideoOff');
        }
        this.rc = null;
        this.socket = null;
    }
}
