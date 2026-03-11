'use strict';

/**
 * WhiteboardManager
 *
 * Extracted from Room.js — manages all whiteboard (Fabric.js canvas) functionality
 * including drawing modes, object manipulation, grid, drag-and-drop, keyboard
 * shortcuts, vanishing pen, sticky notes, PDF/image import, undo/redo, and
 * lock/unlock synchronization via socket.
 *
 * Usage:
 *   const wbManager = new WhiteboardManager(eventBus, roomState, domCache);
 *   wbManager.init(socketManager, rc);
 */

class WhiteboardManager {
    // ####################################################
    // CONSTRUCTOR
    // ####################################################

    /**
     * @param {EventTarget|EventEmitter} eventBus  - shared event bus
     * @param {Object}  roomState  - shared mutable room state (isPresenter, peer_name, isRulesActive, etc.)
     * @param {Map}     domCache   - Map of element-id -> DOM element
     */
    constructor(eventBus, roomState, domCache) {
        this.eventBus = eventBus;
        this.state = roomState;
        this.dom = domCache;

        // Fabric.js canvas
        this.wbCanvas = null;

        // Whiteboard state
        this.wbIsLock = false;
        this.wbIsDrawing = false;
        this.wbIsOpen = false;
        this.wbIsRedoing = false;
        this.wbIsObject = false;
        this.wbIsEraser = false;
        this.wbIsPencil = false;
        this.wbIsVanishing = false;
        this.wbIsBgTransparent = false;
        this.wbPop = [];
        this.wbVanishingObjects = [];
        this.wbGridLines = [];
        this.wbGridVisible = false;

        // Constants
        this.WB_IMAGE_INPUT = 'image/*';
        this.WB_PDF_INPUT = 'application/pdf';
        this.WB_REFERENCE_WIDTH = 1920;
        this.WB_REFERENCE_HEIGHT = 1080;
        this.WB_GRID_SIZE = 20;
        this.WB_STROKE = '#cccccc63';
        this.BASE64_PREFIX = 'data:application/pdf;base64,';

        // Bound handlers for cleanup
        this._resizeHandler = null;
        this._orientationHandler = null;
        this._keydownHandler = null;

        // References set in init()
        this.rc = null;
        this.socket = null;

        // Socket handler references for cleanup
        this._handleWbCanvasToJson = null;
        this._handleWhiteboardAction = null;
    }

    // ####################################################
    // INIT / CLOSE
    // ####################################################

    /**
     * Initialise the whiteboard manager.
     * @param {Object} socketManager - object with a `socket` property (or the socket itself)
     * @param {Object} rc           - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.rc = rc;
        this.socket = socketManager.socket || socketManager;

        this._setupWhiteboard();
        this._bindButtonHandlers();
        this._bindColorHandlers();
        this._registerSocketEvents();
    }

    /**
     * Tear down listeners, destroy canvas, release references.
     */
    close() {
        // Remove socket listeners
        if (this.socket) {
            if (this._handleWbCanvasToJson) {
                this.socket.off('wbCanvasToJson', this._handleWbCanvasToJson);
            }
            if (this._handleWhiteboardAction) {
                this.socket.off('whiteboardAction', this._handleWhiteboardAction);
            }
        }

        // Remove window listeners
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this._orientationHandler) {
            window.removeEventListener('orientationchange', this._orientationHandler);
        }
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }

        // Dispose canvas
        if (this.wbCanvas) {
            this.wbCanvas.dispose();
            this.wbCanvas = null;
        }

        this.wbPop = [];
        this.wbVanishingObjects = [];
        this.wbGridLines = [];
        this.rc = null;
        this.socket = null;
    }

    // ####################################################
    // SOCKET EVENTS
    // ####################################################

    _registerSocketEvents() {
        this._handleWbCanvasToJson = (data) => {
            console.log('SocketOn Received whiteboard canvas JSON');
            this.jsonToWbCanvas(data);
        };

        this._handleWhiteboardAction = (data) => {
            console.log('Whiteboard action', data);
            this.whiteboardAction(data, false);
        };

        this.socket.on('wbCanvasToJson', this._handleWbCanvasToJson);
        this.socket.on('whiteboardAction', this._handleWhiteboardAction);
    }

    // ####################################################
    // SETUP
    // ####################################################

    _setupWhiteboard() {
        this._setupWhiteboardCanvas();
        this._setupWhiteboardCanvasSize();
        this._setupWhiteboardLocalListeners();
        this._setupWhiteboardShortcuts();
        this._setupWhiteboardDragAndDrop();
        this._setupWhiteboardResizeListener();
    }

    _setupWhiteboardCanvas() {
        this.wbCanvas = new fabric.Canvas('wbCanvas');
        this.wbCanvas.freeDrawingBrush.color = '#FFFFFF';
        this.wbCanvas.freeDrawingBrush.width = 3;
        this.whiteboardIsPencilMode(true);
    }

    _setupWhiteboardCanvasSize() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const isMobile = this.state.isMobileDevice;
        const containerPadding = isMobile ? 10 : 20;
        const headerHeight = isMobile ? 40 : 60;
        const extraMargin = 20;

        const availableWidth = viewportWidth - containerPadding - extraMargin;
        const availableHeight = viewportHeight - containerPadding - headerHeight - extraMargin;

        const scaleX = availableWidth / this.WB_REFERENCE_WIDTH;
        const scaleY = availableHeight / this.WB_REFERENCE_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        const canvasWidth = this.WB_REFERENCE_WIDTH * scale;
        const canvasHeight = this.WB_REFERENCE_HEIGHT * scale;

        this.wbCanvas.setWidth(canvasWidth);
        this.wbCanvas.setHeight(canvasHeight);
        this.wbCanvas.setZoom(scale);

        this._setWhiteboardSize(canvasWidth + containerPadding, canvasHeight + headerHeight + containerPadding);

        this.whiteboardCenter();

        this.wbCanvas.calcOffset();
        this.wbCanvas.renderAll();
    }

    _setWhiteboardSize(w, h) {
        document.documentElement.style.setProperty('--wb-width', w);
        document.documentElement.style.setProperty('--wb-height', h);
    }

    _setupWhiteboardResizeListener() {
        let resizeFrame;
        this._resizeHandler = () => {
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                if (this.wbCanvas && this.wbIsOpen) {
                    this._setupWhiteboardCanvasSize();
                }
            });
        };
        window.addEventListener('resize', this._resizeHandler);

        this._orientationHandler = () => {
            setTimeout(() => {
                if (this.wbCanvas && this.wbIsOpen) {
                    this._setupWhiteboardCanvasSize();
                }
            }, 300);
        };
        window.addEventListener('orientationchange', this._orientationHandler);
    }

    // ####################################################
    // BUTTON HANDLERS
    // ####################################################

    _bindButtonHandlers() {
        const get = (id) => this.dom.get(id);

        const whiteboardButton = get('whiteboardButton');
        if (whiteboardButton) {
            whiteboardButton.onclick = () => {
                this.toggleWhiteboard();
            };
        }

        const whiteboardPencilBtn = get('whiteboardPencilBtn');
        if (whiteboardPencilBtn) {
            whiteboardPencilBtn.onclick = () => {
                this.whiteboardResetAllMode();
                this.whiteboardIsPencilMode(true);
            };
        }

        const whiteboardVanishingBtn = get('whiteboardVanishingBtn');
        if (whiteboardVanishingBtn) {
            whiteboardVanishingBtn.onclick = () => {
                this.whiteboardResetAllMode();
                this.whiteboardIsVanishingMode(true);
            };
        }

        const whiteboardObjectBtn = get('whiteboardObjectBtn');
        if (whiteboardObjectBtn) {
            whiteboardObjectBtn.onclick = () => {
                this.whiteboardResetAllMode();
                this.whiteboardIsObjectMode(true);
            };
        }

        const whiteboardUndoBtn = get('whiteboardUndoBtn');
        if (whiteboardUndoBtn) {
            whiteboardUndoBtn.onclick = () => {
                this.whiteboardAction(this._getWhiteboardAction('undo'));
            };
        }

        const whiteboardRedoBtn = get('whiteboardRedoBtn');
        if (whiteboardRedoBtn) {
            whiteboardRedoBtn.onclick = () => {
                this.whiteboardAction(this._getWhiteboardAction('redo'));
            };
        }

        const whiteboardSaveBtn = get('whiteboardSaveBtn');
        if (whiteboardSaveBtn) {
            whiteboardSaveBtn.onclick = () => {
                this.wbCanvasSaveImg();
            };
        }

        const whiteboardImgFileBtn = get('whiteboardImgFileBtn');
        if (whiteboardImgFileBtn) {
            whiteboardImgFileBtn.onclick = () => {
                this.whiteboardAddObj('imgFile');
            };
        }

        const whiteboardPdfFileBtn = get('whiteboardPdfFileBtn');
        if (whiteboardPdfFileBtn) {
            whiteboardPdfFileBtn.onclick = () => {
                this.whiteboardAddObj('pdfFile');
            };
        }

        const whiteboardImgUrlBtn = get('whiteboardImgUrlBtn');
        if (whiteboardImgUrlBtn) {
            whiteboardImgUrlBtn.onclick = () => {
                this.whiteboardAddObj('imgUrl');
            };
        }

        const whiteboardTextBtn = get('whiteboardTextBtn');
        if (whiteboardTextBtn) {
            whiteboardTextBtn.onclick = () => {
                this.whiteboardAddObj('text');
            };
        }

        const whiteboardStickyNoteBtn = get('whiteboardStickyNoteBtn');
        if (whiteboardStickyNoteBtn) {
            whiteboardStickyNoteBtn.onclick = () => {
                this.whiteboardAddObj('stickyNote');
            };
        }

        const whiteboardLineBtn = get('whiteboardLineBtn');
        if (whiteboardLineBtn) {
            whiteboardLineBtn.onclick = () => {
                this.whiteboardAddObj('line');
            };
        }

        const whiteboardRectBtn = get('whiteboardRectBtn');
        if (whiteboardRectBtn) {
            whiteboardRectBtn.onclick = () => {
                this.whiteboardAddObj('rect');
            };
        }

        const whiteboardTriangleBtn = get('whiteboardTriangleBtn');
        if (whiteboardTriangleBtn) {
            whiteboardTriangleBtn.onclick = () => {
                this.whiteboardAddObj('triangle');
            };
        }

        const whiteboardCircleBtn = get('whiteboardCircleBtn');
        if (whiteboardCircleBtn) {
            whiteboardCircleBtn.onclick = () => {
                this.whiteboardAddObj('circle');
            };
        }

        const whiteboardEraserBtn = get('whiteboardEraserBtn');
        if (whiteboardEraserBtn) {
            whiteboardEraserBtn.onclick = () => {
                this.whiteboardResetAllMode();
                this.whiteboardIsEraserMode(true);
            };
        }

        const whiteboardCleanBtn = get('whiteboardCleanBtn');
        if (whiteboardCleanBtn) {
            whiteboardCleanBtn.onclick = () => {
                this.confirmClearBoard();
            };
        }

        const whiteboardShortcutsBtn = get('whiteboardShortcutsBtn');
        if (whiteboardShortcutsBtn) {
            whiteboardShortcutsBtn.onclick = () => {
                this.showWhiteboardShortcuts();
            };
        }

        const whiteboardCloseBtn = get('whiteboardCloseBtn');
        if (whiteboardCloseBtn) {
            whiteboardCloseBtn.onclick = () => {
                this.whiteboardAction(this._getWhiteboardAction('close'));
            };
        }

        const whiteboardLockBtn = get('whiteboardLockBtn');
        if (whiteboardLockBtn) {
            whiteboardLockBtn.onclick = () => {
                this.toggleLockUnlockWhiteboard();
            };
        }

        const whiteboardUnlockBtn = get('whiteboardUnlockBtn');
        if (whiteboardUnlockBtn) {
            whiteboardUnlockBtn.onclick = () => {
                this.toggleLockUnlockWhiteboard();
            };
        }

        const whiteboardGhostButton = get('whiteboardGhostButton');
        if (whiteboardGhostButton) {
            whiteboardGhostButton.onclick = () => {
                this.wbIsBgTransparent = !this.wbIsBgTransparent;
                if (this.wbIsBgTransparent) {
                    this.wbCanvasBackgroundColor('rgba(0, 0, 0, 0.100)');
                } else {
                    this._callGlobal('setTheme');
                }
            };
        }

        const whiteboardGridBtn = get('whiteboardGridBtn');
        if (whiteboardGridBtn) {
            whiteboardGridBtn.onclick = () => {
                this.toggleCanvasGrid();
            };
        }
    }

    _bindColorHandlers() {
        const wbDrawingColorEl = this.dom.get('wbDrawingColorEl');
        if (wbDrawingColorEl) {
            wbDrawingColorEl.onchange = () => {
                this.wbCanvas.freeDrawingBrush.color = wbDrawingColorEl.value;
                this.whiteboardResetAllMode();
                this.whiteboardIsPencilMode(true);
            };
        }

        const wbBackgroundColorEl = this.dom.get('wbBackgroundColorEl');
        if (wbBackgroundColorEl) {
            wbBackgroundColorEl.onchange = () => {
                this.setWhiteboardBgColor(wbBackgroundColorEl.value);
            };
        }
    }

    // ####################################################
    // TOGGLE / CENTER
    // ####################################################

    toggleWhiteboard() {
        if (!this.wbIsOpen && this.rc) {
            this.rc.sound('open');
        }
        this.whiteboardCenter();
        const whiteboard = this.dom.get('whiteboard');
        if (whiteboard) {
            whiteboard.classList.toggle('show');
        }
        this.wbIsOpen = !this.wbIsOpen;
    }

    whiteboardCenter() {
        const whiteboard = this.dom.get('whiteboard');
        if (whiteboard) {
            whiteboard.style.top = '50%';
            whiteboard.style.left = '50%';
            whiteboard.style.transform = 'translate(-50%, -50%)';
        }
    }

    // ####################################################
    // GRID
    // ####################################################

    drawCanvasGrid() {
        const width = this.WB_REFERENCE_WIDTH;
        const height = this.WB_REFERENCE_HEIGHT;

        this.removeCanvasGrid();

        // Vertical lines
        for (let i = 0; i <= width; i += this.WB_GRID_SIZE) {
            this.wbGridLines.push(this._createGridLine(i, 0, i, height));
        }
        // Horizontal lines
        for (let i = 0; i <= height; i += this.WB_GRID_SIZE) {
            this.wbGridLines.push(this._createGridLine(0, i, width, i));
        }

        const gridGroup = new fabric.Group(this.wbGridLines, { selectable: false, evented: false });
        this.wbCanvas.add(gridGroup);
        gridGroup.sendToBack();
        this.wbCanvas.renderAll();
        this._setColor('whiteboardGridBtn', 'green');
    }

    _createGridLine(x1, y1, x2, y2) {
        return new fabric.Line([x1, y1, x2, y2], {
            stroke: this.WB_STROKE,
            selectable: false,
            evented: false,
        });
    }

    removeCanvasGrid() {
        this.wbGridLines.forEach((line) => {
            line.set({ stroke: this.wbGridVisible ? this.WB_STROKE : 'rgba(255, 255, 255, 0)' });
            this.wbCanvas.remove(line);
        });
        this.wbGridLines = [];
        this.wbCanvas.renderAll();
        this._setColor('whiteboardGridBtn', 'white');
    }

    toggleCanvasGrid() {
        this.wbGridVisible = !this.wbGridVisible;
        this.wbGridVisible ? this.drawCanvasGrid() : this.removeCanvasGrid();
        this.wbCanvasToJson();
    }

    // ####################################################
    // DRAWING MODES
    // ####################################################

    whiteboardResetAllMode() {
        this.whiteboardIsPencilMode(false);
        this.whiteboardIsVanishingMode(false);
        this.whiteboardIsObjectMode(false);
        this.whiteboardIsEraserMode(false);
    }

    whiteboardIsPencilMode(status) {
        this.wbCanvas.isDrawingMode = status;
        this.wbIsPencil = status;
        this._setColor('whiteboardPencilBtn', this.wbIsPencil ? 'green' : 'white');
    }

    whiteboardIsVanishingMode(status) {
        this.wbCanvas.isDrawingMode = status;
        this.wbIsVanishing = status;
        const wbDrawingColorEl = this.dom.get('wbDrawingColorEl');
        this.wbCanvas.freeDrawingBrush.color = this.wbIsVanishing
            ? 'yellow'
            : (wbDrawingColorEl ? wbDrawingColorEl.value : '#FFFFFF');
        this._setColor('whiteboardVanishingBtn', this.wbIsVanishing ? 'green' : 'white');
    }

    whiteboardIsObjectMode(status) {
        this.wbIsObject = status;
        this._setColor('whiteboardObjectBtn', status ? 'green' : 'white');
    }

    whiteboardIsEraserMode(status) {
        this.wbIsEraser = status;
        this._setColor('whiteboardEraserBtn', this.wbIsEraser ? 'green' : 'white');
    }

    // ####################################################
    // BACKGROUND COLOR
    // ####################################################

    setWhiteboardBgColor(color) {
        let data = {
            peer_name: this.state.peer_name,
            action: 'bgcolor',
            color: color,
        };
        this.whiteboardAction(data);
    }

    wbCanvasBackgroundColor(color) {
        document.documentElement.style.setProperty('--wb-bg', color);
        const wbBackgroundColorEl = this.dom.get('wbBackgroundColorEl');
        if (wbBackgroundColorEl) {
            wbBackgroundColorEl.value = color;
        }
        this.wbCanvas.setBackgroundColor(color);
        this.wbCanvas.renderAll();
    }

    // ####################################################
    // ADD OBJECTS
    // ####################################################

    whiteboardAddObj(type) {
        const wbDrawingColorEl = this.dom.get('wbDrawingColorEl');
        if (wbDrawingColorEl) {
            this.wbCanvas.freeDrawingBrush.color = wbDrawingColorEl.value;
        }

        const swalBackground = this.state.swalBackground || 'radial-gradient(#393939, #000000)';

        switch (type) {
            case 'imgUrl':
                Swal.fire({
                    background: swalBackground,
                    title: 'Image URL',
                    input: 'text',
                    showCancelButton: true,
                    confirmButtonText: 'OK',
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                }).then((result) => {
                    if (result.isConfirmed) {
                        let wbCanvasImgURL = result.value;
                        if (this._isImageURL(wbCanvasImgURL)) {
                            fabric.Image.fromURL(wbCanvasImgURL, (myImg) => {
                                this._addWbCanvasObj(myImg);
                            });
                        } else {
                            this._userLog('error', 'The URL is not a valid image', 'top-end');
                        }
                    }
                });
                break;
            case 'imgFile':
                this._setupFileSelection('Select the image', this.WB_IMAGE_INPUT, (file) => this._renderImageToCanvas(file));
                break;
            case 'pdfFile':
                this._setupFileSelection('Select the PDF', this.WB_PDF_INPUT, (file) => this._renderPdfToCanvas(file));
                break;
            case 'text': {
                const text = new fabric.IText('Lorem Ipsum', {
                    top: 0,
                    left: 0,
                    fontFamily: 'Montserrat',
                    fill: this.wbCanvas.freeDrawingBrush.color,
                    strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                    stroke: this.wbCanvas.freeDrawingBrush.color,
                });
                this._addWbCanvasObj(text);
                break;
            }
            case 'stickyNote':
                this._createStickyNote();
                break;
            case 'line': {
                const line = new fabric.Line([50, 100, 200, 200], {
                    top: 0,
                    left: 0,
                    fill: this.wbCanvas.freeDrawingBrush.color,
                    strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                    stroke: this.wbCanvas.freeDrawingBrush.color,
                });
                this._addWbCanvasObj(line);
                break;
            }
            case 'circle': {
                const circle = new fabric.Circle({
                    radius: 50,
                    fill: 'transparent',
                    stroke: this.wbCanvas.freeDrawingBrush.color,
                    strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                });
                this._addWbCanvasObj(circle);
                break;
            }
            case 'rect': {
                const rect = new fabric.Rect({
                    top: 0,
                    left: 0,
                    width: 150,
                    height: 100,
                    fill: 'transparent',
                    stroke: this.wbCanvas.freeDrawingBrush.color,
                    strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                });
                this._addWbCanvasObj(rect);
                break;
            }
            case 'triangle': {
                const triangle = new fabric.Triangle({
                    top: 0,
                    left: 0,
                    width: 150,
                    height: 100,
                    fill: 'transparent',
                    stroke: this.wbCanvas.freeDrawingBrush.color,
                    strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                });
                this._addWbCanvasObj(triangle);
                break;
            }
            default:
                break;
        }
    }

    _addWbCanvasObj(obj) {
        if (obj) {
            this.wbCanvas.add(obj).setActiveObject(obj);
            this.whiteboardResetAllMode();
            this.whiteboardIsObjectMode(true);
            this.wbCanvasToJson();
        } else {
            console.error('Invalid input. Expected an obj of canvas elements');
        }
    }

    // ####################################################
    // OBJECT MANIPULATION
    // ####################################################

    whiteboardDeleteObject() {
        const obj = this.wbCanvas?.getActiveObject?.();
        if (!obj) return;
        const tag = document.activeElement?.tagName;
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && !obj.isEditing) return;
        if (obj.isEditing && obj.exitEditing) obj.exitEditing();
        this.whiteboardEraseObject();
    }

    whiteboardEraseObject() {
        if (this.wbCanvas && typeof this.wbCanvas.getActiveObjects === 'function') {
            const activeObjects = this.wbCanvas.getActiveObjects();
            if (activeObjects && activeObjects.length > 0) {
                activeObjects.forEach((obj) => {
                    this.wbCanvas.remove(obj);
                });
                this.wbCanvas.discardActiveObject();
                this.wbCanvas.requestRenderAll();
                this.wbCanvasToJson();
            }
        }
    }

    whiteboardCloneObject() {
        if (this.wbCanvas && typeof this.wbCanvas.getActiveObjects === 'function') {
            const activeObjects = this.wbCanvas.getActiveObjects();
            if (activeObjects && activeObjects.length > 0) {
                activeObjects.forEach((obj, idx) => {
                    obj.clone((cloned) => {
                        cloned.set({
                            left: obj.left + 30 + idx * 10,
                            top: obj.top + 30 + idx * 10,
                            evented: true,
                        });
                        this.wbCanvas.add(cloned);
                        this.wbCanvas.setActiveObject(cloned);
                        this.wbCanvasToJson();
                    });
                });
                this.wbCanvas.requestRenderAll();
            }
        }
    }

    // ####################################################
    // VANISHING PEN
    // ####################################################

    _wbHandleVanishingObjects() {
        if (this.wbIsVanishing && this.wbCanvas._objects.length > 0) {
            const obj = this.wbCanvas._objects[this.wbCanvas._objects.length - 1];
            if (obj && obj.type === 'path') {
                this.wbVanishingObjects.push(obj);
                const fadeDuration = 1000;
                const vanishTimeout = 5000;
                setTimeout(() => {
                    const start = performance.now();
                    const fade = (ts) => {
                        const p = Math.min((ts - start) / fadeDuration, 1);
                        obj.set('opacity', 1 - p);
                        this.wbCanvas.requestRenderAll();
                        if (p < 1) requestAnimationFrame(fade);
                    };
                    requestAnimationFrame(fade);
                }, vanishTimeout - fadeDuration);
                setTimeout(() => {
                    this.wbCanvas.remove(obj);
                    this.wbCanvas.renderAll();
                    this.wbCanvasToJson();
                    this.wbVanishingObjects.splice(this.wbVanishingObjects.indexOf(obj), 1);
                }, vanishTimeout);
            }
        }
    }

    // ####################################################
    // STICKY NOTE
    // ####################################################

    _createStickyNote() {
        const swalBackground = this.state.swalBackground || 'radial-gradient(#393939, #000000)';

        Swal.fire({
            background: swalBackground,
            title: 'Create Sticky Note',
            html: `
            <div class="sticky-note-form">
                <textarea id="stickyNoteText" class="sticky-note-textarea" rows="4" placeholder="Type your note here...">Note</textarea>
                <div class="sticky-note-colors-row">
                    <div class="sticky-note-color-group">
                        <label for="stickyNoteColor" class="sticky-note-color-label">
                            <i class="fas fa-palette"></i> Background
                        </label>
                        <input id="stickyNoteColor" type="color" value="#FFEB3B" class="sticky-note-color-input">
                    </div>
                    <div class="sticky-note-color-group">
                        <label for="stickyNoteTextColor" class="sticky-note-color-label">
                            <i class="fas fa-font"></i> Text
                        </label>
                        <input id="stickyNoteTextColor" type="color" value="#000000" class="sticky-note-color-input">
                    </div>
                </div>
            </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Create',
            cancelButtonText: 'Cancel',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            preConfirm: () => {
                return {
                    text: document.getElementById('stickyNoteText').value,
                    color: document.getElementById('stickyNoteColor').value,
                    textColor: document.getElementById('stickyNoteTextColor').value,
                };
            },
            didOpen: () => {
                setTimeout(() => {
                    document.getElementById('stickyNoteText').focus();
                }, 100);
            },
        }).then((result) => {
            if (result.isConfirmed) {
                const noteData = result.value;

                const noteRect = new fabric.Rect({
                    left: 100,
                    top: 100,
                    width: 220,
                    height: 160,
                    fill: noteData.color,
                    shadow: 'rgba(0,0,0,0.18) 0px 4px 12px',
                    rx: 14,
                    ry: 14,
                });

                const noteText = new fabric.Textbox(noteData.text, {
                    left: 110,
                    top: 110,
                    width: 200,
                    fontSize: 18,
                    fontFamily: 'Segoe UI, Arial, sans-serif',
                    fill: noteData.textColor,
                    textAlign: 'left',
                    editable: true,
                    fontWeight: 'bold',
                    shadow: new fabric.Shadow({
                        color: 'rgba(255,255,255,0.18)',
                        blur: 2,
                        offsetX: 1,
                        offsetY: 1,
                    }),
                    padding: 8,
                    cornerSize: 8,
                });

                const stickyNoteGroup = new fabric.Group([noteRect, noteText], {
                    left: 100,
                    top: 100,
                    selectable: true,
                    hasControls: true,
                    hoverCursor: 'pointer',
                });

                stickyNoteGroup.on('mousedblclick', function () {
                    noteText.enterEditing();
                    noteText.hiddenTextarea && noteText.hiddenTextarea.focus();
                });

                this.wbCanvas.on('mouse:down', function (e) {
                    if (noteText.isEditing && e.target !== noteText) {
                        noteText.exitEditing();
                    }
                });

                this._addWbCanvasObj(stickyNoteGroup);
            }
        });
    }

    // ####################################################
    // FILE SELECTION / IMAGE / PDF
    // ####################################################

    _setupFileSelection(title, accept, renderToCanvas) {
        const swalBackground = this.state.swalBackground || 'radial-gradient(#393939, #000000)';

        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            position: 'center',
            title: title,
            input: 'file',
            html: `
            <div id="dropArea">
                <p>Drag and drop your file here</p>
            </div>
            `,
            inputAttributes: {
                accept: accept,
                'aria-label': title,
            },
            didOpen: () => {
                const dropArea = document.getElementById('dropArea');
                dropArea.addEventListener('dragenter', handleDragEnter);
                dropArea.addEventListener('dragover', handleDragOver);
                dropArea.addEventListener('dragleave', handleDragLeave);
                dropArea.addEventListener('drop', handleDrop);
            },
            showDenyButton: true,
            confirmButtonText: 'OK',
            denyButtonText: 'Cancel',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                renderToCanvas(result.value);
            }
        });

        function handleDragEnter(e) {
            e.preventDefault();
            e.stopPropagation();
            e.target.style.background = 'var(--body-bg)';
        }

        function handleDragOver(e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        }

        function handleDragLeave(e) {
            e.preventDefault();
            e.stopPropagation();
            e.target.style.background = '';
        }

        function handleDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
            e.target.style.background = '';
        }

        function handleFiles(files) {
            if (files.length > 0) {
                const file = files[0];
                console.log('Selected file:', file);
                Swal.close();
                renderToCanvas(file);
            }
        }
    }

    _renderImageToCanvas(wbCanvasImg) {
        if (wbCanvasImg && wbCanvasImg.size > 0) {
            let reader = new FileReader();
            reader.onload = (event) => {
                let imgObj = new Image();
                imgObj.src = event.target.result;
                imgObj.onload = () => {
                    let image = new fabric.Image(imgObj);
                    image.set({ top: 0, left: 0 }).scale(0.3);
                    this._addWbCanvasObj(image);
                };
            };
            reader.readAsDataURL(wbCanvasImg);
        }
    }

    async _renderPdfToCanvas(wbCanvasPdf) {
        if (wbCanvasPdf && wbCanvasPdf.size > 0) {
            let reader = new FileReader();
            reader.onload = async (event) => {
                this.wbCanvas.requestRenderAll();
                await this._pdfToImage(event.target.result, this.wbCanvas);
                this.whiteboardResetAllMode();
                this.whiteboardIsObjectMode(true);
                this.wbCanvasToJson();
            };
            reader.readAsDataURL(wbCanvasPdf);
        }
    }

    _readBlob(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result));
            reader.addEventListener('error', reject);
            reader.readAsDataURL(blob);
        });
    }

    async _loadPDF(pdfData, pages) {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfData = pdfData instanceof Blob ? await this._readBlob(pdfData) : pdfData;
        const data = atob(
            pdfData.startsWith(this.BASE64_PREFIX) ? pdfData.substring(this.BASE64_PREFIX.length) : pdfData
        );
        try {
            const pdf = await pdfjsLib.getDocument({ data }).promise;
            const numPages = pdf.numPages;
            const canvases = await Promise.all(
                Array.from({ length: numPages }, (_, i) => {
                    const pageNumber = i + 1;
                    if (pages && pages.indexOf(pageNumber) === -1) return null;
                    return pdf.getPage(pageNumber).then(async (page) => {
                        const viewport = page.getViewport({ scale: window.devicePixelRatio });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport,
                        };
                        await page.render(renderContext).promise;
                        return canvas;
                    });
                })
            );
            return canvases.filter((canvas) => canvas !== null);
        } catch (error) {
            console.error('Error loading PDF', error.message);
            throw error.message;
        }
    }

    async _pdfToImage(pdfData, canvas) {
        const scale = 1 / window.devicePixelRatio;
        try {
            const canvases = await this._loadPDF(pdfData);
            canvases.forEach(async (c) => {
                canvas.add(
                    new fabric.Image(await c, {
                        scaleX: scale,
                        scaleY: scale,
                    })
                );
            });
        } catch (error) {
            console.error('Error converting PDF to images', error.message);
            throw error.message;
        }
    }

    // ####################################################
    // CANVAS MOUSE LISTENERS
    // ####################################################

    _setupWhiteboardLocalListeners() {
        this.wbCanvas.on('mouse:down', (e) => {
            this._mouseDown(e);
        });
        this.wbCanvas.on('mouse:up', () => {
            this._mouseUp();
        });
        this.wbCanvas.on('mouse:move', () => {
            this._mouseMove();
        });
        this.wbCanvas.on('object:added', () => {
            this._objectAdded();
        });
    }

    _mouseDown(e) {
        this.wbIsDrawing = true;
        if (this.wbIsEraser && e.target) {
            if (!this.wbVanishingObjects.includes(e.target)) {
                this.wbPop.push(e.target);
            }
            this.wbCanvas.remove(e.target);
            return;
        }
    }

    _mouseUp() {
        this.wbIsDrawing = false;
        this.wbCanvasToJson();
    }

    _mouseMove() {
        if (this.wbIsEraser) {
            this.wbCanvas.hoverCursor = 'not-allowed';
            return;
        } else {
            this.wbCanvas.hoverCursor = 'move';
        }
        if (!this.wbIsDrawing) return;
    }

    _objectAdded() {
        if (!this.wbIsRedoing) this.wbPop = [];
        this.wbIsRedoing = false;
        this._wbHandleVanishingObjects();
    }

    // ####################################################
    // UNDO / REDO / CLEAR / SAVE
    // ####################################################

    wbCanvasUndo() {
        if (this.wbCanvas._objects.length > 0) {
            const obj = this.wbCanvas._objects.pop();
            if (!this.wbVanishingObjects.includes(obj)) {
                this.wbPop.push(obj);
            }
            this.wbCanvas.renderAll();
        }
    }

    wbCanvasRedo() {
        if (this.wbPop.length > 0) {
            this.wbIsRedoing = true;
            this.wbCanvas.add(this.wbPop.pop());
        }
    }

    wbCanvasClear() {
        this.wbCanvas.clear();
        this.wbCanvas.renderAll();
    }

    wbCanvasSaveImg() {
        const dataURL = this.wbCanvas.toDataURL({
            width: this.wbCanvas.getWidth(),
            height: this.wbCanvas.getHeight(),
            left: 0,
            top: 0,
            format: 'png',
        });
        const dataNow = this._getDataTimeString();
        const fileName = `whiteboard-${dataNow}.png`;
        this._saveDataToFile(dataURL, fileName);
    }

    // ####################################################
    // SYNC (JSON / UPDATE)
    // ####################################################

    wbUpdate() {
        if (this.wbIsOpen && (!this.state.isRulesActive || this.state.isPresenter)) {
            console.log('IsPresenter: update whiteboard canvas to the participants in the room');
            this.wbCanvasToJson();
            this.whiteboardAction(this._getWhiteboardAction(this.wbIsLock ? 'lock' : 'unlock'));
        }
    }

    wbCanvasToJson() {
        console.log('wbCanvasToJson called');
        if (!this.state.isPresenter && this.wbIsLock) {
            console.log('Not presenter and whiteboard is locked. Exiting');
            return;
        }
        if (!this.rc.thereAreParticipants()) {
            console.log('No participants. Exiting');
            return;
        }
        let wbCanvasJson = JSON.stringify(this.wbCanvas.toJSON());
        console.log('Emitting wbCanvasToJson');
        this.rc.socket.emit('wbCanvasToJson', wbCanvasJson);
    }

    jsonToWbCanvas(json) {
        if (!this.wbIsOpen) this.toggleWhiteboard();
        this.wbIsRedoing = true;
        this.wbCanvas.loadFromJSON(json, () => {
            this._setupWhiteboardCanvasSize();
            this.wbIsRedoing = false;
        });
        if (!this.state.isPresenter && !this.wbCanvas.isDrawingMode && this.wbIsLock) {
            this.wbDrawing(false);
        }
    }

    // ####################################################
    // WHITEBOARD ACTION DISPATCH
    // ####################################################

    _getWhiteboardAction(action) {
        return {
            peer_name: this.state.peer_name,
            action: action,
        };
    }

    whiteboardAction(data, emit = true) {
        if (emit) {
            if (this.rc.thereAreParticipants()) {
                this.rc.socket.emit('whiteboardAction', data);
            }
        } else {
            this._userLog(
                'info',
                `${data.peer_name} <i class="fas fa-chalkboard-teacher"></i> whiteboard action: ${data.action}`,
                'top-end'
            );
        }

        switch (data.action) {
            case 'bgcolor':
                this.wbCanvasBackgroundColor(data.color);
                break;
            case 'undo':
                this.wbCanvasUndo();
                break;
            case 'redo':
                this.wbCanvasRedo();
                break;
            case 'clear':
                this.wbCanvasClear();
                this.removeCanvasGrid();
                break;
            case 'lock':
                if (!this.state.isPresenter) {
                    this._elemDisplay('whiteboardTitle', false);
                    this._elemDisplay('whiteboardOptions', false);
                    this._elemDisplay('whiteboardButton', false);
                    this.wbDrawing(false);
                    this.wbIsLock = true;
                }
                break;
            case 'unlock':
                if (!this.state.isPresenter) {
                    this._elemDisplay('whiteboardTitle', true, 'flex');
                    this._elemDisplay('whiteboardOptions', true, 'flex');
                    this._elemDisplay('whiteboardButton', true);
                    this.wbDrawing(true);
                    this.wbIsLock = false;
                }
                break;
            case 'close':
                if (this.wbIsOpen) this.toggleWhiteboard();
                if (this.wbIsBgTransparent) this._callGlobal('setTheme');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // LOCK / UNLOCK
    // ####################################################

    toggleLockUnlockWhiteboard() {
        this.wbIsLock = !this.wbIsLock;

        const whiteboardLockBtn = this.dom.get('whiteboardLockBtn');
        const whiteboardUnlockBtn = this.dom.get('whiteboardUnlockBtn');

        const btnToShow = this.wbIsLock ? whiteboardLockBtn : whiteboardUnlockBtn;
        const btnToHide = this.wbIsLock ? whiteboardUnlockBtn : whiteboardLockBtn;
        const btnColor = this.wbIsLock ? 'red' : 'white';
        const action = this.wbIsLock ? 'lock' : 'unlock';

        this._show(btnToShow);
        this._hide(btnToHide);
        this._setColor('whiteboardLockBtn', btnColor);

        this.whiteboardAction(this._getWhiteboardAction(action));

        if (this.wbIsLock) {
            this._userLog('info', 'The whiteboard is locked. \n The participants cannot interact with it.', 'top-right');
            this._sound('locked');
        }
    }

    // ####################################################
    // CONFIRM CLEAR
    // ####################################################

    confirmClearBoard() {
        const swalBackground = this.state.swalBackground || 'radial-gradient(#393939, #000000)';
        const deleteImage = this.state.image?.delete || '';

        Swal.fire({
            background: swalBackground,
            imageUrl: deleteImage,
            position: 'top',
            title: 'Clean the board',
            text: 'Are you sure you want to clean the board?',
            showDenyButton: true,
            confirmButtonText: 'Yes',
            denyButtonText: 'No',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.whiteboardAction(this._getWhiteboardAction('clear'));
                this._sound('delete');
            }
        });
    }

    // ####################################################
    // SHORTCUTS DIALOG
    // ####################################################

    showWhiteboardShortcuts() {
        const whiteboardShortcutsContent = document.getElementById('whiteboardShortcutsContent');
        if (!whiteboardShortcutsContent) {
            console.error('Whiteboard shortcuts content not found');
            return;
        }
        const swalBackground = this.state.swalBackground || 'radial-gradient(#393939, #000000)';

        Swal.fire({
            background: swalBackground,
            position: 'center',
            title: 'Whiteboard Shortcuts',
            html: whiteboardShortcutsContent.innerHTML,
            confirmButtonText: 'Got it!',
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        });
    }

    // ####################################################
    // DRAWING CONTROL
    // ####################################################

    wbDrawing(status) {
        this.wbCanvas.isDrawingMode = status;
        this.wbCanvas.selection = status;
        this.wbCanvas.forEachObject(function (obj) {
            obj.selectable = status;
        });
    }

    // ####################################################
    // DRAG AND DROP
    // ####################################################

    _setupWhiteboardDragAndDrop() {
        if (!this.wbCanvas) return;

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
            this.wbCanvas.upperCanvasEl.addEventListener(eventName, preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach((eventName) => {
            this.wbCanvas.upperCanvasEl.addEventListener(
                eventName,
                () => {
                    this.wbCanvas.upperCanvasEl.style.border = '1px dashed #fff';
                },
                false
            );
        });

        ['dragleave', 'drop'].forEach((eventName) => {
            this.wbCanvas.upperCanvasEl.addEventListener(
                eventName,
                () => {
                    this.wbCanvas.upperCanvasEl.style.border = '';
                },
                false
            );
        });

        this.wbCanvas.upperCanvasEl.addEventListener('drop', (e) => this._handleWhiteboardDrop(e), false);
    }

    _handleWhiteboardDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length === 0) return;

        const file = files[0];
        const fileType = file.type;

        switch (true) {
            case fileType.startsWith('image/'):
                this._renderImageToCanvas(file);
                break;
            case fileType === 'application/pdf':
                this._renderPdfToCanvas(file);
                break;
            default:
                this._userLog('warning', `Unsupported file type: ${fileType}. Please drop an image or PDF file.`, 'top-end');
                break;
        }
    }

    // ####################################################
    // KEYBOARD SHORTCUTS
    // ####################################################

    _setupWhiteboardShortcuts() {
        this._keydownHandler = (event) => {
            if (!this.wbIsOpen) return;

            // Clone: Cmd+C / Ctrl+C
            if ((event.key === 'c' || event.key === 'C') && (event.ctrlKey || event.metaKey)) {
                this.whiteboardCloneObject();
                event.preventDefault();
                return;
            }
            // Cut/erase: Cmd+X / Ctrl+X
            if ((event.key === 'x' || event.key === 'X') && (event.ctrlKey || event.metaKey)) {
                this.whiteboardEraseObject();
                event.preventDefault();
                return;
            }
            // Undo: Cmd+Z / Ctrl+Z
            if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
                this.whiteboardAction(this._getWhiteboardAction('undo'));
                event.preventDefault();
                return;
            }
            // Redo: Cmd+Shift+Z / Ctrl+Shift+Z or Cmd+Y / Ctrl+Y
            if (
                ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && event.shiftKey) ||
                ((event.key === 'y' || event.key === 'Y') && (event.ctrlKey || event.metaKey))
            ) {
                this.whiteboardAction(this._getWhiteboardAction('redo'));
                event.preventDefault();
                return;
            }
            // Delete: Delete / Backspace
            if (event.key === 'Delete' || event.key === 'Backspace') {
                this.whiteboardDeleteObject();
                event.preventDefault();
                return;
            }

            // Alt + Ctrl/Meta shortcuts for object creation
            if (event.code && event.altKey && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
                switch (event.code) {
                    case 'KeyT':
                        this.whiteboardAddObj('text');
                        event.preventDefault();
                        break;
                    case 'KeyL':
                        this.whiteboardAddObj('line');
                        event.preventDefault();
                        break;
                    case 'KeyC':
                        this.whiteboardAddObj('circle');
                        event.preventDefault();
                        break;
                    case 'KeyR':
                        this.whiteboardAddObj('rect');
                        event.preventDefault();
                        break;
                    case 'KeyG':
                        this.whiteboardAddObj('triangle');
                        event.preventDefault();
                        break;
                    case 'KeyN':
                        this.whiteboardAddObj('stickyNote');
                        event.preventDefault();
                        break;
                    case 'KeyU':
                        this.whiteboardAddObj('imgUrl');
                        event.preventDefault();
                        break;
                    case 'KeyV':
                        this.whiteboardResetAllMode();
                        this.whiteboardIsVanishingMode(!this.wbIsVanishing);
                        event.preventDefault();
                        break;
                    case 'KeyI':
                        this.whiteboardAddObj('imgFile');
                        event.preventDefault();
                        break;
                    case 'KeyP':
                        this.whiteboardAddObj('pdfFile');
                        event.preventDefault();
                        break;
                    case 'KeyQ':
                        this.confirmClearBoard();
                        event.preventDefault();
                        break;
                    default:
                        break;
                }
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    // ####################################################
    // UTILITY HELPERS (delegate to globals / Room.js helpers)
    // ####################################################

    /**
     * Show/hide an element by id via the global elemDisplay helper.
     */
    _elemDisplay(elemId, display, mode = 'block') {
        if (typeof elemDisplay === 'function') {
            elemDisplay(elemId, display, mode);
        } else {
            const el = this.dom.get(elemId) || document.getElementById(elemId);
            if (el) {
                el.style.display = display ? mode : 'none';
            }
        }
    }

    _show(elem) {
        if (typeof show === 'function') {
            show(elem);
        } else if (elem) {
            elem.style.display = '';
            elem.classList.remove('hidden');
        }
    }

    _hide(elem) {
        if (typeof hide === 'function') {
            hide(elem);
        } else if (elem) {
            elem.style.display = 'none';
        }
    }

    _setColor(elemId, color) {
        if (typeof setColor === 'function') {
            const el = this.dom.get(elemId) || document.getElementById(elemId);
            if (el) setColor(el, color);
        } else {
            const el = this.dom.get(elemId) || document.getElementById(elemId);
            if (el) el.style.color = color;
        }
    }

    _userLog(icon, message, position, timer) {
        if (typeof userLog === 'function') {
            userLog(icon, message, position, timer);
        } else {
            console.log(`[${icon}] ${message}`);
        }
    }

    _sound(name) {
        if (typeof sound === 'function') {
            sound(name);
        } else if (this.rc && typeof this.rc.sound === 'function') {
            this.rc.sound(name);
        }
    }

    _isImageURL(url) {
        if (typeof isImageURL === 'function') {
            return isImageURL(url);
        }
        return /\.(jpeg|jpg|gif|png|webp|bmp|svg)(\?.*)?$/i.test(url);
    }

    _saveDataToFile(dataURL, fileName) {
        if (typeof saveDataToFile === 'function') {
            saveDataToFile(dataURL, fileName);
        } else {
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    _getDataTimeString() {
        if (typeof getDataTimeString === 'function') {
            return getDataTimeString();
        }
        const d = new Date();
        return d.toISOString().replace(/[:.]/g, '-');
    }

    _callGlobal(fnName, ...args) {
        if (typeof window[fnName] === 'function') {
            window[fnName](...args);
        }
    }
}
