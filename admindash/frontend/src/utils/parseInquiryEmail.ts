// Best-effort extraction of lead fields from a pasted inquiry email.
export interface ParsedInquiry {
  guardian_name?: string;
  email?: string;
  phone?: string;
  student_first_name?: string;
  student_last_name?: string;
  message?: string;
}

export function parseInquiryEmail(text: string): ParsedInquiry {
  const out: ParsedInquiry = {};
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0];
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phone) out.phone = phone[1].trim();
  const name = text.match(/(?:my name is|from|regards,|thanks,|sincerely,)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (name) out.guardian_name = name[1].trim();
  const student = text.match(/(?:my child|my son|my daughter|student)\s+(?:is\s+)?([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i);
  if (student) { out.student_first_name = student[1]; if (student[2]) out.student_last_name = student[2]; }
  out.message = text.trim().slice(0, 2000);
  return out;
}
