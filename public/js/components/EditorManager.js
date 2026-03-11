'use strict';

/**
 * EditorManager
 *
 * Manages the collaborative code/rich-text editor (Quill.js),
 * including initialization, locking, pinning, syncing, and persistence.
 * Extracted from RoomClient.js and Room.js editor-related methods.
 */
class EditorManager {
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
        this.quill = null;

        this.isEditorOpen = false;
        this.isEditorLocked = false;
        this.isEditorPinned = false;
    }

    /**
     * Initialize with socket manager and RoomClient reference.
     * Sets up Quill editor and socket event listeners.
     * @param {Object} socketManager - Socket manager instance
     * @param {Object} rc - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.socketManager = socketManager;
        this.rc = rc;
        this.socket = rc.socket;
        this._initQuill();
        this._bindSocketEvents();
    }

    // ####################################################
    // QUILL INITIALIZATION
    // ####################################################

    _initQuill() {
        const toolbarOptions = [
            [{ header: [1, 2, 3, false] }, { align: [] }, { background: [] }],
            ['bold', 'italic', 'underline', 'strike', 'link', 'image', 'code-block'],
            [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
            [{ indent: '+1' }, { indent: '-1' }],
            ['clean'],
        ];

        this.quill = new Quill('#editor', {
            modules: {
                toolbar: {
                    container: toolbarOptions,
                },
                syntax: true,
            },
            theme: 'snow',
        });

        this._applySyntaxHighlighting();

        this.quill.on('text-change', (delta, oldDelta, source) => {
            if (!isPresenter && this.isEditorLocked) {
                return;
            }
            this._applySyntaxHighlighting();
            if (this.rc.thereAreParticipants() && source === 'user') {
                this.socket.emit('editorChange', delta);
            }
        });
    }

    _applySyntaxHighlighting() {
        const codeBlocks = document.querySelectorAll('.ql-syntax');
        codeBlocks.forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    // ####################################################
    // SOCKET EVENTS
    // ####################################################

    _bindSocketEvents() {
        this._onEditorChange = (data) => {
            this.handleEditorData(data);
        };
        this._onEditorActions = (data) => {
            this.handleEditorActionsData(data);
        };
        this._onEditorUpdate = (data) => {
            this.handleEditorUpdateData(data);
        };
        this.socket.on('editorChange', this._onEditorChange);
        this.socket.on('editorActions', this._onEditorActions);
        this.socket.on('editorUpdate', this._onEditorUpdate);
    }

    // ####################################################
    // TOGGLE / OPEN / CLOSE
    // ####################################################

    toggleEditor() {
        const editorRoom = this.dom.get('editorRoom');
        editorRoom.classList.toggle('show');
        if (!this.isEditorOpen) {
            this.editorCenter();
            this.rc.sound('open');
        }
        this.isEditorOpen = !this.isEditorOpen;

        if (this.isEditorPinned) this.editorUnpin();

        if (!this.rc.isMobileDevice && this.isEditorOpen && this.rc.canBePinned()) {
            this.toggleEditorPin();
        }
    }

    editorOpen() {
        if (!this.isEditorOpen) {
            this.rc.sound('open');
            this.toggleEditor();
        }
    }

    // ####################################################
    // LOCK / UNLOCK
    // ####################################################

    toggleLockUnlockEditor() {
        this.isEditorLocked = !this.isEditorLocked;

        const editorLockBtn = this.dom.get('editorLockBtn');
        const editorUnlockBtn = this.dom.get('editorUnlockBtn');

        const btnToShow = this.isEditorLocked ? editorLockBtn : editorUnlockBtn;
        const btnToHide = this.isEditorLocked ? editorUnlockBtn : editorLockBtn;
        const btnColor = this.isEditorLocked ? 'red' : 'white';
        const action = this.isEditorLocked ? 'lock' : 'unlock';

        show(btnToShow);
        hide(btnToHide);
        setColor(editorLockBtn, btnColor);

        this.editorSendAction(action);

        if (this.isEditorLocked) {
            userLog('info', 'The Editor is locked. \n The participants cannot interact with it.', 'top-right');
            sound('locked');
        }
    }

    editorIsLocked() {
        return this.isEditorLocked;
    }

    // ####################################################
    // PIN / UNPIN
    // ####################################################

    toggleEditorPin() {
        if (transcription.isPin()) {
            return userLog('info', 'Please unpin the transcription that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isPollPinned) {
            return userLog('info', 'Please unpin the poll that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isChatPinned) {
            return userLog('info', 'Please unpin the chat that appears to be currently pinned', 'top-end');
        }
        this.isEditorPinned ? this.editorUnpin() : this.editorPin();
        this.rc.sound('click');
    }

    editorPin() {
        const editorRoom = this.dom.get('editorRoom');
        const editorTogglePin = this.dom.get('editorTogglePin');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainer.style.top = 0;
            this.rc.videoMediaContainer.style.width = '70%';
            this.rc.videoMediaContainer.style.height = '100%';
        }
        this.editorPinned();
        this.isEditorPinned = true;
        setColor(editorTogglePin, 'lime');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        document.documentElement.style.setProperty('--editor-height', '80vh');
    }

    editorUnpin() {
        const editorRoom = this.dom.get('editorRoom');
        const editorTogglePin = this.dom.get('editorTogglePin');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainerUnpin();
        }
        editorRoom.style.maxWidth = '100%';
        editorRoom.style.maxHeight = '100%';
        this.editorCenter();
        this.isEditorPinned = false;
        setColor(editorTogglePin, 'white');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        document.documentElement.style.setProperty('--editor-height', '85vh');
    }

    editorPinned() {
        const editorRoom = this.dom.get('editorRoom');
        editorRoom.style.position = 'absolute';
        editorRoom.style.top = 0;
        editorRoom.style.right = 0;
        editorRoom.style.left = null;
        editorRoom.style.transform = null;
        editorRoom.style.maxWidth = '30%';
        editorRoom.style.maxHeight = '100%';
    }

    // ####################################################
    // POSITIONING
    // ####################################################

    editorCenter() {
        const editorRoom = this.dom.get('editorRoom');
        editorRoom.style.position = 'fixed';
        editorRoom.style.transform = 'translate(-50%, -50%)';
        editorRoom.style.top = '50%';
        editorRoom.style.left = '50%';
    }

    // ####################################################
    // SYNC / BROADCAST
    // ####################################################

    editorUpdate() {
        if (this.isEditorOpen && (!isRulesActive || isPresenter)) {
            console.log('IsPresenter: update editor content to the participants in the room');
            const content = this.quill.getContents();
            this.socket.emit('editorUpdate', content);
            const action = this.isEditorLocked ? 'lock' : 'unlock';
            this.editorSendAction(action);
        }
    }

    editorSendAction(action) {
        this.socket.emit('editorActions', { peer_name: this.rc.peer_name, action: action });
    }

    // ####################################################
    // INCOMING DATA HANDLERS
    // ####################################################

    handleEditorUpdateData(data) {
        this.editorOpen();
        this.quill.setContents(data);
    }

    handleEditorData(data) {
        this.editorOpen();
        this.quill.updateContents(data);
    }

    handleEditorActionsData(data) {
        const { peer_name, action } = data;
        switch (action) {
            case 'open':
                if (this.isEditorOpen) return;
                this.toggleEditor();
                this.rc.userLog('info', `${icons.editor} ${peer_name} open editor`, 'top-end', 6000);
                break;
            case 'close':
                if (!this.isEditorOpen) return;
                this.toggleEditor();
                this.rc.userLog('info', `${icons.editor} ${peer_name} close editor`, 'top-end', 6000);
                break;
            case 'clean':
                this.quill.setText('');
                this.rc.userLog('info', `${icons.editor} ${peer_name} cleared editor`, 'top-end', 6000);
                break;
            case 'lock':
                this.isEditorLocked = true;
                this.quill.enable(false);
                this.rc.userLog('info', `${icons.editor} ${peer_name} locked the editor`, 'top-end', 6000);
                break;
            case 'unlock':
                this.isEditorLocked = false;
                this.quill.enable(true);
                this.rc.userLog('info', `${icons.editor} ${peer_name} unlocked the editor`, 'top-end', 6000);
                break;
            default:
                break;
        }
    }

    // ####################################################
    // UNDO / REDO / COPY / CLEAN
    // ####################################################

    editorUndo() {
        this.quill.history.undo();
    }

    editorRedo() {
        this.quill.history.redo();
    }

    editorCopy() {
        const content = this.quill.getText();
        if (content.trim().length === 0) {
            return this.rc.userLog('info', 'Nothing to copy', 'top-end');
        }
        copyToClipboard(content, false);
    }

    editorClean() {
        if (!isPresenter && this.isEditorLocked) {
            userLog('info', 'The Editor is locked. \n You cannot interact with it.', 'top-right');
            return;
        }
        const content = this.quill.getText();
        if (content.trim().length === 0) {
            return this.rc.userLog('info', 'Nothing to clear', 'top-end');
        }
        Swal.fire({
            background: swalBackground,
            position: 'center',
            title: 'Clear the editor content?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: 'Yes',
            denyButtonText: 'No',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.quill.setText('');
                this.editorSendAction('clean');
                this.rc.sound('delete');
            }
        });
    }

    // ####################################################
    // SAVE
    // ####################################################

    editorSave() {
        Swal.fire({
            background: swalBackground,
            position: 'top',
            imageUrl: image.save,
            title: 'Editor save options',
            showDenyButton: true,
            showCancelButton: true,
            cancelButtonColor: 'red',
            denyButtonColor: 'green',
            confirmButtonText: 'Text',
            denyButtonText: 'Html',
            cancelButtonText: 'Cancel',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            this.handleEditorSaveResult(result);
        });
    }

    handleEditorSaveResult(result) {
        if (result.isConfirmed) {
            this.saveEditorAsText();
        } else if (result.isDenied) {
            this.saveEditorAsHtml();
        }
    }

    saveEditorAsText() {
        const content = this.quill.getText().trim();
        if (content.length === 0) {
            return this.rc.userLog('info', 'No data to save!', 'top-end');
        }
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const fileName = this._generateFileName('editor.txt');
        this.rc.saveBlobToFile(blob, fileName);
        this.rc.sound('download');
    }

    saveEditorAsHtml() {
        const content = this.quill.root.innerHTML.trim();
        if (content === '<p><br></p>') {
            return this.rc.userLog('info', 'No data to save!', 'top-end');
        }
        const fileName = this._generateFileName('editor.html');
        this._saveAsHtml(content, fileName);
        this.rc.sound('download');
    }

    _generateFileName(extension) {
        return `Room_${this.rc.room_id}_${getDataTimeString()}_${extension}`;
    }

    _saveAsHtml(content, file) {
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    close() {
        if (this.socket) {
            this.socket.off('editorChange', this._onEditorChange);
            this.socket.off('editorActions', this._onEditorActions);
            this.socket.off('editorUpdate', this._onEditorUpdate);
        }
        if (this.isEditorPinned) {
            this.editorUnpin();
        }
        if (this.quill) {
            this.quill.off('text-change');
            this.quill = null;
        }
        this.isEditorOpen = false;
        this.isEditorLocked = false;
        this.isEditorPinned = false;
        this.socketManager = null;
        this.rc = null;
        this.socket = null;
    }
}
