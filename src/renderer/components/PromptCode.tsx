import { useEffect, useRef } from 'react'
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  StateEffect,
  StateField,
  Text,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  lineNumbers,
  drawSelection,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  invertedEffects,
  isolateHistory,
} from '@codemirror/commands'
import { searchKeymap, openSearchPanel, search } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useCommands } from '../state/commands'

const external = Annotation.define<boolean>()
const sourceSeparator = (value: string) => /\r\n|\r|\n/.exec(value)?.[0] ?? '\n'
const sourceText = (value: string) => Text.of(value.split(/\r\n|\r|\n/))
const setSeparator = StateEffect.define<string>()
const separator = StateField.define<string>({
  create: () => '\n',
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setSeparator)) value = effect.value
    return value
  },
})
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--text-primary)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: [tags.monospace, tags.quote], color: 'var(--text-secondary)' },
  { tag: tags.processingInstruction, color: 'var(--text-tertiary)' },
])
const matcher = new MatchDecorator({
  regexp: /\{\{YUKI_PERSONA_CORE\}\}/g,
  decoration: Decoration.mark({
    class: 'cm-persona-placeholder',
    attributes: { title: '插入人格核心（persona.md）' },
  }),
})
const placeholders = ViewPlugin.fromClass(
  class {
    decorations
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view)
    }
    update(update: import('@codemirror/view').ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (instance) => instance.decorations },
)

export function PromptCode(props: {
  content: string
  label: string
  readOnly: boolean
  undoableChange: number
  onChange(content: string): void
  onSave(): void
  onBack(): void
  onCursor(line: number, column: number): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(undefined)
  const latest = useRef(props)
  latest.current = props
  const readOnly = useRef(new Compartment())
  const lastContent = useRef(props.content)
  const lastUndoable = useRef(props.undoableChange)
  useEffect(() => {
    const editor = new EditorView({
      parent: root.current!,
      state: EditorState.create({
        doc: sourceText(latest.current.content),
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          drawSelection(),
          history(),
          markdown(),
          syntaxHighlighting(markdownStyle),
          placeholders,
          separator.init(() => sourceSeparator(latest.current.content)),
          invertedEffects.of((transaction) =>
            transaction.effects.some((effect) => effect.is(setSeparator))
              ? [setSeparator.of(transaction.startState.field(separator))]
              : [],
          ),
          readOnly.current.of(EditorState.readOnly.of(latest.current.readOnly)),
          EditorView.contentAttributes.of((view) => ({
            'aria-label': latest.current.label,
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-readonly': String(view.state.readOnly),
          })),
          EditorState.phrases.of({
            Find: '尋找',
            Replace: '取代',
            next: '下一個',
            previous: '上一個',
            all: '全部',
            'match case': '區分大小寫',
            regexp: '正規表示式',
            'by word': '全字',
            close: '關閉',
          }),
          search({ top: true }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latest.current.onSave()
                return true
              },
            },
            {
              key: 'Mod-[',
              preventDefault: true,
              run: () => {
                latest.current.onBack()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              (update.docChanged ||
                update.transactions.some((t) =>
                  t.effects.some((effect) => effect.is(setSeparator)),
                )) &&
              !update.transactions.every((t) => t.annotation(external))
            ) {
              // CodeMirror normalizes its text; the file separator is part of undoable source state.
              lastContent.current = update.state.doc.sliceString(
                0,
                update.state.doc.length,
                update.state.field(separator),
              )
              latest.current.onChange(lastContent.current)
            }
            if (update.selectionSet || update.docChanged) {
              const position = update.state.selection.main.head,
                line = update.state.doc.lineAt(position)
              latest.current.onCursor(line.number, position - line.from + 1)
            }
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = undefined
    }
  }, [])
  useEffect(() => {
    view.current?.dispatch({
      effects: readOnly.current.reconfigure(EditorState.readOnly.of(props.readOnly)),
    })
  }, [props.readOnly])
  useEffect(() => {
    const undoable = lastUndoable.current !== props.undoableChange
    lastUndoable.current = props.undoableChange
    if (lastContent.current === props.content) return
    lastContent.current = props.content
    const editor = view.current!
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: sourceText(props.content) },
      effects: setSeparator.of(sourceSeparator(props.content)),
      annotations: [
        external.of(true),
        Transaction.addToHistory.of(undoable),
        ...(undoable ? [isolateHistory.of('full')] : []),
      ],
    })
  }, [props.content, props.undoableChange])
  useCommands((command) => {
    if (command === 'find' && view.current) openSearchPanel(view.current)
    if (command === 'back') latest.current.onBack()
  })
  return <div ref={root} className="prompt-code" />
}
