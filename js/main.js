window.Main = (() => {
  const $ = id => document.getElementById(id);
  const ENDINGS = '5am-endings';

  function start(chapter, flags = {}) {
    Sound.ensure();
    $('title').hidden = true;
    $('end').hidden = true;
    Engine.reset();
    Object.assign(Engine.state.f, flags);
    Engine.play(CHAPTERS[chapter]);
  }

  function end(title) {
    let found = [];
    try { found = JSON.parse(localStorage.getItem(ENDINGS)) || []; } catch (e) { /* storage unavailable */ }
    if (!found.includes(title)) found.push(title);
    try {
      localStorage.setItem(ENDINGS, JSON.stringify(found));
      localStorage.removeItem('5am-save');
    } catch (e) { /* storage unavailable */ }
    Sound.ambience('none');
    Sound.alarmStart();
    setTimeout(Sound.alarmStop, 3500);
    $('end-title').textContent = title;
    $('end-count').textContent = `${found.length} of 2 endings found`;
    $('end').hidden = false;
  }

  function showTitle() {
    $('end').hidden = true;
    $('title').hidden = false;
    const saved = Engine.load();
    const cont = $('btn-continue');
    cont.hidden = !(saved && saved.chapter > 1);
    if (saved) cont.textContent = `Continue (chapter ${['', 'I', 'II', 'III'][saved.chapter]})`;
  }

  Engine.init(SCENES);
  $('btn-begin').onclick = () => start(1);
  $('btn-continue').onclick = () => { const s = Engine.load(); start(s.chapter, s.f); };
  $('btn-again').onclick = showTitle;
  $('mute').onclick = () => {
    Sound.setMuted(!Sound.muted);
    $('mute').classList.toggle('off', Sound.muted);
  };

  // ?chapter=2 jumps straight to a chapter (handy while iterating).
  const jump = +new URLSearchParams(location.search).get('chapter');
  if (CHAPTERS[jump]) start(jump);
  else showTitle();

  return { end };
})();
