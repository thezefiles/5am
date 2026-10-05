// The script. Rough first draft: three mornings, one mechanic (the void), two endings.
const N = text => ({ type: 'text', text, kind: 'narr' });
const T = text => ({ type: 'text', text, kind: 'thought' });
const S = (speaker, text) => ({ type: 'text', speaker, text, kind: 'say' });
const C = (...options) => ({ type: 'choice', options });
const opt = (text, then = [], when) => ({ text, then, when });
const SET = (k, v = true) => ({ type: 'set', k, v });
const LSET = (k, v = true) => ({ type: 'set', k, v, local: true });
const GO = id => ({ type: 'goto', id });
const FX = (fx, ms) => ({ type: 'fx', fx, ms });
const DO = fn => ({ type: 'do', fn });
const IF = (cond, then, els = []) => ({ type: 'if', cond, then, else: els });
const CARD = (title, sub, ms) => ({ type: 'card', title, sub, ms });
const SND = (name, arg) => ({ type: 'sound', name, arg });
const WAIT = ms => ({ type: 'wait', ms });
const REFRESH = { type: 'refresh' };
const END = title => DO(() => Main.end(title));

const WAKE_UP = [
  SND('alarmStart'),
  N(`The alarm goes off. It's 5 AM.`),
  N(`Slowly, she opens her eyes. Near-total darkness around.`),
];

const CHAPTERS = {
  1: [{ type: 'chapter', n: 1 }, CARD('I', 'The City'), GO('bedroom'), ...WAKE_UP],
  2: [{ type: 'chapter', n: 2 }, CARD('II', 'The Beach'), GO('bedroom'), ...WAKE_UP],
  3: [{ type: 'chapter', n: 3 }, CARD('III', '5 AM'), GO('bedroom'), ...WAKE_UP],
};

const ch = n => s => s.chapter === n;

const SCENES = {
  bedroom: {
    art: Art.bedroom,
    onEnter: s => Sound.ambience(s.chapter === 2 && s.l.windowOpen ? 'ocean' : 'room'),
    hotspots: [
      { label: 'Alarm', rect: { x: 930, y: 700, w: 110, h: 80 }, when: s => !s.l.alarmOff,
        do: [SND('alarmStop'), LSET('alarmOff'), REFRESH,
          N(`She yawns and lifts her torso from the mattress that lies, frameless, on the floor, near the window.`)] },

      // Chapter I
      { label: 'Blinds', rect: { x: 1000, y: 140, w: 460, h: 420 }, when: s => ch(1)(s) && s.l.alarmOff && !s.l.peeked,
        do: [LSET('peeked'), REFRESH, N(`She peeks through the blinds' stripes.`),
          N(`The city hasn't awakened yet. The night still engulfs civilization.`)] },
      { label: 'Open a crack', rect: { x: 1000, y: 140, w: 460, h: 420 }, when: s => ch(1)(s) && s.l.peeked && !s.l.windowOpen,
        do: [LSET('windowOpen'), REFRESH,
          N(`With very slow movements, Cat opens a crack. A small breeze enters the hot, stuffy room.`),
          N(`The scent of the city just before dawn. In her mind, it almost smells like the countryside on a rainy day.`),
          T(`Even though there was no rain.`)] },

      // Chapter II
      { label: 'Blinds', rect: { x: 1000, y: 140, w: 460, h: 420 }, when: s => ch(2)(s) && s.l.alarmOff && !s.l.peeked,
        do: [N(`She peeks through the blinds' stripes. The city...`), LSET('peeked'), FX('glitch', 500), REFRESH,
          N(`...isn't there anymore.`), N(`There's a beach, instead. It seems like the sun will be rising soon.`)] },
      { label: 'Open the window', rect: { x: 1000, y: 140, w: 460, h: 420 }, when: s => ch(2)(s) && s.l.peeked && !s.l.windowOpen,
        do: [LSET('windowOpen'), DO(() => Sound.ambience('ocean')), REFRESH,
          N(`The scent of the city night is gone. It smells like something she never smelled before.`),
          T(`It's probably the smell of the ocean.`), T(`I must still be dreaming.`)] },
      { label: 'Sit on the bed', rect: { x: 420, y: 640, w: 520, h: 100 }, when: s => ch(2)(s) && s.l.peeked && !s.l.jim,
        do: [N(`Dumbfounded, she sits on the edge of her bed, expressionless.`), WAIT(900), SND('knock'),
          N(`After a few seconds, she hears a knock on the door.`),
          S('Cat', `Who's there?`), S('???', `A friend.`),
          LSET('jim'), REFRESH,
          N(`The glasses-wearing man from outside the coffee shop enters the room.`),
          S('The man', `Don't worry, Cat. I'm not here to hurt you.`),
          C(opt(`"Did you drug me?"`, [S('The man', `I didn't drug you. Do you like your new ocean view? Much more pleasant than those old buildings.`)]),
            opt(`"Who are you?"`, [S('The man', `I'm the one who created the universe you lived in.`)])),
          S('Cat', `This is insane. I don't believe you.`),
          S('The man', `But you will. We don't have to be here. Come.`),
          GO('void')] },

      // Chapter III
      { label: 'Blinds', rect: { x: 1000, y: 140, w: 460, h: 420 }, when: s => ch(3)(s) && s.l.alarmOff && !s.l.peeked,
        do: [LSET('peeked'), REFRESH, N(`She peeks through the blinds' stripes. The city is there, once again.`)] },

      { label: 'Door', rect: { x: 60, y: 230, w: 200, h: 440 }, when: s => s.l.alarmOff && !s.l.jim,
        do: [IF(ch(2), [T(`Not yet. She doesn't know what's on the other side anymore.`)],
          [N(`She crawls out of bed and, still in auto-pilot mode, walks through the small hallway into the kitchen.`), GO('kitchen')])] },
    ],
  },

  kitchen: {
    art: Art.kitchen,
    hotspots: [
      { label: 'Coffeemaker', rect: { x: 550, y: 380, w: 240, h: 150 }, when: s => !s.l.coffee,
        do: [SND('brew'), LSET('coffee'), REFRESH, N(`In a few seconds, she grabs the first cup of coffee of the day.`)] },
      { label: 'Note on the fridge', rect: { x: 1180, y: 190, w: 200, h: 570 },
        do: [N(`A note in Vladislav's handwriting: "BUY PEPSI".`), SET('pepsi')] },
      { label: 'Living room', rect: { x: 1420, y: 180, w: 180, h: 600 },
        do: [IF(s => s.l.coffee, [GO('living')], [T(`Not without coffee.`)])] },
    ],
  },

  living: {
    art: Art.living,
    onEnter: () => Sound.ambience('city'),
    enter: [IF(s => s.chapter === 1, [
      N(`As Cat walks into the living room, the darkness starts to slowly fade away.`),
      N(`Occupying one of the desks sits Anton, sleeping, with his head buried in his arms.`)])],
    hotspots: [
      { label: 'Anton', rect: { x: 680, y: 580, w: 220, h: 120 }, when: s => !s.l.antonGone,
        do: [N(`"Tupoy baran," she murmurs to herself. She pokes Anton's chair with her foot.`),
          S('Anton', `Chto? Mama?`),
          S('Cat', s => (s.chapter === 3 ? `Still not your mama, Anton. Go to bed.` : `I'm not your mama, Anton. Go to bed.`)),
          S('Anton', `Grrmgh... bed...`), LSET('antonGone'), REFRESH] },
      { label: 'Window', rect: { x: 880, y: 120, w: 640, h: 440 },
        do: [LSET('dawn', s => Math.max(1, s.l.dawn || 0)), REFRESH,
          N(`A new day is dawning. Old, damaged, Soviet-style apartment buildings. A single picnic table in a badly-kept park.`),
          T(`In an hour or two, the babushki will be out there, talking about life.`)] },
      { label: 'Your desk', rect: { x: 1120, y: 560, w: 400, h: 150 }, when: s => s.chapter === 1 && !s.l.workDone,
        do: [IF(s => !s.l.antonGone, [T(`Not with Anton snoring next to me.`)], [
          LSET('atDesk'), REFRESH,
          N(`Accounting software for a small company. Not a lot of work, but enough to keep her lifestyle.`),
          N(`Yet, it is boring work.`), WAIT(600),
          LSET('dawn', 2), LSET('babushki'), LSET('atDesk', false), LSET('workDone'), REFRESH,
          N(`Her self-imposed shift ends. Outside, the babushki have gathered at the picnic table.`),
          T(`Maybe a walk. Maybe a bus into the center.`)])] },
      { label: 'Go to the center', rect: { x: 0, y: 230, w: 80, h: 460 }, when: s => s.l.workDone,
        do: [N(`A quick shower and a half-an-hour ride later, she arrives at the capital's historic center.`), GO('cafe')] },
      { label: 'Your desk', rect: { x: 1120, y: 560, w: 400, h: 150 }, when: ch(3),
        do: [LSET('atDesk'), REFRESH,
          IF(s => s.f.accepted, [
            N(`In a few minutes, Cat is back on her computer, working on her new project.`),
            N(`A blank file. A cursor, blinking, waiting for a Big Bang.`),
            N(`Now, she is more than just "Cat, the programmer".`),
            N(`She is the Almighty, the Queen of Queens, the Alpha and the Omega.`),
            END('Queen of Queens')],
          [N(`She doesn't open the accounting software. She takes her coffee to the window and watches the sun come up.`),
            T(`Why can't we just be?`), END('Just Be')])] },
    ],
  },

  cafe: {
    art: Art.cafe,
    onEnter: () => Sound.ambience('cafe'),
    enter: [IF(s => !s.f.returned, [
      N(`A large, modern, two-story coffee shop. She sits near the window, on the top floor, and watches life unravel outside.`),
      T(`Sleep-work-sleep, for most of their lives. Then, death. Quite a pointless life.`),
      T(`Some say the memories we leave in others are the meaning of life. Nonsense. Eventually, nobody will remember anybody.`),
      T(`Our conscient being exists. But why?`),
      N(`She remembers the first time she asked that question. She was thirteen.`),
      GO('wake'),
    ], [
      N(`Cat didn't even notice she had nearly finished her latte. Something is wrong. All her life she knew something felt wrong.`),
      N(`There are fewer people on the street now.`),
      LSET('man'), REFRESH, FX('glitch', 400),
      N(`One man is standing still. Short, brownish skin, glasses, very dark hair.`),
      N(`He's staring at her.`),
      C(opt('Stare back'), opt('Look away')),
      N(`Something feels very wrong, now.`),
      FX('dissolve', 1200), DO(() => Sound.ambience('none')),
      DO((s, api) => api.run(CHAPTERS[2])),
    ])],
    hotspots: [],
  },

  wake: {
    art: Art.wake,
    onEnter: () => Sound.ambience('chapel'),
    enter: [
      N(`Her aunt had just passed away. During the wake, Cat ignored the priest's words.`),
      T(`What is it like, not to be alive? Not darkness. Not sleep without dreams. Nothing.`),
      DO(() => Sound.ambience('none')),
      DO(() => Minigames.voidHold()),
      DO(() => Sound.ambience('chapel')),
      N(`Two seconds went by. Then she crashed back into existence, eyes dry and wide open.`),
      S('Mother', `Katya? Are you ok?`),
      C(opt(`"Yes."`), opt(`Say nothing.`)),
      N(`She didn't know for sure if that was an accurate answer. That simple episode had been life-changing.`),
      SET('returned'), GO('cafe'),
    ],
    hotspots: [],
  },

  void: {
    art: Art.void,
    onEnter: () => Sound.ambience('drone'),
    enter: [
      N(`The room disappears. They are floating. Not darkness: she can see herself and the man. Everything else is void.`),
      S('The man', `This feels familiar, doesn't it?`),
      S('Cat', `If you're really God, why did you show up to me? Did I die?`),
      S('The man', `You didn't die. Quite the contrary. You're a survivor. And you can call me Jim-Bob.`),
      N(`Cat immediately bursts into laughter.`),
      S('Jim-Bob', `Your reality is a computer program I created. And I kind of ruined it by mistake. I spilled Coca-Cola on the drive.`),
      S('Cat', `What's Coca-Cola?`),
      S('Jim-Bob', `A soda. You don't have it in your realm. Only Pepsi.`),
      IF(s => s.f.pepsi, [T(`BUY PEPSI.`)]),
      S('Cat', `Can we go somewhere else?`),
      GO('beach'),
    ],
    hotspots: [],
  },

  beach: {
    art: Art.beach,
    onEnter: () => Sound.ambience('ocean'),
    enter: [N(`The beach she saw through her window. Barefoot on the sand, she walks beside Jim-Bob in silence.`)],
    hotspots: [
      { label: 'Keep walking →', rect: { x: 1380, y: 640, w: 200, h: 220 }, when: s => (s.l.beat || 0) < 3,
        do: [{ type: 'walk' }, DO((s, api) => api.run(BEATS[s.l.beat || 0])), LSET('beat', s => (s.l.beat || 0) + 1)] },
    ],
  },
};

const BEATS = [
  [S('Jim-Bob', `When you pictured the absolute void, you peeked outside of the simulation. You're the only one who ever did. You are special, Cat.`),
    S('Cat', `That's a nice way of saying I'm a bug in your software.`),
    S('Jim-Bob', `An interesting bug.`)],
  [S('Cat', `I don't want to live in another simulation. I want to live in your world. I'm not real.`),
    S('Jim-Bob', `You are real, Cat. Your reality was just generated inside another reality.`),
    S('Cat', `Then where did your universe come from? Is it just a program generated by another Jim-Bob?`),
    S('Jim-Bob', `Huh... I guess. Do you really need life to have meaning? Why can't we just be?`)],
  [S('Jim-Bob', `I can't bring you to my world. But I could send you back to one just like yours, with the technology to simulate universes of your own.`),
    C(opt(`"I guess."`, [SET('accepted')]),
      opt(`"No. Just send me home. Let me just be."`, [SET('accepted', false)])),
    S('Jim-Bob', `Always remember, Yekaterina. You are as real as I am.`),
    FX('whiteout'), DO(() => Sound.ambience('none')),
    DO((s, api) => api.run(CHAPTERS[3]))],
];
