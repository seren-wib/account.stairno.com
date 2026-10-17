import type { MailDictionary } from './types';

export const ko = {
  verifyEmail: {
    subject: 'Stairno 이메일 주소를 확인해 주세요',
    heading: '이메일 주소 확인',
    body: '{name}님, Stairno 계정을 만들어 주셔서 고맙습니다. 아래 버튼을 눌러 이 주소가 맞는지 확인해 주세요. 링크는 1시간 동안 유효합니다.',
    action: '이메일 확인',
    note: '가입한 적이 없다면 이 메일은 무시해도 됩니다.',
  },
  resetPassword: {
    subject: 'Stairno 비밀번호 재설정',
    heading: '비밀번호 재설정',
    body: '{name}님, 비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 정해 주세요. 링크는 1시간 동안 한 번만 쓸 수 있습니다.',
    action: '비밀번호 재설정',
    note: '요청한 적이 없다면 이 메일은 무시해도 됩니다. 비밀번호는 바뀌지 않습니다.',
  },
  changeEmail: {
    subject: 'Stairno 새 이메일 주소를 확인해 주세요',
    heading: '이메일 주소 변경',
    body: '{name}님, Stairno 계정의 이메일을 이 주소로 바꾸려고 합니다. 아래 버튼을 눌러 확인하면 변경이 적용됩니다. 링크는 1시간 동안 유효합니다.',
    action: '새 주소 확인',
    note: '요청한 적이 없다면 이 메일은 무시해도 됩니다. 이메일은 바뀌지 않습니다.',
  },
} satisfies MailDictionary;
