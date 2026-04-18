class Gallery {
    constructor() {
        this.grid = document.getElementById('galleryGrid')
        this.empty = document.getElementById('galleryEmpty')
        this.loadMoreBtn = document.getElementById('loadMoreBtn')
        this.sort = 'new'
        this.offset = 0
        this.limit = 24
        this.currentItem = null
        this.replayTimer = null
        this.init()
    }

    init() {
        document.querySelectorAll('.sort-tab').forEach((el) => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.sort-tab').forEach((t) => t.classList.remove('active'))
                el.classList.add('active')
                this.sort = el.dataset.sort
                this.offset = 0
                this.grid.innerHTML = ''
                this.load()
            })
        })

        this.loadMoreBtn.addEventListener('click', () => this.load())

        document.getElementById('detailClose').addEventListener('click', () => this.closeDetail())
        document.getElementById('detailModal').addEventListener('click', (e) => {
            if (e.target.id === 'detailModal') this.closeDetail()
        })
        document.getElementById('likeBtn').addEventListener('click', () => this.like())
        document.getElementById('replayBtn').addEventListener('click', () => this.replay())

        this.load()
    }

    async load() {
        try {
            const res = await fetch(`/api/gallery?sort=${this.sort}&limit=${this.limit}&offset=${this.offset}`)
            const data = await res.json()
            const items = data.items || []

            if (this.offset === 0 && items.length === 0) {
                this.empty.style.display = 'block'
                this.loadMoreBtn.style.display = 'none'
                return
            }
            this.empty.style.display = 'none'

            items.forEach((item) => this.grid.appendChild(this.renderCard(item)))
            this.offset += items.length
            this.loadMoreBtn.style.display = items.length === this.limit ? 'inline-flex' : 'none'
        } catch (err) {
            console.error(err)
            this.notify('Failed to load gallery')
        }
    }

    renderCard(item) {
        const card = document.createElement('article')
        card.className = 'gallery-card'
        card.innerHTML = `
            <div class="gallery-card-image">
                ${item.hasSkyView
                    ? `<img src="/api/gallery/${item.id}/image" alt="${escapeHtml(item.title)}" loading="lazy">`
                    : `<div class="gallery-card-placeholder">no sky view</div>`}
            </div>
            <div class="gallery-card-body">
                <h3>${escapeHtml(item.title)}</h3>
                <div class="gallery-card-meta">
                    <span>${formatDate(item.createdAt)}</span>
                    <span class="gallery-card-likes">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        ${item.likeCount}
                    </span>
                </div>
            </div>
        `
        card.addEventListener('click', () => this.openDetail(item.id))
        return card
    }

    async openDetail(id) {
        try {
            const res = await fetch(`/api/gallery/${id}`)
            if (!res.ok) throw new Error('not found')
            const item = await res.json()
            this.currentItem = item

            document.getElementById('detailTitle').textContent = item.title
            document.getElementById('detailMeta').textContent =
                `${formatDate(item.createdAt)} • Room ${item.roomId}`
            document.getElementById('detailStory').textContent = item.story || ''
            document.getElementById('likeCount').textContent = item.likeCount
            const img = document.getElementById('detailImage')
            if (item.hasSkyView) {
                img.src = `/api/gallery/${id}/image`
                img.style.display = 'block'
            } else {
                img.style.display = 'none'
            }

            const canvas = document.getElementById('replayCanvas')
            canvas.style.display = 'none'
            if (this.replayTimer) {
                clearInterval(this.replayTimer)
                this.replayTimer = null
            }

            document.getElementById('detailModal').classList.add('show')
        } catch (err) {
            console.error(err)
            this.notify('Failed to load constellation')
        }
    }

    closeDetail() {
        document.getElementById('detailModal').classList.remove('show')
        if (this.replayTimer) {
            clearInterval(this.replayTimer)
            this.replayTimer = null
        }
    }

    async like() {
        if (!this.currentItem) return
        try {
            const res = await fetch(`/api/gallery/${this.currentItem.id}/like`, { method: 'POST' })
            const data = await res.json()
            if (data.alreadyLiked) {
                this.notify('Already liked')
                return
            }
            if (typeof data.likeCount === 'number') {
                document.getElementById('likeCount').textContent = data.likeCount
                this.currentItem.likeCount = data.likeCount
            }
            this.notify('Liked!')
        } catch (err) {
            this.notify('Failed to like')
        }
    }

    replay() {
        if (!this.currentItem || !this.currentItem.strokes || !this.currentItem.strokes.length) {
            this.notify('No strokes to replay')
            return
        }
        const strokes = this.currentItem.strokes
        const image = document.getElementById('detailImage')
        const canvas = document.getElementById('replayCanvas')
        const wrap = canvas.parentElement

        canvas.width = wrap.clientWidth
        canvas.height = wrap.clientHeight
        canvas.style.display = 'block'

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Determine stroke coordinate bounds so we can scale into the canvas.
        const bounds = strokesBounds(strokes)
        const pad = 20
        const scaleX = (canvas.width - pad * 2) / Math.max(bounds.w, 1)
        const scaleY = (canvas.height - pad * 2) / Math.max(bounds.h, 1)
        const scale = Math.min(scaleX, scaleY)
        const offX = (canvas.width - bounds.w * scale) / 2 - bounds.x * scale
        const offY = (canvas.height - bounds.h * scale) / 2 - bounds.y * scale

        const startT = strokes[0].t
        const endT = strokes[strokes.length - 1].t
        const totalSpan = Math.max(1, endT - startT)
        const replayDuration = 4000 // ms
        const speed = replayDuration / totalSpan

        const replayStart = performance.now()
        let i = 0

        if (this.replayTimer) clearInterval(this.replayTimer)
        this.replayTimer = setInterval(() => {
            const now = performance.now()
            const elapsed = (now - replayStart) / speed
            while (i < strokes.length && strokes[i].t - startT <= elapsed) {
                const s = strokes[i]
                ctx.beginPath()
                ctx.moveTo(s.from.x * scale + offX, s.from.y * scale + offY)
                ctx.lineTo(s.to.x * scale + offX, s.to.y * scale + offY)
                ctx.strokeStyle = s.color
                ctx.lineWidth = 2
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'
                ctx.stroke()
                i++
            }
            if (i >= strokes.length) {
                clearInterval(this.replayTimer)
                this.replayTimer = null
                setTimeout(() => {
                    canvas.style.display = 'none'
                }, 1500)
            }
        }, 16)
    }

    notify(msg) {
        const n = document.getElementById('notification')
        n.textContent = msg
        n.classList.add('show')
        setTimeout(() => n.classList.remove('show'), 2500)
    }
}

function strokesBounds(strokes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    strokes.forEach((s) => {
        minX = Math.min(minX, s.from.x, s.to.x)
        minY = Math.min(minY, s.from.y, s.to.y)
        maxX = Math.max(maxX, s.from.x, s.to.x)
        maxY = Math.max(maxY, s.from.y, s.to.y)
    })
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function formatDate(iso) {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleString()
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    )
}

document.addEventListener('DOMContentLoaded', () => new Gallery())
