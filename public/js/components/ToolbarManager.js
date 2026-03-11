'use strict';

/**
 * ToolbarManager
 *
 * Manages toolbar button visibility, tooltip setup, keyboard shortcuts,
 * button click handlers, button bar auto-hide behavior, and room emoji picker.
 * Extracted from Room.js toolbar-related functions.
 */
class ToolbarManager {
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

        // Toolbar state
        this.isButtonsVisible = false;
        this.isButtonsBarOver = false;
        this.isShortcutsEnabled = false;
        this.checkButtonsBarTimer = null;
        this._keydownHandler = null;
        this._showButtonsHandler = null;
    }

    /**
     * Initialize with socket manager and RoomClient reference.
     * @param {Object} socketManager - Socket manager instance
     * @param {Object} rc - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.socketManager = socketManager;
        this.rc = rc;
        this.socket = rc.socket;
    }

    // ####################################################
    // TOOLTIP SETUP
    // ####################################################

    /**
     * Set a tippy tooltip on an element by id.
     * @param {string} elemId - Element id
     * @param {string} content - Tooltip content
     * @param {string} placement - Tooltip placement
     * @param {boolean} [allowHTML=false] - Whether to allow HTML in tooltip
     */
    setTippy(elemId, content, placement, allowHTML = false) {
        const element = this.dom.get(elemId);
        if (element) {
            if (element._tippy) {
                element._tippy.destroy();
            }
            try {
                tippy(element, {
                    content: content,
                    placement: placement,
                    allowHTML: allowHTML,
                });
            } catch (err) {
                console.error('setTippy error', err.message);
            }
        } else {
            console.warn('setTippy element not found with content', content);
        }
    }

    /**
     * Refresh tooltip placements for main bottom-bar buttons
     * based on the current bar position (vertical or horizontal).
     * @param {boolean} isMobileDevice - Whether the device is mobile
     */
    refreshMainButtonsToolTipPlacement(isMobileDevice) {
        if (isMobileDevice) return;

        const BtnsBarPosition = this.dom.get('BtnsBarPosition');
        if (!BtnsBarPosition) return;

        const position = BtnsBarPosition.options[BtnsBarPosition.selectedIndex].value;
        const bPlacement = position === 'vertical' ? 'top' : 'right';

        this.setTippy('startAudioButton', 'Start the audio', bPlacement);
        this.setTippy('stopAudioButton', 'Stop the audio', bPlacement);
        this.setTippy('startVideoButton', 'Start the video', bPlacement);
        this.setTippy('stopVideoButton', 'Stop the video', bPlacement);
        this.setTippy('swapCameraButton', 'Swap the camera', bPlacement);
        this.setTippy('startScreenButton', 'Start screen share', bPlacement);
        this.setTippy('stopScreenButton', 'Stop screen share', bPlacement);
        this.setTippy('raiseHandButton', 'Raise your hand', bPlacement);
        this.setTippy('lowerHandButton', 'Lower your hand', bPlacement);
        this.setTippy('chatButton', 'Toggle the chat', bPlacement);
        this.setTippy('participantsButton', 'Toggle participants list', bPlacement);
        this.setTippy('settingsButton', 'Toggle the settings', bPlacement);
        this.setTippy('exitButton', 'Leave room', bPlacement);
    }

    /**
     * Set up all non-dynamic tooltips for the room controls, settings,
     * whiteboard, chat, poll, editor, and transcription buttons.
     * @param {boolean} isMobileDevice - Whether the device is mobile
     */
    initTooltips(isMobileDevice) {
        if (isMobileDevice) return;

        this.refreshMainButtonsToolTipPlacement(isMobileDevice);

        // Settings panel
        this.setTippy('mySettingsCloseBtn', 'Close', 'bottom');
        this.setTippy(
            'switchDominantSpeakerFocus',
            'If Active, When a participant speaks, their video will be focused and enlarged',
            'right',
        );
        this.setTippy('switchNoiseSuppression', 'Toggle noise suppression', 'right');
        this.setTippy('initVideoAudioRefreshButton', 'Refresh audio/video devices', 'top');
        this.setTippy('switchPitchBar', 'Toggle audio pitch bar', 'right');
        this.setTippy('switchSounds', 'Toggle the sounds notifications', 'right');
        this.setTippy('switchShare', "Show 'Share Room' popup on join", 'right');
        this.setTippy('switchKeepButtonsVisible', 'Keep buttons always visible', 'right');
        this.setTippy('switchKeepAwake', 'Prevent the device from sleeping (if supported)', 'right');
        this.setTippy('roomId', 'Room name (click to copy)', 'right');
        this.setTippy('sessionTime', 'Session time', 'right');
        this.setTippy('recordingImage', 'Toggle recording', 'right');
        this.setTippy('refreshVideoFiles', 'Refresh', 'left');
        this.setTippy(
            'switchServerRecording',
            'The recording will be stored on the server rather than locally',
            'right',
        );

        // Whiteboard
        this.setTippy('whiteboardGhostButton', 'Toggle transparent background', 'bottom');
        this.setTippy('whiteboardGridBtn', 'Toggle whiteboard grid', 'bottom');
        this.setTippy('wbBackgroundColorEl', 'Background color', 'bottom');
        this.setTippy('wbDrawingColorEl', 'Drawing color', 'bottom');
        this.setTippy('whiteboardPencilBtn', 'Drawing mode', 'bottom');
        this.setTippy('whiteboardVanishingBtn', 'Vanishing pen (disappears in 5s)', 'bottom');
        this.setTippy('whiteboardEraserBtn', 'Eraser', 'bottom');
        this.setTippy('whiteboardObjectBtn', 'Object mode', 'bottom');
        this.setTippy('whiteboardUndoBtn', 'Undo', 'bottom');
        this.setTippy('whiteboardRedoBtn', 'Redo', 'bottom');
        this.setTippy('whiteboardLockBtn', 'Toggle Lock whiteboard', 'right');
        this.setTippy('whiteboardUnlockBtn', 'Toggle Lock whiteboard', 'right');
        this.setTippy('whiteboardCloseBtn', 'Close', 'bottom');

        // Chat
        this.setTippy('chatCleanTextButton', 'Clean', 'top');
        this.setTippy('chatPasteButton', 'Paste', 'top');
        this.setTippy('chatSendButton', 'Send', 'top');
        this.setTippy('showChatOnMsg', 'Show chat on new message comes', 'bottom');
        this.setTippy('speechIncomingMsg', 'Speech the incoming messages', 'bottom');
        this.setTippy('chatSpeechStartButton', 'Start speech recognition', 'top');
        this.setTippy('chatSpeechStopButton', 'Stop speech recognition', 'top');
        this.setTippy('chatEmojiButton', 'Emoji', 'top');
        this.setTippy('chatShowParticipantsListBtn', 'Toggle participants list', 'top');
        this.setTippy('chatMarkdownButton', 'Markdown', 'top');
        this.setTippy('fileShareChatButton', 'Share the file', 'top');
        this.setTippy('chatCloseButton', 'Close', 'bottom');
        this.setTippy('chatTogglePin', 'Toggle pin', 'bottom');
        this.setTippy('chatHideParticipantsList', 'Hide', 'bottom');
        this.setTippy('chatMaxButton', 'Maximize', 'bottom');
        this.setTippy('chatMinButton', 'Minimize', 'bottom');

        // Poll
        this.setTippy('pollTogglePin', 'Toggle pin', 'bottom');
        this.setTippy('pollMaxButton', 'Maximize', 'bottom');
        this.setTippy('pollMinButton', 'Minimize', 'bottom');
        this.setTippy('pollSaveButton', 'Save results', 'bottom');
        this.setTippy('pollCloseBtn', 'Close', 'bottom');
        this.setTippy('pollAddOptionBtn', 'Add option', 'top');
        this.setTippy('pollDelOptionBtn', 'Delete option', 'top');

        // Editor
        this.setTippy('editorLockBtn', 'Toggle Lock editor', 'bottom');
        this.setTippy('editorUnlockBtn', 'Toggle Lock editor', 'bottom');
        this.setTippy('editorTogglePin', 'Toggle pin', 'bottom');
        this.setTippy('editorUndoBtn', 'Undo', 'bottom');
        this.setTippy('editorRedoBtn', 'Redo', 'bottom');
        this.setTippy('editorCopyBtn', 'Copy', 'bottom');
        this.setTippy('editorSaveBtn', 'Save', 'bottom');
        this.setTippy('editorCloseBtn', 'Close', 'bottom');
        this.setTippy('editorCleanBtn', 'Clean', 'bottom');

        // Participants
        this.setTippy('participantsSaveBtn', 'Save participants info', 'bottom');
        this.setTippy('participantsRaiseHandBtn', 'Toggle raise hands', 'bottom');
        this.setTippy('participantsUnreadMessagesBtn', 'Toggle unread messages', 'bottom');

        // Transcription
        this.setTippy('transcriptionCloseBtn', 'Close', 'bottom');
        this.setTippy('transcriptionTogglePinBtn', 'Toggle pin', 'bottom');
        this.setTippy('transcriptionMaxBtn', 'Maximize', 'bottom');
        this.setTippy('transcriptionMinBtn', 'Minimize', 'bottom');
        this.setTippy('transcriptionSpeechStatus', 'Status', 'bottom');
        this.setTippy('transcriptShowOnMsg', 'Show transcript on new message comes', 'bottom');
        this.setTippy('transcriptionSpeechStart', 'Start transcription', 'top');
        this.setTippy('transcriptionSpeechStop', 'Stop transcription', 'top');

        // Lobby
        this.setTippy('lobbyAcceptAllBtn', 'Accept', 'top');
        this.setTippy('lobbyRejectAllBtn', 'Reject', 'top');
    }

    /**
     * Set up tooltips for the init (pre-join) buttons.
     * @param {boolean} isMobileDevice - Whether the device is mobile
     */
    initButtonsTooltips(isMobileDevice) {
        if (isMobileDevice) return;

        this.setTippy('initAudioButton', 'Toggle the audio', 'top');
        this.setTippy('initVideoButton', 'Toggle the video', 'top');
        this.setTippy('initAudioVideoButton', 'Toggle the audio & video', 'top');
        this.setTippy('initStartScreenButton', 'Toggle screen sharing', 'top');
        this.setTippy('initStopScreenButton', 'Toggle screen sharing', 'top');
        this.setTippy('initVideoMirrorButton', 'Toggle video mirror', 'top');
        this.setTippy('initVirtualBackgroundButton', 'Set Virtual Background or Blur', 'top');
        this.setTippy('initUsernameEmojiButton', 'Toggle username emoji', 'top');
        this.setTippy('initExitButton', 'Leave meeting', 'top');
    }

    // ####################################################
    // BUTTON VISIBILITY
    // ####################################################

    /**
     * Apply button visibility rules based on BUTTONS configuration when room is ready.
     * This is the main function that shows/hides all toolbar buttons
     * according to the BUTTONS config and device capabilities.
     *
     * @param {Object} opts - Options object
     * @param {Object} opts.BUTTONS - Button configuration object
     * @param {boolean} opts.isAudioAllowed - Whether audio is allowed
     * @param {boolean} opts.isVideoAllowed - Whether video is allowed
     * @param {boolean} opts.isMobileDevice - Whether the device is mobile
     * @param {boolean} opts.isDesktopDevice - Whether the device is desktop
     * @param {boolean} opts.showDocumentPipBtn - Whether Document PiP is supported
     * @param {boolean} opts.speechRecognition - Whether speech recognition is supported
     * @param {boolean} opts.isSpeechSynthesisSupported - Whether speech synthesis is supported
     * @param {boolean} opts.isMediaStreamTrackAndTransformerSupported - VB support
     * @param {Object} opts.transcription - Transcription instance
     * @param {Object} opts.parserResult - UAParser result
     * @param {boolean} opts.hostOnlyRecording - Whether host-only recording is enabled
     */
    applyButtonVisibility(opts) {
        const {
            BUTTONS,
            isAudioAllowed,
            isVideoAllowed,
            isMobileDevice,
            isDesktopDevice,
            showDocumentPipBtn,
            speechRecognition,
            isSpeechSynthesisSupported,
            isMediaStreamTrackAndTransformerSupported,
            transcription,
            parserResult,
            hostOnlyRecording,
        } = opts;

        const rc = this.rc;

        // Main buttons
        BUTTONS.main.exitButton && this._show('exitButton');
        BUTTONS.main.shareButton && this._show('shareButton');
        BUTTONS.main.hideMeButton && this._show('hideMeButton');

        if (BUTTONS.settings.tabRecording) {
            this._show('startRecButton');
        } else {
            this._hide('startRecButton');
            this._hide('tabRecordingBtn');
        }

        BUTTONS.main.chatButton && this._show('chatButton');
        BUTTONS.main.participantsButton && this._show('participantsButton');
        BUTTONS.main.pollButton && this._show('pollButton');
        BUTTONS.main.editorButton && this._show('editorButton');
        BUTTONS.main.raiseHandButton && this._show('raiseHandButton');
        BUTTONS.main.emojiRoomButton && this._show('emojiRoomButton');

        this._show('fileShareExtraButton');

        !BUTTONS.chat.chatSaveButton && this._hide('chatSaveButton');
        BUTTONS.chat.chatEmojiButton && this._show('chatEmojiButton');
        this._show('chatShowParticipantsListBtn');
        BUTTONS.chat.chatMarkdownButton && this._show('chatMarkdownButton');
        this._show('fileShareChatButton');

        !BUTTONS.poll.pollSaveButton && this._hide('pollSaveButton');

        if (speechRecognition && BUTTONS.chat.chatSpeechStartButton) {
            this._show('chatSpeechStartButton');
        } else {
            BUTTONS.chat.chatSpeechStartButton = false;
        }

        if (transcription && transcription.isSupported() && BUTTONS.main.transcriptionButton) {
            this._show('transcriptionButton');
        } else {
            BUTTONS.main.transcriptionButton = false;
        }

        this._show('chatCleanTextButton');
        this._show('chatPasteButton');
        this._show('chatSendButton');

        if (isDesktopDevice) {
            this._show('whiteboardGridBtn');
        }

        if (isMobileDevice) {
            this._hide('initVideoAudioRefreshButton');
            BUTTONS.main.swapCameraButton && this._show('swapCameraButton');
            if (rc) {
                rc.chatMaximize();
                rc.pollMaximize();
            }
            this._hide('chatTogglePin');
            this._hide('chatMaxButton');
            this._hide('chatMinButton');
            if (rc) rc.pollMaximize();
            this._hide('pollTogglePin');
            this._hide('editorTogglePin');
            this._hide('pollMaxButton');
            this._hide('pollMinButton');
            if (transcription) transcription.maximize();
            this._hide('transcriptionTogglePinBtn');
            this._hide('transcriptionMaxBtn');
            this._hide('transcriptionMinBtn');
        } else {
            if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
                if (BUTTONS.main.startScreenButton) {
                    this._show('startScreenButton');
                    this._show('ScreenQualityDiv');
                    this._show('ScreenFpsDiv');
                }
                BUTTONS.main.snapshotRoomButton && this._show('snapshotRoomButton');
            }
            BUTTONS.chat.chatPinButton && this._show('chatTogglePin');
            BUTTONS.chat.chatMaxButton && this._show('chatMaxButton');
            BUTTONS.poll.pollPinButton && this._show('pollTogglePin');
            this._show('editorTogglePin');
            BUTTONS.poll.pollMaxButton && this._show('pollMaxButton');
            BUTTONS.settings.pushToTalk && this._show('pushToTalkDiv');
            if (BUTTONS.settings.tabRTMPStreamingBtn) {
                this._show('tabRTMPStreamingBtn');
                this._show('startRtmpButton');
                this._show('startRtmpURLButton');
                this._show('streamerRtmpButton');
            }
        }

        if (BUTTONS.main.fullScreenButton && !parserResult.browser.name.toLowerCase().includes('safari')) {
            document.onfullscreenchange = () => {
                if (!document.fullscreenElement && rc) rc.isDocumentOnFullScreen = false;
            };
            this._show('fullScreenButton');
        } else {
            this._hide('fullScreenButton');
        }

        BUTTONS.main.whiteboardButton && this._show('whiteboardButton');
        if (BUTTONS.main.documentPiPButton && showDocumentPipBtn) this._show('documentPiPButton');
        BUTTONS.main.settingsButton && this._show('settingsButton');

        isAudioAllowed
            ? this._show('stopAudioButton')
            : BUTTONS.main.startAudioButton && this._show('startAudioButton');
        isVideoAllowed
            ? this._show('stopVideoButton')
            : BUTTONS.main.startVideoButton && this._show('startVideoButton');

        BUTTONS.settings.activeRooms && this._show('activeRoomsButton');
        BUTTONS.settings.fileSharing && this._show('fileShareButton');
        BUTTONS.settings.lockRoomButton && this._show('lockRoomButton');
        BUTTONS.settings.broadcastingButton && this._show('broadcastingButton');
        BUTTONS.settings.lobbyButton && this._show('lobbyButton');
        BUTTONS.settings.sendEmailInvitation && this._show('sendEmailInvitation');
        !BUTTONS.settings.customNoiseSuppression && this._hide('noiseSuppressionButton');
        BUTTONS.settings.tabNotificationsBtn && this._show('tabNotificationsBtn');

        if (rc && rc.recording && rc.recording.recSyncServerRecording) {
            this._show('roomRecordingServer');
        }

        BUTTONS.main.aboutButton && this._show('aboutButton');

        if (!isMobileDevice) this._show('pinUnpinGridDiv');
        if (!isSpeechSynthesisSupported) this._hide('speechMsgDiv');

        if (
            isMediaStreamTrackAndTransformerSupported &&
            (BUTTONS.settings.virtualBackground !== undefined ? BUTTONS.settings.virtualBackground : true)
        ) {
            if (rc) rc.showVideoImageSelector();
        }
    }

    /**
     * Apply init (pre-join) button visibility based on allowed media.
     * @param {Object} opts - Options object
     * @param {boolean} opts.isAudioAllowed - Whether audio is allowed
     * @param {boolean} opts.isVideoAllowed - Whether video is allowed
     * @param {boolean} opts.isMobileDevice - Whether the device is mobile
     */
    applyInitButtonVisibility(opts) {
        const { isAudioAllowed, isVideoAllowed, isMobileDevice } = opts;

        if (!isAudioAllowed) this._hide('initAudioButton');
        if (!isVideoAllowed) this._hide('initVideoButton');
        if (!isAudioAllowed || !isVideoAllowed) this._hide('initAudioVideoButton');
        if ((!isAudioAllowed && !isVideoAllowed) || isMobileDevice) this._hide('initVideoAudioRefreshButton');
    }

    // ####################################################
    // BUTTON CLICK HANDLERS
    // ####################################################

    /**
     * Bind all toolbar button click handlers.
     * This corresponds to the handleButtons() function in Room.js.
     *
     * @param {Object} handlers - Object mapping handler names to callback functions.
     *   Each key is a handler name and each value is a function.
     *   Expected keys include: leaveRoom, shareRoom, toggleHideMe, toggleSettings,
     *   openTab, toggleChat, toggleParticipants, togglePoll, toggleEditor,
     *   toggleTranscription, toggleWhiteboard, toggleFullScreen, toggleDocumentPIP,
     *   snapshotRoom, startRecording, stopRecording, pauseRecording, resumeRecording,
     *   swapCamera, raiseHand, lowerHand, startAudio, stopAudio, startVideo, stopVideo,
     *   startScreen, stopScreen, lockRoom, unlockRoom, showAbout,
     *   and many more.
     */
    bindButtonHandlers(handlers) {
        this._handlers = handlers;

        // Lobby
        const lobbyUsers = this.dom.get('lobbyUsers');
        if (lobbyUsers) {
            lobbyUsers.addEventListener('click', (event) => {
                switch (event.target.id) {
                    case 'lobbyAcceptAllBtn':
                        this._call(handlers, 'lobbyAcceptAll');
                        break;
                    case 'lobbyRejectAllBtn':
                        this._call(handlers, 'lobbyRejectAll');
                        break;
                    default:
                        break;
                }
            });
        }

        // Bottom buttons hover tracking
        const bottomButtons = this.dom.get('bottomButtons');
        if (bottomButtons) {
            bottomButtons.onmouseover = () => {
                this.isButtonsBarOver = true;
            };
            bottomButtons.onmouseout = () => {
                this.isButtonsBarOver = false;
            };
        }

        // Main action buttons
        this._bindClick('exitButton', handlers, 'leaveRoom');
        this._bindClickFn('shareButton', () => this._call(handlers, 'shareRoom', true));
        this._bindShareHover(handlers);
        this._bindClickFn('hideMeButton', () => this._call(handlers, 'toggleHideMe'));
        this._bindClickFn('settingsButton', () => this._call(handlers, 'toggleSettings'));
        this._bindClick('mySettingsCloseBtn', handlers, 'toggleSettings');

        // Settings tabs
        this._bindClickFn('tabVideoDevicesBtn', (e) => this._call(handlers, 'openTab', e, 'tabVideoDevices'));
        this._bindClickFn('tabAudioDevicesBtn', (e) => this._call(handlers, 'openTab', e, 'tabAudioDevices'));
        this._bindClickFn('tabRecordingBtn', (e) => this._call(handlers, 'openTab', e, 'tabRecording'));
        this._bindClickFn('tabRoomBtn', (e) => this._call(handlers, 'openTab', e, 'tabRoom'));
        this._bindClickFn('tabVideoShareBtn', (e) => this._call(handlers, 'openTab', e, 'tabVideoShare'));
        this._bindClickFn('tabRTMPStreamingBtn', (e) => {
            this._call(handlers, 'getRTMP');
            this._call(handlers, 'openTab', e, 'tabRTMPStreaming');
        });
        this._bindClickFn('refreshVideoFiles', () => {
            this._call(handlers, 'getRTMP');
            this._call(handlers, 'refreshVideoFilesInfo');
        });
        this._bindClickFn('tabAspectBtn', (e) => this._call(handlers, 'openTab', e, 'tabAspect'));
        this._bindClickFn('tabNotificationsBtn', (e) => this._call(handlers, 'openTab', e, 'tabNotifications'));
        this._bindClickFn('tabModeratorBtn', (e) => this._call(handlers, 'openTab', e, 'tabModerator'));
        this._bindClickFn('tabProfileBtn', (e) => this._call(handlers, 'openTab', e, 'tabProfile'));
        this._bindClickFn('tabShortcutsBtn', (e) => this._call(handlers, 'openTab', e, 'tabShortcuts'));
        this._bindClickFn('tabStylingBtn', (e) => this._call(handlers, 'openTab', e, 'tabStyling'));
        this._bindClickFn('tabLanguagesBtn', (e) => this._call(handlers, 'openTab', e, 'tabLanguages'));
        this._bindClickFn('notifyEmailCleanBtn', () => this._call(handlers, 'cleanNotifications'));
        this._bindClick('saveNotificationsBtn', handlers, 'saveNotifications');
        this._bindClickFn('tabVideoAIBtn', (e) => this._call(handlers, 'openTabVideoAI', e));
        this._bindClick('avatarVideoAIStart', handlers, 'startVideoAI');
        this._bindClickFn('speakerTestBtn', () => this._call(handlers, 'speakerTest'));

        // Room ID / email
        this._bindClickFn('roomId', () => this._call(handlers, 'roomIdClick'));
        this._bindClick('roomSendEmail', handlers, 'shareRoomByEmail');

        // Chat
        this._bindClick('chatButton', handlers, 'toggleChat');
        this._bindClick('participantsButton', handlers, 'toggleParticipants');

        // Poll
        this._bindClick('pollButton', handlers, 'togglePoll');
        this._bindClick('pollMaxButton', handlers, 'pollMaximize');
        this._bindClick('pollMinButton', handlers, 'pollMinimize');
        this._bindClick('pollCloseBtn', handlers, 'togglePoll');
        this._bindClick('pollTogglePin', handlers, 'togglePollPin');
        this._bindClick('pollSaveButton', handlers, 'pollSaveResults');
        this._bindClick('pollAddOptionBtn', handlers, 'pollAddOptions');
        this._bindClick('pollDelOptionBtn', handlers, 'pollDeleteOptions');

        const pollCreateForm = this.dom.get('pollCreateForm');
        if (pollCreateForm) {
            pollCreateForm.onsubmit = (e) => this._call(handlers, 'pollCreateNewForm', e);
        }

        // Editor
        this._bindClickFn('editorButton', () => this._call(handlers, 'toggleEditor'));
        this._bindClickFn('editorCloseBtn', () => this._call(handlers, 'closeEditor'));
        this._bindClick('editorTogglePin', handlers, 'toggleEditorPin');
        this._bindClick('editorLockBtn', handlers, 'toggleLockUnlockEditor');
        this._bindClick('editorUnlockBtn', handlers, 'toggleLockUnlockEditor');
        this._bindClick('editorCleanBtn', handlers, 'editorClean');
        this._bindClick('editorCopyBtn', handlers, 'editorCopy');
        this._bindClick('editorSaveBtn', handlers, 'editorSave');
        this._bindClick('editorUndoBtn', handlers, 'editorUndo');
        this._bindClick('editorRedoBtn', handlers, 'editorRedo');

        // Transcription
        this._bindClick('transcriptionButton', handlers, 'toggleTranscription');
        this._bindClick('transcriptionCloseBtn', handlers, 'toggleTranscription');
        this._bindClick('transcriptionTogglePinBtn', handlers, 'transcriptionTogglePin');
        this._bindClick('transcriptionMaxBtn', handlers, 'transcriptionMaximize');
        this._bindClick('transcriptionMinBtn', handlers, 'transcriptionMinimize');
        this._bindClick('transcriptionAllBtn', handlers, 'transcriptionStartAll');
        this._bindClick('transcriptionGhostBtn', handlers, 'transcriptionToggleBg');
        this._bindClick('transcriptionSaveBtn', handlers, 'transcriptionSave');
        this._bindClick('transcriptionCleanBtn', handlers, 'transcriptionDelete');

        // Chat controls
        this._bindClick('chatHideParticipantsList', handlers, 'toggleShowParticipants');
        this._bindClick('chatShowParticipantsListBtn', handlers, 'toggleShowParticipants');
        this._bindClickFn('chatShareRoomBtn', () => this._call(handlers, 'shareRoom', true));
        this._bindClick('chatGhostButton', handlers, 'chatToggleBg');
        this._bindClick('chatCleanButton', handlers, 'chatClean');
        this._bindClick('chatSaveButton', handlers, 'chatSave');
        this._bindClick('chatCloseButton', handlers, 'toggleChat');
        this._bindClick('chatTogglePin', handlers, 'toggleChatPin');
        this._bindClick('chatMaxButton', handlers, 'chatMaximize');
        this._bindClick('chatMinButton', handlers, 'chatMinimize');
        this._bindClick('chatCleanTextButton', handlers, 'cleanMessage');
        this._bindClick('chatPasteButton', handlers, 'pasteMessage');
        this._bindClick('chatSendButton', handlers, 'sendMessage');
        this._bindClick('chatEmojiButton', handlers, 'toggleChatEmoji');
        this._bindClickFn('chatMarkdownButton', () => this._call(handlers, 'toggleMarkdown'));
        this._bindClick('chatSpeechStartButton', handlers, 'startSpeech');
        this._bindClick('chatSpeechStopButton', handlers, 'stopSpeech');
        this._bindClick('transcriptionSpeechStart', handlers, 'transcriptionStart');
        this._bindClick('transcriptionSpeechStop', handlers, 'transcriptionStop');

        // Full screen / recording
        this._bindClick('fullScreenButton', handlers, 'toggleFullScreen');
        this._bindClickFn('recordingImage', () => this._call(handlers, 'toggleRecordingImage'));
        this._bindClick('startRecButton', handlers, 'startRecording');
        this._bindClick('stopRecButton', handlers, 'stopRecording');
        this._bindClick('pauseRecButton', handlers, 'pauseRecording');
        this._bindClick('resumeRecButton', handlers, 'resumeRecording');

        // Swap camera
        this._bindClickFn('swapCameraButton', () => this._call(handlers, 'swapCamera'));

        // Raise / lower hand
        this._bindClick('raiseHandButton', handlers, 'raiseHand');
        this._bindClick('lowerHandButton', handlers, 'lowerHand');

        // Audio / video / screen
        this._bindClickFn('startAudioButton', async () => this._call(handlers, 'startAudio'));
        this._bindClickFn('stopAudioButton', async () => this._call(handlers, 'stopAudio'));
        this._bindClickFn('startVideoButton', async () => this._call(handlers, 'startVideo'));
        this._bindClickFn('stopVideoButton', () => this._call(handlers, 'stopVideo'));
        this._bindClickFn('startScreenButton', async () => this._call(handlers, 'startScreen'));
        this._bindClickFn('stopScreenButton', () => this._call(handlers, 'stopScreen'));

        // RTMP
        this._bindClick('copyRtmpUrlButton', handlers, 'copyRtmpUrl');
        this._bindClick('startRtmpButton', handlers, 'startRtmp');
        this._bindClick('stopRtmpButton', handlers, 'stopRtmp');
        this._bindClick('streamerRtmpButton', handlers, 'openRTMPStreamer');
        this._bindClick('startRtmpURLButton', handlers, 'startRtmpFromURL');
        this._bindClick('stopRtmpURLButton', handlers, 'stopRtmpFromURL');

        // Misc toolbar buttons
        this._bindClick('activeRoomsButton', handlers, 'showActiveRooms');
        this._bindClick('fileShareButton', handlers, 'fileShare');
        this._bindClickFn('fileShareExtraButton', () => {
            const fileShareButton = this.dom.get('fileShareButton');
            if (fileShareButton) fileShareButton.click();
        });
        this._bindClick('fileShareChatButton', handlers, 'fileShareChat');
        this._bindClick('videoShareButton', handlers, 'shareVideo');
        this._bindClick('videoCloseBtn', handlers, 'closeVideo');
        this._bindClick('sendAbortBtn', handlers, 'abortFileTransfer');
        this._bindClick('receiveAbortBtn', handlers, 'abortReceiveFileTransfer');
        this._bindClick('receiveHideBtn', handlers, 'hideFileTransfer');

        // Whiteboard
        this._bindClick('whiteboardButton', handlers, 'toggleWhiteboard');
        this._bindClick('documentPiPButton', handlers, 'toggleDocumentPIP');
        this._bindClick('snapshotRoomButton', handlers, 'snapshotRoom');
        this._bindClick('whiteboardPencilBtn', handlers, 'whiteboardPencil');
        this._bindClick('whiteboardVanishingBtn', handlers, 'whiteboardVanishing');
        this._bindClick('whiteboardObjectBtn', handlers, 'whiteboardObject');
        this._bindClick('whiteboardUndoBtn', handlers, 'whiteboardUndo');
        this._bindClick('whiteboardRedoBtn', handlers, 'whiteboardRedo');
        this._bindClick('whiteboardSaveBtn', handlers, 'whiteboardSave');
        this._bindClick('whiteboardImgFileBtn', handlers, 'whiteboardImgFile');
        this._bindClick('whiteboardPdfFileBtn', handlers, 'whiteboardPdfFile');
        this._bindClick('whiteboardImgUrlBtn', handlers, 'whiteboardImgUrl');
        this._bindClick('whiteboardTextBtn', handlers, 'whiteboardText');
        this._bindClick('whiteboardStickyNoteBtn', handlers, 'whiteboardStickyNote');
        this._bindClick('whiteboardLineBtn', handlers, 'whiteboardLine');
        this._bindClick('whiteboardRectBtn', handlers, 'whiteboardRect');
        this._bindClick('whiteboardTriangleBtn', handlers, 'whiteboardTriangle');
        this._bindClick('whiteboardCircleBtn', handlers, 'whiteboardCircle');
        this._bindClick('whiteboardEraserBtn', handlers, 'whiteboardEraser');
        this._bindClick('whiteboardCleanBtn', handlers, 'whiteboardClean');
        this._bindClick('whiteboardShortcutsBtn', handlers, 'whiteboardShortcuts');
        this._bindClick('whiteboardCloseBtn', handlers, 'whiteboardClose');
        this._bindClick('whiteboardLockBtn', handlers, 'toggleLockUnlockWhiteboard');
        this._bindClick('whiteboardUnlockBtn', handlers, 'toggleLockUnlockWhiteboard');

        // Participants
        this._bindClick('participantsSaveBtn', handlers, 'saveRoomPeers');
        this._bindClick('participantsUnreadMessagesBtn', handlers, 'toggleUnreadMsg');
        this._bindClick('participantsRaiseHandBtn', handlers, 'toggleRaiseHands');

        const searchParticipants = this.dom.get('searchParticipantsFromList');
        if (searchParticipants) {
            searchParticipants.onkeyup = () => this._call(handlers, 'searchPeer');
        }

        // Lock / unlock
        this._bindClick('lockRoomButton', handlers, 'lockRoom');
        this._bindClick('unlockRoomButton', handlers, 'unlockRoom');

        // About / ICE restart
        this._bindClick('aboutButton', handlers, 'showAbout');
        this._bindClickFn('restartICEButton', async () => this._call(handlers, 'restartIce'));
    }

    // ####################################################
    // SHARE BUTTON HOVER (QR CODE)
    // ####################################################

    /**
     * @private
     */
    _bindShareHover(handlers) {
        const shareButton = this.dom.get('shareButton');
        if (!shareButton) return;

        shareButton.onmouseenter = () => {
            if (this.rc && this.rc.isMobileDevice) return;
            if (typeof BUTTONS !== 'undefined' && !BUTTONS.popup.shareRoomQrOnHover) return;
            this._show('qrRoomPopupContainer');
        };
        shareButton.onmouseleave = () => {
            if (this.rc && this.rc.isMobileDevice) return;
            if (typeof BUTTONS !== 'undefined' && !BUTTONS.popup.shareRoomQrOnHover) return;
            this._hide('qrRoomPopupContainer');
        };
    }

    // ####################################################
    // KEYBOARD SHORTCUTS
    // ####################################################

    /**
     * Initialize keyboard shortcut handling.
     *
     * @param {Object} opts - Options object
     * @param {Object} opts.BUTTONS - Button configuration
     * @param {boolean} opts.isDesktopDevice - Whether the device is desktop
     * @param {Function} opts.getState - Function returning current state: { audio, video, screen, hand,
     *   isRecording, isPresenter, isRulesActive, isBroadcastingEnabled, hostOnlyRecording,
     *   wbIsOpen, showDocumentPipBtn }
     * @param {Function} opts.userLog - User log function
     */
    initKeyboardShortcuts(opts) {
        const { BUTTONS, isDesktopDevice, getState, userLog } = opts;

        if (!isDesktopDevice || !BUTTONS.settings.keyboardShortcuts) {
            this._elemDisplay('tabShortcutsBtn', false);
            this.setKeyboardShortcuts(false);
            return;
        }

        const switchShortcuts = this.dom.get('switchShortcuts');
        if (switchShortcuts) {
            switchShortcuts.onchange = (e) => {
                const status = this.setKeyboardShortcuts(e.currentTarget.checked);
                if (userLog) userLog('info', `Keyboard shortcuts ${status}`, 'top-end');
                e.target.blur();
            };
        }

        this._keydownHandler = (event) => {
            const state = getState();

            if (
                !this.isShortcutsEnabled ||
                (this.rc && this.rc.isChatOpen) ||
                state.wbIsOpen ||
                (this.rc && this.rc.isEditorOpen) ||
                (!state.isPresenter && state.isBroadcastingEnabled)
            ) {
                return;
            }

            const key = event.key.toLowerCase();
            console.log(`Detected shortcut: ${key}`);

            const moderator = this.rc ? this.rc._moderator : {};
            const { audio_cant_unmute, video_cant_unhide, screen_cant_share } = moderator || {};
            const notPresenter = state.isRulesActive && !state.isPresenter;

            switch (key) {
                case 'a':
                    if (notPresenter && !state.audio && (audio_cant_unmute || !BUTTONS.main.startAudioButton)) {
                        userLog('warning', 'The presenter has disabled your ability to enable audio', 'top-end');
                        break;
                    }
                    state.audio ? this._clickEl('stopAudioButton') : this._clickEl('startAudioButton');
                    break;
                case 'v':
                    if (notPresenter && !state.video && (video_cant_unhide || !BUTTONS.main.startVideoButton)) {
                        userLog('warning', 'The presenter has disabled your ability to enable video', 'top-end');
                        break;
                    }
                    state.video ? this._clickEl('stopVideoButton') : this._clickEl('startVideoButton');
                    break;
                case 's':
                    if (notPresenter && !state.screen && (screen_cant_share || !BUTTONS.main.startScreenButton)) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to share the screen',
                            'top-end',
                        );
                        break;
                    }
                    state.screen ? this._clickEl('stopScreenButton') : this._clickEl('startScreenButton');
                    break;
                case 'h':
                    if (notPresenter && !BUTTONS.main.raiseHandButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to raise your hand',
                            'top-end',
                        );
                        break;
                    }
                    state.hand ? this._clickEl('lowerHandButton') : this._clickEl('raiseHandButton');
                    break;
                case 'c':
                    if (notPresenter && !BUTTONS.main.chatButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the chat', 'top-end');
                        break;
                    }
                    this._clickEl('chatButton');
                    break;
                case 'o':
                    if (notPresenter && !BUTTONS.main.settingsButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the settings',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('settingsButton');
                    break;
                case 'x':
                    if (notPresenter && !BUTTONS.main.hideMeButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to hide yourself',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('hideMeButton');
                    break;
                case 'r':
                    if (notPresenter && (state.hostOnlyRecording || !BUTTONS.settings.tabRecording)) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to start recording',
                            'top-end',
                        );
                        break;
                    }
                    state.isRecording ? this._clickEl('stopRecButton') : this._clickEl('startRecButton');
                    break;
                case 'j':
                    if (notPresenter && !BUTTONS.main.emojiRoomButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the room emoji',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('emojiRoomButton');
                    break;
                case 'k':
                    if (notPresenter && !BUTTONS.main.transcriptionButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to start transcription',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('transcriptionButton');
                    break;
                case 'p':
                    if (notPresenter && !BUTTONS.main.pollButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to start a poll',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('pollButton');
                    break;
                case 'e':
                    if (notPresenter && !BUTTONS.main.editorButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the editor',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('editorButton');
                    break;
                case 'w':
                    if (notPresenter && !BUTTONS.main.whiteboardButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the whiteboard',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('whiteboardButton');
                    break;
                case 'd':
                    if (!state.showDocumentPipBtn) {
                        userLog('warning', 'The document PIP is not supported in this browser', 'top-end');
                        break;
                    }
                    if (notPresenter && !BUTTONS.main.documentPiPButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the document PIP',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('documentPiPButton');
                    break;
                case 't':
                    if (notPresenter && !BUTTONS.main.snapshotRoomButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to take a snapshot',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('snapshotRoomButton');
                    break;
                case 'f':
                    if (notPresenter && !BUTTONS.settings.fileSharing) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to share files',
                            'top-end',
                        );
                        break;
                    }
                    this._clickEl('fileShareButton');
                    break;
                default:
                    console.log(`Unhandled shortcut key: ${key}`);
            }
        };

        document.addEventListener('keydown', this._keydownHandler);
    }

    /**
     * Enable or disable keyboard shortcuts.
     * @param {boolean} enabled - Whether to enable shortcuts
     * @returns {string} 'enabled' or 'disabled'
     */
    setKeyboardShortcuts(enabled) {
        this.isShortcutsEnabled = enabled;
        return this.isShortcutsEnabled ? 'enabled' : 'disabled';
    }

    // ####################################################
    // BUTTON BAR AUTO-HIDE
    // ####################################################

    /**
     * Set up the button bar auto-show behavior on mouse/touch events.
     * @param {boolean} isDesktopDevice - Whether the device is desktop
     */
    initButtonsBar(isDesktopDevice) {
        this._showButtonsHandler = () => this.showButtons();
        if (isDesktopDevice) {
            document.body.addEventListener('mousemove', this._showButtonsHandler);
        } else {
            document.body.addEventListener('touchstart', this._showButtonsHandler);
        }
    }

    /**
     * Show the bottom buttons bar if conditions allow.
     */
    showButtons() {
        if (
            this._getWbIsBgTransparent() ||
            this.isButtonsBarOver ||
            this.isButtonsVisible ||
            (this.rc && this.rc.isVideoBarDropDownOpen) ||
            (this.rc && this.rc.isMobileDevice && this.rc.isChatOpen) ||
            (this.rc && this.rc.isMobileDevice && this.rc.isMySettingsOpen)
        ) {
            return;
        }

        const bottomButtons = this.dom.get('bottomButtons');
        if (bottomButtons) bottomButtons.style.display = 'flex';
        this._toggleClassElements('username', 'flex');
        this.isButtonsVisible = true;
    }

    /**
     * Check and toggle the button bar visibility based on local storage settings.
     * Runs periodically every 10 seconds.
     * @param {Object} localStorageSettings - Local storage settings object
     */
    checkButtonsBar(localStorageSettings) {
        const bottomButtons = this.dom.get('bottomButtons');
        if (localStorageSettings && localStorageSettings.keep_buttons_visible) {
            if (bottomButtons) bottomButtons.style.display = 'flex';
            this._toggleClassElements('username', 'flex');
            this.isButtonsVisible = true;
        } else {
            if (!this.isButtonsBarOver) {
                if (bottomButtons) bottomButtons.style.display = 'none';
                this._toggleClassElements('username', 'none');
                this.isButtonsVisible = false;
            }
        }
        this.checkButtonsBarTimer = setTimeout(() => {
            this.checkButtonsBar(localStorageSettings);
        }, 10000);
    }

    // ####################################################
    // ROOM EMOJI PICKER
    // ####################################################

    /**
     * Build and attach the room emoji picker to emojiPickerContainer.
     *
     * @param {Object} opts - Options object
     * @param {Object} opts.emojiPickerContainer - Container DOM element
     * @param {Object} opts.emojiRoomButton - Emoji room button DOM element
     * @param {boolean} opts.isMobileDevice - Whether the device is mobile
     * @param {string} opts.peer_name - Current peer name
     */
    initRoomEmojiPicker(opts) {
        const { emojiPickerContainer, emojiRoomButton, isMobileDevice, peer_name } = opts;

        if (!emojiPickerContainer || !emojiRoomButton) return;

        const soundEmojis = [
            { emoji: '\u{1F44D}', shortcodes: ':+1:' },
            { emoji: '\u{1F44E}', shortcodes: ':-1:' },
            { emoji: '\u{1F44C}', shortcodes: ':ok_hand:' },
            { emoji: '\u{1F600}', shortcodes: ':grinning:' },
            { emoji: '\u{1F603}', shortcodes: ':smiley:' },
            { emoji: '\u{1F602}', shortcodes: ':joy:' },
            { emoji: '\u{1F618}', shortcodes: ':kissing_heart:' },
            { emoji: '\u{2764}\u{FE0F}', shortcodes: ':heart:' },
            { emoji: '\u{1F3BA}', shortcodes: ':trumpet:' },
            { emoji: '\u{1F389}', shortcodes: ':tada:' },
            { emoji: '\u{1F62E}', shortcodes: ':open_mouth:' },
            { emoji: '\u{1F44F}', shortcodes: ':clap:' },
            { emoji: '\u{2728}', shortcodes: ':sparkles:' },
            { emoji: '\u{2B50}', shortcodes: ':star:' },
            { emoji: '\u{1F31F}', shortcodes: ':star2:' },
            { emoji: '\u{1F4AB}', shortcodes: ':dizzy:' },
            { emoji: '\u{1F680}', shortcodes: ':rocket:' },
        ];

        const header = document.createElement('div');
        header.className = 'room-emoji-header';

        const title = document.createElement('span');
        title.textContent = 'Emoji Picker';
        title.className = 'room-emoji-title';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'room-emoji-close-btn';
        closeBtn.innerHTML = '<i class="fa fa-times"></i>';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const tabContainer = document.createElement('div');
        tabContainer.className = 'room-emoji-tab-container';

        const allTab = document.createElement('button');
        allTab.textContent = 'All';
        allTab.className = 'room-emoji-tab active';

        const soundTab = document.createElement('button');
        soundTab.textContent = 'Sounds';
        soundTab.className = 'room-emoji-tab';

        tabContainer.appendChild(allTab);
        tabContainer.appendChild(soundTab);

        const emojiMartDiv = document.createElement('div');
        emojiMartDiv.className = 'room-emoji-mart';
        const pickerRoomOptions = {
            theme: 'dark',
            onEmojiSelect: (data) => this._sendEmojiToRoom(data, peer_name),
        };
        const emojiRoomPicker = new EmojiMart.Picker(pickerRoomOptions);
        emojiMartDiv.appendChild(emojiRoomPicker);

        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'room-emoji-grid';

        const showEmojiGrid = () => emojiGrid.classList.add('visible');
        const hideEmojiGrid = () => emojiGrid.classList.remove('visible');

        soundEmojis.forEach(({ emoji, shortcodes }) => {
            const btn = document.createElement('button');
            btn.textContent = emoji;
            btn.className = 'room-emoji-btn';
            btn.onclick = () => this._sendEmojiToRoom({ native: emoji, shortcodes }, peer_name);
            emojiGrid.appendChild(btn);
        });

        allTab.onclick = () => {
            allTab.classList.add('active');
            soundTab.classList.remove('active');
            emojiMartDiv.style.display = 'block';
            hideEmojiGrid();
        };
        soundTab.onclick = () => {
            soundTab.classList.add('active');
            allTab.classList.remove('active');
            emojiMartDiv.style.display = 'none';
            showEmojiGrid();
        };

        emojiPickerContainer.innerHTML = '';
        emojiPickerContainer.appendChild(header);
        emojiPickerContainer.appendChild(tabContainer);
        emojiPickerContainer.appendChild(emojiMartDiv);
        emojiPickerContainer.appendChild(emojiGrid);
        emojiPickerContainer.style.display = 'none';

        if (!isMobileDevice && this.rc) {
            this.rc.makeDraggable(emojiPickerContainer, header);
        }

        this._emojiPickerContainer = emojiPickerContainer;
        this._emojiRoomButton = emojiRoomButton;

        emojiRoomButton.onclick = () => {
            this.toggleEmojiPicker();
        };
        closeBtn.addEventListener('click', () => {
            this.toggleEmojiPicker();
        });
    }

    /**
     * Toggle the room emoji picker visibility.
     */
    toggleEmojiPicker() {
        if (!this._emojiPickerContainer || !this._emojiRoomButton) return;

        const emojiRoomIcon = this._emojiRoomButton.querySelector('i');
        if (this._emojiPickerContainer.style.display === 'block') {
            this._emojiPickerContainer.style.display = 'none';
            this._setColor(emojiRoomIcon, 'white');
        } else {
            this._emojiPickerContainer.style.display = 'block';
            this._setColor(emojiRoomIcon, '#FFD600');
        }
    }

    /**
     * @private
     */
    _sendEmojiToRoom(data, peer_name) {
        console.log('Selected Emoji', data.native);
        const cmd = {
            type: 'roomEmoji',
            peer_name: peer_name,
            emoji: data.native,
            shortcodes: data.shortcodes,
            broadcast: true,
        };
        if (this.rc && this.rc.thereAreParticipants()) {
            this.rc.emitCmd(cmd);
        }
        if (this.rc) this.rc.handleCmd(cmd);
    }

    // ####################################################
    // SETTINGS EXTRA DROPDOWN
    // ####################################################

    /**
     * Set up the settings extra dropdown (split button menu).
     * @param {Object} opts - Options
     * @param {Object} opts.BUTTONS - Button configuration
     */
    setupSettingsExtraDropdown(opts) {
        const { BUTTONS } = opts;

        const settingsSplit = this.dom.get('settingsSplit');
        const settingsExtraDropdown = this.dom.get('settingsExtraDropdown');
        const settingsExtraToggle = this.dom.get('settingsExtraToggle');
        const settingsExtraMenu = this.dom.get('settingsExtraMenu');
        const noExtraButtons = this.dom.get('noExtraButtons');
        const settingsButton = this.dom.get('settingsButton');

        if (!settingsSplit || !settingsExtraDropdown || !settingsExtraToggle || !settingsExtraMenu) return;

        if (BUTTONS.main.extraButton) {
            this._showEl(settingsExtraDropdown);
            this._showEl(settingsExtraMenu);
        } else {
            this._hideEl(settingsExtraDropdown);
            this._hideEl(settingsExtraMenu);
            if (noExtraButtons) noExtraButtons.style.display = 'block';
            if (settingsButton) settingsButton.style.borderRadius = '10px';
        }

        let showTimeout;
        let hideTimeout;

        const showMenu = () => {
            clearTimeout(hideTimeout);
            this._showEl(settingsExtraMenu);
        };
        const hideMenu = () => {
            clearTimeout(showTimeout);
            this._hideEl(settingsExtraMenu);
        };

        settingsExtraToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            !settingsExtraMenu.classList.contains('hidden') ? hideMenu() : showMenu();
        });

        const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (supportsHover) {
            let closeTimeout;
            const cancelClose = () => {
                if (!closeTimeout) return;
                clearTimeout(closeTimeout);
                closeTimeout = null;
            };
            const scheduleClose = () => {
                cancelClose();
                closeTimeout = setTimeout(() => hideMenu(), 180);
            };
            settingsExtraToggle.addEventListener('mouseenter', () => {
                cancelClose();
                showMenu();
            });
            settingsExtraToggle.addEventListener('mouseleave', scheduleClose);
            settingsExtraMenu.addEventListener('mouseenter', cancelClose);
            settingsExtraMenu.addEventListener('mouseleave', scheduleClose);
        }

        settingsExtraMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.addEventListener('click', (e) => {
            if (!settingsExtraToggle.contains(e.target) && !settingsExtraMenu.contains(e.target)) {
                hideMenu();
            }
        });
    }

    // ####################################################
    // QUICK DEVICE SWITCH DROPDOWNS
    // ####################################################

    /**
     * Restore border-radius for split buttons in bottomButtons.
     */
    restoreSplitButtonsBorderRadius() {
        const bottomButtons = this.dom.get('bottomButtons');
        if (!bottomButtons) return;

        bottomButtons.querySelectorAll('.split-btn').forEach((group) => {
            group.querySelectorAll('button').forEach((button) => {
                if (button.id !== 'settingsExtraToggle' && button.id !== 'settingsButton') {
                    button.style.setProperty('border-radius', '10px', 'important');
                }
            });
            const toggle = group.querySelector('.device-dropdown-toggle');
            if (toggle) toggle.style.setProperty('border-left', 'none', 'important');
        });
    }

    // ####################################################
    // DROPDOWN HOVER
    // ####################################################

    /**
     * Set up dropdown menus to open/close on hover for desktop devices.
     * @param {Element|null} [dropdownElement=null] - Specific dropdown or null for all
     */
    handleDropdownHover(dropdownElement = null) {
        const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (!supportsHover) return;

        const dropdowns = dropdownElement ? dropdownElement : document.querySelectorAll('.dropdown');
        console.log(`Dropdown found: ${dropdowns.length}`);

        dropdowns.forEach((dropdown) => {
            const toggle = dropdown.querySelector('.dropdown-toggle');
            const menu = dropdown.querySelector('.dropdown-menu');
            if (!toggle || !menu) return;

            let timeoutId;

            dropdown.addEventListener('mouseenter', () => {
                clearTimeout(timeoutId);
                const bsDropdown = bootstrap.Dropdown.getInstance(toggle) || new bootstrap.Dropdown(toggle);
                bsDropdown.show();
            });

            dropdown.addEventListener('mouseleave', () => {
                timeoutId = setTimeout(() => {
                    const bsDropdown = bootstrap.Dropdown.getInstance(toggle);
                    if (bsDropdown) bsDropdown.hide();
                }, 200);
            });

            menu.addEventListener('mouseenter', () => {
                clearTimeout(timeoutId);
            });

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
    }

    // ####################################################
    // AUDIO / VIDEO BUTTON STATE
    // ####################################################

    /**
     * Enable or disable the audio start/stop buttons.
     * @param {boolean} disabled - Whether to disable
     */
    setAudioButtonsDisabled(disabled) {
        const startAudioButton = this.dom.get('startAudioButton');
        const stopAudioButton = this.dom.get('stopAudioButton');
        if (startAudioButton) startAudioButton.disabled = disabled;
        if (stopAudioButton) stopAudioButton.disabled = disabled;
    }

    /**
     * Enable or disable the video start/stop buttons.
     * @param {boolean} disabled - Whether to disable
     */
    setVideoButtonsDisabled(disabled) {
        const startVideoButton = this.dom.get('startVideoButton');
        const stopVideoButton = this.dom.get('stopVideoButton');
        if (startVideoButton) startVideoButton.disabled = disabled;
        if (stopVideoButton) stopVideoButton.disabled = disabled;
    }

    // ####################################################
    // RC EVENT HANDLERS (toolbar button state on media events)
    // ####################################################

    /**
     * Bind RoomClient event handlers that toggle toolbar button visibility
     * for media state changes (audio, video, screen, hand, lock, etc.).
     *
     * @param {Object} rc - RoomClient instance
     * @param {Object} opts - Options
     * @param {Object} opts.BUTTONS - Button configuration
     * @param {Function} opts.getAudioState - Returns current audio state
     * @param {Function} opts.setAudioState - Sets audio state
     * @param {Function} opts.getVideoState - Returns current video state
     * @param {Function} opts.setVideoState - Sets video state
     * @param {Function} opts.getScreenState - Returns current screen state
     * @param {Function} opts.setScreenState - Sets screen state
     * @param {Function} opts.getHandState - Returns current hand state
     * @param {Function} opts.setHandState - Sets hand state
     * @param {Function} opts.applyKeepAwake - Keep-awake callback
     * @param {Function} opts.stopMicrophoneProcessing - Mic processing cleanup
     * @param {Function} opts.hideClassElements - Hide elements by class name
     */
    bindMediaEventHandlers(rc, opts) {
        const {
            BUTTONS,
            getAudioState,
            setAudioState,
            getVideoState,
            setVideoState,
            getScreenState,
            setScreenState,
            getHandState,
            setHandState,
            applyKeepAwake,
            stopMicrophoneProcessing,
            hideClassElements,
        } = opts;

        const RoomClientEvents = rc.constructor.EVENTS || RoomClient.EVENTS;

        // Hand
        rc.on(RoomClientEvents.raiseHand, () => {
            console.log('Room event: Client raise hand');
            this._hide('raiseHandButton');
            this._show('lowerHandButton');
            const lowerHandIcon = this.dom.get('lowerHandIcon');
            if (lowerHandIcon) this._setColor(lowerHandIcon, 'lime');
            setHandState(true);
        });
        rc.on(RoomClientEvents.lowerHand, () => {
            console.log('Room event: Client lower hand');
            this._hide('lowerHandButton');
            this._show('raiseHandButton');
            const lowerHandIcon = this.dom.get('lowerHandIcon');
            if (lowerHandIcon) this._setColor(lowerHandIcon, 'white');
            setHandState(false);
        });

        // Audio
        rc.on(RoomClientEvents.startAudio, () => {
            console.log('Room event: Client start audio');
            this._hide('startAudioButton');
            this._show('stopAudioButton');
            this._setColorById('startAudioButton', 'red');
            this.setAudioButtonsDisabled(false);
            setAudioState(true);
            applyKeepAwake(true);
        });
        rc.on(RoomClientEvents.pauseAudio, () => {
            console.log('Room event: Client pause audio');
            this._hide('stopAudioButton');
            BUTTONS.main.startAudioButton && this._show('startAudioButton');
            this._setColorById('startAudioButton', 'red');
            this.setAudioButtonsDisabled(false);
            setAudioState(false);
            applyKeepAwake(false);
        });
        rc.on(RoomClientEvents.resumeAudio, () => {
            console.log('Room event: Client resume audio');
            this._hide('startAudioButton');
            BUTTONS.main.startAudioButton && this._show('stopAudioButton');
            this.setAudioButtonsDisabled(false);
            setAudioState(true);
            applyKeepAwake(true);
        });
        rc.on(RoomClientEvents.stopAudio, () => {
            console.log('Room event: Client stop audio');
            this._hide('stopAudioButton');
            this._show('startAudioButton');
            this.setAudioButtonsDisabled(false);
            if (stopMicrophoneProcessing) stopMicrophoneProcessing();
            setAudioState(false);
            applyKeepAwake(false);
        });

        // Video
        rc.on(RoomClientEvents.startVideo, () => {
            console.log('Room event: Client start video');
            this._hide('startVideoButton');
            this._show('stopVideoButton');
            this._setColorById('startVideoButton', 'red');
            this.setVideoButtonsDisabled(false);
            if (hideClassElements) hideClassElements('videoMenuBar');
            setVideoState(true);
            applyKeepAwake(getAudioState());
        });
        rc.on(RoomClientEvents.pauseVideo, () => {
            console.log('Room event: Client pause video');
            this._hide('stopVideoButton');
            BUTTONS.main.startVideoButton && this._show('startVideoButton');
            this._setColorById('startVideoButton', 'red');
            this.setVideoButtonsDisabled(false);
            if (hideClassElements) hideClassElements('videoMenuBar');
            setVideoState(false);
            applyKeepAwake(getAudioState());
        });
        rc.on(RoomClientEvents.resumeVideo, () => {
            console.log('Room event: Client resume video');
            this._hide('startVideoButton');
            BUTTONS.main.startVideoButton && this._show('stopVideoButton');
            this.setVideoButtonsDisabled(false);
            if (hideClassElements) hideClassElements('videoMenuBar');
            setVideoState(true);
            applyKeepAwake(getAudioState());
        });
        rc.on(RoomClientEvents.stopVideo, () => {
            console.log('Room event: Client stop video');
            this._hide('stopVideoButton');
            this._show('startVideoButton');
            this.setVideoButtonsDisabled(false);
            if (hideClassElements) hideClassElements('videoMenuBar');
            setVideoState(false);
            applyKeepAwake(getAudioState());
        });

        // Screen
        rc.on(RoomClientEvents.startScreen, () => {
            console.log('Room event: Client start screen');
            this._hide('startScreenButton');
            this._show('stopScreenButton');
            if (hideClassElements) hideClassElements('videoMenuBar');
            setScreenState(true);
        });
        rc.on(RoomClientEvents.pauseScreen, () => {
            console.log('Room event: Client pause screen');
            this._hide('startScreenButton');
            this._show('stopScreenButton');
            if (hideClassElements) hideClassElements('videoMenuBar');
            setScreenState(false);
        });
        rc.on(RoomClientEvents.resumeScreen, () => {
            console.log('Room event: Client resume screen');
            this._hide('stopScreenButton');
            this._show('startScreenButton');
            if (hideClassElements) hideClassElements('videoMenuBar');
            setScreenState(true);
        });
        rc.on(RoomClientEvents.stopScreen, () => {
            console.log('Room event: Client stop screen');
            this._hide('stopScreenButton');
            this._show('startScreenButton');
            if (hideClassElements) hideClassElements('videoMenuBar');
            setScreenState(false);
        });

        // Room lock
        rc.on(RoomClientEvents.roomLock, () => {
            console.log('Room event: Client lock room');
            this._hide('lockRoomButton');
            this._show('unlockRoomButton');
        });
        rc.on(RoomClientEvents.roomUnlock, () => {
            console.log('Room event: Client unlock room');
            this._hide('unlockRoomButton');
            this._show('lockRoomButton');
        });
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    /**
     * Clean up all resources, event listeners, and timers.
     */
    close() {
        // Remove keyboard shortcut listener
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        // Remove button bar show handler
        if (this._showButtonsHandler) {
            document.body.removeEventListener('mousemove', this._showButtonsHandler);
            document.body.removeEventListener('touchstart', this._showButtonsHandler);
            this._showButtonsHandler = null;
        }

        // Clear button bar check timer
        if (this.checkButtonsBarTimer) {
            clearTimeout(this.checkButtonsBarTimer);
            this.checkButtonsBarTimer = null;
        }

        // Reset state
        this.isButtonsVisible = false;
        this.isButtonsBarOver = false;
        this.isShortcutsEnabled = false;

        this._emojiPickerContainer = null;
        this._emojiRoomButton = null;
        this._handlers = null;

        this.socketManager = null;
        this.rc = null;
        this.socket = null;
    }

    // ####################################################
    // PRIVATE HELPERS
    // ####################################################

    /**
     * @private
     */
    _show(id) {
        const elem = typeof id === 'string' ? this.dom.get(id) : id;
        if (!elem || !elem.classList) return;
        if (elem.classList.contains('hidden')) elem.classList.toggle('hidden');
    }

    /**
     * @private
     */
    _hide(id) {
        const elem = typeof id === 'string' ? this.dom.get(id) : id;
        if (!elem || !elem.classList) return;
        if (!elem.classList.contains('hidden')) elem.classList.toggle('hidden');
    }

    /**
     * @private
     */
    _showEl(elem) {
        if (!elem || !elem.classList) return;
        if (elem.classList.contains('hidden')) elem.classList.toggle('hidden');
    }

    /**
     * @private
     */
    _hideEl(elem) {
        if (!elem || !elem.classList) return;
        if (!elem.classList.contains('hidden')) elem.classList.toggle('hidden');
    }

    /**
     * @private
     */
    _elemDisplay(id, display, mode = 'block') {
        const elem = this.dom.get(id);
        if (!elem) return;
        elem.style.display = display ? mode : 'none';
    }

    /**
     * @private
     */
    _setColor(elem, color) {
        if (!elem) return;
        elem.style.color = color;
    }

    /**
     * @private
     */
    _setColorById(id, color) {
        const elem = this.dom.get(id);
        if (elem) elem.style.color = color;
    }

    /**
     * @private
     */
    _clickEl(id) {
        const elem = this.dom.get(id);
        if (elem) elem.click();
    }

    /**
     * @private
     */
    _bindClick(elemId, handlers, handlerName) {
        const elem = this.dom.get(elemId);
        if (elem && handlers[handlerName]) {
            elem.onclick = () => handlers[handlerName]();
        }
    }

    /**
     * @private
     */
    _bindClickFn(elemId, fn) {
        const elem = this.dom.get(elemId);
        if (elem) elem.onclick = fn;
    }

    /**
     * @private
     */
    _call(handlers, name, ...args) {
        if (handlers && typeof handlers[name] === 'function') {
            return handlers[name](...args);
        }
    }

    /**
     * @private
     */
    _toggleClassElements(className, displayState) {
        if (!this.rc) return;
        const elements = this.rc.getEcN(className);
        for (let i = 0; i < elements.length; i++) {
            elements[i].style.display = displayState;
        }
    }

    /**
     * @private
     */
    _getWbIsBgTransparent() {
        // Access the global wbIsBgTransparent if available
        return typeof wbIsBgTransparent !== 'undefined' ? wbIsBgTransparent : false;
    }
}
