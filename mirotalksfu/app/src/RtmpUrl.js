'use strict';

const config = require('./config');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const Logger = require('./Logger');
const log = new Logger('RtmpUrl');

class RtmpUrl {
    constructor(socket_id = false, room = false) {
        this.room = room;
        this.socketId = socket_id;
        this.rtmpUrl = '';
        this.ffmpegProcess = null;
    }

    async start(inputVideoURL, rtmpUrl) {
        if (this.ffmpegProcess) {
            log.debug('Streaming is already in progress');
            return false;
        }

        // Validate input URL - only allow http/https, reject shell metacharacters
        try {
            const parsed = new URL(inputVideoURL);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                log.error('RtmpUrl: Invalid URL protocol', parsed.protocol);
                return false;
            }
        } catch (e) {
            log.error('RtmpUrl: Invalid URL', inputVideoURL);
            return false;
        }

        // Reject shell metacharacters in URLs
        if (/[;`$|&<>]/.test(inputVideoURL)) {
            log.error('RtmpUrl: URL contains invalid characters');
            return false;
        }

        this.rtmpUrl = rtmpUrl;

        try {
            this.ffmpegProcess = ffmpeg(inputVideoURL)
                .inputOptions('-re')
                .audioCodec('aac')
                .audioBitrate('128k')
                .videoCodec('libx264')
                .videoBitrate('2500k') // Reduced: better CPU/bandwidth ratio
                .size('1280x720')
                .outputOptions([
                    '-preset veryfast', // ~40% less CPU vs default
                    '-tune zerolatency', // Lower latency for live streams
                    '-threads 2', // Limit CPU contention with SFU workers
                ])
                .format('flv')
                .output(rtmpUrl)
                .on('start', (commandLine) => log.debug('ffmpeg process starting with command:', commandLine))
                .on('progress', (progress) => {
                    /* log.debug('Processing', progress); */
                })
                .on('error', (err, stdout, stderr) => {
                    this.ffmpegProcess = null;
                    if (!err.message.includes('Exiting normally')) {
                        this.handleError(err.message, stdout, stderr);
                    }
                })
                .on('end', () => {
                    log.debug('FFmpeg processing finished');
                    this.ffmpegProcess = null;
                    this.handleEnd();
                })
                .run();

            log.debug('RtmpUrl started', rtmpUrl);
            return true;
        } catch (error) {
            log.error('Error starting RtmpUrl', error.message);
            return false;
        }
    }

    async stop() {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            try {
                this.ffmpegProcess.kill('SIGTERM');
                this.ffmpegProcess = null;
                log.debug('RtmpUrl stopped');
                return true;
            } catch (error) {
                log.error('Error stopping RtmpUrl', error.message);
                return false;
            }
        } else {
            log.debug('No RtmpUrl process to stop');
            return true;
        }
    }

    handleEnd() {
        if (!this.room) return;
        this.room.send(this.socketId, 'endRTMPfromURL', { rtmpUrl: this.rtmpUrl });
        this.room.rtmpUrlStreamer = null;
    }

    handleError(message, stdout, stderr) {
        if (!this.room) return;
        this.room.send(this.socketId, 'errorRTMPfromURL', { message });
        this.room.rtmpUrlStreamer = null;
        log.error('Error: ' + message, { stdout, stderr });
    }
}

module.exports = RtmpUrl;
