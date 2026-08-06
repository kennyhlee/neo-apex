// File layout ported from admindash/frontend/src/i18n/translations.ts
// (interface map §1e) — a single TS file keyed by locale, not per-locale
// JSON. Seeded with nav/login/common strings; later tasks add editor/
// definitions/templates keys as those pages are built.

export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar
    'nav.systemName': 'ApexFlow',
    'nav.workflows': 'Workflows',
    'nav.templates': 'Templates',
    'nav.language': 'Language',
    'nav.logout': 'Logout',
    'nav.primary': 'Primary',
    'nav.skipToContent': 'Skip to content',
    'nav.accountMenu': 'Account menu',

    // Not found
    'notFound.title': "That page doesn't exist",
    'notFound.body': 'The link may be out of date, or the address may have a typo in it.',
    'notFound.action': 'Go to Workflows',

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

    // Definitions (placeholder page — Task 5)
    'definitions.title': 'Workflows',
    'definitions.comingSoon': 'The definitions list is coming in Task 5.',

    // Editor (placeholder page — later tasks)
    'editor.title': 'Editor',
    'editor.comingSoon': 'The definition editor is coming in a later task.',

    // Templates (placeholder page — later tasks)
    'templates.title': 'Templates',
    'templates.comingSoon': 'Templates are coming in a later task.',

    // Common
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.page': 'Page',
    'common.of': 'of',
    'common.records': 'records',
    'common.previous': 'Previous',
    'common.next': 'Next',
    'common.showing': 'Showing',
    'common.to': 'to',
    'common.noResults': 'Nothing to show yet',
    'common.retry': 'Try again',
  },
  'zh-CN': {
    // Navbar
    'nav.systemName': 'ApexFlow',
    'nav.workflows': '工作流',
    'nav.templates': '模板',
    'nav.language': '语言',
    'nav.logout': '登出',
    'nav.primary': '主导航',
    'nav.skipToContent': '跳至主要内容',
    'nav.accountMenu': '账户菜单',

    // Not found
    'notFound.title': '页面不存在',
    'notFound.body': '链接可能已失效，或地址输入有误。',
    'notFound.action': '返回工作流',

    // Login
    'login.title': '欢迎回来',
    'login.email': '邮箱',
    'login.emailPlaceholder': '输入邮箱',
    'login.password': '密码',
    'login.passwordPlaceholder': '输入密码',
    'login.submit': '登录',
    'login.invalidCredentials': '邮箱或密码不正确。',
    'login.needAccount': '账户由学校管理员创建。',
    'login.signingIn': '正在登录…',

    // Definitions (placeholder page — Task 5)
    'definitions.title': '工作流',
    'definitions.comingSoon': '定义列表将在任务 5 中推出。',

    // Editor (placeholder page — later tasks)
    'editor.title': '编辑器',
    'editor.comingSoon': '定义编辑器将在后续任务中推出。',

    // Templates (placeholder page — later tasks)
    'templates.title': '模板',
    'templates.comingSoon': '模板将在后续任务中推出。',

    // Common
    'common.loading': '加载中...',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.delete': '删除',
    'common.confirm': '确认',
    'common.close': '关闭',
    'common.yes': '是',
    'common.no': '否',
    'common.page': '页',
    'common.of': '/',
    'common.records': '条记录',
    'common.previous': '上一页',
    'common.next': '下一页',
    'common.showing': '显示',
    'common.to': '至',
    'common.noResults': '暂无内容',
    'common.retry': '重试',
  },
};
