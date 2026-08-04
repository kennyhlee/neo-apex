// flow-runtime/src/i18n.ts
const STRINGS: Record<'en-US' | 'zh-CN', Record<string, string>> = {
  'en-US': {
    required: 'required',
    errRequired: 'Required',
    errNumber: 'Must be a number',
    errEmail: 'Invalid email',
    errPhone: 'Invalid phone number',
    back: 'Back',
    next: 'Save & continue',
    saving: 'Saving…',
    step: 'Step',
    previewNotice: 'Preview — nothing is saved.',
    noFields: 'No fields configured yet.',
    upload: 'Upload',
    replace: 'Replace',
    uploading: 'Uploading…',
    sensitiveDoc: 'Sensitive — staff only',
    postApproval: 'Due after approval',
    choosePlan: 'Choose a payment plan',
    planPayInFull: 'Pay in full',
    planDeposit: 'Deposit now, balance later',
    amountDue: 'Amount due',
    amountAtCheckout: 'Amount is determined at checkout',
    pay: 'Pay',
    paid: 'Paid',
    recordOfflinePayment: 'Record offline payment',
    submitApplication: 'Submit application',
    submitting: 'Submitting…',
    outstandingBefore: 'Complete these required steps before submitting:',
    'status.not_started': 'Not started',
    'status.in_progress': 'In progress',
    'status.submitted': 'Submitted',
    'status.verified': 'Verified',
    'status.rejected': 'Rejected',
    'status.waived': 'Waived',
  },
  'zh-CN': {
    required: '必填',
    errRequired: '必填',
    errNumber: '必须是数字',
    errEmail: '邮箱格式不正确',
    errPhone: '电话号码格式不正确',
    back: '上一步',
    next: '保存并继续',
    saving: '保存中…',
    step: '步骤',
    previewNotice: '预览模式——不会保存任何内容。',
    noFields: '尚未配置任何字段。',
    upload: '上传',
    replace: '重新上传',
    uploading: '上传中…',
    sensitiveDoc: '敏感文件——仅限工作人员查看',
    postApproval: '录取后提交',
    choosePlan: '选择付款方式',
    planPayInFull: '全额付款',
    planDeposit: '先付定金，后付尾款',
    amountDue: '应付金额',
    amountAtCheckout: '金额以结账页面为准',
    pay: '支付',
    paid: '已支付',
    recordOfflinePayment: '记录线下付款',
    submitApplication: '提交申请',
    submitting: '提交中…',
    outstandingBefore: '提交前请完成以下必要步骤：',
    'status.not_started': '未开始',
    'status.in_progress': '进行中',
    'status.submitted': '已提交',
    'status.verified': '已核验',
    'status.rejected': '已退回',
    'status.waived': '已豁免',
  },
};

export function flowLocale(): 'en-US' | 'zh-CN' {
  try {
    return localStorage.getItem('preferredLanguage') === 'zh-CN' ? 'zh-CN' : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Translate a flow-runtime string. Falls back en-US, then the key itself. */
export function flowT(key: string): string {
  return STRINGS[flowLocale()][key] ?? STRINGS['en-US'][key] ?? key;
}
