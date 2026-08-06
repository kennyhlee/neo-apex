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

    // Definitions (list page — Task 5)
    'definitions.title': 'Workflows',
    'definitions.lineageCount': '{n} workflow(s)',
    'definitions.newWorkflow': 'New workflow',
    'definitions.fromTemplate': 'From template',
    'definitions.loadError': "Couldn't load workflows.",
    'definitions.emptyTitle': 'No workflows yet',
    'definitions.emptyBody': 'Start from a template, or build one from scratch.',

    'definitions.columns.name': 'Name',
    'definitions.columns.definitionId': 'Workflow ID',
    'definitions.columns.version': 'Version',
    'definitions.columns.status': 'Status',
    'definitions.columns.lineageStatus': 'Lineage',
    'definitions.columns.health': 'Health',
    'definitions.columns.openInstances': 'Open instances',
    'definitions.columns.channel': 'Channel',

    // Badge label overrides — StatusBadge's default label is the raw enum
    // value (fine in en-US only by accident); every value each column can
    // show gets a translated key.
    'definitions.status.draft': 'Draft',
    'definitions.status.published': 'Published',
    'definitions.status.superseded': 'Superseded',
    'definitions.lineageStatus.active': 'Active',
    'definitions.lineageStatus.deprecated': 'Deprecated',
    'definitions.lineageStatus.retired': 'Retired',
    'definitions.health.current': 'Current',
    'definitions.health.stale': 'Stale',
    'definitions.health.broken': 'Broken',
    'definitions.health.superseded': 'Superseded',

    'definitions.channel.staffOnly': 'Staff only',
    'definitions.channel.family': 'Family',
    'definitions.channel.familyLinkLabel': 'Open family link',

    'definitions.actions.openEditor': 'Open editor',
    'definitions.actions.newDraft': 'New draft',
    'definitions.actions.deprecate': 'Deprecate',
    'definitions.actions.reactivate': 'Reactivate',
    'definitions.actions.retire': 'Retire',

    'definitions.newWorkflowModalTitle': 'New workflow',
    'definitions.newWorkflowNameLabel': 'Name',
    'definitions.newWorkflowNamePlaceholder': 'e.g. Summer Camp Enrollment',
    'definitions.newWorkflowNameRequired': 'Enter a name for the workflow.',
    'definitions.newWorkflowCreating': 'Creating…',
    'definitions.newWorkflowCreate': 'Create',
    'definitions.newWorkflowError': "Couldn't create the workflow. Try again.",

    'definitions.newDraftCreating': 'Creating…',
    'definitions.newDraftToast': 'Draft v{v} created.',
    'definitions.newDraftError': "Couldn't create a new draft. Try again.",

    'definitions.deprecateConfirmTitle': 'Deprecate this workflow?',
    'definitions.deprecateConfirmBody':
      'Staff and families will no longer be able to start "{name}". Applications already in progress keep running.',
    'definitions.reactivateConfirmTitle': 'Reactivate this workflow?',
    'definitions.reactivateConfirmBody': 'People will be able to start "{name}" again.',
    'definitions.deprecateToast': '"{name}" deprecated.',
    'definitions.reactivateToast': '"{name}" reactivated.',
    'definitions.lifecycleError': "Couldn't update the workflow. Try again.",

    'definitions.retireConfirmTitle': 'Retire this workflow?',
    'definitions.retireConfirmBody':
      'Retiring is permanent. New applications can no longer be started for this workflow.',
    'definitions.retireOpenInstances': '{n} application(s) are still open for this workflow.',
    'definitions.retireForceCancel': 'Also cancel {n} open application(s).',
    'definitions.retireConfirm': 'Retire',
    'definitions.retiring': 'Retiring…',
    'definitions.retireToast': '"{name}" retired.',
    'definitions.retireBlockedToast': "Can't retire — {n} application(s) are still open.",

    // Editor (placeholder page — later tasks)
    'editor.title': 'Editor',
    'editor.comingSoon': 'The definition editor is coming in a later task.',

    // Templates (gallery page — Task 6)
    'templates.title': 'Templates',
    'templates.loadError': "Couldn't load templates.",
    'templates.empty': 'No templates available yet.',
    'templates.stepCount': 'Steps',
    'templates.stateCount': 'States',
    'templates.useTemplate': 'Use template',
    'templates.useModalTitle': 'Name your workflow',
    'templates.useNameLabel': 'Name',
    'templates.useNamePlaceholder': 'e.g. Summer Camp Enrollment',
    'templates.useNameRequired': 'Enter a name for the workflow.',
    'templates.useCreating': 'Creating…',
    'templates.useCreate': 'Create',
    'templates.useToast': '"{name}" created from template.',
    'templates.useError': "Couldn't create a workflow from this template. Try again.",

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
    'common.rowsPerPage': 'Rows per page',
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

    // Definitions (list page — Task 5)
    'definitions.title': '工作流',
    'definitions.lineageCount': '{n} 个工作流',
    'definitions.newWorkflow': '新建工作流',
    'definitions.fromTemplate': '从模板创建',
    'definitions.loadError': '无法加载工作流。',
    'definitions.emptyTitle': '暂无工作流',
    'definitions.emptyBody': '从模板开始，或从头创建一个。',

    'definitions.columns.name': '名称',
    'definitions.columns.definitionId': '工作流 ID',
    'definitions.columns.version': '版本',
    'definitions.columns.status': '状态',
    'definitions.columns.lineageStatus': '生命周期',
    'definitions.columns.health': '健康状态',
    'definitions.columns.openInstances': '进行中的申请',
    'definitions.columns.channel': '渠道',

    'definitions.status.draft': '草稿',
    'definitions.status.published': '已发布',
    'definitions.status.superseded': '已替代',
    'definitions.lineageStatus.active': '生效中',
    'definitions.lineageStatus.deprecated': '已停用',
    'definitions.lineageStatus.retired': '已淘汰',
    'definitions.health.current': '正常',
    'definitions.health.stale': '需要更新',
    'definitions.health.broken': '有问题',
    'definitions.health.superseded': '已替代',

    'definitions.channel.staffOnly': '仅限员工',
    'definitions.channel.family': '家庭端',
    'definitions.channel.familyLinkLabel': '打开家庭端链接',

    'definitions.actions.openEditor': '打开编辑器',
    'definitions.actions.newDraft': '新建草稿',
    'definitions.actions.deprecate': '停用',
    'definitions.actions.reactivate': '重新启用',
    'definitions.actions.retire': '淘汰',

    'definitions.newWorkflowModalTitle': '新建工作流',
    'definitions.newWorkflowNameLabel': '名称',
    'definitions.newWorkflowNamePlaceholder': '例如：暑期营报名',
    'definitions.newWorkflowNameRequired': '请输入工作流名称。',
    'definitions.newWorkflowCreating': '正在创建…',
    'definitions.newWorkflowCreate': '创建',
    'definitions.newWorkflowError': '无法创建工作流，请重试。',

    'definitions.newDraftCreating': '正在创建…',
    'definitions.newDraftToast': '已创建草稿 v{v}。',
    'definitions.newDraftError': '无法创建新草稿，请重试。',

    'definitions.deprecateConfirmTitle': '停用此工作流？',
    'definitions.deprecateConfirmBody': '员工和家庭将无法再发起"{name}"。已在进行中的申请不受影响。',
    'definitions.reactivateConfirmTitle': '重新启用此工作流？',
    'definitions.reactivateConfirmBody': '重新启用后，可再次发起"{name}"。',
    'definitions.deprecateToast': '"{name}" 已停用。',
    'definitions.reactivateToast': '"{name}" 已重新启用。',
    'definitions.lifecycleError': '无法更新工作流，请重试。',

    'definitions.retireConfirmTitle': '淘汰此工作流？',
    'definitions.retireConfirmBody': '淘汰操作不可撤销，此后将无法为该工作流发起新的申请。',
    'definitions.retireOpenInstances': '此工作流仍有 {n} 个进行中的申请。',
    'definitions.retireForceCancel': '同时取消 {n} 个进行中的申请。',
    'definitions.retireConfirm': '淘汰',
    'definitions.retiring': '正在淘汰…',
    'definitions.retireToast': '"{name}" 已淘汰。',
    'definitions.retireBlockedToast': '无法淘汰 — 仍有 {n} 个进行中的申请。',

    // Editor (placeholder page — later tasks)
    'editor.title': '编辑器',
    'editor.comingSoon': '定义编辑器将在后续任务中推出。',

    // Templates (gallery page — Task 6)
    'templates.title': '模板',
    'templates.loadError': '无法加载模板。',
    'templates.empty': '暂无可用模板。',
    'templates.stepCount': '步骤数',
    'templates.stateCount': '状态数',
    'templates.useTemplate': '使用模板',
    'templates.useModalTitle': '为工作流命名',
    'templates.useNameLabel': '名称',
    'templates.useNamePlaceholder': '例如：暑期营报名',
    'templates.useNameRequired': '请输入工作流名称。',
    'templates.useCreating': '正在创建…',
    'templates.useCreate': '创建',
    'templates.useToast': '已从模板创建 "{name}"。',
    'templates.useError': '无法从此模板创建工作流，请重试。',

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
    'common.rowsPerPage': '每页行数',
  },
};
