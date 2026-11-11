import { describe, expect, it } from 'vitest'
import { parseHtmlImages } from '../src/html-images'
import {
  fromImageUrl, isImagePath, markdownImagePath, normalizeWindowsPath, resolveImageSource, toImageUrl,
} from '../src/image-source'

const doc = 'C:\\笔记\\项目\\说明.md'
const local = (filePath: string) => toImageUrl(filePath)

describe('本地图片路径', () => {
  it('按文档所在文件夹解析 Typora 常见的相对路径', () => {
    expect(resolveImageSource('assets/图 1.png', doc)).toBe(local('C:\\笔记\\项目\\assets\\图 1.png'))
    expect(resolveImageSource('./说明.assets/image-20240101.png', doc)).toBe(local('C:\\笔记\\项目\\说明.assets\\image-20240101.png'))
    expect(resolveImageSource('../共享/logo.svg', doc)).toBe(local('C:\\笔记\\共享\\logo.svg'))
    expect(resolveImageSource('assets/my%20image.PNG', doc)).toBe(local('C:\\笔记\\项目\\assets\\my image.PNG'))
    expect(resolveImageSource('assets/a.png?raw=true', doc)).toBe(local('C:\\笔记\\项目\\assets\\a.png'))
    expect(resolveImageSource('assets/a.png#center', doc)).toBe(local('C:\\笔记\\项目\\assets\\a.png'))
    expect(resolveImageSource('C#笔记/a.png', doc)).toBe(local('C:\\笔记\\项目\\C#笔记\\a.png'))
  })

  it('支持绝对路径、file 链接、UNC 和以斜杠开头的路径', () => {
    const typora = 'C:\\Users\\me\\AppData\\Roaming\\Typora\\typora-user-images\\image-20240101.png'
    expect(resolveImageSource(typora, null)).toBe(local(typora))
    expect(resolveImageSource('d:/图片/封面.jpg', doc)).toBe(local('D:\\图片\\封面.jpg'))
    expect(resolveImageSource('file:///C:/Users/me/My%20Pictures/a.webp', null)).toBe(local('C:\\Users\\me\\My Pictures\\a.webp'))
    expect(resolveImageSource('file://server/share/a.gif', null)).toBe(local('\\\\server\\share\\a.gif'))
    expect(resolveImageSource('\\\\server\\share\\b.png', null)).toBe(local('\\\\server\\share\\b.png'))
    expect(resolveImageSource('/images/a.png', doc)).toBe(local('C:\\images\\a.png'))
  })

  it('保留网络图片、数据 URL、锚点以及无法解析的路径', () => {
    for (const source of [
      'https://example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:abc', '//cdn.example.com/a.png',
      '#anchor', 'mailto:me@example.com', '', 'notes.txt',
    ]) {
      expect(resolveImageSource(source, doc)).toBe(source)
    }
    expect(resolveImageSource('assets/a.png', null)).toBe('assets/a.png')
    expect(resolveImageSource('/images/a.png', null)).toBe('/images/a.png')
  })

  it('规范化 Windows 路径并识别图片扩展名', () => {
    expect(normalizeWindowsPath('c:/a/./b/../../../c.png')).toBe('C:\\c.png')
    expect(normalizeWindowsPath('\\\\server\\share\\x\\..\\y.png')).toBe('\\\\server\\share\\y.png')
    expect(isImagePath('C:\\a\\b.JPEG')).toBe(true)
    expect(isImagePath('C:\\a\\b.png.exe')).toBe(false)
    expect(isImagePath('C:\\a\\.png')).toBe(false)
  })

  it('图片协议只还原绝对路径的图片文件', () => {
    const filePath = 'C:\\笔记\\a b#1.png'
    expect(fromImageUrl(toImageUrl(filePath))).toBe(filePath)
    expect(fromImageUrl('inkdown-image://local/C%3A%5Ca%5C..%5Cb.png')).toBe('C:\\b.png')
    expect(fromImageUrl(toImageUrl('C:\\Windows\\win.ini'))).toBeNull()
    expect(fromImageUrl(toImageUrl('relative\\a.png'))).toBeNull()
    expect(fromImageUrl(toImageUrl('C:\\a.png\0.txt'))).toBeNull()
    expect(fromImageUrl('inkdown-image://other/C%3A%5Ca.png')).toBeNull()
    expect(fromImageUrl('https://local/C%3A%5Ca.png')).toBeNull()
    expect(fromImageUrl('not a url')).toBeNull()
  })

  it('插入图片时优先使用相对文档的路径', () => {
    expect(markdownImagePath('C:\\笔记\\项目\\assets\\a.png', doc)).toBe('assets/a.png')
    expect(markdownImagePath('c:\\笔记\\项目\\a.png', doc)).toBe('a.png')
    expect(markdownImagePath('D:\\图片\\b.png', doc)).toBe('D:/图片/b.png')
    expect(markdownImagePath('D:\\图片\\b.png', null)).toBe('D:/图片/b.png')
  })
})

describe('Typora 的 HTML 图片', () => {
  it('解析缩放、尺寸、标题与对齐方式', () => {
    expect(parseHtmlImages('<img src="assets/a.png" alt="缩放" style="zoom:50%;" />')).toEqual({
      images: [{ src: 'assets/a.png', alt: '缩放', title: '', width: null, height: null, zoom: '50%' }],
      align: null,
    })
    expect(parseHtmlImages('<p align="center"><img src="a.png" width="300" title="标题"><img src="b.png" style="width: 40%"></p>')).toEqual({
      images: [
        { src: 'a.png', alt: '', title: '标题', width: '300px', height: null, zoom: null },
        { src: 'b.png', alt: '', title: '', width: '40%', height: null, zoom: null },
      ],
      align: 'center',
    })
    expect(parseHtmlImages('<center><img src="a.png" height="120px"></center>')?.align).toBe('center')
  })

  it('其他 HTML 保持原样显示', () => {
    expect(parseHtmlImages('<span style="color:red">红字</span>')).toBeNull()
    expect(parseHtmlImages('<p>说明 <img src="a.png"></p>')).toBeNull()
    expect(parseHtmlImages('<img src="a.png"><script>alert(1)</script>')).toBeNull()
    expect(parseHtmlImages('<a href="https://example.com"><img src="a.png"></a>')).toBeNull()
    expect(parseHtmlImages('<img src="a.png" style="zoom: expression(alert(1))">')?.images[0].zoom).toBeNull()
    expect(parseHtmlImages('<img src="a.png" width="100vw">')?.images[0].width).toBeNull()
  })
})
