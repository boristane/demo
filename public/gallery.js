async function loadGallery() {
    const grid = document.getElementById('galleryGrid')
    const empty = document.getElementById('galleryEmpty')

    try {
        const res = await fetch('/api/gallery')
        const data = await res.json()
        const items = data.items || []

        if (items.length === 0) {
            empty.style.display = 'block'
            return
        }

        items.forEach((item) => {
            const card = document.createElement('div')
            card.className = 'gallery-card'

            const imageWrap = document.createElement('div')
            imageWrap.className = 'gallery-card-image'
            imageWrap.textContent = 'loading…'

            const body = document.createElement('div')
            body.className = 'gallery-card-body'
            body.innerHTML = `
                <div class="gallery-card-name"></div>
                <div class="gallery-card-meta"></div>
                <div class="gallery-card-story"></div>
            `
            body.querySelector('.gallery-card-name').textContent = item.name
            const when = item.created_at ? new Date(item.created_at + 'Z').toLocaleDateString() : ''
            body.querySelector('.gallery-card-meta').textContent = `${item.author || 'Anonymous'} · ${when}`
            body.querySelector('.gallery-card-story').textContent = item.story || ''

            card.appendChild(imageWrap)
            card.appendChild(body)
            grid.appendChild(card)

            card.addEventListener('click', () => openDetail(item))

            if (item.has_image) {
                loadImage(item.id).then((src) => {
                    if (src) {
                        const img = document.createElement('img')
                        img.src = src
                        img.alt = item.name
                        imageWrap.textContent = ''
                        imageWrap.appendChild(img)
                    } else {
                        imageWrap.textContent = '✦'
                    }
                })
            } else {
                imageWrap.textContent = '✦'
            }
        })
    } catch (e) {
        console.error(e)
        empty.textContent = 'Failed to load gallery.'
        empty.style.display = 'block'
    }
}

const imageCache = new Map()
async function loadImage(id) {
    if (imageCache.has(id)) return imageCache.get(id)
    try {
        const res = await fetch(`/api/gallery/${id}/image`)
        if (!res.ok) return null
        const data = await res.json()
        const src = `data:image/png;base64,${data.image}`
        imageCache.set(id, src)
        return src
    } catch (_) {
        return null
    }
}

async function openDetail(item) {
    const modal = document.getElementById('detailModal')
    const nameEl = document.getElementById('detailName')
    const storyEl = document.getElementById('detailStory')
    const storyCard = document.getElementById('detailStoryCard')
    const img = document.getElementById('detailImage')
    const loading = document.getElementById('detailLoading')

    nameEl.textContent = item.name
    if (item.story) {
        storyEl.textContent = item.story
        storyCard.style.display = 'flex'
    } else {
        storyCard.style.display = 'none'
    }
    img.style.display = 'none'
    img.src = ''
    loading.style.display = 'block'
    loading.textContent = 'Loading…'

    modal.classList.add('show')

    if (item.has_image) {
        const src = await loadImage(item.id)
        if (src) {
            img.src = src
            img.onload = () => {
                loading.style.display = 'none'
                img.style.display = 'block'
            }
        } else {
            loading.textContent = 'Image unavailable'
        }
    } else {
        loading.textContent = 'No sky view for this one'
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadGallery()

    const modal = document.getElementById('detailModal')
    const close = () => modal.classList.remove('show')
    document.getElementById('closeDetailModal').onclick = close
    document.getElementById('detailCloseBtn').onclick = close
    modal.addEventListener('click', (e) => { if (e.target === modal) close() })
})
