import zhTW from './zh-TW.js'
import en from './en.js'
import ja from './ja.js'

const locales = { 'zh-TW': zhTW, en, ja }

export const LANGUAGES = [
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
]

export function t(key, lang) {
  const dict = locales[lang] || locales['zh-TW']
  return dict[key] || key
}