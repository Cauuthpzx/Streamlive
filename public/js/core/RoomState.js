'use strict';

/**
 * RoomState — Centralized shared state management.
 * Replaces 80+ global variables in Room.js with a single state object.
 * Emits events via EventBus when state changes for reactive updates.
 */
class RoomState {
    constructor(eventBus) {
        this._eventBus = eventBus;

        // Room info
        this._roomId = null;
        this._roomPassword = null;
        this._isLocked = false;
        this._isLobbyEnabled = false;

        // Peer info
        this._peerId = null;
        this._peerName = null;
        this._peerAvatar = null;
        this._isPresenter = false;

        // Media state
        this._audioEnabled = false;
        this._videoEnabled = false;
        this._screenEnabled = false;
        this._handRaised = false;

        // Feature state
        this._isRecording = false;
        this._isRtmpStreaming = false;
        this._chatOpen = false;
        this._whiteboardOpen = false;
        this._settingsOpen = false;
        this._participantsOpen = false;
        this._editorOpen = false;

        // Peers
        this._peers = new Map();

        // Custom state for managers
        this._custom = {};
    }

    // --- State setter with event emission ---

    _set(key, value) {
        const privateKey = '_' + key;
        const oldValue = this[privateKey];
        if (oldValue === value) return;
        this[privateKey] = value;
        if (this._eventBus) {
            this._eventBus.emit('state:changed', { key, oldValue, newValue: value });
            this._eventBus.emit(`state:${key}`, { oldValue, newValue: value });
        }
    }

    // --- Room info ---

    get roomId() {
        return this._roomId;
    }
    set roomId(v) {
        this._set('roomId', v);
    }

    get roomPassword() {
        return this._roomPassword;
    }
    set roomPassword(v) {
        this._set('roomPassword', v);
    }

    get isLocked() {
        return this._isLocked;
    }
    set isLocked(v) {
        this._set('isLocked', v);
    }

    get isLobbyEnabled() {
        return this._isLobbyEnabled;
    }
    set isLobbyEnabled(v) {
        this._set('isLobbyEnabled', v);
    }

    // --- Peer info ---

    get peerId() {
        return this._peerId;
    }
    set peerId(v) {
        this._set('peerId', v);
    }

    get peerName() {
        return this._peerName;
    }
    set peerName(v) {
        this._set('peerName', v);
    }

    get peerAvatar() {
        return this._peerAvatar;
    }
    set peerAvatar(v) {
        this._set('peerAvatar', v);
    }

    get isPresenter() {
        return this._isPresenter;
    }
    set isPresenter(v) {
        this._set('isPresenter', v);
    }

    // --- Media state ---

    get audioEnabled() {
        return this._audioEnabled;
    }
    set audioEnabled(v) {
        this._set('audioEnabled', v);
    }

    get videoEnabled() {
        return this._videoEnabled;
    }
    set videoEnabled(v) {
        this._set('videoEnabled', v);
    }

    get screenEnabled() {
        return this._screenEnabled;
    }
    set screenEnabled(v) {
        this._set('screenEnabled', v);
    }

    get handRaised() {
        return this._handRaised;
    }
    set handRaised(v) {
        this._set('handRaised', v);
    }

    // --- Feature state ---

    get isRecording() {
        return this._isRecording;
    }
    set isRecording(v) {
        this._set('isRecording', v);
    }

    get isRtmpStreaming() {
        return this._isRtmpStreaming;
    }
    set isRtmpStreaming(v) {
        this._set('isRtmpStreaming', v);
    }

    get chatOpen() {
        return this._chatOpen;
    }
    set chatOpen(v) {
        this._set('chatOpen', v);
    }

    get whiteboardOpen() {
        return this._whiteboardOpen;
    }
    set whiteboardOpen(v) {
        this._set('whiteboardOpen', v);
    }

    get settingsOpen() {
        return this._settingsOpen;
    }
    set settingsOpen(v) {
        this._set('settingsOpen', v);
    }

    get participantsOpen() {
        return this._participantsOpen;
    }
    set participantsOpen(v) {
        this._set('participantsOpen', v);
    }

    get editorOpen() {
        return this._editorOpen;
    }
    set editorOpen(v) {
        this._set('editorOpen', v);
    }

    // --- Peers management ---

    get peers() {
        return this._peers;
    }

    addPeer(id, info) {
        this._peers.set(id, info);
        if (this._eventBus) {
            this._eventBus.emit('state:peerAdded', { id, info });
        }
    }

    removePeer(id) {
        const info = this._peers.get(id);
        this._peers.delete(id);
        if (this._eventBus) {
            this._eventBus.emit('state:peerRemoved', { id, info });
        }
    }

    getPeer(id) {
        return this._peers.get(id) || null;
    }

    get peerCount() {
        return this._peers.size;
    }

    // --- Custom state for managers ---

    setCustom(key, value) {
        const oldValue = this._custom[key];
        this._custom[key] = value;
        if (this._eventBus) {
            this._eventBus.emit(`state:custom:${key}`, { oldValue, newValue: value });
        }
    }

    getCustom(key, defaultValue) {
        return key in this._custom ? this._custom[key] : defaultValue;
    }

    // --- Bulk update ---

    update(obj) {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof this[key] !== 'undefined' && key[0] !== '_') {
                this[key] = value;
            }
        }
    }

    // --- Snapshot ---

    toJSON() {
        return {
            roomId: this._roomId,
            peerId: this._peerId,
            peerName: this._peerName,
            isPresenter: this._isPresenter,
            audioEnabled: this._audioEnabled,
            videoEnabled: this._videoEnabled,
            screenEnabled: this._screenEnabled,
            isRecording: this._isRecording,
            isRtmpStreaming: this._isRtmpStreaming,
            peerCount: this._peers.size,
        };
    }
}
