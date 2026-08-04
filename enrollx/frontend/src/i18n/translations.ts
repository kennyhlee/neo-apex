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

    // Payments settings
    'nav.payments': 'Payments',
    'payments.title': 'Payments',
    'payments.intro':
      "Connect your school's Stripe account to collect registration payments online. Funds settle directly to your Stripe account.",
    'payments.loading': 'Checking connection status…',
    'payments.loadError': 'Could not load your Stripe connection status.',
    'payments.linkError': 'Could not start Stripe onboarding. Please try again.',
    'payments.justConnected': 'Stripe account connected.',
    'payments.callbackError': 'Stripe connection did not complete. Please try again.',
    'payments.connectedTitle': 'Stripe is connected',
    'payments.connectedBody': 'Online payments are enabled for this school.',
    'payments.accountLabel': 'Connected account',
    'payments.notConnectedTitle': 'No Stripe account connected',
    'payments.notConnectedBody':
      'Online payments are disabled until you connect a Stripe account.',
    'payments.connectButton': 'Connect with Stripe',
    'payments.redirecting': 'Redirecting to Stripe…',
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

    // Payments settings
    'nav.payments': '支付',
    'payments.title': '支付设置',
    'payments.intro':
      '连接学校的 Stripe 账户,即可在线收取报名费用。款项将直接结算到您的 Stripe 账户。',
    'payments.loading': '正在检查连接状态…',
    'payments.loadError': '无法加载 Stripe 连接状态。',
    'payments.linkError': '无法启动 Stripe 连接流程,请重试。',
    'payments.justConnected': 'Stripe 账户已连接。',
    'payments.callbackError': 'Stripe 连接未完成,请重试。',
    'payments.connectedTitle': 'Stripe 已连接',
    'payments.connectedBody': '本校已启用在线支付。',
    'payments.accountLabel': '已连接账户',
    'payments.notConnectedTitle': '尚未连接 Stripe 账户',
    'payments.notConnectedBody': '连接 Stripe 账户后才能启用在线支付。',
    'payments.connectButton': '连接 Stripe',
    'payments.redirecting': '正在跳转到 Stripe…',
  },
};
