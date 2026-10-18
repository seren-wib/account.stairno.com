import type { LegalDocuments } from './types';

// English rendering of ko.ts, section for section. The Korean text governs.
// 〔확인 필요〕 marks values the operator still has to confirm (plan §8, open items).
export const en: LegalDocuments = {
  terms: {
    title: 'Terms of Service',
    effective: 'Effective 〔확인 필요〕',
    sections: [
      {
        heading: 'Article 1. Purpose',
        body: [
          'These terms set the conditions and procedures for using the Stairno account service (account.stairno.com, api.stairno.com), and the rights and duties of users and the operator. The Korean version governs.',
        ],
      },
      {
        heading: 'Article 2. Definitions',
        body: [
          '"Account" means the Stairno account made with an email and a password. One account signs you in to the Stairno projects (Works, Games, Labs).',
          '"Account center" means the screens at account.stairno.com for creating and managing the account; "Stairno sites" means the other Stairno sites and products you sign in to with the account.',
          '"User" means a person who accepted these terms and created an account.',
        ],
      },
      {
        heading: 'Article 3. Operator and publication',
        body: [
          'The account service is run by Stairno. Operator: 〔확인 필요: operator name〕, contact: contact@stairno.com.',
          'These terms can be read at any time on the sign-up screen and on the terms page of the account center.',
        ],
      },
      {
        heading: 'Article 4. Effect and changes',
        body: [
          'These terms apply to users who accepted them when signing up.',
          'When the terms change, the version goes up and the changes and the effective date are announced on this page from 7 days before they take effect. Changes against users are announced from 30 days before and also sent to the email you signed up with.',
          'If you do not accept the new terms you can leave. Continuing to use the service after the effective date counts as acceptance, except for matters the law requires separate consent for, which are asked separately.',
        ],
      },
      {
        heading: 'Article 5. Signing up',
        body: [
          'Only people aged 14 or older can sign up.',
          'You sign up by accepting these terms and the privacy policy and entering an email, a password and a name. You confirm the email through the link in the mail sent right after signing up.',
          "Do not sign up with someone else's email or false information. If this comes to light, the account may be suspended or deleted.",
        ],
      },
      {
        heading: 'Article 6. Your account',
        body: [
          'You are responsible for your password and may not share it, or transfer or lend the account.',
          'You can sign out unknown devices from the signed-in devices list and reset a forgotten password by mail. If you think the account has been taken over, change the password at once and tell the operator.',
        ],
      },
      {
        heading: 'Article 7. Signing in to Stairno sites',
        body: [
          'When you use "Sign in with Stairno" on a Stairno site, that site receives your email, whether it is confirmed, your name and your language. You can disconnect a site at any time from the connected sites list.',
          'Services and products on a Stairno site, and their payment and refunds, follow that site’s terms and notices.',
        ],
      },
      {
        heading: 'Article 8. Provision, changes and interruptions',
        body: [
          'The account service is free. Features may change, and the service may be briefly unavailable because of maintenance, failures or events such as natural disasters. Planned maintenance is announced on the account center in advance.',
          'If the service has to end, users are told by email 30 days in advance.',
        ],
      },
      {
        heading: 'Article 9. Your obligations',
        body: [
          'You must not: try to access other people’s accounts, call the account or the API in bulk automatically, get around the service’s security measures or disrupt its operation, or break the law.',
        ],
      },
      {
        heading: 'Article 10. Restrictions',
        body: [
          'If a user breaks Article 9, the operator may restrict some features, suspend the account or delete it, depending on how serious it is. Except in urgent cases the reason is sent by email first, with a chance to respond.',
        ],
      },
      {
        heading: 'Article 11. Leaving',
        body: [
          'You can leave at any time by deleting the account in the account center after entering your password again. The account is deleted at once and cannot be restored. Signing up again with the same email creates a new account.',
        ],
      },
      {
        heading: 'Article 12. Liability',
        body: [
          'The operator compensates losses it causes users through intent or negligence.',
          'Without intent or gross negligence, the operator is not liable for losses from careless handling of your password, from events it cannot prevent such as natural disasters, or from temporary interruptions of a free service. Liability set by law is not limited by this article.',
        ],
      },
      {
        heading: 'Article 13. Disputes and governing law',
        body: [
          'Questions and complaints go to contact@stairno.com and are answered within 7 days of receipt.',
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
          'Stairno ("the operator") processes personal data only for the purposes below and announces any change of purpose in advance, asking for consent where required. The Korean version governs.',
          'Signing up and confirming identity, signing in and staying signed in, signing in to Stairno sites, account security (device management, limits on repeated attempts, preventing takeover), sending account mail (email confirmation, password reset, email change) and answering questions.',
          'Personal data is not used for advertising or marketing.',
        ],
      },
      {
        heading: '2. Data processed',
        body: [
          'Required at sign-up: email, name, password (stored only as an irreversible hash), language, the accepted terms version and time.',
          'Created or collected during use: IP address and browser details (User-Agent) of signed-in devices, sign-in times, records of account mail sent, connected Stairno sites and when they were connected.',
          'Nothing else is collected, and no behavioural tracking or tracking tools are used.',
        ],
      },
      {
        heading: '3. Retention',
        body: [
          'Account data is kept until you leave and deleted at once when you do.',
          'Sign-in sessions last 30 days after last use and records of repeated attempts one minute, after which they expire. Records of account mail are deleted with the account.',
          'If the law ever requires keeping some data, the basis and period will be added to this policy.',
        ],
      },
      {
        heading: '4. Destruction',
        body: [
          'At the end of retention or when you leave, data is deleted from the database without delay and cannot be recovered. No personal data is kept on paper.',
        ],
      },
      {
        heading: '5. Sharing with third parties',
        body: [
          'Personal data is not given or sold to third parties.',
          'When you use "Sign in with Stairno" on a Stairno site, that site receives your email, whether it is confirmed, your name and your language. All Stairno sites are run by the operator.',
        ],
      },
      {
        heading: '6. Processors',
        body: [
          'The following processors are used to run the service; the contracts with them set the data protection they must provide.',
          'Cloudflare, Inc.: hosting and network delivery.',
          'Neon, LLC (part of Databricks, Inc.): database storage.',
          'Plus Five Five, Inc. (Resend): sending account mail.',
        ],
      },
      {
        heading: '7. Transfers abroad',
        body: [
          'The processing in section 6 transfers personal data abroad. As processing and storage needed to conclude and perform the contract, it is disclosed here under Article 28-8(1)(3) of the Korean Personal Information Protection Act. Transfers happen over the network when you use the service.',
          'Cloudflare, Inc. (United States, 101 Townsend St, San Francisco, CA 94107, dpo@cloudflare.com): everything exchanged while using the service, at each use, for hosting and network delivery, for the retention in section 3.',
          'Neon, LLC (data stored in Singapore, privacy@databricks.com): all data in section 2, at sign-up and each use, for database storage, for the retention in section 3.',
          'Plus Five Five, Inc. (Resend, United States, support@resend.com): email, name and mail content, when account mail is sent, for sending it, for that provider’s retention after sending.',
          'To refuse the transfer, do not sign up, or leave. The account service cannot be provided without this processing, so signing up and using it is not possible.',
        ],
      },
      {
        heading: '8. Safeguards',
        body: [
          'Administrative: only the operator can access personal data.',
          'Technical: all traffic is encrypted with HTTPS; passwords are stored only as scrypt hashes and passwords known from data breaches are refused; database credentials and secrets are kept only in a separate secret store, and system logs carry no emails or tokens; sign-in attempts are rate-limited.',
        ],
      },
      {
        heading: '9. Cookies and similar storage',
        body: [
          'Only a session cookie that keeps you signed in, and browser storage that remembers your theme, are used. No advertising or analytics cookies are used.',
          'You can refuse cookies in your browser settings, but then you cannot sign in.',
        ],
      },
      {
        heading: '10. Children under 14',
        body: [
          'Children under 14 cannot sign up and their personal data is not processed. If such a sign-up comes to light, the account is deleted.',
        ],
      },
      {
        heading: '11. Your rights',
        body: [
          'You can ask at any time to see, correct, delete or stop the processing of your personal data.',
          'In the account center you can see (overview, profile, signed-in devices, connected sites), correct (name, language, email) and delete (delete account) it yourself. Send other requests to contact@stairno.com; the result is sent within 10 days.',
          'You can also make requests through a representative, with documents showing the authorisation.',
        ],
      },
      {
        heading: '12. Privacy officer',
        body: [
          'The privacy officer oversees the processing of personal data and handles questions and complaints.',
          'Name: 〔확인 필요〕, contact: contact@stairno.com',
        ],
      },
      {
        heading: '13. Remedies',
        body: [
          'For remedies for infringement of personal data you can apply for dispute resolution or advice to the following Korean bodies.',
          'Personal Information Dispute Mediation Committee: 1833-6972, www.kopico.go.kr',
          'Personal Information Infringement Report Center: 118, privacy.kisa.or.kr',
          'Supreme Prosecutors’ Office: 1301, www.spo.go.kr',
          'Korean National Police Agency: 182, ecrm.police.go.kr',
        ],
      },
      {
        heading: '14. Changes',
        body: [
          'When this policy changes, the version goes up and the changes and the effective date are announced on this page from 7 days before. Important changes, such as more data or new purposes, are announced from 30 days before and also sent to the email you signed up with.',
        ],
      },
    ],
  },
};
