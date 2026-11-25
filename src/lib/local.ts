// Piccole preferenze salvate nel browser. localStorage può non essere disponibile
// (navigazione privata, iframe): in quel caso si ripiega sulla memoria.
const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
  }
}

export const getNickname = () => read('nickname')
export const setNickname = (name: string) => write('nickname', name.trim().slice(0, 40))

export const getEditCode = (courseId: string) => read(`editcode:${courseId}`)
export const setEditCode = (courseId: string, code: string | null) => write(`editcode:${courseId}`, code)

export type Theme = 'light' | 'dark'
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  write('theme', theme)
}
