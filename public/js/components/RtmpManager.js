'use strict';

/**
 * RtmpManager
 *
 * Encapsulates all RTMP streaming logic previously spread across
 * RoomClient.js, including:
 *   - RTMP from file: getRTMP, startRTMP, stopRTMP, endRTMP, errorRTMP
 *   - RTMP from URL: startRTMPfromURL, stopRTMPfromURL, endRTMPfromURL,
 *     errorRTMPfromURL
 *   - Common helpers: openRTMPStreamer, isRTMPVideoSupported, copyRTMPUrl,
 *     cleanRTMPUrl, showRTMP
 *   - Socket signalling for endRTMP, errorRTMP, endRTMPfromURL,
 *     errorRTMPfromURL
 */
class RtmpManager {
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
        this.rtmpFileStreamer = false;
        this.rtmpUrlStreamer = false;
        this.selectedRtmpFilename = '';

        // Populated by init()
        this.socket = null;
        this.rc = null;
    }

    // ####################################################
    // INITIALISATION
    // ####################################################

    /**
     * Wire up socket events and keep a back-reference to the
     * legacy RoomClient instance for backward compatibility.
     *
     * @param {object} socketManager – socket.io client instance
     * @param {object} rc            – RoomClient instance
     */
    init(socketManager, rc) {
        this.socket = socketManager;
        this.rc = rc;
    }

    // ##############################################
    // RTMP from FILE
    // ##############################################

    /**
     * Fetch the list of RTMP-streamable files from the server
     * and populate the file-list table in the UI. Clicking a
     * file row selects it as the file to stream.
     */
    getRTMP() {
        const self = this;
        this.socket.request('getRTMP').then(function (filenames) {
            console.log('RTMP files', filenames);
            if (filenames.length === 0) {
                const fileNameDiv = self.rc.getId('file-name');
                if (fileNameDiv) fileNameDiv.textContent = 'No file found to stream';
            }

            const fileListTbody = self.rc.getId('file-list');
            if (fileListTbody) fileListTbody.innerHTML = '';

            filenames.forEach((filename) => {
                const fileRow = document.createElement('tr');
                const fileCell = document.createElement('td');
                fileCell.textContent = filename;
                fileCell.className = 'file-item';
                fileCell.onclick = () => showFilename(fileCell, filename);
                fileRow.appendChild(fileCell);
                if (fileListTbody) fileListTbody.appendChild(fileRow);
            });

            function showFilename(clickedItem, filename) {
                const fileNameDiv = self.rc.getId('file-name');
                if (fileNameDiv) fileNameDiv.textContent = `Selected file: ${filename}`;
                self.selectedRtmpFilename = filename;
                const fileItems = document.querySelectorAll('.file-item');
                fileItems.forEach((item) => item.classList.remove('selected'));

                if (clickedItem) {
                    clickedItem.classList.add('selected');
                }
            }
        });
    }

    /**
     * Start RTMP streaming of the selected file. Validates that the
     * selected file has a supported extension, then sends a socket
     * request to start the stream on the server.
     */
    async startRTMP() {
        if (!this.isRTMPVideoSupported(filterXSS(this.selectedRtmpFilename))) {
            const fileNameDiv = this.rc.getId('file-name');
            if (fileNameDiv) fileNameDiv.textContent = '';
            return this.rc.userLog(
                'warning',
                "The provided File is not valid. Please ensure it's .mp4, webm or ogg video file",
                'top-end',
            );
        }

        const self = this;
        this.socket
            .request('startRTMP', {
                file: filterXSS(this.selectedRtmpFilename),
                peer_name: filterXSS(this.rc.peer_name),
                peer_uuid: filterXSS(this.rc.peer_uuid),
            })
            .then(function (rtmp) {
                self.rc.event(_EVENTS.startRTMP);
                self.showRTMP(rtmp, 'file');
                self.rtmpFileStreamer = true;
            });
    }

    /**
     * Stop the current RTMP file stream. Sends a socket request
     * and cleans up local state.
     */
    stopRTMP() {
        if (this.rtmpFileStreamer) {
            this.socket.request('stopRTMP');
            this.rtmpFileStreamer = false;
            this.cleanRTMPUrl();
            console.log('RTMP STOP');
            this.rc.event(_EVENTS.stopRTMP);
        }
    }

    /**
     * Handle the server notification that the RTMP file stream
     * has ended normally.
     *
     * @param {object} data – { rtmpUrl }
     */
    endRTMP(data) {
        const rtmpMessage = `${data.rtmpUrl} processing finished!`;
        this.rtmpFileStreamer = false;
        this.rc.userLog('info', rtmpMessage, 'top-end');
        console.log(rtmpMessage);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMP');
        this.rc.event(_EVENTS.endRTMP);
    }

    /**
     * Handle the server notification that the RTMP file stream
     * encountered an error.
     *
     * @param {object} data – { message }
     */
    errorRTMP(data) {
        const rtmpError = `${data.message}`;
        this.rtmpFileStreamer = false;
        this.rc.userLog('error', rtmpError, 'top-end');
        console.error(rtmpError);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMP');
        this.rc.event(_EVENTS.endRTMP);
    }

    // ##############################################
    // RTMP from URL
    // ##############################################

    /**
     * Start RTMP streaming from a remote URL. Validates the URL
     * and sends a socket request to the server.
     *
     * @param {string} inputVideoURL – the URL of the video to stream
     */
    startRTMPfromURL(inputVideoURL) {
        if (!this.isRTMPVideoSupported(filterXSS(inputVideoURL))) {
            const rtmpStreamURL = this.rc.getId('rtmpStreamURL');
            if (rtmpStreamURL) rtmpStreamURL.value = '';
            return this.rc.userLog(
                'warning',
                'The provided URL is not valid. Please ensure it links to an .mp4 video file',
                'top-end',
            );
        }

        const self = this;
        this.socket
            .request('startRTMPfromURL', {
                inputVideoURL: filterXSS(inputVideoURL),
                peer_name: filterXSS(this.rc.peer_name),
                peer_uuid: filterXSS(this.rc.peer_uuid),
            })
            .then(function (rtmp) {
                self.rc.event(_EVENTS.startRTMPfromURL);
                self.showRTMP(rtmp, 'url');
                self.rtmpUrlStreamer = true;
            });
    }

    /**
     * Stop the current RTMP URL stream. Sends a socket request
     * and cleans up local state.
     */
    stopRTMPfromURL() {
        if (this.rtmpUrlStreamer) {
            this.socket.request('stopRTMPfromURL');
            this.rtmpUrlStreamer = false;
            this.cleanRTMPUrl();
            console.log('RTMP from URL STOP');
            this.rc.event(_EVENTS.stopRTMPfromURL);
        }
    }

    /**
     * Handle the server notification that the RTMP URL stream
     * has ended normally.
     *
     * @param {object} data – { rtmpUrl }
     */
    endRTMPfromURL(data) {
        const rtmpMessage = `${data.rtmpUrl} processing finished!`;
        this.rtmpUrlStreamer = false;
        this.rc.userLog('info', rtmpMessage, 'top-end');
        console.log(rtmpMessage);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMPfromURL');
        this.rc.event(_EVENTS.endRTMPfromURL);
    }

    /**
     * Handle the server notification that the RTMP URL stream
     * encountered an error.
     *
     * @param {object} data – { message }
     */
    errorRTMPfromURL(data) {
        const rtmpError = `${data.message}`;
        this.rtmpUrlStreamer = false;
        this.rc.userLog('error', rtmpError, 'top-end');
        console.error(rtmpError);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMPfromURL');
        this.rc.event(_EVENTS.endRTMPfromURL);
    }

    // ##############################################
    // RTMP common
    // ##############################################

    /**
     * Open the standalone RTMP streamer page in a new tab,
     * passing the current device and quality selections as
     * query parameters.
     */
    openRTMPStreamer() {
        const videoSelect = this.dom.get('videoSelect');
        const microphoneSelect = this.dom.get('microphoneSelect');
        const videoQuality = this.dom.get('videoQuality');
        const videoFps = this.dom.get('videoFps');
        const screenFps = this.dom.get('screenFps');
        const selectTheme = this.dom.get('selectTheme');

        const themeColor = encodeURIComponent(themeCustom.color);

        const options =
            `&vr=${videoQuality ? videoQuality.value : ''}` +
            `&vf=${videoFps ? videoFps.value : ''}` +
            `&sf=${screenFps ? screenFps.value : ''}` +
            `&ts=${selectTheme ? selectTheme.value : ''}` +
            (themeCustom.keep ? `&tc=${themeColor}` : '');

        const url =
            `/rtmp?v=${videoSelect ? videoSelect.value : ''}` +
            `&a=${microphoneSelect ? microphoneSelect.value : ''}${options}`;

        openURL(url, true);
    }

    /**
     * Check whether a filename or URL points to a supported
     * RTMP video format (.mp4 or .webm).
     *
     * @param {string} video – filename or URL
     * @returns {boolean}
     */
    isRTMPVideoSupported(video) {
        if (video.endsWith('.mp4') || video.endsWith('.webm')) return true;
        return false;
    }

    /**
     * Copy an RTMP URL to the clipboard.
     *
     * @param {string} url – the RTMP URL to copy
     */
    copyRTMPUrl(url) {
        if (!url) return this.rc.userLog('info', 'No RTMP URL detected', 'top-end');
        copyToClipboard(url);
    }

    /**
     * Clear the RTMP live URL input field.
     */
    cleanRTMPUrl() {
        const rtmpUrl = this.rc.getId('rtmpLiveUrl');
        if (rtmpUrl) rtmpUrl.value = '';
    }

    /**
     * Display the RTMP live URL in a SweetAlert popup with a
     * copy-to-clipboard button. If the RTMP URL is falsy, shows
     * a warning and fires the appropriate end event.
     *
     * @param {string} rtmp – the RTMP streaming URL
     * @param {string} type – 'file' or 'url'
     */
    showRTMP(rtmp, type = 'file') {
        console.log('rtmp', rtmp);

        if (!rtmp) {
            switch (type) {
                case 'file':
                    this.rc.event(_EVENTS.endRTMP);
                    break;
                case 'url':
                    this.rc.event(_EVENTS.endRTMPfromURL);
                    break;
                default:
                    break;
            }
            return this.rc.userLog(
                'warning',
                'Unable to start the RTMP stream. Please ensure the RTMP server is running. If the problem persists, contact the administrator',
                'top-end',
                6000,
            );
        }

        const rtmpUrl = this.rc.getId('rtmpLiveUrl');
        if (rtmpUrl) rtmpUrl.value = filterXSS(rtmp);

        Swal.fire({
            background: swalBackground,
            imageUrl: image.rtmp,
            position: 'center',
            title: 'LIVE',
            html: `
                <p style="background:transparent; color:rgb(8, 189, 89);">${rtmp}</p>
                `,
            showDenyButton: false,
            showCancelButton: false,
            confirmButtonText: 'Copy URL',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                copyToClipboard(rtmp);
            }
        });
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    /**
     * Tear down any resources held by this manager.
     * Stops any active RTMP streams and unregisters socket listeners.
     */
    close() {
        if (this.rtmpFileStreamer) {
            this.stopRTMP();
        }
        if (this.rtmpUrlStreamer) {
            this.stopRTMPfromURL();
        }

        // Socket event listeners for endRTMP, errorRTMP, endRTMPfromURL,
        // and errorRTMPfromURL are managed by RoomClient.js
        this.rc = null;
        this.socket = null;
    }
}
