export type Locale = 'en-US' | 'zh-CN';

export const translations: Record<Locale, Record<string, string>> = {
  'en-US': {
    // Navbar / shared chrome
    'nav.language': 'Language',

    // Landing
    'landing.explanation':
      'Registration links are program-specific. If you were expecting to register a student, please use the link your school sent you.',

    // Registration start
    'register.loading': 'Loading registration…',
    'register.notFound': 'This registration link is not available. Check the address with your school.',
    'register.programFull': 'This program is currently full. You can still apply — you will be placed on the waitlist.',
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
    'hub.payNow': 'Pay now',
    'hub.amountDue': 'Amount due: {amount}',
    'hub.payError': 'Could not start payment. Please try again.',
    'hub.submit': 'Submit application',
    'hub.submitError': 'Could not submit. Complete all required steps and try again.',
    'hub.completeItemError': 'Could not save this step. Please try again.',
    'hub.blocking': 'Required before review',
    'hub.contactSchool': 'Questions? Contact your school directly.',

    // Application statuses
    'status.draft': 'Draft',
    'status.submitted': 'Submitted',
    'status.in_review': 'In review',
    'status.pending_items': 'Action needed',
    'status.approved': 'Approved',
    'status.enrolled': 'Enrolled',
    'status.waitlisted': 'Waitlisted',
    'status.declined': 'Declined',
    'status.withdrawn': 'Withdrawn',
    'statusBanner.draft': 'Your application is a draft — submit it once every required step is complete.',
    'statusBanner.submitted': 'Your application has been submitted and is waiting for review.',
    'statusBanner.in_review': 'The school is reviewing your application.',
    'statusBanner.pending_items': 'The school needs something more from you — see the list below.',
    'statusBanner.approved': 'Congratulations — your application is approved! Finish any remaining items below.',
    'statusBanner.enrolled': 'Enrollment complete. Welcome!',
    'statusBanner.waitlisted': 'The program is currently full. You are on the waitlist and will be contacted if a spot opens.',
    'statusBanner.declined': 'This application was not accepted. Contact the school if you have questions.',
    'statusBanner.withdrawn': 'This application has been withdrawn.',

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
      '注册链接与具体项目相关联。如果您希望为学生注册，请使用学校发送给您的链接。',

    // Registration start
    'register.loading': '正在加载注册信息…',
    'register.notFound': '该注册链接不可用。请与学校核对网址。',
    'register.programFull': '该项目目前已满员。您仍可提交申请，将进入候补名单。',
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
    'hub.payNow': '立即支付',
    'hub.amountDue': '应付金额：{amount}',
    'hub.payError': '无法发起支付，请重试。',
    'hub.submit': '提交申请',
    'hub.submitError': '无法提交。请完成所有必填步骤后重试。',
    'hub.completeItemError': '无法保存此步骤，请重试。',
    'hub.blocking': '审核前必须完成',
    'hub.contactSchool': '如有疑问，请直接联系学校。',

    // Application statuses
    'status.draft': '草稿',
    'status.submitted': '已提交',
    'status.in_review': '审核中',
    'status.pending_items': '需补充材料',
    'status.approved': '已录取',
    'status.enrolled': '已入学',
    'status.waitlisted': '候补中',
    'status.declined': '未录取',
    'status.withdrawn': '已撤回',
    'statusBanner.draft': '您的申请尚为草稿，完成所有必填步骤后请提交。',
    'statusBanner.submitted': '您的申请已提交，正在等待审核。',
    'statusBanner.in_review': '学校正在审核您的申请。',
    'statusBanner.pending_items': '学校需要您补充材料，请查看下方列表。',
    'statusBanner.approved': '恭喜，您的申请已通过！请完成下方剩余事项。',
    'statusBanner.enrolled': '入学手续已完成，欢迎加入！',
    'statusBanner.waitlisted': '该项目目前已满员。您已进入候补名单，如有名额我们会与您联系。',
    'statusBanner.declined': '该申请未被录取。如有疑问请联系学校。',
    'statusBanner.withdrawn': '该申请已撤回。',

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
