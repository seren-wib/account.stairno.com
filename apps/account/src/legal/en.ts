import type { LegalDocuments } from './types';

// Draft. Places marked 〔확인 필요〕 (to confirm) wait for the operator (plan §8, open items).
// The Korean text is the governing version.
export const en: LegalDocuments = {
  terms: {
    title: 'Terms of Service',
    effective: 'Effective 〔확인 필요〕',
    sections: [
      {
        heading: '1. Purpose',
        body: [
          'These terms set the conditions for using the Stairno account (account.stairno.com and api.stairno.com, "the account"). One Stairno account signs you in to the Stairno projects (Works, Games, Labs).',
        ],
      },
      {
        heading: '2. Operator',
        body: [
          'The account is run by Stairno. Operator 〔확인 필요: operator name〕, contact contact@stairno.com.',
        ],
      },
      {
        heading: '3. Signing up',
        body: [
          'You sign up by accepting these terms and the privacy policy and entering an email, a password and a name. You confirm the email through the link in the mail sent right after signing up.',
          "Do not use someone else's email or false information.",
        ],
      },
      {
        heading: '4. Your account',
        body: [
          'You are responsible for your password. You can sign out unknown devices from the signed-in devices list, and reset a forgotten password by mail.',
          'You may not transfer or lend your account to anyone.',
        ],
      },
      {
        heading: '5. Connected sites',
        body: [
          'When you use "Sign in with Stairno" on a Stairno site, that site receives your email, name and language. You can disconnect a site at any time from the connected sites list.',
          'Purchases on a site and their refunds follow that site’s terms.',
        ],
      },
      {
        heading: '6. Prohibited use',
        body: [
          'Do not call the account or the API in bulk automatically, try to access other people’s accounts, or disrupt the service. Use may be restricted if this happens.',
        ],
      },
      {
        heading: '7. Changes and interruptions',
        body: [
          'Features may change. The service may be briefly unavailable for maintenance or because of failures. If the service has to end, we tell you by email 30 days in advance.',
        ],
      },
      {
        heading: '8. Leaving',
        body: [
          'Deleting the account in the account center, after entering your password again, closes it at once. A deleted account cannot be restored.',
        ],
      },
      {
        heading: '9. Liability',
        body: [
          'Stairno makes reasonable efforts to run the account safely. Stairno is not liable for losses caused by careless handling of your password or by events it cannot prevent, such as natural disasters. Liability set by law is not limited.',
        ],
      },
      {
        heading: '10. Changes to these terms',
        body: [
          'When these terms change, the version goes up and the change is announced on this page 7 days before it takes effect. Changes against your interest are also announced by email 30 days ahead.',
        ],
      },
      {
        heading: '11. Governing law',
        body: [
          'These terms follow the law of the Republic of Korea. Disputes go to the court competent under the Korean Civil Procedure Act.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    effective: 'Effective 〔확인 필요〕',
    sections: [
      {
        heading: '1. Purposes',
        body: [
          'Personal data is used only to create the account and sign you in, to sign you in to Stairno sites, to keep the account secure (device management, limits on repeated attempts) and to send account mail (email confirmation, password reset, email change). It is not used for advertising or marketing.',
        ],
      },
      {
        heading: '2. Data processed',
        body: [
          'Required: email, name, password (stored only as an irreversible hash), language, the accepted terms version and time.',
          'Collected automatically: the IP address and browser details (User-Agent) of signed-in devices, sign-in times, records of account mail sent.',
          'Nothing else is collected, and no tracking scripts are used.',
        ],
      },
      {
        heading: '3. Retention',
        body: [
          'When you delete the account, the account data, sign-in records, connected sites and mail records are deleted at once.',
          'Sign-in sessions last 30 days after last use; records of repeated attempts last one minute.',
        ],
      },
      {
        heading: '4. Sharing',
        body: [
          'Personal data is not sold or given to third parties. When you sign in to a Stairno site, that site receives your email, name and language; all these sites are run by Stairno.',
        ],
      },
      {
        heading: '5. Processors and transfers abroad',
        body: [
          'The service relies on the following processors, which means personal data is transferred abroad. Transfers happen over the network while you use the service; retention is as in section 3.',
          'Cloudflare, Inc. (United States): hosting and network. Data: everything exchanged while using the service.',
          'Neon, Inc. (data stored in Singapore): database. Data: the data in section 2.',
          'Resend, Inc. (United States): sending account mail. Data: email, name, mail content.',
          '〔확인 필요: processor contacts and how to refuse the transfer〕',
        ],
      },
      {
        heading: '6. Destruction',
        body: [
          'At the end of retention or when you leave, data is deleted from the database and cannot be recovered.',
        ],
      },
      {
        heading: '7. Your rights',
        body: [
          'In the account center you can see (overview, profile, signed-in devices, connected sites), correct (name, language, email) and delete (delete account) your data at any time. Send other requests to contact@stairno.com.',
        ],
      },
      {
        heading: '8. Safeguards',
        body: [
          'All traffic is encrypted with HTTPS. Passwords are stored only as scrypt hashes, and passwords known from data breaches cannot be used. Only the operator can reach the database and secrets.',
        ],
      },
      {
        heading: '9. Cookies',
        body: [
          'One session cookie keeps you signed in. No advertising or analytics cookies are used. Blocking cookies in the browser makes signing in impossible.',
        ],
      },
      {
        heading: '10. Privacy officer',
        body: ['〔확인 필요: name〕, contact@stairno.com'],
      },
      {
        heading: '11. Changes',
        body: [
          'When this policy changes, the version goes up and the change is announced on this page 7 days before it takes effect. If the data collected or its purposes grow, it is also announced by email 30 days ahead.',
        ],
      },
    ],
  },
};
