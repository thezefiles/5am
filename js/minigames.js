// The one mechanic in the draft: hold to imagine not being.
// Darkness first ("darkness is something"), then the grey absence, then a crash back.
window.Minigames = (() => {
  function voidHold() {
    return new Promise(resolve => {
      const v = document.getElementById('void');
      const dark = v.querySelector('.dark'), abs = v.querySelector('.absence');
      const txt = v.querySelector('.vtext'), prompt = v.querySelector('.vprompt');
      Engine.keyLock = true;
      v.className = 'on';
      prompt.textContent = 'Hold SPACE (or press and hold) to imagine not being.';
      txt.textContent = '';

      let holding = false, t = 0, nothing = 0, last = performance.now(), done = false;
      const down = e => { if (e.type === 'keydown' && e.code !== 'Space') return; e.preventDefault(); holding = true; };
      const up = e => { if (e.type === 'keyup' && e.code !== 'Space') return; holding = false; };
      addEventListener('keydown', down);
      addEventListener('keyup', up);
      v.addEventListener('pointerdown', down);
      addEventListener('pointerup', up);

      function frame(now) {
        const dt = (now - last) / 1000;
        last = now;
        if (nothing === 0) t = Math.max(0, Math.min(4, t + (holding ? dt : -dt * 1.5)));
        const darkness = Math.min(1, t / 2), absence = Math.max(0, Math.min(1, (t - 2.6) / 1.2));
        dark.style.opacity = darkness;
        abs.style.opacity = absence;
        txt.textContent = darkness > 0.9 && absence < 0.3
          ? 'Only darkness? No. Darkness is something. Darkness is just turning off the lights. Keep going.'
          : '';
        if (!holding && t > 0.2 && absence < 1) prompt.textContent = 'The priest\'s voice pulls her back. Hold on.';
        if (absence >= 1) {
          v.classList.add('nothing');
          nothing += dt;
          if (nothing > 2 && !done) {
            done = true;
            Sound.crash();
            v.classList.add('crash');
            setTimeout(() => {
              v.className = '';
              dark.style.opacity = abs.style.opacity = 0;
              removeEventListener('keydown', down);
              removeEventListener('keyup', up);
              v.removeEventListener('pointerdown', down);
              removeEventListener('pointerup', up);
              Engine.keyLock = false;
              resolve();
            }, 700);
            return;
          }
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  return { voidHold };
})();
