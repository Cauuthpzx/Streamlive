'use strict';

/**
 * DOMCache — Cache DOM element references to eliminate repeated getElementById() calls.
 *
 * Room.js currently makes 200+ getElementById() calls, many repeated.
 * DOMCache queries once, caches forever (static elements) or until invalidated (dynamic elements).
 */
class DOMCache {
    constructor() {
        this._cache = new Map();
        this._queryCache = new Map();
    }

    /**
     * Get a cached element by ID. Queries the DOM only on first access.
     * @param {string} id - Element ID
     * @returns {HTMLElement|null}
     */
    get(id) {
        if (this._cache.has(id)) {
            return this._cache.get(id);
        }
        const el = document.getElementById(id);
        if (el) {
            this._cache.set(id, el);
        }
        return el;
    }

    /**
     * Get a cached element by CSS selector. Queries the DOM only on first access.
     * @param {string} selector - CSS selector
     * @returns {HTMLElement|null}
     */
    query(selector) {
        if (this._queryCache.has(selector)) {
            return this._queryCache.get(selector);
        }
        const el = document.querySelector(selector);
        if (el) {
            this._queryCache.set(selector, el);
        }
        return el;
    }

    /**
     * Query all elements matching a selector (not cached — returns fresh NodeList).
     * @param {string} selector - CSS selector
     * @returns {NodeList}
     */
    queryAll(selector) {
        return document.querySelectorAll(selector);
    }

    /**
     * Preload multiple element IDs into cache at once.
     * Call during init to batch-cache all known static elements.
     * @param {string[]} ids - Array of element IDs
     */
    preload(ids) {
        for (const id of ids) {
            this.get(id);
        }
    }

    /**
     * Invalidate (remove from cache) a specific element by ID.
     * Use for dynamic elements that are added/removed (e.g., peer video containers).
     * @param {string} id - Element ID to invalidate
     */
    invalidate(id) {
        this._cache.delete(id);
    }

    /**
     * Invalidate a cached selector query.
     * @param {string} selector - CSS selector to invalidate
     */
    invalidateQuery(selector) {
        this._queryCache.delete(selector);
    }

    /**
     * Invalidate all cached entries matching a prefix.
     * Useful when a peer leaves: invalidateByPrefix('video_' + peerId)
     * @param {string} prefix - ID prefix to match
     */
    invalidateByPrefix(prefix) {
        for (const key of this._cache.keys()) {
            if (key.startsWith(prefix)) {
                this._cache.delete(key);
            }
        }
    }

    /**
     * Check if an element ID is currently cached.
     * @param {string} id - Element ID
     * @returns {boolean}
     */
    has(id) {
        return this._cache.has(id);
    }

    /**
     * Force-set a cache entry (for dynamically created elements).
     * @param {string} id - Element ID
     * @param {HTMLElement} el - The element
     */
    set(id, el) {
        this._cache.set(id, el);
    }

    /**
     * Clear all cached references.
     */
    clear() {
        this._cache.clear();
        this._queryCache.clear();
    }

    /**
     * Get the number of cached entries.
     * @returns {number}
     */
    get size() {
        return this._cache.size + this._queryCache.size;
    }
}
