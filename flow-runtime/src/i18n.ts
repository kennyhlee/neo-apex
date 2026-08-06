// flow-runtime/src/i18n.ts
import { createContext, useContext } from 'react';

export type Locale = 'en-US' | 'zh-CN';

const STRINGS: Record<Locale, Record<string, string>> = {
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
    stepsNav: 'Registration steps',
    previewNotice: 'Preview — nothing is saved.',
    noFields: 'No fields configured yet.',
    school: 'School',
    schoolYear: 'School year',
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
    addAnother: 'Add another',
    removeRow: 'Remove',
    acknowledgeMessage: 'I acknowledge this message.',
    markComplete: 'Mark complete',
    acknowledge: 'Acknowledge',
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
    stepsNav: '注册步骤',
    previewNotice: '预览模式——不会保存任何内容。',
    noFields: '尚未配置任何字段。',
    school: '学校',
    schoolYear: '学年',
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
    addAnother: '添加一项',
    removeRow: '删除',
    acknowledgeMessage: '我已知悉此消息。',
    markComplete: '标记为已完成',
    acknowledge: '确认知悉',
  },
};

export function flowLocale(): Locale {
  try {
    return localStorage.getItem('preferredLanguage') === 'zh-CN' ? 'zh-CN' : 'en-US';
  } catch {
    return 'en-US';
  }
}

function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? STRINGS['en-US'][key] ?? key;
}

/**
 * Translate a flow-runtime string, reading the locale fresh from
 * localStorage on every call. Non-reactive: use this only from non-component
 * call sites (e.g. deriving a plain string outside render). Block components
 * must use `useFlowT()` instead, or a locale toggle stops reaching them the
 * moment they're wrapped in `React.memo` (no prop changes on toggle).
 */
export function flowT(key: string): string {
  return translate(flowLocale(), key);
}

/**
 * `flowT` with an explicit locale, falling back to `flowLocale()` when the
 * caller has none.
 *
 * Exists for PURE functions — `validateFlowField` and anything like it —
 * which cannot use `useFlowT()` because they are not components, but must
 * still be able to honour a locale their caller already knows. Passing a
 * `Locale` rather than a `t` function keeps those functions pure and keeps
 * callers from having to know flow-runtime's key names.
 */
export function flowTWith(locale: Locale | undefined, key: string): string {
  return translate(locale ?? flowLocale(), key);
}

/**
 * Locale a host has injected via a Provider on this context. `null` means no
 * ancestor supplied one — `useFlowT` falls back to `flowLocale()` in that
 * case. No current consumer mounts a Provider (the registration-era
 * `FlowRenderer` did, via a `locale` prop; it is retired) — `useFlowLocale`
 * therefore always resolves through `flowLocale()` today, but the context
 * stays so a future host can inject an explicit locale without every
 * `useFlowT()` call site changing.
 */
export const FlowLocaleContext = createContext<Locale | null>(null);

/**
 * Component-scoped translate function, reactive to whatever locale
 * `FlowLocaleContext` carries (see above). Callers must use this instead of
 * `flowT` directly, so a language toggle keeps reaching them even once
 * they're wrapped in `React.memo`.
 */
export function useFlowT(): (key: string) => string {
  const locale = useFlowLocale();
  return (key: string) => translate(locale, key);
}

/**
 * The resolved locale itself, for components that must hand it to a pure
 * function rather than translate with it directly (see `flowTWith`).
 */
export function useFlowLocale(): Locale {
  return useContext(FlowLocaleContext) ?? flowLocale();
}
