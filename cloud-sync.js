/* Replay Lab cloud sync (Supabase REST + Auth). No external dependencies. */
(() => {
  'use strict';
  const API = 'https://yryqubtxxmneqfiiygys.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_yg4ZQyxRTn72_VQcyQeABA_phQb-kYR';
  const AUTH_STORE = 'replaylab-supabase-auth-v1';
  const app = window.ReplayLabDebug;
  if (!app) return;
  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $('cloudStatus'), account: $('cloudAccount'),
    toggle: $('cloudToggle'), box: $('cloudLoginBox'),
    email: $('cloudEmail'), password: $('cloudPassword'),
    login: $('cloudLogin'), register: $('cloudRegister'),
    save: $('cloudSave'), reload: $('cloudReload'), logout: $('cloudLogout')
  };
  let session = null;
  let activeKey = null;
  let ready = false;
  let applying = false;
  let fetching = false;
  let saving = false;
  let saveTimer = null;
  let savedJson = null;
  let remoteUpdatedAt = null;
  let cachedBars = null;
  let cachedKey = null;
  let refreshPromise = null;

  function status(msg, kind) {
    ui.status.textContent = msg;
    ui.status.dataset.kind = kind || 'neutral';
  }
  function updateUI() {
    const loggedIn = !!(session && session.user && session.user.id);
    ui.account.textContent = loggedIn ? session.user.email || 'ログイン中' : '未ログイン';
    ui.toggle.hidden = loggedIn;
    ui.logout.hidden = !loggedIn;
    ui.save.hidden = !loggedIn;
    ui.reload.hidden = !loggedIn;
    if (loggedIn) ui.box.hidden = true;
  }
  function authSave(obj) {
    session = obj;
    try {
      if (obj) localStorage.setItem(AUTH_STORE, JSON.stringify(obj));
      else localStorage.removeItem(AUTH_STORE);
    } catch (_) {}
    updateUI();
  }
  async function request(url, opts) {
    const res = await fetch(url, opts);
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const message = data && (data.msg || data.message || data.error_description || data.error);
      throw new Error(message || ('通信エラー HTTP ' + res.status));
    }
    return data;
  }
  async function authRequest(path, body, token) {
    const headers = {'apikey': PUBLISHABLE_KEY, 'Content-Type': 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    return request(API + '/auth/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
  }
  function rememberToken(data) {
    const old = session || {};
    const user = data.user || old.user || null;
    if (!data.access_token || !data.refresh_token) throw new Error('認証トークンを取得できません');
    authSave({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      user
    });
  }
  async function getToken() {
    if (!session) throw new Error('ログインしてください');
    if (session.expires_at > Date.now() + 90000) return session.access_token;
    if (!session.refresh_token) throw new Error('もう一度ログインしてください');
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshed = await authRequest('/token?grant_type=refresh_token', {
          refresh_token: session.refresh_token
        });
        rememberToken(refreshed);
        return session.access_token;
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  async function getUser() {
    const token = await getToken();
    const user = await authRequest('/user', undefined, token);
    if (!user || !user.id) throw new Error('ユーザー情報を取得できません');
    session.user = {id: user.id, email: user.email || ''};
    authSave(session);
  }
  function findDatasetKey() {
    const state = app.getState();
    if (!state || !state.bars || state.bars.length < 20 || state.dataset === 'demo') return null;
    if (cachedBars === state.bars) return cachedKey;
    const bars = state.bars;
    let h = 2166136261;
    function mix(n) { h = Math.imul(h ^ (n | 0), 16777619) >>> 0; }
    for (const b of bars) {
      mix(Math.round(b.t / 60000));
      mix(Math.round(b.o * 100));
      mix(Math.round(b.h * 100));
      mix(Math.round(b.l * 100));
      mix(Math.round(b.c * 100));
    }
    cachedBars = bars;
    cachedKey = 'm1v1:' + bars.length + ':' + bars[0].t + ':' + bars[bars.length - 1].t + ':' + h.toString(16);
    return cachedKey;
  }
  function snapshot() {
    const data = app.getSnapshot();
    return {
      cursorTime: data.cursorTime,
      tf: data.tf,
      contextTf: data.contextTf,
      session: data.session,
      direction: data.direction,
      drawings: data.drawings,
      predictions: data.predictions,
      training: data.training || null
    };
  }
  function snapshotJson() { return JSON.stringify(snapshot()); }
  async function dataRequest(path, method, body, prefer) {
    const token = await getToken();
    const headers = {'apikey': PUBLISHABLE_KEY, 'Authorization': 'Bearer ' + token};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = prefer || 'return=representation';
    }
    return request(API + '/rest/v1/' + path, {
      method: method || 'GET', headers,
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
  }
  async function readRemote(key) {
    const filter = 'replay_sessions?select=payload,updated_at&user_id=eq.' +
      encodeURIComponent(session.user.id) + '&dataset_key=eq.' + encodeURIComponent(key) + '&limit=1';
    const rows = await dataRequest(filter, 'GET');
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async function pushNow(force) {
    if (!session || !session.user || !activeKey || fetching) return;
    if (!ready && !force) return;
    if (saving) return;
    const key = activeKey;
    if (key !== findDatasetKey()) return;
    const json = snapshotJson();
    if (json === savedJson && !force) { status('☁ 保存済み', 'success'); return; }
    saving = true;
    status('☁ 保存中…');
    try {
      const urlKey = 'user_id=eq.' + encodeURIComponent(session.user.id)
        + '&dataset_key=eq.' + encodeURIComponent(key);
      const timestamp = new Date(Math.max(Date.now(), (Date.parse(remoteUpdatedAt) || 0) + 2)).toISOString();
      let rows;
      if (!remoteUpdatedAt) {
        // Insert once. Never overwrite a record another device has just created.
        rows = await dataRequest('replay_sessions?on_conflict=user_id,dataset_key&select=updated_at',
          'POST', [{
            user_id: session.user.id, dataset_key: key,
            payload: JSON.parse(json), updated_at: timestamp
          }], 'resolution=ignore-duplicates,return=representation');
      } else {
        // Compare-and-swap using the server's original timestamp.
        // A concurrent update causes 0 updated rows, not a silent overwrite.
        const filter = 'replay_sessions?' + urlKey
          + '&updated_at=eq.' + encodeURIComponent(remoteUpdatedAt)
          + '&select=updated_at';
        rows = await dataRequest(filter, 'PATCH',
          {payload: JSON.parse(json), updated_at: timestamp}, 'return=representation');
      }
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].updated_at) {
        ready = false;
        status('☁ 他端末の更新を検出。自動保存を停止しました。「クラウドを確認」で確認してください。', 'error');
        return;
      }
      if (key === activeKey) {
        savedJson = json;
        remoteUpdatedAt = rows[0].updated_at;
        ready = true;
        status('☁ クラウドに保存済み', 'success');
      }
    } catch (e) {
      console.warn('Replay Lab cloud save:', e);
      ready = false;
      status('☁ 保存失敗：' + e.message + '（端末内には保存。接続回復後に再確認）', 'error');
    } finally {
      saving = false;
      if (key === activeKey && ready && snapshotJson() !== savedJson) schedule();
    }
  }
  function schedule() {
    if (applying || !ready || !session || !activeKey || findDatasetKey() !== activeKey) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { pushNow(false); }, 1200);
    status('☁ 変更あり・まもなく保存');
  }
  async function inspectRemote(force) {
    if (!session || !session.user || fetching || saving) return;
    clearTimeout(saveTimer);
    const key = findDatasetKey();
    if (!key) {
      activeKey = null;
      remoteUpdatedAt = null;
      savedJson = null;
      ready = false;
      status('☁ CSVを読み込むと同期できます');
      return;
    }
    const previousSavedJson = savedJson;
    fetching = true;
    ready = false;
    activeKey = key;
    status('☁ クラウドを確認中…');
    try {
      const row = await readRemote(key);
      if (key !== findDatasetKey() || !session) return;
      const localJson = snapshotJson();
      if (!row) {
        remoteUpdatedAt = null;
        savedJson = null;
        ready = true;
        status('☁ このCSVの初回保存中…');
        // Fetching blocks pushNow: release before first insert.
        fetching = false;
        await pushNow(false);
      } else {
        const remoteData = row.payload;
        if (!remoteData || !Array.isArray(remoteData.drawings) || !Array.isArray(remoteData.predictions)) {
          throw new Error('クラウドの記録形式を確認してください');
        }
        const remoteJson = JSON.stringify({
          cursorTime: remoteData.cursorTime, tf: remoteData.tf,
          contextTf: remoteData.contextTf, session: remoteData.session,
          direction: remoteData.direction,
          drawings: remoteData.drawings, predictions: remoteData.predictions,
          training: remoteData.training || null
        });
        remoteUpdatedAt = row.updated_at || null;
        if (remoteJson === localJson) {
          savedJson = localJson;
          ready = true;
          status('☁ 最新の状態に同期済み', 'success');
        } else {
          const localClean = previousSavedJson !== null && localJson === previousSavedJson;
          const accept = localClean && !force || window.confirm(
            'このCSVのクラウド記録が見つかりました。\n\n' +
            'クラウドの練習位置・描画・予想を読み込むと、この端末の記録は上書きされます。\n\n' +
            'クラウドの続きを開きますか？'
          );
          if (accept) {
            applying = true;
            try { app.applyCloud(remoteData); }
            finally { applying = false; }
            savedJson = snapshotJson();
            ready = true;
            status('☁ クラウドの続きを読み込みました', 'success');
          } else {
            savedJson = remoteJson;
            ready = false;
            status('☁ 同期停止中。端末の記録を残しています（「今すぐ保存」で上書き可能）');
          }
        }
      }
    } catch (e) {
      console.warn('Replay Lab cloud download:', e);
      ready = false;
      status('☁ 同期できません：' + e.message, 'error');
    } finally {
      fetching = false;
    }
  }
  async function reloadFromCloud() {
    if (snapshotJson() !== savedJson && ready) {
      if (!window.confirm('この端末の未同期変更が上書きされる可能性があります。クラウドを読み込みますか？')) return;
    }
    await inspectRemote(true);
  }
  async function forceSave() {
    if (!session || !session.user || fetching || saving) return;
    if (!activeKey) { await inspectRemote(true); return; }
    clearTimeout(saveTimer);
    status('☁ 保存先の最新状態を確認中…');
    try {
      const row = await readRemote(activeKey);
      if (activeKey !== findDatasetKey()) return;
      const different = (row ? row.updated_at : null) !== remoteUpdatedAt;
      if (different || !ready) {
        const ok = window.confirm(
          '他端末に別の練習記録がある可能性があります。\n\n' +
          'この端末の記録でクラウド側を上書きしてよろしいですか？'
        );
        if (!ok) {
          ready = false;
          status('☁ 同期停止中。端末内の記録は残っています');
          return;
        }
      }
      remoteUpdatedAt = row ? row.updated_at : null;
      ready = true;
      await pushNow(true);
    } catch (e) {
      ready = false;
      status('☁ 保存先確認に失敗：' + e.message, 'error');
    }
  }
  async function signIn() {
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || !password) { status('メールアドレスとパスワードを入力してください', 'error'); return; }
    ui.login.disabled = true; ui.register.disabled = true;
    status('ログイン中…');
    try {
      const data = await authRequest('/token?grant_type=password', {email, password});
      rememberToken(data);
      await getUser();
      ui.password.value = '';
      await inspectRemote();
    } catch (e) {
      status('ログイン失敗：' + e.message, 'error');
    } finally {ui.login.disabled = false; ui.register.disabled = false;}
  }
  async function signUp() {
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || password.length < 6) {
      status('メールアドレスと6文字以上のパスワードを入力してください', 'error'); return;
    }
    ui.login.disabled = true; ui.register.disabled = true;
    status('登録処理中…');
    try {
      const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
      const data = await authRequest('/signup?redirect_to=' + redirect, {email, password});
      ui.password.value = '';
      if (data && data.access_token) {
        rememberToken(data);
        await getUser();
        await app.initPromise;
        await inspectRemote();
      } else {
        status('確認メールを送信しました。メールのリンクで認証後、戻ってログインしてください。', 'success');
      }
    } catch (e) {
      status('登録失敗：' + e.message, 'error');
    } finally {ui.login.disabled = false; ui.register.disabled = false;}
  }
  async function signOut() {
    if (!window.confirm('ログアウトしますか？ この端末内の練習データは残ります。')) return;
    const old = session;
    clearTimeout(saveTimer);
    if (old && ready) await pushNow(false);
    authSave(null);
    activeKey = null; ready = false; savedJson = null;
    status('☁ 未ログイン・端末内に保存中');
    try { await authRequest('/logout', {}, old && old.access_token); } catch (_) {}
  }
  async function bootAuth() {
    try {
      const params = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (params.get('error_description')) {
        status('メール認証失敗：' + params.get('error_description'), 'error');
        history.replaceState(null, '', location.pathname + location.search);
      } else if (params.get('access_token') && params.get('refresh_token')) {
        rememberToken({
          access_token: params.get('access_token'),
          refresh_token: params.get('refresh_token'),
          expires_in: Number(params.get('expires_in')) || 3600
        });
        history.replaceState(null, '', location.pathname + location.search);
      } else {
        const raw = localStorage.getItem(AUTH_STORE);
        if (raw) session = JSON.parse(raw);
      }
      updateUI();
      if (session) {
        await getUser();
        await app.initPromise;
        await inspectRemote();
      } else {
        status('☁ 未ログイン・端末内に保存中');
      }
    } catch (e) {
      console.warn('Replay Lab restore login:', e);
      authSave(null);
      status('☁ 再ログインしてください（端末内の記録は残ります）');
    }
  }
  ui.toggle.addEventListener('click', () => {ui.box.hidden = !ui.box.hidden;});
  ui.login.addEventListener('click', signIn);
  ui.register.addEventListener('click', signUp);
  ui.logout.addEventListener('click', signOut);
  ui.save.addEventListener('click', forceSave);
  ui.reload.addEventListener('click', reloadFromCloud);
  ui.password.addEventListener('keydown', (event) => {if (event.key === 'Enter') signIn();});
  document.addEventListener('visibilitychange', async () => {
    if (!session || !activeKey) return;
    if (document.hidden) {
      if (ready && !saving) {clearTimeout(saveTimer); await pushNow(false);}
    } else if (ready && !saving) {
      if (snapshotJson() !== savedJson) await pushNow(false);
      else await inspectRemote();
    }
  });
  window.ReplayLabCloud = {
    schedule,
    datasetChanged: () => {
      clearTimeout(saveTimer);
      ready = false;
      activeKey = null;
      savedJson = null;
      remoteUpdatedAt = null;
      if (session && session.user) inspectRemote();
      else if (session) status('☁ ログイン状態を確認中…');
    }
  };
  updateUI();
  bootAuth();
})();
