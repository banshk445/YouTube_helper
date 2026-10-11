const t = (key) => chrome.i18n.getMessage(key);
const YTAI_LANG = chrome.i18n.getUILanguage().startsWith('ko') ? 'ko' : 'en';
// 스냅샷의 영역 라벨도 프롬프트에 그대로 들어가므로 UI 언어에 맞춘다.
const AREA = YTAI_LANG === 'en'
  ? { main: 'main', player: 'player', sidebar: 'sidebar', header: 'header', right: 'right' }
  : { main: '메인', player: '플레이어', sidebar: '사이드바', header: '헤더', right: '우측' };

const MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

// Prevent double injection
if (window.__ytAiHelperLoaded) {
  // already loaded
} else {
  window.__ytAiHelperLoaded = true;
  initHelper();
}

function initHelper() {
  createDock();
  createHelperPanel();
  createLiveRegion();
  loadViewSettings();
  listenForShortcuts();
  watchMiniplayer();
}

// ─── 미니플레이어 피하기 ─────────────────────────────────────────────────────
// 유튜브 미니플레이어도 화면 오른쪽 아래에 뜬다. 떠 있으면 버튼 묶음(가-/가+/도움받기)과
// 패널·알림을 그 위로 올린다. 위치는 content.css의 --ytai-dock-bottom 변수.

function watchMiniplayer() {
  const update = () => {
    const r = document.querySelector('ytd-miniplayer')?.getBoundingClientRect();
    const inCorner = r && r.width > 0 && r.height > 0 &&
      r.right > window.innerWidth - 200 && r.bottom > window.innerHeight - 200;
    document.documentElement.style.setProperty(
      '--ytai-dock-bottom',
      inCorner ? Math.round(window.innerHeight - r.top + 16) + 'px' : '80px'
    );
  };
  // 미니플레이어는 열리고 닫힐 때 애니메이션이 있어서 끝난 뒤 한 번 더 잰다
  const later = () => { update(); setTimeout(update, 400); };
  const app = document.querySelector('ytd-app');
  if (app) new MutationObserver(later).observe(app, { attributes: true });
  window.addEventListener('resize', update);
  document.addEventListener('yt-navigate-finish', later);
  update();
}

// ─── 단축키 (보조 수단) ──────────────────────────────────────────────────────
// manifest의 commands → background.js가 받아서 이 탭으로 전달한다.
// 확장 단축키는 크롬이 먼저 가로채므로 전체화면에서도 동작한다.

function listenForShortcuts() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'YTAI_COMMAND') return;
    if (msg.command === 'toggle-helper') togglePanel();
    else if (msg.command === 'zoom-in') stepViewSize(1);
    else if (msg.command === 'zoom-out') stepViewSize(-1);
  });

  // 버튼에 마우스를 올리면 단축키를 보여 준다. 사용자가 chrome://extensions/shortcuts에서
  // 바꿨을 수 있으므로 실제 지정된 키를 background에 물어본다 (content script에서는 chrome.commands를 못 씀).
  chrome.runtime.sendMessage({ type: 'GET_SHORTCUTS' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    const hint = (id, cmd) => {
      const el = document.getElementById(id);
      if (el && res[cmd]) el.title = `${el.title || el.getAttribute('aria-label') || ''} (${res[cmd]})`.trim();
    };
    hint('ytai-btn', 'toggle-helper');
    hint('ytai-zoom-in', 'zoom-in');
    hint('ytai-zoom-out', 'zoom-out');
  });
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── 화면낭독기용 알림 영역 ──────────────────────────────────────────────────
// aria-live 영역은 매번 새로 만들면 읽히지 않는 경우가 많아서, 처음에 한 번 만들어
// 두고 글자만 바꾼다.

function createLiveRegion() {
  const live = document.createElement('div');
  live.id = 'ytai-live';
  live.className = 'ytai-sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
}

function announce(text) {
  const live = document.getElementById('ytai-live');
  if (!live || !text) return;
  // 같은 문장이 연달아 와도 다시 읽히도록 비웠다가 채운다
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}

// ─── 화면 아래 버튼 묶음 (가- / 가+ / 도움받기) ──────────────────────────────
// 화면을 가리지 않도록 항상 떠 있는 버튼은 이 3개까지만 둔다.

function createDock() {
  const dock = document.createElement('div');
  dock.id = 'ytai-dock';

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'ytai-zoom-btn';
  zoomOut.id = 'ytai-zoom-out';
  zoomOut.innerHTML = '<span aria-hidden="true">가<small>−</small></span>';
  zoomOut.setAttribute('aria-label', t('zoomOutLabel'));
  zoomOut.title = t('zoomOutLabel');
  zoomOut.addEventListener('click', () => stepViewSize(-1));

  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'ytai-zoom-btn';
  zoomIn.id = 'ytai-zoom-in';
  zoomIn.innerHTML = '<span aria-hidden="true">가<small>+</small></span>';
  zoomIn.setAttribute('aria-label', t('zoomInLabel'));
  zoomIn.title = t('zoomInLabel');
  zoomIn.addEventListener('click', () => stepViewSize(1));

  dock.append(zoomOut, zoomIn, createFloatingButton());
  document.body.appendChild(dock);
}

function createFloatingButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'ytai-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'ytai-panel');
  btn.title = t('floatingBtnLabel');
  btn.innerHTML = `<span class="ytai-btn-icon"></span><span class="ytai-btn-label">${t('floatingBtnLabel')}</span>`;
  btn.addEventListener('click', togglePanel);
  return btn;
}

// ─── Helper panel (voice + chat) ─────────────────────────────────────────────

function createHelperPanel() {
  const panel = document.createElement('div');
  panel.id = 'ytai-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'ytai-panel-title');
  panel.tabIndex = -1;
  panel.innerHTML = `
    <div class="ytai-panel-header">
      <span id="ytai-panel-title">${t('panelHeaderTitle')}</span>
      <button type="button" class="ytai-close-btn" id="ytai-panel-close" aria-label="${t('closeLabel')}"><span aria-hidden="true">✕</span></button>
    </div>
    <div class="ytai-panel-body" id="ytai-panel-body">
      <button type="button" id="ytai-voice-btn" class="ytai-voice-btn">
        ${MIC_ICON}
        <span>${t('voiceBtnLabel')}</span>
      </button>
      <div id="ytai-voice-status" class="ytai-voice-status" aria-live="polite"></div>

      <div class="ytai-quick-grid">
        <button class="ytai-quick-btn" data-type="play" data-label="${t('quickPlay')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 19,12 5,21"/></svg>
          <span>${t('quickPlay')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="volume" data-label="${t('quickVolume')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07,4.93a10,10,0,0,1,0,14.14"/><path d="M15.54,8.46a5,5,0,0,1,0,7.07"/></svg>
          <span>${t('quickVolume')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="subtitles" data-label="${t('quickSubtitles')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="7" y1="11" x2="11" y2="11"/><line x1="13" y1="11" x2="17" y2="11"/><line x1="7" y1="15" x2="10" y2="15"/></svg>
          <span>${t('quickSubtitles')}</span>
        </button>
        <button class="ytai-quick-btn" data-slot="a" data-type="fullscreen" data-label="${t('quickFullscreen')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          <span>${t('quickFullscreen')}</span>
        </button>
        <button class="ytai-quick-btn" data-slot="b" data-type="next_video" data-label="${t('quickNext')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          <span>${t('quickNext')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="like" data-label="${t('quickLike')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          <span>${t('quickLike')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="save" data-label="${t('quickSave')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span>${t('quickSave')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="search" data-label="${t('quickSearch')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>${t('quickSearch')}</span>
        </button>
        <button class="ytai-quick-btn" data-type="home" data-label="${t('quickHome')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
          <span>${t('quickHome')}</span>
        </button>
      </div>

      <!-- 글자 입력은 기본으로 접어 둔다. 어르신에게는 말하기와 빠른 버튼이 먼저 -->
      <button type="button" class="ytai-type-toggle" id="ytai-type-toggle" aria-expanded="false" aria-controls="ytai-type-area">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/></svg>
        <span>${t('typeToggle')}</span>
      </button>
      <div class="ytai-type-area" id="ytai-type-area" hidden>
        <textarea id="ytai-input" placeholder="${t('inputPlaceholder')}" rows="3" aria-label="${t('typeToggle')}"></textarea>
        <button type="button" id="ytai-send-btn" class="ytai-send-btn">${t('sendBtnLabel')}</button>
      </div>
      <div id="ytai-loading" class="ytai-loading" style="display:none">
        <div class="ytai-spinner"></div>
        <span>${t('loadingText')}</span>
      </div>

      <button type="button" class="ytai-open-settings" id="ytai-open-settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>${t('openSettingsBtn')}</span>
      </button>
    </div>
    ${settingsHtml()}
  `;
  document.body.appendChild(panel);

  document.getElementById('ytai-type-toggle').addEventListener('click', (e) => {
    const area = document.getElementById('ytai-type-area');
    area.hidden = !area.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!area.hidden));
    if (!area.hidden) document.getElementById('ytai-input').focus();
  });

  // 퀵액션 버튼
  document.querySelectorAll('.ytai-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quickAction(btn.dataset.type, btn.dataset.label);
    });
  });

  document.getElementById('ytai-panel-close').addEventListener('click', hidePanel);
  bindSettings();
  // Esc는 포커스가 패널 안에 있을 때만 받는다 (유튜브 메뉴 닫기 등과 겹치지 않게)
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hidePanel();
    }
  });
  document.getElementById('ytai-voice-btn').addEventListener('click', startVoice);
  document.getElementById('ytai-send-btn').addEventListener('click', () => {
    const val = document.getElementById('ytai-input').value.trim();
    if (val) submitRequest(val);
  });
  document.getElementById('ytai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = document.getElementById('ytai-input').value.trim();
      if (val) submitRequest(val);
    }
  });
}

function togglePanel() {
  const panel = document.getElementById('ytai-panel');
  if (panel.classList.contains('ytai-panel-visible')) {
    hidePanel();
    return;
  }
  updateQuickGridForPage();
  panel.classList.add('ytai-panel-visible');
  document.getElementById('ytai-btn')?.setAttribute('aria-expanded', 'true');
  // 키보드·화면낭독기 사용자가 바로 패널 안에서 시작하도록 포커스를 옮긴다
  panel.focus();
}

function hidePanel() {
  const panel = document.getElementById('ytai-panel');
  if (!panel) return;
  const hadFocus = panel.contains(document.activeElement);
  panel.classList.remove('ytai-panel-visible');
  closeSettings();
  const btn = document.getElementById('ytai-btn');
  btn?.setAttribute('aria-expanded', 'false');
  // 패널 안에 있던 포커스는 도움받기 버튼으로 돌려준다 (버튼이 숨겨져 있으면 무시됨)
  if (hadFocus) btn?.focus();
}

function resetPanel() {
  document.getElementById('ytai-loading').style.display = 'none';
  document.getElementById('ytai-panel-body').classList.remove('ytai-loading-mode');
  document.getElementById('ytai-input').value = '';
  document.getElementById('ytai-voice-status').textContent = '';
}

// ─── 보기 설정 ───────────────────────────────────────────────────────────────
// 글씨 크기·강조색·소리로 읽기·자동 클릭 대기 시간. chrome.storage에 저장해서
// 다른 유튜브 탭과 다음 방문에도 그대로 유지한다. 화면에 적용하는 건
// <html>의 data-ytai-* 속성 → content.css의 변수.

const VIEW_SIZES = ['normal', 'large', 'xlarge'];
// autoClick: 0이면 끔, 2·5·10이면 그 초만큼 기다렸다가 자동 클릭
const VIEW_DEFAULTS = { size: 'normal', color: 'default', tts: false, autoClick: 0 };
let _view = { ...VIEW_DEFAULTS };

function sanitizeView(v) {
  const out = { ...VIEW_DEFAULTS, ...(v || {}) };
  if (!VIEW_SIZES.includes(out.size)) out.size = VIEW_DEFAULTS.size;
  if (!['default', 'contrast'].includes(out.color)) out.color = VIEW_DEFAULTS.color;
  if (![0, 2, 5, 10].includes(out.autoClick)) out.autoClick = VIEW_DEFAULTS.autoClick;
  delete out.autoClickDelay;
  out.tts = !!out.tts;
  return out;
}

function loadViewSettings() {
  // 크롬은 음성 목록을 처음 요청할 때 불러오므로 미리 한 번 불러 둔다 (첫 안내부터 설치된 음성을 쓰도록)
  if ('speechSynthesis' in window) speechSynthesis.getVoices?.();
  chrome.storage.local.get(['view', 'autoClick'], (data) => {
    const v = { ...(data.view || {}) };
    // 예전 버전 저장값 옮기기: 자동 클릭 켜기/끄기(autoClick: true/false) + 대기 시간(autoClickDelay)
    if (v.autoClick === undefined && (data.autoClick !== undefined || v.autoClickDelay !== undefined)) {
      v.autoClick = data.autoClick ? ([2, 5, 10].includes(v.autoClickDelay) ? v.autoClickDelay : 2) : 0;
      chrome.storage.local.remove('autoClick');
      chrome.storage.local.set({ view: sanitizeView(v) });
    }
    _view = sanitizeView(v);
    applyViewSettings();
  });
  // 다른 탭에서 바꾼 설정도 바로 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.view) return;
    _view = sanitizeView(changes.view.newValue);
    applyViewSettings();
  });
}

function applyViewSettings() {
  const root = document.documentElement;
  root.dataset.ytaiSize = _view.size;
  root.dataset.ytaiColor = _view.color;

  document.querySelectorAll('#ytai-settings-body [data-view-key]').forEach(btn => {
    const on = String(_view[btn.dataset.viewKey]) === btn.dataset.viewValue;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const tts = document.getElementById('ytai-tts-chk');
  if (tts) tts.checked = _view.tts;
  if (!_view.tts) stopSpeaking();
}

function setView(key, value) {
  _view = sanitizeView({ ..._view, [key]: value });
  applyViewSettings();
  chrome.storage.local.set({ view: _view });
}

function sizeLabel(size) {
  return t({ normal: 'sizeNormal', large: 'sizeLarge', xlarge: 'sizeXLarge' }[size]);
}

// 가+ / 가- : 도우미 글씨·버튼과 (켜져 있으면) 유튜브 자막을 한 번에 한 단계씩
function stepViewSize(dir) {
  const i = VIEW_SIZES.indexOf(_view.size);
  const next = Math.min(VIEW_SIZES.length - 1, Math.max(0, i + dir));
  const captions = changeCaptionSize(dir);
  if (next !== i) {
    setView('size', VIEW_SIZES[next]);
    showToast(t('sizeChangedToast').replace('{size}', sizeLabel(VIEW_SIZES[next])) + (captions ? ' ' + t('captionAlsoChanged') : ''));
  } else {
    showToast(t(dir > 0 ? 'sizeMaxToast' : 'sizeMinToast') + (captions ? ' ' + t('captionAlsoChanged') : ''));
  }
}

// 자막 크기는 CSS로 덮어쓰지 않고 유튜브 자체 기능(키보드 +/-)을 부른다.
// 유튜브는 자막 위치·크기를 직접 계산해서 요소에 넣기 때문에 CSS로 덮으면
// 화면 밖으로 밀리거나 업데이트 때 깨지기 쉽다. 유튜브 설정으로 바꾸면 다음 영상에도 유지된다.
// 자막이 켜져 있을 때만 보낸다 (꺼져 있으면 아무 변화가 없어 사용자가 헷갈림).
function changeCaptionSize(dir) {
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player) return false;
  const ccOn = [...document.querySelectorAll('.ytp-subtitles-button[aria-pressed="true"]')].some(isInViewport);
  if (!ccOn) return false;
  const plus = dir > 0;
  player.dispatchEvent(new KeyboardEvent('keydown', {
    key: plus ? '+' : '-',
    code: plus ? 'NumpadAdd' : 'NumpadSubtract',
    keyCode: plus ? 107 : 109,
    which: plus ? 107 : 109,
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
  return true;
}

function settingsHtml() {
  const zoomKey = /Mac/i.test(navigator.platform) ? '⌘ +' : 'Ctrl + +';
  const choice = (key, value, inner) =>
    `<button type="button" class="ytai-choice" data-view-key="${key}" data-view-value="${value}" aria-pressed="false">${inner}</button>`;
  return `
    <div class="ytai-settings-body" id="ytai-settings-body">
      <div class="ytai-setting" role="group" aria-labelledby="ytai-set-size">
        <div class="ytai-setting-label" id="ytai-set-size">${t('settingSize')}</div>
        <div class="ytai-choice-row">
          ${choice('size', 'normal', `<span class="ytai-choice-sample" style="font-size:14px" aria-hidden="true">가</span>${t('sizeNormal')}`)}
          ${choice('size', 'large', `<span class="ytai-choice-sample" style="font-size:18px" aria-hidden="true">가</span>${t('sizeLarge')}`)}
          ${choice('size', 'xlarge', `<span class="ytai-choice-sample" style="font-size:22px" aria-hidden="true">가</span>${t('sizeXLarge')}`)}
        </div>
        <p class="ytai-setting-hint">${t('pageZoomHint').replace('{key}', zoomKey)}</p>
      </div>

      <div class="ytai-setting" role="group" aria-labelledby="ytai-set-color">
        <div class="ytai-setting-label" id="ytai-set-color">${t('settingColor')}</div>
        <div class="ytai-choice-row">
          ${choice('color', 'default', `<span class="ytai-swatch ytai-swatch-default" aria-hidden="true"></span>${t('colorDefault')}`)}
          ${choice('color', 'contrast', `<span class="ytai-swatch ytai-swatch-contrast" aria-hidden="true"></span>${t('colorContrast')}`)}
        </div>
      </div>

      <div class="ytai-setting">
        <div class="ytai-setting-switch-row">
          <span class="ytai-setting-label" id="ytai-set-tts">${t('settingTts')}</span>
          <label class="ytai-switch">
            <input type="checkbox" id="ytai-tts-chk" aria-labelledby="ytai-set-tts">
            <span class="ytai-slider"></span>
          </label>
        </div>
        <p class="ytai-setting-hint">${t('settingTtsHint')}</p>
      </div>

      <div class="ytai-setting" role="group" aria-labelledby="ytai-set-autoclick">
        <div class="ytai-setting-label" id="ytai-set-autoclick">${t('autoClickLabel')}</div>
        <div class="ytai-choice-row">
          ${choice('autoClick', '0', t('autoClickOff'))}
          ${choice('autoClick', '2', t('delaySeconds').replace('{n}', 2))}
          ${choice('autoClick', '5', t('delaySeconds').replace('{n}', 5))}
          ${choice('autoClick', '10', t('delaySeconds').replace('{n}', 10))}
        </div>
        <p class="ytai-setting-hint">${t('autoClickHint')}</p>
      </div>

      <button type="button" class="ytai-back-btn" id="ytai-settings-back">${t('settingsBack')}</button>
    </div>
  `;
}

function bindSettings() {
  document.getElementById('ytai-open-settings').addEventListener('click', openSettings);
  document.getElementById('ytai-settings-back').addEventListener('click', () => {
    closeSettings();
    document.getElementById('ytai-open-settings').focus();
  });

  document.querySelectorAll('#ytai-settings-body [data-view-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.viewKey;
      const value = key === 'autoClick' ? Number(btn.dataset.viewValue) : btn.dataset.viewValue;
      setView(key, value);
    });
  });

  document.getElementById('ytai-tts-chk').addEventListener('change', (e) => {
    if (e.target.checked && !('speechSynthesis' in window)) {
      e.target.checked = false;
      showToast(t('ttsUnsupported'));
      return;
    }
    setView('tts', e.target.checked);
    if (e.target.checked) speak(t('ttsOnSample'));
  });

}

function openSettings() {
  const panel = document.getElementById('ytai-panel');
  panel.classList.add('ytai-settings-open');
  document.getElementById('ytai-panel-title').textContent = t('settingsTitle');
  panel.scrollTop = 0;
  document.querySelector('#ytai-settings-body [aria-pressed="true"]')?.focus();
}

function closeSettings() {
  const panel = document.getElementById('ytai-panel');
  if (!panel?.classList.contains('ytai-settings-open')) return;
  panel.classList.remove('ytai-settings-open');
  document.getElementById('ytai-panel-title').textContent = t('panelHeaderTitle');
}

// ─── 소리로 읽기 (브라우저 내장 음성 합성) ───────────────────────────────────
// 다 읽으면 resolve된다. 크롬은 가끔 onend를 안 부르는 버그가 있어서 길이 기반 시간 제한을 둔다.

function speak(text) {
  return new Promise((resolve) => {
    if (!_view.tts || !text || !('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = YTAI_LANG === 'ko' ? 'ko-KR' : 'en-US';
    // 크롬의 "Google 한국어" 같은 온라인 음성은 문장을 구글 서버로 보낸다.
    // 컴퓨터에 설치된 음성(Windows: Microsoft Heami, Mac: Yuna 등)이 있으면 그것을 쓴다.
    const voice = speechSynthesis.getVoices?.().find(v => v.localService && v.lang.replace('_', '-').startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    const timer = setTimeout(resolve, 3000 + text.length * 250);
    u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
    // cancel() 직후 바로 speak()하면 크롬에서 무시되는 경우가 있어 한 틱 늦춘다
    setTimeout(() => speechSynthesis.speak(u), 50);
  });
}

function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ─── Voice recognition ────────────────────────────────────────────────────────

let recognition = null;

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast(t('voiceUnsupported'));
    return;
  }

  if (recognition) {
    recognition.stop();
    return;
  }

  recognition = new SR();
  recognition.lang = YTAI_LANG === 'ko' ? 'ko-KR' : 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;

  const btn = document.getElementById('ytai-voice-btn');
  const status = document.getElementById('ytai-voice-status');

  btn.classList.add('ytai-recording');
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>${t('voiceListening')}</span>`;
  status.textContent = t('voiceSpeakPrompt');

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    status.textContent = transcript;
    document.getElementById('ytai-input').value = transcript;
  };

  recognition.onend = () => {
    btn.classList.remove('ytai-recording');
    btn.innerHTML = `${MIC_ICON}<span>${t('voiceBtnLabel')}</span>`;
    recognition = null;
    const val = document.getElementById('ytai-input').value.trim();
    if (val) setTimeout(() => submitRequest(val), 400);
  };

  recognition.onerror = () => {
    btn.classList.remove('ytai-recording');
    btn.innerHTML = `${MIC_ICON}<span>${t('voiceBtnLabel')}</span>`;
    status.textContent = t('voiceError');
    recognition = null;
  };

  recognition.start();
}

// ─── 말로 설정 바꾸기 (AI 서버로 보내지 않고 직접 처리) ─────────────────────
// "글씨 크게 해 줘", "소리로 읽어 줘" 같은 짧은 명령은 여기서 바로 처리한다. 빠르고 비용이 없다.
// "자막 크게 하는 법 알려줘" 같은 진짜 질문까지 가로채지 않도록, 끝말(해 줘·주세요 등)을
// 떼어 낸 뒤 문장 전체가 명령 모양과 정확히 맞을 때만 처리한다.

const LOCAL_COMMANDS = {
  ko: [
    [/^(글씨|글자)?(를|을)?더?(크게|키워|확대)$/,               () => stepViewSize(1)],
    [/^(글씨|글자)?(를|을)?더?(작게|줄여|축소)$/,               () => stepViewSize(-1)],
    [/^(안내)?(를|을)?(소리로|소리내서|음성으로)?읽어$|^(소리로읽기|읽어주기)(를|을)?켜$/, () => setTtsFromCommand(true)],
    [/^(소리로읽기|읽어주기|소리|음성|읽기)(를|을)?(꺼|그만)$|^그만읽어$|^읽지마$/, () => setTtsFromCommand(false)],
    [/^(고대비|노란색|노랑|노랑검정)(으로|로|색으로)?(바꿔|켜)?$/, () => setColorFromCommand('contrast')],
    [/^(기본색|원래색|기본|원래)(으로|색으로)?(바꿔|돌려)?$/,             () => setColorFromCommand('default')],
    [/^자막(을|를)?더?(크게|키워)$/,                             () => captionFromCommand(1)],
    [/^자막(을|를)?더?(작게|줄여)$/,                             () => captionFromCommand(-1)],
    [/^보기설정(열어)?$/,                                         () => { openSettings(); return true; }],
  ],
  en: [
    [/^(make )?(the )?(text )?(bigger|larger)$|^zoom in$|^(increase|enlarge) (the )?text( size)?$/, () => stepViewSize(1)],
    [/^(make )?(the )?(text )?smaller$|^zoom out$|^(decrease|reduce) (the )?text( size)?$/,          () => stepViewSize(-1)],
    [/^(turn on )?read( it)?( out)? aloud$|^read (it )?to me$|^read aloud on$/,                   () => setTtsFromCommand(true)],
    [/^(turn off read aloud|stop reading|read aloud off|don't read)$/,                              () => setTtsFromCommand(false)],
    [/^(turn on )?high contrast( mode)?$|^yellow( and black)?$/,                                    () => setColorFromCommand('contrast')],
    [/^(default|normal) colou?rs?$/,                                                               () => setColorFromCommand('default')],
    [/^(make )?(the )?(captions|subtitles) (bigger|larger)$|^(bigger|larger) (captions|subtitles)$/, () => captionFromCommand(1)],
    [/^(make )?(the )?(captions|subtitles) smaller$|^smaller (captions|subtitles)$/,                 () => captionFromCommand(-1)],
    [/^(open )?display settings$/,                                                                 () => { openSettings(); return true; }],
  ],
};

function normalizeCommand(text) {
  if (YTAI_LANG === 'en') {
    return text.toLowerCase().replace(/[.,!?~]/g, ' ').replace(/\b(please|can you|could you|for me)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  let n = text.replace(/[\s.,!?~]/g, '').replace(/좀/g, '');
  // 끝말 떼기: "크게해줘요" → "크게", "읽어주세요" → "읽어"
  let prev;
  do {
    prev = n;
    n = n.replace(/(해주세요|해주실래요|해줄래|해주라|해줘요|해줘|해요|주세요|줄래|줘요|줘|해|요)$/, '');
  } while (n !== prev && n.length > 0);
  return n;
}

function handleLocalCommand(text) {
  const n = normalizeCommand(text);
  if (!n || n.length > 20) return false;
  for (const [re, run] of LOCAL_COMMANDS[YTAI_LANG]) {
    if (re.test(n)) {
      run();
      return true;
    }
  }
  return false;
}

function setTtsFromCommand(on) {
  if (on && !('speechSynthesis' in window)) { showToast(t('ttsUnsupported')); return; }
  setView('tts', on);
  showToast(t(on ? 'ttsOnSample' : 'ttsOffToast'));
}

function setColorFromCommand(color) {
  setView('color', color);
  showToast(t(color === 'contrast' ? 'colorContrastToast' : 'colorDefaultToast'));
}

function captionFromCommand(dir) {
  showToast(changeCaptionSize(dir) ? t(dir > 0 ? 'captionBiggerToast' : 'captionSmallerToast') : t('captionOffToast'));
}

// ─── Submit request ───────────────────────────────────────────────────────────

function submitRequest(userRequest) {
  if (handleLocalCommand(userRequest)) {
    // 입력창만 비우고 패널은 그대로 둔다 (바뀐 크기·색을 바로 볼 수 있게)
    document.getElementById('ytai-input').value = '';
    document.getElementById('ytai-voice-status').textContent = '';
    return;
  }
  document.getElementById('ytai-panel-body').classList.add('ytai-loading-mode');
  document.getElementById('ytai-loading').style.display = 'flex';

  const pageSnapshot = getPageSnapshot();
  console.log('[ytai-content] 요청 전송:', userRequest, '스냅샷:', pageSnapshot.length, '개 요소');

  const port = chrome.runtime.connect({ name: 'ytai-analyze' });
  let responded = false;

  const timeout = setTimeout(() => {
    if (!responded) {
      port.disconnect();
      resetPanel();
      showToast(t('timeoutError'));
    }
  }, 35000);

  port.onMessage.addListener((response) => {
    responded = true;
    clearTimeout(timeout);
    port.disconnect();
    if (response.type === 'ANALYSIS_RESULT') {
      hidePanel();
      showOverlay(response.result);
    } else if (response.type === 'ANALYSIS_ERROR') {
      resetPanel();
      showToast(response.error);
    }
  });

  port.onDisconnect.addListener(() => {
    clearTimeout(timeout);
    if (!responded) {
      resetPanel();
      showToast(t('connError'));
    }
  });

  port.postMessage({ type: 'ANALYZE_SCREEN', userRequest, pageSnapshot, lang: YTAI_LANG });
}

// ─── Page snapshot (DOM → Claude용 요소 목록) ──────────────────────────────────

function getPageSnapshot() {
  const seen = new Set();
  const items = [];

  const sels = [
    '.ytp-button[aria-label]',           // 플레이어 컨트롤
    'button[aria-label]',                // 일반 버튼
    'yt-button-shape button[aria-label]', // 새 YouTube 버튼 컴포넌트
    'a[title]',                          // 링크
    'ytd-guide-entry-renderer a',        // 사이드바 항목
    'ytd-mini-guide-entry-renderer a',  // 미니 사이드바
    'input[name="search_query"]',        // 검색창 (헤더)
    'yt-tab-shape',                      // 탭
    '[role="tab"][aria-label]',
    'yt-subscribe-button-view-model button',
    'ytd-subscribe-button-renderer button',
    'like-button-view-model button',
    'dislike-button-view-model button',
    'ytd-menu-renderer button[aria-label]', // 영상 하단 메뉴 버튼들
  ];

  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isOwnUi(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100) continue;
      const raw = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.textContent || ''
      ).trim();
      // "(k)", "(m)" 또는 "키보드 단축키 k" 같은 단축키 접미사 제거
      const t = raw
        .replace(/\s*키보드\s*단축키\s*\S+\s*$/, '')
        .replace(/\s*[\(（][a-zA-Z0-9\s]{1,3}[\)）]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);
      if (!t) continue;
      const cx = (rect.left + rect.width / 2) / window.innerWidth;
      const cy = (rect.top + rect.height / 2) / window.innerHeight;
      let area = AREA.main;
      if (cy > 0.82) area = AREA.player;
      else if (cx < 0.14) area = AREA.sidebar;
      else if (cy < 0.1) area = AREA.header;
      // 쇼츠의 좋아요/댓글/공유 버튼처럼 화면 오른쪽 끝에 세로로 붙은 요소들
      else if (cx > 0.86) area = AREA.right;
      items.push({ t, area, x: +cx.toFixed(2), y: +cy.toFixed(2) });
    }
  }

  // 같은 텍스트+영역 조합만 중복 제거 (같은 라벨이 플레이어/사이드바 등
  // 다른 영역에 따로 있으면 서로 다른 버튼이므로 둘 다 남겨야 한다)
  const seenKeys = new Set();
  const deduped = items.filter(e => {
    const k = e.t.toLowerCase() + '|' + e.area;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
  if (deduped.length > 60) {
    console.warn('[ytai] 화면 요소가 60개를 넘어 일부가 AI에게 전달되지 않음:', deduped.length, '개 중 60개만 전송');
  }
  return deduped.slice(0, 60);
}

// ─── Selectors ───────────────────────────────────────────────────────────────

const ELEMENT_SELECTORS = {
  play:          '.ytp-play-button',
  volume:        '.ytp-mute-button',
  subtitles:     '.ytp-subtitles-button',
  settings:      '.ytp-settings-button',
  fullscreen:    '.ytp-fullscreen-button',
  theater:       '.ytp-size-button',
  next_video:    '.ytp-next-button',
  miniplayer:    '.ytp-miniplayer-button',
  search:        'input[name="search_query"], input#search',
  like:          'button[aria-label*="좋아요 표시"], like-button-view-model button, ytd-toggle-button-renderer[is-icon-button] button[aria-label*="좋아요"]',
  dislike:       'button[aria-label*="싫어요 표시"], dislike-button-view-model button, ytd-toggle-button-renderer[is-icon-button] button[aria-label*="싫어요"]',
  subscribe:     'yt-subscribe-button-view-model button, ytd-subscribe-button-renderer button',
  playlists_tab: 'yt-tab-shape[tab-title="재생목록"], tp-yt-paper-tab[aria-label="재생목록"], [tab-identifier="재생목록"], yt-tab-shape[tab-title="Playlists"], tp-yt-paper-tab[aria-label="Playlists"], [tab-identifier="Playlists"]',
  save:          [
    'button[aria-label*="저장"]',
    'yt-button-shape button[aria-label*="저장"]',
    'ytd-button-renderer button[aria-label*="저장"]',
    'ytd-menu-service-item-renderer[aria-label*="저장"]',
    '.ytd-menu-renderer button[aria-label*="저장"]',
    'button[aria-label*="Save"]',
    'yt-button-shape button[aria-label*="Save"]',
  ].join(', '),
  share:         'button[aria-label*="공유"], yt-button-shape button[aria-label*="공유"], button[aria-label*="Share"], yt-button-shape button[aria-label*="Share"]',
  more_actions:  'button[aria-label*="더보기"], yt-button-shape button[aria-label*="더보기"], button[aria-label*="작업 더보기"], button[aria-label*="More actions"], yt-button-shape button[aria-label*="More actions"]',
  home:          'ytd-guide-entry-renderer a[href="/"], ytd-mini-guide-entry-renderer a[href="/"], a[href="/"][title]',
  subscriptions: 'ytd-guide-entry-renderer a[href="/feed/subscriptions"], ytd-mini-guide-entry-renderer a[href="/feed/subscriptions"]',
  library:       'ytd-guide-entry-renderer a[href="/feed/library"], ytd-mini-guide-entry-renderer a[href="/feed/library"]',
  history:       'ytd-guide-entry-renderer a[href="/feed/history"], ytd-mini-guide-entry-renderer a[href="/feed/history"]',
  shorts:        'ytd-guide-entry-renderer a[href="/shorts"], ytd-mini-guide-entry-renderer a[href="/shorts"]',
  // 데스크톱 쇼츠 화면 오른쪽의 위/아래 이동 버튼
  next_short:    '#navigation-button-down button, #navigation-button-down [role="button"]',
  prev_short:    '#navigation-button-up button, #navigation-button-up [role="button"]',
};

const TEXT_FALLBACKS = {
  library:       ['보관함', 'Library'],
  home:          ['홈', 'Home'],
  subscriptions: ['구독', 'Subscriptions'],
  history:       ['기록', 'History'],
  shorts:        ['Shorts'],
  search:        ['검색', 'Search'],
  like:          ['좋아요', 'Like'],
  subscribe:      ['구독', 'Subscribe'],
  playlists_tab:  ['재생목록', 'Playlists'],
  save:           ['저장', 'Save'],
  share:          ['공유', 'Share'],
};

// ─── Element finders ─────────────────────────────────────────────────────────

// YouTube 동의어 맵 (단축키 제거 후 원래 단어 → 검색어). 한/영 병기.
const SYNONYMS = {
  '볼륨': ['음소거', '음소거 해제', '볼륨', 'mute', 'unmute', 'volume'],
  '음소거': ['음소거', '음소거 해제', '볼륨', 'mute', 'unmute', 'volume'],
  '재생': ['재생', '일시중지', '일시정지', 'play', 'pause'],
  '일시정지': ['일시중지', '일시정지', '재생', 'pause', 'play'],
  '일시중지': ['일시중지', '일시정지', '재생', 'pause', 'play'],
  '자막': ['자막', 'subtitles', 'captions', 'cc'],
  '전체화면': ['전체 화면', '전체화면', 'fullscreen', 'full screen'],
  '전체 화면': ['전체 화면', '전체화면', 'fullscreen', 'full screen'],
  '저장': ['저장', '재생목록에 저장', 'save'],
  '공유': ['공유', 'share'],
  '좋아요': ['좋아요', '좋아요 표시', 'like'],
  '구독': ['구독', 'subscribe'],
  'volume': ['mute', 'unmute', 'volume', '볼륨', '음소거'],
  'mute': ['mute', 'unmute', 'volume', '볼륨', '음소거'],
  'unmute': ['mute', 'unmute', 'volume', '볼륨', '음소거'],
  'play': ['play', 'pause', '재생', '일시정지'],
  'pause': ['pause', 'play', '일시정지', '재생'],
  'subtitles': ['subtitles', 'captions', 'cc', '자막'],
  'captions': ['subtitles', 'captions', 'cc', '자막'],
  'fullscreen': ['fullscreen', 'full screen', '전체화면'],
  'save': ['save', 'save to playlist', '저장'],
  'share': ['share', '공유'],
  'like': ['like', '좋아요'],
  'subscribe': ['subscribe', '구독'],
};

function findElementByTextContent(text) {
  if (!text) return null;
  const norm = text.trim().toLowerCase();
  const candidates = document.querySelectorAll(
    'button, a, input, [role="button"], [role="tab"], yt-tab-shape'
  );

  // 검색할 키워드 목록 (동의어 포함)
  const keywords = [norm];
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    if (norm.includes(key) || key.includes(norm)) {
      keywords.push(...syns.map(s => s.toLowerCase()));
    }
  }

  for (const pass of [
    // 1단계: aria-label/title 정확 매치
    (el) => {
      const lbl = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase()
        .replace(/\s*키보드\s*단축키\s*\S+\s*$/, '')
        .replace(/\s*[\(（][a-zA-Z0-9\s]{1,3}[\)）]\s*$/, '').trim();
      return keywords.some(k => lbl === k);
    },
    // 2단계: 텍스트 정확 매치
    (el) => {
      const txt = el.textContent.trim().toLowerCase();
      return keywords.some(k => txt === k);
    },
    // 3단계: 포함 매치
    (el) => {
      const all = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
        .trim().toLowerCase()
        .replace(/\s*키보드\s*단축키\s*\S+\s*$/, '')
        .replace(/\s*[\(（][a-zA-Z0-9\s]{1,3}[\)）]\s*$/, '').trim();
      return keywords.some(k => k.length >= 2 && all.includes(k) && all.length < k.length * 5);
    },
  ]) {
    const el = pickOnScreen([...candidates].filter(pass));
    if (el) return el;
  }
  return null;
}

// ─── 화면 안의 요소 고르기 ───────────────────────────────────────────────────
// 쇼츠는 앞뒤 영상을 미리 불러와서 좋아요·구독 같은 버튼이 여러 벌 있고,
// 일반 영상 화면도 스크롤하면 버튼이 화면 밖으로 나간다. 크기만 보고 첫 번째를
// 고르면 화면 밖 버튼을 가리키게 되므로, 스냅샷(getPageSnapshot)과 같은 기준으로
// 지금 화면에 보이는 것을 우선한다.

// 도우미 자신이 그린 요소. 가+/가-·닫기 버튼처럼 aria-label이 붙어 있어서
// 걸러 내지 않으면 AI에게 "유튜브 버튼"으로 보내지고, 안내가 도우미 버튼을 가리키게 된다.
const OWN_UI = '#ytai-dock, #ytai-panel, #ytai-overlay, #ytai-instruction, #ytai-toast, #ytai-live';

function isOwnUi(el) {
  return !!el.closest(OWN_UI);
}

function isInViewport(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
}

function isShortsPage() {
  return location.pathname.startsWith('/shorts');
}

function pickOnScreen(elements) {
  const sized = elements.filter(el => {
    if (isOwnUi(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!sized.length) return null;

  let onScreen = sized.filter(isInViewport);
  // 쇼츠를 넘기는 도중에는 다음 쇼츠가 화면에 반쯤 걸쳐 있을 수 있다.
  // 지금 재생 중인 쇼츠 안에 후보가 있으면 그것만 쓴다.
  const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
  if (activeReel) {
    const inReel = onScreen.filter(el => activeReel.contains(el));
    if (inReel.length) onScreen = inReel;
  }
  if (onScreen.length) return onScreen[0];

  // 화면 안에 없으면 일반 화면에서는 화면 밖 요소라도 돌려준다(호출하는 쪽에서
  // 스크롤해서 보여 줌). 쇼츠에서는 화면 밖 요소가 다른 쇼츠의 버튼이므로 쓰지 않는다.
  return isShortsPage() ? null : sized[0];
}

function findTargetElement(elementType, elementText) {
  // 1. CSS 선택자 - 후보 중 화면에 보이는 것 우선
  if (elementType && ELEMENT_SELECTORS[elementType]) {
    const el = pickOnScreen([...document.querySelectorAll(ELEMENT_SELECTORS[elementType])]);
    if (el) return el;
  }
  // 2. element_text (AI가 스냅샷에서 골라준 정확한 텍스트)
  if (elementText) {
    const el = findElementByTextContent(elementText);
    if (el) return el;
  }
  // 3. 텍스트 폴백
  if (elementType && TEXT_FALLBACKS[elementType]) {
    return findByTextElement(TEXT_FALLBACKS[elementType]);
  }
  return null;
}

function getElementCenter(elementType, elementText) {
  const el = findTargetElement(elementType, elementText);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

// ─── Overlay (spotlight + instruction, 멀티스텝 + 실시간 추적) ───────────────

let _steps = [];
let _stepIndex = 0;
let _floatingBtn = null;
let _trackingElementType = null;
let _trackingElementText = null;
let _rafId = null;
let _targetEl = null;
let _targetClickFn = null;
let _autoClickTimer = null;
// 단계가 바뀌거나 안내가 끝나면 증가. 늦게 끝난 음성 읽기가 지난 단계의 자동 클릭을 시작하지 않게 한다.
let _guideToken = 0;

function startTracking(elementType, elementText) {
  _trackingElementType = elementType;
  _trackingElementText = elementText;

  // 오버레이 노드와 대상 요소는 한 번만 찾아 잡고 있는다.
  // 매 프레임 findTargetElement()를 부르면 유튜브 전체 DOM을 초당 60번 훑게 된다.
  const s = document.querySelector('.ytai-spotlight');
  const p = document.querySelector('.ytai-pulse');
  const a = document.querySelector('.ytai-arrow');
  const l = document.querySelector('.ytai-target-label');
  let el = findTargetElement(elementType, elementText);
  let miss = 0;

  function tick() {
    if (!_trackingElementType && !_trackingElementText) return;
    // 잡고 있던 요소가 DOM에서 빠지거나 숨겨졌을 때만 다시 찾는다 (유튜브 SPA 이동 대응)
    let rect = el?.isConnected ? el.getBoundingClientRect() : null;
    if (!rect || rect.width === 0 || rect.height === 0) {
      // 못 찾는 동안 매 프레임 전체 스캔하지 않도록 30프레임(약 0.5초)에 한 번만 재탐색
      rect = null;
      if (miss++ % 30 === 0) {
        el = findTargetElement(_trackingElementType, _trackingElementText);
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) rect = r;
      }
    } else {
      miss = 0;
    }
    if (rect) {
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      if (s) { s.style.left = x + 'px'; s.style.top = y + 'px'; }
      if (p) { p.style.left = x + 'px'; p.style.top = y + 'px'; }
      if (a) { a.style.left = x + 'px'; a.style.top = y + 'px'; }
      if (l) {
        l.style.left = labelLeft(x, l) + 'px';
        l.style.top = labelTop(y, l) + 'px';
      }
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

// 이름표 위치: 화면 아래쪽 버튼이면 화살표 위에, 아니면 불빛 아래에 둔다.
// 화살표는 대상 중심에서 64px 위(.ytai-arrow), 높이는 22px × 글씨 배율이라
// 이름표가 화살표를 덮지 않도록 이름표 실제 높이까지 계산한다.
function labelTop(y, labelEl) {
  if (y <= window.innerHeight * 0.75) return y + 60;
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ytai-scale')) || 1;
  const arrowTop = y - 64 - 11 * scale;
  return arrowTop - 6 - (labelEl?.offsetHeight || 30 * scale);
}

// 이름표 가로 위치: 대상 가운데에 두되, 화면 가장자리 버튼(유튜브 볼륨 버튼 등)이면
// 이름표가 화면 밖으로 잘리지 않게 안쪽으로 당긴다. (.ytai-target-label은 translateX(-50%))
function labelLeft(x, labelEl) {
  const half = (labelEl?.offsetWidth || 0) / 2;
  const margin = 8;
  return Math.min(Math.max(x, half + margin), window.innerWidth - half - margin);
}

function stopTracking() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  _trackingElementType = null;
  _trackingElementText = null;
}

function attachClickAdvance(elementType, elementText) {
  const el = findTargetElement(elementType, elementText);
  if (!el) return;

  _targetEl = el;
  _targetClickFn = () => {
    setTimeout(() => advanceStep(), 200);
  };
  _targetEl.addEventListener('click', _targetClickFn, { once: true, capture: true });
}

function findByTextElement(texts) {
  const all = [...document.querySelectorAll('a, button, span, yt-formatted-string, ytd-guide-entry-renderer')];
  for (const text of texts) {
    const el = pickOnScreen(all.filter(e => e.textContent.trim() === text));
    if (el) return el;
  }
  return null;
}

function detachClickAdvance() {
  if (_targetEl && _targetClickFn) {
    _targetEl.removeEventListener('click', _targetClickFn, { capture: true });
  }
  _targetEl = null;
  _targetClickFn = null;
}

function advanceStep() {
  const isLast = _stepIndex === _steps.length - 1;
  if (isLast) {
    _guideToken++;
    stopSpeaking();
    stopTracking();
    detachClickAdvance();
    removeOverlay();
    if (_floatingBtn) _floatingBtn.style.display = '';
    resetPanel();
  } else {
    _stepIndex++;
    showStep(_stepIndex);
  }
}


// ─── 자동 클릭 안전 장치 ─────────────────────────────────────────────────────
// 자동 클릭은 되돌리기 쉬운 버튼 종류만 허용한다. "위험한 것 막기"(단어 블랙리스트)는
// 빠지는 게 생기고 "음소거 해제" 같은 멀쩡한 버튼까지 걸리므로 허용 목록 방식을 쓴다.
// 구독(누르면 구독 취소가 될 수 있음)·싫어요, 그리고 종류 없이 이름만 있는 단계는
// 사용자가 직접 눌러야 한다. 볼륨 버튼은 누르면 음소거가 되므로 빠진다 —
// "소리 키워 줘"에 자동 클릭하면 오히려 소리가 꺼진다.
const AUTO_CLICK_SAFE_TYPES = new Set([
  'play', 'subtitles', 'settings', 'fullscreen', 'theater', 'next_video',
  'miniplayer', 'search', 'like', 'save', 'share', 'more_actions', 'home',
  'subscriptions', 'library', 'history', 'shorts', 'playlists_tab',
  'next_short', 'prev_short',
]);
// 허용된 종류여도 선택자/이름 매칭이 엉뚱한 버튼을 잡았을 때를 대비한 2차 방어선
const RISKY_LABEL = /구독\s*취소|삭제|제거|신고|차단|로그아웃|unsubscribe|delete|remove|report|block|sign out/i;

function canAutoClick(elementType, elementText) {
  if (!AUTO_CLICK_SAFE_TYPES.has(elementType)) return false;
  const el = findTargetElement(elementType, elementText);
  if (!el) return false;
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
  return !RISKY_LABEL.test(label);
}

function cancelAutoClick() {
  if (_autoClickTimer) { clearInterval(_autoClickTimer); _autoClickTimer = null; }
}

function startAutoClickCountdown(elementType, elementText) {
  let secs = _view.autoClick;
  const updateBtn = () => {
    const btn = document.getElementById('ytai-instr-ok');
    if (btn) btn.textContent = t('autoClickCountdown').replace('{n}', secs);
  };
  updateBtn();
  _autoClickTimer = setInterval(() => {
    secs--;
    if (secs > 0) {
      updateBtn();
    } else {
      clearInterval(_autoClickTimer);
      _autoClickTimer = null;
      // 카운트다운 사이에 화면이 바뀌었을 수 있으니 누르기 직전에 한 번 더 확인
      if (!canAutoClick(elementType, elementText)) {
        const btn = document.getElementById('ytai-instr-ok');
        if (btn) btn.textContent = t('skipBtn');
        attachClickAdvance(elementType, elementText);
        return;
      }
      findTargetElement(elementType, elementText).click();
      setTimeout(() => advanceStep(), 300);
    }
  }, 1000);
}

// ─── 쇼츠 전용 빠른 버튼 ─────────────────────────────────────────────────────
// 쇼츠에는 "다음 영상" 버튼이 없고, 데스크톱 쇼츠에는 전체화면 버튼도 없다.
// 쇼츠 화면에서는 이 두 칸을 "이전 쇼츠 / 다음 쇼츠"로 바꾸고, 가리키는 대신 도우미가 직접 넘긴다.

const QUICK_SLOTS = {
  normal: {
    a: { type: 'fullscreen', label: 'quickFullscreen', icon: '<polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>' },
    b: { type: 'next_video', label: 'quickNext', icon: '<polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19"/>' },
  },
  shorts: {
    a: { type: 'prev_short', label: 'quickPrevShort', icon: '<polyline points="18,15 12,9 6,15"/>' },
    b: { type: 'next_short', label: 'quickNextShort', icon: '<polyline points="6,9 12,15 18,9"/>' },
  },
};

function updateQuickGridForPage() {
  const mode = isShortsPage() ? 'shorts' : 'normal';
  const grid = document.querySelector('#ytai-panel .ytai-quick-grid');
  if (!grid || grid.dataset.mode === mode) return;
  grid.dataset.mode = mode;
  for (const [slot, def] of Object.entries(QUICK_SLOTS[mode])) {
    const btn = grid.querySelector(`[data-slot="${slot}"]`);
    if (!btn) continue;
    btn.dataset.type = def.type;
    btn.dataset.label = t(def.label);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.icon}</svg><span>${t(def.label)}</span>`;
  }
}

// 다음/이전 쇼츠로 넘기기. 1) 유튜브의 위/아래 이동 버튼 2) 없으면 옆 쇼츠로 스크롤
function goShorts(dir) {
  const btn = pickOnScreen([...document.querySelectorAll(ELEMENT_SELECTORS[dir > 0 ? 'next_short' : 'prev_short'])]);
  if (btn) {
    btn.click();
  } else {
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    let sib = active && (dir > 0 ? active.nextElementSibling : active.previousElementSibling);
    while (sib && sib.tagName !== 'YTD-REEL-VIDEO-RENDERER') sib = dir > 0 ? sib.nextElementSibling : sib.previousElementSibling;
    if (!sib) {
      showToast(t(dir > 0 ? 'noNextShortToast' : 'noPrevShortToast'));
      return false;
    }
    sib.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  showToast(t(dir > 0 ? 'nextShortToast' : 'prevShortToast'));
  return true;
}

function quickAction(elementType, label) {
  hidePanel();

  if (elementType === 'next_short' || elementType === 'prev_short') {
    goShorts(elementType === 'next_short' ? 1 : -1);
    return;
  }

  // 볼륨 버튼은 누르면 음소거/해제만 된다. 소리 크기는 버튼 위에 마우스를 올리면
  // 나오는 막대를 끌어서 바꾸므로, 막대 → 음소거 순서로 안내한다.
  if (elementType === 'volume' && getElementCenter('volume', null)) {
    showOverlay({
      steps: [
        { instruction: t('volumeStepSlider'), element_type: 'volume', element_text: null, target_label: t('volumeSliderLabel'), point_only: true },
        { instruction: t('volumeStepMute'), element_type: 'volume', element_text: null, target_label: t('muteLabel'), point_only: true },
      ]
    });
    return;
  }

  // 홈·구독·보관함·검색은 버튼이 안 보일 때 직접 이동
  const NAV_URLS = {
    home:          'https://www.youtube.com/',
    subscriptions: 'https://www.youtube.com/feed/subscriptions',
    library:       'https://www.youtube.com/feed/library',
    history:       'https://www.youtube.com/feed/history',
    shorts:        'https://www.youtube.com/shorts',
  };

  const pos = getElementCenter(elementType, null);
  if (!pos) {
    if (NAV_URLS[elementType]) {
      window.location.href = NAV_URLS[elementType];
      return;
    }
    if (elementType === 'search') {
      const input = document.querySelector('input#search');
      if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }
    showToast(t('notFoundToast').replace('{label}', label));
    return;
  }
  showOverlay({
    steps: [{
      instruction: t('quickActionInstruction').replace('{label}', label),
      element_type: elementType,
      element_text: null,
      target_label: label,
    }]
  });
}

function showOverlay(result) {
  if (!result?.steps?.length) {
    showToast(t('responseFormatError'));
    resetPanel();
    return;
  }
  _steps = result.steps;
  _stepIndex = 0;
  _floatingBtn = document.getElementById('ytai-dock');
  if (_floatingBtn) _floatingBtn.style.display = 'none';
  showStep(_stepIndex);
}

function showStep(index) {
  cancelAutoClick();
  stopTracking();
  detachClickAdvance();
  removeOverlay();

  const step = _steps[index];
  if (!step) return;

  const isLast = index === _steps.length - 1;
  const total = _steps.length;
  const eType = step.element_type ?? null;
  const eText = step.element_text ?? null;
  const hasTarget = !!(eType || eText);
  // 위치만 보여 주는 단계 (볼륨 막대처럼 마우스를 올리거나 끌어야 하는 조작).
  // 대상을 누르면 다른 동작(음소거)이 되므로 눌러도 다음 단계로 넘기지 않고, 자동 클릭도 하지 않는다.
  const pointOnly = step.point_only === true;
  let targetY = null;
  const autoClickHere = !pointOnly && _view.autoClick > 0 && hasTarget && canAutoClick(eType, eText);

  if (hasTarget) {
    // 일반 영상 화면에서 스크롤로 버튼이 화면 밖에 있으면 보이는 곳으로 가져온다
    const targetEl = findTargetElement(eType, eText);
    if (targetEl && !isInViewport(targetEl)) {
      targetEl.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    const pos = getElementCenter(eType, eText);
    const initX = pos?.x ?? -999;
    const initY = pos?.y ?? -999;
    targetY = pos?.y ?? null;
    const overlay = document.createElement('div');
    overlay.id = 'ytai-overlay';
    overlay.innerHTML = `
      <div class="ytai-spotlight" style="left:${initX}px;top:${initY}px"></div>
      <div class="ytai-pulse" style="left:${initX}px;top:${initY}px"></div>
      <div class="ytai-arrow" style="left:${initX}px;top:${initY}px"></div>
    `;
    let label = null;
    if (step.target_label) {
      label = document.createElement('div');
      label.className = 'ytai-target-label';
      label.style.left = initX + 'px';
      label.textContent = step.target_label;
      overlay.appendChild(label);
    }
    document.body.appendChild(overlay);
    // 높이를 알아야 위치를 정할 수 있어서 화면에 붙인 뒤에 계산
    if (label) {
      label.style.top = labelTop(initY, label) + 'px';
      label.style.left = labelLeft(initX, label) + 'px';
    }
    startTracking(eType, eText);
    // 자동 클릭 모드면 카운트다운 후 자동 클릭, 아니면 사용자가 누를 때 다음 단계로
    if (!autoClickHere && !pointOnly && !isLast) {
      attachClickAdvance(eType, eText);
    }
  }

  const box = document.createElement('div');
  box.id = 'ytai-instruction';
  // 가리킨 버튼이 화면 아래쪽(유튜브 재생바 등)이면 안내문이 덮지 않도록 위로 올린다.
  // 글씨를 크게 하면 안내문 상자도 커져서 더 자주 겹친다.
  if (targetY !== null && targetY > window.innerHeight * 0.55) box.classList.add('ytai-instr-top');
  const stepIndicator = total > 1
    ? `<div class="ytai-step-indicator">${index + 1} / ${total}</div>`
    : '';

  const btnLabel = isLast ? t('confirmBtn') : (autoClickHere ? t('autoClickCountdown').replace('{n}', _view.autoClick) : (hasTarget && !pointOnly ? t('skipBtn') : t('nextBtn')));
  // 자동 클릭을 켰지만 이 버튼은 안전 목록 밖이라 직접 눌러야 하는 경우
  const manualNote = _view.autoClick > 0 && hasTarget && !autoClickHere && !pointOnly
    ? `<div class="ytai-instr-note">${t('autoClickManualNote')}</div>`
    : '';

  box.innerHTML = `
    ${stepIndicator}
    <div class="ytai-instr-text">${escapeHtml(step.instruction ?? t('fallbackInstruction'))}</div>
    ${manualNote}
    <button id="ytai-instr-ok" type="button">${btnLabel}</button>
  `;
  document.body.appendChild(box);
  const instruction = step.instruction ?? t('fallbackInstruction');
  announce(instruction);
  const token = ++_guideToken;
  const spoken = speak(instruction);

  document.getElementById('ytai-instr-ok').addEventListener('click', () => {
    cancelAutoClick();
    advanceStep();
  });

  if (autoClickHere) {
    // 소리로 읽기가 켜져 있으면 다 읽은 뒤에 카운트다운을 시작한다
    if (_view.tts) {
      spoken.then(() => { if (token === _guideToken) startAutoClickCountdown(eType, eText); });
    } else {
      startAutoClickCountdown(eType, eText);
    }
  }
}

function removeOverlay() {
  document.querySelectorAll('#ytai-overlay, #ytai-instruction').forEach(el => el.remove());
}

// ─── Error toast ──────────────────────────────────────────────────────────────

function showToast(message) {
  document.getElementById('ytai-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'ytai-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  announce(message);
  speak(message);

  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
