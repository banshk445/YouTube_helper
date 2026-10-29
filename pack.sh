#!/bin/sh
# 웹스토어 업로드용 zip. 확장에 실제로 필요한 파일만 담는다.
# 웹스토어는 "key"가 든 manifest를 받지 않으므로 (팀 개발용 ID 고정 키) 빼고 묶는다.
set -e
OUT="$(cd .. && pwd)/youtube-ai-helper.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rm -f "$OUT"
cp -R manifest.json background.js content.js content.css popup icons _locales "$TMP"/
node -e 'const f=process.argv[1],m=require(f);delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$TMP/manifest.json"
(cd "$TMP" && zip -r "$OUT" . -x "*.DS_Store")
echo "→ $OUT"
