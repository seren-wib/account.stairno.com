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
  receipt: {
    subject: 'Your Stairno receipt',
    heading: 'Payment received',
    body: 'Hi {name}, we received {amount} for {product}. Thank you. Your orders and receipts are in your Stairno account.',
    action: 'View orders',
    note: 'This is a test-mode payment until Stairno takes real payments; no money was charged.',
  },
  renewalFailed: {
    subject: 'Your Stairno subscription could not be renewed',
    heading: 'Renewal declined',
    body: 'Hi {name}, the {amount} renewal of {product} did not go through. It is tried again three days later, up to three times, and the subscription ends if all of them fail. Please check your payment method.',
    action: 'Check payment methods',
    note: 'If you meant to stop, you can cancel the subscription from your account.',
  },
  refunded: {
    subject: 'Your Stairno payment was refunded',
    heading: 'Refund done',
    body: 'Hi {name}, we refunded {amount} for {product}. Depending on your card issuer, it can take a few business days to show on your statement.',
    action: 'View orders',
    note: 'Access to the product ended with the refund.',
  },
  refundRejected: {
    subject: 'About your Stairno refund request',
    heading: 'Refund request declined',
    body: 'Hi {name}, your refund request for {product} ({amount}) was declined under the refund policy of the site you bought it on. You can keep using it.',
    action: 'View orders',
    note: 'For questions, reply to the site you bought it on.',
  },
} satisfies MailDictionary;
