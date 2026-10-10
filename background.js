const WORKER_URL = 'https://youtubehelper.banshk.workers.dev';



// ANALYZE_SCREEN: 포트 기반 통신 (MV3 service worker 유휴 종료로 인한 메시지 유실 방지)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ytai-analyze') return;

  port.onMessage.addListener(async (message) => {
    if (message.type !== 'ANALYZE_SCREEN') return;

    console.log('[ytai] 요청 수신:', message.userRequest, '스냅샷:', (message.pageSnapshot ?? []).length, '개');

    try {
      const result = await analyze(message.userRequest, message.pageSnapshot ?? [], message.lang, port.sender.tab);
      console.log('[ytai] 완료:', result);
      port.postMessage({ type: 'ANALYSIS_RESULT', result });
    } catch (e) {
      console.error('[ytai] 실패:', e.message);
      port.postMessage({ type: 'ANALYSIS_ERROR', error: e.message });
    }
  });
});

async function analyze(userRequest, snapshot, lang, tab) {
  if (!tab) throw new Error(chrome.i18n.getMessage('noTabError'));

  const url = tab.url ?? '';
  let pageType = 'main';
  if (url.includes('/watch')) pageType = 'video';
  else if (url.includes('/shorts')) pageType = 'shorts';
  else if (url.includes('/@') || url.includes('/channel/') || url.includes('/c/')) pageType = 'channel';
  else if (url.includes('/feed/library')) pageType = 'library';
  else if (url.includes('/results')) pageType = 'search';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const result = await callClaude(userRequest, pageType, snapshot, lang, controller.signal);
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(chrome.i18n.getMessage('timeoutError'));
    throw e;
  }
}

// 프롬프트·모델·토큰 한도는 Worker(worker/src/index.js)에 있다.
// 여기서 보내면 클라이언트가 조작할 수 있어서 프록시가 공개 API가 되어버린다.
async function callClaude(userRequest, pageType, snapshot, lang, signal) {
  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-YTAI-Lang': lang },
    signal,
    body: JSON.stringify({ userRequest, pageType, snapshot, lang })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `${chrome.i18n.getMessage('serverErrorPrefix')} (${response.status})`);
  if (!data?.steps?.length) throw new Error(chrome.i18n.getMessage('noStepsError'));

  console.log('[ytai] 단계:', data.steps.length, '개');
  return { steps: data.steps };
}



// ─── 단축키 (manifest commands) ──────────────────────────────────────────────
// 단축키는 서비스 워커로 들어오므로 지금 보고 있는 탭의 content script로 전달한다.
// 유튜브가 아닌 탭에서는 받을 곳이 없어서 실패하는데, 그냥 무시하면 된다.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'YTAI_COMMAND', command }).catch(() => {});
});

// content script는 chrome.commands를 못 쓰므로, 버튼 툴팁에 보여 줄 실제 단축키를 대신 알려 준다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'GET_SHORTCUTS') return;
  chrome.commands.getAll().then((cmds) => {
    sendResponse(Object.fromEntries(cmds.filter(c => c.shortcut).map(c => [c.name, c.shortcut])));
  });
  return true; // 비동기 응답
});
