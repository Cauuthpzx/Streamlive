'use strict';

/**
 * LiveKitClient - Server-side LiveKit integration adapter
 *
 * Provides a bridge between the existing MiroTalk SFU signaling
 * and LiveKit's server SDK. This allows rooms to use LiveKit
 * as the media engine while keeping the existing Socket.io
 * signaling layer for chat, commands, and room management.
 *
 * Architecture:
 * - LiveKit handles all WebRTC media (audio/video/screen)
 * - Socket.io still handles signaling for non-media events
 * - Tokens are generated server-side for LiveKit auth
 * - Egress API provides recording and RTMP streaming
 */

const { AccessToken, RoomServiceClient, EgressClient, IngressClient, WebhookReceiver } = require('livekit-server-sdk');

const Logger = require('./Logger');
const log = new Logger('LiveKit');

class LiveKitClient {
    constructor(config) {
        this.enabled = config?.enabled || false;
        this.host = config?.host || 'ws://localhost:7880';
        this.apiKey = config?.apiKey || '';
        this.apiSecret = config?.apiSecret || '';
        this.httpHost = config?.httpHost || this.host.replace('ws://', 'http://').replace('wss://', 'https://');

        // SDK clients
        this.roomService = null;
        this.egressClient = null;
        this.ingressClient = null;
        this.webhookReceiver = null;

        // Track active rooms and their egress
        this.activeEgress = new Map(); // roomName -> egressId
        this.activeIngress = new Map(); // roomName -> ingressId

        if (this.enabled) {
            this._init();
        }
    }

    _init() {
        try {
            this.roomService = new RoomServiceClient(this.httpHost, this.apiKey, this.apiSecret);
            this.egressClient = new EgressClient(this.httpHost, this.apiKey, this.apiSecret);
            this.ingressClient = new IngressClient(this.httpHost, this.apiKey, this.apiSecret);
            this.webhookReceiver = new WebhookReceiver(this.apiKey, this.apiSecret);
            log.info('LiveKit client initialized', { host: this.host });
        } catch (error) {
            log.error('Failed to initialize LiveKit client', error.message);
            this.enabled = false;
        }
    }

    isEnabled() {
        return this.enabled;
    }

    // ####################################################
    // TOKEN GENERATION
    // ####################################################

    /**
     * Generate a LiveKit access token for a participant
     * @param {string} roomName - Room name
     * @param {string} participantIdentity - Unique participant ID
     * @param {object} options - Token options
     * @returns {string} JWT token
     */
    generateToken(roomName, participantIdentity, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        const {
            name = participantIdentity,
            canPublish = true,
            canSubscribe = true,
            canPublishData = true,
            canUpdateOwnMetadata = true,
            ttl = '24h',
            metadata = '{}',
        } = options;

        const at = new AccessToken(this.apiKey, this.apiSecret, {
            identity: participantIdentity,
            name: name,
            ttl: ttl,
            metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
        });

        at.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish,
            canSubscribe,
            canPublishData,
            canUpdateOwnMetadata,
        });

        return at.toJwt();
    }

    /**
     * Generate a token for recording/egress service
     * @param {string} roomName
     * @returns {string} JWT token
     */
    generateRecorderToken(roomName) {
        const at = new AccessToken(this.apiKey, this.apiSecret, {
            identity: 'recorder',
            name: 'Recorder Bot',
        });

        at.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: false,
            canSubscribe: true,
            canPublishData: false,
            hidden: true,
        });

        return at.toJwt();
    }

    // ####################################################
    // ROOM MANAGEMENT
    // ####################################################

    /**
     * List all active LiveKit rooms
     * @returns {Promise<Array>} List of rooms
     */
    async listRooms() {
        if (!this.enabled) return [];
        try {
            const rooms = await this.roomService.listRooms();
            return rooms;
        } catch (error) {
            log.error('Failed to list rooms', error.message);
            return [];
        }
    }

    /**
     * Create a LiveKit room
     * @param {string} roomName
     * @param {object} options
     * @returns {Promise<object>} Room info
     */
    async createRoom(roomName, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        const {
            emptyTimeout = 300, // 5 minutes
            maxParticipants = 100,
            metadata = '{}',
        } = options;

        try {
            const room = await this.roomService.createRoom({
                name: roomName,
                emptyTimeout,
                maxParticipants,
                metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
            });
            log.info('Room created', { roomName, maxParticipants });
            return room;
        } catch (error) {
            log.error('Failed to create room', { roomName, error: error.message });
            throw error;
        }
    }

    /**
     * Delete a LiveKit room (disconnects all participants)
     * @param {string} roomName
     */
    async deleteRoom(roomName) {
        if (!this.enabled) return;
        try {
            await this.roomService.deleteRoom(roomName);
            log.info('Room deleted', { roomName });
        } catch (error) {
            log.error('Failed to delete room', { roomName, error: error.message });
        }
    }

    /**
     * List participants in a room
     * @param {string} roomName
     * @returns {Promise<Array>}
     */
    async listParticipants(roomName) {
        if (!this.enabled) return [];
        try {
            return await this.roomService.listParticipants(roomName);
        } catch (error) {
            log.error('Failed to list participants', { roomName, error: error.message });
            return [];
        }
    }

    /**
     * Get a specific participant
     * @param {string} roomName
     * @param {string} identity
     * @returns {Promise<object|null>}
     */
    async getParticipant(roomName, identity) {
        if (!this.enabled) return null;
        try {
            return await this.roomService.getParticipant(roomName, identity);
        } catch (error) {
            log.error('Failed to get participant', { roomName, identity, error: error.message });
            return null;
        }
    }

    /**
     * Remove a participant from a room
     * @param {string} roomName
     * @param {string} identity
     */
    async removeParticipant(roomName, identity) {
        if (!this.enabled) return;
        try {
            await this.roomService.removeParticipant(roomName, identity);
            log.info('Participant removed', { roomName, identity });
        } catch (error) {
            log.error('Failed to remove participant', { roomName, identity, error: error.message });
        }
    }

    /**
     * Mute/unmute a participant's track
     * @param {string} roomName
     * @param {string} identity
     * @param {string} trackSid
     * @param {boolean} muted
     */
    async muteParticipantTrack(roomName, identity, trackSid, muted) {
        if (!this.enabled) return;
        try {
            await this.roomService.mutePublishedTrack(roomName, identity, trackSid, muted);
            log.debug('Track muted/unmuted', { roomName, identity, trackSid, muted });
        } catch (error) {
            log.error('Failed to mute track', error.message);
        }
    }

    /**
     * Update participant metadata
     * @param {string} roomName
     * @param {string} identity
     * @param {string} metadata
     */
    async updateParticipantMetadata(roomName, identity, metadata) {
        if (!this.enabled) return;
        try {
            const metadataStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
            await this.roomService.updateParticipant(roomName, identity, metadataStr);
        } catch (error) {
            log.error('Failed to update participant metadata', error.message);
        }
    }

    /**
     * Send data to participants in a room
     * @param {string} roomName
     * @param {Buffer|string} data
     * @param {object} options
     */
    async sendData(roomName, data, options = {}) {
        if (!this.enabled) return;
        const { destinationIdentities, topic = 'chat' } = options;
        try {
            const payload = typeof data === 'string' ? Buffer.from(data) : data;
            await this.roomService.sendData(roomName, payload, {
                destinationIdentities,
                topic,
            });
        } catch (error) {
            log.error('Failed to send data', error.message);
        }
    }

    // ####################################################
    // EGRESS - RECORDING & RTMP STREAMING
    // ####################################################

    /**
     * Start room composite recording (records the entire room as one video)
     * @param {string} roomName
     * @param {object} options
     * @returns {Promise<object>} Egress info
     */
    async startRoomCompositeRecording(roomName, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        const {
            layout = 'grid',
            filepath = '',
            fileType = 'mp4',
            audioOnly = false,
            videoOnly = false,
            width = 1920,
            height = 1080,
            fps = 30,
        } = options;

        try {
            const output = {
                file: {
                    filepath: filepath || `recordings/${roomName}_${Date.now()}.${fileType}`,
                    fileType: fileType === 'mp4' ? 'MP4' : 'OGG',
                },
            };

            const egress = await this.egressClient.startRoomCompositeEgress(roomName, {
                layout,
                file: output.file,
                audioOnly,
                videoOnly,
                videoWidth: width,
                videoHeight: height,
                fps,
            });

            this.activeEgress.set(roomName, egress.egressId);
            log.info('Room composite recording started', { roomName, egressId: egress.egressId });
            return egress;
        } catch (error) {
            log.error('Failed to start room composite recording', { roomName, error: error.message });
            throw error;
        }
    }

    /**
     * Start RTMP streaming from a room
     * @param {string} roomName
     * @param {string} rtmpUrl - RTMP destination URL
     * @param {object} options
     * @returns {Promise<object>} Egress info
     */
    async startRtmpStream(roomName, rtmpUrl, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        const { layout = 'grid', width = 1920, height = 1080, fps = 30 } = options;

        try {
            const egress = await this.egressClient.startRoomCompositeEgress(roomName, {
                layout,
                stream: {
                    urls: [rtmpUrl],
                    protocol: 'RTMP',
                },
                videoWidth: width,
                videoHeight: height,
                fps,
            });

            this.activeEgress.set(`${roomName}_rtmp`, egress.egressId);
            log.info('RTMP stream started', { roomName, egressId: egress.egressId });
            return egress;
        } catch (error) {
            log.error('Failed to start RTMP stream', { roomName, error: error.message });
            throw error;
        }
    }

    /**
     * Start individual track recording
     * @param {string} roomName
     * @param {string} trackSid - Track SID to record
     * @param {object} options
     * @returns {Promise<object>} Egress info
     */
    async startTrackRecording(roomName, trackSid, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        const { filepath = '' } = options;

        try {
            const egress = await this.egressClient.startTrackEgress(roomName, {
                file: {
                    filepath: filepath || `recordings/${roomName}_track_${Date.now()}.webm`,
                },
            }, trackSid);

            log.info('Track recording started', { roomName, trackSid, egressId: egress.egressId });
            return egress;
        } catch (error) {
            log.error('Failed to start track recording', { roomName, error: error.message });
            throw error;
        }
    }

    /**
     * Stop an egress (recording or RTMP stream)
     * @param {string} egressId
     */
    async stopEgress(egressId) {
        if (!this.enabled) return;
        try {
            await this.egressClient.stopEgress(egressId);
            log.info('Egress stopped', { egressId });

            // Clean up from active maps
            for (const [key, id] of this.activeEgress) {
                if (id === egressId) {
                    this.activeEgress.delete(key);
                    break;
                }
            }
        } catch (error) {
            log.error('Failed to stop egress', { egressId, error: error.message });
        }
    }

    /**
     * Stop all recording/streaming for a room
     * @param {string} roomName
     */
    async stopAllEgress(roomName) {
        if (!this.enabled) return;
        try {
            const egresses = await this.egressClient.listEgress({ roomName });
            for (const egress of egresses) {
                if (egress.status === 'EGRESS_ACTIVE' || egress.status === 'EGRESS_STARTING') {
                    await this.stopEgress(egress.egressId);
                }
            }
        } catch (error) {
            log.error('Failed to stop all egress', { roomName, error: error.message });
        }
    }

    // ####################################################
    // INGRESS - EXTERNAL STREAMS INTO LIVEKIT
    // ####################################################

    /**
     * Create an RTMP ingress (external RTMP stream into LiveKit room)
     * @param {string} roomName
     * @param {string} participantName
     * @param {object} options
     * @returns {Promise<object>} Ingress info with RTMP URL
     */
    async createRtmpIngress(roomName, participantName, options = {}) {
        if (!this.enabled) throw new Error('LiveKit is not enabled');

        try {
            const ingress = await this.ingressClient.createIngress(0, {
                // 0 = RTMP
                name: `${roomName}_rtmp_in`,
                roomName,
                participantIdentity: `rtmp_${participantName}`,
                participantName,
            });

            this.activeIngress.set(roomName, ingress.ingressId);
            log.info('RTMP ingress created', {
                roomName,
                ingressId: ingress.ingressId,
                url: ingress.url,
                streamKey: ingress.streamKey,
            });
            return ingress;
        } catch (error) {
            log.error('Failed to create RTMP ingress', { roomName, error: error.message });
            throw error;
        }
    }

    /**
     * Delete an ingress
     * @param {string} ingressId
     */
    async deleteIngress(ingressId) {
        if (!this.enabled) return;
        try {
            await this.ingressClient.deleteIngress(ingressId);
            log.info('Ingress deleted', { ingressId });

            for (const [key, id] of this.activeIngress) {
                if (id === ingressId) {
                    this.activeIngress.delete(key);
                    break;
                }
            }
        } catch (error) {
            log.error('Failed to delete ingress', { ingressId, error: error.message });
        }
    }

    // ####################################################
    // WEBHOOKS
    // ####################################################

    /**
     * Validate and parse a LiveKit webhook
     * @param {string} body - Raw webhook body
     * @param {string} authHeader - Authorization header value
     * @returns {object|null} Parsed webhook event
     */
    validateWebhook(body, authHeader) {
        if (!this.webhookReceiver) return null;
        try {
            return this.webhookReceiver.receive(body, authHeader);
        } catch (error) {
            log.error('Invalid webhook', error.message);
            return null;
        }
    }

    // ####################################################
    // UTILITY
    // ####################################################

    /**
     * Get room stats
     * @param {string} roomName
     * @returns {Promise<object>}
     */
    async getRoomStats(roomName) {
        if (!this.enabled) return null;
        try {
            const participants = await this.listParticipants(roomName);
            return {
                roomName,
                participantCount: participants.length,
                participants: participants.map((p) => ({
                    identity: p.identity,
                    name: p.name,
                    state: p.state,
                    joinedAt: p.joinedAt,
                    tracks: p.tracks
                        ? p.tracks.map((t) => ({
                              sid: t.sid,
                              type: t.type,
                              source: t.source,
                              muted: t.muted,
                              width: t.width,
                              height: t.height,
                          }))
                        : [],
                })),
            };
        } catch (error) {
            log.error('Failed to get room stats', error.message);
            return null;
        }
    }

    /**
     * Get LiveKit server health status
     * @returns {Promise<object>}
     */
    async getHealthStatus() {
        if (!this.enabled) return { enabled: false };
        try {
            const rooms = await this.listRooms();
            return {
                enabled: true,
                host: this.host,
                totalRooms: rooms.length,
                totalParticipants: rooms.reduce((sum, r) => sum + (r.numParticipants || 0), 0),
            };
        } catch (error) {
            return {
                enabled: true,
                host: this.host,
                error: error.message,
            };
        }
    }
}

module.exports = LiveKitClient;
