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
            const newUrl = `${window.location.pathname}?room=${roomId}`
            window.history.replaceState({}, '', newUrl)
        }
        
        return roomId
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
        // Mouse events
        this.canvas.addEventListener('mousedown', this.startDrawing.bind(this))
        this.canvas.addEventListener('mousemove', this.draw.bind(this))
        this.canvas.addEventListener('mouseup', this.stopDrawing.bind(this))
        this.canvas.addEventListener('mouseleave', this.stopDrawing.bind(this))
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false })
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false })
        this.canvas.addEventListener('touchend', this.stopDrawing.bind(this))
        this.canvas.addEventListener('touchcancel', this.stopDrawing.bind(this))
        
        // Buttons
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearCanvas()
        })
        
        document.getElementById('analyzeBtn').addEventListener('click', () => {
            this.analyzeDrawing()
        })
        
        document.getElementById('copyBtn').addEventListener('click', () => {
            this.copyRoomLink()
        })
        
        // Remove stop drawing button as we don't need it anymore
        const stopBtn = document.getElementById('stopDrawingBtn')
        if (stopBtn) stopBtn.style.display = 'none'
        
        // Name modal
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
    }

    startDrawing(e) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        
        this.isDrawing = true
        const rect = this.canvas.getBoundingClientRect()
        this.lastPoint = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        }
        
        // Hide instruction
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    draw(e) {
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        
        const rect = this.canvas.getBoundingClientRect()
        const currentPoint = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        }
        
        // Draw the line locally
        this.drawLine(this.lastPoint, currentPoint, this.userColor)
        
        // Store line locally
        const line = {
            from: this.lastPoint,
            to: currentPoint,
            color: this.userColor,
            userId: this.userId
        }
        this.lines.push(line)
        
        // Send to server
        this.socket.send(JSON.stringify({
            type: 'draw_line',
            from: this.lastPoint,
            to: currentPoint
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
        this.lastPoint = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        }
        
        document.getElementById('drawingInstruction').classList.add('hidden')
    }

    handleTouchMove(e) {
        e.preventDefault()
        if (!this.isDrawing || !this.lastPoint) return
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
        
        const touch = e.touches[0]
        const rect = this.canvas.getBoundingClientRect()
        const currentPoint = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        }
        
        // Draw the line locally
        this.drawLine(this.lastPoint, currentPoint, this.userColor)
        
        // Store line locally
        const line = {
            from: this.lastPoint,
            to: currentPoint,
            color: this.userColor,
            userId: this.userId
        }
        this.lines.push(line)
        
        // Send to server
        this.socket.send(JSON.stringify({
            type: 'draw_line',
            from: this.lastPoint,
            to: currentPoint
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

    joinRoom() {
        this.hideNameModal()
        this.connectWebSocket()
    }

    connectWebSocket() {
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/room/${this.roomId}/websocket`
        
        this.socket = new WebSocket(wsUrl)
        
        this.socket.onopen = () => {
            // Send join message with user name
            this.socket.send(JSON.stringify({
                type: 'join',
                name: this.userName
            }))
            this.showNotification('Connected to room!')
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
                this.lines = message.lines || []
                this.updateParticipantsList()
                this.redrawCanvas()
                break
                
            case 'user_joined':
                this.participants.set(message.userId, {
                    name: message.name,
                    color: message.color
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
                    userId: message.userId
                })
                this.drawLine(message.from, message.to, message.color)
                break
                
            case 'canvas_cleared':
                this.lines = []
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                this.showNotification('Canvas cleared')
                break
                
            case 'constellation_found':
                if (message.result) {
                    this.showResultsModal(message.result)
                }
                break
        }
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
        this.lines.forEach(line => {
            this.drawLine(line.from, line.to, line.color)
        })
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
        
        // Show loading state
        analyzeBtn.classList.add('loading')
        analyzeBtn.disabled = true
        btnIcon.style.display = 'none'
        btnSpinner.style.display = 'block'
        btnText.textContent = 'Creating Constellation...'
        
        const imageData = this.canvas.toDataURL('image/png')
        
        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ imageData })
            })
            
            const result = await response.json()
            
            if (result.result) {
                let analysisText = ''
                
                // Handle different response formats from AI
                if (typeof result.result === 'object') {
                    if (result.result.response) {
                        analysisText = result.result.response
                    } else if (result.result.description) {
                        analysisText = result.result.description
                    } else if (result.result.text) {
                        analysisText = result.result.text
                    } else {
                        // If it's an object but we don't know the structure, try to get the first string value
                        analysisText = Object.values(result.result).find(val => typeof val === 'string') || 'Analysis complete'
                    }
                } else if (typeof result.result === 'string') {
                    analysisText = result.result
                } else {
                    analysisText = 'Analysis complete'
                }
                
                // Show modal with results and sky view
                this.showResultsModal(analysisText, result.skyView, result.shareId)
                
                // Broadcast to other users (without the image to save bandwidth)
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    // this.socket.send(JSON.stringify({
                    //     type: 'analyze_result',
                    //     result: analysisText
                    // }))
                }
            } else {
                this.showResultsModal('No pattern detected in the drawing.')
            }
        } catch (error) {
            console.error('Analysis error:', error)
            this.showNotification('Analysis failed')
        } finally {
            // Reset button state
            analyzeBtn.classList.remove('loading')
            analyzeBtn.disabled = false
            btnIcon.style.display = 'block'
            btnSpinner.style.display = 'none'
            btnText.textContent = 'Create Constellation'
        }
    }
    
    showResultsModal(text, skyView = null, shareId = null) {
        const modal = document.getElementById('resultsModal')
        const skyViewImage = document.getElementById('skyViewImage')
        const skyViewLoading = document.getElementById('skyViewLoading')
        const downloadBtn = document.getElementById('downloadBtn')
        const shareBtn = document.getElementById('shareBtn')

        shareBtn.style.display = 'none'

        // Handle sky view image if present
        if (skyView) {
            skyViewLoading.style.display = 'block'
            skyViewImage.style.display = 'none'
            downloadBtn.style.display = 'none'

            // The skyView response should contain image data
            if (skyView.image) {
                // Convert the image data to base64 if needed
                const imageData = skyView.image
                skyViewImage.src = `data:image/png;base64,${imageData}`
                skyViewImage.onload = () => {
                    skyViewLoading.style.display = 'none'
                    skyViewImage.style.display = 'block'
                    downloadBtn.style.display = 'inline-flex'

                    // Setup download functionality
                    downloadBtn.onclick = () => {
                        this.downloadImage(skyViewImage.src)
                    }

                    if (shareId) {
                        shareBtn.style.display = 'inline-flex'
                        shareBtn.onclick = () => this.shareConstellation(shareId, text)
                    }
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
        
        modal.classList.add('show')
        
        // Setup close handlers
        const closeBtn = document.getElementById('closeResultsBtn')
        const closeX = document.getElementById('closeResultsModal')
        
        const closeModal = () => {
            modal.classList.remove('show')
            // Reset sky view for next time
            document.getElementById('skyView').style.display = 'block'
            skyViewImage.src = ''
            skyViewLoading.textContent = 'Generating sky view...'
        }
        
        closeBtn.onclick = closeModal
        closeX.onclick = closeModal
        
        // Close on background click
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeModal()
            }
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
            if (id === this.userId) {
                name.className += ' is-you'
            }
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

    async shareConstellation(shareId, story) {
        const shareUrl = `${window.location.origin}/c/${shareId}`
        const shareData = {
            title: 'A Collaborative Constellation',
            text: story ? story.slice(0, 180) : 'Check out the constellation we drew together!',
            url: shareUrl
        }

        if (navigator.share) {
            try {
                await navigator.share(shareData)
                return
            } catch (err) {
                if (err && err.name === 'AbortError') return
            }
        }

        try {
            await navigator.clipboard.writeText(shareUrl)
            this.showNotification('Share link copied!')
        } catch {
            window.prompt('Copy this link to share:', shareUrl)
        }
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
        
        setTimeout(() => {
            notification.classList.remove('show')
        }, duration)
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DrawingApp()
})