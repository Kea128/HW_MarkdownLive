import { describe, expect, it } from 'vitest'
import { parseHtmlImages } from '../src/html-images'
import {
  describeSize, htmlImageModel, imageHtml, isLocalImage, isPlainImage, markdownImageModel, type ImageModel,
} from '../src/image-model'

const base: ImageModel = { src: '周报.assets/a b.png', alt: '架构 "图"', title: '', width: null, zoom: null, align: 'left' }

describe('图片尺寸与对齐的存储格式', () => {
  it('没有尺寸和对齐时保持 Markdown 图片语法', () => {
    expect(markdownImageModel({ src: 'a.png', alt: '图', title: '说明' }))
      .toEqual({ src: 'a.png', alt: '图', title: '说明', width: null, zoom: null, align: 'left' })
    expect(isPlainImage(base)).toBe(true)
    expect(isPlainImage({ ...base, width: '50%' })).toBe(false)
    expect(isPlainImage({ ...base, align: 'center' })).toBe(false)
  })

  it('调整大小或对齐后写成 Typora 与 GitHub 都能显示的 HTML', () => {
    expect(imageHtml({ ...base, width: '480' })).toBe('<img src="周报.assets/a b.png" alt="架构 &quot;图&quot;" width="480" />')
    expect(imageHtml({ ...base, width: '50%', align: 'center', title: '<标题>' }))
      .toBe('<p align="center"><img src="周报.assets/a b.png" alt="架构 &quot;图&quot;" title="&lt;标题&gt;" width="50%" /></p>')
    expect(imageHtml({ ...base, zoom: '50%', align: 'right' }))
      .toBe('<p align="right"><img src="周报.assets/a b.png" alt="架构 &quot;图&quot;" style="zoom:50%;" /></p>')
  })

  it('写出的 HTML 能被重新解析为相同的图片设置', () => {
    for (const model of [
      { ...base, width: '480' },
      { ...base, width: '75%', align: 'center' as const },
      { ...base, zoom: '33%', align: 'right' as const },
    ]) {
      const group = parseHtmlImages(imageHtml(model))!
      expect(htmlImageModel(group.images[0], group.align)).toEqual(model)
    }
  })

  it('描述当前尺寸并区分本地与网络图片', () => {
    expect(describeSize(base)).toBe('原始大小')
    expect(describeSize({ ...base, width: '480' })).toBe('480 px')
    expect(describeSize({ ...base, width: '50%' })).toBe('50%')
    expect(describeSize({ ...base, zoom: '33%' })).toBe('缩放 33%')
    expect(isLocalImage('周报.assets/a.png')).toBe(true)
    expect(isLocalImage('C:/图片/a.png')).toBe(true)
    expect(isLocalImage('https://example.com/a.png')).toBe(false)
    expect(isLocalImage('data:image/png;base64,AA')).toBe(false)
  })
})
