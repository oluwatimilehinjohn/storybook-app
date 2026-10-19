/* Progressive enhancements: all navigation and form actions still work without JS. */
(() => {
    'use strict'
    const editorSource = document.currentScript?.dataset.editorSrc
    const account = document.querySelector('.account-menu')
    document.addEventListener('click', event => {
        if (account && !account.contains(event.target)) account.open = false
    })
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && account?.open) {
            account.open = false
            account.querySelector('summary').focus()
        }
    })

    const items = Array.from(document.querySelectorAll('[data-story-item]'))
    const search = document.querySelector('[data-story-search]')
    const tabs = Array.from(document.querySelectorAll('[data-filter]'))
    let filter = 'all'
    const filterStories = () => {
        const query = (search?.value || '').trim().toLocaleLowerCase()
        let visible = 0
        items.forEach(item => {
            item.hidden = !(item.dataset.title.toLocaleLowerCase().includes(query) &&
                (filter === 'all' || item.dataset.status === filter))
            if (!item.hidden) visible++
        })
        const result = document.querySelector('[data-filter-result]')
        if (result) {
            result.hidden = false
            result.textContent = visible ? visible + (visible === 1 ? ' story found.' : ' stories found.') :
                'No stories match. Try another title or change the visibility filter.'
        }
    }
    document.querySelectorAll('[data-filter-controls]').forEach(control => { control.hidden = false })
    search?.addEventListener('input', filterStories)
    tabs.forEach(tab => tab.addEventListener('click', () => {
        filter = tab.dataset.filter
        tabs.forEach(button => button.setAttribute('aria-pressed', String(button === tab)))
        filterStories()
    }))

    const dialog = document.querySelector('#delete-dialog')
    let pendingDelete
    document.querySelectorAll('[data-delete-form]').forEach(form => {
        form.addEventListener('submit', event => {
            event.preventDefault()
            if (!dialog?.showModal) {
                if (window.confirm('Delete "' + form.dataset.title + '"? This cannot be undone.')) form.submit()
                return
            }
            pendingDelete = form
            dialog.querySelector('[data-delete-title]').textContent = form.dataset.title
            dialog.showModal()
        })
    })
    dialog?.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close())
    dialog?.querySelector('[data-confirm-delete]').addEventListener('click', event => {
        if (!pendingDelete) return
        event.currentTarget.disabled = true
        event.currentTarget.textContent = 'Deleting…'
        pendingDelete.submit()
    })
    dialog?.addEventListener('click', event => {
        if (event.target !== dialog) return
        const box = dialog.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close()
    })

    const form = document.querySelector('[data-story-form]')
    if (!form) return
    const title = form.querySelector('#title')
    const body = form.querySelector('#body')
    const status = form.querySelector('#status')
    const save = form.querySelector('[data-save-button]')
    let editor
    let dirty = false
    let submitting = false
    const plainText = value => {
        const parsed = new DOMParser().parseFromString(value, 'text/html')
        return (parsed.body.textContent || '').replace(/\u00a0/g, ' ').trim()
    }
    const updateCount = () => {
        const text = plainText(editor ? editor.getData() : body.value)
        const words = text ? text.split(/\s+/).length : 0
        form.querySelector('[data-word-count]').textContent = words + (words === 1 ? ' word' : ' words')
    }
    form.noValidate = true
    form.addEventListener('input', () => { dirty = true; updateCount() })
    status.addEventListener('change', () => {
        dirty = true
        form.querySelector('[data-visibility-help]').textContent = status.value === 'private'
            ? 'Only you can read this story.'
            : 'Anyone signed in can discover and read this story.'
    })
    window.addEventListener('beforeunload', event => {
        if (dirty && !submitting) { event.preventDefault(); event.returnValue = '' }
    })
    window.addEventListener('pageshow', () => {
        submitting = false
        save.disabled = false
        if (save.dataset.originalHtml) save.innerHTML = save.dataset.originalHtml
    })
    form.addEventListener('submit', event => {
        if (submitting) { event.preventDefault(); return }
        if (editor) body.value = editor.getData()
        const titleInvalid = !title.value.trim()
        const bodyInvalid = !plainText(body.value)
        title.setAttribute('aria-invalid', String(titleInvalid))
        body.setAttribute('aria-invalid', String(bodyInvalid))
        form.querySelector('#title-error').hidden = !titleInvalid
        form.querySelector('#body-error').hidden = !bodyInvalid
        if (editor) editor.editing.view.change(writer => writer.setAttribute('aria-invalid', String(bodyInvalid), editor.editing.view.document.getRoot()))
        if (titleInvalid || bodyInvalid) {
            event.preventDefault()
            if (titleInvalid) title.focus()
            else if (editor) editor.editing.view.focus()
            else body.focus()
            return
        }
        submitting = true
        save.dataset.originalHtml = save.innerHTML
        save.disabled = true
        save.textContent = 'Saving…'
    })
    updateCount()

    // Keep the existing CKEditor version, loading it only on writing pages.
    const script = document.createElement('script')
    script.src = editorSource
    const editorFallback = () => {
        form.querySelector('#body-help').textContent = 'The formatting tools could not load. You can still write and save in the text field. Existing formatting is shown as HTML.'
    }
    script.onerror = editorFallback
    script.onload = async () => {
        try {
            // Avoid replacing a field while the writer is already using it.
            if (dirty || submitting) return
            body.required = false
            editor = await window.ClassicEditor.create(body, {
                toolbar: ['heading', '|', 'bold', 'italic', 'link', 'bulletedList', 'numberedList', 'blockQuote', '|', 'undo', 'redo']
            })
            editor.editing.view.change(writer => {
                const root = editor.editing.view.document.getRoot()
                writer.setAttribute('aria-label', 'Your story', root)
                writer.setAttribute('aria-describedby', 'body-help body-error', root)
            })
            editor.model.document.on('change:data', () => { dirty = true; updateCount() })
            form.querySelector('label[for="body"]').addEventListener('click', () => editor.editing.view.focus())
            updateCount()
        } catch {
            body.required = true
            editorFallback()
        }
    }
    if (editorSource) document.head.appendChild(script)
    else editorFallback()
})()
