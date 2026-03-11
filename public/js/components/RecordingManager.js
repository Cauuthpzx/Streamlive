'use strict';

/**
 * RecordingManager
 *
 * Encapsulates all recording-related logic previously spread across
 * RoomClient.js and Room.js, including:
 *   - MediaRecorder lifecycle (start / pause / resume / stop)
 *   - Mobile vs desktop recording source selection
 *   - Audio mixing via MixedAudioRecorder
 *   - Server-sync (cloud) recording upload
 *   - Local device download with optional WebM duration fix
 *   - Recording indicator UI helpers
 *   - Recording timer
 *   - Socket signalling for recordingAction
 */
class RecordingManager {
    /**
     * @param {EventTarget|EventEmitter} eventBus  – shared event bus
     * @param {object}                   roomState – shared room state bag
     * @param {Map<string, HTMLElement>}  domCache  – element cache (get by id)
     */
    constructor(eventBus, roomState, domCache) {
        this.eventBus = eventBus;
        this.roomState = roomState;
        this.dom = domCache;

        // ---- own state ----
        this.recordedBlobs = [];
        this.mediaRecorder = null;
        this.audioRecorder = null;
        this.recScreenStream = null;
        this._isRecording = false;
        this._isPaused = false;
        this._recStartTs = null;
        this._lastRecTimeText = '0s';
        this.recServerFileName = null;
        this.recCodecs = null;

        // Timer state
        this.recordingTimer = null;
        this.recElapsedTime = 0;

        // Populated by init()
        this.socket = null;
        this.rc = null;

        // Defaults (may be overridden from room config via init)
        this.recording = {
            recSyncServerRecording: false,
            recSyncServerToS3: false,
            recSyncServerEndpoint: '',
        };
        this.recSyncTime = 4000; // 4 sec
        this.recSyncChunkSize = 1000000; // 1 MB
        this.recShowInfo = true;
    }

    // ####################################################
    // INITIALISATION
    // ####################################################

    /**
     * Wire up socket events and keep a back-reference to the
     * legacy RoomClient instance for things we have not yet
     * migrated (userLog, showMessage, msgHTML, sound, event, …).
     *
     * @param {object} socketManager – socket.io client instance
     * @param {object} rc            – RoomClient instance
     */
    init(socketManager, rc) {
        this.socket = socketManager;
        this.rc = rc;

        // Copy recording config from rc if present
        if (rc.recording) {
            this.recording = { ...this.recording, ...rc.recording };
        }
        if (rc.recSyncTime !== undefined) this.recSyncTime = rc.recSyncTime;
        if (rc.recSyncChunkSize !== undefined) this.recSyncChunkSize = rc.recSyncChunkSize;

        // Listen for incoming recordingAction from other peers
        this.socket.on('recordingAction', (data) => {
            console.log('SocketOn Recording action:', data);
            this.handleRecordingAction(data);
        });
    }

    // ####################################################
    // STATE QUERIES
    // ####################################################

    isRecording() {
        return this._isRecording;
    }

    isPaused() {
        return this._isPaused;
    }

    hasActiveRecorder() {
        return this.mediaRecorder !== null;
    }

    // ####################################################
    // RECORDING INDICATORS
    // ####################################################

    showRecordingIndicator() {
        this._getRecIndicators().forEach((el) => {
            el.classList.add('active');
            el.classList.remove('paused');
        });
    }

    hideRecordingIndicator() {
        this._getRecIndicators().forEach((el) => {
            el.classList.remove('active', 'paused');
            el.innerHTML = '🔴 ';
        });
    }

    pauseRecordingIndicator() {
        this._getRecIndicators().forEach((el) => el.classList.add('paused'));
    }

    resumeRecordingIndicator() {
        this._getRecIndicators().forEach((el) => el.classList.remove('paused'));
    }

    _getRecIndicators() {
        if (this.rc && this.rc.peer_id) {
            return document.querySelectorAll(`[id^="${this.rc.peer_id}__recIndicator"]`);
        }
        return [];
    }

    // ####################################################
    // RECORDING TIMER
    // ####################################################

    /**
     * Convert seconds to a human-readable hh mm ss string.
     * @param {number} d – duration in seconds
     * @returns {string}
     */
    static secondsToHms(d) {
        d = Number(d);
        let h = Math.floor(d / 3600);
        let m = Math.floor((d % 3600) / 60);
        let s = Math.floor((d % 3600) % 60);
        let hDisplay = h > 0 ? h + 'h' : '';
        let mDisplay = m > 0 ? m + 'm' : '';
        let sDisplay = s > 0 ? s + 's' : '';
        return hDisplay + ' ' + mDisplay + ' ' + sDisplay;
    }

    startRecordingTimer() {
        this.recElapsedTime = 0;
        const recordingStatus = this.dom.get('recordingStatus');
        this.recordingTimer = setInterval(() => {
            if (this._isRecording) {
                this.recElapsedTime++;
                const text = RecordingManager.secondsToHms(this.recElapsedTime);
                if (recordingStatus) {
                    recordingStatus.innerText = text;
                }
                this._getRecIndicators().forEach((el) => {
                    el.innerHTML = '🔴 ' + (text !== '0s' ? text : 'REC');
                });
            }
        }, 1000);
    }

    stopRecordingTimer() {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
        const recordingStatus = this.dom.get('recordingStatus');
        if (recordingStatus) {
            recordingStatus.innerText = '0s';
        }
    }

    // ####################################################
    // POPUP HELPERS
    // ####################################################

    popupRecordingOnLeaveRoom() {
        const swalBackground = this.rc ? this.rc.swalBackground || 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.7)';
        const imageUrl = this._getRecordingImage();

        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: imageUrl,
            title: 'Recording is ON',
            html: `
                <div style="text-align:left;">
                    <b>Please stop the recording before leaving the room.</b><br><br>
                    If you leave the room while recording is active, the recording will be stopped automatically and downloaded to your device (if local recording is enabled).
                </div>
            `,
            confirmButtonText: 'OK',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                // Delegate leave logic back to rc / Room.js
                if (typeof leaveFeedback === 'function' && typeof survey !== 'undefined' && survey && survey.enabled) {
                    leaveFeedback(true);
                } else if (typeof redirectOnLeave === 'function') {
                    redirectOnLeave();
                }
            }
        });
    }

    showRecServerSideAdvice() {
        const swalBackground = this.rc ? this.rc.swalBackground || 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.7)';
        const imageUrl = this._getRecordingImage();
        const switchServerRecording = this.dom.get('switchServerRecording');

        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: imageUrl,
            title: 'Server Sync Recording Enabled',
            html: `
                <div style="text-align:left;">
                    <b>Your recording session will be stored on the server.</b><br><br>
                    If you do not agree, please switch off this option.<br>
                    The recording will then be stored in your browser and downloaded to your device after stopping.
                </div>
            `,
            showDenyButton: true,
            confirmButtonText: 'OK',
            denyButtonText: 'Switch Off',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isDenied && switchServerRecording) {
                switchServerRecording.checked = false;
            }
        });
    }

    // ####################################################
    // ERROR HANDLING
    // ####################################################

    handleRecordingError(error, popupLog = true) {
        this.toggleVideoAudioTabs(false);
        console.error('Recording error', error);
        if (popupLog && this.rc) {
            this.rc.userLog('error', error, 'top-end', 6000);
        }
    }

    // ####################################################
    // MIME TYPE / CODEC DETECTION
    // ####################################################

    getSupportedMimeTypes() {
        const possibleTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/mp4',
        ];
        console.log('POSSIBLE CODECS', possibleTypes);
        return possibleTypes.filter((mimeType) => {
            return MediaRecorder.isTypeSupported(mimeType);
        });
    }

    // ####################################################
    // START RECORDING
    // ####################################################

    startRecording() {
        this.recordedBlobs = [];

        // Toggle Video/Audio tabs
        this.toggleVideoAudioTabs(true);

        // Get supported MIME types and set options
        const supportedMimeTypes = this.getSupportedMimeTypes();
        console.log('MediaRecorder supported options', supportedMimeTypes);
        const options = { mimeType: supportedMimeTypes[0] };

        this.recCodecs = supportedMimeTypes[0];

        try {
            this.audioRecorder = new MixedAudioRecorder();
            const audioStreams = this.getAudioStreamFromAudioElements();
            console.log('Audio streams tracks --->', audioStreams.getTracks());

            const audioMixerStreams = this.audioRecorder.getMixedAudioStream(
                audioStreams
                    .getTracks()
                    .filter((track) => track.kind === 'audio')
                    .map((track) => new MediaStream([track]))
            );

            const audioMixerTracks = audioMixerStreams.getTracks();
            console.log('Audio mixer tracks --->', audioMixerTracks);

            this._isMobileDevice()
                ? this.startMobileRecording(options, audioMixerTracks)
                : this.recordingOptions(options, audioMixerTracks);
        } catch (err) {
            this.handleRecordingError('Exception while creating MediaRecorder: ' + err);
        }
    }

    recordingOptions(options, audioMixerTracks) {
        const swalBackground = this.rc ? this.rc.swalBackground || 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.7)';
        const imageUrl = this._getRecordingImage();

        Swal.fire({
            background: swalBackground,
            position: 'top',
            imageUrl: imageUrl,
            title: 'Recording options',
            text: 'Select the recording type you want to start. Audio will be recorded from all participants.',
            showDenyButton: true,
            showCancelButton: true,
            cancelButtonColor: 'red',
            denyButtonColor: 'green',
            confirmButtonText: 'Camera',
            denyButtonText: 'Screen/Window',
            cancelButtonText: 'Cancel',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.startMobileRecording(options, audioMixerTracks);
            } else if (result.isDenied) {
                this.startDesktopRecording(options, audioMixerTracks);
            }
        });
    }

    startMobileRecording(options, audioMixerTracks) {
        try {
            // Combine audioMixerTracks and videoTracks into a single array
            const combinedTracks = [];

            if (Array.isArray(audioMixerTracks)) {
                combinedTracks.push(...audioMixerTracks);
            }

            if (this.rc && this.rc.localVideoStream !== null) {
                const videoTracks = this.rc.localVideoStream.getVideoTracks();
                console.log('Cam video tracks --->', videoTracks);

                if (Array.isArray(videoTracks)) {
                    combinedTracks.push(...videoTracks);
                }
            }

            const recCamStream = new MediaStream(combinedTracks);
            console.log('New Cam Media Stream tracks  --->', recCamStream.getTracks());

            this.mediaRecorder = new MediaRecorder(recCamStream, options);
            console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);

            if (this.rc) {
                const swapBtn = this.rc.getId('swapCameraButton');
                if (swapBtn) swapBtn.className = 'hidden';
            }

            this.initRecording();
        } catch (err) {
            this.handleRecordingError('Unable to record the camera + audio: ' + err, false);
        }
    }

    startDesktopRecording(options, audioMixerTracks) {
        // On desktop devices, record camera or screen/window... + all audio tracks
        const constraints = { video: true };
        navigator.mediaDevices
            .getDisplayMedia(constraints)
            .then((screenStream) => {
                const screenTracks = screenStream.getVideoTracks();
                console.log('Screen video tracks --->', screenTracks);

                const combinedTracks = [];

                if (Array.isArray(screenTracks)) {
                    combinedTracks.push(...screenTracks);
                }
                if (Array.isArray(audioMixerTracks)) {
                    combinedTracks.push(...audioMixerTracks);
                }

                const recScreenStream = new MediaStream(combinedTracks);
                console.log('New Screen/Window Media Stream tracks  --->', recScreenStream.getTracks());

                this.recScreenStream = recScreenStream;
                this.mediaRecorder = new MediaRecorder(recScreenStream, options);
                console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);

                this.initRecording();
            })
            .catch((err) => {
                this.handleRecordingError('Unable to record the screen + audio: ' + err, false);
            });
    }

    initRecording() {
        this._isRecording = true;
        this._isPaused = false;
        this.handleMediaRecorder();
        if (this.rc) {
            this.rc.event(this.rc.constructor.EVENTS ? 'startRec' : 'startRec');
            this._emitRcEvent('startRec');
        }
        this.recordingAction(this._enumRecording().start);
        this._playSound('recStart');
    }

    // ####################################################
    // AUDIO HELPERS
    // ####################################################

    hasAudioTrack(mediaStream) {
        if (!mediaStream) return false;
        const audioTracks = mediaStream.getAudioTracks();
        return audioTracks.length > 0;
    }

    hasVideoTrack(mediaStream) {
        if (!mediaStream) return false;
        const videoTracks = mediaStream.getVideoTracks();
        return videoTracks.length > 0;
    }

    getAudioTracksFromAudioElements() {
        const audioElements = document.querySelectorAll('audio');
        const audioTracks = [];
        audioElements.forEach((audio) => {
            // Exclude avatar Preview Audio and local producer audio (already captured via mic)
            if (audio.id !== 'avatarPreviewAudio' && audio.getAttribute('name') !== 'LOCAL-AUDIO') {
                const audioTrack = audio.srcObject?.getAudioTracks()[0];
                if (audioTrack) {
                    audioTracks.push(audioTrack);
                }
            }
        });
        return audioTracks;
    }

    getAudioStreamFromAudioElements() {
        const audioElements = document.querySelectorAll('audio');
        const audioStream = new MediaStream();
        audioElements.forEach((audio) => {
            // Exclude avatar Preview Audio
            if (audio.id === 'avatarPreviewAudio') return;
            const audioTrack = audio.srcObject?.getAudioTracks()[0];
            if (audioTrack) {
                audioStream.addTrack(audioTrack);
            }
        });
        // Also include the local microphone track so solo recordings have audio
        if (this.rc && this.rc.localAudioStream) {
            const micTrack = this.rc.localAudioStream.getAudioTracks()[0];
            if (micTrack) {
                audioStream.addTrack(micTrack);
            }
        }
        return audioStream;
    }

    // ####################################################
    // MEDIA RECORDER EVENT WIRING
    // ####################################################

    handleMediaRecorder() {
        if (this.mediaRecorder) {
            this.recServerFileName = this.getServerRecFileName();
            this.mediaRecorder.addEventListener('start', this._onMediaRecorderStart);
            this.mediaRecorder.addEventListener('dataavailable', this._onMediaRecorderData);
            this.mediaRecorder.addEventListener('stop', this._onMediaRecorderStop);
            this.recording.recSyncServerRecording
                ? this.mediaRecorder.start(this.recSyncTime)
                : this.mediaRecorder.start();
        }
    }

    // ####################################################
    // HELPERS
    // ####################################################

    generateUUIDv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
            (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
        );
    }

    getServerRecFileName() {
        const roomName = this.rc ? this.rc.room_id.trim() : 'unknown';
        const dateTime = typeof getDataTimeStringFormat === 'function' ? getDataTimeStringFormat() : Date.now();
        const uuid = this.generateUUIDv4();
        return `Rec_${roomName}_${dateTime}_${uuid}.webm`;
    }

    // ####################################################
    // MEDIA RECORDER CALLBACKS
    // (arrow functions to preserve `this` context)
    // ####################################################

    _onMediaRecorderStart = (evt) => {
        console.log('MediaRecorder started: ', evt);
        this.cleanLastRecordingInfo();
        this.disableRecordingOptions();
        this._recStartTs = performance.now();
    };

    _onMediaRecorderData = (evt) => {
        if (evt.data && evt.data.size > 0) {
            this.recording.recSyncServerRecording
                ? this.syncRecordingInCloud(evt.data)
                : this.recordedBlobs.push(evt.data);
        }
    };

    async syncRecordingInCloud(data) {
        const arrayBuffer = await data.arrayBuffer();
        const chunkSize = this.recSyncChunkSize;
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const chunk = arrayBuffer.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
            try {
                const response = await axios.post(
                    `${this.recording.recSyncServerEndpoint}/recSync?fileName=` + this.recServerFileName,
                    chunk,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream',
                        },
                    }
                );
                console.log('Chunk synced successfully:', response.data);
            } catch (error) {
                let errorMessage = 'Recording stopped! ';
                if (error.response) {
                    errorMessage += error.response.data.message;
                    console.error('Error syncing chunk', {
                        status_code: error.response.status,
                        response_data: error.response.data,
                        response_headers: error.response.headers,
                    });
                } else if (error.request) {
                    console.error('Error syncing chunk: No response received', { request_details: error.request });
                } else {
                    errorMessage += error.message;
                    console.error('Error syncing chunk:', error.message);
                }
                if (typeof userLog === 'function') {
                    userLog('warning', errorMessage, 'top-end', 3000);
                }
                this.stopRecording();
                this.saveLastRecordingInfo('<br/><span class="red">' + errorMessage + '.</span>');
            }
        }
    }

    _onMediaRecorderStop = async (evt) => {
        try {
            console.log('MediaRecorder stopped: ', evt);
            this.recording.recSyncServerRecording
                ? this.handleServerRecordingStop()
                : this.handleLocalRecordingStop();
            this.disableRecordingOptions(false);

            // If cloud sync is enabled, patch duration on the server
            if (this.recording.recSyncServerRecording) {
                const durationMs = this._recStartTs ? Math.round(performance.now() - this._recStartTs) : undefined;

                // Option S3: pass duration to your existing finalize endpoint
                if (this.recording.recSyncServerToS3) {
                    try {
                        await axios.post(`${this.recording.recSyncServerEndpoint}/recSyncFinalize`, null, {
                            params: { fileName: this.recServerFileName, durationMs },
                        });
                        console.log('Finalized (with duration fix) and uploaded to S3');
                        if (this.recShowInfo) {
                            if (typeof userLog === 'function') {
                                userLog('success', 'Recording successfully uploaded to S3.', 'top-end', 3000);
                            }
                        }
                    } catch (error) {
                        let errorMessage = 'Finalization failed! ';
                        if (error.response) errorMessage += error.response.data?.message || 'Server error';
                        else if (error.request) errorMessage += 'No response from server';
                        else errorMessage += error.message;
                        if (this.recShowInfo && typeof userLog === 'function') {
                            userLog('warning', errorMessage, 'top-end', 3000);
                        }
                    }
                } else {
                    // Option Disk: call a dedicated "fix" endpoint
                    try {
                        await axios.post(`${this.recording.recSyncServerEndpoint}/recSyncFixWebm`, null, {
                            params: { fileName: this.recServerFileName, durationMs },
                        });
                        console.log('Server-side WEBM duration fixed for', this.recServerFileName);
                    } catch (error) {
                        console.warn('WEBM duration server-side fix failed:', error?.message || error);
                    }
                }

                this._recStartTs = null;
            }
        } catch (err) {
            console.error('Recording save failed', err);
        }
    };

    // ####################################################
    // RECORDING OPTIONS UI
    // ####################################################

    disableRecordingOptions(disabled = true) {
        const switchServerRec = this.dom.get('switchServerRecording');
        const switchHostOnlyRec = this.dom.get('switchHostOnlyRecording');
        if (switchServerRec) switchServerRec.disabled = disabled;
        if (switchHostOnlyRec) switchHostOnlyRec.disabled = disabled;
    }

    toggleVideoAudioTabs(disabled = false) {
        const tabAudioDevicesBtn = this.dom.get('tabAudioDevicesBtn');
        const tabVideoDevicesBtn = this.dom.get('tabVideoDevicesBtn');
        if (tabAudioDevicesBtn) tabAudioDevicesBtn.disabled = disabled;
        if (tabVideoDevicesBtn) tabVideoDevicesBtn.disabled = disabled;
    }

    // ####################################################
    // WEBM DURATION FIX
    // ####################################################

    getWebmFixerFn() {
        const fn = window.FixWebmDuration;
        return typeof fn === 'function' ? fn : null;
    }

    // ####################################################
    // LOCAL RECORDING STOP HANDLER
    // ####################################################

    handleLocalRecordingStop() {
        console.log('MediaRecorder Blobs: ', this.recordedBlobs);

        const dateTime = typeof getDataTimeString === 'function' ? getDataTimeString() : Date.now();
        const type = this.recordedBlobs[0].type.includes('mp4') ? 'mp4' : 'webm';
        const rawBlob = new Blob(this.recordedBlobs, { type: 'video/' + type });
        const recFileName = `Rec_${dateTime}.${type}`;
        const currentDevice = this._isMobileDevice() ? 'MOBILE' : 'PC';
        const blobFileSize = typeof bytesToSize === 'function' ? bytesToSize(rawBlob.size) : rawBlob.size + ' bytes';
        const recTimeText = this._lastRecTimeText || '0s';
        const recType = 'Locally';
        const recordingInfo = `
        <br/><br/>
        <ul>
            <li>Stored: ${recType}</li>
            <li>Time: ${recTimeText}</li>
            <li>File: ${recFileName}</li>
            <li>Codecs: ${this.recCodecs}</li>
            <li>Size: ${blobFileSize}</li>
        </ul>
        <br/>
        `;
        const recordingMsg = `Please wait to be processed, then will be downloaded to your ${currentDevice} device.`;

        this.saveLastRecordingInfo(recordingInfo);
        this.showRecordingInfo(recType, recordingInfo, recordingMsg);

        // Fix WebM duration to make it seekable
        const fixWebmDuration = async (blob) => {
            if (type !== 'webm') return blob;
            try {
                const fix = this.getWebmFixerFn();
                const durationMs = this._recStartTs ? performance.now() - this._recStartTs : undefined;
                const fixed = await fix(blob, durationMs);
                return fixed || blob;
            } catch (e) {
                console.warn('WEBM duration fix failed, saving original blob:', e);
                return blob;
            } finally {
                this._recStartTs = null;
            }
        };

        (async () => {
            const finalBlob = await fixWebmDuration(rawBlob);
            this.saveRecordingInLocalDevice(finalBlob, recFileName);
        })();
    }

    // ####################################################
    // SERVER RECORDING STOP HANDLER
    // ####################################################

    handleServerRecordingStop() {
        console.log('MediaRecorder Stop');
        const recTimeText = this._lastRecTimeText || '0s';
        const recType = 'Server';
        const recordingInfo = `
        <br/><br/>
        <ul>
            <li>Stored: ${recType}</li>
            <li>Time: ${recTimeText}</li>
            <li>File: ${this.recServerFileName}</li>
            <li>Codecs: ${this.recCodecs}</li>
        </ul>
        <br/>
        `;
        this.saveLastRecordingInfo(recordingInfo);
        this.showRecordingInfo(recType, recordingInfo);
    }

    // ####################################################
    // RECORDING INFO UI
    // ####################################################

    saveLastRecordingInfo(recordingInfo) {
        const lastRecordingInfo = this.dom.get('lastRecordingInfo') || document.getElementById('lastRecordingInfo');
        if (lastRecordingInfo) {
            lastRecordingInfo.style.color = '#FFFFFF';
            lastRecordingInfo.innerHTML = `Last Recording Info: ${recordingInfo}`;
            if (typeof show === 'function') show(lastRecordingInfo);
        }
    }

    cleanLastRecordingInfo() {
        const lastRecordingInfo = this.dom.get('lastRecordingInfo') || document.getElementById('lastRecordingInfo');
        if (lastRecordingInfo) {
            lastRecordingInfo.innerHTML = '';
            if (typeof hide === 'function') hide(lastRecordingInfo);
        }
    }

    showRecordingInfo(recType, recordingInfo, recordingMsg = '') {
        if (!this.recShowInfo) return;
        if (window.localStorage.isReconnected === 'false') {
            const swalBackground = this.rc ? this.rc.swalBackground || 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.7)';
            Swal.fire({
                background: swalBackground,
                position: 'top',
                title: 'Recording',
                html: `<div style="text-align: left;">
                🔴 ${recType} Recording Info:
                ${recordingInfo}
                ${recordingMsg}
                </div>`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            });
        }
    }

    // ####################################################
    // LOCAL DEVICE DOWNLOAD
    // ####################################################

    saveRecordingInLocalDevice(blob, recFileName) {
        console.log('MediaRecorder Download Blobs');
        const url = window.URL.createObjectURL(blob);

        const downloadLink = document.createElement('a');
        downloadLink.style.display = 'none';
        downloadLink.href = url;
        downloadLink.download = recFileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();

        setTimeout(() => {
            document.body.removeChild(downloadLink);
            window.URL.revokeObjectURL(url);
            console.log(`Recording FILE: ${recFileName} done`);
            this.recordedBlobs = [];
        }, 100);
    }

    // ####################################################
    // PAUSE / RESUME
    // ####################################################

    pauseRecording() {
        if (this.mediaRecorder) {
            this._isRecording = false;
            this._isPaused = true;
            this.mediaRecorder.pause();
            this._emitRcEvent('pauseRec');
            this.recordingAction('Pause recording');
        }
    }

    resumeRecording() {
        if (this.mediaRecorder) {
            this._isRecording = true;
            this._isPaused = false;
            this.mediaRecorder.resume();
            this._emitRcEvent('resumeRec');
            this.recordingAction('Resume recording');
        }
    }

    // ####################################################
    // STOP RECORDING
    // ####################################################

    stopRecording() {
        if (this.mediaRecorder) {
            this.toggleVideoAudioTabs(false);
            // Capture the elapsed time text BEFORE stopRec event resets it to '0s'
            const recTimeEl = this.dom.get('recordingStatus') || document.getElementById('recordingStatus');
            this._lastRecTimeText = recTimeEl ? recTimeEl.innerText : '0s';
            this._isRecording = false;
            this._isPaused = false;
            this.mediaRecorder.stop();
            this.mediaRecorder = null;
            if (this.recScreenStream) {
                this.recScreenStream.getTracks().forEach((track) => {
                    if (track.kind === 'video') track.stop();
                });
            }
            if (this._isMobileDevice() && this.rc) {
                const swapBtn = this.rc.getId('swapCameraButton');
                if (swapBtn) swapBtn.className = '';
            }
            this._emitRcEvent('stopRec');
            if (this.audioRecorder) {
                this.audioRecorder.stopMixedAudioStream();
            }
            this.recordingAction(this._enumRecording().stop);
            this._playSound('recStop');
        }
    }

    // ####################################################
    // SOCKET SIGNALLING
    // ####################################################

    recordingAction(action) {
        if (this.rc && !this.rc.thereAreParticipants()) return;
        if (this.socket) {
            this.socket.emit('recordingAction', {
                peer_name: this.rc ? this.rc.peer_name : 'unknown',
                peer_id: this.rc ? this.rc.peer_id : 'unknown',
                action: action,
            });
        }
    }

    handleRecordingAction(data) {
        console.log('Handle recording action', data);

        const { peer_name, peer_avatar, peer_id, action } = data;

        if (this.rc) {
            const recAction = {
                side: 'left',
                img: this.rc.leftMsgAvatar,
                peer_name: peer_name,
                peer_avatar: peer_avatar,
                peer_id: peer_id,
                peer_msg: `🔴 ${action}`,
                to_peer_id: 'all',
                to_peer_name: 'all',
            };
            this.rc.showMessage(recAction, false);

            const recData = {
                type: 'recording',
                action: action,
                peer_name: peer_name,
            };

            const imageUrl = this._getRecordingImage();
            const iconsUser = this._getIconsUser();

            this.rc.msgHTML(
                recData,
                null,
                imageUrl,
                null,
                `${iconsUser} ${peer_name}
                <br /><br />
                <span>🔴 ${action}</span>
                <br />`
            );
        }
    }

    // ####################################################
    // SAVE RECORDING (convenience wrapper)
    // ####################################################

    saveRecording(reason) {
        if (this._isRecording || this.hasActiveRecorder()) {
            console.log(`Save recording: ${reason}`);
            this.stopRecording();
        }
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    /**
     * Stop any active recording, release MediaRecorder resources,
     * clear timers, and detach socket listeners.
     */
    close() {
        // Stop recording if active
        if (this._isRecording || this.hasActiveRecorder()) {
            try {
                this.stopRecording();
            } catch (err) {
                console.warn('Error stopping recording during close:', err);
            }
        }

        // Clear timer
        this.stopRecordingTimer();

        // Release screen stream tracks
        if (this.recScreenStream) {
            this.recScreenStream.getTracks().forEach((track) => track.stop());
            this.recScreenStream = null;
        }

        // Detach socket listener
        if (this.socket) {
            this.socket.off('recordingAction');
        }

        // Clear blobs
        this.recordedBlobs = [];
        this.mediaRecorder = null;
        this.audioRecorder = null;
        this._isRecording = false;
        this._isPaused = false;
        this._recStartTs = null;
    }

    // ####################################################
    // PRIVATE HELPERS
    // ####################################################

    _isMobileDevice() {
        return this.rc ? this.rc.isMobileDevice : false;
    }

    _getRecordingImage() {
        // Mirrors the `image.recording` constant from RoomClient.js
        return '../images/recording.png';
    }

    _getIconsUser() {
        return '<i class="fas fa-user"></i>';
    }

    _enumRecording() {
        return {
            started: 'Started conference recording',
            start: 'Start conference recording',
            stop: 'Stop conference recording',
        };
    }

    _playSound(soundName) {
        if (this.rc && typeof this.rc.sound === 'function') {
            this.rc.sound(soundName);
        }
    }

    _emitRcEvent(eventName) {
        if (this.rc && typeof this.rc.event === 'function') {
            this.rc.event(eventName);
        }
    }
}

// Export for ES module environments; also attach to window for
// script-tag usage in the existing vanilla-JS frontend.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RecordingManager;
}
if (typeof window !== 'undefined') {
    window.RecordingManager = RecordingManager;
}
