const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const BRAILLE_SPINNER_SUFFIX_PATTERN = /\s*[\u2800-\u28ff]+$/u
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f-\u009f]/g

export function lastLines(text: string): string {
  return meaningfulOutputLines(text).slice(-8).join('\n')
}

function meaningfulOutputLines(text: string): string[] {
  return sanitizeSubprocessOutput(text).split('\n').map(normalizeOutputLine).filter(Boolean)
}

function sanitizeSubprocessOutput(text: string): string {
  return text.replace(/\r/g, '\n').replace(ANSI_ESCAPE_PATTERN, '').replace(UNSAFE_CONTROL_PATTERN, '')
}

function normalizeOutputLine(line: string): string {
  const compact = line.replace(BRAILLE_SPINNER_SUFFIX_PATTERN, '').trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  return compact[0].toUpperCase() + compact.slice(1)
}
