# account.stairno.com

Stairno 계정 센터(account.stairno.com)와 공용 API(api.stairno.com). Stairno 계정 하나로 허브를 제외한 모든 Stairno 사이트와 제품에 로그인하고, 카드는 한 번만 등록하며, 결제·구독·권한을 API 한 곳에서 처리한다. 사이트는 로그인과 결제를 직접 구현하지 않고 이 둘을 부른다. 1차는 로그인, 2차는 결제(테스트 모드).

## 문서가 먼저다

이 레포는 설계 문서를 따라 짠다. 문서와 코드가 어긋나면 둘 중 하나를 같은 PR에서 고친다.

| 문서                  | 원본                        | 공유본                                                                                              |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| 프로젝트 계획서       | `docs/specs/plan.md`        | [Google Docs](https://docs.google.com/document/d/1i9pkvCHo0XkBrcU8o8s-5u_3zz8CpeKMzTJ01olrLi8/edit) |
| 요구사항 명세서 (SRS) | `docs/specs/srs.md`         | [Google Docs](https://docs.google.com/document/d/1-NKMcjcKf-ESB95-M6DhpTrbwxn0qYVAJy9A-q1d0N8/edit) |
| 설계 명세서 (SDD)     | `docs/specs/sdd.md`         | [Google Docs](https://docs.google.com/document/d/1tEYwmJwJ6aDq26tzZ781eF_1wd9-DxVf9Smeh1Px8cY/edit) |
| 테스트와 배포         | `docs/specs/test-deploy.md` | [Google Docs](https://docs.google.com/document/d/1izJ7KAlia6LIA5oOHP8XjUKz_uZWJFR5q9Utyfg_1ZY/edit) |

- `docs/specs/`는 git에서 제외된다. 로컬에 없으면 Google Docs를 읽는다. Drive 폴더는 `Stairno/account.stairno.com`
- 문서를 고치면 마크다운 원본을 고치고 Google Docs에 다시 올린다. Google Docs만 고치지 않는다
- 요구사항 ID(`FR-n`, `NFR-n`, `DR-n`)는 SRS에 있다. 테스트 이름과 PR 본문에서 이 ID를 인용한다
- 범위를 늘리는 변경(소셜 로그인, 관리자 화면, 3차 항목)은 계획서의 범위와 결정 기록을 먼저 고친 뒤에만 한다

## 작업 규칙

- 개발 방식은 TDD. 실패하는 테스트를 먼저 쓰고, 통과시키고, 정리한다. 테스트 없는 구현 커밋은 올리지 않는다. 테스트 이름에 SRS ID를 넣는다(`FR-3 returns the same body for an unknown email and a wrong password`)
- 브랜치, 커밋, PR, 머지, 마이그레이션 규칙은 `CONTRIBUTING.md`
- `main`에 직접 커밋하지 않는다. 모든 변경은 PR이고 CI가 통과해야 머지한다. 열린 PR은 하나만
- DB는 `apps/api`만 만진다(DR-1). `apps/account`는 Better Auth나 Drizzle을 import하지 않고 API를 HTTP로 부른다. 서버 렌더링 때는 들어온 `Cookie` 헤더를 그대로 전달한다
- 결제사는 `apps/api/src/payments/provider.ts`의 `PaymentProvider` 어댑터 뒤에만 있다. 주문 상태 기계와 라우트는 토스페이먼츠, PayPal을 직접 부르지 않는다. 테스트는 가짜 어댑터로 돈다(NFR-13, NFR-16)
- 금액은 정수 최소 단위와 통화 코드 쌍이다. 실수로 계산하지 않고 통화를 섞어 더하지 않는다(DR-9)
- 카드 번호, 유효기간, CVC를 받는 코드를 만들지 않는다. 결제사 위젯이 받는다(DR-4)
- 시크릿(DB URL, `BETTER_AUTH_SECRET`, 결제사 키, Resend 키)은 Wrangler 시크릿과 로컬 `.dev.vars`에만 둔다. 레포, 테스트 픽스처, 로그, PR 본문에 쓰지 않는다. 결제사 키는 테스트 키와 샌드박스만. 라이브 키는 이 레포 작업에서 다루지 않는다
- 로그에 이메일, 토큰, 카드 정보를 남기지 않는다. 주문 ID와 결제사 키만(NFR-21)
- API 오류는 `{ error: { code, message } }` 하나의 형식이다. `code`는 SDD 8절의 상수만 쓴다(FR-24)
- 사용자 노출 문자열과 메일 문구는 `ko`, `en` 두 사전에 같은 키로 넣는다. 한쪽만 넣으면 타입 오류다(FR-73, FR-76)
- 브랜드 표기는 "Stairno". 회사, 그룹, 스튜디오, company, studio라는 말을 화면과 메일에 쓰지 않는다(DR-6). 허브는 stairno.com, 나머지 사이트는 프로젝트(Works, Games, Labs)다
- 허브에는 계정 링크를 두지 않는다. 계정 센터는 허브로 돌아가는 링크만 가진다(DR-7)
- Better Auth 버전을 올리면 `experiments/cross-domain-login`을 다시 돌려 13개가 통과하는지 본다

## 스택

Hono 4 + Cloudflare Workers(`nodejs_compat`), PostgreSQL(Neon serverless HTTP 드라이버) + Drizzle ORM, Better Auth 1.7 + `@better-auth/oauth-provider` + `jwt` 플러그인, Resend. 화면은 Astro 7 서버 렌더링(`@astrojs/cloudflare`) + `@stairno/ui`(레포 `seren-wib/stairno-ui`, git 태그로 고정). 공유 zod 스키마는 `packages/contract`. 테스트는 Vitest(단위, PGlite 통합, Astro Container API, workerd 종단). npm workspaces로 `apps/api`, `apps/account`, `packages/contract` 셋. 모양을 바꾸려면 `stairno-ui`를 고치고 태그를 올린 뒤 여기 의존성을 올린다. 자세한 구조는 SDD.

```bash
npm ci
npm run dev
npm test
npm run check
npm run format
```

## 배포

`main`에 머지되면 `.github/workflows/deploy.yml`이 마이그레이션(Neon) → `apps/api` → `apps/account` 순서로 Workers에 올린다. 마이그레이션이 실패하면 배포하지 않는다. 시크릿과 설치 절차는 테스트와 배포 문서 7절.

## GitHub

- 원격 `github.com/seren-wib/account.stairno.com` (public), 기본 브랜치 `main`
- 룰셋: `main`은 PR 필수, CI 통과 필수, 삭제와 force push 금지
- 머지는 rebase merge. feature 브랜치는 머지 직후 삭제
