import { assertEquals } from '@std/assert'
await import('../init.ts')

location.href = 'chrome-extension://test-extension/index.html'
let stored: Record<string, unknown> = {
    links1: { _id: 'links1', order: 0, parent: 'default', title: 'Example', url: 'https://example.com/' },
}
let writes: string[][] = []
const messages: { type: string; id?: string; url?: string }[] = []
let messageReceived = () => {}

globalThis.chrome = {
    extension: { inIncognitoContext: false },
    runtime: {
        id: 'test-extension',
        onMessage: { addListener: () => {} },
        sendMessage: (message: { type: string; id?: string; url?: string }) => {
            messages.push(message)
            messageReceived()
            return Promise.resolve({ ok: true })
        },
    },
    permissions: {
        contains: () => Promise.resolve(true),
        onAdded: { addListener: () => {} },
        onRemoved: { addListener: () => {} },
    },
    storage: {
        sync: {
            get: () => Promise.resolve(structuredClone(stored)),
            set: (data: Record<string, unknown>, done?: () => void) => {
                writes.push(Object.keys(data))
                stored = { ...stored, ...structuredClone(data) }
                done?.()
                return Promise.resolve()
            },
        },
        local: { get: () => Promise.resolve({ thumbnailCaptureEnabled: true }), set: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
    },
} as unknown as typeof chrome

const page = await Deno.readTextFile(new URL('../../src/index.html', import.meta.url))
document.body.innerHTML = page.slice(page.indexOf('<body'), page.indexOf('</body>')).replace(/^<body[^>]*>/, '')
document.getElementById('linkblocks')?.insertAdjacentHTML(
    'beforeend',
    '<li id="links1" class="link"><a class="link-elem" href="https://example.com/"><img /><span>Example</span></a></li>',
)
const { linksUpdate } = await import('../../src/scripts/features/links/index.ts')
const { initThumbnailSettings } = await import('../../src/scripts/features/links/thumbnails.ts')
const { tabsBc } = await import('../../src/scripts/defaults.ts')

Deno.test('Unchanged link updates do not write sync storage', async (test) => {
    try {
        await test.step('Apply without changes', async () => {
            await linksUpdate({ updateLink: { id: 'links1', title: 'Example', url: 'https://example.com/' } })
            assertEquals(writes.length, 0)

            await linksUpdate({ updateLink: { id: 'links1', title: 'Changed', url: 'https://example.com/' } })
            assertEquals(writes.length, 1)
            assertEquals((stored.links1 as { title: string }).title, 'Changed')

            await linksUpdate({ updateLink: { id: 'links1', title: 'Changed', url: 'https://example.com/' } })
            assertEquals(writes.length, 1)
        })

        await test.step('Apply without changes still refreshes the Thumbnail', async () => {
            await initThumbnailSettings()
            const link = { id: 'links1', title: 'Changed', url: 'https://example.com/', thumbnail: { type: 'capture' } }
            let requested = new Promise<void>((resolve) => messageReceived = resolve)
            await linksUpdate({ updateLink: link } as Parameters<typeof linksUpdate>[0])
            await requested
            assertEquals(writes.length, 2)

            messages.length = 0
            requested = new Promise<void>((resolve) => messageReceived = resolve)
            await linksUpdate({ updateLink: link } as Parameters<typeof linksUpdate>[0])
            await requested
            assertEquals(writes.length, 2)
            assertEquals(messages, [{ type: 'bonjourr-thumbnail-capture', id: 'links1', url: 'https://example.com/' }])
        })

        await test.step('The icon radius slider saves only the debounced radius', async () => {
            writes = []
            await linksUpdate({ iconradius: '0.5' })
            await linksUpdate({ iconradius: '0.6' })
            await linksUpdate({ iconradius: '0.7' })
            assertEquals(writes.length, 0)

            await new Promise((resolve) => setTimeout(resolve, 450))
            assertEquals(writes, [['linkiconradius']])
        })
    } finally {
        tabsBc.close()
    }
})
