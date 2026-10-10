// Languages XYRO can speak with the user (chosen on first launch, /language to change).

export interface Language {
  code: string;
  /** Name in English (used in the system prompt) */
  name: string;
  /** Name in the language itself (shown to the user) */
  native: string;
  /** "Choose your language" in that language (the welcome screen rotates through them) */
  choose: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", choose: "Choose your language" },
  { code: "fr", name: "French", native: "Français", choose: "Choisissez votre langue" },
  { code: "es", name: "Spanish", native: "Español", choose: "Elige tu idioma" },
  { code: "pt", name: "Portuguese", native: "Português", choose: "Escolha seu idioma" },
  { code: "de", name: "German", native: "Deutsch", choose: "Wähle deine Sprache" },
  { code: "it", name: "Italian", native: "Italiano", choose: "Scegli la tua lingua" },
  { code: "sw", name: "Swahili", native: "Kiswahili", choose: "Chagua lugha yako" },
  { code: "ar", name: "Arabic", native: "العربية", choose: "اختر لغتك" },
  { code: "ru", name: "Russian", native: "Русский", choose: "Выберите язык" },
  { code: "tr", name: "Turkish", native: "Türkçe", choose: "Dilini seç" },
  { code: "hi", name: "Hindi", native: "हिन्दी", choose: "अपनी भाषा चुनें" },
  { code: "zh", name: "Chinese", native: "中文", choose: "选择你的语言" },
  { code: "ja", name: "Japanese", native: "日本語", choose: "言語を選択" },
  { code: "ko", name: "Korean", native: "한국어", choose: "언어를 선택하세요" },
];

export function languageByCode(code: string | undefined): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

