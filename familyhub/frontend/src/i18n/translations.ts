export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar / shared chrome
    'nav.language': 'Language',

    // Landing
    'landing.explanation':
      'Registration links are program-specific. If you were expecting to register a student, please use the link your school sent you.',
  },
  'zh-CN': {
    // Navbar / shared chrome
    'nav.language': '语言',

    // Landing
    'landing.explanation':
      '注册链接与具体项目相关联。如果您希望为学生注册，请使用学校发送给您的链接。',
  },
};
