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
  passwordChanged: {
    subject: 'Stairno 비밀번호가 변경되었습니다',
    heading: '비밀번호 변경',
    body: '{name}님, Stairno 계정의 비밀번호가 방금 바뀌었습니다. 안전을 위해 이 변경을 한 기기를 뺀 모든 기기에서 로그아웃했습니다.',
    action: '비밀번호 재설정',
    note: '직접 바꾼 것이 아니라면 바로 위 버튼으로 비밀번호를 다시 정하고 contact@stairno.com으로 알려 주세요.',
  },
  receipt: {
    subject: 'Stairno 결제 영수증',
    heading: '결제 완료',
    body: '{name}님, {product} 결제 {amount}를 받았습니다. 고맙습니다. 주문과 영수증은 Stairno 계정에서 볼 수 있습니다.',
    action: '주문 내역 보기',
    note: 'Stairno가 실제 결제를 시작하기 전까지는 테스트 결제이며 돈이 나가지 않습니다.',
  },
  renewalFailed: {
    subject: 'Stairno 구독 갱신 결제를 하지 못했습니다',
    heading: '갱신 결제 실패',
    body: '{name}님, {product} 갱신 결제 {amount}가 승인되지 않았습니다. 3일 뒤에 다시 결제하고 최대 세 번까지 시도하며, 모두 실패하면 구독이 끝납니다. 결제 수단을 확인해 주세요.',
    action: '결제 수단 확인',
    note: '구독을 그만두려던 것이라면 계정에서 해지할 수 있습니다.',
  },
  refunded: {
    subject: 'Stairno 결제를 환불했습니다',
    heading: '환불 완료',
    body: '{name}님, {product} 결제 {amount}를 환불했습니다. 카드사에 따라 명세서에 반영되기까지 영업일 며칠이 걸릴 수 있습니다.',
    action: '주문 내역 보기',
    note: '환불과 함께 상품 이용이 끝났습니다.',
  },
  refundRejected: {
    subject: 'Stairno 환불 요청 결과 안내',
    heading: '환불 요청 거절',
    body: '{name}님, {product}({amount}) 환불 요청은 구매한 사이트의 환불 정책에 따라 받아들여지지 않았습니다. 계속 이용할 수 있습니다.',
    action: '주문 내역 보기',
    note: '궁금한 점은 구매한 사이트로 문의해 주세요.',
  },
} satisfies MailDictionary;
