import { beforeEach, describe, expect, it, vi } from 'vitest'
import { imageFiles, imageMarkdown, shouldPasteImages, storeImage, storeImages } from '../src/paste-images'

function clipboard(files: File[], html = ''): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: files.map((file) => ({ kind: 'file', type: file.type })) as unknown as DataTransferItemList,
    getData: (type: string) => type === 'text/html' ? html : '',
  } as DataTransfer
}

const screenshot = () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })

describe('粘贴图片', () => {
  beforeEach(() => {
    vi.mocked(window.inkdown.document.pathForFile).mockReturnValue('')
    vi.mocked(window.inkdown.images.save).mockClear()
  })

  it('截图和“复制图片”按图片粘贴，Word、网页选区等富文本按文字粘贴', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(imageFiles(clipboard([screenshot(), text]))).toHaveLength(1)
    expect(shouldPasteImages(clipboard([screenshot()]))).toBe(true)
    expect(shouldPasteImages(clipboard([screenshot()], '<meta charset="utf-8"><img src="https://example.com/a.png">'))).toBe(true)
    expect(shouldPasteImages(clipboard([screenshot()], '<p>Word 里的一段文字</p>'))).toBe(false)
    expect(shouldPasteImages(clipboard([text]))).toBe(false)
    expect(shouldPasteImages(null)).toBe(false)
  })

  it('剪贴板图片发送数据，磁盘上的图片只发送路径', async () => {
    vi.mocked(window.inkdown.images.save).mockResolvedValueOnce({
      ok: true, src: '周报.assets/image-20261112170405123.png', location: 'saved',
    })
    expect(await storeImage(screenshot())).toEqual({
      src: '周报.assets/image-20261112170405123.png',
      alt: 'image-20261112170405123',
      notice: '图片已保存到 周报.assets/image-20261112170405123.png',
    })
    expect(window.inkdown.images.save).toHaveBeenLastCalledWith({
      name: 'image.png', type: 'image/png', data: new Uint8Array([1, 2, 3]),
    })

    vi.mocked(window.inkdown.document.pathForFile).mockReturnValue('D:\\图片\\封面.jpg')
    vi.mocked(window.inkdown.images.save).mockResolvedValueOnce({ ok: true, src: 'C:/暂存/封面.jpg', location: 'staged' })
    expect(await storeImage(new File([''], '封面.jpg', { type: 'image/jpeg' }))).toMatchObject({
      alt: '封面', notice: '图片已暂存，保存文档后会自动移到图片文件夹',
    })
    expect(window.inkdown.images.save).toHaveBeenLastCalledWith({ name: '封面.jpg', type: 'image/jpeg', sourcePath: 'D:\\图片\\封面.jpg' })
  })

  it('汇总多张图片的结果，并提示保存失败的原因', async () => {
    const notify = vi.fn()
    vi.mocked(window.inkdown.images.save)
      .mockResolvedValueOnce({ ok: true, src: 'a.assets/1.png', location: 'saved' })
      .mockResolvedValueOnce({ ok: true, src: 'a.assets/2.png', location: 'saved' })
    expect(await storeImages([screenshot(), screenshot()], notify)).toHaveLength(2)
    expect(notify).toHaveBeenLastCalledWith('已插入 2 张图片（图片已保存到 a.assets/1.png）')
    vi.mocked(window.inkdown.images.save).mockResolvedValueOnce({ ok: false, error: '无法保存图片：磁盘已满' })
    expect(await storeImages([screenshot()], notify)).toEqual([])
    expect(notify).toHaveBeenLastCalledWith('无法保存图片：磁盘已满')
  })

  it('生成 Markdown 图片语法，路径含空格时用尖括号包住', () => {
    expect(imageMarkdown({ src: '周报.assets/a.png', alt: 'a' })).toBe('![a](周报.assets/a.png)')
    expect(imageMarkdown({ src: '周报 1.assets/a b.png', alt: '图[1]' })).toBe('![图\\[1\\]](<周报 1.assets/a b.png>)')
  })
})
