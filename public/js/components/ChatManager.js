'use strict';

/**
 * ChatManager
 *
 * Manages all chat-related functionality: toggling, pinning, sending/receiving messages,
 * ChatGPT/DeepSeek AI integration, emoji pickers, file sharing via chat, speech synthesis,
 * message formatting, and Video AI chat orchestration.
 * Extracted from RoomClient.js and Room.js chat-related methods.
 */
class ChatManager {
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

        // Chat state
        this.isChatOpen = false;
        this.isChatEmojiOpen = false;
        this.isChatPinned = false;
        this.isChatMaximized = false;
        this.isChatBgTransparent = false;

        // Chat peer targeting
        this.chatPeerId = 'all';
        this.chatPeerName = 'all';
        this.chatPeerAvatar = '';

        // Message tracking
        this.chatMessagesId = 0;
        this.chatMessages = [];
        this.unreadMessageCounts = {};
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;

        // AI contexts
        this.chatGPTContext = [];
        this.deepSeekContext = [];

        // Spam prevention
        this.chatMessageLengthCheck = false;
        this.chatMessageLength = 4000; // chars
        this.chatMessageTimeLast = 0;
        this.chatMessageTimeBetween = 1000; // ms
        this.chatMessageNotifyDelay = 10000; // ms
        this.chatMessageSpamCount = 0;
        this.chatMessageSpamCountToBan = 10;

        // Speech
        this.isSpeechSynthesisSupported = 'speechSynthesis' in window;
        this.speechInMessages = false;
        this.showChatOnMessage = true;

        // Paste / markdown flags (shared with Room.js globals)
        this.isChatPasteTxt = false;
        this.isChatMarkdownOn = false;
        this.isChatGPTOn = false;
        this.isDeepSeekOn = false;

        // Chat input emoji map
        this.chatInputEmoji = {
            '<3': '\u2764\uFE0F',
            '</3': '\uD83D\uDC94',
            ':D': '\uD83D\uDE00',
            ':)': '\uD83D\uDE03',
            ';)': '\uD83D\uDE09',
            ':(': '\uD83D\uDE12',
            ':p': '\uD83D\uDE1B',
            ';p': '\uD83D\uDE1C',
            ":'(": '\uD83D\uDE22',
            ':+1:': '\uD83D\uDC4D',
            ':*': '\uD83D\uDE18',
            ':O': '\uD83D\uDE32',
            ':|': '\uD83D\uDE10',
            ':*(': '\uD83D\uDE2D',
            'XD': '\uD83D\uDE06',
            ':B': '\uD83D\uDE0E',
            ':P': '\uD83D\uDE1C',
            '<(': '\uD83D\uDC4E',
            '>:(': '\uD83D\uDE21',
            ':S': '\uD83D\uDE1F',
            ':X': '\uD83E\uDD10',
            ';(': '\uD83D\uDE25',
            ':T': '\uD83D\uDE16',
            ':@': '\uD83D\uDE20',
            ':$': '\uD83E\uDD11',
            ':&': '\uD83E\uDD17',
            ':#': '\uD83E\uDD14',
            ':!': '\uD83D\uDE35',
            ':W': '\uD83D\uDE37',
            ':%': '\uD83E\uDD12',
            ':*!': '\uD83E\uDD29',
            ':G': '\uD83D\uDE2C',
            ':R': '\uD83D\uDE0B',
            ':M': '\uD83E\uDD2E',
            ':L': '\uD83E\uDD74',
            ':C': '\uD83E\uDD7A',
            ':F': '\uD83E\uDD73',
            ':Z': '\uD83E\uDD22',
            ':^': '\uD83E\uDD13',
            ':K': '\uD83E\uDD2B',
            ':D!': '\uD83E\uDD2F',
            ':H': '\uD83E\uDDD0',
            ':U': '\uD83E\uDD25',
            ':V': '\uD83E\uDD2A',
            ':N': '\uD83E\uDD76',
            ':J': '\uD83E\uDD74',
        };
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
        this._bindSocketEvents();
    }

    // ####################################################
    // SOCKET EVENTS
    // ####################################################

    _bindSocketEvents() {
        this._onMessage = (data) => {
            this.showMessage(data);
        };
        this.socket.on('message', this._onMessage);
    }

    // ####################################################
    // QUERY HELPERS
    // ####################################################

    /**
     * Get chat query parameter for direct join.
     * @returns {boolean|string} chat setting from URL query
     */
    getChat() {
        const chat = this._getQueryParam('chat');
        if (chat) {
            const lowerChat = chat.toLowerCase();
            const queryChat = lowerChat === '1' || lowerChat === 'true';
            if (queryChat != null) {
                console.log('Direct join', { chat: queryChat });
                return queryChat;
            }
        }
        console.log('Direct join', { chat: chat });
        return chat;
    }

    /**
     * Helper to get URL query parameter.
     * @param {string} name - query parameter name
     * @returns {string|null}
     */
    _getQueryParam(name) {
        // Delegate to global if available, otherwise parse manually
        if (typeof getQueryParam === 'function') {
            return getQueryParam(name);
        }
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    // ####################################################
    // TOGGLE / OPEN / CLOSE
    // ####################################################

    async toggleChat() {
        const chatRoom = this.dom.get('chatRoom');
        chatRoom.classList.toggle('show');
        if (!this.isChatOpen) {
            await getRoomParticipants();
            hide(this.dom.get('chatMinButton'));

            if (!this.rc.isMobileDevice) {
                BUTTONS.chat.chatMaxButton && show(this.dom.get('chatMaxButton'));
            }
            this.chatCenter();
            this.rc.sound('open');
            this.showPeerAboutAndMessages(this.chatPeerId, this.chatPeerName, this.chatPeerAvatar);
        }
        isParticipantsListOpen = !isParticipantsListOpen;
        this.isChatOpen = !this.isChatOpen;

        if (this.isChatPinned) this.chatUnpin();

        if (!this.rc.isMobileDevice && this.isChatOpen && this.canBePinned()) {
            this.toggleChatPin();
        }

        resizeChatRoom();
    }

    updateChatFooterVisibility() {
        const chatFooter = document.querySelector('.chat-message');
        const peopleList = document.querySelector('#plist') || document.querySelector('.people-list');
        if (!chatFooter || !peopleList) return;
        const isFullWidth = window.innerWidth <= 600 && peopleList.offsetWidth >= window.innerWidth * 0.98;
        elemDisplay(chatFooter, !isFullWidth);
    }

    toggleShowParticipants() {
        const plist = this.dom.get('plist');
        const chat = this.dom.get('chat');
        plist.classList.toggle('hidden');
        const isParticipantsListHidden = !this.isPlistOpen();
        chat.style.marginLeft = isParticipantsListHidden ? 0 : '300px';
        chat.style.borderLeft = isParticipantsListHidden ? 'none' : '1px solid rgb(255 255 255 / 32%)';
        if (this.isChatPinned) elemDisplay(chat.id, isParticipantsListHidden);
        if (!this.isChatPinned) elemDisplay(chat.id, true);
        this.toggleChatHistorySize(isParticipantsListHidden && (this.isChatPinned || this.isChatMaximized));
        plist.style.width = this.isChatPinned || this.rc.isMobileDevice ? '100%' : '300px';
        plist.style.position = this.rc.isMobileDevice ? 'fixed' : 'absolute';
        this.updateChatFooterVisibility();
    }

    async toggleParticipants() {
        this.rc.isParticipantsOpen = !this.rc.isParticipantsOpen;
        if (!this.rc.isParticipantsOpen && this.isChatOpen) {
            this.toggleChat();
            return;
        }
        if (!this.isChatOpen) {
            this.toggleChat();
            await this.rc.sleep(500);
        }
        if ((isDesktopDevice && this.isChatPinned) || !isDesktopDevice) {
            this.toggleShowParticipants();
        }
    }

    isPlistOpen() {
        const plist = this.dom.get('plist');
        return !plist.classList.contains('hidden');
    }

    // ####################################################
    // CHAT HISTORY SIZE
    // ####################################################

    toggleChatHistorySize(max = true) {
        const chatHistory = this.dom.get('chatHistory');
        chatHistory.style.minHeight = max ? 'calc(100vh - 210px)' : '490px';
        chatHistory.style.maxHeight = max ? 'calc(100vh - 210px)' : '490px';
    }

    // ####################################################
    // PIN / UNPIN
    // ####################################################

    toggleChatPin() {
        if (transcription.isPin()) {
            return userLog('info', 'Please unpin the transcription that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isPollPinned) {
            return userLog('info', 'Please unpin the poll that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isEditorPinned) {
            return userLog('info', 'Please unpin the editor that appears to be currently pinned', 'top-end');
        }
        this.isChatPinned ? this.chatUnpin() : this.chatPin();
        this.rc.sound('click');
    }

    chatPin() {
        const chatRoom = this.dom.get('chatRoom');
        const chatHeader = this.dom.get('chatHeader');
        const chatTogglePin = this.dom.get('chatTogglePin');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainerPin();
        }
        this.chatPinned();
        this.isChatPinned = true;
        setColor(chatTogglePin, 'lime');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        chatRoom.style.resize = 'none';
        if (!this.rc.isMobileDevice) this.rc.makeUnDraggable(chatRoom, chatHeader);
        if (this.isPlistOpen()) this.toggleShowParticipants();
        if (chatRoom.classList.contains('container')) chatRoom.classList.remove('container');
    }

    chatUnpin() {
        const chatRoom = this.dom.get('chatRoom');
        const chatHeader = this.dom.get('chatHeader');
        const chatTogglePin = this.dom.get('chatTogglePin');
        const chatMaxButton = this.dom.get('chatMaxButton');
        const chatMinButton = this.dom.get('chatMinButton');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainerUnpin();
        }
        document.documentElement.style.setProperty('--msger-width', '800px');
        document.documentElement.style.setProperty('--msger-height', '700px');
        hide(chatMinButton);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        this.chatCenter();
        this.isChatPinned = false;
        setColor(chatTogglePin, 'white');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        if (!this.rc.isMobileDevice) this.rc.makeDraggable(chatRoom, chatHeader);
        if (!this.isPlistOpen()) this.toggleShowParticipants();
        if (!chatRoom.classList.contains('container')) chatRoom.classList.add('container');
        resizeChatRoom();
    }

    chatCenter() {
        const chatRoom = this.dom.get('chatRoom');
        chatRoom.style.position = 'fixed';
        chatRoom.style.transform = 'translate(-50%, -50%)';
        chatRoom.style.top = '50%';
        chatRoom.style.left = '50%';
    }

    chatPinned() {
        const chatRoom = this.dom.get('chatRoom');
        chatRoom.style.position = 'absolute';
        chatRoom.style.top = 0;
        chatRoom.style.right = 0;
        chatRoom.style.left = null;
        chatRoom.style.transform = null;
        document.documentElement.style.setProperty('--msger-width', '25%');
        document.documentElement.style.setProperty('--msger-height', '100%');
    }

    // ####################################################
    // MAXIMIZE / MINIMIZE
    // ####################################################

    chatMaximize() {
        const chatMaxButton = this.dom.get('chatMaxButton');
        const chatMinButton = this.dom.get('chatMinButton');

        this.isChatMaximized = true;
        hide(chatMaxButton);
        BUTTONS.chat.chatMaxButton && show(chatMinButton);
        this.chatCenter();
        document.documentElement.style.setProperty('--msger-width', '100%');
        document.documentElement.style.setProperty('--msger-height', '100%');
        this.toggleChatHistorySize(true);
    }

    chatMinimize() {
        const chatMaxButton = this.dom.get('chatMaxButton');
        const chatMinButton = this.dom.get('chatMinButton');

        this.isChatMaximized = false;
        hide(chatMinButton);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        if (this.isChatPinned) {
            this.chatPin();
        } else {
            this.chatCenter();
            document.documentElement.style.setProperty('--msger-width', '800px');
            document.documentElement.style.setProperty('--msger-height', '700px');
            this.toggleChatHistorySize(false);
        }
    }

    canBePinned() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        return viewportWidth >= 1024 && viewportHeight >= 768;
    }

    // ####################################################
    // CHAT BACKGROUND
    // ####################################################

    chatToggleBg() {
        this.isChatBgTransparent = !this.isChatBgTransparent;
        this.isChatBgTransparent
            ? document.documentElement.style.setProperty('--msger-bg', 'rgba(0, 0, 0, 0.100)')
            : setTheme();
    }

    // ####################################################
    // EMOJI
    // ####################################################

    toggleChatEmoji() {
        this.dom.get('chatEmoji').classList.toggle('show');
        this.isChatEmojiOpen = !this.isChatEmojiOpen;
        this.dom.get('chatEmojiButton').style.color = this.isChatEmojiOpen ? '#FFFF00' : '#FFFFFF';
    }

    addEmojiToMsg(data) {
        const chatMessage = this.dom.get('chatMessage');
        chatMessage.value += data.native;
        this.toggleChatEmoji();
    }

    /**
     * Initialize the chat emoji picker (called from Room.js handleChatEmojiPicker).
     */
    handleChatEmojiPicker() {
        const self = this;
        const pickerOptions = {
            theme: 'dark',
            onEmojiSelect: function (data) {
                self.addEmojiToMsg(data);
            },
        };
        const emojiPicker = new EmojiMart.Picker(pickerOptions);
        this.dom.get('chatEmoji').appendChild(emojiPicker);

        const chatEmojiButton = this.dom.get('chatEmojiButton');
        const chatEmoji = this.dom.get('chatEmoji');
        handleClickOutside(emojiPicker, chatEmojiButton, () => {
            if (chatEmoji && chatEmoji.classList.contains('show')) {
                chatEmoji.classList.remove('show');
                chatEmojiButton.style.color = '#FFFFFF';
            }
        });
    }

    // ####################################################
    // ROOM EMOJI (reactions)
    // ####################################################

    handleRoomEmoji(cmd, duration = 5000) {
        const userEmoji = document.getElementById('userEmoji');
        if (userEmoji) {
            const emojiDisplay = document.createElement('div');
            emojiDisplay.className = 'animate__animated animate__backInUp';
            emojiDisplay.style.padding = '10px';
            emojiDisplay.style.fontSize = '2vh';
            emojiDisplay.style.color = '#FFF';
            emojiDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            emojiDisplay.style.borderRadius = '10px';
            emojiDisplay.style.marginBottom = '5px';
            emojiDisplay.innerText = `${cmd.emoji} ${cmd.peer_name}`;
            userEmoji.appendChild(emojiDisplay);

            setTimeout(() => {
                emojiDisplay.remove();
            }, duration);

            this.handleEmojiSound(cmd);
        }
    }

    handleEmojiSound(cmd) {
        const path = '../sounds/emoji/';
        const ext = '.mp3';
        const force = true; // force sound play even if sound effects are disabled

        switch (cmd.shortcodes) {
            case ':+1:':
            case ':ok_hand:':
                this.rc.sound('ok', force, path, ext);
                break;
            case ':-1:':
                this.rc.sound('boo', force, path, ext);
                break;
            case ':clap:':
                this.rc.sound('applause', force, path, ext);
                break;
            case ':smiley:':
            case ':grinning:':
                this.rc.sound('smile', force, path, ext);
                break;
            case ':joy:':
                this.rc.sound('laughs', force, path, ext);
                break;
            case ':tada:':
                this.rc.sound('congrats', force, path, ext);
                break;
            case ':open_mouth:':
                this.rc.sound('woah', force, path, ext);
                break;
            case ':trumpet:':
                this.rc.sound('trombone', force, path, ext);
                break;
            case ':kissing_heart:':
                this.rc.sound('kiss', force, path, ext);
                break;
            case ':heart:':
            case ':hearts:':
                this.rc.sound('heart', force, path, ext);
                break;
            case ':rocket:':
                this.rc.sound('rocket', force, path, ext);
                break;
            case ':sparkles:':
            case ':star:':
            case ':star2:':
            case ':dizzy:':
                this.rc.sound('tinkerbell', force, path, ext);
                break;
            // ...
            default:
                break;
        }
    }

    // ####################################################
    // MESSAGE INPUT HANDLING
    // ####################################################

    /**
     * Handle chat message input events: keyboard shortcuts, emoji replacement, paste.
     */
    handleChatMessageInput() {
        const chatMessage = this.dom.get('chatMessage');
        const chatSendButton = this.dom.get('chatSendButton');

        chatMessage.onkeyup = (e) => {
            if (e.keyCode === 13 && (this.rc.isMobileDevice || !e.shiftKey)) {
                e.preventDefault();
                chatSendButton.click();
            }
        };

        chatMessage.oninput = () => {
            if (this.isChatPasteTxt) return;
            const regexPattern = new RegExp(
                Object.keys(this.chatInputEmoji)
                    .map((key) => key.replace(/([()[{*+.$^\\|?])/g, '\\$1'))
                    .join('|'),
                'gim',
            );
            chatMessage.value = chatMessage.value.replace(
                regexPattern,
                (match) => this.chatInputEmoji[match],
            );
            this.checkLineBreaks();
        };

        chatMessage.onpaste = () => {
            this.isChatPasteTxt = true;
            this.checkLineBreaks();
        };
    }

    cleanMessage() {
        const chatMessage = this.dom.get('chatMessage');
        chatMessage.value = '';
        chatMessage.setAttribute('rows', '1');
    }

    pasteMessage() {
        const chatMessage = this.dom.get('chatMessage');
        navigator.clipboard
            .readText()
            .then((text) => {
                chatMessage.value += text;
                this.isChatPasteTxt = true;
                this.checkLineBreaks();
            })
            .catch((err) => {
                console.error('Failed to read clipboard contents: ', err);
            });
    }

    checkLineBreaks() {
        const chatMessage = this.dom.get('chatMessage');
        chatMessage.style.height = '';
        if (this.getLineBreaks(chatMessage.value) > 0 || chatMessage.value.length > 50) {
            chatMessage.setAttribute('rows', '2');
        }
    }

    // ####################################################
    // SEND MESSAGE
    // ####################################################

    sendMessage() {
        const chatMessage = this.dom.get('chatMessage');
        const chatSendButton = this.dom.get('chatSendButton');

        if (!this.rc.thereAreParticipants() && !this.isChatGPTOn && !this.isDeepSeekOn) {
            this.cleanMessage();
            this.isChatPasteTxt = false;
            return this.rc.userLog('info', 'No participants in the room', 'top-end');
        }

        // Prevent long messages
        if (this.chatMessageLengthCheck && chatMessage.value.length > this.chatMessageLength) {
            return this.rc.userLog(
                'warning',
                `The message seems too long, with a maximum of ${this.chatMessageLength} characters allowed`,
                'top-end',
            );
        }

        // Spamming detected ban the user from the room
        if (this.chatMessageSpamCount == this.chatMessageSpamCountToBan) {
            return this.rc.roomAction('isBanned', true);
        }

        // Prevent Spam messages
        const currentTime = Date.now();
        if (chatMessage.value && currentTime - this.chatMessageTimeLast <= this.chatMessageTimeBetween) {
            this.cleanMessage();
            chatMessage.readOnly = true;
            chatSendButton.disabled = true;
            setTimeout(function () {
                chatMessage.readOnly = false;
                chatSendButton.disabled = false;
            }, this.chatMessageNotifyDelay);
            this.chatMessageSpamCount++;
            return this.rc.userLog(
                'warning',
                `Kindly refrain from spamming. Please wait ${this.chatMessageNotifyDelay / 1000} seconds before sending another message`,
                'top-end',
                this.chatMessageNotifyDelay,
            );
        }
        this.chatMessageTimeLast = currentTime;

        chatMessage.value = filterXSS(chatMessage.value.trim());
        const peer_msg = this.formatMsg(chatMessage.value);
        if (!peer_msg) {
            return this.cleanMessage();
        }
        this.rc.peer_name = filterXSS(this.rc.peer_name);

        const data = {
            room_id: this.rc.room_id,
            peer_name: this.rc.peer_name,
            peer_avatar: this.rc.peer_avatar,
            peer_id: this.rc.peer_id,
            to_peer_id: '',
            to_peer_name: '',
            peer_msg: peer_msg,
        };

        if (this.isChatGPTOn) {
            this._sendChatGPTMessage(data, peer_msg);
        }

        if (this.isDeepSeekOn) {
            this._sendDeepSeekMessage(data, peer_msg);
        }

        if (!this.isChatGPTOn && !this.isDeepSeekOn) {
            this._sendPeerMessage(data, peer_msg);
        }
    }

    _sendChatGPTMessage(data, peer_msg) {
        data.to_peer_id = 'ChatGPT';
        data.to_peer_name = 'ChatGPT';
        console.log('Send message:', data);
        this.socket.emit('message', data);
        this.setMsgAvatar('left', this.rc.peer_name, this.rc.peer_avatar);
        this.appendMessage(
            'left',
            this.leftMsgAvatar,
            this.rc.peer_name,
            this.rc.peer_id,
            peer_msg,
            data.to_peer_id,
            data.to_peer_name,
        );
        this.cleanMessage();

        this.socket
            .request('getChatGPT', {
                time: getDataTimeString(),
                room: this.rc.room_id,
                name: this.rc.peer_name,
                prompt: peer_msg,
                context: this.chatGPTContext,
            })
            .then((completion) => {
                if (!completion) return;
                const { message, context } = completion;
                this.chatGPTContext = context ? context : [];
                console.log('Receive message:', message);
                this.setMsgAvatar('right', 'ChatGPT');
                this.appendMessage('right', image.chatgpt, 'ChatGPT', this.rc.peer_id, message, 'ChatGPT', 'ChatGPT');
                this.cleanMessage();
                this.rc.streamingTask(message); // Video AI avatar speak
                this.speechInMessages && !VideoAI.active
                    ? this.speechMessage(true, 'ChatGPT', message)
                    : this.rc.sound('message');
            })
            .catch((err) => {
                console.log('ChatGPT error:', err);
            });
    }

    _sendDeepSeekMessage(data, peer_msg) {
        data.to_peer_id = 'DeepSeek';
        data.to_peer_name = 'DeepSeek';
        console.log('Send message:', data);
        this.socket.emit('message', data);
        this.setMsgAvatar('left', this.rc.peer_name, this.rc.peer_avatar);
        this.appendMessage(
            'left',
            this.leftMsgAvatar,
            this.rc.peer_name,
            this.rc.peer_id,
            peer_msg,
            data.to_peer_id,
            data.to_peer_name,
        );
        this.cleanMessage();

        this.socket
            .request('getDeepSeek', {
                time: getDataTimeString(),
                room: this.rc.room_id,
                name: this.rc.peer_name,
                prompt: peer_msg,
                context: this.deepSeekContext,
            })
            .then((completion) => {
                if (!completion) return;
                const { message, context } = completion;
                this.deepSeekContext = context ? context : [];
                console.log('Receive message:', message);
                this.setMsgAvatar('right', 'DeepSeek');
                this.appendMessage(
                    'right',
                    image.deepSeek,
                    'DeepSeek',
                    this.rc.peer_id,
                    message,
                    'DeepSeek',
                    'DeepSeek',
                );
                this.cleanMessage();
                this.rc.streamingTask(message);
                this.speechInMessages && !VideoAI.active
                    ? this.speechMessage(true, 'DeepSeek', message)
                    : this.rc.sound('message');
            })
            .catch((err) => {
                console.log('DeepSeek error:', err);
            });
    }

    _sendPeerMessage(data, peer_msg) {
        const participantsList = this.dom.get('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');
        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            if (li.classList.contains('active')) {
                data.to_peer_id = li.getAttribute('data-to-id');
                data.to_peer_name = li.getAttribute('data-to-name');
                console.log('Send message:', data);
                this.socket.emit('message', data);
                this.setMsgAvatar('left', this.rc.peer_name, this.rc.peer_avatar);
                this.appendMessage(
                    'left',
                    this.leftMsgAvatar,
                    this.rc.peer_name,
                    this.rc.peer_id,
                    peer_msg,
                    data.to_peer_id,
                    data.to_peer_name,
                );
                this.cleanMessage();
            }
        }
    }

    sendMessageTo(to_peer_id, to_peer_name) {
        if (!this.rc.thereAreParticipants()) {
            this.isChatPasteTxt = false;
            this.cleanMessage();
            return this.rc.userLog('info', 'No participants in the room except you', 'top-end');
        }
        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: image.message,
            input: 'text',
            inputPlaceholder: '\uD83D\uDCAC Enter your message...',
            showCancelButton: true,
            confirmButtonText: 'Send',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.value) {
                result.value = filterXSS(result.value.trim());
                let peer_msg = this.formatMsg(result.value);
                if (!peer_msg) {
                    return this.cleanMessage();
                }
                this.rc.peer_name = filterXSS(this.rc.peer_name);
                const toPeerName = filterXSS(to_peer_name);
                let data = {
                    peer_name: this.rc.peer_name,
                    peer_avatar: this.rc.peer_avatar,
                    peer_id: this.rc.peer_id,
                    to_peer_id: to_peer_id,
                    to_peer_name: toPeerName,
                    peer_msg: peer_msg,
                };
                console.log('Send message:', data);
                this.socket.emit('message', data);
                this.setMsgAvatar('left', this.rc.peer_name, this.rc.peer_avatar);
                this.appendMessage(
                    'left',
                    this.leftMsgAvatar,
                    this.rc.peer_name,
                    this.rc.peer_id,
                    peer_msg,
                    to_peer_id,
                    toPeerName,
                );
                if (!this.isChatOpen) this.toggleChat();
            }
        });
    }

    // ####################################################
    // RECEIVE / SHOW MESSAGE
    // ####################################################

    async showMessage(data, doToggleChat = true) {
        const isPublicMessage = data.to_peer_id === 'all';
        const messagePeerId = isPublicMessage ? 'all' : data.peer_id;

        if (doToggleChat && !this.isChatOpen && this.showChatOnMessage) {
            // Auto-switch to the correct tab before opening the chat panel
            if (isPublicMessage) {
                this.chatPeerId = 'all';
                this.chatPeerName = 'all';
                this.chatPeerAvatar = '';
            } else {
                this.chatPeerId = data.peer_id;
                this.chatPeerName = data.peer_name;
                this.chatPeerAvatar = data.peer_avatar || '';
            }
            await this.toggleChat();
        }

        this.setMsgAvatar('right', data.peer_name, data.peer_avatar);
        this.appendMessage(
            'right',
            this.rightMsgAvatar,
            data.peer_name,
            data.peer_id,
            data.peer_msg,
            data.to_peer_id,
            data.to_peer_name,
        );

        if (!this.showChatOnMessage) {
            this.rc.userLog('info', `\uD83D\uDCAC New message from: ${data.peer_name}`, 'top-end');
        }

        if (this.speechInMessages) {
            VideoAI.active
                ? this.rc.streamingTask(`New message from: ${data.peer_name}, the message is: ${data.peer_msg}`)
                : this.speechMessage(true, data.peer_name, data.peer_msg);
        } else {
            this.rc.sound('message');
        }

        // Track unread count when message is not currently visible
        const isMessageVisible = this.isChatOpen && this.chatPeerId === messagePeerId;
        if (!isMessageVisible) {
            this.unreadMessageCounts[messagePeerId] = (this.unreadMessageCounts[messagePeerId] || 0) + 1;
            this.updateUnreadCountBadge(messagePeerId);
        }

        const participantsList = this.dom.get('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');
        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            // INCOMING PUBLIC MESSAGE
            if (isPublicMessage && li.id === 'all' && !isMessageVisible) {
                li.classList.add('pulsate');
            }
            // INCOMING PRIVATE MESSAGE
            if (li.id === data.peer_id && !isPublicMessage && !isMessageVisible) {
                li.classList.add('pulsate');
                if (!['all', 'ChatGPT', 'DeepSeek'].includes(data.to_peer_id)) {
                    this.dom.get(`${data.peer_id}-unread-msg`).classList.remove('hidden');
                }
            }
        }
    }

    // ####################################################
    // UNREAD BADGES
    // ####################################################

    updateUnreadCountBadge(peerId) {
        const count = this.unreadMessageCounts[peerId] || 0;
        try {
            const badge = this.dom.get(`${peerId}-unread-count`);
            if (count > 0) {
                badge.textContent = count;
                badge.classList.remove('hidden');
            } else {
                badge.textContent = '';
                badge.classList.add('hidden');
            }
        } catch (e) {
            // Badge element may not exist yet if participants list hasn't rendered
        }
    }

    // ####################################################
    // APPEND MESSAGE TO DOM
    // ####################################################

    setMsgAvatar(avatar, peerName, peerAvatar = false) {
        const avatarImg =
            peerAvatar && this.rc.isImageURL(peerAvatar)
                ? peerAvatar
                : this.rc.isValidEmail(peerName)
                  ? this.rc.genGravatar(peerName)
                  : this.rc.genAvatarSvg(peerName, 32);
        avatar === 'left' ? (this.leftMsgAvatar = avatarImg) : (this.rightMsgAvatar = avatarImg);
    }

    appendMessage(side, img, fromName, fromId, msg, toId, toName) {
        const getSide = filterXSS(side);
        const getImg = filterXSS(img);
        const getFromName = filterXSS(fromName);
        const getFromId = filterXSS(fromId);
        const getMsg = filterXSS(msg);
        const getToId = filterXSS(toId);
        const getToName = filterXSS(toName);
        const time = this.rc.getTimeNow();

        const myMessage = getSide === 'left';
        const messageClass = myMessage ? 'my-message' : 'other-message float-right';
        const messageData = myMessage ? 'text-start' : 'text-end';
        const timeAndName = myMessage
            ? `<span class="message-data-time">${time}, ${getFromName} ( me ) </span>`
            : `<span class="message-data-time">${time}, ${getFromName} </span>`;

        const formatMessage = this.formatMsg(getMsg);
        const speechButton = this.isSpeechSynthesisSupported
            ? `<button
                    id="msg-speech-${this.chatMessagesId}"
                    class="mr5"
                    onclick="rc.speechElementText('message-${this.chatMessagesId}')">
                    <i class="fas fa-volume-high"></i>
                </button>`
            : '';

        const positionFirst = myMessage
            ? `<img src="${getImg}" alt="avatar" />${timeAndName}`
            : `${timeAndName}<img src="${getImg}" alt="avatar" />`;

        const newMessageHTML = `
            <li id="msg-${this.chatMessagesId}"
                data-from-id="${getFromId}"
                data-from-name="${getFromName}"
                data-to-id="${getToId}"
                data-to-name="${getToName}"
                class="clearfix"
            >
                <div class="message-data ${messageData}">
                    ${positionFirst}
                </div>
                <div class="message ${messageClass}">
                    <span class="text-start" id="message-${this.chatMessagesId}"></span>
                    <hr/>
                    <div class="about-buttons mt5">
                        <button
                            id="msg-copy-${this.chatMessagesId}"
                            class="mr5"
                            onclick="rc.copyToClipboard('message-${this.chatMessagesId}')">
                            <i class="fas fa-paste"></i>
                        </button>
                        ${speechButton}
                        <button
                            id="msg-delete-${this.chatMessagesId}"
                            class="mr5"
                            onclick="rc.deleteMessage('msg-${this.chatMessagesId}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </li>
        `;

        this.collectMessages(time, getFromName, getMsg);

        console.log('Append message to:', { to_id: getToId, to_name: getToName });

        const chatGPTMessages = this.dom.get('chatGPTMessages');
        const deepSeekMessages = this.dom.get('deepSeekMessages');
        const chatPublicMessages = this.dom.get('chatPublicMessages');
        const chatPrivateMessages = this.dom.get('chatPrivateMessages');
        const chatHistory = this.dom.get('chatHistory');

        switch (getToId) {
            case 'ChatGPT':
                chatGPTMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
            case 'DeepSeek':
                deepSeekMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
            case 'all':
                chatPublicMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
            default:
                chatPrivateMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
        }

        const messageEl = document.getElementById(`message-${this.chatMessagesId}`);
        if (messageEl) {
            if (['ChatGPT', 'DeepSeek'].includes(getFromName)) {
                // Stream the message for ChatGPT or DeepSeek
                this.streamMessage(messageEl, getMsg, 100);
            } else {
                // Process the message for other senders
                messageEl.innerHTML = this.processMessage(getMsg);
                hljs.highlightAll();
            }
        }

        chatHistory.scrollTop += 500;

        if (!this.rc.isMobileDevice) {
            this.rc.setTippy('msg-delete-' + this.chatMessagesId, 'Delete', 'top');
            this.rc.setTippy('msg-copy-' + this.chatMessagesId, 'Copy', 'top');
            this.rc.setTippy('msg-speech-' + this.chatMessagesId, 'Speech', 'top');
        }

        this.chatMessagesId++;
        // Update empty chat notice after adding a message
        updateChatEmptyNotice();
    }

    // ####################################################
    // STREAM MESSAGE (ChatGPT/DeepSeek word-by-word)
    // ####################################################

    streamMessage(element, message, speed = 100) {
        const parts = this.processMessage(message);
        const words = parts.split(' ');

        let textBuffer = '';
        let wordIndex = 0;

        const interval = setInterval(() => {
            if (wordIndex < words.length) {
                textBuffer += words[wordIndex] + ' ';
                element.innerHTML = textBuffer;
                wordIndex++;
            } else {
                clearInterval(interval);
                highlightCodeBlocks(element);
            }
        }, speed);

        function highlightCodeBlocks(el) {
            const codeBlocks = el.querySelectorAll('pre code');
            codeBlocks.forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }

    // ####################################################
    // MESSAGE PROCESSING
    // ####################################################

    processMessage(message) {
        const codeBlockRegex = /```([a-zA-Z0-9]+)?\n([\s\S]*?)```/g;
        let parts = [];
        let lastIndex = 0;

        message.replace(codeBlockRegex, (match, lang, code, offset) => {
            if (offset > lastIndex) {
                parts.push({ type: 'text', value: message.slice(lastIndex, offset) });
            }
            parts.push({ type: 'code', lang, value: code });
            lastIndex = offset + match.length;
        });

        if (lastIndex < message.length) {
            parts.push({ type: 'text', value: message.slice(lastIndex) });
        }

        return parts
            .map((part) => {
                if (part.type === 'text') {
                    return part.value;
                } else if (part.type === 'code') {
                    return `<pre><code class="language-${part.lang || ''}">${part.value}</code></pre>`;
                }
            })
            .join('');
    }

    // ####################################################
    // DELETE / COPY MESSAGE
    // ####################################################

    deleteMessage(id) {
        Swal.fire({
            background: swalBackground,
            position: 'top',
            title: 'Delete this Message?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: 'Yes',
            denyButtonText: 'No',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.dom.get(id).remove();
                this.rc.sound('delete');
                updateChatEmptyNotice();
            }
        });
    }

    copyToClipboard(id) {
        const text = this.dom.get(id).innerText;
        navigator.clipboard
            .writeText(text)
            .then(() => {
                this.rc.userLog('success', 'Message copied!', 'top-end', 1000);
            })
            .catch((err) => {
                this.rc.userLog('error', err, 'top-end', 6000);
            });
    }

    // ####################################################
    // MESSAGE FORMAT HELPERS
    // ####################################################

    formatMsg(msg) {
        const message = filterXSS(msg);
        if (message.trim().length == 0) return;
        if (this.rc.isHtml(message)) return this.rc.sanitizeHtml(message);
        if (this.rc.isValidHttpURL(message)) {
            if (this.rc.isImageURL(message)) return this.rc.getImage(message);
            //if (this.rc.isVideoTypeSupported(message)) return this.rc.getIframe(message);
            return this.rc.getLink(message);
        }
        if (this.isChatMarkdownOn) return marked.parse(message);
        if (this.isChatPasteTxt && this.getLineBreaks(message) > 1) {
            this.isChatPasteTxt = false;
            return this.rc.getPre(message);
        }
        if (this.getLineBreaks(message) > 1) return this.rc.getPre(message);
        console.log('FormatMsg', message);
        return message;
    }

    getLineBreaks(message) {
        return (message.match(/\n/g) || []).length;
    }

    // ####################################################
    // MESSAGE COLLECTION (for saving)
    // ####################################################

    collectMessages(time, from, msg) {
        this.chatMessages.push({
            time: time,
            from: from,
            msg: msg,
        });
    }

    // ####################################################
    // SPEECH
    // ####################################################

    speechMessage(newMsg = true, from, msg) {
        const speech = new SpeechSynthesisUtterance();
        speech.text = (newMsg ? 'New' : '') + ' message from:' + from + '. The message is:' + msg;
        speech.rate = 0.9;
        window.speechSynthesis.speak(speech);
    }

    speechElementText(elemId) {
        const element = this.dom.get(elemId);
        this.speechText(element.innerText);
    }

    speechText(msg) {
        if (VideoAI.active) {
            this.rc.streamingTask(msg);
        } else {
            const speech = new SpeechSynthesisUtterance();
            speech.text = msg;
            speech.rate = 0.9;
            window.speechSynthesis.speak(speech);
        }
    }

    // ####################################################
    // CHAT CLEAN / SAVE
    // ####################################################

    chatClean() {
        if (this.chatMessages.length === 0) {
            return userLog('info', 'No chat messages to clean', 'top-end');
        }
        Swal.fire({
            background: swalBackground,
            position: 'top',
            title: 'Clean up all chat Messages?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: 'Yes',
            denyButtonText: 'No',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                function removeAllChildNodes(parentNode) {
                    while (parentNode.firstChild) {
                        parentNode.removeChild(parentNode.firstChild);
                    }
                }
                // Remove child nodes from different message containers
                removeAllChildNodes(this.dom.get('chatGPTMessages'));
                removeAllChildNodes(this.dom.get('deepSeekMessages'));
                removeAllChildNodes(this.dom.get('chatPublicMessages'));
                removeAllChildNodes(this.dom.get('chatPrivateMessages'));
                this.chatMessages = [];
                this.chatGPTContext = [];
                this.deepSeekContext = [];
                updateChatEmptyNotice();
                this.rc.sound('delete');
            }
        });
    }

    chatSave() {
        if (this.chatMessages.length === 0) {
            return userLog('info', 'No chat messages to save', 'top-end');
        }
        saveObjToJsonFile(this.chatMessages, 'CHAT');
    }

    // ####################################################
    // EMPTY NOTICE
    // ####################################################

    /**
     * Show or hide the chat empty notice depending on whether any messages exist.
     */
    updateChatEmptyNotice() {
        const chatLists = [
            this.dom.get('chatGPTMessages'),
            this.dom.get('deepSeekMessages'),
            this.dom.get('chatPublicMessages'),
            this.dom.get('chatPrivateMessages'),
        ].filter(Boolean);
        const emptyNotice = this.dom.get('chatEmptyNotice');
        if (!emptyNotice) return;
        const hasMessages = chatLists.some((ul) => ul.children.length > 0);
        hasMessages ? emptyNotice.classList.add('hidden') : emptyNotice.classList.remove('hidden');
    }

    // ####################################################
    // PEER ABOUT AND MESSAGES
    // ####################################################

    showPeerAboutAndMessages(peer_id, peer_name, peer_avatar = false, event = null) {
        this.hidePeerMessages();

        this.chatPeerId = peer_id;
        this.chatPeerName = peer_name;
        this.chatPeerAvatar = peer_avatar;

        const chatAbout = this.dom.get('chatAbout');
        const participant = this.dom.get(peer_id);
        const participantsList = this.dom.get('participantsList');
        const chatPrivateMessages = this.dom.get('chatPrivateMessages');
        const messagePrivateListItems = chatPrivateMessages.getElementsByTagName('li');
        const participantsListItems = participantsList.getElementsByTagName('li');
        const avatarImg = getParticipantAvatar(peer_name, peer_avatar);

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
        const selectedLi = this.dom.get(peer_id);
        if (selectedLi) selectedLi.classList.remove('pulsate');

        if (!['all', 'ChatGPT', 'DeepSeek'].includes(peer_id)) {
            // icon private new message to read
            this.dom.get(`${peer_id}-unread-msg`).classList.add('hidden');
        }

        // Clear unread count badge for selected peer
        this.unreadMessageCounts[peer_id] = 0;
        this.updateUnreadCountBadge(peer_id);

        participant.classList.add('active');

        this.isChatGPTOn = false;
        this.isDeepSeekOn = false;

        console.log('Display messages', peer_id);

        switch (peer_id) {
            case 'ChatGPT':
                if (this.rc._moderator.chat_cant_chatgpt) {
                    return userLog('warning', 'The moderator does not allow you to chat with ChatGPT', 'top-end', 6000);
                }
                this.isChatGPTOn = true;
                chatAbout.innerHTML = generateChatAboutHTML(image.chatgpt, 'ChatGPT');
                this.dom.get('chatGPTMessages').style.display = 'block';
                break;
            case 'DeepSeek':
                if (this.rc._moderator.chat_cant_deep_seek) {
                    return userLog(
                        'warning',
                        'The moderator does not allow you to chat with DeepSeek',
                        'top-end',
                        6000,
                    );
                }
                this.isDeepSeekOn = true;
                chatAbout.innerHTML = generateChatAboutHTML(image.deepSeek, 'DeepSeek');
                this.dom.get('deepSeekMessages').style.display = 'block';
                break;
            case 'all':
                chatAbout.innerHTML = generateChatAboutHTML(image.all, 'Public chat', 'online', participantsCount);
                this.dom.get('chatPublicMessages').style.display = 'block';
                break;
            default:
                if (this.rc._moderator.chat_cant_privately) {
                    return userLog('warning', 'The moderator does not allow you to chat privately', 'top-end', 6000);
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
            if (
                (this.rc.isMobileDevice || this.isChatPinned) &&
                (!this.dom.get('plist') || !this.dom.get('plist').classList.contains('hidden'))
            ) {
                this.toggleShowParticipants();
            }
        }
    }

    hidePeerMessages() {
        elemDisplay('chatGPTMessages', false);
        elemDisplay('deepSeekMessages', false);
        elemDisplay('chatPublicMessages', false);
        elemDisplay('chatPrivateMessages', false);
    }

    // ####################################################
    // FILE SHARING (via chat context)
    // ####################################################

    selectFileToShare(peer_id, broadcast = false) {
        const self = this;
        this.rc.sound('open');

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
                accept: this.rc.fileSharingInput,
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
                self.rc.sendFileInformations(result.value, peer_id, broadcast);
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
                self.rc.sendFileInformations(file, peer_id, broadcast);
            }
        }
    }

    // ####################################################
    // ROOM MESSAGE (status notifications)
    // ####################################################

    roomMessage(action, active = false) {
        const status = active ? 'ON' : 'OFF';
        this.rc.sound('switch');
        switch (action) {
            case 'toggleVideoMirror':
                this.rc.userLog('info', `${icons.mirror} Video mirror ${status}`, 'top-end');
                break;
            case 'pitchBar':
                this.rc.userLog('info', `${icons.pitchBar} Audio pitch bar ${status}`, 'top-end');
                break;
            case 'sounds':
                this.rc.userLog('info', `${icons.sounds} Sounds notification ${status}`, 'top-end');
                break;
            case 'ptt':
                this.rc.userLog('info', `${icons.ptt} Push to talk ${status}`, 'top-end');
                break;
            case 'notify':
                this.rc.userLog('info', `${icons.share} Share room on join ${status}`, 'top-end');
                break;
            case 'hostOnlyRecording':
                this.rc.userLog('info', `${icons.recording} Only host recording ${status}`, 'top-end');
                break;
            case 'showChat':
                active
                    ? this.rc.userLog('info', `${icons.chat} Chat will be shown, when you receive a message`, 'top-end')
                    : this.rc.userLog(
                          'info',
                          `${icons.chat} Chat not will be shown, when you receive a message`,
                          'top-end',
                      );
                break;
            case 'speechMessages':
                this.rc.userLog('info', `${icons.speech} Speech incoming messages ${status}`, 'top-end');
                break;
            case 'transcriptShowOnMsg':
                active
                    ? this.rc.userLog(
                          'info',
                          `${icons.transcript} Transcript will be shown, when you receive a message`,
                          'top-end',
                      )
                    : this.rc.userLog(
                          'info',
                          `${icons.transcript} Transcript not will be shown, when you receive a message`,
                          'top-end',
                      );
                break;
            case 'video_start_privacy':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone starts in privacy mode ${status}`,
                    'top-end',
                );
                break;
            case 'audio_start_muted':
                this.rc.userLog('info', `${icons.moderator} Moderator: everyone starts muted ${status}`, 'top-end');
                break;
            case 'video_start_hidden':
                this.rc.userLog('info', `${icons.moderator} Moderator: everyone starts hidden ${status}`, 'top-end');
                break;
            case 'audio_cant_unmute':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't unmute themselves ${status}`,
                    'top-end',
                );
                break;
            case 'video_cant_unhide':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't unhide themselves ${status}`,
                    'top-end',
                );
                break;
            case 'screen_cant_share':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't share the screen ${status}`,
                    'top-end',
                );
                break;
            case 'chat_cant_privately':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't chat privately ${status}`,
                    'top-end',
                );
                break;
            case 'chat_cant_chatgpt':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't chat with ChatGPT ${status}`,
                    'top-end',
                );
                break;
            case 'chat_cant_deep_seek':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't chat with DeepSeek ${status}`,
                    'top-end',
                );
                break;
            case 'media_cant_sharing':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't share media ${status}`,
                    'top-end',
                );
                break;
            case 'disconnect_all_on_leave':
                this.rc.userLog(
                    'info',
                    `${icons.moderator} Moderator: disconnect all on leave room ${status}`,
                    'top-end',
                );
                break;
            case 'recSyncServer':
                active
                    ? this.rc.showRecServerSideAdvice()
                    : this.rc.userLog('info', `${icons.recording} Server sync recording ${status}`, 'top-end');
                break;
            case 'customThemeKeep':
                this.rc.userLog('info', `${icons.theme} Custom theme keep ${status}`, 'top-end');
                break;
            case 'save_room_notifications':
                this.rc.userLog('success', 'Room notifications saved successfully', 'top-end');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // VIDEO AI CHAT ORCHESTRATION
    // ####################################################

    handleDesktopVideoAiChat() {
        if (!this.isChatOpen) {
            this.toggleChat();
        }
        this.sendMessageToVideoAi();
    }

    handleMobileVideoAiChat() {
        if (this.rc.videoMediaContainer.childElementCount <= 2) {
            isHideMeActive = !isHideMeActive;
            this.rc.handleHideMe();
        }
        setTimeout(() => {
            this.rc.streamingTask(
                `Welcome to ${BRAND.app.name}! Please Open the Chat and navigate to the ChatGPT section. Feel free to ask me any questions you have.`,
            );
        }, 2000);
    }

    sendMessageToVideoAi() {
        const chatMessage = this.dom.get('chatMessage');
        const tasks = [
            { delay: 1000, action: () => this.chatPin() },
            { delay: 1200, action: () => this.toggleShowParticipants() },
            { delay: 1400, action: () => this.showPeerAboutAndMessages('ChatGPT', 'ChatGPT') },
            { delay: 1600, action: () => this.rc.streamingTask(`Welcome to ${BRAND.app.name}!`) },
            {
                delay: 2000,
                action: () => {
                    chatMessage.value = 'Hello!';
                    this.sendMessage();
                },
            },
        ];
        this.rc.executeTasksSequentially(tasks);
    }

    // ####################################################
    // PARTICIPANTS LIST GENERATION
    // ####################################################

    /**
     * Generate the participants list HTML with ChatGPT, DeepSeek, public chat and peer entries.
     * @param {Map} peers - Map of peers
     * @returns {string} HTML string for the participants list
     */
    getParticipantsList(peers) {
        let li = '';

        const chatGPT = BUTTONS.chat.chatGPT !== undefined ? BUTTONS.chat.chatGPT : true;

        // CHAT-GPT
        if (chatGPT) {
            const chatgpt_active = this.chatPeerName === 'ChatGPT' ? ' active' : '';
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

        const deepSeek = BUTTONS.chat.deepSeek !== undefined ? BUTTONS.chat.deepSeek : true;

        // DEEP-SEEK
        if (deepSeek) {
            const deepSeek_active = this.chatPeerName === 'DeepSeek' ? ' active' : '';
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

        const public_chat_active = this.chatPeerName === 'all' ? ' active' : '';

        // ALL (public chat)
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
                <div class="status"> <i class="fa fa-circle online"></i> online ${participantsCount} <span id="all-unread-count" class="unread-count hidden"></span></div>
            </div>`;

        // ONLY PRESENTER CAN EXECUTE THIS CMD
        if (!isRulesActive || isPresenter) {
            li += `
            <div class="dropdown">
                <button
                    class="dropdown-toggle"
                    type="button"
                    id="${socket.id}-chatDropDownMenu"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    style="float: right"
                >
                <i class="fas fa-bars"></i>
                </button>
                <ul class="dropdown-menu text-start" aria-labelledby="${socket.id}-chatDropDownMenu">`;

            li += `<li><button class="ml5" id="muteAllParticipantsButton" onclick="rc.peerAction('me','${socket.id}','mute',true,true)">${_PEER.audioOff} Mute all participants</button></li>`;
            li += `<li><button class="ml5" id="hideAllParticipantsButton" onclick="rc.peerAction('me','${socket.id}','hide',true,true)">${_PEER.videoOff} Hide all participants</button></li>`;
            li += `<li><button class="ml5" id="stopAllParticipantsButton" onclick="rc.peerAction('me','${socket.id}','stop',true,true)">${_PEER.screenOff} Stop all screens sharing</button></li>`;

            if (BUTTONS.participantsList.sendFileAllButton) {
                li += `<li><button class="btn-sm ml5" id="sendAllButton" onclick="rc.selectFileToShare('${socket.id}', true)">${_PEER.sendFile} Share file to all</button></li>`;
            }

            li += `<li><button class="btn-sm ml5" id="sendVideoToAll" onclick="rc.shareVideo('all');">${_PEER.sendVideo} Share audio/video to all</button></li>`;

            if (BUTTONS.participantsList.ejectAllButton) {
                li += `<li><button class="btn-sm ml5" id="ejectAllButton" onclick="rc.peerAction('me','${socket.id}','eject',true,true)">${_PEER.ejectPeer} Eject all participants</button></li>`;
            }

            li += `</ul>
            </div>

            <br/>

            <div class="about-buttons mt5">
                <button class="ml5" id="muteAllButton" onclick="rc.peerAction('me','${socket.id}','mute',true,true)">${_PEER.audioOff}</button>
                <button class="ml5" id="hideAllButton" onclick="rc.peerAction('me','${socket.id}','hide',true,true)">${_PEER.videoOff}</button>
                <button class="ml5" id="stopAllButton" onclick="rc.peerAction('me','${socket.id}','stop',true,true)">${_PEER.screenOff}</button>
            </div>`;
        }

        li += `
        </li>
        `;

        return li;
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    close() {
        if (this.socket) {
            this.socket.off('message', this._onMessage);
        }
        if (this.isChatPinned) {
            this.chatUnpin();
        }
        this.isChatOpen = false;
        this.isChatPinned = false;
        this.isChatMaximized = false;
        this.isChatEmojiOpen = false;
        this.isChatBgTransparent = false;
        this.isChatGPTOn = false;
        this.isDeepSeekOn = false;
        this.isChatPasteTxt = false;
        this.isChatMarkdownOn = false;
        this.chatPeerId = 'all';
        this.chatPeerName = 'all';
        this.chatPeerAvatar = '';
        this.chatMessagesId = 0;
        this.chatMessages = [];
        this.chatGPTContext = [];
        this.deepSeekContext = [];
        this.unreadMessageCounts = {};
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;
        this.chatMessageSpamCount = 0;
        this.chatMessageTimeLast = 0;
        this.socketManager = null;
        this.rc = null;
        this.socket = null;
    }
}
