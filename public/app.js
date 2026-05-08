class DrawingApp {
    constructor() {
        this.canvas = document.getElementById('drawingCanvas')
        this.ctx = this.canvas.getContext('2d')
        this.cursorLayer = document.getElementById('cursorLayer')
        this.reactionsLayer = document.getElementById('reactionsLayer')
        this.socket = null
        this.userId = null
        this.userName = null
        this.userColor = null
        this.roomId = this.getRoomId()
        this.participants = new Map()
        this.lines = []
        this.cursors = new Map()
        this.lastCursorSend = 0
        this.lastAnalysis = null

        this.isDrawing = false
        this.lastPoint = null

        this.init()
    }

    getRoomId() {
        const params = new URLSearchParams(window.location.search)
        let roomId = params.get('room')
        if (!roomId) {
            roomId = Math.random().toString(36).substring(2, 8)
            const newUrl = `${window.location.pathname}?room=${roomId}`
            window.history.replaceState({}, '', newUrl)
        }
        return roomId
    }

    init() {
        this.setupCanvas()
        this.setupEventListeners()
        this.updateRoomInfo()
        this.loadDailyPrompt()
        this.showNameModal()
        this.startCursorCleanupLoop()
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
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this))
        this.canvas.addEventListener('mouseup', this.stopDrawing.bind(this))
        this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this))

        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false })
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false })
        this.canvas.addEventListener('touchend', this.stopDrawing.bind(this))
        this.canvas.addEventListener('touchcancel', this.stopDrawing.bind(this))

        document.getElementById('clearBtn').addEventListener('click', () => this.clearCanvas())
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyzeDrawing())
        document.getElementById('copyBtn').addEventListener('click', () => this.copyRoomLink())
        document.getElementById('saveBtn').addEventListener('click', () => this.saveConstellation())

        document.querySelectorAll('.reaction-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.sendReaction(btn.dataset.emoji))
        })

        const nameInput = document.getElementById('nameInput')
        const joinBtn = document.getElementById('joinBtn')
        const join = () => {
            const name = nameInput.value.trim()
            if (name) {
                this.userName = name
                this.joinRoom()
            }
        }
        joinBtn.addEventListener('click', join)
        nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') join() })
    }

    async loadDailyPrompt() {
        try {
            const res = await fetch('/api/daily-prompt')
            const data = await res.json()
            const el = document.getElementById('promptText')
            if (el && data.prompt) el.textContent = data.prompt
        } catch (_) {
            document.getElementById('promptText').textContent = 'Draw something wonderful'
        }
    }

    pointFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect()
        const src = e.touches ? e.touches[0] : e
        return {
            x: src.clientX - rect.left,
            y: src.clientY - rect.top,
        }
    }

    startDrawing(e) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        this.isDrawing = true
        this.lastPoint = this.pointFromEvent(e)
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    onMouseMove(e) {
        const point = this.pointFromEvent(e)
        this.sendCursor(point)
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        this.drawLine(this.lastPoint, point, this.userColor)
        this.lines.push({ from: this.lastPoint, to: point, color: this.userColor, userId: this.userId })
        this.socket.send(JSON.stringify({ type: 'draw_line', from: this.lastPoint, to: point }))
        this.lastPoint = point
    }

    onMouseLeave() {
        this.stopDrawing()
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'cursor_leave' }))
        }
    }

    stopDrawing() {
        this.isDrawing = false
        this.lastPoint = null
    }

    handleTouchStart(e) {
        e.preventDefault()
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        this.isDrawing = true
        this.lastPoint = this.pointFromEvent(e)
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    handleTouchMove(e) {
        e.preventDefault()
        const point = this.pointFromEvent(e)
        this.sendCursor(point)
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        this.drawLine(this.lastPoint, point, this.userColor)
        this.lines.push({ from: this.lastPoint, to: point, color: this.userColor, userId: this.userId })
        this.socket.send(JSON.stringify({ type: 'draw_line', from: this.lastPoint, to: point }))
        this.lastPoint = point
    }

    sendCursor(point) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        const now = performance.now()
        if (now - this.lastCursorSend < 40) return
        this.lastCursorSend = now
        const nx = point.x / this.canvas.width
        const ny = point.y / this.canvas.height
        this.socket.send(JSON.stringify({ type: 'cursor_move', x: nx, y: ny }))
    }

    sendReaction(emoji) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        const rect = this.canvas.getBoundingClientRect()
        const x = (rect.width * (0.3 + Math.random() * 0.4)) / rect.width
        const y = 0.9
        this.spawnReaction(emoji, x, y, true)
        this.socket.send(JSON.stringify({ type: 'reaction', emoji, x, y }))
    }

    spawnReaction(emoji, nx, ny, isSelf) {
        const el = document.createElement('div')
        el.className = 'floating-reaction' + (isSelf ? ' self' : '')
        el.textContent = emoji
        el.style.left = `${nx * 100}%`
        el.style.top = `${ny * 100}%`
        const drift = (Math.random() * 80 - 40) | 0
        el.style.setProperty('--drift', `${drift}px`)
        this.reactionsLayer.appendChild(el)
        setTimeout(() => el.remove(), 2400)
    }

    showNameModal() {
        document.getElementById('nameModal').classList.add('show')
        document.getElementById('nameInput').focus()
    }

    hideNameModal() {
        document.getElementById('nameModal').classList.remove('show')
    }

    joinRoom() {
        this.hideNameModal()
        this.connectWebSocket()
    }

    connectWebSocket() {
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/room/${this.roomId}/websocket`
        this.socket = new WebSocket(wsUrl)

        this.socket.onopen = () => {
            this.socket.send(JSON.stringify({ type: 'join', name: this.userName }))
            this.showNotification('Connected to room!')
        }
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data)
            this.handleWebSocketMessage(message)
        }
        this.socket.onclose = () => {
            this.showNotification('Disconnected. Refreshing…')
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
                this.lines = message.lines || []
                this.updateParticipantsList()
                this.redrawCanvas()
                break
            case 'user_joined':
                this.participants.set(message.userId, { name: message.name, color: message.color })
                this.updateParticipantsList()
                this.showNotification(`${message.name} joined`)
                break
            case 'user_left': {
                const leftUser = this.participants.get(message.userId)
                if (leftUser) {
                    this.showNotification(`${leftUser.name} left`)
                    this.participants.delete(message.userId)
                    this.updateParticipantsList()
                }
                this.removeCursor(message.userId)
                break
            }
            case 'line_drawn':
                this.lines.push({ from: message.from, to: message.to, color: message.color, userId: message.userId })
                this.drawLine(message.from, message.to, message.color)
                break
            case 'canvas_cleared':
                this.lines = []
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                this.showNotification('Canvas cleared')
                break
            case 'cursor_update':
                this.updateRemoteCursor(message)
                break
            case 'cursor_gone':
                this.removeCursor(message.userId)
                break
            case 'reaction_sent':
                if (message.userId !== this.userId) {
                    this.spawnReaction(message.emoji, message.x, message.y, false)
                }
                break
            case 'constellation_saved':
                if (message.by) {
                    this.showNotification(`${message.by} saved "${message.name}" to the gallery`)
                }
                break
        }
    }

    updateRemoteCursor(msg) {
        if (msg.userId === this.userId) return
        let node = this.cursors.get(msg.userId)
        if (!node) {
            node = document.createElement('div')
            node.className = 'remote-cursor'
            node.innerHTML = `<div class="remote-cursor-dot"></div><div class="remote-cursor-label"></div>`
            this.cursorLayer.appendChild(node)
            this.cursors.set(msg.userId, node)
        }
        const x = msg.x * this.canvas.width
        const y = msg.y * this.canvas.height
        node.style.transform = `translate(${x}px, ${y}px)`
        node.querySelector('.remote-cursor-dot').style.background = msg.color
        const label = node.querySelector('.remote-cursor-label')
        label.textContent = msg.name
        label.style.background = msg.color
        node.dataset.seenAt = String(Date.now())
    }

    removeCursor(userId) {
        const node = this.cursors.get(userId)
        if (node) {
            node.remove()
            this.cursors.delete(userId)
        }
    }

    startCursorCleanupLoop() {
        setInterval(() => {
            const now = Date.now()
            this.cursors.forEach((node, id) => {
                const seen = Number(node.dataset.seenAt || 0)
                if (now - seen > 3000) {
                    node.remove()
                    this.cursors.delete(id)
                }
            })
        }, 1000)
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
        btnText.textContent = 'Reading the stars…'

        const imageData = this.canvas.toDataURL('image/png')

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData }),
            })
            const result = await response.json()
            this.lastAnalysis = result
            this.showResultsModal(result)
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

    showResultsModal(result) {
        const modal = document.getElementById('resultsModal')
        const skyView = document.getElementById('skyView')
        const skyViewImage = document.getElementById('skyViewImage')
        const skyViewLoading = document.getElementById('skyViewLoading')
        const downloadBtn = document.getElementById('downloadBtn')
        const saveBtn = document.getElementById('saveBtn')
        const nameInput = document.getElementById('constellationNameInput')
        const storyText = document.getElementById('storyText')
        const storyCard = document.getElementById('storyCard')

        nameInput.value = result?.name || 'The Unnamed One'
        if (result?.story) {
            storyText.textContent = result.story
            storyCard.style.display = 'flex'
        } else {
            storyCard.style.display = 'none'
        }

        saveBtn.disabled = false
        saveBtn.textContent = 'Save to Gallery'
        skyView.style.display = 'block'

        if (result?.skyView?.image) {
            skyViewLoading.style.display = 'block'
            skyViewImage.style.display = 'none'
            downloadBtn.style.display = 'none'
            skyViewImage.src = `data:image/png;base64,${result.skyView.image}`
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
            skyViewLoading.textContent = 'Sky view unavailable'
            downloadBtn.style.display = 'none'
        }

        modal.classList.add('show')

        const closeBtn = document.getElementById('closeResultsBtn')
        const closeX = document.getElementById('closeResultsModal')
        const closeModal = () => {
            modal.classList.remove('show')
            skyViewImage.src = ''
            skyViewLoading.style.display = 'block'
            skyViewLoading.textContent = 'Generating sky view…'
        }
        closeBtn.onclick = closeModal
        closeX.onclick = closeModal
        modal.onclick = (e) => { if (e.target === modal) closeModal() }
    }

    async saveConstellation() {
        const saveBtn = document.getElementById('saveBtn')
        const nameInput = document.getElementById('constellationNameInput')
        const storyText = document.getElementById('storyText')
        const skyViewImage = document.getElementById('skyViewImage')

        const name = nameInput.value.trim()
        if (!name) {
            this.showNotification('Give it a name first')
            return
        }

        saveBtn.disabled = true
        saveBtn.textContent = 'Saving…'

        let image = null
        if (skyViewImage.src && skyViewImage.src.startsWith('data:image')) {
            image = skyViewImage.src.replace(/^data:image\/[a-z]+;base64,/, '')
        }

        try {
            const res = await fetch('/api/constellation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomId: this.roomId,
                    name,
                    story: storyText.textContent || '',
                    author: this.userName,
                    image,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || 'Save failed')

            saveBtn.textContent = 'Saved ✓'
            this.showNotification('Saved to gallery!')

            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'constellation_saved',
                    id: data.id,
                    name: data.name,
                }))
            }
        } catch (e) {
            console.error(e)
            this.showNotification('Save failed')
            saveBtn.disabled = false
            saveBtn.textContent = 'Save to Gallery'
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
            name.className = 'participant-name' + (id === this.userId ? ' is-you' : '')
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
        clearTimeout(this._notificationTimeout)
        this._notificationTimeout = setTimeout(() => {
            notification.classList.remove('show')
        }, duration)
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DrawingApp()
})
