# Contributing

1인 프로젝트지만 흐름은 팀처럼 간다. 이슈 → 브랜치 → 테스트 먼저 → 구현 → PR → CI → 머지. 규칙은 `stairno.com`의 CONTRIBUTING.md와 같고, 이 레포에만 있는 것(워크스페이스 둘, 마이그레이션, 시크릿)을 덧붙였다.

## 브랜치

| 브랜치                      | 수명      | 역할                      | 따는 곳 | 머지 대상 |
| --------------------------- | --------- | ------------------------- | ------- | --------- |
| `main`                      | 상시      | 배포 버전. 머지가 곧 배포 | —       | —         |
| `feature/<이슈번호>-<요약>` | 작업 하나 | 개별 작업                 | `main`  | `main`    |

- `develop`과 `release` 브랜치는 두지 않는다
- `main`에 직접 커밋하지 않는다. 모든 변경은 PR로 들어간다
- 작업 하나당 이슈 하나, 브랜치 하나, PR 하나. 예: `feature/1-account-specs`
- 작업은 기능이나 관심사 하나다. 문서 작성, 워크스페이스 도구, DB 연결, 인증 연결, 화면 뼈대, 단위 테스트, 종단 테스트, CI는 각각 따로 이슈와 PR을 만든다. 여러 개를 한 PR에 묶지 않는다
- PR 하나를 머지하고 배포까지 본 뒤에 다음 PR을 연다. 열린 PR이 둘 이상 쌓이지 않게 한다

## 이슈

- 작업을 시작하기 전에 이슈를 만든다. 제목은 커밋 메시지와 같은 형식(`feat: add billing key issuance`)
- 본문에 범위, 관련 SRS ID, 완료 조건을 적는다

## 커밋 — Conventional Commits

```
<type>(<scope>): <summary>
```

- `scope`는 워크스페이스 이름(`api`, `account`, `contract`)이나 영역. 생략 가능
- `summary`는 영어, 명령형, 소문자로 시작, 마침표 없음
- 본문에는 왜 바꿨는지를 적는다. 무엇을 바꿨는지는 diff가 말한다

| type       | 용도                     |
| ---------- | ------------------------ |
| `feat`     | 기능 추가                |
| `fix`      | 버그 수정                |
| `test`     | 테스트 추가, 수정        |
| `refactor` | 동작 변경 없는 코드 개선 |
| `docs`     | 문서                     |
| `style`    | 포맷팅 (동작 변경 없음)  |
| `chore`    | 설정, 의존성 등 기타     |
| `ci`       | CI, 배포 워크플로        |

TDD 작업은 커밋도 그 순서다.

```
test(api): add failing cases for order transitions
feat(api): implement order state machine
refactor(api): extract transition table
```

## PR

- 제목은 커밋 형식. 본문에 이슈 번호(`Closes #1`), 바꾼 이유, 확인한 방법, 관련 SRS ID
- CI(포맷, 타입 검사, 테스트, 빌드, 마이그레이션 검사)가 전부 통과해야 머지한다
- 머지 방식은 rebase merge. 커밋이 그대로 올라가므로 커밋 하나하나가 위 컨벤션을 지켜야 한다
- 머지 직후 feature 브랜치를 삭제한다

## 테스트

- 기능마다 실패하는 테스트를 먼저 쓴다. 테스트 이름에 SRS ID를 넣는다. 예: `FR-36 rejects paid -> pending`
- 결제사는 가짜 어댑터로 바꿔 돌린다. 실제 테스트 키 호출은 전개 리허설에서만(NFR-16)
- 통합 테스트 DB는 PGlite. CI에 시크릿이 필요 없다
- `npm test`가 워크스페이스 전부를 돈다

## 데이터베이스

- 스키마는 `apps/api/src/db/schema/`의 Drizzle 코드가 원본이다. SQL을 손으로 고치지 않는다
- 스키마를 바꾸면 `drizzle-kit generate`로 마이그레이션을 만들어 같은 PR에 커밋한다
- 되돌리기는 새 마이그레이션으로만 한다

## 시크릿

- 시크릿은 Wrangler 시크릿과 로컬 `.dev.vars`에만 있다. 레포, 로그, PR 본문에 쓰지 않는다
- 결제사 키는 테스트 키만 쓴다. 라이브 키 교체는 운영 문서의 절차를 따른다

## 문서 갱신

문서 갱신은 작업의 일부다. 코드를 바꾸면 관련 문서를 같은 PR에서 고친다.

- 설계가 바뀌면 `docs/specs/sdd.md`를 고치고 Google Docs에 다시 올린다
- 요구사항이 바뀌면 `docs/specs/srs.md`. 범위가 바뀌면 `docs/specs/plan.md`의 범위와 결정 기록
- Better Auth 버전을 올리면 `experiments/cross-domain-login`을 다시 돌려 13개가 통과하는지 본다

## 환경

- Windows(Git Bash 또는 PowerShell)와 macOS를 오가며 작업한다. 경로를 하드코딩하지 않는다
- 줄바꿈은 `.gitattributes`가 LF로 고정한다. `core.autocrlf`는 건드리지 않는다
- Node 22 이상. 루트 `package.json`의 `engines`가 기준이다
