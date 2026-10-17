# account.stairno.com

Stairno Account: sign-in, account center and the shared API for all Stairno sites and products.

Stairno 계정 센터(account.stairno.com)와 공용 API(api.stairno.com). Stairno 계정 하나로 허브를 제외한 모든 Stairno 사이트와 제품에 로그인하고, 카드는 한 번만 등록하며, 결제·구독·구매 내역을 한 곳에서 관리한다. 사이트는 로그인과 결제를 직접 구현하지 않고 이 둘을 부른다. 1차는 로그인, 2차는 결제(테스트 모드).

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
- 작업 규칙의 요약은 [CLAUDE.md](CLAUDE.md), 테스트 계층과 배포 절차는 테스트와 배포 문서

## 교차 도메인 로그인 실험

다른 도메인(stairnolabs.com 등)에서 Stairno 계정 로그인을 Better Auth로 공유할 수 있는지 설계 전에 확인했다. 결론은 "쿠키 공유가 아니라 OIDC로 된다". 계정 서버가 OIDC 공급자(`@better-auth/oauth-provider`), 사이트는 OIDC 클라이언트다. 코드와 결과는 [`experiments/cross-domain-login/`](experiments/cross-domain-login/README.md), 설계 반영은 SDD 3절.

```bash
cd experiments/cross-domain-login
npm ci
npm start
```

## 스택

Hono + Cloudflare Workers, PostgreSQL(Neon), Drizzle ORM, Better Auth, Resend. 화면은 Astro 서버 렌더링 + `@stairno/ui`. 레포 하나에 Worker 둘(`apps/api`, `apps/account`). 자세한 구조는 SDD.

## 작업 규칙

브랜치, 커밋, PR, 머지, 테스트, 마이그레이션, 시크릿 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md).
