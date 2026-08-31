# 매일 말씀 알림 설정

알림 코드를 메인에 합친 뒤 아래 설정을 한 번만 진행합니다.

## 1. 웹 푸시 공개 키 만들기

1. Firebase 콘솔에서 `프로젝트 설정 > Cloud Messaging`으로 이동합니다.
2. `웹 구성 > 웹 푸시 인증서`에서 `키 쌍 생성`을 누릅니다.
3. 표시된 공개 키를 복사합니다.
4. `app-settings.js`의 `firebaseWebPushPublicKey` 값에 붙여넣습니다.

공개 키는 웹앱에 포함되는 값이며 비밀번호가 아닙니다.

## 2. GitHub 발송 비밀키 등록

1. Firebase 콘솔에서 `프로젝트 설정 > 서비스 계정`으로 이동합니다.
2. `새 비공개 키 생성`을 눌러 JSON 파일을 내려받습니다.
3. GitHub 저장소에서 `Settings > Secrets and variables > Actions`로 이동합니다.
4. `New repository secret`을 누릅니다.
5. 이름은 `FIREBASE_SERVICE_ACCOUNT`, 값은 JSON 파일의 전체 내용을 입력합니다.

비공개 키 JSON은 채팅이나 저장소 코드에 올리지 않습니다. GitHub Secret에만 보관합니다.

## 3. Firestore 규칙 게시

최신 `firestore.rules` 전체를 Firebase의 `Firestore Database > 규칙`에 붙여넣고 게시합니다.

## 4. 시험 발송

1. 앱의 `마이페이지 > 매일 말씀 알림 > 알림 받기`를 누릅니다.
2. 휴대폰에서 알림을 허용합니다.
3. GitHub 저장소의 `Actions > Daily word reminder > Run workflow`를 누릅니다.
4. `오늘 이미 발송했어도 테스트 알림 보내기`를 선택하고 실행합니다.
5. 알림을 누르면 말씀체크 화면이 열리는지 확인합니다.

## 자동 발송 시간

한국 시간 기준으로 월 09:17, 화 14:23, 수 19:37, 목 10:41, 금 20:13,
토 15:29, 일 21:07에 하루 한 번 발송됩니다. GitHub 예약 작업 상황에 따라 몇 분 늦어질 수 있습니다.
