'use strict';

const config = require('./config');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const Logger = require('./Logger');
const log = new Logger('RtmpFile');

class RtmpFile {
    constructor(socket_id = false, room = false) {
        this.socketId = socket_id;
        this.room = room;
        this.rtmpUrl = '';
        this.ffmpegProcess = null;
    }

    async start(inputStream, rtmpUrl) {
        if (this.ffmpegProcess) {
            log.debug('Streaming is already in progress');
            return false;
        }

        this.rtmpUrl = rtmpUrl;

        try {
            this.ffmpegProcess = ffmpeg(inputStream)
                .inputOptions(['-re']) // Read input at native frame rate
                .outputOptions([
                    '-c:v libx264',
                    '-preset veryfast',
                    '-tune zerolatency', // Reduce latency for live streaming
                    '-maxrate 2500k', // Reduced from 3000k - better CPU/bandwidth ratio
                    '-bufsize 5000k',
                    '-g 60', // Keyframe every 2s at 30fps
                    '-threads 2', // Limit CPU contention
                    '-c:a aac',
                    '-b:a 128k',
                    '-f flv',
                ])
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

            log.debug('RtmpFile started', rtmpUrl);
            return true;
        } catch (error) {
            log.error('Error starting RtmpFile', error.message);
            return false;
        }
    }

    async stop() {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            try {
                this.ffmpegProcess.kill('SIGTERM');
                this.ffmpegProcess = null;
                log.debug('RtmpFile stopped');
                return true;
            } catch (error) {
                log.error('Error stopping RtmpFile', error.message);
                return false;
            }
        } else {
            log.debug('No RtmpFile process to stop');
            return true;
        }
    }

    handleEnd() {
        if (!this.room) return;
        this.room.send(this.socketId, 'endRTMP', { rtmpUrl: this.rtmpUrl });
        this.room.rtmpFileStreamer = null;
    }

    handleError(message, stdout, stderr) {
        if (!this.room) return;
        this.room.send(this.socketId, 'errorRTMP', { message });
        this.room.rtmpFileStreamer = null;
        log.error('Error: ' + message, { stdout, stderr });
    }
}

module.exports = RtmpFile;
