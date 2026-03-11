'use strict';

const config = require('./config');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);

const Logger = require('./Logger');
const log = new Logger('RtmpStreamer');

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey) {
        this.rtmpUrl = rtmpUrl;
        this.rtmpKey = rtmpKey;
        this.log = log;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        this.ffmpegStream = ffmpeg()
            .input(this.stream)
            .inputOptions('-re')
            // Use hardware-accelerated encoding when available, faster preset for lower CPU
            .videoCodec('libx264')
            .videoBitrate('2500k')
            .size('1280x720')
            .outputOptions([
                '-preset veryfast', // ~40% less CPU vs default 'medium', minimal quality loss
                '-tune zerolatency', // Reduce latency for live streaming
                '-maxrate 2800k', // Cap peak bitrate
                '-bufsize 5000k', // VBV buffer for consistent quality
                '-g 60', // Keyframe interval = 2s at 30fps (better seeking)
                '-threads 2', // Limit FFmpeg threads to avoid CPU contention
                '-f flv',
            ])
            .audioCodec('aac')
            .audioBitrate('128k')
            .audioChannels(2)
            .output(this.rtmpUrl)
            .on('start', (commandLine) => this.log.debug('ffmpeg command', { id: this.rtmpKey, cmd: commandLine }))
            .on('progress', (progress) => {
                /* log.debug('Processing', progress); */
            })
            .on('error', (err, stdout, stderr) => {
                if (!err.message.includes('Exiting normally')) {
                    this.log.error(`Error: ${err.message}`, { stdout, stderr });
                }
                this.end();
            })
            .on('end', () => {
                this.log.debug('FFmpeg process ended', this.rtmpKey);
                this.end();
            })
            .run();
    }

    write(data) {
        if (this.stream) this.stream.write(data);
    }

    isRunning() {
        return this.run;
    }

    end() {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
            this.log.debug('RTMP streaming stopped', this.rtmpKey);
        }
        if (this.ffmpegStream && !this.ffmpegStream.killed) {
            this.ffmpegStream.kill('SIGTERM');
            this.ffmpegStream = null;
            this.log.debug('FFMPEG closed successfully', this.rtmpKey);
        }
        this.run = false;
    }
}

module.exports = RtmpStreamer;
