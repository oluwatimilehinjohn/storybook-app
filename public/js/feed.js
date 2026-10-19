(() => {
    'use strict'
    const feed = document.querySelector('[data-feed]')
    if (!feed) return
    const stream = feed.querySelector('[data-feed-items]')
    const pagination = feed.querySelector('[data-feed-pagination]')
    const status = feed.querySelector('[data-feed-status]')
    const enableSharing = () => {
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            feed.querySelectorAll('[data-share-story]').forEach(button => { button.hidden = false })
        }
    }
    enableSharing()
    feed.addEventListener('click', async event => {
        const button = event.target.closest('[data-share-story]')
        if (!button) return
        try {
            await navigator.clipboard.writeText(new URL(button.dataset.shareStory, location.origin).href)
            status.textContent = 'Story link copied. You can paste it into a message.'
            button.querySelector('span').textContent = 'Copied'
            setTimeout(() => { button.querySelector('span').textContent = 'Share' }, 2500)
        } catch {
            status.textContent = 'The link could not be copied. Open the story and copy its address from your browser.'
        }
    })
    if (!stream || !pagination) return
    let loading = false
    let automaticLoads = 0
    let controller
    const seen = new Set([...stream.querySelectorAll('[data-feed-story]')].map(story => story.dataset.feedStory))
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && automaticLoads < 2) loadMore(false)
    }, { rootMargin: '0px 0px 200px 0px' }) : null
    const watchNext = () => {
        observer?.disconnect()
        const next = pagination.querySelector('[data-feed-next]')
        if (next && automaticLoads < 2) observer?.observe(next)
    }
    async function loadMore(manual) {
        const next = pagination.querySelector('[data-feed-next]')
        if (loading || !next) return
        loading = true
        observer?.disconnect()
        stream.setAttribute('aria-busy', 'true')
        next.setAttribute('aria-disabled', 'true')
        next.textContent = 'Loading stories…'
        status.textContent = 'Loading more stories.'
        controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        try {
            const response = await fetch(next.href, { signal: controller.signal, credentials: 'same-origin' })
            if (response.redirected) throw new Error('Your session may have ended. Refresh the page to sign in again.')
            if (!response.ok) throw new Error('More stories could not load. Try again using More stories.')
            const page = new DOMParser().parseFromString(await response.text(), 'text/html')
            const newStream = page.querySelector('[data-feed-items]')
            const newPagination = page.querySelector('[data-feed-pagination]')
            if (!newStream || !newPagination) throw new Error('More stories could not load. Please refresh the page.')
            let first
            let count = 0
            newStream.querySelectorAll('[data-feed-story]').forEach(story => {
                if (seen.has(story.dataset.feedStory)) return
                seen.add(story.dataset.feedStory)
                const node = document.importNode(story, true)
                stream.appendChild(node)
                first ||= node
                count++
            })
            pagination.replaceChildren(...[...newPagination.childNodes].map(node => document.importNode(node, true)))
            if (!pagination.querySelector('[data-feed-next]') && !pagination.textContent.trim()) pagination.textContent = 'You’re all caught up.'
            status.textContent = count ? `${count} more stories loaded.` : 'You’re all caught up.'
            enableSharing()
            if (manual) {
                if (first) first.querySelector('h2').focus({ preventScroll: true })
                else { status.tabIndex = -1; status.focus({ preventScroll: true }) }
            } else automaticLoads++
        } catch (error) {
            automaticLoads = 2 // Leave a deliberate retry instead of an automatic retry loop.
            next.removeAttribute('aria-disabled')
            next.textContent = 'More stories'
            status.textContent = error.name === 'AbortError' ? 'Loading took too long. Try again using More stories.' :
                error instanceof TypeError ? 'More stories could not load. Check your connection and try More stories again.' : error.message
        } finally {
            clearTimeout(timeout)
            loading = false
            stream.setAttribute('aria-busy', 'false')
            watchNext()
        }
    }
    pagination.addEventListener('click', event => {
        if (!event.target.closest('[data-feed-next]') || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        loadMore(true)
    })
    window.addEventListener('pagehide', () => { observer?.disconnect(); controller?.abort() })
    window.addEventListener('pageshow', watchNext)
    watchNext()
})()
