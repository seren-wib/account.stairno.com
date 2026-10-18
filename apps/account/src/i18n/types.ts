// The two-character card company codes in Toss responses (docs.tosspayments.com/codes/org-codes).
export const CARD_COMPANY_CODES = [
  '3K',
  '46',
  '71',
  '30',
  '31',
  '51',
  '38',
  '41',
  '62',
  '36',
  '33',
  'W1',
  '37',
  '39',
  '35',
  '42',
  '15',
  '3A',
  '24',
  '21',
  '61',
  '11',
  '91',
  '34',
  '6D',
  '4M',
  '3C',
  '7A',
  '4J',
  '4V',
] as const;
export type CardCompanyCode = (typeof CARD_COMPANY_CODES)[number];

// One shape for both languages (FR-76): ko and en are typed `Dictionary`, so a key in one
// language only fails `astro check`. `{name}` in a string is replaced where it is used.
export type Dictionary = {
  meta: { title: string; description: string };
  nav: {
    overview: string;
    switchLocale: string;
    theme: { light: string; dark: string; toggle: string };
    // @stairno/ui AccountMenu (FR-79, FR-82).
    accountMenu: {
      signedIn: string;
      signedOut: string;
      manage: string;
      signOut: string;
      signIn: string;
      signUp: string;
    };
  };
  footer: { heading: string; hub: string; source: string };
  account: {
    menuLabel: string;
    menu: {
      overview: string;
      profile: string;
      devices: string;
      connections: string;
      paymentMethods: string;
      delete: string;
    };
  };
  overview: {
    heading: string;
    email: string;
    verified: string;
    unverified: string;
    resend: string;
    resent: string;
    tooMany: string;
    unavailable: string;
    shortcuts: string;
  };
  signIn: {
    heading: string;
    email: string;
    password: string;
    submit: string;
    forgot: string;
    noAccount: string;
    signUp: string;
    failed: string;
    tooMany: string;
    unavailable: string;
    noscript: string;
  };
  signUp: {
    heading: string;
    name: string;
    email: string;
    password: string;
    passwordHint: string;
    terms: string;
    privacy: string;
    // {terms} and {privacy} become links; {version} the terms version.
    accept: string;
    submit: string;
    hasAccount: string;
    signIn: string;
    sent: string;
    // {email} is the address the mail went to.
    sentBody: string;
    continue: string;
    noscript: string;
    errors: {
      name: string;
      email: string;
      passwordLength: string;
      passwordBreached: string;
      emailTaken: string;
      terms: string;
      tooMany: string;
      unavailable: string;
    };
  };
  forgotPassword: {
    heading: string;
    intro: string;
    email: string;
    submit: string;
    sent: string;
    sentBody: string;
    backToSignIn: string;
    tooMany: string;
    unavailable: string;
    noscript: string;
  };
  resetPassword: {
    heading: string;
    password: string;
    passwordHint: string;
    submit: string;
    done: string;
    doneBody: string;
    signIn: string;
    requestAgain: string;
    noscript: string;
    errors: {
      expired: string;
      passwordLength: string;
      passwordBreached: string;
      tooMany: string;
      unavailable: string;
    };
  };
  profile: {
    heading: string;
    name: string;
    language: string;
    languages: { ko: string; en: string };
    save: string;
    saved: string;
    emailHeading: string;
    currentEmail: string;
    newEmail: string;
    changeEmail: string;
    emailPending: string;
    emailSent: string;
    errors: { name: string; email: string; unavailable: string; tooMany: string };
  };
  devices: {
    heading: string;
    current: string;
    signedIn: string;
    lastUsed: string;
    end: string;
    unknown: string;
    othersBody: string;
    signOutOthers: string;
    unavailable: string;
  };
  connections: {
    heading: string;
    intro: string;
    connected: string;
    lastUsed: string;
    disconnect: string;
    empty: string;
    unavailable: string;
  };
  paymentMethods: {
    heading: string;
    intro: string;
    default: string;
    added: string;
    makeDefault: string;
    remove: string;
    add: string;
    unknownCard: string;
    empty: string;
    verifyFirst: string;
    addUnavailable: string;
    registering: string;
    registered: string;
    canceled: string;
    failed: string;
    refused: string;
    inUse: string;
    providerDown: string;
    unavailable: string;
    // Toss's card company codes as its responses give them (Toss org codes).
    cards: Record<CardCompanyCode, string>;
  };
  deleteAccount: {
    heading: string;
    warning: string;
    password: string;
    confirm: string;
    submit: string;
    done: string;
    doneBody: string;
    hub: string;
    errors: {
      passwordMissing: string;
      password: string;
      confirm: string;
      tooMany: string;
      unavailable: string;
    };
  };
  consent: {
    heading: string;
    // {site} is the site name.
    intro: string;
    scopes: { openid: string; profile: string; email: string; offline_access: string };
    allow: string;
    deny: string;
    unavailable: string;
  };
  verifyEmail: {
    heading: string;
    done: string;
    doneBody: string;
    expired: string;
    expiredBody: string;
    overview: string;
  };
  legal: { version: string };
  notFound: { heading: string; home: string };
};
