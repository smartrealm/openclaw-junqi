import { useEffect, useRef } from 'react';
import {
  Compartment,
  EditorState,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@uiw/react-codemirror';
import { loadCodeMirrorLanguage } from '@/utils/codeMirrorLanguages';
import { aegisCodeMirrorBaseTheme } from '@/utils/codeMirrorTheme';
import { sessionFileLineSeparator } from './sessionFileEditState';

interface SessionFileCodeEditorProps {
  readonly documentId: string;
  readonly name: string;
  readonly content: string;
  readonly readOnly: boolean;
  readonly onChange: (content: string) => void;
  readonly onSave: () => void;
}

/**
 * Gateway 会话文件不能复用本机文件编辑器。该编辑器直接使用 CodeMirror 的行分隔符
 * 和 sliceDoc 序列化，保留 OpenClaw 返回的 CRLF/CR 文本字节语义。
 */
export function SessionFileCodeEditor({
  documentId,
  name,
  content,
  readOnly,
  onChange,
  onSave,
}: SessionFileCodeEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef<Compartment | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return undefined;
    const editable = new Compartment();
    const language = new Compartment();
    const separator = sessionFileLineSeparator(content);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: content,
        extensions: [
          ...(separator ? [EditorState.lineSeparator.of(separator)] : []),
          lineNumbers(),
          highlightSpecialChars(),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
          ]),
          EditorView.lineWrapping,
          aegisCodeMirrorBaseTheme,
          language.of([]),
          editable.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.sliceDoc());
          }),
        ],
      }),
    });
    viewRef.current = view;
    editableRef.current = editable;
    let active = true;
    void loadCodeMirrorLanguage(name).then((extension) => {
      if (active) view.dispatch({ effects: language.reconfigure(extension) });
    }).catch(() => undefined);
    return () => {
      active = false;
      if (viewRef.current === view) viewRef.current = null;
      editableRef.current = null;
      view.destroy();
    };
  }, [documentId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === view.state.sliceDoc()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    const editable = editableRef.current;
    if (!view || !editable) return;
    view.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return <div ref={mountRef} className="min-h-52 overflow-hidden rounded-md border border-aegis-border" />;
}
