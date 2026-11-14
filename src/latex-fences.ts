import type { Editor } from '@milkdown/kit/core'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'

/** The language Crepe gives math blocks parsed from `$$` and created by the slash menu or by typing `$$`. */
export const MATH_LANGUAGE = 'LaTeX'

const isLatexSource = (language: string) => language.toLowerCase() === 'latex' && language !== MATH_LANGUAGE

const mathAwareCodeBlock = codeBlockSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx)
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        if (node.attrs.language === MATH_LANGUAGE) state.addNode('math', undefined, node.content.firstChild?.text ?? '')
        else base.toMarkdown.runner(state, node)
      },
    },
  }
})

/**
 * Crepe treats every code block whose language is "latex" as math: a ```latex sample was shown as a KaTeX error with
 * its source hidden and saved as a `$$` block. Only blocks that came from math keep that behaviour.
 */
export function keepLatexFences(editor: Editor): void {
  editor.use(mathAwareCodeBlock).config((ctx) => {
    ctx.update(codeBlockConfig.key, (config) => ({
      ...config,
      renderPreview: (language, content, applyPreview) => isLatexSource(language)
        ? null
        : config.renderPreview(language, content, applyPreview),
    }))
  })
}
