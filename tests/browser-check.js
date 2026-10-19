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
        fs.mkdirSync('.preview', { recursive: true })
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
                if ([1440, 390].includes(width)) {
                    const metrics = await send('Page.getLayoutMetrics')
                    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(2400, metrics.cssContentSize.height), scale: 1 } })
                    fs.writeFileSync('.preview/' + name + '-' + width + '.png', Buffer.from(capture.data, 'base64'))
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
        await send('Network.setBlockedURLs', { urls: ['*cdn.ckeditor.com*'] })
        await visit('/stories/add')
        assert.equal(await evaluate(`document.querySelector('#body').offsetHeight > 0`), true)
        assert.match(await evaluate(`document.querySelector('#body-help').textContent`), /could not load/)
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.button')).transitionDuration`), '0s')
        await send('Network.setBlockedURLs', { urls: [] })
        await send('Emulation.setEmulatedMedia', { features: [] })
        console.log('PASS: usable editor fallback when CDN fails; reduced-motion preference respected')
        assert.deepEqual(errors, [], 'No uncaught browser errors')
        console.log('PASS: no uncaught browser errors. Screenshots saved to .preview/')
    } finally {
        socket.close()
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
