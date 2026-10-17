import type { Dictionary } from './types';

export const ko: Dictionary = {
  meta: {
    title: 'Stairno 계정',
    description: 'Stairno 계정 하나로 모든 Stairno 프로젝트에 로그인합니다.',
  },
  nav: {
    overview: '개요',
    switchLocale: 'English',
    theme: {
      light: '라이트 모드로 전환',
      dark: '다크 모드로 전환',
      toggle: '테마 전환',
    },
  },
  footer: { heading: 'Stairno', hub: 'stairno.com', source: '소스 코드' },
  overview: { heading: '계정' },
  signIn: {
    heading: '로그인',
    email: '이메일',
    password: '비밀번호',
    submit: '로그인',
    forgot: '비밀번호를 잊었나요?',
    noAccount: '계정이 없나요?',
    signUp: '가입하기',
    failed: '이메일 또는 비밀번호가 맞지 않습니다.',
    tooMany: '시도가 너무 많습니다. 1분 뒤에 다시 해 주세요.',
    unavailable: '지금은 로그인할 수 없습니다. 잠시 뒤에 다시 해 주세요.',
    noscript: '로그인하려면 JavaScript를 켜 주세요.',
  },
  notFound: { heading: '페이지를 찾을 수 없습니다', home: '계정 개요로' },
};
