// One shape for both languages (FR-76): ko and en are typed `Dictionary`, so a key in one
// language only fails `astro check`. `{name}` in a string is replaced where it is used.
export type Dictionary = {
  meta: { title: string; description: string };
  nav: {
    overview: string;
    switchLocale: string;
    theme: { light: string; dark: string; toggle: string };
  };
  footer: { heading: string; hub: string; source: string };
  overview: { heading: string };
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
  verifyEmail: {
    heading: string;
    done: string;
    doneBody: string;
    expired: string;
    expiredBody: string;
    overview: string;
  };
  notFound: { heading: string; home: string };
};
