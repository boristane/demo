class DrawingApp {
    constructor() {
        this.canvas = document.getElementById('drawingCanvas')
        this.ctx = this.canvas.getContext('2d')
        this.socket = null
        this.userId = null
        this.userName = null
        this.userColor = null
        this.roomId = this.getRoomId()
        this.participants = new Map()
        this.lines = []
        this.battleId = this.getBattleIdFromUrl()
        this.activeBattle = null
        this.battleTimerHandle = null
        this.battleSubmitted = false
        this.lastAnalysis = null

        // Drawing state
        this.isDrawing = false
        this.lastPoint = null

        this.init()
    }

    getRoomId() {
        const params = new URLSearchParams(window.location.search)
        let roomId = params.get('room')
        if (!roomId) {
            roomId = Math.random().toString(36).substring(2, 8)
            const newUrl = `${window.location.pathname}?${new URLSearchParams({
                room: roomId,
                ...(params.get('battle') ? { battle: params.get('battle') } : {}),
            })}`
            window.history.replaceState({}, '', newUrl)
        }
        return roomId
    }

    getBattleIdFromUrl() {
        const params = new URLSearchParams(window.location.search)
        const raw = params.get('battle')
        if (!raw) return null
        const n = parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
    }

    init() {
        this.setupCanvas()
        this.setupEventListeners()
        this.updateRoomInfo()
        this.showNameModal()
    }

    setupCanvas() {
        const resizeCanvas = () => {
            const rect = this.canvas.getBoundingClientRect()
            this.canvas.width = rect.width
            this.canvas.height = rect.height
            this.redrawCanvas()
        }
        resizeCanvas()
        window.addEventListener('resize', resizeCanvas)
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.startDrawing.bind(this))
        this.canvas.addEventListener('mousemove', this.draw.bind(this))
        this.canvas.addEventListener('mouseup', this.stopDrawing.bind(this))
        this.canvas.addEventListener('mouseleave', this.stopDrawing.bind(this))

        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false })
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false })
        this.canvas.addEventListener('touchend', this.stopDrawing.bind(this))
        this.canvas.addEventListener('touchcancel', this.stopDrawing.bind(this))

        document.getElementById('clearBtn').addEventListener('click', () => this.clearCanvas())
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyzeDrawing())
        document.getElementById('copyBtn').addEventListener('click', () => this.copyRoomLink())

        const nameInput = document.getElementById('nameInput')
        const joinBtn = document.getElementById('joinBtn')
        joinBtn.addEventListener('click', () => {
            const name = nameInput.value.trim()
            if (name) {
                this.userName = name
                this.joinRoom()
            }
        })
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const name = nameInput.value.trim()
                if (name) {
                    this.userName = name
                    this.joinRoom()
                }
            }
        })

        document.getElementById('submitBattleBtn').addEventListener('click', () => this.submitBattleEntry())
        document.getElementById('saveGalleryBtn').addEventListener('click', () => this.saveToGallery())

        const battleResultClose = document.getElementById('battleResultClose')
        if (battleResultClose) {
            battleResultClose.addEventListener('click', () => {
                document.getElementById('battleResultModal').classList.remove('show')
            })
        }
    }

    startDrawing(e) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        this.isDrawing = true
        const rect = this.canvas.getBoundingClientRect()
        this.lastPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    draw(e) {
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        const rect = this.canvas.getBoundingClientRect()
        const currentPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        this.drawLine(this.lastPoint, currentPoint, this.userColor)
        this.lines.push({
            from: this.lastPoint,
            to: currentPoint,
            color: this.userColor,
            userId: this.userId,
            t: Date.now(),
        })
        this.socket.send(JSON.stringify({
            type: 'draw_line',
            from: this.lastPoint,
            to: currentPoint,
        }))
        this.lastPoint = currentPoint
    }

    stopDrawing() {
        this.isDrawing = false
        this.lastPoint = null
    }

    handleTouchStart(e) {
        e.preventDefault()
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        const touch = e.touches[0]
        const rect = this.canvas.getBoundingClientRect()
        this.isDrawing = true
        this.lastPoint = { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    handleTouchMove(e) {
        e.preventDefault()
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        const touch = e.touches[0]
        const rect = this.canvas.getBoundingClientRect()
        const currentPoint = { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
        this.drawLine(this.lastPoint, currentPoint, this.userColor)
        this.lines.push({
            from: this.lastPoint,
            to: currentPoint,
            color: this.userColor,
            userId: this.userId,
            t: Date.now(),
        })
        this.socket.send(JSON.stringify({
            type: 'draw_line',
            from: this.lastPoint,
            to: currentPoint,
        }))
        this.lastPoint = currentPoint
    }

    showNameModal() {
        document.getElementById('nameModal').classList.add('show')
        document.getElementById('nameInput').focus()
    }

    hideNameModal() {
        document.getElementById('nameModal').classList.remove('show')
    }

    async joinRoom() {
        this.hideNameModal()
        this.connectWebSocket()
        if (this.battleId) {
            await this.hydrateBattleFromUrl()
        }
    }

    async hydrateBattleFromUrl() {
        try {
            const res = await fetch(`/api/battles/${this.battleId}`)
            if (!res.ok) return
            const battle = await res.json()
            if (battle.status === 'open' && battle.timeRemaining > 0) {
                const endsAt = Date.parse(battle.endsAt)
                this.activateBattle({
                    battleId: battle.id,
                    prompt: battle.prompt,
                    endsAt,
                })
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({
                        type: 'activate_battle',
                        battleId: battle.id,
                        prompt: battle.prompt,
                        endsAt,
                    }))
                } else {
                    this.pendingBattleBroadcast = { battleId: battle.id, prompt: battle.prompt, endsAt }
                }
            } else {
                this.showNotification('Battle already ended')
            }
        } catch (err) {
            console.error(err)
        }
    }

    connectWebSocket() {
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/room/${this.roomId}/websocket`
        this.socket = new WebSocket(wsUrl)

        this.socket.onopen = () => {
            this.socket.send(JSON.stringify({ type: 'join', name: this.userName }))
            this.showNotification('Connected to room!')
            if (this.pendingBattleBroadcast) {
                this.socket.send(JSON.stringify({
                    type: 'activate_battle',
                    ...this.pendingBattleBroadcast,
                }))
                this.pendingBattleBroadcast = null
            }
        }
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data)
            this.handleWebSocketMessage(message)
        }
        this.socket.onclose = () => {
            this.showNotification('Disconnected. Refreshing...')
            setTimeout(() => window.location.reload(), 2000)
        }
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error)
            this.showNotification('Connection error')
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'init':
                this.userId = message.userId
                this.userColor = message.color
                this.participants = new Map(message.participants)
                this.lines = (message.lines || []).map((l) => ({
                    ...l,
                    t: l.t || Date.now(),
                }))
                this.updateParticipantsList()
                this.redrawCanvas()
                if (message.battle && message.battle.endsAt > Date.now() && !this.activeBattle) {
                    this.activateBattle(message.battle)
                }
                break

            case 'user_joined':
                this.participants.set(message.userId, {
                    name: message.name,
                    color: message.color,
                })
                this.updateParticipantsList()
                this.showNotification(`${message.name} joined`)
                break

            case 'user_left':
                const leftUser = this.participants.get(message.userId)
                if (leftUser) {
                    this.showNotification(`${leftUser.name} left`)
                    this.participants.delete(message.userId)
                    this.updateParticipantsList()
                }
                break

            case 'line_drawn':
                this.lines.push({
                    from: message.from,
                    to: message.to,
                    color: message.color,
                    userId: message.userId,
                    t: Date.now(),
                })
                this.drawLine(message.from, message.to, message.color)
                break

            case 'canvas_cleared':
                this.lines = []
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                this.showNotification('Canvas cleared')
                break

            case 'battle_started':
                if (message.battle) this.activateBattle(message.battle)
                break

            case 'battle_ended':
                this.deactivateBattle()
                break

            case 'constellation_found':
                if (message.result) this.showResultsModal(message.result)
                break
        }
    }

    activateBattle(battle) {
        this.activeBattle = battle
        this.battleId = battle.battleId
        document.getElementById('battleBanner').style.display = 'flex'
        document.getElementById('battlePromptText').textContent = battle.prompt
        const submitBtn = document.getElementById('submitBattleBtn')
        submitBtn.disabled = false
        submitBtn.style.display = this.battleSubmitted ? 'none' : 'inline-flex'
        this.startBattleTimer()
    }

    deactivateBattle() {
        this.activeBattle = null
        document.getElementById('battleBanner').style.display = 'none'
        if (this.battleTimerHandle) {
            clearInterval(this.battleTimerHandle)
            this.battleTimerHandle = null
        }
    }

    startBattleTimer() {
        if (this.battleTimerHandle) clearInterval(this.battleTimerHandle)
        const update = () => {
            if (!this.activeBattle) return
            const remaining = Math.max(0, Math.floor((this.activeBattle.endsAt - Date.now()) / 1000))
            const timerEl = document.getElementById('battleTimer')
            const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
            const ss = String(remaining % 60).padStart(2, '0')
            timerEl.textContent = `${mm}:${ss}`
            timerEl.classList.toggle('warning', remaining <= 15 && remaining > 0)
            if (remaining <= 0) {
                clearInterval(this.battleTimerHandle)
                this.battleTimerHandle = null
                if (!this.battleSubmitted) {
                    this.submitBattleEntry(true)
                }
            }
        }
        update()
        this.battleTimerHandle = setInterval(update, 1000)
    }

    async submitBattleEntry(auto = false) {
        if (!this.activeBattle || this.battleSubmitted) return
        this.battleSubmitted = true
        const submitBtn = document.getElementById('submitBattleBtn')
        submitBtn.disabled = true
        submitBtn.textContent = 'Submitting...'

        const imageData = this.canvas.toDataURL('image/png')
        try {
            const res = await fetch(`/api/battles/${this.activeBattle.battleId}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomId: this.roomId,
                    teamName: this.userName || 'Team',
                    imageData,
                    strokes: this.lines,
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                this.showNotification(data.error || 'Submission failed')
                this.battleSubmitted = false
                submitBtn.disabled = false
                submitBtn.textContent = 'Submit Entry'
                return
            }
            this.showBattleResult(data.score, data.feedback, this.activeBattle.battleId)
            submitBtn.style.display = 'none'
            if (auto) this.showNotification('Time up - submitted automatically')
        } catch (err) {
            console.error(err)
            this.showNotification('Submission failed')
            this.battleSubmitted = false
            submitBtn.disabled = false
            submitBtn.textContent = 'Submit Entry'
        }
    }

    showBattleResult(score, feedback, battleId) {
        document.getElementById('battleScoreBig').textContent = `${score}/100`
        document.getElementById('battleFeedbackBlock').textContent = feedback || ''
        document.getElementById('viewBattleLink').href = `/battle.html`
        document.getElementById('battleResultModal').classList.add('show')
    }

    drawLine(from, to, color) {
        this.ctx.beginPath()
        this.ctx.moveTo(from.x, from.y)
        this.ctx.lineTo(to.x, to.y)
        this.ctx.strokeStyle = color
        this.ctx.lineWidth = 2
        this.ctx.lineCap = 'round'
        this.ctx.lineJoin = 'round'
        this.ctx.stroke()
    }

    redrawCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        this.lines.forEach((line) => this.drawLine(line.from, line.to, line.color))
    }

    clearCanvas() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'clear' }))
        }
        this.lines = []
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }

    async analyzeDrawing() {
        const analyzeBtn = document.getElementById('analyzeBtn')
        const btnIcon = analyzeBtn.querySelector('.btn-icon')
        const btnSpinner = analyzeBtn.querySelector('.btn-spinner')
        const btnText = analyzeBtn.querySelector('.btn-text')

        analyzeBtn.classList.add('loading')
        analyzeBtn.disabled = true
        btnIcon.style.display = 'none'
        btnSpinner.style.display = 'block'
        btnText.textContent = 'Creating Constellation...'

        const imageData = this.canvas.toDataURL('image/png')

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData }),
            })
            const result = await response.json()

            if (result.result) {
                let analysisText = ''
                if (typeof result.result === 'object') {
                    if (result.result.response) analysisText = result.result.response
                    else if (result.result.description) analysisText = result.result.description
                    else if (result.result.text) analysisText = result.result.text
                    else analysisText = Object.values(result.result).find(v => typeof v === 'string') || 'Analysis complete'
                } else if (typeof result.result === 'string') {
                    analysisText = result.result
                } else {
                    analysisText = 'Analysis complete'
                }

                this.lastAnalysis = {
                    text: analysisText,
                    skyViewImageB64: result.skyView && result.skyView.image ? result.skyView.image : null,
                    strokesSnapshot: [...this.lines],
                }
                this.showResultsModal(analysisText, result.skyView)
            } else {
                this.showResultsModal('No pattern detected in the drawing.')
            }
        } catch (error) {
            console.error('Analysis error:', error)
            this.showNotification('Analysis failed')
        } finally {
            analyzeBtn.classList.remove('loading')
            analyzeBtn.disabled = false
            btnIcon.style.display = 'block'
            btnSpinner.style.display = 'none'
            btnText.textContent = 'Create Constellation'
        }
    }

    showResultsModal(text, skyView = null) {
        const modal = document.getElementById('resultsModal')
        const skyViewImage = document.getElementById('skyViewImage')
        const skyViewLoading = document.getElementById('skyViewLoading')
        const downloadBtn = document.getElementById('downloadBtn')
        const storyBlock = document.getElementById('storyBlock')
        const saveRow = document.getElementById('saveGalleryRow')
        const titleInput = document.getElementById('galleryTitleInput')
        const saveBtn = document.getElementById('saveGalleryBtn')

        if (text && text.trim()) {
            storyBlock.textContent = text
            storyBlock.style.display = 'block'
        } else {
            storyBlock.style.display = 'none'
        }

        if (skyView) {
            skyViewLoading.style.display = 'block'
            skyViewImage.style.display = 'none'
            downloadBtn.style.display = 'none'

            if (skyView.image) {
                const imageData = skyView.image
                skyViewImage.src = `data:image/png;base64,${imageData}`
                skyViewImage.onload = () => {
                    skyViewLoading.style.display = 'none'
                    skyViewImage.style.display = 'block'
                    downloadBtn.style.display = 'inline-flex'
                    downloadBtn.onclick = () => this.downloadImage(skyViewImage.src)
                }
                skyViewImage.onerror = () => {
                    skyViewLoading.textContent = 'Failed to load sky view'
                    downloadBtn.style.display = 'none'
                }
            } else {
                skyViewLoading.textContent = 'Sky view generation unavailable'
                downloadBtn.style.display = 'none'
            }
        } else {
            document.getElementById('skyView').style.display = 'none'
            downloadBtn.style.display = 'none'
        }

        if (this.lastAnalysis) {
            saveRow.style.display = 'flex'
            saveBtn.disabled = false
            saveBtn.textContent = 'Save to Gallery'
            titleInput.value = deriveDefaultTitle(text)
        } else {
            saveRow.style.display = 'none'
        }

        modal.classList.add('show')

        const closeBtn = document.getElementById('closeResultsBtn')
        const closeX = document.getElementById('closeResultsModal')
        const closeModal = () => {
            modal.classList.remove('show')
            document.getElementById('skyView').style.display = 'block'
            skyViewImage.src = ''
            skyViewLoading.textContent = 'Generating sky view...'
        }
        closeBtn.onclick = closeModal
        closeX.onclick = closeModal
        modal.onclick = (e) => { if (e.target === modal) closeModal() }
    }

    async saveToGallery() {
        if (!this.lastAnalysis) return
        const saveBtn = document.getElementById('saveGalleryBtn')
        const titleInput = document.getElementById('galleryTitleInput')
        const title = titleInput.value.trim() || deriveDefaultTitle(this.lastAnalysis.text)
        saveBtn.disabled = true
        saveBtn.textContent = 'Saving...'
        try {
            const creators = Array.from(this.participants.values()).map((p) => p.name)
            const res = await fetch('/api/gallery/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomId: this.roomId,
                    title,
                    story: this.lastAnalysis.text,
                    skyViewImage: this.lastAnalysis.skyViewImageB64,
                    strokes: this.lastAnalysis.strokesSnapshot,
                    creators,
                }),
            })
            const data = await res.json()
            if (res.ok && data.id) {
                saveBtn.textContent = 'Saved!'
                this.showNotification('Saved to gallery')
            } else {
                saveBtn.disabled = false
                saveBtn.textContent = 'Save to Gallery'
                this.showNotification(data.error || 'Failed to save')
            }
        } catch (err) {
            saveBtn.disabled = false
            saveBtn.textContent = 'Save to Gallery'
            this.showNotification('Failed to save')
        }
    }

    updateParticipantsList() {
        const list = document.getElementById('participantsList')
        list.innerHTML = ''
        this.participants.forEach((participant, id) => {
            const item = document.createElement('li')
            item.className = 'participant-item'
            const colorSwatch = document.createElement('div')
            colorSwatch.className = 'participant-color'
            colorSwatch.style.backgroundColor = participant.color
            const name = document.createElement('span')
            name.className = 'participant-name'
            if (id === this.userId) name.className += ' is-you'
            name.textContent = participant.name
            item.appendChild(colorSwatch)
            item.appendChild(name)
            list.appendChild(item)
        })
    }

    updateRoomInfo() {
        document.getElementById('roomId').textContent = this.roomId
    }

    copyRoomLink() {
        const url = window.location.href
        navigator.clipboard.writeText(url).then(() => {
            this.showNotification('Room link copied!')
        }).catch(() => {
            this.showNotification('Failed to copy link')
        })
    }

    downloadImage(dataUrl) {
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `constellation-${this.roomId}-${Date.now()}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        this.showNotification('Image downloaded!')
    }

    showNotification(message, duration = 3000) {
        const notification = document.getElementById('notification')
        notification.textContent = message
        notification.classList.add('show')
        setTimeout(() => notification.classList.remove('show'), duration)
    }
}

function deriveDefaultTitle(analysis) {
    if (!analysis) return 'Untitled Constellation'
    // Try to pick a line that looks like a constellation name.
    const nameLine = analysis
        .split('\n')
        .map((s) => s.trim())
        .find((s) => /constellation name/i.test(s))
    if (nameLine) {
        const parts = nameLine.split(/[:\-–]/)
        if (parts.length > 1) return parts.slice(1).join(':').trim().slice(0, 80) || 'Untitled Constellation'
    }
    const firstSentence = analysis.replace(/\s+/g, ' ').trim().split('.').shift() || 'Untitled Constellation'
    return firstSentence.slice(0, 80)
}

document.addEventListener('DOMContentLoaded', () => {
    new DrawingApp()
})
