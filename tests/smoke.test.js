// 가짜 유튜브 화면에 content.js / content.css를 넣어 동작을 확인하는 스모크 테스트.
// 실제 유튜브 화면 구조는 자주 바뀌므로, 이 테스트가 통과해도 실제 유튜브 점검은 따로 해야 한다.
// 실행: npm install && npm test
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const js = fs.readFileSync(REPO + '/content.js', 'utf8');
const css = fs.readFileSync(REPO + '/content.css', 'utf8');
const stub = `window.__store = { autoClick: !!window.__auto };
window.chrome = { i18n: { getMessage: k => k, getUILanguage: () => 'ko' },
  storage: { local: { get: (k, cb) => setTimeout(() => cb(Object.fromEntries([].concat(k).map(x => [x, window.__store[x]])))), remove(k) { delete window.__store[k]; }, set(o) { Object.assign(window.__store, o); } },
             onChanged: { addListener() {} } },
  runtime: { onMessage: { addListener(f) { window.__onMsg = f; } }, sendMessage(m, cb) { if (m.type === 'GET_SHORTCUTS') setTimeout(() => cb({ 'zoom-in': 'Alt+Shift+Up' })); }, lastError: null, connect() { window.__connected = (window.__connected || 0) + 1; return { onMessage:{addListener(){}}, onDisconnect:{addListener(){}}, postMessage(){}, disconnect(){} }; } } };
// 음성 합성 흉내: 말한 문장을 기록하고 1.5초 뒤 끝남
window.__spoken = [];
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { window.__spoken.push([u.text, Date.now()]); setTimeout(() => u.onend && u.onend(), 1500); } } });
Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: function (text) { this.text = text; } });`;

const shorts = `<html><body style="margin:0">${[0,1,2].map(i => `
  <ytd-reel-video-renderer ${i===1?'is-active':''} style="display:block;height:100vh;position:relative">
    <like-button-view-model><button id="like${i}" aria-label="좋아요 표시" style="position:absolute;right:20px;top:50%;width:40px;height:40px">♥</button></like-button-view-model>
  </ytd-reel-video-renderer>`).join('')}</body></html>`;
const watch = `<html><body style="margin:0;height:4000px">
  <button class="ytp-play-button" aria-label="재생" style="position:absolute;top:100px;left:100px;width:40px;height:40px">▶</button>
  <ytd-subscribe-button-renderer><button id="sub" style="position:absolute;top:200px;left:100px;width:80px;height:40px">구독 취소</button></ytd-subscribe-button-renderer>
  <like-button-view-model><button id="likeW" aria-label="좋아요 표시" style="position:absolute;top:2500px;left:100px;width:40px;height:40px">♥</button></like-button-view-model>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let html = shorts;
  await page.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const load = async (url, auto=false) => {
    await page.goto(url);
    await page.addScriptTag({ content: `window.__auto=${auto};` + stub });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
  };
  const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; };

  // 1. 쇼츠: 활성 쇼츠의 좋아요를 골라야 함
  await load('https://www.youtube.com/shorts/abc');
  await page.evaluate(() => document.getElementById('like1').scrollIntoView({block:'center'}));
  check('shorts picks active reel like', await page.evaluate(() => findTargetElement('like', null)?.id) === 'like1');
  // is-active 없이도 화면 안 기준으로
  await page.evaluate(() => document.querySelectorAll('[is-active]').forEach(e => e.removeAttribute('is-active')));
  check('shorts picks on-screen like without is-active', await page.evaluate(() => findTargetElement('like', null)?.id) === 'like1');
  // 텍스트 매칭 경로
  check('text match picks on-screen', await page.evaluate(() => findElementByTextContent('좋아요 표시')?.id) === 'like1');
  // 쇼츠에서 화면 밖만 있으면 null
  await page.evaluate(() => { document.getElementById('like1').remove(); });
  check('shorts never falls back off-screen', await page.evaluate(() => findTargetElement('like', null)) === null);

  // 2. 일반 영상: 화면 밖 좋아요 → 스크롤해서 보여줌
  html = watch;
  await load('https://www.youtube.com/watch?v=x');
  await page.evaluate(() => quickAction('like', '좋아요'));
  await page.waitForTimeout(800);
  check('watch scrolls off-screen target into view', await page.evaluate(() => isInViewport(document.getElementById('likeW'))));
  check('overlay shown', await page.locator('#ytai-overlay').count() === 1);
  check('aria-live announced', (await page.locator('#ytai-live').textContent()).includes('quickActionInstruction'));

  // 3. 자동 클릭: 구독은 수동, 재생은 자동
  await load('https://www.youtube.com/watch?v=x', true);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.__subClicked = 0; window.__playClicked = 0;
    document.getElementById('sub').addEventListener('click', () => window.__subClicked++);
    document.querySelector('.ytp-play-button').addEventListener('click', () => window.__playClicked++);
    showOverlay({ steps: [{ instruction: '구독', element_type: 'subscribe', element_text: null, target_label: '구독' }, { instruction: 'x', element_type: null }] });
  });
  await page.waitForTimeout(2600);
  check('old autoClick:true migrated to 2s', await page.evaluate(() => _view.autoClick === 2 && window.__store.autoClick === undefined && window.__store.view.autoClick === 2));
  check('subscribe not auto-clicked', await page.evaluate(() => window.__subClicked) === 0);
  check('manual note shown', await page.locator('.ytai-instr-note').count() === 1);
  await page.evaluate(() => { removeOverlay(); stopTracking(); detachClickAdvance();
    showOverlay({ steps: [{ instruction: '재생', element_type: 'play', element_text: null }, { instruction: 'x', element_type: null }] }); });
  await page.waitForTimeout(2600);
  check('play auto-clicked', await page.evaluate(() => window.__playClicked) === 1);
  check('advanced to step 2', (await page.locator('.ytai-instr-text').textContent()) === 'x');
  // 이름만 있는 단계 (종류 없음) → 수동
  await page.evaluate(() => { removeOverlay(); stopTracking(); detachClickAdvance(); window.__playClicked = 0;
    showOverlay({ steps: [{ instruction: 'y', element_type: null, element_text: '재생' }, { instruction: 'x' }] }); });
  await page.waitForTimeout(2600);
  check('text-only step not auto-clicked', await page.evaluate(() => window.__playClicked) === 0);

  // 4. 패널: button, 포커스, Esc
  await load('https://www.youtube.com/watch?v=x');
  check('floating is <button>', await page.evaluate(() => document.getElementById('ytai-btn').tagName) === 'BUTTON');
  await page.focus('#ytai-btn'); await page.keyboard.press('Enter');
  check('panel open + focused', await page.evaluate(() => document.getElementById('ytai-panel').classList.contains('ytai-panel-visible') && document.activeElement.id === 'ytai-panel'));
  await page.keyboard.press('Escape');
  check('Esc closes + focus back', await page.evaluate(() => !document.getElementById('ytai-panel').classList.contains('ytai-panel-visible') && document.activeElement.id === 'ytai-btn'));
  check('close btn aria-label', await page.getAttribute('#ytai-panel-close', 'aria-label') === 'closeLabel');
  await page.keyboard.press('Enter');
  const order = await page.evaluate(() => [...document.querySelectorAll('#ytai-panel-body > *')].filter(e => e.offsetParent).map(e => e.id || e.className));
  check('panel order: voice first, settings last ' + order.join(','), order[0] === 'ytai-voice-btn' && order[order.length - 1] === 'ytai-open-settings' && !order.includes('ytai-type-area'));
  await page.click('#ytai-type-toggle');
  check('type toggle reveals input + focuses', await page.evaluate(() => !document.getElementById('ytai-type-area').hidden && document.activeElement.id === 'ytai-input'));
  await page.screenshot({ path: path.join(SHOTS, 'panel.png') });

  // 5. 움직임 줄이기
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => showOverlay({ steps: [{ instruction: '재생', element_type: 'play' }] }));
  check('reduced motion: pulse hidden, arrow still', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.ytai-pulse')).display === 'none' &&
    getComputedStyle(document.querySelector('.ytai-arrow')).animationName === 'none' &&
    getComputedStyle(document.querySelector('.ytai-arrow')).display !== 'none'));

  // 6. 보기 설정
  html = watch.replace('<body', '<body><div id="movie_player" class="html5-video-player"></div><button class="ytp-subtitles-button" aria-pressed="true" style="position:absolute;top:300px;left:100px;width:40px;height:40px">CC</button').replace('<body><div', '<div').replace('<body style', '<body style');
  html = watch.replace('</body>', '<div id="movie_player" class="html5-video-player"></div><button class="ytp-subtitles-button" aria-pressed="true" style="position:absolute;top:300px;left:300px;width:40px;height:40px">CC</button></body>');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load('https://www.youtube.com/watch?v=x');
  await page.waitForTimeout(100);
  check('dock has 3 buttons', await page.locator('#ytai-dock > button').count() === 3);
  const w0 = await page.evaluate(() => document.getElementById('ytai-btn').getBoundingClientRect().height);
  await page.evaluate(() => { window.__keys = []; document.getElementById('movie_player').addEventListener('keydown', e => window.__keys.push(e.key)); });
  await page.click('.ytai-zoom-btn >> nth=1'); // 가+
  check('가+ → large', await page.evaluate(() => document.documentElement.dataset.ytaiSize) === 'large');
  check('가+ sends caption +', JSON.stringify(await page.evaluate(() => window.__keys)) === '["+"]');
  check('size saved', await page.evaluate(() => window.__store.view.size) === 'large');
  const w1 = await page.evaluate(() => document.getElementById('ytai-btn').getBoundingClientRect().height);
  check('buttons grow with text (' + w0 + '→' + w1 + ')', w1 > w0 * 1.2);
  await page.click('.ytai-zoom-btn >> nth=1');
  await page.click('.ytai-zoom-btn >> nth=1');
  check('stays at xlarge + max toast', await page.evaluate(() => document.documentElement.dataset.ytaiSize) === 'xlarge' && (await page.locator('#ytai-toast').textContent()).startsWith('sizeMaxToast'));
  await page.click('#ytai-btn');
  await page.click('#ytai-open-settings');
  check('settings open, title swapped', await page.locator('#ytai-panel-title').textContent() === 'settingsTitle' && await page.locator('#ytai-settings-body').isVisible() && !(await page.locator('#ytai-panel-body').isVisible()));
  check('xlarge choice pressed', await page.getAttribute('[data-view-key=size][data-view-value=xlarge]', 'aria-pressed') === 'true');
  const pr = await page.evaluate(() => { const r = document.getElementById('ytai-panel').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; });
  check('panel fits viewport at xlarge ' + pr, pr[0] >= 0 && pr[1] <= pr[2]);
  await page.screenshot({ path: path.join(SHOTS, 'settings-xlarge.png') });
  await page.click('[data-view-key=color][data-view-value=contrast]');
  await page.waitForTimeout(400);
  check('contrast theme applied', await page.evaluate(() => getComputedStyle(document.getElementById('ytai-btn')).backgroundColor) === 'rgb(255, 212, 0)');
  await page.click('[data-view-key=size][data-view-value=normal]');
  await page.click('[data-view-key=autoClick][data-view-value="5"]');
  check('auto-click 5s saved as number', await page.evaluate(() => window.__store.view.autoClick) === 5);
  check('no caption row in settings', await page.locator('#ytai-caption-up').count() === 0);
  await page.click('#ytai-tts-chk');
  await page.waitForTimeout(200);
  check('tts on speaks sample', await page.evaluate(() => window.__spoken.map(x => x[0]).includes('ttsOnSample')));
  await page.screenshot({ path: path.join(SHOTS, 'settings-contrast.png') });
  await page.click('#ytai-settings-back');
  check('back to main', await page.locator('#ytai-panel-body').isVisible());
  // 캡션 꺼져 있으면 안 보냄
  await page.evaluate(() => { document.querySelector('.ytp-subtitles-button').setAttribute('aria-pressed', 'false'); window.__keys = []; });
  await page.click('.ytai-zoom-btn >> nth=1');
  check('no caption key when CC off', (await page.evaluate(() => window.__keys)).length === 0);

  // 7. 소리로 읽기 + 자동 클릭: 다 읽은 뒤 카운트다운
  await page.evaluate(() => { hidePanel(); window.__playClicked = 0; window.__spoken = [];
    document.querySelector('.ytp-play-button').addEventListener('click', () => window.__playClicked = Date.now());
    setView('autoClick', 2);
    showOverlay({ steps: [{ instruction: '재생 버튼을 누르세요', element_type: 'play' }, { instruction: '끝' }] }); });
  check('dock hidden during guide', !(await page.locator('#ytai-dock').isVisible()));
  await page.waitForTimeout(4200);
  const [spokeAt, clickedAt] = await page.evaluate(() => [window.__spoken.find(x => x[0] === '재생 버튼을 누르세요')?.[1], window.__playClicked]);
  check('auto-click waits for speech (' + (clickedAt - spokeAt) + 'ms)', clickedAt && clickedAt - spokeAt >= 1500 + 2000 - 200);
  await page.screenshot({ path: path.join(SHOTS, 'guide-contrast.png') });

  // 8. 쇼츠 빠른 버튼
  html = `<html><body style="margin:0">
    <div id="navigation-button-up"><button id="navUp" style="position:fixed;right:10px;top:40%;width:40px;height:40px">↑</button></div>
    <div id="navigation-button-down"><button id="navDown" style="position:fixed;right:10px;top:55%;width:40px;height:40px">↓</button></div>
    ${[0,1,2].map(i => `<ytd-reel-video-renderer id="reel${i}" ${i===1?'is-active':''} style="display:block;height:100vh"></ytd-reel-video-renderer>`).join('')}</body></html>`;
  await load('https://www.youtube.com/shorts/abc');
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__nav = []; navUp.onclick = () => __nav.push('up'); navDown.onclick = () => __nav.push('down'); });
  await page.click('#ytai-btn');
  const types = await page.evaluate(() => [...document.querySelectorAll('.ytai-quick-btn')].map(b => b.dataset.type));
  check('shorts grid swaps slots ' + types.join(','), types.includes('next_short') && types.includes('prev_short') && !types.includes('next_video') && !types.includes('fullscreen'));
  await page.click('[data-type=next_short]');
  check('next short clicks nav down', JSON.stringify(await page.evaluate(() => __nav)) === '["down"]');
  // 버튼이 없으면 옆 쇼츠로 스크롤
  await page.evaluate(() => { document.getElementById('navigation-button-down').remove(); document.getElementById('reel1').scrollIntoView(); });
  await page.evaluate(() => goShorts(1));
  await page.waitForTimeout(800);
  check('fallback scrolls to next reel', await page.evaluate(() => Math.abs(document.getElementById('reel2').getBoundingClientRect().top) < 5));
  // 일반 화면으로 돌아가면 원래대로
  html = watch;
  await load('https://www.youtube.com/watch?v=x');
  await page.waitForTimeout(100);
  await page.click('#ytai-btn');
  const types2 = await page.evaluate(() => [...document.querySelectorAll('.ytai-quick-btn')].map(b => b.dataset.type));
  check('normal grid keeps next_video/fullscreen', types2.includes('next_video') && types2.includes('fullscreen'));

  // 9. 말로 설정 바꾸기
  const cmd = async (text) => page.evaluate((t) => { window.__connected = 0; submitRequest(t); return [document.documentElement.dataset.ytaiSize, document.documentElement.dataset.ytaiColor, _view.tts, window.__connected]; }, text);
  let r = await cmd('글씨 크게 해 줘');
  check('"글씨 크게 해 줘" → large, no server', r[0] === 'large' && r[3] === 0);
  r = await cmd('더 크게 해주세요.');
  check('"더 크게 해주세요." → xlarge', r[0] === 'xlarge');
  r = await cmd('글씨 좀 작게');
  check('"글씨 좀 작게" → large', r[0] === 'large');
  r = await cmd('소리로 읽어 줘');
  check('"소리로 읽어 줘" → tts on', r[2] === true && r[3] === 0);
  r = await cmd('그만 읽어');
  check('"그만 읽어" → tts off', r[2] === false);
  r = await cmd('고대비로 바꿔 줘');
  check('"고대비로 바꿔 줘" → contrast', r[1] === 'contrast');
  r = await cmd('기본색으로 돌려 줘');
  check('"기본색으로 돌려 줘" → default', r[1] === 'default');
  r = await cmd('자막 크게 하는 법 알려줘');
  check('real question goes to AI', r[3] === 1);
  await page.evaluate(() => resetPanel());
  r = await cmd('글씨를 크게 보고 싶은데 어떻게 해');
  check('long sentence goes to AI', r[3] === 1);
  await page.evaluate(() => resetPanel());

  // 10. 단축키 메시지
  await page.evaluate(() => { hidePanel(); setView('size', 'normal'); });
  await page.evaluate(() => window.__onMsg({ type: 'YTAI_COMMAND', command: 'zoom-in' }));
  check('shortcut zoom-in', await page.evaluate(() => document.documentElement.dataset.ytaiSize) === 'large');
  await page.evaluate(() => window.__onMsg({ type: 'YTAI_COMMAND', command: 'toggle-helper' }));
  check('shortcut toggles panel', await page.evaluate(() => document.getElementById('ytai-panel').classList.contains('ytai-panel-visible')));
  check('tooltip shows shortcut', (await page.getAttribute('#ytai-zoom-in', 'title')) === 'zoomInLabel (Alt+Shift+Up)');

  // 11. 미니플레이어 피하기
  html = watch.replace('</body>', '<ytd-app></ytd-app><ytd-miniplayer style="display:none;position:fixed;right:12px;bottom:12px;width:400px;height:280px;background:#333"></ytd-miniplayer></body>');
  await load('https://www.youtube.com/watch?v=x');
  await page.waitForTimeout(100);
  const dockBottom = () => page.evaluate(() => innerHeight - document.getElementById('ytai-dock').getBoundingClientRect().bottom);
  check('dock at 80px normally', Math.round(await dockBottom()) === 80);
  await page.evaluate(() => { document.querySelector('ytd-miniplayer').style.display = 'block'; document.querySelector('ytd-app').setAttribute('miniplayer-is-active', ''); });
  await page.waitForTimeout(600);
  const mini = await page.evaluate(() => { const d = document.getElementById('ytai-dock').getBoundingClientRect(), m = document.querySelector('ytd-miniplayer').getBoundingClientRect(); return d.bottom <= m.top; });
  check('dock moves above miniplayer', mini);
  await page.click('#ytai-btn');
  check('panel above dock', await page.evaluate(() => document.getElementById('ytai-panel').getBoundingClientRect().bottom <= document.getElementById('ytai-dock').getBoundingClientRect().top && document.getElementById('ytai-panel').getBoundingClientRect().top >= 0));
  await page.screenshot({ path: path.join(SHOTS, 'miniplayer.png') });
  await page.evaluate(() => { document.querySelector('ytd-miniplayer').style.display = 'none'; document.querySelector('ytd-app').removeAttribute('miniplayer-is-active'); });
  await page.waitForTimeout(600);
  check('dock back to 80px', Math.round(await dockBottom()) === 80);
  await page.evaluate(() => { setView('size', 'xlarge'); });
  await page.waitForTimeout(300);
  check('xlarge panel fits without inner scroll? ' + await page.evaluate(() => { const p = document.getElementById('ytai-panel'); return p.scrollHeight + '/' + p.clientHeight; }), true);
  await page.screenshot({ path: path.join(SHOTS, 'panel-xlarge.png') });

  // 12. 도우미 자신의 버튼은 AI에게 보내지 않고, 가리키지도 않는다
  html = watch;
  await load('https://www.youtube.com/watch?v=x');
  await page.waitForTimeout(100);
  await page.evaluate(() => togglePanel());
  const snapTexts = await page.evaluate(() => getPageSnapshot().map(e => e.t));
  check('snapshot excludes own UI ' + JSON.stringify(snapTexts), !snapTexts.some(t => /^(zoomInLabel|zoomOutLabel|closeLabel)$/.test(t)) && snapTexts.includes('재생'));
  check('finder never points at own close button', await page.evaluate(() => findElementByTextContent('closeLabel')) === null);

  // 13. 볼륨: 막대 끌기 → 음소거 두 단계, 누르거나 자동 클릭해도 음소거되지 않게
  html = watch.replace('</body>', '<button class="ytp-mute-button" aria-label="음소거" style="position:absolute;top:100px;left:160px;width:40px;height:40px">🔊</button></body>');
  await load('https://www.youtube.com/watch?v=x', true); // 자동 클릭 켠 상태
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__muteClicks = 0; document.querySelector('.ytp-mute-button').addEventListener('click', () => window.__muteClicks++); quickAction('volume', '볼륨'); });
  check('volume guide step 1 = slider', (await page.locator('.ytai-instr-text').textContent()) === 'volumeStepSlider' && (await page.locator('.ytai-step-indicator').textContent()) === '1 / 2');
  check('volume step 1 button says next, no countdown', (await page.locator('#ytai-instr-ok').textContent()) === 'nextBtn');
  await page.waitForTimeout(2600);
  check('volume never auto-clicked (no accidental mute)', await page.evaluate(() => window.__muteClicks) === 0);
  await page.evaluate(() => document.querySelector('.ytp-mute-button').click());
  await page.waitForTimeout(400);
  check('clicking mute on step 1 does not jump to step 2', (await page.locator('.ytai-instr-text').textContent()) === 'volumeStepSlider');
  await page.click('#ytai-instr-ok');
  check('next → step 2 = mute', (await page.locator('.ytai-instr-text').textContent()) === 'volumeStepMute');
  // AI가 point_only 없이 볼륨 단계를 줘도 자동 클릭하지 않음
  await page.evaluate(() => { removeOverlay(); stopTracking(); detachClickAdvance(); window.__muteClicks = 0;
    showOverlay({ steps: [{ instruction: '볼륨', element_type: 'volume', element_text: '음소거' }, { instruction: '끝' }] }); });
  await page.waitForTimeout(2600);
  check('AI volume step not auto-clicked', await page.evaluate(() => window.__muteClicks) === 0);
  await browser.close();
})();
