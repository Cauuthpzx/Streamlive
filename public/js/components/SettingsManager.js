'use strict';

/**
 * SettingsManager
 *
 * Manages all settings-related functionality: settings panel toggling, tab switching,
 * theme/color customization (including Pickr color picker), device selection (audio/video
 * input/output), room action controls (lock/unlock, lobby, broadcasting), moderator settings,
 * button bar positioning, video object fit/controls, and local storage persistence.
 * Extracted from RoomClient.js and Room.js settings-related methods.
 */
class SettingsManager {
    /**
     * @param {Object} eventBus - Application event bus for cross-component communication
     * @param {Object} roomState - Shared room state object
     * @param {Object} domCache - DOM element cache with get(id) method
     */
    constructor(eventBus, roomState, domCache) {
        this.eventBus = eventBus;
        this.roomState = roomState;
        this.dom = domCache;

        this.socketManager = null;
        this.rc = null;
        this.socket = null;

        // Settings panel state
        this.isMySettingsOpen = false;

        // Theme state
        this.themeCustom = {
            keep: false,
            color: '#000000',
            input: null,
        };
        this.pickrInstance = null;

        // Bound socket handlers
        this._handleRoomAction = null;

        // Device change observer
        this._deviceChangeObserver = null;
        this._deviceChangeFrame = null;
        this._lastDeviceChangeTime = 0;

        // Quick device switch dropdown state
        this._videoMenuBuilder = null;
        this._audioMenuBuilder = null;
        this._visibilityObserver = null;

        // Settings extra dropdown state
        this._settingsExtraCleanup = null;
    }

    /**
     * Initialize the manager with socket and RoomClient references.
     * @param {Object} socketManager - Socket manager or raw socket
     * @param {Object} rc - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.socketManager = socketManager;
        this.rc = rc;
        this.socket = socketManager.socket || socketManager;

        this._bindSocketEvents();
    }

    // ####################################################
    // SOCKET EVENT BINDINGS
    // ####################################################

    _bindSocketEvents() {
        this._handleRoomAction = (data) => {
            console.log('SettingsManager: SocketOn Room action:', data);
            this.roomAction(data, false);
        };

        this.socket.on('roomAction', this._handleRoomAction);
    }

    // ####################################################
    // SETTINGS PANEL TOGGLE
    // ####################################################

    toggleMySettings() {
        const mySettings = this.dom.get('mySettings');
        if (!mySettings) return;

        mySettings.style.top = '50%';
        mySettings.style.left = '50%';
        if (this.rc && this.rc.isMobileDevice) {
            mySettings.style.width = '100%';
            mySettings.style.height = '100%';
        }
        mySettings.classList.toggle('show');
        this.isMySettingsOpen = !this.isMySettingsOpen;

        if (this.rc && this.rc.videoMediaContainer) {
            this.rc.videoMediaContainer.style.opacity = this.isMySettingsOpen ? 0.3 : 1;
        }
    }

    // ####################################################
    // TAB SWITCHING
    // ####################################################

    openTab(evt, tabName) {
        const rc = this.rc;
        let i, tabcontent, tablinks;
        tabcontent = rc.getEcN('tabcontent');
        for (i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = 'none';
        }
        tablinks = rc.getEcN('tablinks');
        for (i = 0; i < tablinks.length; i++) {
            tablinks[i].className = tablinks[i].className.replace(' active', '');
        }
        const tabEl = this.dom.get(tabName);
        if (tabEl) tabEl.style.display = 'block';
        if (evt && evt.currentTarget) evt.currentTarget.className += ' active';
    }

    // ####################################################
    // BUTTON BAR POSITION
    // ####################################################

    changeBtnsBarPosition(position) {
        switch (position) {
            case 'vertical':
                // bottomButtons horizontally
                document.documentElement.style.setProperty('--bottom-btns-top', 'auto');
                document.documentElement.style.setProperty('--bottom-btns-left', '50%');
                document.documentElement.style.setProperty('--bottom-btns-bottom', '0');
                document.documentElement.style.setProperty('--bottom-btns-translate-X', '-50%');
                document.documentElement.style.setProperty('--bottom-btns-translate-Y', '0%');
                document.documentElement.style.setProperty('--bottom-btns-margin-bottom', '16px');
                document.documentElement.style.setProperty('--bottom-btns-flex-direction', 'row');
                break;
            case 'horizontal':
                // bottomButtons vertically
                document.documentElement.style.setProperty('--bottom-btns-top', '50%');
                document.documentElement.style.setProperty('--bottom-btns-left', '15px');
                document.documentElement.style.setProperty('--bottom-btns-bottom', 'auto');
                document.documentElement.style.setProperty('--bottom-btns-translate-X', '0%');
                document.documentElement.style.setProperty('--bottom-btns-translate-Y', '-50%');
                document.documentElement.style.setProperty('--bottom-btns-margin-bottom', '0');
                document.documentElement.style.setProperty('--bottom-btns-flex-direction', 'column');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // VIDEO OBJECT FIT / CONTROLS / PIN
    // ####################################################

    handleVideoObjectFit(value) {
        document.documentElement.style.setProperty('--videoObjFit', value);
    }

    handleVideoControls(value) {
        const isVideoControlsOn = value == 'on';
        if (typeof window !== 'undefined') window.isVideoControlsOn = isVideoControlsOn;

        const rc = this.rc;
        let cameras = rc.getEcN('Camera');
        for (let i = 0; i < cameras.length; i++) {
            let cameraId = cameras[i].id.replace('__video', '');
            let videoPlayer = rc.getId(cameraId);
            if (videoPlayer) {
                videoPlayer.hasAttribute('controls')
                    ? videoPlayer.removeAttribute('controls')
                    : videoPlayer.setAttribute('controls', isVideoControlsOn);
            }
        }
    }

    toggleVideoPin(position) {
        const rc = this.rc;
        if (!rc.isVideoPinned) return;
        switch (position) {
            case 'top':
                rc.videoPinMediaContainer.style.top = '25%';
                rc.videoPinMediaContainer.style.width = '100%';
                rc.videoPinMediaContainer.style.height = '75%';
                rc.videoMediaContainer.style.top = '0%';
                rc.videoMediaContainer.style.right = null;
                rc.videoMediaContainer.style.width = null;
                rc.videoMediaContainer.style.width = '100% !important';
                rc.videoMediaContainer.style.height = '25%';
                break;
            case 'vertical':
                rc.videoPinMediaContainer.style.top = 0;
                rc.videoPinMediaContainer.style.width = '75%';
                rc.videoPinMediaContainer.style.height = '100%';
                rc.videoMediaContainer.style.top = 0;
                rc.videoMediaContainer.style.width = '25%';
                rc.videoMediaContainer.style.height = '100%';
                rc.videoMediaContainer.style.right = 0;
                break;
            case 'horizontal':
                rc.videoPinMediaContainer.style.top = 0;
                rc.videoPinMediaContainer.style.width = '100%';
                rc.videoPinMediaContainer.style.height = '75%';
                rc.videoMediaContainer.style.top = '75%';
                rc.videoMediaContainer.style.right = null;
                rc.videoMediaContainer.style.width = null;
                rc.videoMediaContainer.style.width = '100% !important';
                rc.videoMediaContainer.style.height = '25%';
                break;
            default:
                break;
        }
        if (typeof resizeVideoMedia === 'function') resizeVideoMedia();
    }

    // ####################################################
    // THEME (from Room.js)
    // ####################################################

    setCustomTheme(color) {
        const c = color || this.themeCustom.color;
        const swalBg = `radial-gradient(${c}, ${c})`;
        if (typeof window !== 'undefined') window.swalBackground = swalBg;

        document.documentElement.style.setProperty('--body-bg', `radial-gradient(${c}, ${c})`);
        document.documentElement.style.setProperty('--trx-bg', `radial-gradient(${c}, ${c})`);
        document.documentElement.style.setProperty('--msger-bg', `radial-gradient(${c}, ${c})`);
        document.documentElement.style.setProperty('--left-msg-bg', `${c}`);
        document.documentElement.style.setProperty('--right-msg-bg', `${c}`);
        document.documentElement.style.setProperty('--select-bg', `${c}`);
        document.documentElement.style.setProperty('--tab-btn-active', `${c}`);
        document.documentElement.style.setProperty('--settings-bg', `radial-gradient(${c}, ${c})`);
        document.documentElement.style.setProperty('--wb-bg', `radial-gradient(${c}, ${c})`);
        document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
        document.documentElement.style.setProperty('--dd-color', '#FFFFFF');
        document.body.style.background = `radial-gradient(${c}, ${c})`;
    }

    setTheme(localStorageSettings) {
        const selectTheme = this.dom.get('selectTheme');
        if (!selectTheme) return;

        if (this.themeCustom.keep) return this.setCustomTheme();

        if (localStorageSettings) selectTheme.selectedIndex = localStorageSettings.theme;

        const theme = selectTheme.value;
        const themes = this._getThemeDefinitions();
        const themeDef = themes[theme];

        if (themeDef) {
            if (typeof window !== 'undefined') window.swalBackground = themeDef.swalBackground;
            document.documentElement.style.setProperty('--body-bg', themeDef.bodyBg);
            document.documentElement.style.setProperty('--trx-bg', themeDef.trxBg);
            document.documentElement.style.setProperty('--msger-bg', themeDef.msgerBg);
            document.documentElement.style.setProperty('--left-msg-bg', themeDef.leftMsgBg);
            document.documentElement.style.setProperty('--right-msg-bg', themeDef.rightMsgBg);
            document.documentElement.style.setProperty('--select-bg', themeDef.selectBg);
            document.documentElement.style.setProperty('--tab-btn-active', themeDef.tabBtnActive);
            document.documentElement.style.setProperty('--settings-bg', themeDef.settingsBg);
            document.documentElement.style.setProperty('--wb-bg', themeDef.wbBg);
            document.documentElement.style.setProperty('--btns-bg-color', themeDef.btnsBgColor);
            document.documentElement.style.setProperty('--dd-color', themeDef.ddColor);
            document.body.style.background = themeDef.bodyBgRaw;
            selectTheme.selectedIndex = themeDef.index;
        }

        if (typeof window !== 'undefined') {
            window.wbIsBgTransparent = false;
            if (this.rc) this.rc.isChatBgTransparent = false;
        }
    }

    _getThemeDefinitions() {
        return {
            default: {
                swalBackground: 'linear-gradient(135deg, #000000, #434343)',
                bodyBg: 'linear-gradient(135deg, #000000, #434343)',
                trxBg: 'linear-gradient(135deg, #000000, #434343)',
                msgerBg: 'linear-gradient(135deg, #000000, #434343)',
                leftMsgBg: '#1a1a1a',
                rightMsgBg: '#2e2e2e',
                selectBg: '#333333',
                tabBtnActive: '#434343',
                settingsBg: 'linear-gradient(135deg, #000000, #434343)',
                wbBg: 'linear-gradient(135deg, #000000, #434343)',
                btnsBgColor: 'rgba(0, 0, 0, 0.7)',
                ddColor: '#FFFFFF',
                bodyBgRaw: 'linear-gradient(135deg, #000000, #434343)',
                index: 0,
            },
            dark: {
                swalBackground: 'linear-gradient(135deg, #000000, #1a1a1a)',
                bodyBg: 'linear-gradient(135deg, #000000, #1a1a1a)',
                trxBg: 'linear-gradient(135deg, #000000, #1a1a1a)',
                msgerBg: 'linear-gradient(135deg, #000000, #1a1a1a)',
                leftMsgBg: '#0d0d0d',
                rightMsgBg: '#1a1a1a',
                selectBg: '#1a1a1a',
                tabBtnActive: '#1a1a1a',
                settingsBg: 'linear-gradient(135deg, #000000, #1a1a1a)',
                wbBg: 'linear-gradient(135deg, #000000, #1a1a1a)',
                btnsBgColor: 'rgba(0, 0, 0, 0.85)',
                ddColor: '#FFFFFF',
                bodyBgRaw: 'linear-gradient(135deg, #000000, #1a1a1a)',
                index: 1,
            },
            grey: {
                swalBackground: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                bodyBg: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                trxBg: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                msgerBg: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                leftMsgBg: '#2c2c2c',
                rightMsgBg: '#3f3f3f',
                selectBg: '#2a2a2a',
                tabBtnActive: '#4f4f4f',
                settingsBg: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                wbBg: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                btnsBgColor: 'rgba(0, 0, 0, 0.7)',
                ddColor: '#FFFFFF',
                bodyBgRaw: 'linear-gradient(135deg, #1a1a1a, #4f4f4f)',
                index: 2,
            },
            green: {
                swalBackground: 'linear-gradient(135deg, #002a22, #004d40)',
                bodyBg: 'linear-gradient(135deg, #002a22, #004d40)',
                trxBg: 'linear-gradient(135deg, #002a22, #004d40)',
                msgerBg: 'linear-gradient(135deg, #002a22, #004d40)',
                leftMsgBg: '#001d1a',
                rightMsgBg: '#003d2e',
                selectBg: '#002a22',
                tabBtnActive: '#004d40',
                settingsBg: 'linear-gradient(135deg, #002a22, #004d40)',
                wbBg: 'linear-gradient(135deg, #002a22, #004d40)',
                btnsBgColor: 'rgba(0, 42, 34, 0.7)',
                ddColor: '#00FF00',
                bodyBgRaw: 'linear-gradient(135deg, #002a22, #004d40)',
                index: 3,
            },
            blue: {
                swalBackground: 'linear-gradient(135deg, #00274d, #004d80)',
                bodyBg: 'linear-gradient(135deg, #00274d, #004d80)',
                trxBg: 'linear-gradient(135deg, #00274d, #004d80)',
                msgerBg: 'linear-gradient(135deg, #00274d, #004d80)',
                leftMsgBg: '#001f3f',
                rightMsgBg: '#003366',
                selectBg: '#00274d',
                tabBtnActive: '#004d80',
                settingsBg: 'linear-gradient(135deg, #00274d, #004d80)',
                wbBg: 'linear-gradient(135deg, #00274d, #004d80)',
                btnsBgColor: 'rgba(0, 39, 77, 0.7)',
                ddColor: '#1E90FF',
                bodyBgRaw: 'linear-gradient(135deg, #00274d, #004d80)',
                index: 4,
            },
            red: {
                swalBackground: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                bodyBg: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                trxBg: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                msgerBg: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                leftMsgBg: '#2b0f0f',
                rightMsgBg: '#4d1a1a',
                selectBg: '#2a0d0d',
                tabBtnActive: '#4d1a1a',
                settingsBg: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                wbBg: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                btnsBgColor: 'rgba(42, 13, 13, 0.7)',
                ddColor: '#FF4500',
                bodyBgRaw: 'linear-gradient(135deg, #2a0d0d, #4d1a1a)',
                index: 5,
            },
            purple: {
                swalBackground: 'linear-gradient(135deg, #2a001d, #4d004a)',
                bodyBg: 'linear-gradient(135deg, #2a001d, #4d004a)',
                trxBg: 'linear-gradient(135deg, #2a001d, #4d004a)',
                msgerBg: 'linear-gradient(135deg, #2a001d, #4d004a)',
                leftMsgBg: '#1b0014',
                rightMsgBg: '#3e002a',
                selectBg: '#2a001d',
                tabBtnActive: '#4d004a',
                settingsBg: 'linear-gradient(135deg, #2a001d, #4d004a)',
                wbBg: 'linear-gradient(135deg, #2a001d, #4d004a)',
                btnsBgColor: 'rgba(42, 0, 29, 0.7)',
                ddColor: '#BF00FF',
                bodyBgRaw: 'linear-gradient(135deg, #2a001d, #4d004a)',
                index: 6,
            },
            orange: {
                swalBackground: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                bodyBg: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                trxBg: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                msgerBg: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                leftMsgBg: '#2c0f00',
                rightMsgBg: '#ff8c00',
                selectBg: '#3d1a00',
                tabBtnActive: '#ff8c00',
                settingsBg: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                wbBg: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                btnsBgColor: 'rgba(61, 26, 0, 0.7)',
                ddColor: '#FFA500',
                bodyBgRaw: 'linear-gradient(135deg, #3d1a00, #ff8c00)',
                index: 7,
            },
            pink: {
                swalBackground: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                bodyBg: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                trxBg: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                msgerBg: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                leftMsgBg: '#3e0016',
                rightMsgBg: '#ff66b2',
                selectBg: '#4d001d',
                tabBtnActive: '#ff66b2',
                settingsBg: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                wbBg: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                btnsBgColor: 'rgba(77, 0, 29, 0.7)',
                ddColor: '#FF1493',
                bodyBgRaw: 'linear-gradient(135deg, #4d001d, #ff66b2)',
                index: 8,
            },
            yellow: {
                swalBackground: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                bodyBg: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                trxBg: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                msgerBg: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                leftMsgBg: '#3b2d00',
                rightMsgBg: '#ffc107',
                selectBg: '#4d3b00',
                tabBtnActive: '#ffc107',
                settingsBg: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                wbBg: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                btnsBgColor: 'rgba(77, 59, 0, 0.7)',
                ddColor: '#FFD700',
                bodyBgRaw: 'linear-gradient(135deg, #4d3b00, #ffc107)',
                index: 9,
            },
        };
    }

    // ####################################################
    // PICKR COLOR PICKER SETUP
    // ####################################################

    setupPickr(inputElement, defaultColor) {
        if (!inputElement || typeof Pickr === 'undefined') return null;

        this.themeCustom.input = inputElement;
        this.themeCustom.color = defaultColor || this.themeCustom.color;

        this.pickrInstance = Pickr.create({
            el: inputElement,
            theme: 'classic',
            default: this.themeCustom.color,
            useAsButton: true,
            swatches: [
                'rgba(244, 67, 54, 1)',
                'rgba(233, 30, 99, 0.95)',
                'rgba(156, 39, 176, 0.9)',
                'rgba(103, 58, 183, 0.85)',
                'rgba(63, 81, 181, 0.8)',
                'rgba(33, 150, 243, 0.75)',
                'rgba(3, 169, 244, 0.7)',
                'rgba(0, 188, 212, 0.7)',
                'rgba(0, 150, 136, 0.75)',
                'rgba(76, 175, 80, 0.8)',
                'rgba(139, 195, 74, 0.85)',
                'rgba(205, 220, 57, 0.9)',
                'rgba(255, 235, 59, 0.95)',
                'rgba(255, 193, 7, 1)',
            ],
            components: {
                preview: true,
                opacity: true,
                hue: true,
                interaction: {
                    hex: false,
                    rgba: false,
                    hsla: false,
                    hsva: false,
                    cmyk: false,
                    input: false,
                    clear: false,
                    save: false,
                },
            },
        })
            .on('init', (pickr) => {
                this.themeCustom.input.value = pickr.getSelectedColor().toHEXA().toString(0);
            })
            .on('change', (color) => {
                this.themeCustom.color = color.toHEXA().toString();
                this.themeCustom.input.value = this.themeCustom.color;
                this.setCustomTheme();
            })
            .on('changestop', () => {
                const localStorageSettings = this.roomState.localStorageSettings;
                if (localStorageSettings) {
                    localStorageSettings.theme_color = this.themeCustom.color;
                    if (typeof lS !== 'undefined' && typeof lS.setSettings === 'function') {
                        lS.setSettings(localStorageSettings);
                    }
                }
            });

        return this.pickrInstance;
    }

    // ####################################################
    // LOAD SETTINGS FROM LOCAL STORAGE (from Room.js)
    // ####################################################

    loadSettingsFromLocalStorage(localStorageSettings) {
        const rc = this.rc;
        if (!rc || !localStorageSettings) return;

        rc.showChatOnMessage = localStorageSettings.show_chat_on_msg;

        const transcription = this.roomState.transcription || (typeof window !== 'undefined' ? window.transcription : null);
        if (transcription) transcription.showOnMessage = localStorageSettings.transcript_show_on_msg;

        rc.speechInMessages = localStorageSettings.speech_in_msg;

        if (typeof window !== 'undefined') {
            window.isPitchBarEnabled = localStorageSettings.pitch_bar;
            window.isSoundEnabled = localStorageSettings.sounds;
            window.isKeepButtonsVisible = localStorageSettings.keep_buttons_visible;
            window.isShortcutsEnabled = localStorageSettings.keyboard_shortcuts;
        }

        // Checkboxes
        this._setChecked('showChatOnMsg', rc.showChatOnMessage);
        this._setChecked('transcriptShowOnMsg', transcription ? transcription.showOnMessage : false);
        this._setChecked('speechIncomingMsg', rc.speechInMessages);
        this._setChecked('switchPitchBar', localStorageSettings.pitch_bar);
        this._setChecked('switchSounds', localStorageSettings.sounds);
        this._setChecked('switchShare', this.roomState.notify);
        this._setChecked('switchKeepButtonsVisible', localStorageSettings.keep_buttons_visible);
        this._setChecked('switchShortcuts', localStorageSettings.keyboard_shortcuts);
        this._setChecked('switchServerRecording', localStorageSettings.rec_server);
        this._setChecked('keepCustomTheme', this.themeCustom.keep);
        this._setChecked('switchDominantSpeakerFocus', localStorageSettings.dominant_speaker_focus);
        this._setChecked('switchNoiseSuppression', localStorageSettings.mic_noise_suppression);

        // Disable theme select if custom theme is kept
        const selectTheme = this.dom.get('selectTheme');
        if (selectTheme) selectTheme.disabled = this.themeCustom.keep;

        // Theme color input
        if (this.themeCustom.input) {
            this.themeCustom.input.value = this.themeCustom.color;
        }

        // Select elements
        this._setSelectedIndex('screenOptimization', localStorageSettings.screen_optimization);
        this._setSelectedIndex('videoFps', localStorageSettings.video_fps);
        this._setSelectedIndex('screenFps', localStorageSettings.screen_fps);
        this._setSelectedIndex('BtnAspectRatio', localStorageSettings.aspect_ratio);
        this._setSelectedIndex('BtnVideoObjectFit', localStorageSettings.video_obj_fit);
        this._setSelectedIndex('BtnVideoControls', localStorageSettings.video_controls);
        this._setSelectedIndex('BtnsBarPosition', localStorageSettings.buttons_bar);
        this._setSelectedIndex('pinVideoPosition', localStorageSettings.pin_grid);

        // Apply settings
        const BtnVideoObjectFit = this.dom.get('BtnVideoObjectFit');
        const BtnVideoControls = this.dom.get('BtnVideoControls');
        const BtnsBarPosition = this.dom.get('BtnsBarPosition');
        const pinVideoPosition = this.dom.get('pinVideoPosition');

        if (BtnVideoObjectFit) this.handleVideoObjectFit(BtnVideoObjectFit.value);
        if (BtnVideoControls) this.handleVideoControls(BtnVideoControls.value);
        if (BtnsBarPosition) this.changeBtnsBarPosition(BtnsBarPosition.value);
        if (pinVideoPosition) this.toggleVideoPin(pinVideoPosition.value);

        this.refreshMainButtonsToolTipPlacement();
    }

    _setChecked(elementId, value) {
        const el = this.dom.get(elementId);
        if (el) el.checked = !!value;
    }

    _setSelectedIndex(elementId, index) {
        const el = this.dom.get(elementId);
        if (el && index !== undefined && index !== null) el.selectedIndex = index;
    }

    // ####################################################
    // TOOLTIP PLACEMENT
    // ####################################################

    refreshMainButtonsToolTipPlacement() {
        const isMobileDevice = this.roomState.isMobileDevice;
        if (isMobileDevice) return;
        if (typeof setTippy !== 'function') return;

        const BtnsBarPosition = this.dom.get('BtnsBarPosition');
        if (!BtnsBarPosition) return;

        const position = BtnsBarPosition.options[BtnsBarPosition.selectedIndex].value;
        const bPlacement = position == 'vertical' ? 'top' : 'right';

        setTippy('startAudioButton', 'Start the audio', bPlacement);
        setTippy('stopAudioButton', 'Stop the audio', bPlacement);
        setTippy('startVideoButton', 'Start the video', bPlacement);
        setTippy('stopVideoButton', 'Stop the video', bPlacement);
        setTippy('swapCameraButton', 'Swap the camera', bPlacement);
        setTippy('startScreenButton', 'Start screen share', bPlacement);
        setTippy('stopScreenButton', 'Stop screen share', bPlacement);
        setTippy('raiseHandButton', 'Raise your hand', bPlacement);
        setTippy('lowerHandButton', 'Lower your hand', bPlacement);
        setTippy('chatButton', 'Toggle the chat', bPlacement);
        setTippy('participantsButton', 'Toggle participants list', bPlacement);
        setTippy('settingsButton', 'Toggle the settings', bPlacement);
        setTippy('exitButton', 'Leave room', bPlacement);
    }

    // ####################################################
    // ROOM ACTIONS (from RoomClient.js)
    // ####################################################

    roomAction(action, emit = true, popup = true) {
        const rc = this.rc;
        const isPresenter = this.roomState.isPresenter;
        const isBroadcastingEnabled = this.roomState.isBroadcastingEnabled;
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const room_password = this.roomState.room_password || (typeof window !== 'undefined' ? window.room_password : null);

        const data = {
            room_broadcasting: isBroadcastingEnabled,
            room_id: rc.room_id,
            peer_id: rc.peer_id,
            peer_name: rc.peer_name,
            peer_uuid: rc.peer_uuid,
            action: action,
            password: null,
        };

        if (emit) {
            switch (action) {
                case 'broadcasting':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lock':
                    if (room_password) {
                        this.socket
                            .request('getPeerCounts')
                            .then(async (res) => {
                                if (isPresenter || res.peerCounts == 1) {
                                    if (typeof window !== 'undefined') window.isPresenter = true;
                                    rc.peer_info.peer_presenter = true;
                                    const presenterEl = rc.getId('isUserPresenter');
                                    if (presenterEl) presenterEl.innerText = true;
                                    data.password = room_password;
                                    this.socket.emit('roomAction', data);
                                    if (popup) this.roomStatus(action);
                                }
                            })
                            .catch((err) => {
                                console.log('Get peer counts:', err);
                            });
                    } else {
                        Swal.fire({
                            allowOutsideClick: false,
                            allowEscapeKey: false,
                            showDenyButton: true,
                            background: swalBackground,
                            imageUrl: image.locked,
                            input: 'text',
                            inputPlaceholder: 'Set Room password',
                            confirmButtonText: `OK`,
                            denyButtonText: `Cancel`,
                            showClass: { popup: 'animate__animated animate__fadeInDown' },
                            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                            inputValidator: (pwd) => {
                                if (!pwd) return 'Please enter the Room password';
                                rc.RoomPassword = pwd;
                            },
                        }).then((result) => {
                            if (result.isConfirmed) {
                                data.password = rc.RoomPassword;
                                this.socket.emit('roomAction', data);
                                this.roomStatus(action);
                            }
                        });
                    }
                    break;
                case 'unlock':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lobbyOn':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lobbyOff':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'hostOnlyRecordingOn':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'hostOnlyRecordingOff':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'isBanned':
                    this.socket.emit('roomAction', data);
                    this._isBanned();
                    break;
                default:
                    break;
            }
        } else {
            this.roomStatus(action);
        }
    }

    roomStatus(action) {
        const rc = this.rc;
        const isPresenter = this.roomState.isPresenter;
        const isBroadcastingEnabled = this.roomState.isBroadcastingEnabled;
        const icons = this.roomState.icons || (typeof window !== 'undefined' ? window.icons : {});
        const _EVENTS = this.roomState._EVENTS || (typeof window !== 'undefined' ? window._EVENTS : {});

        switch (action) {
            case 'broadcasting':
                rc.userLog('info', `${icons.room} BROADCASTING ${isBroadcastingEnabled ? 'On' : 'Off'}`, 'top-end');
                break;
            case 'lock':
                if (!isPresenter) return;
                rc.sound('locked');
                rc.event(_EVENTS.roomLock);
                rc.userLog('info', `${icons.lock} LOCKED the room by the password`, 'top-end');
                break;
            case 'unlock':
                if (!isPresenter) return;
                rc.userLog('info', `${icons.unlock} UNLOCKED the room`, 'top-end');
                rc.event(_EVENTS.roomUnlock);
                break;
            case 'lobbyOn':
                rc.event(_EVENTS.lobbyOn);
                rc.userLog('info', `${icons.lobby} Lobby is enabled`, 'top-end');
                break;
            case 'lobbyOff':
                rc.event(_EVENTS.lobbyOff);
                rc.userLog('info', `${icons.lobby} Lobby is disabled`, 'top-end');
                break;
            case 'hostOnlyRecordingOn':
                rc.event(_EVENTS.hostOnlyRecordingOn);
                rc.userLog('info', `${icons.recording} Host only recording is enabled`, 'top-end');
                break;
            case 'hostOnlyRecordingOff':
                rc.event(_EVENTS.hostOnlyRecordingOff);
                rc.userLog('info', `${icons.recording} Host only recording is disabled`, 'top-end');
                break;
            default:
                break;
        }
    }

    roomMessage(action, active = false) {
        const rc = this.rc;
        const status = active ? 'ON' : 'OFF';
        const icons = this.roomState.icons || (typeof window !== 'undefined' ? window.icons : {});

        rc.sound('switch');
        switch (action) {
            case 'toggleVideoMirror':
                rc.userLog('info', `${icons.mirror} Video mirror ${status}`, 'top-end');
                break;
            case 'pitchBar':
                rc.userLog('info', `${icons.pitchBar} Audio pitch bar ${status}`, 'top-end');
                break;
            case 'sounds':
                rc.userLog('info', `${icons.sounds} Sounds notification ${status}`, 'top-end');
                break;
            case 'ptt':
                rc.userLog('info', `${icons.ptt} Push to talk ${status}`, 'top-end');
                break;
            case 'notify':
                rc.userLog('info', `${icons.share} Share room on join ${status}`, 'top-end');
                break;
            case 'hostOnlyRecording':
                rc.userLog('info', `${icons.recording} Only host recording ${status}`, 'top-end');
                break;
            case 'showChat':
                active
                    ? rc.userLog('info', `${icons.chat} Chat will be shown, when you receive a message`, 'top-end')
                    : rc.userLog('info', `${icons.chat} Chat not will be shown, when you receive a message`, 'top-end');
                break;
            case 'speechMessages':
                rc.userLog('info', `${icons.speech} Speech incoming messages ${status}`, 'top-end');
                break;
            case 'transcriptShowOnMsg':
                active
                    ? rc.userLog('info', `${icons.transcript} Transcript will be shown, when you receive a message`, 'top-end')
                    : rc.userLog('info', `${icons.transcript} Transcript not will be shown, when you receive a message`, 'top-end');
                break;
            case 'video_start_privacy':
                rc.userLog('info', `${icons.moderator} Moderator: everyone starts in privacy mode ${status}`, 'top-end');
                break;
            case 'audio_start_muted':
                rc.userLog('info', `${icons.moderator} Moderator: everyone starts muted ${status}`, 'top-end');
                break;
            case 'video_start_hidden':
                rc.userLog('info', `${icons.moderator} Moderator: everyone starts hidden ${status}`, 'top-end');
                break;
            case 'audio_cant_unmute':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't unmute themselves ${status}`, 'top-end');
                break;
            case 'video_cant_unhide':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't unhide themselves ${status}`, 'top-end');
                break;
            case 'screen_cant_share':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't share the screen ${status}`, 'top-end');
                break;
            case 'chat_cant_privately':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't chat privately ${status}`, 'top-end');
                break;
            case 'chat_cant_chatgpt':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't chat with ChatGPT ${status}`, 'top-end');
                break;
            case 'chat_cant_deep_seek':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't chat with DeepSeek ${status}`, 'top-end');
                break;
            case 'media_cant_sharing':
                rc.userLog('info', `${icons.moderator} Moderator: everyone can't share media ${status}`, 'top-end');
                break;
            case 'disconnect_all_on_leave':
                rc.userLog('info', `${icons.moderator} Moderator: disconnect all on leave room ${status}`, 'top-end');
                break;
            case 'recSyncServer':
                active
                    ? rc.showRecServerSideAdvice()
                    : rc.userLog('info', `${icons.recording} Server sync recording ${status}`, 'top-end');
                break;
            case 'customThemeKeep':
                rc.userLog('info', `${icons.theme} Custom theme keep ${status}`, 'top-end');
                break;
            case 'save_room_notifications':
                rc.userLog('success', 'Room notifications saved successfully', 'top-end');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // ROOM PASSWORD / LOCK / BANNED
    // ####################################################

    async roomPassword(data) {
        switch (data.password) {
            case 'OK':
                this.rc.RoomPasswordValid = true;
                await this.rc.joinAllowed(data.room);
                break;
            case 'KO':
                this.rc.RoomPasswordValid = false;
                this._roomIsLocked();
                break;
            default:
                break;
        }
    }

    unlockTheRoom() {
        const rc = this.rc;
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const room_password = this.roomState.room_password || (typeof window !== 'undefined' ? window.room_password : null);

        if (room_password) {
            rc.RoomPassword = room_password;
            let data = {
                action: 'checkPassword',
                password: rc.RoomPassword,
            };
            this.socket.emit('roomAction', data);
        } else {
            Swal.fire({
                allowOutsideClick: false,
                allowEscapeKey: false,
                background: swalBackground,
                imageUrl: image.locked,
                title: 'Oops, Room is Locked',
                input: 'text',
                inputPlaceholder: 'Enter the Room password',
                confirmButtonText: `OK`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                inputValidator: (pwd) => {
                    if (!pwd) return 'Please enter the Room password';
                    rc.RoomPassword = pwd;
                },
            }).then(() => {
                let data = {
                    action: 'checkPassword',
                    password: rc.RoomPassword,
                };
                this.socket.emit('roomAction', data);
            });
        }
    }

    _roomIsLocked() {
        const rc = this.rc;
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});
        const _EVENTS = this.roomState._EVENTS || (typeof window !== 'undefined' ? window._EVENTS : {});

        rc.sound('eject');
        rc.event(_EVENTS.roomLock);
        console.log('Room is Locked, try with another one');
        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            position: 'center',
            imageUrl: image.locked,
            title: 'Oops, Wrong Room Password',
            text: 'The room is locked, try with another one.',
            showDenyButton: false,
            confirmButtonText: `Ok`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) rc.exit();
        });
    }

    _isBanned() {
        const rc = this.rc;
        const swalBackground = this.roomState.swalBackground || (typeof window !== 'undefined' ? window.swalBackground : '');
        const image = this.roomState.image || (typeof window !== 'undefined' ? window.image : {});

        rc.sound('alert');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            showDenyButton: false,
            showConfirmButton: true,
            background: swalBackground,
            imageUrl: image.forbidden,
            title: 'Banned',
            text: 'You are banned from this room!',
            confirmButtonText: `Ok`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(() => {
            rc.exit();
        });
    }

    // ####################################################
    // DEVICE SELECTION (audio output from RoomClient.js)
    // ####################################################

    async changeAudioDestination(audioElement = false) {
        const rc = this.rc;
        const speakerSelect = this.dom.get('speakerSelect');
        const sinkId = speakerSelect ? speakerSelect.value : null;
        if (!sinkId) return;

        if (!rc.hasUserActivation()) {
            rc.pendingSinkId = sinkId;
            console.warn('Click once to apply the selected speaker');
            rc.runOnNextUserActivation(async () => {
                const els = audioElement ? [audioElement] : rc.remoteAudioEl.querySelectorAll('audio');
                for (const el of els) {
                    await this.attachSinkId(el, rc.pendingSinkId);
                }
                if (rc.pendingSinkId === sinkId) {
                    rc.pendingSinkId = null;
                }
            });
            return;
        }

        const els = audioElement ? [audioElement] : rc.remoteAudioEl.querySelectorAll('audio');
        for (const el of els) {
            await this.attachSinkId(el, sinkId);
        }
    }

    async attachSinkId(elem, sinkId) {
        const rc = this.rc;
        if (typeof elem.setSinkId !== 'function') {
            const error = 'Browser doesn\'t support output device selection.';
            console.warn(error);
            rc.userLog('error', error, 'top-end', 6000);
            return;
        }

        return elem
            .setSinkId(sinkId)
            .then(() => {
                console.log(`Success, audio output device attached: ${sinkId}`);
                if (rc.pendingSinkId === sinkId) {
                    rc.pendingSinkId = null;
                }
            })
            .catch((err) => {
                console.error('Attach SinkId error: ', err);
                const speakerSel = this.dom.get('speakerSelect');
                if (err && err.name === 'SecurityError') {
                    const msg = `Use HTTPS to select audio output device: ${err.message || err}`;
                    console.error('Attach SinkId error: ', msg);
                    rc.userLog('error', msg, 'top-end', 6000);
                } else if (err && (err.name === 'NotAllowedError' || /user gesture/i.test(err.message || ''))) {
                    rc.userLog('info', 'Click once to allow changing the speaker', 'top-end', 4000);
                    rc.pendingSinkId = sinkId;
                    rc.runOnNextUserActivation(() => {
                        if (rc.pendingSinkId === sinkId) {
                            this.attachSinkId(elem, rc.pendingSinkId);
                        }
                    });
                } else {
                    rc.userLog('warning', 'Attach SinkId error', err, 'top-end', 6000);
                }
                if (speakerSel) speakerSel.selectedIndex = 0;
                if (typeof refreshLsDevices === 'function') refreshLsDevices();
            });
    }

    // ####################################################
    // SETTINGS EXTRA DROPDOWN (from Room.js)
    // ####################################################

    setupSettingsExtraDropdown() {
        const settingsSplit = this.dom.get('settingsSplit');
        const settingsExtraDropdown = this.dom.get('settingsExtraDropdown');
        const settingsExtraToggle = this.dom.get('settingsExtraToggle');
        const settingsExtraMenu = this.dom.get('settingsExtraMenu');
        const settingsButton = this.dom.get('settingsButton');
        const noExtraButtons = this.dom.get('noExtraButtons');
        const BUTTONS = this.roomState.BUTTONS || (typeof window !== 'undefined' ? window.BUTTONS : {});

        if (!settingsSplit || !settingsExtraDropdown || !settingsExtraToggle || !settingsExtraMenu) return;

        if (BUTTONS.main && BUTTONS.main.extraButton) {
            if (typeof show === 'function') {
                show(settingsExtraDropdown);
                show(settingsExtraMenu);
            }
        } else {
            if (typeof hide === 'function') {
                hide(settingsExtraDropdown);
                hide(settingsExtraMenu);
            }
            if (noExtraButtons && typeof elemDisplay === 'function') elemDisplay(noExtraButtons, true);
            if (settingsButton) settingsButton.style.borderRadius = '10px';
        }

        let showTimeout;
        let hideTimeout;

        function showMenu() {
            clearTimeout(hideTimeout);
            if (typeof show === 'function') show(settingsExtraMenu);
        }
        function hideMenu() {
            clearTimeout(showTimeout);
            if (typeof hide === 'function') hide(settingsExtraMenu);
        }

        const clickHandler = function (e) {
            e.stopPropagation();
            !settingsExtraMenu.classList.contains('hidden') ? hideMenu() : showMenu();
        };
        settingsExtraToggle.addEventListener('click', clickHandler);

        const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        let closeTimeout;
        const cancelClose = () => {
            if (!closeTimeout) return;
            clearTimeout(closeTimeout);
            closeTimeout = null;
        };
        const scheduleClose = () => {
            cancelClose();
            closeTimeout = setTimeout(() => hideMenu(), 180);
        };

        if (supportsHover) {
            settingsExtraToggle.addEventListener('mouseenter', () => {
                cancelClose();
                showMenu();
            });
            settingsExtraToggle.addEventListener('mouseleave', scheduleClose);
            settingsExtraMenu.addEventListener('mouseenter', cancelClose);
            settingsExtraMenu.addEventListener('mouseleave', scheduleClose);
        }

        const menuClickHandler = function (e) {
            e.stopPropagation();
        };
        settingsExtraMenu.addEventListener('click', menuClickHandler);

        const documentClickHandler = function (e) {
            if (!settingsExtraToggle.contains(e.target) && !settingsExtraMenu.contains(e.target)) {
                hideMenu();
            }
        };
        document.addEventListener('click', documentClickHandler);

        // Store cleanup references
        this._settingsExtraCleanup = () => {
            settingsExtraToggle.removeEventListener('click', clickHandler);
            settingsExtraMenu.removeEventListener('click', menuClickHandler);
            document.removeEventListener('click', documentClickHandler);
        };
    }

    // ####################################################
    // QUICK DEVICE SWITCH DROPDOWNS (from Room.js)
    // ####################################################

    setupQuickDeviceSwitchDropdowns() {
        const isDesktopDevice = this.roomState.isDesktopDevice || (typeof window !== 'undefined' ? window.isDesktopDevice : false);
        const isMobileDevice = this.roomState.isMobileDevice;

        if (!isDesktopDevice) {
            this._restoreSplitButtonsBorderRadius();
            return;
        }

        const startVideoBtn = this.dom.get('startVideoButton');
        const startAudioBtn = this.dom.get('startAudioButton');
        const stopVideoBtn = this.dom.get('stopVideoButton');
        const stopAudioBtn = this.dom.get('stopAudioButton');
        const videoDropdown = this.dom.get('videoDropdown');
        const audioDropdown = this.dom.get('audioDropdown');
        const videoToggle = this.dom.get('videoToggle');
        const audioToggle = this.dom.get('audioToggle');
        const videoMenu = this.dom.get('videoMenu');
        const audioMenu = this.dom.get('audioMenu');
        const videoSelect = this.dom.get('videoSelect');
        const microphoneSelect = this.dom.get('microphoneSelect');
        const speakerSelect = this.dom.get('speakerSelect');
        const tabVideoDevicesBtn = this.dom.get('tabVideoDevicesBtn');
        const tabAudioDevicesBtn = this.dom.get('tabAudioDevicesBtn');
        const rc = this.rc;
        const self = this;

        if (
            !startVideoBtn || !startAudioBtn || !stopVideoBtn || !stopAudioBtn ||
            !videoDropdown || !audioDropdown || !videoToggle || !audioToggle
        ) {
            return;
        }

        function syncVisibility() {
            const showVideo = !startVideoBtn.classList.contains('hidden') || !stopVideoBtn.classList.contains('hidden');
            const showAudio = !startAudioBtn.classList.contains('hidden') || !stopAudioBtn.classList.contains('hidden');
            videoDropdown.classList.toggle('hidden', !showVideo);
            audioDropdown.classList.toggle('hidden', !showAudio);
        }

        function appendMenuHeader(menuEl, iconClass, title) {
            const header = document.createElement('div');
            header.className = 'device-menu-header';
            const icon = document.createElement('i');
            icon.className = iconClass;
            const text = document.createElement('span');
            text.textContent = title;
            header.appendChild(icon);
            header.appendChild(text);
            menuEl.appendChild(header);
        }

        function appendMenuDivider(menuEl) {
            const divider = document.createElement('div');
            divider.className = 'device-menu-divider';
            menuEl.appendChild(divider);
        }

        function appendSelectOptions(menuEl, selectEl, emptyLabel) {
            if (!selectEl) return;
            const options = Array.from(selectEl.options || []).filter((o) => o && o.value);
            if (options.length === 0) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.disabled = true;
                btn.textContent = emptyLabel;
                menuEl.appendChild(btn);
                return;
            }

            options.forEach((opt) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isSelected = opt.value === selectEl.value;
                const label = opt.textContent || opt.label || opt.value;

                btn.replaceChildren();
                if (isSelected) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-check';
                    btn.appendChild(icon);
                    btn.appendChild(document.createTextNode(` ${label}`));
                } else {
                    const spacer = document.createElement('span');
                    spacer.style.display = 'inline-block';
                    spacer.style.width = '1.25em';
                    btn.appendChild(spacer);
                    btn.appendChild(document.createTextNode(label));
                }

                btn.addEventListener('click', () => {
                    if (selectEl.value === opt.value) return;
                    selectEl.value = opt.value;
                    selectEl.dispatchEvent(new Event('change'));
                });

                menuEl.appendChild(btn);
            });
        }

        function buildVideoMenu() {
            if (!videoMenu || !videoSelect) return;
            videoMenu.innerHTML = '';
            appendMenuHeader(videoMenu, 'fas fa-video', 'Cameras');
            appendSelectOptions(videoMenu, videoSelect, 'No cameras found');

            appendMenuDivider(videoMenu);
            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'device-menu-action-btn';
            const settingsIcon = document.createElement('i');
            settingsIcon.className = 'fas fa-cog';
            settingsBtn.appendChild(settingsIcon);
            settingsBtn.appendChild(document.createTextNode(' Open Video Settings'));
            settingsBtn.addEventListener('click', () => {
                self.toggleMySettings();
                setTimeout(() => {
                    if (tabVideoDevicesBtn) tabVideoDevicesBtn.click();
                }, 100);
            });
            videoMenu.appendChild(settingsBtn);
        }

        function buildAudioMenu() {
            if (!audioMenu) return;
            audioMenu.innerHTML = '';

            appendMenuHeader(audioMenu, 'fas fa-microphone', 'Microphones');
            appendSelectOptions(audioMenu, microphoneSelect, 'No microphones found');

            appendMenuDivider(audioMenu);

            appendMenuHeader(audioMenu, 'fas fa-volume-high', 'Speakers');
            if (!speakerSelect || speakerSelect.disabled) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.disabled = true;
                btn.textContent = 'Speaker selection not supported';
                audioMenu.appendChild(btn);
                return;
            }
            appendSelectOptions(audioMenu, speakerSelect, 'No speakers found');

            appendMenuDivider(audioMenu);

            const testBtn = document.createElement('button');
            testBtn.type = 'button';
            testBtn.className = 'device-menu-action-btn';
            const testIcon = document.createElement('i');
            testIcon.className = 'fa-solid fa-circle-play';
            testBtn.appendChild(testIcon);
            testBtn.appendChild(document.createTextNode(' Test Speaker'));
            testBtn.addEventListener('click', () => {
                if (typeof playSpeaker === 'function') {
                    playSpeaker(speakerSelect ? speakerSelect.value : null, 'ring');
                }
            });
            audioMenu.appendChild(testBtn);

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'device-menu-action-btn';
            const settingsIcon = document.createElement('i');
            settingsIcon.className = 'fas fa-cog';
            settingsBtn.appendChild(settingsIcon);
            settingsBtn.appendChild(document.createTextNode(' Open Audio Settings'));
            settingsBtn.addEventListener('click', () => {
                self.toggleMySettings();
                setTimeout(() => {
                    if (tabAudioDevicesBtn) tabAudioDevicesBtn.click();
                }, 100);
            });
            audioMenu.appendChild(settingsBtn);
        }

        function rebuildVideoMenu() {
            clearTimeout(rebuildVideoMenu.timeoutId);
            rebuildVideoMenu.timeoutId = setTimeout(() => {
                buildVideoMenu();
            }, 10);
        }

        function rebuildAudioMenu() {
            clearTimeout(rebuildAudioMenu.timeoutId);
            rebuildAudioMenu.timeoutId = setTimeout(() => {
                buildAudioMenu();
            }, 10);
        }

        this._videoMenuBuilder = rebuildVideoMenu;
        this._audioMenuBuilder = rebuildAudioMenu;

        videoDropdown.addEventListener('click', rebuildVideoMenu);
        audioDropdown.addEventListener('click', rebuildAudioMenu);
        videoToggle.addEventListener('mouseenter', rebuildVideoMenu);
        audioToggle.addEventListener('mouseenter', rebuildAudioMenu);

        if (videoSelect) videoSelect.addEventListener('change', rebuildVideoMenu);
        if (microphoneSelect) microphoneSelect.addEventListener('change', rebuildAudioMenu);
        if (speakerSelect) speakerSelect.addEventListener('change', rebuildAudioMenu);

        syncVisibility();
        this._visibilityObserver = new MutationObserver(syncVisibility);
        this._visibilityObserver.observe(startVideoBtn, { attributes: true, attributeFilter: ['class'] });
        this._visibilityObserver.observe(startAudioBtn, { attributes: true, attributeFilter: ['class'] });
        this._visibilityObserver.observe(stopVideoBtn, { attributes: true, attributeFilter: ['class'] });
        this._visibilityObserver.observe(stopAudioBtn, { attributes: true, attributeFilter: ['class'] });

        if (navigator.mediaDevices) {
            this._lastDeviceChangeTime = 0;

            navigator.mediaDevices.addEventListener('devicechange', async () => {
                const now = Date.now();
                if (now - self._lastDeviceChangeTime < 1000) return;
                self._lastDeviceChangeTime = now;

                if (self._deviceChangeFrame) cancelAnimationFrame(self._deviceChangeFrame);

                self._deviceChangeFrame = requestAnimationFrame(async () => {
                    console.log('Audio devices changed - refreshing...');
                    await new Promise((resolve) => setTimeout(resolve, isMobileDevice ? 1500 : 500));
                    try {
                        if (typeof refreshMyAudioVideoDevices === 'function') {
                            await refreshMyAudioVideoDevices();
                        }
                    } catch (err) {
                        console.warn('Device refresh failed:', err);
                    }
                    setTimeout(() => {
                        rebuildVideoMenu();
                        rebuildAudioMenu();
                    }, 50);
                });
            });
        }
    }

    _restoreSplitButtonsBorderRadius() {
        document.querySelectorAll('#bottomButtons .split-btn').forEach((group) => {
            group.querySelectorAll('button').forEach((button) => {
                if (button.id != 'settingsExtraToggle' && button.id != 'settingsButton') {
                    button.style.setProperty('border-radius', '10px', 'important');
                }
            });
            const toggle = group.querySelector('.device-dropdown-toggle');
            if (toggle) toggle.style.setProperty('border-left', 'none', 'important');
        });
    }

    // ####################################################
    // VIRTUAL BACKGROUND SETTINGS (from Room.js)
    // ####################################################

    saveVirtualBackgroundSettings(blurLevel, imageUrl, transparent) {
        const settings = {
            blurLevel: blurLevel || null,
            imageUrl: imageUrl || null,
            transparent: transparent || null,
        };
        localStorage.setItem('virtualBackgroundSettings', JSON.stringify(settings));
    }

    async loadVirtualBackgroundSettings() {
        const isSupported = this.roomState.isMediaStreamTrackAndTransformerSupported
            || (typeof window !== 'undefined' ? window.isMediaStreamTrackAndTransformerSupported : false);

        if (!isSupported) return;

        const savedSettings = localStorage.getItem('virtualBackgroundSettings');
        if (!savedSettings) return;

        const { blurLevel, imageUrl, transparent } = JSON.parse(savedSettings);

        if (typeof applyVirtualBackground === 'function') {
            const initVideo = this.roomState.initVideo || (typeof window !== 'undefined' ? window.initVideo : null);
            const initStream = this.roomState.initStream || (typeof window !== 'undefined' ? window.initStream : null);

            if (blurLevel) {
                await applyVirtualBackground(initVideo, initStream, blurLevel);
            } else if (imageUrl) {
                await applyVirtualBackground(initVideo, initStream, null, imageUrl);
            } else if (transparent) {
                await applyVirtualBackground(initVideo, initStream, null, null, true);
            }
        }

        const shouldClickBtn = (typeof window !== 'undefined')
            && (window.virtualBackgroundBlurLevel || window.virtualBackgroundSelectedImage || window.virtualBackgroundTransparent);

        if (shouldClickBtn) {
            const initVirtualBackgroundButton = this.dom.get('initVirtualBackgroundButton');
            if (initVirtualBackgroundButton) initVirtualBackgroundButton.click();
        }
    }

    // ####################################################
    // FULL SCREEN (from RoomClient.js)
    // ####################################################

    isFullScreenSupported() {
        const fsSupported =
            document.fullscreenEnabled ||
            document.webkitFullscreenEnabled ||
            document.mozFullScreenEnabled ||
            document.msFullscreenEnabled;

        if (fsSupported) {
            this._handleFullScreenEvents();
        } else {
            const fullScreenButton = this.dom.get('fullScreenButton');
            if (fullScreenButton) fullScreenButton.style.display = 'none';
        }

        return fsSupported;
    }

    _handleFullScreenEvents() {
        const rc = this.rc;
        const html = this.roomState.html || (typeof window !== 'undefined' ? window.html : {});

        document.addEventListener('fullscreenchange', () => {
            const fullscreenElement = document.fullscreenElement;
            if (!fullscreenElement) {
                const fullScreenIcon = this.dom.get('fullScreenIcon');
                if (fullScreenIcon) fullScreenIcon.className = html.fullScreenOff;
                if (rc) rc.isDocumentOnFullScreen = false;
            }
        });
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    close() {
        // Remove socket listeners
        if (this.socket) {
            if (this._handleRoomAction) {
                this.socket.off('roomAction', this._handleRoomAction);
            }
        }

        // Destroy pickr instance
        if (this.pickrInstance) {
            try {
                this.pickrInstance.destroyAndRemove();
            } catch (e) {
                console.warn('Error destroying pickr:', e);
            }
            this.pickrInstance = null;
        }

        // Disconnect visibility observer
        if (this._visibilityObserver) {
            this._visibilityObserver.disconnect();
            this._visibilityObserver = null;
        }

        // Cancel device change frame
        if (this._deviceChangeFrame) {
            cancelAnimationFrame(this._deviceChangeFrame);
            this._deviceChangeFrame = null;
        }

        // Clean up settings extra dropdown
        if (this._settingsExtraCleanup) {
            this._settingsExtraCleanup();
            this._settingsExtraCleanup = null;
        }

        // Clear references
        this._handleRoomAction = null;
        this._videoMenuBuilder = null;
        this._audioMenuBuilder = null;
        this.socketManager = null;
        this.rc = null;
        this.socket = null;

        console.log('SettingsManager closed');
    }
}
