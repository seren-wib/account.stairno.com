import type { Dictionary } from './types';

export const en: Dictionary = {
  meta: {
    title: 'Stairno Account',
    description: 'One Stairno account for every Stairno project.',
  },
  nav: {
    overview: 'Overview',
    switchLocale: '한국어',
    theme: {
      light: 'Switch to light mode',
      dark: 'Switch to dark mode',
      toggle: 'Toggle theme',
    },
  },
  footer: { heading: 'Stairno', hub: 'stairno.com', source: 'Source code' },
  overview: { heading: 'Account' },
  signIn: {
    heading: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    forgot: 'Forgot your password?',
    noAccount: 'No account yet?',
    signUp: 'Sign up',
    failed: 'The email or password is not right.',
    tooMany: 'Too many tries. Please try again in a minute.',
    unavailable: 'Signing in is not possible right now. Please try again shortly.',
    noscript: 'Turn on JavaScript to sign in.',
  },
  notFound: { heading: 'Page not found', home: 'Back to the overview' },
};
