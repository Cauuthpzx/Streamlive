/**
 * LiveKitAdapter - Frontend LiveKit integration for Streamlive
 *
 * This adapter bridges LiveKit's client SDK with the existing
 * MiroTalk SFU UI. It manages:
 * - Connection to LiveKit rooms
 * - Publishing local audio/video/screen tracks
 * - Subscribing to remote tracks
 * - Track events and participant state
 *
 * Usage:
 *   const adapter = new LiveKitAdapter({ livekitHost, token });
 *   await adapter.connect(roomName, token);
 *   await adapter.publishCamera();
 *   await adapter.publishMicrophone();
 */

'use strict';

// LiveKit client is loaded via CDN or bundled
// <script src="https://unpkg.com/livekit-client/dist/livekit-client.umd.js"></script>

class LiveKitAdapter {
    constructor(options = {}) {
        this.livekitHost = options.livekitHost || '';
        this.room = null;
        this.localParticipant = null;

        // Track maps for UI integration
        this.localTracks = new Map(); // source -> Track
        this.remoteTracks = new Map(); // participantId -> Map(trackSid -> Track)

        // Callbacks for UI integration
        this.onTrackSubscribed = options.onTrackSubscribed || null;
        this.onTrackUnsubscribed = options.onTrackUnsubscribed || null;
        this.onParticipantConnected = options.onParticipantConnected || null;
        this.onParticipantDisconnected = options.onParticipantDisconnected || null;
        this.onActiveSpeakerChanged = options.onActiveSpeakerChanged || null;
        this.onConnectionStateChanged = options.onConnectionStateChanged || null;
        this.onDataReceived = options.onDataReceived || null;
        this.onRoomDisconnected = options.onRoomDisconnected || null;
        this.onTrackMuted = options.onTrackMuted || null;
        this.onTrackUnmuted = options.onTrackUnmuted || null;

        // State
        this.connected = false;
        this.reconnecting = false;

        // Settings
        this.videoSettings = {
            resolution: { width: 1280, height: 720 },
            fps: 30,
            simulcast: true,
            dynacast: true,
            adaptiveStream: true,
        };

        this.audioSettings = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };
    }

    // ####################################################
    // CONNECTION
    // ####################################################

    /**
     * Connect to a LiveKit room
     * @param {string} roomName - Room name (for logging)
     * @param {string} token - LiveKit access token
     * @returns {Promise<void>}
     */
    async connect(roomName, token) {
        if (typeof LivekitClient === 'undefined') {
            throw new Error('LiveKit client SDK not loaded. Include livekit-client script.');
        }

        this.room = new LivekitClient.Room({
            adaptiveStream: this.videoSettings.adaptiveStream,
            dynacast: this.videoSettings.dynacast,
            videoCaptureDefaults: {
                resolution: LivekitClient.VideoPresets.h720.resolution,
                facingMode: 'user',
            },
            audioCaptureDefaults: {
                echoCancellation: this.audioSettings.echoCancellation,
                noiseSuppression: this.audioSettings.noiseSuppression,
                autoGainControl: this.audioSettings.autoGainControl,
            },
            publishDefaults: {
                simulcast: this.videoSettings.simulcast,
                videoSimulcastLayers: [LivekitClient.VideoPresets.h180, LivekitClient.VideoPresets.h360],
                stopMicTrackOnMute: false,
                videoCodec: 'vp8',
            },
        });

        this._setupRoomListeners();

        try {
            await this.room.connect(this.livekitHost, token);
            this.localParticipant = this.room.localParticipant;
            this.connected = true;

            console.log(`[LiveKit] Connected to room: ${roomName}`);
            console.log(`[LiveKit] Local participant: ${this.localParticipant.identity}`);
        } catch (error) {
            console.error('[LiveKit] Failed to connect:', error);
            throw error;
        }
    }

    /**
     * Disconnect from the room
     */
    async disconnect() {
        if (this.room) {
            await this.room.disconnect();
            this.room = null;
            this.localParticipant = null;
            this.connected = false;
            this.localTracks.clear();
            this.remoteTracks.clear();
            console.log('[LiveKit] Disconnected');
        }
    }

    // ####################################################
    // PUBLISHING TRACKS
    // ####################################################

    /**
     * Publish camera video
     * @param {object} options - Camera options
     * @returns {Promise<object>} Published track
     */
    async publishCamera(options = {}) {
        if (!this.connected) throw new Error('Not connected');

        const { deviceId, resolution, facingMode = 'user' } = options;

        const publishOptions = {
            source: LivekitClient.Track.Source.Camera,
            resolution: resolution || this.videoSettings.resolution,
            facingMode,
        };

        if (deviceId) publishOptions.deviceId = deviceId;

        try {
            await this.localParticipant.setCameraEnabled(true, publishOptions);
            const track = this.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
            if (track) {
                this.localTracks.set('camera', track);
            }
            console.log('[LiveKit] Camera published');
            return track;
        } catch (error) {
            console.error('[LiveKit] Failed to publish camera:', error);
            throw error;
        }
    }

    /**
     * Publish microphone audio
     * @param {object} options - Microphone options
     * @returns {Promise<object>} Published track
     */
    async publishMicrophone(options = {}) {
        if (!this.connected) throw new Error('Not connected');

        const { deviceId } = options;

        const publishOptions = {
            source: LivekitClient.Track.Source.Microphone,
        };

        if (deviceId) publishOptions.deviceId = deviceId;

        try {
            await this.localParticipant.setMicrophoneEnabled(true, publishOptions);
            const track = this.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
            if (track) {
                this.localTracks.set('microphone', track);
            }
            console.log('[LiveKit] Microphone published');
            return track;
        } catch (error) {
            console.error('[LiveKit] Failed to publish microphone:', error);
            throw error;
        }
    }

    /**
     * Publish screen share
     * @param {object} options - Screen share options
     * @returns {Promise<object>} Published track
     */
    async publishScreen(options = {}) {
        if (!this.connected) throw new Error('Not connected');

        const { audio = true, resolution } = options;

        try {
            await this.localParticipant.setScreenShareEnabled(true, {
                audio,
                resolution: resolution || { width: 1920, height: 1080 },
                contentHint: 'detail',
            });
            const track = this.localParticipant.getTrackPublication(LivekitClient.Track.Source.ScreenShare);
            if (track) {
                this.localTracks.set('screen', track);
            }
            console.log('[LiveKit] Screen share published');
            return track;
        } catch (error) {
            console.error('[LiveKit] Failed to publish screen:', error);
            throw error;
        }
    }

    /**
     * Stop publishing a track
     * @param {string} source - 'camera', 'microphone', or 'screen'
     */
    async unpublish(source) {
        if (!this.connected) return;

        try {
            switch (source) {
                case 'camera':
                    await this.localParticipant.setCameraEnabled(false);
                    break;
                case 'microphone':
                    await this.localParticipant.setMicrophoneEnabled(false);
                    break;
                case 'screen':
                    await this.localParticipant.setScreenShareEnabled(false);
                    break;
            }
            this.localTracks.delete(source);
            console.log(`[LiveKit] Unpublished ${source}`);
        } catch (error) {
            console.error(`[LiveKit] Failed to unpublish ${source}:`, error);
        }
    }

    // ####################################################
    // TRACK CONTROL
    // ####################################################

    /**
     * Mute local audio
     */
    async muteAudio() {
        const pub = this.localTracks.get('microphone');
        if (pub && pub.track) {
            await pub.mute();
            console.log('[LiveKit] Audio muted');
        }
    }

    /**
     * Unmute local audio
     */
    async unmuteAudio() {
        const pub = this.localTracks.get('microphone');
        if (pub && pub.track) {
            await pub.unmute();
            console.log('[LiveKit] Audio unmuted');
        }
    }

    /**
     * Mute local video
     */
    async muteVideo() {
        const pub = this.localTracks.get('camera');
        if (pub && pub.track) {
            await pub.mute();
            console.log('[LiveKit] Video muted');
        }
    }

    /**
     * Unmute local video
     */
    async unmuteVideo() {
        const pub = this.localTracks.get('camera');
        if (pub && pub.track) {
            await pub.unmute();
            console.log('[LiveKit] Video unmuted');
        }
    }

    /**
     * Switch camera device
     * @param {string} deviceId
     */
    async switchCamera(deviceId) {
        if (!this.connected) return;
        const pub = this.localTracks.get('camera');
        if (pub && pub.track) {
            await pub.track.setDeviceId(deviceId);
            console.log('[LiveKit] Camera switched', deviceId);
        }
    }

    /**
     * Switch microphone device
     * @param {string} deviceId
     */
    async switchMicrophone(deviceId) {
        if (!this.connected) return;
        const pub = this.localTracks.get('microphone');
        if (pub && pub.track) {
            await pub.track.setDeviceId(deviceId);
            console.log('[LiveKit] Microphone switched', deviceId);
        }
    }

    /**
     * Set video quality for a remote track
     * @param {string} participantId
     * @param {string} quality - 'low', 'medium', 'high'
     */
    setVideoQuality(participantId, quality) {
        const participant = this.room?.remoteParticipants?.get(participantId);
        if (!participant) return;

        const qualityMap = {
            low: LivekitClient.VideoQuality.LOW,
            medium: LivekitClient.VideoQuality.MEDIUM,
            high: LivekitClient.VideoQuality.HIGH,
        };

        const trackPubs = participant.getTrackPublications();
        for (const [, pub] of trackPubs) {
            if (pub.kind === LivekitClient.Track.Kind.Video) {
                pub.setVideoQuality(qualityMap[quality] || LivekitClient.VideoQuality.HIGH);
            }
        }
    }

    // ####################################################
    // DATA CHANNEL
    // ####################################################

    /**
     * Send data message to room
     * @param {object|string} data - Data to send
     * @param {object} options
     */
    async sendData(data, options = {}) {
        if (!this.connected) return;

        const { reliable = true, destinationIdentities, topic = 'chat' } = options;

        const payload = typeof data === 'string' ? new TextEncoder().encode(data) : new TextEncoder().encode(JSON.stringify(data));

        await this.localParticipant.publishData(payload, {
            reliable,
            destinationIdentities,
            topic,
        });
    }

    // ####################################################
    // HELPERS
    // ####################################################

    /**
     * Get available media devices
     * @returns {Promise<object>} { audioInputs, videoInputs, audioOutputs }
     */
    async getDevices() {
        if (typeof LivekitClient === 'undefined') {
            throw new Error('LiveKit client SDK not loaded');
        }

        const devices = await LivekitClient.Room.getLocalDevices();
        return {
            audioInputs: devices.filter((d) => d.kind === 'audioinput'),
            videoInputs: devices.filter((d) => d.kind === 'videoinput'),
            audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
        };
    }

    /**
     * Attach a track to an HTML element
     * @param {object} track - LiveKit Track
     * @param {HTMLElement} element - Target element (video or audio)
     */
    attachTrack(track, element) {
        if (track && element) {
            track.attach(element);
        }
    }

    /**
     * Detach a track from all elements
     * @param {object} track - LiveKit Track
     */
    detachTrack(track) {
        if (track) {
            track.detach();
        }
    }

    /**
     * Get current connection state
     * @returns {object}
     */
    getState() {
        return {
            connected: this.connected,
            reconnecting: this.reconnecting,
            roomName: this.room?.name || null,
            localIdentity: this.localParticipant?.identity || null,
            remoteParticipantCount: this.room?.remoteParticipants?.size || 0,
            localTracks: Array.from(this.localTracks.keys()),
        };
    }

    // ####################################################
    // ROOM EVENT LISTENERS
    // ####################################################

    _setupRoomListeners() {
        const room = this.room;
        const RoomEvent = LivekitClient.RoomEvent;

        // Track subscribed (remote participant publishes)
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log(`[LiveKit] Track subscribed: ${track.kind} from ${participant.identity}`);

            if (!this.remoteTracks.has(participant.identity)) {
                this.remoteTracks.set(participant.identity, new Map());
            }
            this.remoteTracks.get(participant.identity).set(publication.trackSid, track);

            if (this.onTrackSubscribed) {
                this.onTrackSubscribed({
                    track,
                    publication,
                    participant,
                    kind: track.kind,
                    source: publication.source,
                });
            }
        });

        // Track unsubscribed
        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            console.log(`[LiveKit] Track unsubscribed: ${track.kind} from ${participant.identity}`);

            track.detach();

            const participantTracks = this.remoteTracks.get(participant.identity);
            if (participantTracks) {
                participantTracks.delete(publication.trackSid);
                if (participantTracks.size === 0) {
                    this.remoteTracks.delete(participant.identity);
                }
            }

            if (this.onTrackUnsubscribed) {
                this.onTrackUnsubscribed({
                    track,
                    publication,
                    participant,
                    kind: track.kind,
                    source: publication.source,
                });
            }
        });

        // Track muted
        room.on(RoomEvent.TrackMuted, (publication, participant) => {
            console.log(`[LiveKit] Track muted: ${publication.trackSid} by ${participant.identity}`);
            if (this.onTrackMuted) {
                this.onTrackMuted({ publication, participant });
            }
        });

        // Track unmuted
        room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
            console.log(`[LiveKit] Track unmuted: ${publication.trackSid} by ${participant.identity}`);
            if (this.onTrackUnmuted) {
                this.onTrackUnmuted({ publication, participant });
            }
        });

        // Participant connected
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            console.log(`[LiveKit] Participant connected: ${participant.identity}`);
            if (this.onParticipantConnected) {
                this.onParticipantConnected({ participant });
            }
        });

        // Participant disconnected
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            console.log(`[LiveKit] Participant disconnected: ${participant.identity}`);
            this.remoteTracks.delete(participant.identity);
            if (this.onParticipantDisconnected) {
                this.onParticipantDisconnected({ participant });
            }
        });

        // Active speaker changed
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            if (this.onActiveSpeakerChanged) {
                this.onActiveSpeakerChanged({
                    speakers: speakers.map((s) => ({
                        identity: s.identity,
                        name: s.name,
                        audioLevel: s.audioLevel,
                    })),
                });
            }
        });

        // Connection quality changed
        room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
            console.log(`[LiveKit] Connection quality: ${quality} for ${participant.identity}`);
        });

        // Data received
        room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            const data = new TextDecoder().decode(payload);
            if (this.onDataReceived) {
                this.onDataReceived({
                    data,
                    participant,
                    kind,
                    topic,
                });
            }
        });

        // Disconnected
        room.on(RoomEvent.Disconnected, (reason) => {
            console.log('[LiveKit] Disconnected:', reason);
            this.connected = false;
            this.reconnecting = false;
            if (this.onRoomDisconnected) {
                this.onRoomDisconnected({ reason });
            }
        });

        // Reconnecting
        room.on(RoomEvent.Reconnecting, () => {
            console.log('[LiveKit] Reconnecting...');
            this.reconnecting = true;
        });

        // Reconnected
        room.on(RoomEvent.Reconnected, () => {
            console.log('[LiveKit] Reconnected');
            this.reconnecting = false;
        });

        // Connection state changed
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
            console.log('[LiveKit] Connection state:', state);
            if (this.onConnectionStateChanged) {
                this.onConnectionStateChanged({ state });
            }
        });

        // Media device error
        room.on(RoomEvent.MediaDevicesError, (error) => {
            console.error('[LiveKit] Media device error:', error);
        });
    }
}

// Export for both module and browser contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveKitAdapter;
}
