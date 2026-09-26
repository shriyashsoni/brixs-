/**
 * AegisWallet: shared wallet connection for the landing page and the console.
 *
 * - Discovers every installed wallet via EIP-6963, so multiple extensions
 *   fighting over window.ethereum no longer break the connect button.
 * - Falls back to window.ethereum for older wallets.
 * - Switches to (or adds) Sepolia, remembers the connection, and supports disconnect.
 */
(function () {
  'use strict';

  var SEPOLIA = {
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  };
  var STORE_KEY = 'aegis.wallet';

  var discovered = [];
  var state = { address: null, chainId: null, walletName: null, provider: null, rdns: null };
  var subscribers = [];
  var boundProvider = null;

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e.detail;
    if (!d || !d.info || !d.provider) return;
    if (discovered.some(function (p) { return p.info.uuid === d.info.uuid; })) return;
    discovered.push(d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function listWallets() {
    if (discovered.length) return discovered.slice();
    if (window.ethereum) {
      var eth = window.ethereum;
      var name = eth.isMetaMask ? 'MetaMask' : eth.isCoinbaseWallet ? 'Coinbase Wallet' : eth.isBraveWallet ? 'Brave Wallet' : 'Browser wallet';
      return [{ info: { uuid: 'injected', name: name, icon: '', rdns: 'injected' }, provider: eth }];
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  function emit() {
    var snapshot = get();
    subscribers.forEach(function (fn) { try { fn(snapshot); } catch (e) { console.error(e); } });
  }

  function get() {
    return {
      address: state.address,
      chainId: state.chainId,
      walletName: state.walletName,
      connected: !!state.address,
      onSepolia: state.chainId === SEPOLIA.chainId,
    };
  }

  function save() {
    if (state.address) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ rdns: state.rdns, address: state.address }));
    } else {
      localStorage.removeItem(STORE_KEY);
    }
  }

  function bind(provider) {
    if (boundProvider === provider || !provider.on) return;
    if (boundProvider && boundProvider.removeListener) {
      boundProvider.removeListener('accountsChanged', onAccounts);
      boundProvider.removeListener('chainChanged', onChain);
    }
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    boundProvider = provider;
  }

  function onAccounts(accounts) {
    state.address = accounts && accounts[0] ? accounts[0] : null;
    if (!state.address) state.provider = null;
    save();
    emit();
  }

  function onChain(chainId) {
    state.chainId = String(chainId).toLowerCase();
    emit();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function friendlyError(err) {
    var code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
    if (code === 4001) return 'You rejected the request in your wallet.';
    if (code === -32002) return 'A request is already waiting in your wallet. Open the wallet extension to approve it.';
    if (code === 4100) return 'Your wallet is locked. Unlock it and try again.';
    return (err && err.message) || 'Wallet request failed.';
  }

  function connectWith(entry) {
    var p = entry.provider;
    return p.request({ method: 'eth_requestAccounts' }).then(function (accounts) {
      if (!accounts || !accounts[0]) throw new Error('The wallet returned no account.');
      state.address = accounts[0];
      state.provider = p;
      state.walletName = entry.info.name;
      state.rdns = entry.info.rdns;
      bind(p);
      return p.request({ method: 'eth_chainId' });
    }).then(function (chainId) {
      state.chainId = String(chainId).toLowerCase();
      save();
      emit();
      // Ask for Sepolia, but a refusal shouldn't undo the connection
      return ensureSepolia().catch(function () {}).then(get);
    }, function (err) {
      throw new Error(friendlyError(err));
    });
  }

  function ensureSepolia() {
    var p = state.provider;
    if (!p) return Promise.reject(new Error('Connect a wallet first.'));
    if (state.chainId === SEPOLIA.chainId) return Promise.resolve();
    return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA.chainId }] })
      .catch(function (err) {
        if (err && (err.code === 4902 || /unrecognized chain/i.test(err.message || ''))) {
          return p.request({ method: 'wallet_addEthereumChain', params: [SEPOLIA] });
        }
        throw new Error(friendlyError(err));
      })
      .then(function () { return p.request({ method: 'eth_chainId' }); })
      .then(function (chainId) { state.chainId = String(chainId).toLowerCase(); emit(); });
  }

  function disconnect() {
    var p = state.provider;
    // MetaMask supports revoking; other wallets just forget locally
    if (p) p.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(function () {});
    state.address = null;
    state.chainId = null;
    state.provider = null;
    state.walletName = null;
    state.rdns = null;
    save();
    emit();
  }

  /** Silently restore a previous connection (no popup) */
  function restore() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return Promise.resolve(get());

    // Give EIP-6963 wallets a moment to announce themselves
    return new Promise(function (resolve) { setTimeout(resolve, 250); }).then(function () {
      var wallets = listWallets();
      var entry = wallets.filter(function (w) { return w.info.rdns === saved.rdns; })[0] || wallets[0];
      if (!entry) return get();
      return entry.provider.request({ method: 'eth_accounts' }).then(function (accounts) {
        if (!accounts || !accounts[0]) { save(); return get(); }
        state.address = accounts[0];
        state.provider = entry.provider;
        state.walletName = entry.info.name;
        state.rdns = entry.info.rdns;
        bind(entry.provider);
        return entry.provider.request({ method: 'eth_chainId' }).then(function (chainId) {
          state.chainId = String(chainId).toLowerCase();
          save();
          emit();
          return get();
        });
      }).catch(function () { return get(); });
    });
  }

  // ---------------------------------------------------------------------------
  // UI: wallet picker + account sheet (self-contained styles, works on any page)
  // ---------------------------------------------------------------------------
  var CSS = '' +
    '.aw-modal{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;font-family:"Inter",system-ui,sans-serif}' +
    '.aw-scrim{position:absolute;inset:0;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);animation:aw-fade .25s ease both}' +
    '.aw-card{position:relative;width:min(420px,100%);padding:26px 24px 22px;border-radius:16px;color:#fff;border:1px solid rgba(255,255,255,.14);background:linear-gradient(165deg,#151515,#070707 60%,#0b0d12);box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08);animation:aw-pop .4s cubic-bezier(.16,1,.3,1) both}' +
    '.aw-card h2{font-size:19px;font-weight:500;letter-spacing:-.03em;margin:0 0 6px}' +
    '.aw-card p{color:#9a9a9a;font-size:13.5px;line-height:1.55;margin:0 0 18px}' +
    '.aw-list{display:grid;gap:8px}' +
    '.aw-opt{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:10px;cursor:pointer;color:#fff;font:inherit;font-size:14px;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);transition:border-color .2s,background .2s}' +
    '.aw-opt:hover{border-color:rgba(220,230,255,.6);background:rgba(255,255,255,.06)}' +
    '.aw-opt img,.aw-opt .aw-ph{width:28px;height:28px;border-radius:7px;flex:none;background:#2a2a2a;display:grid;place-items:center;font-size:13px}' +
    '.aw-opt small{display:block;color:#7d7d7d;font-size:11.5px;margin-top:2px}' +
    '.aw-opt[disabled]{opacity:.6;cursor:progress}' +
    '.aw-btn{display:inline-flex;align-items:center;justify-content:center;height:42px;width:100%;border-radius:8px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none}' +
    '.aw-solid{background:linear-gradient(180deg,#fff,#e7e7e7 48%,#cfcfcf);color:#111;border:1px solid #fff}' +
    '.aw-ghost{background:rgba(255,255,255,.04);color:#fff;border:1px solid rgba(198,198,198,.45)}' +
    '.aw-actions{display:grid;gap:8px;margin-top:14px}' +
    '.aw-err{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12.5px;line-height:1.5;color:#ffd0d0;border:1px solid rgba(255,122,122,.35);background:rgba(255,122,122,.06)}' +
    '.aw-addr{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);overflow-wrap:anywhere;margin-bottom:10px}' +
    '.aw-net{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;margin-bottom:6px}' +
    '.aw-net i{width:7px;height:7px;border-radius:50%;background:#7ee2a8;box-shadow:0 0 8px #7ee2a8}' +
    '.aw-net.is-wrong i{background:#f2c46b;box-shadow:0 0 8px #f2c46b}' +
    '.aw-x{position:absolute;top:10px;right:12px;width:30px;height:30px;border:0;background:transparent;color:#9a9a9a;font-size:22px;cursor:pointer;border-radius:6px}' +
    '.aw-x:hover{color:#fff;background:rgba(255,255,255,.06)}' +
    '@keyframes aw-fade{from{opacity:0}to{opacity:1}}' +
    '@keyframes aw-pop{0%{opacity:0;transform:scale(.92)}70%{opacity:1;transform:scale(1.02)}100%{transform:scale(1)}}';

  function injectCss() {
    if (document.getElementById('aw-css')) return;
    var s = document.createElement('style');
    s.id = 'aw-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function openModal(html) {
    injectCss();
    var wrap = document.createElement('div');
    wrap.className = 'aw-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="aw-scrim" data-aw-close></div><div class="aw-card">' + html +
      '<button class="aw-x" type="button" data-aw-close aria-label="Close">×</button></div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.querySelectorAll('[data-aw-close]').forEach(function (el) { el.addEventListener('click', close); });
    return { el: wrap, close: close };
  }

  /**
   * Show the wallet picker. Resolves with the wallet snapshot, 'demo' if the user
   * picked demo mode, or null if they closed it.
   */
  function openPicker(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      // Re-ask so wallets that loaded late still show up
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(function () {
        var wallets = listWallets();
        var body;
        if (wallets.length) {
          body = '<h2>Connect a wallet</h2><p>Pick the wallet you want to use. AegisNet runs on the Sepolia test network, so no real funds are involved.</p>' +
            '<div class="aw-list">' + wallets.map(function (w, i) {
              var icon = w.info.icon ? '<img src="' + esc(w.info.icon) + '" alt="">' : '<span class="aw-ph">◆</span>';
              return '<button class="aw-opt" type="button" data-i="' + i + '">' + icon +
                '<span>' + esc(w.info.name) + '<small>' + (w.info.rdns === 'injected' ? 'Detected in this browser' : esc(w.info.rdns)) + '</small></span></button>';
            }).join('') + '</div>';
        } else {
          body = '<h2>No wallet found</h2><p>Install a browser wallet such as MetaMask, then reload this page. You can also explore everything in demo mode, with no wallet and no gas.</p>' +
            '<div class="aw-actions"><a class="aw-btn aw-solid" href="https://metamask.io/download/" target="_blank" rel="noopener">Install MetaMask</a></div>';
        }
        if (opts.allowDemo !== false) {
          body += '<div class="aw-actions"><button class="aw-btn aw-ghost" type="button" data-demo>Continue in demo mode (no wallet)</button></div>';
        }
        body += '<div class="aw-err" hidden></div>';

        var m = openModal(body);
        var settled = false;
        var finish = function (v) { if (settled) return; settled = true; m.close(); resolve(v); };
        m.el.querySelectorAll('[data-aw-close]').forEach(function (el) { el.addEventListener('click', function () { finish(null); }); });

        var demoBtn = m.el.querySelector('[data-demo]');
        if (demoBtn) demoBtn.addEventListener('click', function () { finish('demo'); });

        m.el.querySelectorAll('.aw-opt').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var entry = wallets[Number(btn.dataset.i)];
            var err = m.el.querySelector('.aw-err');
            err.hidden = true;
            m.el.querySelectorAll('.aw-opt').forEach(function (b) { b.disabled = true; });
            btn.querySelector('small').textContent = 'Check your wallet to approve…';
            connectWith(entry).then(function (snap) { finish(snap); }, function (e) {
              err.textContent = e.message;
              err.hidden = false;
              m.el.querySelectorAll('.aw-opt').forEach(function (b) { b.disabled = false; });
              btn.querySelector('small').textContent = 'Try again';
            });
          });
        });
      }, 120);
    });
  }

  /** Account sheet for a connected wallet: network, switch, copy, disconnect */
  function openAccount() {
    var s = get();
    if (!s.connected) return openPicker();
    var m = openModal(
      '<h2>Your wallet</h2>' +
      '<span class="aw-net' + (s.onSepolia ? '' : ' is-wrong') + '"><i></i>' + (s.onSepolia ? 'Sepolia test network' : 'Wrong network (' + esc(s.chainId) + ')') + '</span>' +
      '<div class="aw-addr">' + esc(s.address) + '</div>' +
      '<p>Connected with ' + esc(s.walletName || 'your wallet') + '.</p>' +
      '<div class="aw-actions">' +
        (s.onSepolia ? '' : '<button class="aw-btn aw-solid" type="button" data-switch>Switch to Sepolia</button>') +
        '<button class="aw-btn aw-ghost" type="button" data-copy-addr>Copy address</button>' +
        '<button class="aw-btn aw-ghost" type="button" data-disconnect>Disconnect</button>' +
      '</div><div class="aw-err" hidden></div>'
    );
    var err = m.el.querySelector('.aw-err');
    var sw = m.el.querySelector('[data-switch]');
    if (sw) sw.addEventListener('click', function () {
      ensureSepolia().then(m.close, function (e) { err.textContent = e.message; err.hidden = false; });
    });
    m.el.querySelector('[data-copy-addr]').addEventListener('click', function (e) {
      if (navigator.clipboard) navigator.clipboard.writeText(s.address);
      e.currentTarget.textContent = 'Copied';
    });
    m.el.querySelector('[data-disconnect]').addEventListener('click', function () { disconnect(); m.close(); });
    return Promise.resolve(get());
  }

  window.AegisWallet = {
    SEPOLIA_CHAIN_ID: SEPOLIA.chainId,
    get: get,
    /** Raw EIP-1193 provider of the connected wallet (for ethers.BrowserProvider) */
    provider: function () { return state.provider; },
    restore: restore,
    openPicker: openPicker,
    openAccount: openAccount,
    ensureSepolia: ensureSepolia,
    disconnect: disconnect,
    onChange: function (fn) { subscribers.push(fn); },
    short: function (a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; },
  };
})();
