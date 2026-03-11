'use strict';

/**
 * PollManager
 *
 * Manages poll creation, voting, display, pinning, and persistence.
 * Extracted from RoomClient.js poll-related methods.
 */
class PollManager {
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

        this.isPollOpen = false;
        this.isPollPinned = false;
        this.pollSelectedOptions = {};
    }

    /**
     * Initialize with socket manager and RoomClient reference.
     * @param {Object} socketManager - Socket manager instance
     * @param {Object} rc - RoomClient instance for backward compatibility
     */
    init(socketManager, rc) {
        this.socketManager = socketManager;
        this.rc = rc;
        this.socket = rc.socket;
        this._bindSocketEvents();
    }

    // ####################################################
    // SOCKET EVENTS
    // ####################################################

    _bindSocketEvents() {
        this.socket.on('updatePolls', (data) => {
            this.pollsUpdate(data);
        });
    }

    // ####################################################
    // TOGGLE / OPEN / CLOSE
    // ####################################################

    togglePoll() {
        const pollRoom = this.dom.get('pollRoom');
        const pollMinButton = this.dom.get('pollMinButton');
        const pollMaxButton = this.dom.get('pollMaxButton');

        pollRoom.classList.toggle('show');
        if (!this.isPollOpen) {
            hide(pollMinButton);
            if (!this.rc.isMobileDevice) {
                BUTTONS.poll.pollMaxButton && show(pollMaxButton);
            }
            this.pollCenter();
            this.rc.sound('open');
        }
        this.isPollOpen = !this.isPollOpen;

        if (this.isPollPinned) this.pollUnpin();

        if (!this.rc.isMobileDevice && this.isPollOpen && this.rc.canBePinned()) {
            this.togglePollPin();
        }
    }

    // ####################################################
    // PIN / UNPIN
    // ####################################################

    togglePollPin() {
        if (transcription.isPin()) {
            return userLog('info', 'Please unpin the transcription that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isChatPinned) {
            return userLog('info', 'Please unpin the chat that appears to be currently pinned', 'top-end');
        }
        if (this.rc.isEditorPinned) {
            return userLog('info', 'Please unpin the editor that appears to be currently pinned', 'top-end');
        }
        this.isPollPinned ? this.pollUnpin() : this.pollPin();
        this.rc.sound('click');
    }

    pollPin() {
        const pollRoom = this.dom.get('pollRoom');
        const pollHeader = this.dom.get('pollHeader');
        const pollTogglePin = this.dom.get('pollTogglePin');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainerPin();
        }
        this.pollPinned();
        this.isPollPinned = true;
        setColor(pollTogglePin, 'lime');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        pollRoom.style.resize = 'none';
        if (!this.rc.isMobileDevice) this.rc.makeUnDraggable(pollRoom, pollHeader);
    }

    pollUnpin() {
        const pollRoom = this.dom.get('pollRoom');
        const pollHeader = this.dom.get('pollHeader');
        const pollTogglePin = this.dom.get('pollTogglePin');

        if (!this.rc.isVideoPinned) {
            this.rc.videoMediaContainerUnpin();
        }
        pollRoom.style.maxWidth = '600px';
        pollRoom.style.maxHeight = '700px';
        this.pollCenter();
        this.isPollPinned = false;
        setColor(pollTogglePin, 'white');
        this.rc.resizeVideoMenuBar();
        resizeVideoMedia();
        if (!this.rc.isMobileDevice) this.rc.makeDraggable(pollRoom, pollHeader);
    }

    pollPinned() {
        const pollRoom = this.dom.get('pollRoom');
        pollRoom.style.position = 'absolute';
        pollRoom.style.top = 0;
        pollRoom.style.right = 0;
        pollRoom.style.left = null;
        pollRoom.style.transform = null;
        pollRoom.style.maxWidth = '25%';
        pollRoom.style.maxHeight = '100%';
    }

    // ####################################################
    // POSITIONING / SIZING
    // ####################################################

    pollCenter() {
        const pollRoom = this.dom.get('pollRoom');
        pollRoom.style.position = 'fixed';
        pollRoom.style.transform = 'translate(-50%, -50%)';
        pollRoom.style.top = '50%';
        pollRoom.style.left = '50%';
    }

    pollMaximize() {
        const pollRoom = this.dom.get('pollRoom');
        const pollMaxButton = this.dom.get('pollMaxButton');
        const pollMinButton = this.dom.get('pollMinButton');

        pollRoom.style.maxHeight = '100vh';
        pollRoom.style.maxWidth = '100vw';
        this.pollCenter();
        hide(pollMaxButton);
        BUTTONS.poll.pollMaxButton && show(pollMinButton);
    }

    pollMinimize() {
        const pollRoom = this.dom.get('pollRoom');
        const pollMaxButton = this.dom.get('pollMaxButton');
        const pollMinButton = this.dom.get('pollMinButton');

        this.pollCenter();
        hide(pollMinButton);
        BUTTONS.poll.pollMaxButton && show(pollMaxButton);
        if (this.isPollPinned) {
            this.pollPin();
        } else {
            pollRoom.style.maxWidth = '600px';
            pollRoom.style.maxHeight = '700px';
        }
    }

    // ####################################################
    // POLL DATA UPDATE (from server)
    // ####################################################

    pollsUpdate(polls) {
        if (!this.isPollOpen) this.togglePoll();

        const pollsContainer = this.dom.get('pollsContainer');
        pollsContainer.innerHTML = '';

        polls.forEach((poll, index) => {
            const pollDiv = document.createElement('div');
            pollDiv.className = 'poll';

            const question = document.createElement('p');
            question.className = 'poll-question';
            question.textContent = poll.question;
            pollDiv.appendChild(question);

            const options = document.createElement('div');
            options.className = 'options';

            poll.options.forEach((option) => {
                const optionDiv = document.createElement('div');
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `poll${index}`;
                input.value = option;
                if (this.pollSelectedOptions[index] === option) {
                    input.checked = true;
                }

                input.addEventListener('change', () => {
                    this.pollSelectedOptions[index] = option;
                    this.socket.emit('vote', { pollIndex: index, option });
                });

                const label = document.createElement('label');
                label.textContent = option;

                optionDiv.appendChild(input);
                optionDiv.appendChild(label);
                options.appendChild(optionDiv);
            });
            pollDiv.appendChild(options);

            const pollButtonsDiv = document.createElement('div');
            pollButtonsDiv.className = 'poll-btns';

            // Toggle voters button
            const toggleButton = document.createElement('button');
            const toggleButtonIcon = document.createElement('i');
            toggleButtonIcon.className = 'fas fa-users';
            toggleButton.id = 'toggleVoters';
            toggleButton.className = 'view-btn';
            toggleButton.insertBefore(toggleButtonIcon, toggleButton.firstChild);
            toggleButton.addEventListener('click', () => {
                votersList.style.display === 'none'
                    ? (votersList.style.display = 'block')
                    : (votersList.style.display = 'none');
            });
            pollButtonsDiv.appendChild(toggleButton);

            // Edit poll button
            const editPollButton = document.createElement('button');
            const editPollButtonIcon = document.createElement('i');
            editPollButtonIcon.className = 'fas fa-pen-to-square';
            editPollButton.id = 'editPoll';
            editPollButton.className = 'poll-btn';
            editPollButton.insertBefore(editPollButtonIcon, editPollButton.firstChild);
            editPollButton.addEventListener('click', () => {
                Swal.fire({
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    background: swalBackground,
                    title: 'Edit Poll',
                    html: this.createPollInputs(poll),
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: 'Save',
                    cancelButtonText: 'Cancel',
                    cancelButtonColor: '#dc3545',
                    preConfirm: () => {
                        const newQuestion = document.getElementById('swal-input-question').value;
                        const newOptions = this.getPollOptions(poll.options.length);
                        this.socket.emit('editPoll', {
                            index,
                            question: newQuestion,
                            options: newOptions,
                            peer_name: this.rc.peer_name,
                            peer_uuid: this.rc.peer_uuid,
                        });
                    },
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
            });
            pollButtonsDiv.appendChild(editPollButton);

            // Delete poll button
            const deletePollButton = document.createElement('button');
            const deletePollButtonIcon = document.createElement('i');
            deletePollButtonIcon.className = 'fas fa-trash';
            deletePollButton.id = 'delPoll';
            deletePollButton.className = 'del-btn';
            deletePollButton.insertBefore(deletePollButtonIcon, deletePollButton.firstChild);
            deletePollButton.addEventListener('click', () => {
                Swal.fire({
                    background: swalBackground,
                    position: 'top',
                    title: 'Delete this poll?',
                    imageUrl: image.delete,
                    showDenyButton: true,
                    confirmButtonText: 'Yes',
                    denyButtonText: 'No',
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                }).then((result) => {
                    if (result.isConfirmed) {
                        this.socket.emit('deletePoll', {
                            index,
                            peer_name: this.rc.peer_name,
                            peer_uuid: this.rc.peer_uuid,
                        });
                    }
                });
            });
            pollButtonsDiv.appendChild(deletePollButton);

            // Thematic break
            const hr = document.createElement('hr');
            pollDiv.appendChild(hr);

            // Append buttons to poll
            pollDiv.appendChild(pollButtonsDiv);

            // Create voter lists
            const votersList = document.createElement('ul');
            votersList.style.display = 'none';
            for (const [user, vote] of Object.entries(poll.voters)) {
                const voter = document.createElement('li');
                voter.textContent = `${user}: ${vote}`;
                votersList.appendChild(voter);
            }
            pollDiv.appendChild(votersList);

            pollsContainer.appendChild(pollDiv);

            if (!this.rc.isMobileDevice) {
                setTippy('toggleVoters', 'Toggle voters', 'top');
                setTippy('delPoll', 'Delete poll', 'top');
                setTippy('editPoll', 'Edit poll', 'top');
            }
        });
    }

    // ####################################################
    // POLL CREATION FORM
    // ####################################################

    pollCreateNewForm(e) {
        e.preventDefault();

        const question = e.target.question.value;
        const optionInputs = document.querySelectorAll('.option-input');
        const options = Array.from(optionInputs).map((input) => input.value.trim());

        this.socket.emit('createPoll', { question, options });

        e.target.reset();
        const optionsContainer = this.dom.get('optionsContainer');
        optionsContainer.innerHTML = '';
        const initialOptionInput = document.createElement('input');
        initialOptionInput.type = 'text';
        initialOptionInput.name = 'option';
        initialOptionInput.className = 'option-input';
        initialOptionInput.required = true;
        optionsContainer.appendChild(initialOptionInput);
    }

    pollAddOptions() {
        const optionsContainer = this.dom.get('optionsContainer');
        const optionInput = document.createElement('input');
        optionInput.type = 'text';
        optionInput.name = 'option';
        optionInput.className = 'option-input';
        optionInput.required = true;
        optionsContainer.appendChild(optionInput);
    }

    pollDeleteOptions() {
        const optionsContainer = this.dom.get('optionsContainer');
        const optionInputs = document.querySelectorAll('.option-input');
        if (optionInputs.length > 1) {
            optionsContainer.removeChild(optionInputs[optionInputs.length - 1]);
        }
    }

    // ####################################################
    // POLL EDIT HELPERS
    // ####################################################

    createPollInputs(poll) {
        const questionInput = `<input id="swal-input-question" class="swal2-input" value="${poll.question}">`;
        const optionsInputs = poll.options
            .map((option, i) => `<input id="swal-input-option${i}" class="swal2-input" value="${option}">`)
            .join('');
        return questionInput + optionsInputs;
    }

    getPollOptions(optionCount) {
        const options = [];
        for (let i = 0; i < optionCount; i++) {
            options.push(document.getElementById(`swal-input-option${i}`).value);
        }
        return options;
    }

    // ####################################################
    // SAVE RESULTS
    // ####################################################

    pollSaveResults() {
        const polls = document.querySelectorAll('.poll');
        const results = [];

        polls.forEach((poll, index) => {
            const question = poll.querySelector('.poll-question').textContent;
            const options = poll.querySelectorAll('.options div label');

            const optionsText = Array.from(options).reduce((acc, option, idx) => {
                acc[idx + 1] = option.textContent.trim();
                return acc;
            }, {});

            const votersList = poll.querySelector('ul');
            const voters = Array.from(votersList.querySelectorAll('li')).reduce((acc, li) => {
                const [name, vote] = li.textContent.split(':').map((item) => item.trim());
                acc[name] = vote;
                return acc;
            }, {});

            results.push({
                Poll: `${index + 1}`,
                question: question,
                options: optionsText,
                voters: voters,
            });
        });

        results.length > 0
            ? saveObjToJsonFile(results, 'Poll')
            : this.rc.userLog('info', 'No polling data available to save', 'top-end');
    }

    getPollFileName() {
        const dateTime = getDataTimeStringFormat();
        const roomName = this.rc.room_id.trim();
        return `Poll_${roomName}_${dateTime}.txt`;
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    close() {
        if (this.socket) {
            this.socket.off('updatePolls');
        }
        if (this.isPollPinned) {
            this.pollUnpin();
        }
        this.isPollOpen = false;
        this.isPollPinned = false;
        this.pollSelectedOptions = {};
        this.socketManager = null;
        this.rc = null;
        this.socket = null;
    }
}
