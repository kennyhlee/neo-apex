export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar / shared chrome
    'nav.language': 'Language',

    // Login
    'login.title': 'Welcome Back',
    'login.email': 'Email',
    'login.emailPlaceholder': 'Enter email',
    'login.password': 'Password',
    'login.passwordPlaceholder': 'Enter password',
    'login.submit': 'Sign In',
    'login.invalidCredentials': "That email and password don't match an account.",
    'login.needAccount': 'Accounts are created by your school administrator.',
    'login.signingIn': 'Signing in…',
  },
  'zh-CN': {
    // Navbar / shared chrome
    'nav.language': '语言',

    // Login
    'login.title': '欢迎回来',
    'login.email': '邮箱',
    'login.emailPlaceholder': '请输入邮箱',
    'login.password': '密码',
    'login.passwordPlaceholder': '请输入密码',
    'login.submit': '登录',
    'login.invalidCredentials': '邮箱与密码不匹配。',
    'login.needAccount': '账号由贵校管理员创建。',
    'login.signingIn': '正在登录…',
  },
};
