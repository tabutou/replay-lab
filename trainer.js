/* Replay Lab v0.4 guided practice. Original candles/drawing engines remain unchanged. */
(() => {
  'use strict';
  const app = window.ReplayLabDebug;
  if (!app) return;
  const state = app.getState();
  const $ = id => document.getElementById(id);
  const phases = ['analysis', 'replay', 'review', 'done'];
  const outcomeNames = {matched:'概ね想定通り',partial:'一部想定通り',missed:'想定と異なった',unclear:'判断保留'};
  const key = () => 'fxreplay:v1:' + state.dataset + ':training';
  const status = msg => app.notify(msg);
  const clean = t => {
    if (!t || typeof t !== 'object' || !phases.includes(t.phase)) return null;
    if (t.session !== state.session || !state.bars.some(b => b.t === t.startTime)) return null;
    return t;
  };
  function save() {
    try { localStorage.setItem(key(), JSON.stringify(state.training || null)); } catch (_) {}
    window.ReplayLabCloud?.schedule();
  }
  function setInputs() {
    const t = state.training || {};
    $('trainEnvironment').value = t.environment || '';
    $('trainPoint').value = t.point || '';
    $('trainScenario').value = t.scenario || '';
    $('trainDirection').value = ['up','down','range'].includes(t.direction) ? t.direction : 'up';
    $('trainReview').value = t.review || '';
    $('trainOutcome').value = Object.keys(outcomeNames).includes(t.outcome) ? t.outcome : 'matched';
    if (t.direction) state.direction = t.direction;
    render();
  }
  function saveDraft() {
    const t = state.training;
    if (!t) return;
    if (t.phase === 'analysis') {
      t.environment = $('trainEnvironment').value;
      t.point = $('trainPoint').value;
      t.scenario = $('trainScenario').value;
      t.direction = $('trainDirection').value;
      state.direction = t.direction;
      save();
    } else if (t.phase === 'review') {
      t.review = $('trainReview').value;
      t.outcome = $('trainOutcome').value;
      save();
    }
  }
  function render() {
    const t = state.training, phase = t?.phase || 'free';
    const analysis = phase === 'analysis', replay = phase === 'replay';
    const review = phase === 'review', done = phase === 'done';
    $('trainPhase').textContent = ({
      free:'自由モード', analysis:'① 環境認識・予想', replay:'② 未来を再生',
      review:'③ 振り返り',done:'✓ 1問完了'
    })[phase] || '自由モード';
    $('trainStart').textContent = t ? '次の問題を始める' : 'ランダムな1問を始める';
    $('trainExit').hidden = !t;
    $('trainForm').hidden = !t;
    $('trainHelp').textContent = analysis
      ? '🔒 未来はロック中。環境認識・注目ポイント・方向・シナリオを記入して固定しよう。'
      : replay ? '✅ 予想は固定済み。チャートを進めて結果を観察しよう。'
      : review ? '固定した予想と現実を比較して、次に活かす学びを記録しよう。'
      : done ? '振り返りを保存しました。次の問題へ進もう。' : '';
    ['trainEnvironment','trainPoint','trainScenario'].forEach(id => {$(id).readOnly = !analysis;});
    $('trainDirection').disabled = !analysis;
    $('trainLock').hidden = !analysis;
    $('trainToReview').hidden = !replay;
    $('trainReviewForm').hidden = !(review || done);
    $('trainReview').readOnly = !review;
    $('trainOutcome').disabled = !review;
    $('trainFinish').hidden = !review;
    $('trainResume').hidden = !review;
    $('trainSummary').hidden = !done;
    if (done) $('trainSummary').textContent =
      '✅ ' + (outcomeNames[t.outcome] || '記録済み') +
      '。振り返りは練習ログに保存されました。';
    const allowed = !t || replay;
    ['nextOne','nextFive','nextFifteen','nextOneBar'].forEach(id => {
      $(id).disabled = !allowed || state.cursor >= state.bars.length-1;
    });
    $('playBtn').disabled = !allowed;
    $('savePrediction').disabled = !!t;
    if (!allowed) app.pause();
  }
  function datasetChanged() {
    try {
      const raw = localStorage.getItem(key());
      state.training = clean(raw ? JSON.parse(raw) : null);
    } catch (_) { state.training = null; }
    setInputs();
  }
  function applyCloud(value) {
    state.training = clean(value);
    try { localStorage.setItem(key(), JSON.stringify(state.training)); } catch (_) {}
    setInputs();
  }
  function start() {
    if (state.bars.length < 1200) {
      status('練習問題にはM1データが1200本以上必要です'); return;
    }
    if (state.training && state.training.phase !== 'done' &&
      !confirm('現在の練習を中断して次の問題へ進みますか？ 固定済みの予想はログに残ります。')) return;
    app.pause();
    const n = state.bars.length;
    const from = Math.max(500, Math.floor(n * .20));
    const to = Math.max(from + 1, Math.floor(n * .72));
    state.cursor = from + Math.floor(Math.random() * (to - from));
    state.session = 'train:' + Date.now() + ':' + Math.random().toString(36).slice(2,7);
    state.training = {
      version:1,phase:'analysis',session:state.session,startTime:state.bars[state.cursor].t,
      environment:'',point:'',scenario:'',direction:'up',predictionId:null,
      review:'',outcome:'matched'
    };
    state.direction = 'up'; state.tf = 'H4'; state.contextTf = 'D1';
    state.pan = 0; state.contextPan = 0; state.hover = null;
    state.zoneStart = null; state.tool = 'pan';
    $('predictionText').value = '';
    setInputs(); save(); app.persist(); app.redraw(); app.renderHistory();
    status('新しい1問！ 予想を固定するまで未来は見られません。');
    $('trainEnvironment').focus();
  }
  function exit() {
    if (!state.training) return;
    if (state.training.phase !== 'done' &&
      !confirm('練習を中断して自由モードに戻りますか？')) return;
    app.pause(); state.training = null; save(); setInputs(); app.redraw();
    status('自由モードに戻りました');
  }
  function freeRandom() {
    if (!state.training) return true;
    if (state.training.phase !== 'done' &&
      !confirm('練習モードを中断して、自由モードのランダム出題に切り替えますか？')) return false;
    state.training = null; save(); setInputs();
    return true;
  }
  function allowed() {
    if (!state.training || state.training.phase === 'replay') return true;
    status(state.training.phase === 'analysis'
      ? '未来を見る前に、練習モードで予想を固定しよう！'
      : '振り返り中は再生を停止しています。');
    return false;
  }
  function lock() {
    const t = state.training;
    if (!t || t.phase !== 'analysis') return;
    saveDraft();
    if (!t.environment.trim() || !t.point.trim() || !t.scenario.trim()) {
      status('環境認識・反応ポイント・シナリオの3つを記入してね'); return;
    }
    if (state.bars[state.cursor].t !== t.startTime) {
      status('練習開始位置が変わっています。最初からやり直してください'); return;
    }
    const b = state.bars[state.cursor];
    const id = Date.now() + ':' + Math.random().toString(36).slice(2);
    t.predictionId = id;
    t.phase = 'replay';
    t.fixedAt = b.t;
    state.predictions.push({
      id, session:state.session, atIndex:state.cursor, at:b.t, price:b.c,
      tf:state.tf, direction:t.direction,
      text:'【環境認識】' + t.environment.trim() + '\n【反応ポイント】' + t.point.trim() +
        '\n【シナリオ】' + t.scenario.trim()
    });
    app.savePredictions(); save(); app.persist(); app.renderHistory(); app.redraw();
    status('予想を固定したで！ ここから未来を再生できます。');
  }
  function beginReview() {
    const t=state.training;
    if (!t || t.phase !== 'replay') return;
    app.pause(); t.phase = 'review'; t.stopTime = state.bars[state.cursor].t;
    save(); app.redraw(); $('trainReview').focus();
  }
  function resume() {
    const t = state.training;
    if (!t || t.phase !== 'review') return;
    saveDraft(); t.phase = 'replay'; save(); app.redraw();
  }
  function finish() {
    const t = state.training;
    if (!t || t.phase !== 'review') return;
    saveDraft();
    if (!t.review.trim()) {status('振り返りを書いてから完了しよう');return;}
    t.phase='done';t.completedAt=new Date().toISOString();
    const prediction = state.predictions.find(p => p.id === t.predictionId);
    if (prediction) prediction.trainingResult = {
      review:t.review.trim(), outcome:t.outcome, label:outcomeNames[t.outcome] || '記録',
      stopTime:t.stopTime, completedAt:t.completedAt
    };
    app.savePredictions(); save(); app.renderHistory(); app.redraw();
    status('1問完了！ 予想と振り返りを保存しました。');
  }
  for (const id of ['trainEnvironment','trainPoint','trainScenario','trainDirection','trainReview','trainOutcome']) {
    $(id).addEventListener(id.startsWith('trainD') || id === 'trainOutcome' ? 'change' : 'input',saveDraft);
  }
  $('trainStart').addEventListener('click',start);
  $('trainExit').addEventListener('click',exit);
  $('trainLock').addEventListener('click',lock);
  $('trainToReview').addEventListener('click',beginReview);
  $('trainResume').addEventListener('click',resume);
  $('trainFinish').addEventListener('click',finish);
  window.ReplayLabTraining = {render,datasetChanged,applyCloud,allowed,freeRandom};
  app.initPromise.then(datasetChanged).catch(e => {console.warn('Training init failed', e);});
})();
