'use strict';

/**
 * EventBus — Central pub/sub communication for decoupled component interaction.
 *
 * Event naming convention: domain:action
 * Examples: chat:messageSent, peer:joined, whiteboard:toggle, recording:started
 */
class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event - Event name (e.g., 'chat:toggle')
     * @param {Function} callback - Handler function
     * @returns {EventBus} this (for chaining)
     */
    on(event, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('EventBus.on: callback must be a function');
        }
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
        return this;
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name
     * @param {Function} callback - Handler to remove
     * @returns {EventBus} this (for chaining)
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return this;

        const idx = listeners.findIndex((fn) => fn === callback || fn._original === callback);
        if (idx !== -1) {
            listeners.splice(idx, 1);
            if (listeners.length === 0) {
                this._listeners.delete(event);
            }
        }
        return this;
    }

    /**
     * Emit an event to all subscribers.
     * @param {string} event - Event name
     * @param {*} [data] - Data to pass to handlers
     * @returns {boolean} true if any handlers were called
     */
    emit(event, data) {
        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0) return false;

        // Copy array to avoid issues if handlers add/remove listeners
        const copy = [...listeners];
        for (const cb of copy) {
            try {
                cb(data);
            } catch (err) {
                console.error(`EventBus: error in handler for "${event}"`, err);
            }
        }
        return true;
    }

    /**
     * Subscribe to an event once — handler auto-removed after first call.
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {EventBus} this (for chaining)
     */
    once(event, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('EventBus.once: callback must be a function');
        }
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        wrapper._original = callback;
        return this.on(event, wrapper);
    }

    /**
     * Remove all listeners for a specific event, or all events if no event given.
     * @param {string} [event] - Event name (optional)
     */
    clear(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }

    /**
     * Get the count of listeners for an event.
     * @param {string} event - Event name
     * @returns {number} listener count
     */
    listenerCount(event) {
        const listeners = this._listeners.get(event);
        return listeners ? listeners.length : 0;
    }
}
