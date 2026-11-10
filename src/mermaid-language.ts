import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'

const keywords = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram',
  'gitGraph', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'mindmap',
  'timeline', 'zenuml', 'sankey', 'sankey-beta', 'xychart', 'xychart-beta', 'block', 'block-beta',
  'packet', 'packet-beta', 'kanban', 'architecture', 'architecture-beta', 'radar-beta', 'treemap',
  'treemap-beta', 'venn-beta', 'requirement', 'info', 'agentflow-beta', 'swimlane-beta', 'usecase-beta',
  'ishikawa', 'ishikawa-beta', 'wardley-beta', 'cynefin-beta', 'treeView-beta', 'eventmodeling',
  'railroad-beta', 'railroad-ebnf-beta', 'railroad-abnf-beta', 'railroad-peg-beta',
  'subgraph', 'end', 'direction', 'participant', 'actor', 'as', 'note', 'over', 'loop', 'alt', 'else',
  'opt', 'par', 'and', 'critical', 'break', 'rect', 'activate', 'deactivate', 'autonumber', 'box',
  'create', 'destroy', 'class', 'classDef', 'style', 'linkStyle', 'click', 'state', 'title', 'section',
  'dateFormat', 'axisFormat', 'excludes', 'includes', 'todayMarker', 'accTitle', 'accDescr', 'showData',
  'commit', 'branch', 'checkout', 'merge', 'cherry-pick', 'namespace',
])

const mermaidSyntax = StreamLanguage.define<null>({
  name: 'mermaid',
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"[^"]*"?/)) return 'string'
    if (stream.match(/^[A-Za-z_]\w*(?:-[A-Za-z]\w*)*/)) return keywords.has(stream.current()) ? 'keyword' : null
    if (stream.match(/^(?:[<*o}|]{0,2}[-=.]{2,}[>xo*{|)]{0,2}|-{1,2}[>)x]{1,2})/)) return 'operator'
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/^[[\](){}]/)) return 'bracket'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '%%' } },
})

export const mermaidLanguage = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mmd'],
  extensions: ['mmd', 'mermaid'],
  support: new LanguageSupport(mermaidSyntax),
})
