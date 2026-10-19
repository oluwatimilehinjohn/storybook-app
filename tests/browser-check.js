// Run the fixture server and a local Chrome with --remote-debugging-port=9222 first.
// Uses Node 22's WebSocket client; no browser dependency is added to the product.
const fs = require('node:fs')
const assert = require('node:assert/strict')

async function main() {
    const tabs = await (await fetch('http://127.0.0.1:9222/json')).json()
    const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let nextId = 0
    const pending = new Map()
    const errors = []
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
        if (!message.id) return
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error(message.error.message))
        else entry.resolve(message.result)
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 20000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
        return result.result.value
    }
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const visit = async path => {
        await send('Page.navigate', { url: 'http://127.0.0.1:4173' + path })
        for (let i = 0; i < 50; i++) {
            await pause(100)
            if (await evaluate('document.readyState === "complete"')) break
        }
        await evaluate('document.fonts.ready.then(() => true)')
    }
    try {
        await send('Page.enable')
        await send('Runtime.enable')
        await send('Network.enable')
        const blockedCDNs = ['*cdnjs.cloudflare.com*', '*cdn.ckeditor.com*']
        await send('Network.setBlockedURLs', { urls: blockedCDNs })
        fs.mkdirSync('.preview/verified', { recursive: true })
        const pages = [
            ['login', '/'], ['dashboard', '/dashboard'], ['discover', '/stories'],
            ['add', '/stories/add'], ['edit', '/stories/edit/507f191e810c19729de860eb'],
            ['read', '/stories/507f191e810c19729de860ea'],
            ['author', '/stories/user/507f1f77bcf86cd799439011'],
            ['empty', '/test/empty'], ['404', '/missing'], ['500', '/test/error']
        ]
        const widths = process.env.CHECK_WIDTHS ? process.env.CHECK_WIDTHS.split(',').map(Number) : [1440, 768, 390, 320]
        for (const width of widths) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
            for (const [name, path] of pages) {
                await visit(path)
                const layout = await evaluate(`({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, heading: document.querySelector('h1')?.textContent, invalidLinks: [...document.querySelectorAll('a')].filter(a => !a.getAttribute('href') || a.getAttribute('href') === '#!').length})`)
                assert.ok(layout.scrollWidth <= width + 1, name + ' overflows at ' + width + ': ' + JSON.stringify(layout))
                assert.ok(layout.heading, name + ' missing heading')
                assert.equal(layout.invalidLinks, 0, name + ' placeholder links')
                assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(248, 247, 243)', name + ' paper background')
                assert.equal(await evaluate(`document.querySelector('link[href*="/css/style.css?v="]') !== null`), true, name + ' versioned style')
                assert.equal(await evaluate(`document.fonts.check('900 16px "Font Awesome 6 Free"')`), true, name + ' local icon font')
                if ([1440, 390].includes(width)) {
                    const metrics = await send('Page.getLayoutMetrics')
                    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(2400, metrics.cssContentSize.height), scale: 1 } })
                    fs.writeFileSync('.preview/verified/' + name + '-' + width + '.png', Buffer.from(capture.data, 'base64'))
                    const filename = name + '-' + width + '.png'
                    // Discover intentionally becomes the For you feed; retain the original grid reference.
                    if (name !== 'discover' && fs.existsSync('.preview/' + filename)) {
                        const comparison = await evaluate(`(async () => {
                            const reference = await createImageBitmap(await (await fetch('/test/reference/${filename}')).blob());
                            const actual = await createImageBitmap(await (await fetch('data:image/png;base64,${capture.data}')).blob());
                            if (reference.width !== actual.width || reference.height !== actual.height) return { sizeMatch: false, reference: [reference.width, reference.height], actual: [actual.width, actual.height] };
                            const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
                            const ctx = canvas.getContext('2d'); ctx.drawImage(reference, 0, 0); const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(actual, 0, 0); const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                            let changed = 0; for (let i = 0; i < before.length; i += 4) if (Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i+1] - after[i+1]), Math.abs(before[i+2] - after[i+2])) > 40) changed++;
                            return { sizeMatch: true, changedPercent: 100 * changed / (actual.width * actual.height) };
                        })()`)
                        console.log('Visual comparison ' + filename + ': ' + JSON.stringify(comparison))
                        assert.equal(comparison.sizeMatch, true, filename + ' dimensions match the preview')
                        assert.ok(comparison.changedPercent < 1, filename + ' differs from the preview by more than 1%')
                    }
                }
            }
            console.log('PASS: 10 pages at ' + width + 'px, no horizontal overflow')
        }
        await visit('/dashboard')
        await evaluate(`document.querySelector('[data-filter="private"]').click()`)
        assert.equal(await evaluate(`document.querySelectorAll('[data-story-item]:not([hidden])').length`), 1)
        await evaluate(`document.querySelector('[data-story-search]').value='no match'; document.querySelector('[data-story-search]').dispatchEvent(new Event('input'))`)
        assert.match(await evaluate(`document.querySelector('[data-filter-result]').textContent`), /No stories match/)
        await evaluate(`document.querySelector('[data-story-search]').value=''; document.querySelector('[data-story-search]').dispatchEvent(new Event('input')); document.querySelector('[data-filter="all"]').click(); document.querySelector('[data-delete-form] button').focus(); document.querySelector('[data-delete-form] button').click()`)
        assert.equal(await evaluate(`document.querySelector('#delete-dialog').open`), true)
        assert.equal(await evaluate(`document.activeElement.hasAttribute('data-close-dialog')`), true)
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        assert.equal(await evaluate(`document.querySelector('#delete-dialog').open`), false)
        assert.equal(await evaluate(`document.activeElement.classList.contains('delete-button')`), true)
        await evaluate(`document.querySelector('.account-menu summary').click()`)
        assert.equal(await evaluate(`document.querySelector('.account-menu').open`), true)
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        assert.equal(await evaluate(`document.querySelector('.account-menu').open`), false)
        console.log('PASS: search, visibility filter, empty results, delete dialog focus and Escape, account menu')

        await visit('/stories/add')
        for (let i = 0; i < 50; i++) {
            if (await evaluate(`Boolean(document.querySelector('.ck-editor__editable'))`)) break
            await pause(100)
        }
        assert.equal(await evaluate(`Boolean(document.querySelector('.ck-editor__editable'))`), true, 'rich text editor loads')
        await evaluate(`document.querySelector('[data-save-button]').click()`)
        assert.equal(await evaluate(`document.activeElement.id`), 'title')
        assert.equal(await evaluate(`document.querySelector('#title-error').hidden`), false)
        assert.equal(await evaluate(`document.querySelector('#body-error').hidden`), false)
        await evaluate(`document.querySelector('#status').value='private'; document.querySelector('#status').dispatchEvent(new Event('change')); document.querySelector('#title').value='Browser verification story'; document.querySelector('#title').dispatchEvent(new Event('input'))`)
        assert.match(await evaluate(`document.querySelector('[data-visibility-help]').textContent`), /Only you/)
        assert.equal(await evaluate(`(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })()`), true, 'unsaved writing warns before navigation')
        await evaluate(`document.querySelector('.ck-editor__editable').focus()`)
        await send('Input.insertText', { text: 'This is a browser test story.' })
        await evaluate(`document.querySelector('[data-save-button]').click()`)
        await pause(600)
        assert.equal(await evaluate('location.pathname'), '/dashboard')
        assert.match(await evaluate('document.body.textContent'), /Your story has been saved/)
        assert.match(await evaluate('document.body.textContent'), /Browser verification story/)
        await evaluate(`const row=[...document.querySelectorAll('[data-story-item]')].find(row=>row.dataset.title==='Browser verification story');row.querySelector('[data-delete-form] button').click();document.querySelector('[data-confirm-delete]').click()`)
        await pause(600)
        assert.match(await evaluate('document.body.textContent'), /Your story has been deleted/)
        console.log('PASS: rich editor, inline validation, visibility help, save, success notice, confirmed deletion')
        await send('Network.enable')
        await send('Network.setCacheDisabled', { cacheDisabled: true })
        await send('Network.setBlockedURLs', { urls: [...blockedCDNs, '*/vendor/ckeditor/*'] })
        await visit('/stories/add')
        assert.equal(await evaluate(`document.querySelector('#body').offsetHeight > 0`), true)
        assert.match(await evaluate(`document.querySelector('#body-help').textContent`), /could not load/)
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.button')).transitionDuration`), '0s')
        await send('Network.setBlockedURLs', { urls: blockedCDNs })
        await send('Emulation.setEmulatedMedia', { features: [] })
        console.log('PASS: usable editor fallback when its file is unavailable; reduced-motion preference respected')

        await visit('/test/feed')
        const storyCount = () => evaluate(`document.querySelectorAll('[data-feed-story]').length`)
        const waitForCount = async count => {
            for (let i = 0; i < 60; i++) { if (await storyCount() === count) return; await pause(100) }
            assert.equal(await storyCount(), count)
        }
        await waitForCount(12)
        for (const count of [24, 36]) {
            await evaluate(`document.querySelector('[data-feed-next]').scrollIntoView()`)
            await waitForCount(count)
        }
        await evaluate(`document.querySelector('[data-feed-next]').scrollIntoView()`)
        await pause(400)
        assert.equal(await storyCount(), 36, 'automatic loading pauses so the footer is reachable')
        await send('Network.setBlockedURLs', { urls: [...blockedCDNs, '*stories?before=*'] })
        await evaluate(`document.querySelector('[data-feed-next]').click()`)
        await pause(500)
        assert.equal(await storyCount(), 36, 'failed request retains existing stories')
        assert.equal(await evaluate(`document.querySelector('[data-feed-next]').hasAttribute('aria-disabled')`), false)
        assert.match(await evaluate(`document.querySelector('[data-feed-status]').textContent`), /Check your connection/)
        await send('Network.setBlockedURLs', { urls: blockedCDNs })
        await evaluate(`document.querySelector('[data-feed-next]').click()`)
        await waitForCount(48)
        assert.equal(await evaluate(`document.activeElement.tagName`), 'H2', 'manual loading moves focus into new content')
        await evaluate(`document.querySelector('[data-feed-next]').click()`)
        await waitForCount(51)
        assert.equal(await evaluate(`new Set([...document.querySelectorAll('[data-feed-story]')].map(el=>el.dataset.feedStory)).size`), 51)
        assert.equal(await evaluate(`document.querySelector('[data-feed-next]') === null`), true)
        assert.equal(await evaluate(`document.body.textContent.includes('A letter to my future self')`), false)
        await evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copiedStoryLink = text } }); document.querySelector('[data-share-story]').click()`)
        await pause(100)
        assert.match(await evaluate(`window.copiedStoryLink`), /^http:\/\/127\.0\.0\.1:4173\/stories\/[a-f0-9]{24}$/)
        assert.match(await evaluate(`document.querySelector('[data-feed-status]').textContent`), /link copied/)
        await evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Permission denied') } }); document.querySelector('[data-share-story]').click()`)
        await pause(100)
        assert.match(await evaluate(`document.querySelector('[data-feed-status]').textContent`), /copy its address/)
        await evaluate(`document.querySelector('.feed-search input').value='Community moment 47'; document.querySelector('.feed-search').requestSubmit()`)
        await pause(500)
        assert.equal(await storyCount(), 1)
        assert.match(await evaluate(`document.querySelector('[data-feed-story] h2').textContent`), /Community moment 47/)
        await send('Emulation.setScriptExecutionDisabled', { value: true })
        await visit('/stories')
        assert.equal(await storyCount(), 12)
        const nextPage = await evaluate(`document.querySelector('[data-feed-next]').getAttribute('href')`)
        await visit(nextPage)
        assert.equal(await storyCount(), 12, 'pagination works without JavaScript')
        await send('Emulation.setScriptExecutionDisabled', { value: false })
        console.log('PASS: feed scroll loading, manual pagination, retry after network failure, sharing, server search, privacy, and no-JavaScript pagination')
        assert.deepEqual(errors, [], 'No uncaught browser errors')
        console.log('PASS: no uncaught browser errors with external CDNs blocked. Screenshots saved to .preview/verified/; original previews preserved.')
    } finally {
        socket.close()
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
