// Best-effort extraction of lead fields from a pasted inquiry email.
// Handles both labeled emails ("Name: Jane Doe" / "Phone: 555-1234") and
// free-prose emails ("Hi, my name is Jane Doe and my son Max ...").
export interface ParsedInquiry {
  guardian_name?: string;
  email?: string;
  phone?: string;
  student_first_name?: string;
  student_last_name?: string;
  message?: string;
}

// Value of a "Label: value" (or "Label - value") line for any of the alternatives.
function labeled(text: string, labels: string): string | undefined {
  const m = text.match(new RegExp(`^[ \\t]*(?:${labels})[ \\t]*[:\\-][ \\t]*(.+?)[ \\t]*$`, 'im'));
  return m ? m[1].trim() : undefined;
}

function splitName(full: string): { first?: string; last?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function parseInquiryEmail(text: string): ParsedInquiry {
  const out: ParsedInquiry = {};

  // Email — first address anywhere in the text (strip trailing sentence punctuation).
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0].replace(/[.,;:]+$/, '');

  // Phone — labeled first, then the first phone-like run of digits.
  const phoneRaw =
    labeled(text, 'phone|tel|telephone|mobile|cell|contact number') ??
    text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[1];
  if (phoneRaw && phoneRaw.replace(/\D/g, '').length >= 7) out.phone = phoneRaw.trim();

  // Guardian name — labeled, then "my name is X", then a signature line.
  let name =
    labeled(text, 'name|parent name|guardian name|parent/?guardian|parent|guardian|from') ??
    text.match(/\bmy name is\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/)?.[1] ??
    text.match(
      /^[ \t]*(?:regards|thanks|thank you|sincerely|best|cheers)[,!]?[ \t]*\r?\n+[ \t]*([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})[ \t]*$/im,
    )?.[1];
  if (name) {
    // Drop an email address the label may have swept up ("Jane Doe <jane@x.com>").
    name = name.replace(/<[^>]*>/g, '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '').trim();
    if (name && /[A-Za-z]/.test(name) && name.split(/\s+/).length <= 4) out.guardian_name = name;
  }

  // Student name — labeled child/student, or "my son/daughter/child (named) X Y".
  const studentName =
    labeled(text, 'student|student name|child|child name|son|daughter') ??
    text.match(
      /\bmy (?:son|daughter|child)(?:,?\s+(?:named|is|called))?\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)/,
    )?.[1];
  if (studentName) {
    const { first, last } = splitName(studentName);
    if (first) out.student_first_name = first;
    if (last) out.student_last_name = last;
  }

  // Message — prefer a labeled comments/message block; otherwise the body with the
  // lines we already pulled out as structured fields removed (so it isn't a raw dump).
  const msgLabeled = labeled(text, 'message|comments?|notes?|inquiry|enquiry|regarding|reason|questions?');
  if (msgLabeled) {
    out.message = msgLabeled.slice(0, 2000);
  } else {
    const noise =
      /^[ \t]*(?:name|parent|guardian|from|to|subject|date|sent|phone|tel|telephone|mobile|cell|e-?mail|student|child|son|daughter|grade)[ \t]*[-:]/i;
    const body = text
      .split(/\r?\n/)
      .filter((l) => l.trim() && !noise.test(l))
      .join('\n')
      .trim();
    if (body) out.message = body.slice(0, 2000);
  }

  return out;
}
