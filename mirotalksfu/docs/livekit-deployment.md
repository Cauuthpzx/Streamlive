# LiveKit Server Deployment Guide

LiveKit is a Go-based WebRTC SFU that runs alongside MiroTalk SFU (Mediasoup) as a complementary media engine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Streamlive Stack                       │
├─────────────────────┬───────────────────────────────────────┤
│   MiroTalk SFU      │   LiveKit Server (Go)                │
│   (Node.js)         │   ┌─────────────────────────────┐    │
│                     │   │  livekit-server:7880         │    │
│  ┌──────────────┐   │   │  - WebRTC media routing      │    │
│  │ Mediasoup    │   │   │  - Simulcast/SVC/ABR        │    │
│  │ (C++ SFU)    │   │   │  - Built-in TURN            │    │
│  └──────────────┘   │   └─────────────────────────────┘    │
│                     │                                       │
│  ┌──────────────┐   │   ┌─────────────────────────────┐    │
│  │ Socket.io    │   │   │  livekit-egress             │    │
│  │ Signaling    │◄──┼──►│  - Recording (MP4/WebM)     │    │
│  │ + Chat       │   │   │  - RTMP streaming out       │    │
│  └──────────────┘   │   └─────────────────────────────┘    │
│                     │                                       │
│  ┌──────────────┐   │   ┌─────────────────────────────┐    │
│  │ LiveKit SDK  │   │   │  livekit-ingress            │    │
│  │ Client       │◄──┼──►│  - RTMP in (OBS)            │    │
│  │ (Node.js)    │   │   │  - WHIP in                  │    │
│  └──────────────┘   │   └─────────────────────────────┘    │
│                     │                                       │
│  Port: 3010         │   ┌─────────────────────────────┐    │
│                     │   │  Redis (coordination)       │    │
│                     │   └─────────────────────────────┘    │
└─────────────────────┴───────────────────────────────────────┘
```

## Quick Start (Docker)

### 1. LiveKit Server Only

```bash
docker compose -f docker-compose.livekit.yml up livekit-server
```

### 2. Full Stack (Server + Recording + RTMP)

```bash
docker compose -f docker-compose.livekit.yml up
```

### 3. Combined with MiroTalk

```bash
docker compose -f docker-compose.template.yml -f docker-compose.livekit.yml up
```

## Configuration

### Step 1: Generate API Credentials

```bash
# Generate a secure API key and secret
openssl rand -base64 12   # API key
openssl rand -base64 32   # API secret
```

### Step 2: Update livekit.yaml

Edit `livekit.yaml` and set your credentials:

```yaml
keys:
    your_api_key: your_api_secret
```

### Step 3: Update .env

```bash
LIVEKIT_ENABLED=true
LIVEKIT_HOST=ws://localhost:7880          # or wss://your-domain.com for production
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

### Step 4: Production Settings

For production, update `livekit.yaml`:

```yaml
rtc:
    use_external_ip: true
    # OR set your public IP:
    # node_ip: 203.0.113.1

turn:
    enabled: true
    domain: your-domain.com
```

## Port Requirements

| Port | Protocol | Service | Purpose |
|------|----------|---------|---------|
| 3010 | TCP | MiroTalk SFU | HTTP/HTTPS + Socket.io |
| 7880 | TCP | LiveKit Server | HTTP + WebSocket signaling |
| 7881 | TCP | LiveKit Server | RTC over TCP fallback |
| 3478 | UDP | LiveKit TURN | TURN server |
| 5349 | TCP | LiveKit TURN | TURN over TLS |
| 50000-60000 | UDP | LiveKit Server | WebRTC media |
| 40000-40100 | UDP+TCP | Mediasoup | WebRTC media |
| 1935 | TCP | LiveKit Ingress | RTMP input |
| 8080 | TCP | LiveKit Ingress | WHIP input |
| 6379 | TCP | Redis | Internal coordination |

## Services

### LiveKit Server (Required)

The core Go SFU binary. Handles all WebRTC media.

- **Image**: `livekit/livekit-server:latest`
- **Resources**: ~100MB RAM base + ~2MB per participant
- **CPU**: 1 core handles ~50-100 participants

### Redis (Required for Egress/Ingress)

Coordinates between LiveKit server and Egress/Ingress services. Also enables multi-node clustering.

- **Image**: `redis:7-alpine`
- **Resources**: ~50MB RAM

### Egress (Optional - Recording/RTMP out)

Handles recording and RTMP streaming. Uses headless Chrome + GStreamer for Room Composite recordings.

- **Image**: `livekit/egress:latest`
- **Resources**: ~4GB RAM + 4 CPU per concurrent recording
- **Config**: `livekit-egress.yaml`

### Ingress (Optional - RTMP/WHIP in)

Accepts incoming RTMP streams (from OBS, hardware encoders) and publishes them into LiveKit rooms.

- **Image**: `livekit/ingress:latest`
- **Resources**: ~500MB RAM per active stream
- **Config**: `livekit-ingress.yaml`

## API Endpoints

All LiveKit API endpoints are available under `/api/v1/livekit/` when `LIVEKIT_ENABLED=true`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/livekit/token` | Generate access token |
| POST | `/api/v1/livekit/room-token` | Generate room token |
| GET | `/api/v1/livekit/rooms` | List active rooms |
| GET | `/api/v1/livekit/room/:name` | Get room stats |
| POST | `/api/v1/livekit/recording/start` | Start recording |
| POST | `/api/v1/livekit/recording/stop` | Stop recording |
| POST | `/api/v1/livekit/rtmp/start` | Start RTMP stream |
| POST | `/api/v1/livekit/ingress/create` | Create RTMP ingress |
| POST | `/api/v1/livekit/webhook` | Receive webhooks |
| GET | `/api/v1/livekit/health` | Health check |

Full API documentation available at `/api/v1/docs` (Swagger UI).

## Token Generation Example

```bash
curl -X POST http://localhost:3010/api/v1/livekit/token \
  -H "Authorization: your_api_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "identity": "user1",
    "room": "my-room",
    "canPublish": true,
    "canSubscribe": true
  }'
```

Response:
```json
{
    "token": "eyJhbGciOi...",
    "wsUrl": "ws://localhost:7880"
}
```

## Recording Example

```bash
# Start recording
curl -X POST http://localhost:3010/api/v1/livekit/recording/start \
  -H "Authorization: your_api_secret" \
  -H "Content-Type: application/json" \
  -d '{"roomName": "my-room"}'

# Stop recording
curl -X POST http://localhost:3010/api/v1/livekit/recording/stop \
  -H "Authorization: your_api_secret" \
  -H "Content-Type: application/json" \
  -d '{"roomName": "my-room"}'
```

## RTMP Streaming Example

```bash
# Stream to YouTube/Twitch
curl -X POST http://localhost:3010/api/v1/livekit/rtmp/start \
  -H "Authorization: your_api_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "my-room",
    "rtmpUrl": "rtmp://a.rtmp.youtube.com/live2/your-stream-key"
  }'
```

## RTMP Ingress Example (OBS → LiveKit)

```bash
# Create ingress point
curl -X POST http://localhost:3010/api/v1/livekit/ingress/create \
  -H "Authorization: your_api_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "my-room",
    "participantIdentity": "obs-stream",
    "participantName": "OBS Broadcaster"
  }'
```

Then configure OBS with the returned RTMP URL and stream key.

## Multi-Node Clustering

For horizontal scaling, enable Redis in `livekit.yaml`:

```yaml
redis:
    address: redis:6379
    db: 0
```

LiveKit automatically routes rooms to nodes and handles participant migration.

## Troubleshooting

### LiveKit health check fails
```bash
# Check if server is running
curl http://localhost:7880

# Check logs
docker logs livekit-server
```

### WebRTC connections fail
- Ensure UDP ports 50000-60000 are open in firewall
- Check TURN is enabled for NAT traversal
- Set `use_external_ip: true` in production

### Egress recording fails
- Ensure Redis is running: `docker logs livekit-redis`
- Egress needs `CAP_SYS_ADMIN` for Chrome sandbox
- Check egress logs: `docker logs livekit-egress`

### Token generation errors
- Verify API key/secret match between `.env` and `livekit.yaml`
- Check LiveKit is enabled: `LIVEKIT_ENABLED=true`
