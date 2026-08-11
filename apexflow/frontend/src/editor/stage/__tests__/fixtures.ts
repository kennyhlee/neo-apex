// Hand-transcribed from apexflow/backend/app/templates/signup.py. Kept in
// sync by tests/test_signup_template.py's shape assertions on the Python
// side and by round-trip.test.ts's own counts on this side.
import type { MachineDef, WorkflowStepDef } from '../../../types/designer.ts';

const familyRole = { primitive: 'actor_role', params: { roles: ['family'] } };
const staffRole = { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } };

const formComplete = {
  primitive: 'items_in_status',
  params: { step_ids: ['signup_form'], status: ['submitted', 'verified'], quantifier: 'all' },
};
const capacity = {
  primitive: 'capacity_available',
  params: {
    count_states: ['offered', 'confirmed'],
    capacity_field: 'capacity',
    scope_context_key: 'program_id',
  },
};
const confirmEffects = [
  {
    primitive: 'commit_sections',
    params: { section_ids: ['family_section', 'student_section', 'signup_section'] },
  },
  { primitive: 'set_entity_field', params: { ref: 'enrollment', field: 'status', value: 'Active' } },
  { primitive: 'send_email', params: { template: 'signup_confirmed' } },
];

function dropPair(from: string) {
  const effects =
    from === 'confirmed'
      ? [
          {
            primitive: 'set_entity_field',
            params: { ref: 'enrollment', field: 'status', value: 'Withdrawn' },
          },
        ]
      : [];
  return [
    {
      transition_id: `t_drop_${from}_family`,
      from,
      to: 'dropped',
      action: 'drop',
      actor: 'family' as const,
      guards: [familyRole],
      effects: [...effects],
    },
    {
      transition_id: `t_drop_${from}_staff`,
      from,
      to: 'dropped',
      action: 'drop',
      actor: 'staff' as const,
      guards: [staffRole],
      effects: [...effects],
    },
  ];
}

export const SIGNUP_MACHINE: MachineDef = {
  states: [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'waitlisted', name: 'Waitlisted', kind: 'active' },
    { state_id: 'offered', name: 'Spot Offered', kind: 'active' },
    { state_id: 'confirmed', name: 'Confirmed', kind: 'active' },
    { state_id: 'completed', name: 'Completed', kind: 'terminal' },
    { state_id: 'dropped', name: 'Dropped', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't_submit_confirmed',
      from: 'draft',
      to: 'confirmed',
      action: 'submit',
      actor: 'family',
      guards: [capacity, formComplete],
      effects: confirmEffects,
    },
    {
      transition_id: 't_submit_waitlisted',
      from: 'draft',
      to: 'waitlisted',
      action: 'submit',
      actor: 'family',
      guards: [formComplete],
      effects: [{ primitive: 'send_email', params: { template: 'signup_waitlisted' } }],
    },
    ...dropPair('draft'),
    {
      transition_id: 't_offer_spot',
      from: 'waitlisted',
      to: 'offered',
      action: 'offer_spot',
      actor: 'staff',
      guards: [],
      effects: [
        { primitive: 'issue_link', params: {} },
        { primitive: 'send_email', params: { template: 'signup_offer' } },
      ],
    },
    ...dropPair('waitlisted'),
    {
      transition_id: 't_accept_offer',
      from: 'offered',
      to: 'confirmed',
      action: 'accept_offer',
      actor: 'family',
      guards: [formComplete],
      effects: confirmEffects,
    },
    {
      transition_id: 't_decline_offer',
      from: 'offered',
      to: 'waitlisted',
      action: 'decline_offer',
      actor: 'family',
      guards: [],
      effects: [],
    },
    {
      transition_id: 't_rescind_offer',
      from: 'offered',
      to: 'waitlisted',
      action: 'rescind_offer',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'signup_offer_expired' } }],
    },
    ...dropPair('offered'),
    {
      transition_id: 't_complete_program',
      from: 'confirmed',
      to: 'completed',
      action: 'complete_program',
      actor: 'staff',
      guards: [],
      effects: [
        {
          primitive: 'set_entity_field',
          params: { ref: 'enrollment', field: 'status', value: 'Completed' },
        },
      ],
    },
    ...dropPair('confirmed'),
  ],
};

export const SIGNUP_STEPS: WorkflowStepDef[] = [
  {
    step_id: 'welcome',
    type: 'message',
    title: 'Welcome',
    required: false,
    blocking: false,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { body: 'Fill in the form below to sign up for a program.' },
  },
  {
    step_id: 'signup_form',
    type: 'form',
    title: 'Signup Details',
    required: true,
    blocking: true,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { sections: [] },
  },
  {
    step_id: 'waitlist_notice',
    type: 'message',
    title: "You're on the Waitlist",
    required: false,
    blocking: false,
    available_in: ['waitlisted'],
    show_if: null,
    review: null,
    config: { body: "This program is full. We'll contact you as soon as a spot opens." },
  },
  {
    step_id: 'offer_notice',
    type: 'message',
    title: 'A Spot Is Open',
    required: false,
    blocking: false,
    available_in: ['offered'],
    show_if: null,
    review: null,
    config: { body: 'A spot has opened up. Accept below to confirm your place.' },
  },
  {
    step_id: 'confirmation_notice',
    type: 'message',
    title: "You're Signed Up",
    required: false,
    blocking: false,
    available_in: ['confirmed'],
    show_if: null,
    review: null,
    config: { body: "Your signup is confirmed. We'll see you on the start date." },
  },
];

// Hand-transcribed from apexflow/backend/app/templates/enrollment.py.
const appFormComplete = {
  primitive: 'items_in_status',
  params: { step_ids: ['application_form'], status: ['submitted', 'verified'], quantifier: 'all' },
};
const approveEffects = [
  {
    primitive: 'commit_sections',
    params: {
      section_ids: ['family_section', 'student_section', 'contacts_section', 'application_section'],
    },
  },
  { primitive: 'set_entity_field', params: { ref: 'student', field: 'status', value: 'Enrolled' } },
  { primitive: 'start_due_clocks', params: { step_ids: ['documents'] } },
  { primitive: 'send_email', params: { template: 'approved' } },
];

function withdrawPair(from: string) {
  return [
    {
      transition_id: `t_withdraw_${from}_family`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'family' as const,
      guards: [familyRole],
      effects: [],
    },
    {
      transition_id: `t_withdraw_${from}_staff`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'staff' as const,
      guards: [staffRole],
      effects: [],
    },
  ];
}

export const ENROLLMENT_MACHINE: MachineDef = {
  states: [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'submitted', name: 'Submitted', kind: 'active' },
    { state_id: 'in_review', name: 'In Review', kind: 'active' },
    { state_id: 'pending_items', name: 'Pending Items', kind: 'active' },
    { state_id: 'approved', name: 'Approved', kind: 'active' },
    { state_id: 'enrolled', name: 'Enrolled', kind: 'terminal' },
    { state_id: 'waitlisted', name: 'Waitlisted', kind: 'active' },
    { state_id: 'declined', name: 'Declined', kind: 'terminal' },
    { state_id: 'withdrawn', name: 'Withdrawn', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't_submit_submitted',
      from: 'draft',
      to: 'submitted',
      action: 'submit',
      actor: 'family',
      guards: [
        {
          primitive: 'capacity_available',
          params: {
            count_states: ['approved', 'enrolled'],
            capacity_field: 'capacity',
            scope_context_key: 'school_year',
          },
        },
        appFormComplete,
      ],
      effects: [],
    },
    {
      transition_id: 't_submit_waitlisted',
      from: 'draft',
      to: 'waitlisted',
      action: 'submit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [{ primitive: 'send_email', params: { template: 'waitlisted' } }],
    },
    ...withdrawPair('draft'),
    {
      transition_id: 't_route_to_review',
      from: 'submitted',
      to: 'in_review',
      action: 'route_to_review',
      actor: 'system',
      guards: [],
      effects: [],
    },
    ...withdrawPair('submitted'),
    {
      transition_id: 't_promote_waitlist',
      from: 'waitlisted',
      to: 'in_review',
      action: 'promote_waitlist',
      actor: 'staff',
      guards: [],
      effects: [],
    },
    ...withdrawPair('waitlisted'),
    {
      transition_id: 't_approve',
      from: 'in_review',
      to: 'approved',
      action: 'approve',
      actor: 'staff',
      guards: [],
      effects: approveEffects,
    },
    {
      transition_id: 't_decline_review',
      from: 'in_review',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_request_changes',
      from: 'in_review',
      to: 'pending_items',
      action: 'request_changes',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'changes_requested' } }],
    },
    {
      transition_id: 't_flag_pending_items',
      from: 'in_review',
      to: 'pending_items',
      action: 'flag_pending_items',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['application_form'], status: 'rejected', quantifier: 'any' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('in_review'),
    {
      transition_id: 't_decline_pending',
      from: 'pending_items',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_resubmit',
      from: 'pending_items',
      to: 'in_review',
      action: 'resubmit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [],
    },
    ...withdrawPair('pending_items'),
    {
      transition_id: 't_finalize_enrollment',
      from: 'approved',
      to: 'enrolled',
      action: 'finalize_enrollment',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['documents'], status: ['verified', 'waived'], quantifier: 'all' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('approved'),
  ],
};

export const ENROLLMENT_STEPS: WorkflowStepDef[] = [
  {
    step_id: 'welcome',
    type: 'message',
    title: 'Welcome',
    required: false,
    blocking: false,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { body: 'Welcome!' },
  },
  {
    step_id: 'application_form',
    type: 'form',
    title: 'Application Details',
    required: true,
    blocking: true,
    available_in: ['draft', 'pending_items'],
    show_if: null,
    review: 'staff',
    config: { sections: [] },
  },
  {
    step_id: 'documents',
    type: 'documents',
    title: 'Required Documents',
    required: true,
    blocking: true,
    available_in: ['approved'],
    show_if: null,
    review: null,
    config: { docs: [] },
  },
  {
    step_id: 'review_notice',
    type: 'message',
    title: 'Application Under Review',
    required: false,
    blocking: false,
    available_in: ['in_review', 'pending_items', 'approved'],
    show_if: null,
    review: null,
    config: { body: 'Thanks for applying!' },
  },
];
