# Frontend Component Architecture Design

**Date**: 2026-03-12
**Scope**: Incremental refactoring of frontend monoliths (RoomClient.js + Room.js) into modular components
**Approach**: Vanilla JS, no framework, backward compatible, no breaking changes

---

## Problem Statement

Two monolithic files dominate the frontend:
- **RoomClient.js** (11,157 lines) — WebRTC core + chat + recording + RTMP + 370+ methods
- **Room.js** (6,767 lines) — UI orchestrator + 266 global functions + 80+ global variables

Communication is via global variables and direct function calls. No event system, no state management, no DOM caching. Adding features requires modifying both files. Testing individual features is impossible.

## Architecture Overview

### New Directory Structure

```
public/js/
  core/
    EventBus.js          — Pub/sub communication
    RoomState.js         — Centralized shared state
    DOMCache.js          — Cached DOM element references
    SocketManager.js     — Socket.io wrapper + event routing
  components/
    WhiteboardManager.js — Whiteboard (30+ wb* functions from Room.js)
    ChatManager.js       — Chat public/private/GPT + file messages
    RecordingManager.js  — Recording logic + state (recordedBlobs)
    RtmpManager.js       — RTMP streaming
    ParticipantsManager.js — Participants list + moderation
    SettingsManager.js   — Settings panel + theme
    ToolbarManager.js    — Toolbar buttons + visibility
    ScreenShareManager.js — Screen sharing constraints + UI
    EditorManager.js     — Code editor (Quill integration)
    PollManager.js       — Polls/voting
    FileShareManager.js  — File sharing logic
  RoomClient.js          — Reduced to WebRTC core only
  Room.js                — Reduced to bootstrap (~200 lines)
  (all other existing files unchanged)
```

### Core Infrastructure

#### EventBus
Central pub/sub for decoupled communication between components.
- Methods: `on(event, cb)`, `off(event, cb)`, `emit(event, data)`, `once(event, cb)`
- Event naming: `domain:action` (e.g., `chat:messageSent`, `peer:joined`, `whiteboard:toggle`)
- Replaces direct function calls between modules

#### RoomState
Single source of truth for shared state, replacing 80+ global variables.
- Properties: roomId, peerId, peerName, isPresenter, isRecording, audio, video, screen, hand, etc.
- Getters/setters emit events on change for reactive updates

#### DOMCache
Cache DOM element references to eliminate repeated `getElementById()` calls.
- Methods: `get(id)`, `query(selector)`, `invalidate(id)`, `preload(ids)`, `clear()`
- Static elements cached permanently; dynamic elements (peer videos) invalidated on join/leave

#### SocketManager
Wrapper around Socket.io that routes events to appropriate managers.
- Methods: `connect(url, opts)`, `on(event, cb)`, `emit(event, data, ack)`, `getSocket()`
- Each manager registers only the socket events it needs
- `getSocket()` provides backward compat for `window.socket`

### Component Pattern

Every component manager follows the same interface:

```javascript
class XxxManager {
    constructor(eventBus, roomState, domCache) { ... }
    init(socketManager, rc) { ... }  // rc for backward compat
    close() { ... }                  // cleanup
}
```

### Extraction Priority (low coupling first)

1. WhiteboardManager — 30+ wb* functions, nearly isolated in Room.js
2. ChatManager — Clear logic boundary, most code after WebRTC
3. RecordingManager — Own state (recordedBlobs), clean extraction
4. PollManager — Small, isolated
5. EditorManager — Small, Quill integration clear
6. ParticipantsManager — Depends on peer events
7. SettingsManager — Depends on many config values
8. ToolbarManager — Depends on all other managers
9. ScreenShareManager — Tight coupling with RoomClient
10. FileShareManager — Tight coupling with socket events
11. RtmpManager — Depends on recording + media

### Bootstrap (Room.js reduced)

Room.js becomes a bootstrap file (~200 lines):
1. Create core infrastructure (EventBus, RoomState, DOMCache, SocketManager)
2. Instantiate all managers
3. Connect socket
4. Create RoomClient (WebRTC core only)
5. Call `manager.init()` for each component
6. Set up keyboard shortcuts and window events
7. Set backward compat globals (`window.rc`, `window.socket`)

### Script Loading Order (Room.html)

1. Core infrastructure (4 files)
2. Existing utilities (unchanged)
3. Component managers (11 files)
4. RoomClient.js (reduced)
5. Room.js (bootstrap)

### Backward Compatibility

During transition:
- `window.rc` and `window.socket` remain available
- Managers receive `rc` reference to call methods not yet extracted
- Gradually reduce `rc` dependency as more methods move to managers
- No changes to backend Socket.io events or API

### Success Criteria

- All existing functionality works identically
- No new bugs introduced (test each extraction)
- Each manager can be understood independently
- Adding new features only requires creating a new manager
- RoomClient.js reduced from 11K to ~4K lines (WebRTC core)
- Room.js reduced from 6.7K to ~200 lines (bootstrap)
