export const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'style',
  'svg',
  'math',
] as const

export const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'pre',
  'code',
  'hr',
  'a',
])

const ALLOWED_ATTR = new Set([
  'href',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'class',
  'style',
  'width',
  'height',
  'align',
  'data-latex',
  'data-math-inline',
  'data-math-block',
  'data-storage-path',
])

function stripTags(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
  const open = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi')
  return html.replace(re, '').replace(open, '')
}

function dropEventHandlers(html: string): string {
  return html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

function dropDangerousUrls(html: string): string {
  return html
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*data:(?!image\/(?:png|jpeg|gif|webp))[^'"]*\2/gi, '')
}

/** Final content must not keep clipboard data URLs; they are uploaded separately. */
export function stripDataImages(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*(['"])data:image[^'"]*\1[^>]*>/gi, '')
}

export function sanitizeHtml(html: string): string {
  let next = html.replace(/\0/g, '')
  for (const tag of DANGEROUS_TAGS) next = stripTags(next, tag)
  next = dropEventHandlers(next)
  next = dropDangerousUrls(next)
  next = stripDataImages(next)
  next = next.replace(/<\/?([a-z0-9:-]+)([^>]*)>/gi, (full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase()
    const closing = full.startsWith('</')
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (closing) return `</${tag}>`
    const kept = (attrs.match(/([a-z0-9:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi) ?? [])
      .map((pair) => {
        const match = pair.match(/^([a-z0-9:-]+)/i)
        const name = match?.[1]?.toLowerCase() ?? ''
        if (!ALLOWED_ATTR.has(name)) return ''
        if (name === 'style' && /expression|url\s*\(\s*['"]?\s*javascript/i.test(pair)) return ''
        return ` ${pair}`
      })
      .join('')
    return `<${tag}${kept}>`
  })
  return next
}

export function looksLikeXss(html: string): boolean {
  return /<script\b|onerror\s*=|javascript:/i.test(html)
}
