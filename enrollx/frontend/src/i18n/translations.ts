export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar / shared chrome
    'nav.language': 'Language',
    'nav.primary': 'Primary',
    'nav.programs': 'Programs',
    'nav.applications': 'Applications',
    'nav.settings': 'Settings',
    'nav.logout': 'Log out',

    // Shared UI (DataTable, Toast, forms)
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.records': 'records',
    'common.next': 'Next',
    'common.previous': 'Previous',
    'common.of': 'of',
    'common.showing': 'Showing',
    'common.to': 'to',
    'common.noResults': 'No results',
    'students.pageSize': 'Rows per page', // key name kept so the copied DataTable works unmodified

    // Application statuses
    'status.draft': 'Draft',
    'status.submitted': 'Submitted',
    'status.in_review': 'In review',
    'status.pending_items': 'Pending items',
    'status.approved': 'Approved',
    'status.enrolled': 'Enrolled',
    'status.waitlisted': 'Waitlisted',
    'status.declined': 'Declined',
    'status.withdrawn': 'Withdrawn',

    // Item statuses
    'itemStatus.not_started': 'Not started',
    'itemStatus.in_progress': 'In progress',
    'itemStatus.submitted': 'Submitted',
    'itemStatus.verified': 'Verified',
    'itemStatus.rejected': 'Rejected',
    'itemStatus.waived': 'Waived',

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
    'nav.primary': '主导航',
    'nav.programs': '项目',
    'nav.applications': '报名申请',
    'nav.settings': '设置',
    'nav.logout': '退出登录',

    // Shared UI (DataTable, Toast, forms)
    'common.cancel': '取消',
    'common.save': '保存',
    'common.loading': '加载中…',
    'common.retry': '重试',
    'common.records': '条记录',
    'common.next': '下一页',
    'common.previous': '上一页',
    'common.of': '共',
    'common.showing': '显示',
    'common.to': '至',
    'common.noResults': '没有结果',
    'students.pageSize': '每页行数',

    // Application statuses
    'status.draft': '草稿',
    'status.submitted': '已提交',
    'status.in_review': '审核中',
    'status.pending_items': '待补材料',
    'status.approved': '已录取',
    'status.enrolled': '已入学',
    'status.waitlisted': '候补中',
    'status.declined': '未录取',
    'status.withdrawn': '已退出',

    // Item statuses
    'itemStatus.not_started': '未开始',
    'itemStatus.in_progress': '进行中',
    'itemStatus.submitted': '已提交',
    'itemStatus.verified': '已核验',
    'itemStatus.rejected': '已退回',
    'itemStatus.waived': '已豁免',

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
