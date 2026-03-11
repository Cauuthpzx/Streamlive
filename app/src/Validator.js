'use strict';

const path = require('path');

const checkXSS = require('./XSS.js');

function isValidRoomName(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const room = checkXSS(input);

    if (!room || ['false', 'undefined', '', null, undefined, 'favicon.ico'].includes(room.trim().toLowerCase())) {
        return false;
    }

    return !hasPathTraversal(room);
}

function isValidRecFileNameFormat(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const validPattern = /^Rec_[a-zA-Z0-9_.-]+\.webm$/;
    if (!validPattern.test(input)) {
        return false;
    }
    return !hasPathTraversal(input);
}

function hasPathTraversal(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }

    let decodedInput = input;
    // Decode in a loop until stable (handles multi-level encoding)
    for (let i = 0; i < 5; i++) {
        try {
            const decoded = decodeURIComponent(decodedInput);
            if (decoded === decodedInput) break;
            decodedInput = decoded;
        } catch (err) {
            break;
        }
    }
    // Reject any input that still contains % after decoding (potential bypass)
    if (/%[0-9A-Fa-f]{2}/.test(decodedInput) && decodedInput !== input) {
        return true;
    }

    const pathTraversalPattern = /(\.\.(\/|\\))+/;
    const excessiveDotsPattern = /(\.{4,}\/+|\.{4,}\\+)/;
    const complexTraversalPattern = /(\.{2,}(\/+|\\+))/;

    if (complexTraversalPattern.test(decodedInput)) {
        return true;
    }

    const normalizedPath = path.normalize(decodedInput);

    if (pathTraversalPattern.test(normalizedPath) || excessiveDotsPattern.test(normalizedPath)) {
        return true;
    }

    return false;
}

function isValidEmail(email) {
    if (!email || typeof email !== 'string' || email.length > 254) return false;
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    return emailRegex.test(email);
}

function isValidData(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    return Object.keys(data).length > 0;
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
    hasPathTraversal,
    isValidEmail,
    isValidData,
};
