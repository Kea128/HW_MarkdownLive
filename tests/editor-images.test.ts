import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { editorViewOptionsCtx, type Editor } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { DirectEditorProps, EditorView } from '@milkdown/kit/prose/view'
import { HtmlView, insertImages, installImagePlugins, type ImageOptions } from '../src/editor-images'
import type { StoredImage } from '../src/paste-images'
import { html, mountView, paragraph, schema, stubLayout, text } from './prose-fixture'

let view: EditorView
const stored: StoredImage = { src: '周报.assets/image-1.png', alt: 'image-1', notice: '已保存' }
const screenshot = () => new File(['png'], 'image.png', { type: 'image/png' })
const transfer = (files: File[], html = '') => ({
  files: files as unknown as FileList,
  items: [] as unknown as DataTransferItemList,
  getData: (type: string) => type === 'text/html' ? html : '',
}) as DataTransfer

function install() {
  const options: ImageOptions = {
    resolve: (src) => src,
    store: vi.fn(async (files: File[]) => files.map(() => stored)),
    choose: vi.fn(async () => null),
    reveal: vi.fn(),
    open: vi.fn(),
    copy: vi.fn(),
  }
  const configs: Array<(ctx: Ctx) => void> = []
  const editor = { config: (configure: (ctx: Ctx) => void) => (configs.push(configure), editor), use: () => editor }
  installImagePlugins(editor as unknown as Editor, options)
  const updates = new Map<unknown, unknown>()
  const ctx = { update: (slice: unknown, update: (value: unknown) => unknown) => updates.set(slice, update({})) } as unknown as Ctx
  configs.forEach((configure) => configure(ctx))
  return {
    options,
    props: updates.get(editorViewOptionsCtx) as DirectEditorProps,
    uploader: (updates.get(uploadConfig.key) as { uploader: (files: FileList, s: typeof schema) => Promise<unknown[]> }).uploader,
  }
}

beforeAll(stubLayout)
afterEach(() => view?.destroy())

describe('插入与粘贴图片', () => {
  it('在光标或放下的位置插入图片', () => {
    view = mountView([paragraph(text('第一段')), paragraph(text('第二段'))])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    insertImages(view, [stored])
    expect(view.state.doc.firstChild!.child(1).type.name).toBe('image')
    insertImages(view, [{ ...stored, alt: '第二张' }], 7)
    expect(view.state.doc.child(1).firstChild!.attrs.alt).toBe('第二张')
    insertImages(view, [])
  })

  it('粘贴截图时保存并插入，富文本按文字粘贴，拖入图片文件也会保存', async () => {
    view = mountView([paragraph(text('正文'))])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    const { props, options, uploader } = install()
    const handlePaste = props.handlePaste!.bind(props)
    const handleDrop = props.handleDrop!.bind(props)
    expect(handlePaste(view, { clipboardData: transfer([screenshot()]) } as ClipboardEvent, view.state.doc.slice(0, 0))).toBe(true)
    await vi.waitFor(() => expect(view.state.doc.textContent).toBe('正文'))
    await vi.waitFor(() => expect(view.state.doc.firstChild!.lastChild!.type.name).toBe('image'))
    expect(options.store).toHaveBeenCalledTimes(1)
    expect(handlePaste(view, { clipboardData: transfer([screenshot()], '<p>Word 文字</p>') } as ClipboardEvent,
      view.state.doc.slice(0, 0))).toBe(false)

    const drop = { dataTransfer: transfer([screenshot()]), clientX: 0, clientY: 0 } as DragEvent
    view.posAtCoords = () => ({ pos: 1, inside: -1 })
    expect(handleDrop(view, drop, view.state.doc.slice(0, 0), false)).toBe(true)
    expect(handleDrop(view, drop, view.state.doc.slice(0, 0), true)).toBe(false)
    await vi.waitFor(() => expect(options.store).toHaveBeenCalledTimes(2))
    const nodes = await uploader([screenshot(), new File(['x'], 'a.txt', { type: 'text/plain' })] as unknown as FileList, schema)
    expect(nodes).toHaveLength(1)
  })

  it('其他 HTML 中的换行、多张图片和原始标签分别显示', () => {
    view = mountView([paragraph(text('段'))])
    const breakView = new HtmlView(html('<br />'), (src) => src)
    expect(breakView.dom.className).toBe('html-break')
    expect(breakView.dom.querySelector('br')).not.toBeNull()
    const group = new HtmlView(html('<center><img src="a.png" width="80"><img src="b.png" style="zoom:50%"></center>'), (src) => `x/${src}`)
    expect(group.dom.className).toBe('html-image')
    expect(group.dom.dataset.align).toBe('center')
    expect([...group.dom.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(['x/a.png', 'x/b.png'])
    const raw = new HtmlView(html('<span style="color:red">'), (src) => src)
    expect(raw.dom).toHaveTextContent('<span style="color:red">')
    expect(raw.update(html('<sup>'))).toBe(true)
    expect(raw.update(html('<img src="c.png">'))).toBe(false)
    expect(raw.ignoreMutation()).toBe(true)
  })
})
