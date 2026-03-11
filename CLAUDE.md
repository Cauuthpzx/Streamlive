# CLAUDE.md — Streamlive (MiroTalk SFU)

## Project Overview

Streamlive is based on **MiroTalk SFU** — an open-source WebRTC video conferencing platform built on **Mediasoup** (Selective Forwarding Unit). It provides real-time browser-based video calls with support for screen sharing, recording, RTMP streaming, chat, AI integrations, and more.

**License**: AGPLv3

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 22+, Express 5, Socket.io, Mediasoup 3.19 |
| Frontend | Vanilla JavaScript, Webpack, Babel |
| Real-time | WebRTC via Mediasoup, Socket.io signaling |
| Media | FFmpeg (recording/RTMP), noise suppression |
| Database | None — stateless in-memory Room/Peer maps |
| Auth | JWT, OIDC (express-openid-connect), local host auth |
| Cloud | AWS S3, Sentry, Ngrok |
| AI/Chat | OpenAI, DeepSeek |
| Integrations | Discord, Slack, Mattermost, Email (nodemailer) |
| Code Quality | Prettier (formatter), Mocha + Sinon (tests) |
| Deployment | Docker (node:22-slim), Docker Compose |

## Directory Structure

```
mirotalksfu/
├── app/
│   ├── src/
│   │   ├── Server.js          # Main entry point (~3600 lines)
│   │   ├── config.template.js # All configuration defaults (78KB)
│   │   ├── Room.js            # Per-room state, peers, RTMP, recording
│   │   ├── Peer.js            # Individual participant state
│   │   ├── ServerApi.js       # REST API handlers
│   │   ├── Logger.js          # Structured logging
│   │   ├── RtmpStreamer.js    # RTMP streaming
│   │   ├── lib/               # nodemailer setup
│   │   ├── middleware/        # IP whitelist middleware
│   │   └── scripts/           # Utility scripts
│   ├── api/                   # REST endpoint definitions + swagger.yaml
│   ├── rec/                   # Recording output directory
│   ├── rtmp/                  # RTMP file streaming
│   └── ssl/                   # SSL certificates
├── public/
│   ├── sfu/                   # Compiled MediasoupClient.js (webpack output)
│   ├── js/                    # Frontend JS (RoomClient.js, Room.js, etc.)
│   ├── views/                 # HTML templates (15 files)
│   ├── css/                   # Stylesheets
│   ├── images/                # Assets, virtual backgrounds
│   ├── sounds/                # Audio assets
│   └── svg/                   # Icons
├── tests/                     # Mocha test files
├── rtmpServers/               # RTMP server configs (nginx-rtmp, node-media-server)
├── webhook/                   # Webhook examples
├── cloud/                     # Deployment scripts
├── docs/                      # Self-hosting, ngrok docs
├── .env.template              # Environment variable template (27KB)
├── .prettierrc.js             # Code formatter config
├── Dockerfile                 # Docker build
├── docker-compose.template.yml
├── webpack.config.js          # Frontend bundling
├── install.sh                 # Deployment script
└── package.json
```

## Common Commands

```bash
# Install dependencies
npm install

# Copy config template (required before first run)
cp app/src/config.template.js app/src/config.js

# Start the server
npm start                  # Production
npm run start-dev          # Development (nodemon auto-reload)
npm run debug              # With mediasoup debug logging

# Run tests
npm test                   # Mocha tests in tests/

# Format code
npm run lint               # Runs: npx prettier --write .

# Build frontend (after modifying MediasoupClientCompile.js)
npm run client-compile     # Webpack → public/sfu/MediasoupClient.js

# Docker
npm run docker-build       # Build image
npm run docker-run         # Run container
npm run docker-run-vm      # Run with volume mounts (live updates)
npm run docker-start       # Start existing container
npm run docker-stop        # Stop container

# RTMP servers
npm run rtmp-start         # Start nginx-rtmp server
npm run nms-start          # Start node-media-server
```

## Architecture

### Server (Backend)

- **Entry point**: `app/src/Server.js` — Express app + Socket.io + Mediasoup workers
- **Room.js**: Manages per-room state, peer lists, broadcasting, recording, RTMP
- **Peer.js**: Individual participant — producers, consumers, transports
- **ServerApi.js**: REST API handlers (stats, meetings, join, token)
- **config.js**: Runtime configuration (copied from `config.template.js`)

### WebRTC Flow

1. Client connects via Socket.io
2. Server creates Mediasoup Router per room
3. Client creates WebRTC transports (send/receive)
4. Producers (audio/video/screen) created on send transport
5. Consumers created on receive transport for each remote producer
6. SFU routes media between participants (no mesh)

### Frontend

- Vanilla JS — no framework (React, Vue, etc.)
- `RoomClient.js` (428KB) — main client-side application logic
- `Room.js` (247KB) — UI and room management
- `MediasoupClient.js` — compiled from `MediasoupClientCompile.js` via Webpack
- HTML templates in `public/views/`

### REST API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/stats` | Server statistics |
| GET | `/api/v1/meetings` | Active meetings list |
| GET | `/api/v1/meeting` | Single meeting info |
| POST | `/api/v1/join` | Create/join a meeting |
| POST | `/api/v1/token` | Generate JWT token |

API docs available at `/api/v1/docs` (Swagger UI).

## Configuration

Two-layer system:
1. **`app/src/config.template.js`** — All defaults with extensive documentation (~1800 lines)
2. **`.env`** — Secrets and environment-specific overrides (see `.env.template`)

### Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SERVER_LISTEN_PORT` | 3010 | HTTP/HTTPS port |
| `SFU_ANNOUNCED_IP` | (auto) | Public IP for WebRTC |
| `SFU_NUM_WORKERS` | CPU cores | Mediasoup worker count |
| `JWT_SECRET` | — | JWT signing secret |
| `API_KEY_SECRET` | `mirotalksfu_default_secret` | REST API key |
| `HOST_PROTECTED` | false | Enable host authentication |
| `RECORDING_ENABLED` | false | Enable server-side recording |
| `RTMP_ENABLED` | false | Enable RTMP streaming |
| `CHATGPT_ENABLED` | false | Enable AI chat |

WebRTC media ports: **40000–40100** (TCP+UDP) — must be open in firewall/Docker.

## Code Style

### Prettier (the only formatter — no ESLint)

- Semicolons: **yes**
- Quotes: **single**
- Trailing commas: **ES5** (objects/arrays only)
- Print width: **120**
- Tab width: **4 spaces**

Run `npm run lint` to format all files.

### Conventions

- No TypeScript — pure JavaScript (ES6+ with Babel for frontend)
- Backend uses CommonJS (`require`/`module.exports`)
- Frontend uses ES modules compiled via Webpack
- Large monolithic files (Server.js ~3600 lines, RoomClient.js ~428KB) — avoid splitting unless necessary
- Logging via custom `Logger.js` with color/JSON support
- No database — all state is in-memory (rooms and peers stored in Maps)

## Testing

```bash
npm test   # Runs: mocha tests/*.js
```

**Test files** (in `tests/`):
- `test-ServerAPI.js` — REST API endpoint tests
- `test-Validator.js` — Input validation tests
- `test-XSS.js` — XSS/security tests
- `test-OpenRedirect.js` — Open redirect vulnerability tests

**Stack**: Mocha + Sinon (mocking) + Should.js (assertions) + Proxyquire (module stubbing)

## Docker

**Base image**: `node:22-slim`

```bash
# Build
docker build -t mirotalksfu .

# Run
docker run -p 3010:3010 -p 40000-40100:40000-40100/tcp -p 40000-40100:40000-40100/udp mirotalksfu
```

Required port mappings:
- `3010/tcp` — HTTP server
- `40000-40100/tcp+udp` — WebRTC media

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
1. Checkout → Setup Node 22.x → `npm install`
2. Copy config template → Run `npm test`
3. Build multi-arch Docker images (amd64, arm64)
4. Push to Docker Hub as `mirotalk/sfu:latest`

## Security Considerations

- XSS input validation on all user inputs
- Rate limiting on `/login` endpoint
- IP whitelist middleware (optional)
- Helmet.js security headers
- OIDC authentication support
- JWT token-based API access
- Host protection with password authentication
- **Never commit**: `.env`, `app/src/config.js`, SSL certs, API keys

## Key Files for Common Tasks

| Task | Files to modify |
|------|----------------|
| Add a new API endpoint | `app/src/ServerApi.js`, `app/api/`, `app/api/swagger.yaml` |
| Modify room behavior | `app/src/Room.js` |
| Change peer handling | `app/src/Peer.js` |
| Update server routes | `app/src/Server.js` |
| Change WebRTC/media config | `app/src/config.template.js` |
| Modify frontend UI | `public/js/Room.js`, `public/views/*.html`, `public/css/` |
| Change client WebRTC logic | `public/js/RoomClient.js` |
| Update Mediasoup client | `public/sfu/MediasoupClientCompile.js` → run `npm run client-compile` |
| Add environment variables | `.env.template`, `app/src/config.template.js` |
| Add/modify tests | `tests/test-*.js` |
