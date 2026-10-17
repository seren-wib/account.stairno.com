// One shape for every language (FR-73). Both dictionaries `satisfies MailDictionary`, so a key
// added to one language only is a type error. `{name}` in a string is replaced at render time.
export interface MailTemplate {
  subject: string;
  heading: string;
  body: string;
  action: string;
  // Shown under the button: what to do if the reader did not ask for this mail.
  note: string;
}

// First-phase templates (FR-72). Receipts, renewal failures and refunds come with payments.
export interface MailDictionary {
  verifyEmail: MailTemplate;
  resetPassword: MailTemplate;
  changeEmail: MailTemplate;
}

export type TemplateName = keyof MailDictionary;
