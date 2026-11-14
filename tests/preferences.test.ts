import { describe, expect, it } from 'vitest'
import { contentWidthCss, DEFAULT_PREFERENCES, mergePreferences, readPreferences } from '../src/preferences'

describe('偏好设置', () => {
  it('读取设置文件时保留有效字段，其余回退为默认值', () => {
    expect(readPreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences('dark')).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences({
      theme: 'dark', fontSize: 99, codeLanguage: 'py thon', startupMode: 'reading', autoSave: 'yes',
      imageFolder: { mode: 'custom', template: ' 图片/${filename} ' },
    })).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
      startupMode: 'reading',
      imageFolder: { mode: 'custom', template: '图片/${filename}' },
    })
    expect(DEFAULT_PREFERENCES).toMatchObject({ spellcheck: false, codeLanguage: 'text', autoSave: false })
  })

  it('合并修改前逐项校验，拒绝未知项与无效值', () => {
    expect(mergePreferences(DEFAULT_PREFERENCES, { spellcheck: true, codeLanguage: 'c++' })).toEqual({
      ok: true, value: { ...DEFAULT_PREFERENCES, spellcheck: true, codeLanguage: 'c++' },
    })
    expect(mergePreferences(DEFAULT_PREFERENCES, { codeLanguage: '' })).toMatchObject({ ok: true })
    expect(mergePreferences(DEFAULT_PREFERENCES, { fontSize: 13 })).toEqual({ ok: false, error: '设置值无效' })
    expect(mergePreferences(DEFAULT_PREFERENCES, { theme: 'blue' })).toEqual({ ok: false, error: '设置值无效' })
    expect(mergePreferences(DEFAULT_PREFERENCES, { autoUpdate: true })).toEqual({ ok: false, error: '包含未知的设置项' })
    expect(mergePreferences(DEFAULT_PREFERENCES, null)).toEqual({ ok: false, error: '设置无效' })
    expect(mergePreferences(DEFAULT_PREFERENCES, [])).toEqual({ ok: false, error: '设置无效' })
    expect(mergePreferences(DEFAULT_PREFERENCES, { imageFolder: { mode: 'custom', template: 'a|b' } }))
      .toEqual({ ok: false, error: '路径不能包含 < > " | ? *' })
    expect(mergePreferences(DEFAULT_PREFERENCES, { imageFolder: 'assets' }))
      .toEqual({ ok: false, error: '图片文件夹设置无效' })
  })

  it('正文宽度映射到样式值', () => {
    expect(contentWidthCss('narrow')).toBe('960px')
    expect(contentWidthCss('wide')).toBe('1440px')
    expect(contentWidthCss('full')).toBe('100%')
  })
})
