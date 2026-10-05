// A tiny scene/step runner. Scenes have art, hotspots and an optional `enter` sequence;
// sequences are arrays of steps (text, choices, flags, scene changes, effects...).
window.Engine = (() => {
  const state = { f: {}, l: {}, chapter: 0, scene: null, walk: 0 };
  let scenes = {}, els = {}, depth = 0;
  let typing = null, waiter = null, choiceButtons = null;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const val = v => (typeof v === 'function' ? v(state) : v);

  function init(defs) {
    scenes = defs;
    const q = id => document.getElementById(id);
    els = {
      stage: q('stage'), art: q('art'), box: q('textbox'), speaker: q('speaker'), text: q('text'),
      choices: q('choices'), hint: q('hint'), card: q('card'), fade: q('fade'), label: q('hotlabel'), overlay: q('overlay'),
    };
    els.stage.addEventListener('click', e => {
      if (e.target.closest('#overlay') || e.target.closest('.screen') || e.target.closest('#choices')) return;
      advance();
    });
    document.addEventListener('keydown', e => {
      if (api.keyLock) return;
      if (choiceButtons && /^Digit[1-9]$/.test(e.code)) {
        choiceButtons[+e.code.slice(5) - 1]?.click();
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        advance();
      }
    });
  }

  function advance() {
    if (typing) { typing.finish(); return; }
    if (waiter) { const w = waiter; waiter = null; w(); }
  }

  function hideBox() {
    els.box.classList.add('hidden');
    els.hint.hidden = true;
  }

  function say(speaker, text, kind = 'narr') {
    return new Promise(resolve => {
      els.box.classList.remove('hidden');
      els.box.dataset.kind = kind;
      els.speaker.textContent = speaker || '';
      els.speaker.hidden = !speaker;
      els.choices.innerHTML = '';
      els.hint.hidden = true;
      let i = 0;
      const timer = setInterval(() => {
        i += 1;
        els.text.textContent = text.slice(0, i);
        if (i >= text.length) finish();
      }, 22);
      function finish() {
        clearInterval(timer);
        els.text.textContent = text;
        typing = null;
        els.hint.hidden = false;
        waiter = () => { els.hint.hidden = true; resolve(); };
      }
      typing = { finish };
    });
  }

  function choose(options) {
    return new Promise(resolve => {
      els.box.classList.remove('hidden');
      els.hint.hidden = true;
      els.choices.innerHTML = '';
      choiceButtons = options.map((o, i) => {
        const b = document.createElement('button');
        b.innerHTML = `<span class="n">${i + 1}</span>${val(o.text)}`;
        b.addEventListener('click', e => {
          e.stopPropagation();
          els.choices.innerHTML = '';
          choiceButtons = null;
          resolve(o);
        });
        els.choices.append(b);
        return b;
      });
    });
  }

  const visible = list => list.filter(o => !o.when || o.when(state));

  async function exec(st) {
    switch (st.type) {
      case 'text': return say(val(st.speaker), val(st.text), st.kind);
      case 'choice': {
        const o = await choose(visible(st.options));
        return run(val(o.then));
      }
      case 'hub': {
        // Ask questions in any order; an option marked `exit` leaves the hub.
        const asked = new Set();
        for (;;) {
          const opts = visible(st.options.filter(o => o.exit || !asked.has(o)));
          const o = await choose(opts);
          asked.add(o);
          await run(val(o.then));
          if (o.exit) return;
        }
      }
      case 'set': (st.local ? state.l : state.f)[st.k] = val(st.v); return;
      case 'goto': return goto(st.id);
      case 'fx': return fx(st.fx, st.ms);
      case 'do': return st.fn(state, api);
      case 'if': return run(st.cond(state) ? st.then : st.else);
      case 'card': return card(st.title, st.sub, st.ms);
      case 'sound': return Sound[st.name] && Sound[st.name](st.arg);
      case 'wait': hideBox(); return wait(st.ms);
      case 'refresh': return render();
      case 'hide': return hideBox();
      case 'walk': {
        state.walk += 1;
        applyWalk();
        hideBox();
        return wait(1000);
      }
      case 'chapter':
        state.chapter = st.n;
        state.l = {};
        state.walk = 0;
        save();
        return;
      default: console.warn('unknown step', st);
    }
  }

  async function run(steps) {
    for (const st of val(steps) || []) await exec(st);
  }

  // Top-level entry point: run a sequence while blocking hotspots.
  async function play(steps) {
    depth += 1;
    els.stage.classList.add('busy');
    hideLabel();
    try {
      await run(steps);
    } finally {
      depth -= 1;
      if (depth === 0) {
        hideBox();
        els.stage.classList.remove('busy');
        render();
      }
    }
  }

  async function goto(id) {
    els.fade.classList.add('on');
    await wait(500);
    state.scene = id;
    state.walk = 0;
    const sc = scenes[id];
    if (sc.onEnter) sc.onEnter(state);
    render();
    els.fade.classList.remove('on');
    await wait(450);
    if (sc.enter) await run(sc.enter);
  }

  function applyWalk() {
    els.art.querySelectorAll('[data-par]').forEach(g => {
      g.style.transform = `translate(${-state.walk * +g.dataset.par}px,0)`;
    });
    const sun = els.art.querySelector('[data-sun]');
    if (sun) sun.style.transform = `translate(0,${-Math.min(state.walk, 6) * 26}px)`;
    const walkers = els.art.querySelector('.walkers');
    if (walkers) {
      walkers.classList.add('walking');
      setTimeout(() => walkers.classList.remove('walking'), 1000);
    }
  }

  function render() {
    const sc = scenes[state.scene];
    if (!sc) return;
    const spots = visible(val(sc.hotspots) || []);
    const spotSvg = spots.map((h, i) => {
      const { x, y, w, h: hh } = h.rect;
      const [mx, my] = h.mark || [x + w / 2, y + hh / 2];
      return `<g class="hotspot" data-i="${i}"><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="16"/>
        <circle class="mark" cx="${mx}" cy="${my}" r="9"/><circle class="ring" cx="${mx}" cy="${my}" r="9"/></g>`;
    }).join('');
    els.art.innerHTML = `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${sc.art(state)}<g>${spotSvg}</g></svg>`;
    els.art.querySelectorAll('.hotspot').forEach(g => {
      const h = spots[+g.dataset.i];
      g.addEventListener('pointerenter', e => showLabel(h.label, e));
      g.addEventListener('pointermove', e => showLabel(h.label, e));
      g.addEventListener('pointerleave', hideLabel);
      g.addEventListener('click', e => {
        e.stopPropagation();
        if (depth > 0) return;
        play(h.do);
      });
    });
  }

  function showLabel(text, e) {
    if (depth > 0) return;
    const r = els.stage.getBoundingClientRect();
    els.label.textContent = val(text);
    els.label.hidden = false;
    const x = Math.min(e.clientX - r.left + 14, r.width - els.label.offsetWidth - 8);
    els.label.style.transform = `translate(${x}px, ${e.clientY - r.top - 34}px)`;
  }

  function hideLabel() { els.label.hidden = true; }

  async function fx(name, ms = 600) {
    if (name === 'flash' || name === 'whiteout') {
      els.fade.classList.add('white', 'on');
      await wait(name === 'whiteout' ? 1600 : 250);
      els.fade.classList.remove('on');
      await wait(500);
      els.fade.classList.remove('white');
      return;
    }
    if (name === 'black') { els.fade.classList.add('on'); return wait(600); }
    if (name === 'unblack') { els.fade.classList.remove('on'); return wait(500); }
    if (name === 'glitch' || name === 'dissolve') Sound.glitch();
    els.stage.classList.add(name);
    await wait(ms);
    if (name !== 'dissolve') els.stage.classList.remove(name);
  }

  async function card(title, sub, ms = 2800) {
    hideBox();
    els.card.querySelector('.t').textContent = title || '';
    els.card.querySelector('.s').textContent = sub || '';
    els.card.hidden = false;
    await wait(30);
    els.card.classList.add('on');
    await wait(ms);
    els.card.classList.remove('on');
    els.stage.classList.remove('dissolve');
    await wait(700);
    els.card.hidden = true;
  }

  const SAVE = '5am-save';
  function save() {
    try { localStorage.setItem(SAVE, JSON.stringify({ chapter: state.chapter, f: state.f })); } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(SAVE)); } catch (e) { return null; }
  }

  function reset() {
    state.f = {};
    state.l = {};
    state.chapter = 0;
    state.scene = null;
    state.walk = 0;
    els.art.innerHTML = '';
  }

  const api = { init, play, run, say, wait, render, state, load, reset, hideBox, keyLock: false, get els() { return els; } };
  return api;
})();
