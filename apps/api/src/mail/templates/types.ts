// One shape for every language (FR-73). Both dictionaries `satisfies MailDictionary`, so a key
// added to one language only is a type error. `{name}` in a string is replaced at render time.
export interface MailTemplate {
  subject: string;
  heading: string;
  body: string;
  action: string;
  // Shown under the button: what to do if the reader did not ask for this mail, or a note on it.
  note: string;
}

// FR-72: the account mails of the first phase, and the payment mails of the second (FR-65).
export interface MailDictionary {
  verifyEmail: MailTemplate;
  resetPassword: MailTemplate;
  changeEmail: MailTemplate;
  // FR-83: after a signed-in password change.
  passwordChanged: MailTemplate;
  receipt: MailTemplate;
  renewalFailed: MailTemplate;
  refunded: MailTemplate;
  refundRejected: MailTemplate;
}

export type TemplateName = keyof MailDictionary;
