import type { MailDictionary } from './types';

export const en = {
  verifyEmail: {
    subject: 'Confirm your Stairno email address',
    heading: 'Confirm your email',
    body: 'Hi {name}, thanks for creating a Stairno account. Use the button below to confirm this address. The link is valid for one hour.',
    action: 'Confirm email',
    note: 'If you did not sign up, you can ignore this email.',
  },
  resetPassword: {
    subject: 'Reset your Stairno password',
    heading: 'Reset your password',
    body: 'Hi {name}, we received a request to reset your password. Use the button below to choose a new one. The link works once and is valid for one hour.',
    action: 'Reset password',
    note: 'If you did not ask for this, you can ignore this email. Your password stays the same.',
  },
  changeEmail: {
    subject: 'Confirm your new Stairno email address',
    heading: 'Change your email',
    body: 'Hi {name}, you asked to move your Stairno account to this address. Confirm with the button below and the change takes effect. The link is valid for one hour.',
    action: 'Confirm new address',
    note: 'If you did not ask for this, you can ignore this email. Your email stays the same.',
  },
} satisfies MailDictionary;
