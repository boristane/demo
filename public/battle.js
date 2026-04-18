class BattleLobby {
    constructor() {
        this.currentBattle = null
        this.pollTimer = null
        this.init()
    }

    init() {
        document.getElementById('createBattleBtn').addEventListener('click', () => this.createBattle())
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadBattles()
            this.loadLeaderboard()
        })
        document.getElementById('battleClose').addEventListener('click', () => this.closeModal())
        document.getElementById('battleModal').addEventListener('click', (e) => {
            if (e.target.id === 'battleModal') this.closeModal()
        })
        document.getElementById('joinDrawBtn').addEventListener('click', () => this.joinDraw())

        this.loadBattles()
        this.loadLeaderboard()
    }

    async createBattle() {
        const promptEl = document.getElementById('promptInput')
        const durationEl = document.getElementById('durationSelect')
        const btn = document.getElementById('createBattleBtn')
        btn.disabled = true
        try {
            const res = await fetch('/api/battles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: promptEl.value.trim() || undefined,
                    durationSeconds: parseInt(durationEl.value, 10),
                }),
            })
            const data = await res.json()
            if (data.id) {
                this.notify(`Battle #${data.id} created`)
                promptEl.value = ''
                this.loadBattles()
            } else {
                this.notify(data.error || 'Failed to create battle')
            }
        } catch (err) {
            this.notify('Failed to create battle')
        } finally {
            btn.disabled = false
        }
    }

    async loadBattles() {
        try {
            const res = await fetch('/api/battles')
            const data = await res.json()
            const list = document.getElementById('battleList')
            list.innerHTML = ''
            const items = data.items || []
            if (!items.length) {
                document.getElementById('battleEmpty').style.display = 'block'
                return
            }
            document.getElementById('battleEmpty').style.display = 'none'
            items.forEach((b) => list.appendChild(this.renderBattleCard(b)))
        } catch (err) {
            this.notify('Failed to load battles')
        }
    }

    renderBattleCard(b) {
        const card = document.createElement('article')
        card.className = `battle-card battle-status-${b.status}`
        const timeText = b.status === 'open'
            ? (b.timeRemaining > 0 ? `${formatDuration(b.timeRemaining)} left` : 'Finalizing...')
            : (b.status === 'complete' ? 'Complete' : 'Judging')
        card.innerHTML = `
            <div class="battle-card-header">
                <span class="battle-card-status">${b.status.toUpperCase()}</span>
                <span class="battle-card-time">${timeText}</span>
            </div>
            <h3 class="battle-card-prompt">"${escapeHtml(b.prompt)}"</h3>
            <div class="battle-card-meta">${b.entryCount} ${b.entryCount === 1 ? 'entry' : 'entries'} • ${formatDuration(b.durationSeconds)} round</div>
            <div class="battle-card-actions">
                <button class="btn btn-primary">View / Join</button>
            </div>
        `
        card.querySelector('button').addEventListener('click', () => this.openBattle(b.id))
        return card
    }

    async openBattle(id) {
        try {
            const res = await fetch(`/api/battles/${id}`)
            if (!res.ok) throw new Error('not found')
            const battle = await res.json()
            this.currentBattle = battle
            this.renderBattleDetail(battle)
            document.getElementById('battleModal').classList.add('show')

            if (battle.status === 'open' && battle.timeRemaining > 0) {
                this.startPolling(id)
            }
        } catch (err) {
            this.notify('Failed to load battle')
        }
    }

    renderBattleDetail(battle) {
        document.getElementById('battleModalTitle').textContent = `Battle #${battle.id}`
        document.getElementById('battleModalPrompt').textContent = `"${battle.prompt}"`
        const metaParts = [
            battle.status === 'open' ? `${formatDuration(battle.timeRemaining)} remaining` : battle.status,
            `${formatDuration(battle.durationSeconds)} round`,
            `${battle.entries.length} ${battle.entries.length === 1 ? 'entry' : 'entries'}`,
        ]
        document.getElementById('battleModalMeta').textContent = metaParts.join(' • ')

        const entriesEl = document.getElementById('battleEntries')
        entriesEl.innerHTML = ''
        const sorted = [...battle.entries].sort((a, b) => (b.score || 0) - (a.score || 0))
        sorted.forEach((e, idx) => {
            const row = document.createElement('div')
            const isWinner = battle.winnerEntryId === e.id
            row.className = `battle-entry ${isWinner ? 'is-winner' : ''}`
            row.innerHTML = `
                <div class="battle-entry-rank">#${idx + 1}</div>
                <img class="battle-entry-image" src="/api/battles/${battle.id}/entries/${e.id}/image" alt="Entry by ${escapeHtml(e.teamName)}" loading="lazy">
                <div class="battle-entry-body">
                    <div class="battle-entry-header">
                        <strong>${escapeHtml(e.teamName)}</strong>
                        <span class="battle-entry-score">${e.score}</span>
                    </div>
                    <p class="battle-entry-feedback">${escapeHtml(e.feedback || '')}</p>
                    ${isWinner ? '<span class="battle-entry-crown">Winner</span>' : ''}
                </div>
            `
            entriesEl.appendChild(row)
        })

        const joinBtn = document.getElementById('joinDrawBtn')
        joinBtn.style.display = battle.status === 'open' && battle.timeRemaining > 0 ? 'inline-flex' : 'none'
    }

    startPolling(id) {
        this.stopPolling()
        this.pollTimer = setInterval(async () => {
            try {
                const res = await fetch(`/api/battles/${id}`)
                const battle = await res.json()
                this.currentBattle = battle
                this.renderBattleDetail(battle)
                if (battle.status !== 'open' || battle.timeRemaining <= 0) {
                    this.stopPolling()
                    this.loadBattles()
                    this.loadLeaderboard()
                }
            } catch {}
        }, 5000)
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer)
            this.pollTimer = null
        }
    }

    joinDraw() {
        if (!this.currentBattle) return
        const roomId = Math.random().toString(36).slice(2, 8)
        const params = new URLSearchParams({
            room: roomId,
            battle: String(this.currentBattle.id),
        })
        window.location.href = `/?${params}`
    }

    closeModal() {
        document.getElementById('battleModal').classList.remove('show')
        this.stopPolling()
    }

    async loadLeaderboard() {
        try {
            const res = await fetch('/api/leaderboard')
            const data = await res.json()
            const body = document.getElementById('leaderboardBody')
            const empty = document.getElementById('leaderboardEmpty')
            body.innerHTML = ''
            const items = data.items || []
            if (!items.length) {
                empty.style.display = 'block'
                document.getElementById('leaderboardTable').style.display = 'none'
                return
            }
            empty.style.display = 'none'
            document.getElementById('leaderboardTable').style.display = 'table'
            items.forEach((row) => {
                const tr = document.createElement('tr')
                tr.innerHTML = `
                    <td>${escapeHtml(row.teamName)}</td>
                    <td>${row.wins}</td>
                    <td>${row.battlesPlayed}</td>
                    <td>${row.avgScore}</td>
                    <td>${row.bestScore}</td>
                `
                body.appendChild(tr)
            })
        } catch (err) {
            // ignore
        }
    }

    notify(msg) {
        const n = document.getElementById('notification')
        n.textContent = msg
        n.classList.add('show')
        setTimeout(() => n.classList.remove('show'), 2500)
    }
}

function formatDuration(totalSec) {
    const s = Math.max(0, Math.floor(totalSec))
    const m = Math.floor(s / 60)
    const r = s % 60
    if (m === 0) return `${r}s`
    if (r === 0) return `${m}m`
    return `${m}m ${r}s`
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    )
}

document.addEventListener('DOMContentLoaded', () => new BattleLobby())
