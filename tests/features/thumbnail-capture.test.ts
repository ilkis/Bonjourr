import { assertEquals, assertRejects } from '@std/assert'
import { THUMBNAIL_TAB_LEFT } from '../../src/scripts/shared/thumbnails.ts'

const events: string[] = []
let granted = true
let enabled = true
let currentUrl = 'https://example.com/'
let createCount = 0
let activeTab = 1
let windowFocused = true
let otherWindowFocused = false
let captureFocused = false
let captureState = 'minimized'
let sourceState = 'normal'
let captureClosed = false
let loadReady = false
let mode = ''
let captures = 0
let restoredReads = 0
let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0]
const tab = (id: number) => ({
    id,
    windowId: id === 1 || id === 3 ? 10 : 20,
    url: id === 2 && mode === 'reload after restore' && captureState === 'normal'
        ? new URL('login', currentUrl).href
        : currentUrl,
    status: 'complete',
})

globalThis.chrome = {
    runtime: {
        id: 'test-extension',
        getURL: (path: string) => 'chrome-extension://test-extension/' + path,
        onMessage: {
            addListener: (callback: typeof listener) => {
                listener = callback
            },
        },
    },
    storage: {
        local: { get: () => Promise.resolve({ thumbnailCaptureEnabled: enabled }) },
        sync: {
            get: () => Promise.resolve({ links1: { _id: 'links1', url: currentUrl, thumbnail: { type: 'capture' } } }),
        },
    },
    permissions: { contains: () => Promise.resolve(granted) },
    windows: {
        getAll: () =>
            Promise.resolve([
                { id: 10, focused: windowFocused, state: sourceState },
                ...(captureClosed ? [] : [{ id: 20, focused: captureFocused, state: captureState }]),
                ...(otherWindowFocused ? [{ id: 30, focused: true, state: 'normal' }] : []),
            ]),
        get: (id: number) =>
            Promise.resolve(
                id === 10
                    ? { id, focused: windowFocused, state: sourceState, width: 1440, height: 900, left: 100, top: 50 }
                    : { id, focused: captureFocused, state: captureState },
            ),
        create: (options: chrome.windows.CreateData) => {
            assertEquals(options, { url: currentUrl, state: 'minimized', type: 'normal' })
            createCount++
            captureState = mode === 'created normal' ? 'normal' : 'minimized'
            captureFocused = mode === 'created normal'
            if (mode === 'created normal') windowFocused = false
            captureClosed = false
            events.push('create')
            return Promise.resolve({ id: 20, tabs: [tab(2)], state: captureState, focused: captureFocused })
        },
        update: (id: number, options: chrome.windows.UpdateInfo) => {
            if (id === 20 && options.state === 'minimized') {
                assertEquals(options, { state: 'minimized' })
                events.push('minimize')
                captureState = 'minimized'
                captureFocused = false
            } else if (id === 20 && !options.state) {
                assertEquals(options, { focused: true })
                events.push('raise')
                captureFocused = true
                windowFocused = false
            } else if (id === 20) {
                assertEquals(options, {
                    state: 'normal',
                    focused: false,
                })
                captureState = 'normal'
                events.push('restore')
                if (mode === 'capture still active' || mode === 'source minimized during capture') {
                    captureFocused = true
                    windowFocused = false
                }
                if (mode === 'restore loses focus') windowFocused = false
                if (mode === 'other window during restore') {
                    windowFocused = false
                    otherWindowFocused = true
                }
            } else {
                assertEquals(captureFocused || (!windowFocused && sourceState !== 'minimized'), true)
                assertEquals(options, { focused: true })
                events.push('focus original')
                windowFocused = true
                captureFocused = false
            }
            return Promise.resolve()
        },
        remove: (id: number) => {
            assertEquals(id, 20)
            events.push('close')
            captureClosed = true
            return Promise.resolve()
        },
    },
    tabs: {
        query: (options: chrome.tabs.QueryInfo) => Promise.resolve([tab(options.windowId === 20 ? 2 : activeTab)]),
        get: (id: number) => {
            if (id === 2 && !loadReady) return Promise.reject(new Error('Website tab was closed'))
            if (id === 2 && mode === 'other tab') activeTab = 3
            if (id === 2 && mode === 'other app') windowFocused = false
            if (id === 2 && mode === 'reload after restore' && captureState === 'normal' && restoredReads++ === 0) {
                return Promise.resolve({ ...tab(id), status: 'loading' })
            }
            return Promise.resolve(tab(id))
        },
        update: (id: number, options: chrome.tabs.UpdateProperties) => {
            assertEquals(options, { muted: true })
            return Promise.resolve(tab(id))
        },
        captureVisibleTab: (id: number) => {
            assertEquals(id, 20)
            captures++
            if (mode === 'another window during capture') {
                windowFocused = false
                captureFocused = false
            }
            if (mode === 'source minimized during capture') {
                sourceState = 'minimized'
                windowFocused = false
            }
            if (mode === 'other tab before retry') activeTab = 3
            if (mode === 'screenshot hangs' && captures === 1) return new Promise(() => {})
            if (mode === 'capture not allowed') return Promise.reject(new Error('Cannot access contents of the page'))
            return Promise.reject(new Error('Failed to capture tab: image readback failed'))
        },
    },
} as unknown as typeof chrome

const { enqueueCapture, registerThumbnailCapture } = await import('../../src/scripts/services/thumbnail-capture.ts')
registerThumbnailCapture()

Deno.test('Capture requires both local opt-in and all-sites permission', async () => {
    enabled = false
    await assertRejects(() => enqueueCapture('links1', currentUrl), Error, 'Enable local thumbnail capture')
    enabled = true
    granted = false
    await assertRejects(() => enqueueCapture('links1', currentUrl), Error, 'Enable local thumbnail capture')
    assertEquals(createCount, 0)
    granted = true
})

Deno.test('Capture rejects changed links and unsupported URLs before opening a window', async () => {
    await assertRejects(() => enqueueCapture('links1', 'https://old.example/'), Error, 'link changed')
    currentUrl = 'file:///tmp/private'
    await assertRejects(() => enqueueCapture('links1', currentUrl), Error, 'Only HTTP and HTTPS')
    assertEquals(createCount, 0)
    currentUrl = 'https://example.com/'
})

Deno.test('Duplicate capture requests share a job and failures close their window', async () => {
    const first = enqueueCapture('links1', currentUrl)
    const second = enqueueCapture('links1', currentUrl)
    assertEquals(first, second)
    await assertRejects(() => first, Error, 'Website tab was closed')
    assertEquals(events, ['create', 'close'])
})

Deno.test('The capture queue continues after a failed job', async () => {
    await assertRejects(() => enqueueCapture('links1', currentUrl), Error, 'Website tab was closed')
    assertEquals(events, ['create', 'close', 'create', 'close'])
})

Deno.test('Capture messages reject other pages and private tabs', () => {
    for (
        const sender of [
            { id: 'other-extension', url: 'chrome-extension://test-extension/index.html' },
            { id: 'test-extension', url: 'https://example.com/' },
            { id: 'test-extension', url: 'chrome-extension://test-extension/index.html', tab: { incognito: true } },
        ]
    ) {
        let reply: { error?: string } | undefined
        listener(
            { type: 'bonjourr-thumbnail-capture', id: 'links1', url: currentUrl },
            sender as chrome.runtime.MessageSender,
            (value) => {
                reply = value
            },
        )
        assertEquals(reply?.error?.includes('regular Bonjourr tab'), true)
    }
})

Deno.test('Cache cancellation discards jobs that have not opened a window', async () => {
    const before = createCount
    const job = enqueueCapture('links1', currentUrl)
    let reply: { ok?: boolean } | undefined
    listener({ type: 'bonjourr-thumbnail-cancel' }, {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/index.html',
    }, (value) => {
        reply = value
    })
    assertEquals(reply?.ok, true)
    await assertRejects(() => job, Error, 'cancelled')
    assertEquals(createCount, before)
})

Deno.test('Capture restores a minimized regular window and does not steal another application focus', async (test) => {
    const originalNow = Date.now
    let time = originalNow()
    loadReady = true
    Date.now = () => time += 1000
    try {
        for (
            const scenario of [
                'readback failure',
                'reload after restore',
                'restore loses focus',
                'other window during restore',
                'other tab',
                'other app',
                'capture still active',
                'another window during capture',
                'source minimized during capture',
                'other tab before retry',
                'screenshot hangs',
                'created normal',
                'capture not allowed',
            ]
        ) {
            await test.step(scenario, async () => {
                mode = scenario
                activeTab = 1
                windowFocused = true
                otherWindowFocused = false
                captureFocused = false
                sourceState = 'normal'
                captures = 0
                restoredReads = 0
                const before = events.length
                const left = [
                    'other tab',
                    'other app',
                    'other window during restore',
                    'another window during capture',
                    'source minimized during capture',
                    'other tab before retry',
                ].includes(mode)
                await assertRejects(
                    () => enqueueCapture('links1', currentUrl),
                    Error,
                    left
                        ? THUMBNAIL_TAB_LEFT
                        : mode === 'capture not allowed'
                        ? 'Cannot access contents'
                        : 'image readback failed',
                )
                if (mode === 'other tab' || mode === 'other app') {
                    assertEquals(events.slice(before), ['create', 'close'])
                    assertEquals(captures, 0)
                } else if (mode === 'source minimized during capture') {
                    assertEquals(events.slice(before), ['create', 'restore', 'focus original', 'close'])
                    assertEquals(captures, 1)
                } else if (left || mode === 'capture not allowed') {
                    assertEquals(events.slice(before), ['create', 'restore', 'close'])
                    assertEquals(captures, 1)
                } else if (mode === 'capture still active' || mode === 'restore loses focus') {
                    assertEquals(events.slice(before), [
                        'create',
                        'restore',
                        'focus original',
                        'raise',
                        'focus original',
                        'close',
                    ])
                    assertEquals(captures, 2)
                    assertEquals(windowFocused, true)
                } else if (mode === 'created normal') {
                    assertEquals(events.slice(before), [
                        'create',
                        'minimize',
                        'focus original',
                        'restore',
                        'raise',
                        'focus original',
                        'close',
                    ])
                    assertEquals(captures, 2)
                    assertEquals(windowFocused, true)
                } else {
                    assertEquals(events.slice(before), ['create', 'restore', 'raise', 'focus original', 'close'])
                    assertEquals(captures, 2)
                    assertEquals(windowFocused, true)
                }
                assertEquals(activeTab, mode === 'other tab' || mode === 'other tab before retry' ? 3 : 1)
            })
        }
    } finally {
        Date.now = originalNow
        loadReady = false
        activeTab = 1
        windowFocused = true
        otherWindowFocused = false
        sourceState = 'normal'
        mode = ''
    }
})
