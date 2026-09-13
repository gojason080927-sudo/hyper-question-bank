import katex from 'katex'

export type SafeKatexResult = {
  ok: boolean
  html: string
  fallback: string
}

export function safeRenderKatex(tex: string, display = false): SafeKatexResult {
  const fallback = tex
  if (!tex.trim()) return { ok: false, html: '', fallback }
  try {
    const html = katex.renderToString(tex, {
      throwOnError: true,
      displayMode: display,
      output: 'html',
      strict: 'ignore',
    })
    if (!html.trim() || html.includes('katex-error')) {
      return { ok: false, html: '', fallback }
    }
    return { ok: true, html, fallback }
  } catch {
    try {
      const html = katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
        output: 'html',
        strict: 'ignore',
      })
      if (!html.trim() || html.includes('katex-error')) {
        return { ok: false, html: '', fallback }
      }
      return { ok: true, html, fallback }
    } catch {
      return { ok: false, html: '', fallback }
    }
  }
}
