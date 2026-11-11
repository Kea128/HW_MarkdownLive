import { describe, expect, it } from 'vitest'
import { releaseNotesToText } from '../electron/main/update-policy'
import { changelogSection, updateNotes, withReleaseNotes } from '../scripts/changelog.mjs'

const changelog = `# 更新日志

## 未发布

## [2.8.0] - 2026-12-01

### 在线更新

- 修复 **代理** 问题，详见 [文档](https://example.com)。
- 支持 \`取消下载\`。

> 升级提示

## [2.7.0] - 2026-10-08

- 旧版本
`

describe('发布说明', () => {
  it('提取指定版本的 CHANGELOG 段落', () => {
    expect(changelogSection(changelog, '2.8.0')).toBe(
      '### 在线更新\n\n- 修复 **代理** 问题，详见 [文档](https://example.com)。\n- 支持 `取消下载`。\n\n> 升级提示',
    )
    expect(changelogSection(changelog, '2.7.0')).toBe('- 旧版本')
    expect(() => changelogSection(changelog, '9.9.9')).toThrow('缺少 9.9.9')
  })

  it('转换为软件内显示的纯文本，并按整行限制长度', () => {
    const section = changelogSection(changelog, '2.8.0')
    expect(updateNotes(section)).toBe('在线更新\n• 修复 代理 问题，详见 文档。\n• 支持 取消下载。\n升级提示')
    expect(updateNotes(section, 20)).toBe('在线更新\n…')
    expect(updateNotes('一二三四五六', 4)).toBe('一二三…')
  })

  it('转义说明中的 HTML 字符，软件内按原样显示', () => {
    const notes = updateNotes('- 以 `<img style="zoom:50%">` 保存的图片 & `<center>` 居中')
    expect(notes).toBe('• 以 &lt;img style="zoom:50%"&gt; 保存的图片 &amp; &lt;center&gt; 居中')
    expect(releaseNotesToText(notes)).toBe('• 以 <img style="zoom:50%"> 保存的图片 & <center> 居中')
  })

  it('把说明写入 latest.yml 的块字符串', () => {
    const feed = 'version: 2.8.0\npath: Inkdown-2.8.0-x64-setup.exe\n'
    expect(withReleaseNotes(feed, '在线更新\n• 修复: 代理')).toBe(
      'version: 2.8.0\npath: Inkdown-2.8.0-x64-setup.exe\nreleaseNotes: |-\n  在线更新\n  • 修复: 代理\n',
    )
    expect(() => withReleaseNotes(`${feed}releaseNotes: 旧说明\n`, '新说明')).toThrow('已包含 releaseNotes')
  })
})
