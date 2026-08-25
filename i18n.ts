import { getLanguage } from "obsidian";

const englishTranslations = {
  displayHeading: "Display",
  hideTimestampName: "Hide timestamp",
  hideTimestampDesc:
    "Hide matching timestamp prefixes in rendered internal link text.",
  hideTabTitlesName: "Hide timestamp in tab titles",
  hideTabTitlesDesc:
    "Hide matching timestamp prefixes in workspace tab titles.",
  hideInlineTitlesName: "Hide timestamp in inline titles",
  hideInlineTitlesDesc:
    "Hide matching timestamp prefixes in titles shown inside notes.",
  patternName: "Timestamp regular expression",
  patternDefault: "Default: {pattern}",
  patternInvalid: "Invalid regular expression: {error}"
} as const;

export type TranslationKey = keyof typeof englishTranslations;
type TranslationDictionary = Record<TranslationKey, string>;
type TranslationParams = Record<string, string | number>;
export type Translator = (
  key: TranslationKey,
  params?: TranslationParams
) => string;

const translationDictionaries = {
  en: englishTranslations,
  "zh-CN": {
    displayHeading: "显示",
    hideTimestampName: "隐藏时间戳",
    hideTimestampDesc: "隐藏渲染后的内部链接文本中匹配的时间戳前缀。",
    hideTabTitlesName: "隐藏页签标题中的时间戳",
    hideTabTitlesDesc: "隐藏工作区页签标题中匹配的时间戳前缀。",
    hideInlineTitlesName: "隐藏文内标题中的时间戳",
    hideInlineTitlesDesc: "隐藏笔记内显示标题中匹配的时间戳前缀。",
    patternName: "时间戳正则表达式",
    patternDefault: "默认值：{pattern}",
    patternInvalid: "无效的正则表达式：{error}"
  }
} satisfies Record<string, TranslationDictionary>;

export type SupportedLocale = keyof typeof translationDictionaries;
const translations: Record<SupportedLocale, TranslationDictionary> =
  translationDictionaries;

const localeAliases: Record<string, SupportedLocale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN"
};

export function resolveLocale(language: string | null | undefined): SupportedLocale {
  return localeAliases[language?.trim().toLowerCase() ?? ""] ?? "en";
}

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: TranslationParams
): string {
  const template = translations[locale][key] ?? englishTranslations[key];

  return template.replace(/\{(\w+)\}/g, (placeholder, parameter: string) => {
    const value = params?.[parameter];
    return value === undefined ? placeholder : String(value);
  });
}

export function getTranslator(): Translator {
  const locale = resolveLocale(getLanguage());
  return (key, params) => translate(locale, key, params);
}
