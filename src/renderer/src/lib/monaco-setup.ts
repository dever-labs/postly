import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Serve Monaco from the app bundle instead of @monaco-editor/react's default
// jsDelivr CDN, so the app works offline and never executes remotely hosted code.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json': return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less': return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor': return new HtmlWorker()
      case 'typescript':
      case 'javascript': return new TsWorker()
      default: return new EditorWorker()
    }
  },
}

loader.config({ monaco })
