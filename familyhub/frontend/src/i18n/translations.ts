export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar / shared chrome
    'nav.language': 'Language',

    // Landing
    'landing.explanation':
      'Registration links are specific to your school. If you were expecting to register a student, please use the link your school sent you.',

    // Registration start
    'register.loading': 'Loading registration…',
    'register.notFound': 'This registration link is not available. Check the address with your school.',
    'register.closedTitle': 'Registration is closed',
    'register.closedBody': 'This workflow is no longer accepting new submissions. Already started? Use your emailed link.',
    'register.startUnavailable': 'Registration is temporarily unavailable. Please try again shortly.',
    'register.schoolFull': 'This school year is currently full. You can still apply — you will be placed on the waitlist.',
    'register.schoolYear': 'School year',
    'register.emailLabel': 'Your email',
    'register.emailHelp': 'We will send you a private link to continue and track this application.',
    'register.start': 'Start application',
    'register.startError': 'Could not start the application. Please try again.',
    'register.invalidEmail': 'Please enter a valid email address.',
    'register.linkSent': 'A private link has been sent to your email. Save it — it is how you return to this application from any device.',
    'register.openHub': 'View application status',
    'register.starting': 'Starting…',
    'register.saveError': 'Could not save your progress. Check your connection and try again.',

    // Parent hub
    'hub.title': 'Your application',
    'hub.state': 'Status',
    'hub.loading': 'Loading your application…',
    'hub.invalidLink': 'This link is invalid or has expired.',
    'hub.requestNewLink': 'Request a new link',
    'hub.loadError': 'Could not load your application right now. Check your connection and try again.',
    'hub.checklist': 'Requirements',
    'hub.outstanding': 'Still needed from you',
    'hub.nothingOutstanding': 'Nothing is needed from you right now.',
    'hub.upload': 'Upload',
    'hub.uploading': 'Uploading…',
    'hub.uploadFailed': 'Upload failed. Please try again.',
    'hub.viewDocument': 'View',
    'hub.documentUnavailable': 'This document could not be opened right now. Please try again later.',
    'hub.continueForm': 'Continue form',
    'hub.submitError': 'Could not submit. Complete all required steps and try again.',
    'hub.completeItemError': 'Could not save this step. Please try again.',
    'hub.blocking': 'Required before review',
    'hub.contactSchool': 'Questions? Contact your school directly.',

    // Item statuses
    'itemStatus.not_started': 'Not started',
    'itemStatus.in_progress': 'In progress',
    'itemStatus.submitted': 'Submitted',
    'itemStatus.verified': 'Verified',
    'itemStatus.rejected': 'Needs attention',
    'itemStatus.waived': 'Waived',

    // Request link
    'requestLink.title': 'Get your application link',
    'requestLink.body': 'Enter the email you used to register. If it matches an application, we will email you a fresh link.',
    'requestLink.emailLabel': 'Email',
    'requestLink.tenantLabel': 'School code',
    'requestLink.send': 'Send link',
    'requestLink.sent': 'If that email matches an application, a link is on its way.',

    // Shared
    'common.retry': 'Retry',
  },
  'zh-CN': {
    // Navbar / shared chrome
    'nav.language': '语言',

    // Landing
    'landing.explanation':
      '报名链接由各学校单独提供。如果您希望为学生报名，请使用学校发送给您的链接。',

    // Registration start
    'register.loading': '正在加载注册信息…',
    'register.notFound': '该注册链接不可用。请与学校核对网址。',
    'register.closedTitle': '报名已关闭',
    'register.closedBody': '该流程目前不再接受新的申请。已开始申请？请使用邮件中发送给您的链接。',
    'register.startUnavailable': '报名暂时不可用，请稍后重试。',
    'register.schoolFull': '本学年名额已满。您仍可提交申请，将进入候补名单。',
    'register.schoolYear': '学年',
    'register.emailLabel': '您的邮箱',
    'register.emailHelp': '我们会向您发送一个专属链接，用于继续填写和跟踪此申请。',
    'register.start': '开始申请',
    'register.startError': '无法开始申请，请重试。',
    'register.invalidEmail': '请输入有效的邮箱地址。',
    'register.linkSent': '专属链接已发送到您的邮箱。请妥善保存，您可在任何设备上通过它返回此申请。',
    'register.openHub': '查看申请状态',
    'register.starting': '正在提交…',
    'register.saveError': '无法保存您的进度。请检查网络连接后重试。',

    // Parent hub
    'hub.title': '您的申请',
    'hub.state': '状态',
    'hub.loading': '正在加载您的申请…',
    'hub.invalidLink': '该链接无效或已过期。',
    'hub.requestNewLink': '获取新链接',
    'hub.loadError': '暂时无法加载您的申请，请检查网络连接后重试。',
    'hub.checklist': '申请项目',
    'hub.outstanding': '待您完成',
    'hub.nothingOutstanding': '目前无需您进行任何操作。',
    'hub.upload': '上传',
    'hub.uploading': '上传中…',
    'hub.uploadFailed': '上传失败，请重试。',
    'hub.viewDocument': '查看',
    'hub.documentUnavailable': '该文件暂时无法打开，请稍后重试。',
    'hub.continueForm': '继续填写',
    'hub.submitError': '无法提交。请完成所有必填步骤后重试。',
    'hub.completeItemError': '无法保存此步骤，请重试。',
    'hub.blocking': '审核前必须完成',
    'hub.contactSchool': '如有疑问，请直接联系学校。',

    // Item statuses
    'itemStatus.not_started': '未开始',
    'itemStatus.in_progress': '进行中',
    'itemStatus.submitted': '已提交',
    'itemStatus.verified': '已核验',
    'itemStatus.rejected': '需重新处理',
    'itemStatus.waived': '已豁免',

    // Request link
    'requestLink.title': '找回申请链接',
    'requestLink.body': '请输入注册时使用的邮箱。如果与某个申请匹配，我们会向您发送新的链接。',
    'requestLink.emailLabel': '邮箱',
    'requestLink.tenantLabel': '学校代码',
    'requestLink.send': '发送链接',
    'requestLink.sent': '如果该邮箱与申请匹配，链接已发送。',

    // Shared
    'common.retry': '重试',
  },
};
