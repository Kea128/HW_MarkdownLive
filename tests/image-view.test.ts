import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { parseHtmlImages } from '../src/html-images'
import { htmlImageModel, markdownImageModel } from '../src/image-model'
import { ImageView, type ImageActions } from '../src/image-view'
import { html, image, mountView, paragraph, selectNodeAt, stubLayout, text } from './prose-fixture'

const actions = (): ImageActions => ({
  resolve: vi.fn((src: string) => `inkdown-image://local/${encodeURIComponent(src)}`),
  choose: vi.fn(async () => ({ src: '周报.assets/新图.png', alt: '新图' })),
  reveal: vi.fn(),
  open: vi.fn(),
  copy: vi.fn(),
})

let views: EditorView[] = []
function mount(nodes: Parameters<typeof mountView>[0], imageActions = actions()) {
  const view = mountView(nodes, {
    image: (node, editor, getPos) => new ImageView(node, editor, getPos, imageActions, (current) => markdownImageModel(current.attrs)),
    html: (node, editor, getPos) => new ImageView(node, editor, getPos, imageActions, (current) => {
      const group = parseHtmlImages(String(current.attrs.value))
      return group?.images.length === 1 ? htmlImageModel(group.images[0], group.align) : null
    }),
  })
  views.push(view)
  return { view, imageActions, root: view.dom as HTMLElement }
}
const first = (view: EditorView) => view.state.doc.firstChild!.firstChild!
const toolbarButton = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`.image-toolbar button[aria-label="${label}"]`)!

beforeAll(stubLayout)
afterEach(() => {
  views.forEach((view) => view.destroy())
  views = []
})

describe('图片编辑', () => {
  it('显示图片，加载失败时提示路径，并在选中后显示工具栏', () => {
    const { view, root } = mount([paragraph(image('周报.assets/a.png', '图'))])
    const element = root.querySelector('img')!
    expect(element.getAttribute('src')).toBe(`inkdown-image://local/${encodeURIComponent('周报.assets/a.png')}`)
    element.dispatchEvent(new Event('error'))
    expect(root.querySelector('.inkdown-image')).toHaveClass('is-broken')
    expect(root.querySelector('.image-broken')).toHaveTextContent('图片无法显示：周报.assets/a.png')
    element.dispatchEvent(new Event('load'))
    expect(root.querySelector('.inkdown-image')).not.toHaveClass('is-broken')

    selectNodeAt(view, 1)
    expect(root.querySelector('.inkdown-image')).toHaveClass('is-selected')
    expect([...root.querySelectorAll('.image-toolbar button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['左对齐', '居中', '右对齐', '图片说明', '替换图片', '打开图片', '在文件夹中显示', '复制图片', '删除图片'])
    expect(toolbarButton(root, '居中').disabled).toBe(false)
  })

  it('居中和设置宽度后写成 HTML，恢复原始大小和左对齐后变回 Markdown 图片', () => {
    const { view, root } = mount([paragraph(image('a.png', '图'))])
    selectNodeAt(view, 1)
    toolbarButton(root, '居中').click()
    expect(first(view).type.name).toBe('html')
    expect(first(view).attrs.value).toBe('<p align="center"><img src="a.png" alt="图" /></p>')
    expect(root.querySelector('.inkdown-image')).toHaveClass('is-selected')

    const chooseSize = (label: string) => {
      const trigger = root.querySelector<HTMLElement>('.image-size-trigger')!
      trigger.click()
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      ;[...root.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === label)!.click()
    }
    chooseSize('宽度 50%')
    expect(first(view).attrs.value).toBe('<p align="center"><img src="a.png" alt="图" width="50%" /></p>')
    expect(root.querySelector<HTMLElement>('.inkdown-image-frame')!.style.width).toBe('50%')
    expect(root.querySelector('.image-size-trigger')).toHaveTextContent('50%')
    expect(root.querySelector('[role="menuitemradio"][aria-checked="true"]')).toHaveTextContent('宽度 50%')

    const trigger = root.querySelector<HTMLElement>('.image-size-trigger')!
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(root.querySelector('.image-size-menu')).toHaveClass('is-open')
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.querySelector('.image-size-menu')).not.toHaveClass('is-open')

    chooseSize('原始大小')
    toolbarButton(root, '左对齐').click()
    expect(first(view).type.name).toBe('image')
    expect(first(view).attrs).toMatchObject({ src: 'a.png', alt: '图' })
  })

  it('图片和文字在同一段时不能设置对齐', () => {
    const { view, root } = mount([paragraph(text('前文'), image('a.png'))])
    selectNodeAt(view, 3)
    expect(toolbarButton(root, '居中').disabled).toBe(true)
    expect(toolbarButton(root, '居中').title).toContain('单独成段')
  })

  it('修改图片说明、替换图片并调用打开、定位和复制', async () => {
    const { view, root, imageActions } = mount([paragraph(image('a.png', 'image-20261112'))])
    selectNodeAt(view, 1)
    toolbarButton(root, '图片说明').click()
    const input = root.querySelector<HTMLInputElement>('.image-toolbar input')!
    input.value = '  架构图  '
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(first(view).attrs.alt).toBe('架构图')

    toolbarButton(root, '在文件夹中显示').click()
    toolbarButton(root, '复制图片').click()
    toolbarButton(root, '打开图片').click()
    expect(imageActions.reveal).toHaveBeenCalledWith('a.png')
    expect(imageActions.copy).toHaveBeenCalledWith('a.png')
    expect(imageActions.open).toHaveBeenCalledWith('a.png')

    toolbarButton(root, '替换图片').click()
    await vi.waitFor(() => expect(first(view).attrs.src).toBe('周报.assets/新图.png'))
    expect(first(view).attrs.alt).toBe('架构图')

    toolbarButton(root, '图片说明').click()
    root.querySelector('.image-toolbar input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(root.querySelector('.image-toolbar input')).toBeNull()

    toolbarButton(root, '删除图片').click()
    expect(view.state.doc.firstChild!.childCount).toBe(0)
  })

  it('网络图片不能定位或复制，工具栏内的事件不交给编辑器处理', () => {
    const { view, root } = mount([paragraph(image('https://example.com/a.png'))])
    selectNodeAt(view, 1)
    expect(toolbarButton(root, '在文件夹中显示').disabled).toBe(true)
    expect(toolbarButton(root, '复制图片').disabled).toBe(true)
    const imageView = new ImageView(first(view), view, () => 1, actions(), (node) => markdownImageModel(node.attrs))
    expect(imageView.stopEvent({ target: imageView.dom.querySelector('.image-handle') } as unknown as Event)).toBe(true)
    expect(imageView.stopEvent({ target: imageView.dom.querySelector('img') } as unknown as Event)).toBe(false)
    expect(imageView.ignoreMutation()).toBe(true)
  })

  it('拖动右侧手柄调整宽度，双击手柄恢复原始大小', () => {
    const { view, root } = mount([paragraph(html('<img src="a.png" alt="图" style="zoom:50%;" />'))])
    const frame = root.querySelector<HTMLElement>('.inkdown-image-frame')!
    expect(root.querySelector('img')!.style.zoom).toBe('50%')
    const handle = root.querySelector<HTMLElement>('.image-handle[data-side="right"]')!
    handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }))
    handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 260 }))
    expect(frame.style.width).toBe('160px')
    expect(root.querySelector('.image-size')).toHaveTextContent('160 px')
    handle.dispatchEvent(new MouseEvent('pointerup', { clientX: 260 }))
    expect(first(view).attrs.value).toBe('<img src="a.png" alt="图" width="160" />')

    root.querySelector('.image-handle[data-side="right"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(first(view).type.name).toBe('image')
  })
})
