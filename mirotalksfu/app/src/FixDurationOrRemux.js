'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fixWebmDurationBuffer } = require('./FixWebmDurationBuffer');

const Logger = require('./Logger');
const log = new Logger('DurationOrRemux');

// Cache ffmpeg availability check (only check once)
let _hasFfmpeg = null;

function hasFfmpeg() {
    if (_hasFfmpeg !== null) return _hasFfmpeg;
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    _hasFfmpeg = r.status === 0;
    return _hasFfmpeg;
}

// Async remux to avoid blocking the event loop
function remuxWithFfmpegAsync(inputPath, format = 'webm') {
    return new Promise((resolve) => {
        const dir = path.dirname(inputPath);
        const base = path.basename(inputPath, path.extname(inputPath));
        const out = path.join(dir, `${base}.fixed.${format}`);

        const args = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            inputPath,
            '-c',
            'copy',
            ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
            out,
        ];

        const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
        proc.on('close', (code) => {
            if (code !== 0 || !fs.existsSync(out)) {
                resolve(null);
                return;
            }
            try {
                fs.renameSync(out, inputPath);
                resolve(inputPath);
            } catch {
                resolve(null);
            }
        });
        proc.on('error', () => resolve(null));
    });
}

async function fixDurationOrRemux(inputPath, durationMs) {
    const ext = path.extname(inputPath).toLowerCase();
    const isWebm = ext === '.webm';
    const isMp4 = ext === '.mp4';

    if (hasFfmpeg() && (isWebm || isMp4)) {
        const ok = await remuxWithFfmpegAsync(inputPath, isMp4 ? 'mp4' : 'webm');
        log.debug('ffmpeg detected remuxWithFfmpeg:', ok);
        if (ok) return true;
    }

    if (isWebm && Number.isFinite(durationMs)) {
        const inBuf = await fs.promises.readFile(inputPath);
        const outBuf = fixWebmDurationBuffer(inBuf, Number(durationMs));
        if (outBuf && outBuf.length) {
            await fs.promises.writeFile(inputPath, outBuf);
            log.debug('fixWebmDurationBuffer - true');
            return true;
        }
    }
    log.debug('fixWebmDurationBuffer - false');
    return false;
}

module.exports = { fixDurationOrRemux };
