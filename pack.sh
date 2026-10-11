#!/bin/sh
# 확장 프로그램 zip 만들기. 상위 폴더(../)에 만든다.
#  - youtube-ai-helper-store.zip : 웹스토어 업로드용. manifest에 key가 없다 (스토어는 key 필드를 받지 않음)
#  - youtube-ai-helper-team.zip  : 팀원·심사위원 설치용. extension-key.txt가 있을 때만 만든다.
#    key를 넣으면 어느 폴더에 설치해도 확장 ID가 같아져 Worker의 ALLOWED_ORIGINS를 통과한다.
#    공개 저장소라 key를 커밋하면 누구나 이 ID로 Worker를 쓸 수 있으므로, 팀장만 보관한다 (.gitignore).
set -e
cd "$(dirname "$0")"
FILES="manifest.json background.js content.js content.css popup icons _locales"
rm -f ../youtube-ai-helper.zip ../youtube-ai-helper-store.zip ../youtube-ai-helper-team.zip

zip -qr ../youtube-ai-helper-store.zip $FILES -x "*.DS_Store"
echo "→ ../youtube-ai-helper-store.zip (웹스토어용)"

if [ -f extension-key.txt ]; then
  TMP=$(mktemp -d)
  mkdir "$TMP/youtube-ai-helper"
  cp -R $FILES "$TMP/youtube-ai-helper/"
  KEY=$(tr -d ' \r\n' < extension-key.txt)
  # "version" 줄 바로 아래에 "key" 줄을 넣는다 (sed 대신 awk: Mac/리눅스 공통)
  awk -v k="$KEY" '{ print } /"version":/ { print "  \"key\": \"" k "\"," }' manifest.json > "$TMP/youtube-ai-helper/manifest.json"
  (cd "$TMP" && zip -qr team.zip youtube-ai-helper -x "*.DS_Store")
  mv "$TMP/team.zip" ../youtube-ai-helper-team.zip
  rm -rf "$TMP"
  echo "→ ../youtube-ai-helper-team.zip (팀원·심사위원용, 확장 ID 고정)"
else
  echo "extension-key.txt가 없어서 팀원용 zip은 만들지 않았어요 (팀장에게 받아 이 폴더에 두기)"
fi
