/* ===== 装到桌面 / 主屏幕 ===== */
(function () {
  const KEY = 'mls_install';
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|FxiOS|CriOS/.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null, armed = false;

  const $ = id => document.getElementById(id);
  const show = on => $('instMask').classList.toggle('on', on);

  function armOffer() {
    if (armed || standalone) return;
    const st = localStorage.getItem(KEY);
    if (st === 'installed' || st === 'dismissed') return;
    armed = true;
    // 等玩进去了再排队，别一进来就弹
    const t = setInterval(() => {
      const started = !$('startMask').classList.contains('on') && document.querySelector('.act-btn');
      if (started) { clearInterval(t); setTimeout(() => openInstall(true), 45000); }
    }, 2000);
  }

  function openInstall(auto) {
    if (auto && (standalone || localStorage.getItem(KEY) === 'installed')) return;
    const body = $('instBody');
    if (deferred) {
      body.innerHTML = `<div class="hint">装到桌面之后，它就像个单独的应用：全屏、没有地址栏，断网也能接着玩。存档还是存在这台设备上。</div>`;
      $('instGo').style.display = '';
      $('instGo').textContent = '装上';
    } else if (isIOS) {
      body.innerHTML = `<div class="hint">iPhone 上要手动加一下：<br>1　点底部工具栏中间的<b>分享</b>按钮<br>2　往下翻，找到<b>「添加到主屏幕」</b><br>3　右上角<b>添加</b><br><br>装完从主屏幕点进来就是全屏的，断网也能玩。</div>`;
      $('instGo').style.display = 'none';
    } else if (isSafari) {
      body.innerHTML = `<div class="hint">Mac 上的 Safari：菜单栏 <b>文件</b> → <b>添加到程序坞</b>。<br>装完从程序坞点进来就是一个单独的窗口。</div>`;
      $('instGo').style.display = 'none';
    } else {
      body.innerHTML = `<div class="hint">你这个浏览器没给出安装入口。地址栏右侧如果有安装图标可以点一下；没有的话，存个书签也一样能玩。</div>`;
      $('instGo').style.display = 'none';
    }
    show(true);
  }

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; armOffer(); });
  addEventListener('appinstalled', () => { localStorage.setItem(KEY, 'installed'); show(false); });
  if (isSafari || isIOS) addEventListener('load', armOffer);

  addEventListener('DOMContentLoaded', () => {
    $('instGo').onclick = async () => {
      if (!deferred) return;
      show(false);
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      localStorage.setItem(KEY, outcome === 'accepted' ? 'installed' : 'dismissed');
    };
    $('instLater').onclick = () => { localStorage.setItem(KEY, 'dismissed'); show(false); };
    $('instOpen').onclick = () => openInstall(false);
  });
  window.openInstall = openInstall;

  /* service worker：断网也能玩 */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              const bar = $('newver');
              bar.classList.add('on');
              $('newverGo').onclick = () => { reg.waiting && reg.waiting.postMessage('skipWaiting'); };
              $('newverNo').onclick = () => bar.classList.remove('on');
            }
          });
        });
      }).catch(() => { });
      // 头一回装上 sw 时它会 claim，这时候不该刷新；只有真的换了新版本才刷
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
    });
  }
})();
