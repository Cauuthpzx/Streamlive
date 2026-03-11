'use strict';

/**
 * SocketManager — Socket.io wrapper that centralizes connection management
 * and routes events to appropriate component managers via EventBus.
 *
 * Replaces the global `socket` variable with a managed wrapper.
 * Each component manager registers only the socket events it needs.
 */
class SocketManager {
    constructor(eventBus) {
        this._eventBus = eventBus;
        this._socket = null;
        this._connected = false;
        this._handlers = new Map(); // event -> [callbacks] for cleanup tracking
        this._pendingHandlers = []; // handlers registered before connect
    }

    /**
     * Connect to the signaling server.
     * @param {string} url - Server URL
     * @param {Object} options - Socket.io connection options
     * @returns {Object} The raw socket instance
     */
    connect(url, options) {
        if (this._socket) {
            console.warn('SocketManager: already connected, returning existing socket');
            return this._socket;
        }

        this._socket = io(url, options);
        this._setupCoreHandlers();

        // Replay any handlers registered before connect
        for (const { event, callback } of this._pendingHandlers) {
            this.on(event, callback);
        }
        this._pendingHandlers = [];

        return this._socket;
    }

    /**
     * Setup core connection lifecycle handlers.
     * These emit events on the EventBus for any manager to listen to.
     * @private
     */
    _setupCoreHandlers() {
        this._socket.on('connect', () => {
            this._connected = true;
            this._eventBus.emit('socket:connected', { id: this._socket.id });
        });

        this._socket.on('disconnect', (reason) => {
            this._connected = false;
            this._eventBus.emit('socket:disconnected', { reason });
        });

        this._socket.on('connect_error', (err) => {
            this._eventBus.emit('socket:error', { error: err.message || err });
        });
    }

    /**
     * Register a socket event handler.
     * Managers use this to listen for specific socket events.
     * @param {string} event - Socket event name
     * @param {Function} callback - Handler function
     * @returns {SocketManager} this (for chaining)
     */
    on(event, callback) {
        if (!this._socket) {
            this._pendingHandlers.push({ event, callback });
            return this;
        }
        this._socket.on(event, callback);

        // Track for cleanup
        if (!this._handlers.has(event)) {
            this._handlers.set(event, []);
        }
        this._handlers.get(event).push(callback);

        return this;
    }

    /**
     * Remove a socket event handler.
     * @param {string} event - Socket event name
     * @param {Function} callback - Handler to remove
     * @returns {SocketManager} this (for chaining)
     */
    off(event, callback) {
        if (!this._socket) return this;
        this._socket.off(event, callback);

        const handlers = this._handlers.get(event);
        if (handlers) {
            const idx = handlers.indexOf(callback);
            if (idx !== -1) handlers.splice(idx, 1);
        }

        return this;
    }

    /**
     * Emit a socket event to the server.
     * @param {string} event - Socket event name
     * @param {*} data - Data to send
     * @param {Function} [ack] - Optional acknowledgement callback
     */
    emit(event, data, ack) {
        if (!this._socket) {
            console.warn(`SocketManager.emit("${event}"): socket not connected`);
            return;
        }
        if (typeof ack === 'function') {
            this._socket.emit(event, data, ack);
        } else if (typeof data !== 'undefined') {
            this._socket.emit(event, data);
        } else {
            this._socket.emit(event);
        }
    }

    /**
     * Get the raw Socket.io instance.
     * Used for backward compatibility during transition.
     * @returns {Object|null} Socket instance
     */
    getSocket() {
        return this._socket;
    }

    /**
     * Get connection state.
     * @returns {boolean}
     */
    get connected() {
        return this._connected;
    }

    /**
     * Get the socket ID.
     * @returns {string|null}
     */
    get id() {
        return this._socket ? this._socket.id : null;
    }

    /**
     * Disconnect and cleanup all handlers.
     */
    disconnect() {
        if (!this._socket) return;

        // Remove all tracked handlers
        for (const [event, callbacks] of this._handlers) {
            for (const cb of callbacks) {
                this._socket.off(event, cb);
            }
        }
        this._handlers.clear();

        this._socket.disconnect();
        this._socket = null;
        this._connected = false;
    }
}
