'use strict';

/**
 * FileShareManager
 *
 * Encapsulates all file-sharing and video-URL-sharing logic previously
 * spread across RoomClient.js and Room.js, including:
 *   - File selection dialog (selectFileToShare) with drag-and-drop
 *   - File send (sendFileInformations, sendFileData, sendFSData)
 *   - File receive (handleFileInfo, handleFile, endFileDownload)
 *   - File transfer abort (abortFileTransfer, abortReceiveFileTransfer,
 *     handleFileAbort, handleReceiveFileAbort, hideFileTransfer)
 *   - Drag-and-drop on video elements (handleDD, handleSF)
 *   - Video/audio URL sharing (shareVideo, shareVideoAction, openVideo,
 *     closeVideo, getVideoType, isVideoTypeSupported, getYoutubeEmbed)
 *   - Socket signalling for fileInfo, file, fileAbort, receiveFileAbort,
 *     shareVideoAction
 *   - Utility helpers (saveBlobToFile, bytesToSize, isValidFileName)
 */
class FileShareManager {
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
        this.fileToSend = null;
        this.fileReader = null;
        this.sendInProgress = false;
        this.receiveInProgress = false;
        this.incomingFileInfo = null;
        this.incomingFileData = [];
        this.receiveBuffer = [];
        this.receivedSize = 0;
        this.fileSharingInput = '*';
        this.chunkSize = 1024 * 16; // 16kb/s

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

        // Copy config from rc if present
        if (rc.fileSharingInput !== undefined) this.fileSharingInput = rc.fileSharingInput;
        if (rc.chunkSize !== undefined) this.chunkSize = rc.chunkSize;
    }

    // ####################################################
    // HANDLE SF BUTTON (SEND FILE FROM VIDEO MENU)
    // ####################################################

    /**
     * Attach click handler to a "send file" button on a video element.
     * The uid follows the pattern: prefix___peerId___sendFile
     *
     * @param {string} uid – the button element ID
     */
    handleSF(uid) {
        const words = uid.split('___');
        let peer_id = words[1];
        let btnSf = this.rc.getId(uid);
        if (btnSf) {
            btnSf.addEventListener('click', () => {
                this.selectFileToShare(peer_id);
            });
        }
    }

    // ####################################################
    // HANDLE SV BUTTON (SEND VIDEO FROM VIDEO MENU)
    // ####################################################

    /**
     * Attach click handler to a "send video" button on a video element.
     *
     * @param {string} uid – the button element ID
     */
    handleSV(uid) {
        const words = uid.split('___');
        let peer_id = words[1];
        let btnSv = this.rc.getId(uid);
        if (btnSv) {
            btnSv.addEventListener('click', () => {
                this.shareVideo(peer_id);
            });
        }
    }

    // ####################################################
    // DRAG AND DROP ON VIDEO ELEMENTS
    // ####################################################

    /**
     * Attach drag-and-drop file sending to a video player element.
     * When a file is dropped, it is sent to the specified peer.
     *
     * @param {string}  uid     – the video container element ID
     * @param {string}  peer_id – the target peer's ID
     * @param {boolean} itsMe   – true if this is the local user's video
     */
    handleDD(uid, peer_id, itsMe = false) {
        const self = this;
        let videoPlayer = this.rc.getId(uid);
        if (videoPlayer) {
            videoPlayer.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.target.parentElement.style.outline = 'dashed var(--dd-color)';
            });

            videoPlayer.addEventListener('dragleave', function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.target.parentElement.style.outline = 'none';
            });

            videoPlayer.addEventListener('drop', function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.target.parentElement.style.outline = 'none';
                if (itsMe) {
                    return userLog('warning', 'You cannot send files to yourself.', 'top-end');
                }
                if (self.sendInProgress) {
                    return userLog('warning', 'Please wait for the previous file to be sent.', 'top-end');
                }
                if (e.dataTransfer.items && e.dataTransfer.items.length > 1) {
                    return userLog('warning', 'Please drag and drop a single file.', 'top-end');
                }
                if (e.dataTransfer.items) {
                    let item = e.dataTransfer.items[0].webkitGetAsEntry();
                    console.log('Drag and drop', item);
                    if (item.isDirectory) {
                        return userLog('warning', 'Please drag and drop a single file not a folder.', 'top-end');
                    }
                    var file = e.dataTransfer.items[0].getAsFile();
                    self.sendFileInformations(file, peer_id);
                } else {
                    self.sendFileInformations(e.dataTransfer.files[0], peer_id);
                }
            });
        }
    }

    // ####################################################
    // SELECT FILE TO SHARE (DIALOG)
    // ####################################################

    /**
     * Open a SweetAlert dialog for the user to select a file or
     * drag-and-drop a file. Once selected, the file is sent via
     * sendFileInformations.
     *
     * @param {string}  peer_id   – the target peer ID or socket.id for all
     * @param {boolean} broadcast – if true, send to all participants
     */
    selectFileToShare(peer_id, broadcast = false) {
        this.rc.sound('open');
        const self = this;

        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            imageAlt: 'mirotalksfu-file-sharing',
            imageUrl: image.share,
            position: 'center',
            title: 'Share file',
            input: 'file',
            html: `
            <div id="dropArea">
                <p>Drag and drop your file here</p>
            </div>
            `,
            inputAttributes: {
                accept: this.fileSharingInput,
                'aria-label': 'Select file',
            },
            didOpen: () => {
                const dropArea = document.getElementById('dropArea');
                dropArea.addEventListener('dragenter', handleDragEnter);
                dropArea.addEventListener('dragover', handleDragOver);
                dropArea.addEventListener('dragleave', handleDragLeave);
                dropArea.addEventListener('drop', handleDrop);
            },
            showDenyButton: true,
            confirmButtonText: 'Send',
            denyButtonText: 'Cancel',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                self.sendFileInformations(result.value, peer_id, broadcast);
            }
        });

        function handleDragEnter(e) {
            e.preventDefault();
            e.stopPropagation();
            e.target.style.background = 'var(--body-bg)';
        }

        function handleDragOver(e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        }

        function handleDragLeave(e) {
            e.preventDefault();
            e.stopPropagation();
            e.target.style.background = '';
        }

        function handleDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
            e.target.style.background = '';
        }

        function handleFiles(files) {
            if (files.length > 0) {
                const file = files[0];
                console.log('Selected file:', file);
                Swal.close();
                self.sendFileInformations(file, peer_id, broadcast);
            }
        }
    }

    // ####################################################
    // SEND FILE
    // ####################################################

    /**
     * Validate and prepare a file for transfer. Emits file metadata
     * via the 'fileInfo' socket event, then starts sending data chunks.
     *
     * @param {File}    file      – the File object to send
     * @param {string}  peer_id   – the target peer ID
     * @param {boolean} broadcast – if true, send to all participants
     */
    sendFileInformations(file, peer_id, broadcast = false) {
        if (this.isFileReaderRunning()) {
            return this.rc.userLog('warning', 'File transfer in progress. Please wait until it completes', 'top-end');
        }
        this.fileToSend = file;

        if (this.fileToSend && this.fileToSend.size > 0) {
            if (!this.rc.thereAreParticipants()) {
                return userLog('info', 'No participants detected', 'top-end');
            }
            // prevent XSS injection
            if (this.rc.isHtml(this.fileToSend.name) || !this.isValidFileName(this.fileToSend.name)) {
                return userLog('warning', 'Invalid file name!', 'top-end', 5000);
            }

            const fileInfo = {
                peer_id: peer_id,
                broadcast: broadcast,
                peer_name: this.rc.peer_name,
                peer_avatar: this.rc.peer_avatar,
                fileName: this.fileToSend.name,
                fileSize: this.fileToSend.size,
                fileType: this.fileToSend.type,
            };
            this.rc.setMsgAvatar('left', this.rc.peer_name, this.rc.peer_avatar);
            this.rc.appendMessage(
                'left',
                this.rc.leftMsgAvatar,
                this.rc.peer_name,
                this.rc.peer_id,
                `${icons.fileSend} File send:
                <br/>
                <ul>
                    <li>Name: ${this.fileToSend.name}</li>
                    <li>Size: ${this.bytesToSize(this.fileToSend.size)}</li>
                </ul>`,
                'all',
                'all',
            );
            // send some metadata about our file to peers in the room
            this.socket.emit('fileInfo', fileInfo);
            setTimeout(() => {
                this.sendFileData(peer_id, broadcast);
            }, 1000);
        } else {
            userLog('error', 'File not selected or empty.', 'top-end');
        }
    }

    /**
     * Read the selected file in chunks and emit each chunk via
     * the 'file' socket event. Updates the send progress UI.
     *
     * @param {string}  peer_id   – the target peer ID
     * @param {boolean} broadcast – if true, send to all participants
     */
    sendFileData(peer_id, broadcast) {
        console.log('Send file ', {
            name: this.fileToSend.name,
            size: this.bytesToSize(this.fileToSend.size),
            type: this.fileToSend.type,
        });

        this.sendInProgress = true;

        const sendFileInfo = this.dom.get('sendFileInfo');
        const sendFileDiv = this.dom.get('sendFileDiv');
        const sendProgress = this.dom.get('sendProgress');
        const sendFilePercentage = this.dom.get('sendFilePercentage');

        if (sendFileInfo) {
            sendFileInfo.innerText =
                'File name: ' +
                this.fileToSend.name +
                html.newline +
                'File type: ' +
                this.fileToSend.type +
                html.newline +
                'File size: ' +
                this.bytesToSize(this.fileToSend.size) +
                html.newline;
        }

        if (sendFileDiv) sendFileDiv.style.display = 'inline';
        if (sendProgress) sendProgress.max = this.fileToSend.size;

        this.fileReader = new FileReader();
        let offset = 0;

        this.fileReader.addEventListener('error', (err) => console.error('fileReader error', err));
        this.fileReader.addEventListener('abort', (e) => console.log('fileReader aborted', e));
        this.fileReader.addEventListener('load', (e) => {
            if (!this.sendInProgress) return;

            let data = {
                peer_id: peer_id,
                broadcast: broadcast,
                fileData: e.target.result,
            };
            this.sendFSData(data);
            offset += data.fileData.byteLength;

            if (sendProgress) sendProgress.value = offset;
            if (sendFilePercentage) {
                sendFilePercentage.innerText =
                    'Send progress: ' + ((offset / this.fileToSend.size) * 100).toFixed(2) + '%';
            }

            // send file completed
            if (offset === this.fileToSend.size) {
                this.sendInProgress = false;
                if (sendFileDiv) sendFileDiv.style.display = 'none';
                userLog('success', 'The file ' + this.fileToSend.name + ' was sent successfully.', 'top-end');
            }

            if (offset < this.fileToSend.size) readSlice(offset);
        });
        const readSlice = (o) => {
            const slice = this.fileToSend.slice(offset, o + this.chunkSize);
            this.fileReader.readAsArrayBuffer(slice);
        };
        readSlice(0);
    }

    /**
     * Emit a file data chunk over the socket.
     *
     * @param {object} data – { peer_id, broadcast, fileData }
     */
    sendFSData(data) {
        if (data) this.socket.emit('file', data);
    }

    // ####################################################
    // RECEIVE FILE
    // ####################################################

    /**
     * Handle incoming file metadata from a peer.
     * Prepares the receive buffer and updates the receive progress UI.
     *
     * @param {object} data – file info from the sender
     */
    handleFileInfo(data) {
        this.incomingFileInfo = data;
        this.incomingFileData = [];
        this.receiveBuffer = [];
        this.receivedSize = 0;

        let fileToReceiveInfo =
            ' From: ' +
            this.incomingFileInfo.peer_name +
            html.newline +
            ' Incoming file: ' +
            this.incomingFileInfo.fileName +
            html.newline +
            ' File type: ' +
            this.incomingFileInfo.fileType +
            html.newline +
            ' File size: ' +
            this.bytesToSize(this.incomingFileInfo.fileSize);

        this.rc.setMsgAvatar('right', this.incomingFileInfo.peer_name, this.incomingFileInfo.peer_avatar);
        this.rc.appendMessage(
            'right',
            this.rc.rightMsgAvatar,
            this.incomingFileInfo.peer_name,
            this.incomingFileInfo.peer_id,
            `${icons.fileReceive} File receive:
            <br/>
            <ul>
                <li>From: ${this.incomingFileInfo.peer_name}</li>
                <li>Id: ${this.incomingFileInfo.peer_id}</li>
                <li>Name: ${this.incomingFileInfo.fileName}</li>
                <li>Size: ${this.bytesToSize(this.incomingFileInfo.fileSize)}</li>
            </ul>`,
            'all',
            'all',
        );

        const receiveFileInfo = this.dom.get('receiveFileInfo');
        const receiveFileDiv = this.dom.get('receiveFileDiv');
        const receiveProgress = this.dom.get('receiveProgress');

        if (receiveFileInfo) receiveFileInfo.innerText = fileToReceiveInfo;
        if (receiveFileDiv) receiveFileDiv.style.display = 'inline';
        if (receiveProgress) receiveProgress.max = this.incomingFileInfo.fileSize;

        this.rc.userLog('info', fileToReceiveInfo, 'top-end');
        this.receiveInProgress = true;
    }

    /**
     * Handle an incoming file data chunk. Accumulates chunks in the
     * receive buffer and triggers download when complete.
     *
     * @param {object} data – { fileData: ArrayBuffer }
     */
    handleFile(data) {
        if (!this.receiveInProgress) return;
        this.receiveBuffer.push(data.fileData);
        this.receivedSize += data.fileData.byteLength;

        const receiveProgress = this.dom.get('receiveProgress');
        const receiveFilePercentage = this.dom.get('receiveFilePercentage');
        const receiveFileDiv = this.dom.get('receiveFileDiv');

        if (receiveProgress) receiveProgress.value = this.receivedSize;
        if (receiveFilePercentage) {
            receiveFilePercentage.innerText =
                'Receive progress: ' +
                ((this.receivedSize / this.incomingFileInfo.fileSize) * 100).toFixed(2) +
                '%';
        }
        if (this.receivedSize === this.incomingFileInfo.fileSize) {
            if (receiveFileDiv) receiveFileDiv.style.display = 'none';
            this.incomingFileData = this.receiveBuffer;
            this.receiveBuffer = [];
            this.endFileDownload();
        }
    }

    /**
     * Finalise a completed file download. Prompts the user with a
     * SweetAlert dialog showing an image preview (if applicable) and
     * a Save/Cancel choice.
     */
    endFileDownload() {
        this.rc.sound('download');

        // save received file into Blob
        const blob = new Blob(this.incomingFileData);
        const file = this.incomingFileInfo.fileName;

        this.incomingFileData = [];

        // if file is image, show the preview
        if (isImageURL(this.incomingFileInfo.fileName)) {
            const reader = new FileReader();
            reader.onload = (e) => {
                Swal.fire({
                    allowOutsideClick: false,
                    background: swalBackground,
                    position: 'center',
                    title: 'Received file',
                    text: this.incomingFileInfo.fileName + ' size ' + this.bytesToSize(this.incomingFileInfo.fileSize),
                    imageUrl: e.target.result,
                    imageAlt: 'mirotalksfu-file-img-download',
                    showDenyButton: true,
                    confirmButtonText: 'Save',
                    denyButtonText: 'Cancel',
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                }).then((result) => {
                    if (result.isConfirmed) this.saveBlobToFile(blob, file);
                });
            };
            reader.readAsDataURL(blob);
        } else {
            Swal.fire({
                allowOutsideClick: false,
                background: swalBackground,
                position: 'center',
                title: 'Received file',
                text: this.incomingFileInfo.fileName + ' size ' + this.bytesToSize(this.incomingFileInfo.fileSize),
                showDenyButton: true,
                confirmButtonText: 'Save',
                denyButtonText: 'Cancel',
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) this.saveBlobToFile(blob, file);
            });
        }
    }

    // ####################################################
    // ABORT FILE TRANSFER
    // ####################################################

    /**
     * Abort an outgoing file transfer. Stops the FileReader, hides
     * the send progress UI, and notifies peers.
     */
    abortFileTransfer() {
        if (this.isFileReaderRunning()) {
            this.fileReader.abort();
            const sendFileDiv = this.dom.get('sendFileDiv');
            if (sendFileDiv) sendFileDiv.style.display = 'none';
            this.sendInProgress = false;
            this.socket.emit('fileAbort', {
                peer_name: this.rc.peer_name,
            });
        }
    }

    /**
     * Abort an incoming file transfer. Notifies the sender and
     * cleans up the receive state.
     */
    abortReceiveFileTransfer() {
        const data = { peer_name: this.rc.peer_name };
        this.socket.emit('receiveFileAbort', data);
        setTimeout(() => {
            this.handleFileAbort(data);
        }, 1000);
    }

    /**
     * Hide the receive file transfer UI element.
     */
    hideFileTransfer() {
        const receiveFileDiv = this.dom.get('receiveFileDiv');
        if (receiveFileDiv) receiveFileDiv.style.display = 'none';
    }

    /**
     * Check whether the FileReader is currently reading.
     *
     * @returns {boolean}
     */
    isFileReaderRunning() {
        return this.fileReader && this.fileReader.readyState === 1;
    }

    /**
     * Handle notification that the receiving peer aborted the transfer.
     * Stops the FileReader if running, otherwise cleans up receive state.
     *
     * @param {object} data – { peer_name }
     */
    handleReceiveFileAbort(data) {
        if (this.isFileReaderRunning()) {
            this.rc.userLog('info', data.peer_name + ' ⚠️ aborted file transfer', 'top-end');
            this.fileReader.abort();
            const sendFileDiv = this.dom.get('sendFileDiv');
            if (sendFileDiv) sendFileDiv.style.display = 'none';
            this.sendInProgress = false;
        } else {
            this.handleFileAbort(data);
        }
    }

    /**
     * Clean up state when a file transfer is aborted.
     *
     * @param {object} data – { peer_name }
     */
    handleFileAbort(data) {
        this.receiveBuffer = [];
        this.incomingFileData = [];
        this.receivedSize = 0;
        this.receiveInProgress = false;
        const receiveFileDiv = this.dom.get('receiveFileDiv');
        if (receiveFileDiv) receiveFileDiv.style.display = 'none';
        console.log(data.peer_name + ' aborted the file transfer');
        this.rc.userLog('info', data.peer_name + ' ⚠️ aborted the file transfer', 'top-end');
    }

    // ####################################################
    // SHARE VIDEO YOUTUBE - MP4 - WEBM - OGG or AUDIO mp3
    // ####################################################

    /**
     * Open a SweetAlert dialog to enter a video/audio URL and share
     * it with peers. Supports YouTube, MP4, WebM, OGG, and MP3.
     *
     * @param {string} peer_id – the target peer ID (default: 'all')
     */
    shareVideo(peer_id = 'all') {
        if (this.rc._moderator.media_cant_sharing) {
            return userLog('warning', 'The moderator does not allow you to share any media', 'top-end', 6000);
        }

        this.rc.sound('open');
        const self = this;

        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: image.videoShare,
            title: 'Share a Video or Audio',
            text: 'Paste a Video or Audio URL',
            input: 'text',
            showCancelButton: true,
            confirmButtonText: 'Share',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.value) {
                result.value = filterXSS(result.value);
                if (!self.isVideoTypeSupported(result.value)) {
                    return userLog('warning', 'Something wrong, try with another Video or audio URL');
                }
                let is_youtube = self.getVideoType(result.value) == 'na' ? true : false;
                let video_url = is_youtube ? self.getYoutubeEmbed(result.value) : result.value;
                if (video_url) {
                    let data = {
                        peer_id: peer_id,
                        peer_name: self.rc.peer_name,
                        video_url: video_url,
                        is_youtube: is_youtube,
                        action: 'open',
                    };
                    console.log('Video URL: ', video_url);
                    self.socket.emit('shareVideoAction', data);
                    self.openVideo(data);
                } else {
                    self.rc.userLog('error', 'Not valid video URL', 'top-end', 6000);
                }
            }
        });

        // Take URL from clipboard
        navigator.clipboard
            .readText()
            .then((clipboardText) => {
                if (!clipboardText) return false;
                const sanitizedText = filterXSS(clipboardText);
                const inputElement = Swal.getInput();
                if (self.isVideoTypeSupported(sanitizedText) && inputElement) {
                    inputElement.value = sanitizedText;
                }
                return false;
            })
            .catch(() => {
                return false;
            });
    }

    /**
     * Determine the MIME type from a URL's file extension.
     *
     * @param {string} url
     * @returns {string} e.g. 'video/mp4' or 'na' for unknown
     */
    getVideoType(url) {
        if (url.endsWith('.mp4')) return 'video/mp4';
        if (url.endsWith('.mp3')) return 'video/mp3';
        if (url.endsWith('.webm')) return 'video/webm';
        if (url.endsWith('.ogg')) return 'video/ogg';
        return 'na';
    }

    /**
     * Check whether a URL points to a supported video/audio format.
     *
     * @param {string} url
     * @returns {boolean}
     */
    isVideoTypeSupported(url) {
        if (
            url.endsWith('.mp4') ||
            url.endsWith('.mp3') ||
            url.endsWith('.webm') ||
            url.endsWith('.ogg') ||
            url.includes('youtube.com')
        ) {
            return true;
        }
        return false;
    }

    /**
     * Convert a YouTube watch URL to an embeddable URL.
     *
     * @param {string} url
     * @returns {string|false}
     */
    getYoutubeEmbed(url) {
        let regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        let match = url.match(regExp);
        return match && match[7].length == 11 ? 'https://www.youtube.com/embed/' + match[7] + '?autoplay=1' : false;
    }

    /**
     * Process a shareVideoAction event from a remote peer.
     * Opens or closes the shared video player.
     *
     * @param {object} data – { peer_name, action, video_url, is_youtube, peer_id }
     */
    shareVideoAction(data) {
        const { peer_name, action } = data;

        switch (action) {
            case 'open':
                this.rc.userLog('info', `${peer_name} <i class="fab fa-youtube"></i> opened the video`, 'top-end');
                this.openVideo(data);
                break;
            case 'close':
                this.rc.userLog('info', `${peer_name} <i class="fab fa-youtube"></i> closed the video`, 'top-end');
                this.closeVideo();
                break;
            default:
                break;
        }
    }

    /**
     * Create and display a shared video/audio player element.
     * Supports both YouTube (iframe) and direct media (video element).
     *
     * @param {object} data – { peer_name, video_url, is_youtube }
     */
    openVideo(data) {
        let d, vb, e, video, pn, fsBtn;
        let peer_name = data.peer_name;
        let video_url = data.video_url + (this.rc.isMobileSafari ? '&enablejsapi=1&mute=1' : '');
        let is_youtube = data.is_youtube;
        let video_type = this.getVideoType(video_url);

        const videoCloseBtn = this.dom.get('videoCloseBtn');

        this.closeVideo();
        show(videoCloseBtn);

        d = document.createElement('div');
        d.className = 'Camera';
        d.id = '__shareVideo';

        vb = document.createElement('div');
        vb.setAttribute('id', '__videoBar');
        vb.className = 'videoMenuBarShare fadein';

        e = this.rc.createButton('__videoExit', 'fas fa-times');
        pn = this.rc.createButton('__pinUnpin', html.pin);
        fsBtn = this.rc.createButton('__videoFS', html.fullScreen);

        if (is_youtube) {
            video = document.createElement('iframe');
            video.setAttribute('title', peer_name);
            video.setAttribute(
                'allow',
                'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            );
            video.setAttribute('frameborder', '0');
            video.setAttribute('allowfullscreen', true);

            // Safari on Mobile needs user interaction to unmute video
            if (this.rc.isMobileSafari) {
                Swal.fire({
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    background: swalBackground,
                    position: 'top',
                    imageUrl: image.videoShare,
                    title: 'Unmute Video',
                    text: 'Tap the button below to unmute and play the video with sound.',
                    confirmButtonText: 'Unmute',
                    didOpen: () => {
                        const unmuteButton = Swal.getConfirmButton();
                        if (unmuteButton) unmuteButton.focus();
                    },
                }).then((result) => {
                    if (result.isConfirmed) {
                        if (video && video.contentWindow) {
                            video.contentWindow.postMessage(
                                '{"event":"command","func":"unMute","args":""}',
                                '*',
                            );
                            video.contentWindow.postMessage(
                                '{"event":"command","func":"playVideo","args":""}',
                                '*',
                            );
                        }
                    }
                });
            }
        } else {
            video = document.createElement('video');
            video.type = video_type;
            video.autoplay = true;
            video.controls = true;
            if (video_type == 'video/mp3') {
                video.poster = image.audio;
            }
        }
        video.setAttribute('id', '__videoShare');
        video.setAttribute('src', video_url);
        video.setAttribute('width', '100%');
        video.setAttribute('height', '100%');
        vb.appendChild(e);
        vb.appendChild(fsBtn);
        if (!this.rc.isMobileDevice) vb.appendChild(pn);
        d.appendChild(video);
        d.appendChild(vb);
        this.rc.videoMediaContainer.appendChild(d);

        const self = this;

        fsBtn.addEventListener('click', () => {
            if (
                video.requestFullscreen ||
                video.webkitRequestFullscreen ||
                video.mozRequestFullScreen ||
                video.msRequestFullscreen
            ) {
                self.rc.isFullScreen() ? self.rc.goOutFullscreen(video) : self.rc.goInFullscreen(video);
            } else {
                elemDisplay('__videoFS', false);

                video.style.position = 'fixed';
                video.style.top = 0;
                video.style.left = 0;
                video.style.width = '100vw';
                video.style.height = '100vh';
                video.style.zIndex = 9999;

                let isMaximized = true;
                const closeBtn = document.createElement('button');
                closeBtn.innerText = isMaximized ? 'Minimize' : 'Maximize';
                closeBtn.style.position = 'absolute';
                closeBtn.style.top = '1px';
                closeBtn.style.left = '1px';
                closeBtn.style.zIndex = 10000;
                closeBtn.style.background = 'rgba(0,0,0,0.5)';
                closeBtn.style.color = '#fff';
                closeBtn.style.border = 'none';
                closeBtn.style.padding = '8px 12px';
                closeBtn.style.borderRadius = '4px';
                closeBtn.style.cursor = 'pointer';

                closeBtn.onclick = () => {
                    if (isMaximized) {
                        video.style.position = '';
                        video.style.top = '';
                        video.style.left = '';
                        video.style.width = '';
                        video.style.height = '';
                        video.style.zIndex = '';
                        closeBtn.innerText = 'Maximize';
                        isMaximized = false;
                    } else {
                        video.style.position = 'fixed';
                        video.style.top = 0;
                        video.style.left = 0;
                        video.style.width = '100vw';
                        video.style.height = '100vh';
                        video.style.zIndex = 9999;
                        closeBtn.innerText = 'Minimize';
                        isMaximized = true;
                    }
                };

                if (!video.parentNode.querySelector('.mobile-video-close-btn')) {
                    closeBtn.classList.add('mobile-video-close-btn');
                    video.parentNode.appendChild(closeBtn);
                }
            }
        });

        const exitVideoBtn = this.rc.getId(e.id);
        exitVideoBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (self.rc._moderator.media_cant_sharing) {
                return userLog('warning', 'The moderator does not allow you close this media', 'top-end', 6000);
            }
            self.closeVideo(true);
        });

        this.rc.handlePN(video.id, pn.id, d.id);
        if (!this.rc.isMobileDevice) {
            this.rc.setTippy(pn.id, 'Toggle Pin video player', 'bottom');
            this.rc.setTippy(e.id, 'Close video player', 'bottom');
            this.rc.setTippy(fsBtn.id, 'Full screen', 'bottom');
        }

        handleAspectRatio();
        console.log('[openVideo] Video-element-count', this.rc.videoMediaContainer.childElementCount);
        this.rc.sound('joined');
    }

    /**
     * Close the shared video player and optionally notify peers.
     *
     * @param {boolean} emit    – if true, emit the close action via socket
     * @param {string}  peer_id – target peer ID (default: 'all')
     */
    closeVideo(emit = false, peer_id = 'all') {
        const videoCloseBtn = this.dom.get('videoCloseBtn');

        if (emit) {
            let data = {
                peer_id: peer_id,
                peer_name: this.rc.peer_name,
                action: 'close',
            };
            this.socket.emit('shareVideoAction', data);
        }
        let shareVideoDiv = this.rc.getId('__shareVideo');
        if (shareVideoDiv) {
            hide(videoCloseBtn);
            shareVideoDiv.parentNode.removeChild(shareVideoDiv);
            if (this.rc.isVideoPinned && this.rc.pinnedVideoPlayerId == '__videoShare') {
                this.rc.removeVideoPinMediaContainer();
                console.log('Remove pin container due the Video player close');
            }
            handleAspectRatio();
            console.log('[closeVideo] Video-element-count', this.rc.videoMediaContainer.childElementCount);
            this.rc.sound('left');
        }
    }

    // ####################################################
    // UTILITY HELPERS
    // ####################################################

    /**
     * Trigger a browser download for a Blob.
     *
     * @param {Blob}   blob – the file data
     * @param {string} file – the filename
     */
    saveBlobToFile(blob, file) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    }

    /**
     * Convert a byte count to a human-readable size string.
     *
     * @param {number} bytes
     * @returns {string}
     */
    bytesToSize(bytes) {
        let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    /**
     * Validate that a filename does not contain invalid characters.
     *
     * @param {string} fileName
     * @returns {boolean}
     */
    isValidFileName(fileName) {
        const invalidChars = /[\\\/\?\*\|:"<>]/;
        return !invalidChars.test(fileName);
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    /**
     * Tear down any resources held by this manager.
     * Aborts any in-progress file transfer and unregisters
     * socket listeners.
     */
    close() {
        if (this.isFileReaderRunning()) {
            this.fileReader.abort();
        }
        this.sendInProgress = false;
        this.receiveInProgress = false;
        this.receiveBuffer = [];
        this.incomingFileData = [];

        // Socket event listeners for fileInfo, file, shareVideoAction,
        // fileAbort, and receiveFileAbort are managed by RoomClient.js
        this.rc = null;
        this.socket = null;
    }
}
