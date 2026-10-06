# 5 AM

A short narrative game based on the short story *5 AM*. It's a rough first draft, meant as a base to brainstorm from.

## Play

Open `index.html` in a browser. There's no build step and nothing to install.
You can also serve the folder (`python3 -m http.server`) and open `http://localhost:8000`.

- Click, or press Space/Enter, to read on. Use 1–9 to pick choices.
- Click the glowing points to interact.
- `index.html?chapter=2` jumps straight to a chapter, which is handy while iterating.

## Structure of the draft

| Chapter | Scenes | What happens |
|---|---|---|
| I · The City | bedroom → kitchen → living room → café → the wake (flashback) → café | The routine morning; the memory of the void; the man staring |
| II · The Beach | bedroom → void → beach | The beach outside the window, Jim-Bob, the walk and his proposal |
| III · 5 AM | bedroom → kitchen → living room | Back in the city; the ending depends on your answer on the beach |

The one mechanic so far is **the void**. At the wake you hold Space (or press and hold) to imagine not being. First comes darkness ("darkness is something"), then grey absence, then the crash back into existence.

There are two endings: *Queen of Queens* (accept Jim-Bob's offer) and *Just Be* (decline it).

## Code

- `js/story.js`: all the writing. Scenes, hotspots and dialogue are plain data built with small helpers (`N`, `S`, `C`, `GO`…).
- `js/engine.js`: runs scenes and step sequences (text, choices, flags, scene changes, effects).
- `js/art.js`: every scene is drawn as SVG in code, with no image files.
- `js/audio.js`: synthesised alarm and ambiences (WebAudio).
- `js/minigames.js`: the void-hold mechanic.

## Arena Lund (`arena/Arena_Lund.html`)

A separate 3D scene: an art déco arena on the south side of Lund, Skåne, with the town round it. It uses the same
rendering approach as the *Arena do Rei Antony* scene it is based on (procedural Three.js, instanced facades, a physical
sky with haze, a day–night cycle, traffic and crowds), but none of that scene's places.

Everything is in one self-contained file, like the scene it is based on: open `arena/Arena_Lund.html` in a browser,
online or offline. Drag to orbit, scroll to zoom, right-drag to pan,
and use the slider at the bottom to change the time of day; after sunset the arena's windows, neon and globes light up.
`?t=20.5` starts at a given hour and `?cam=x,y,z,tx,ty,tz` at a given camera.

- **The arena**: a stepped drum in ivory stone with tall amber windows between fluted piers, a green frieze tier, a ribbed
  verdigris dome with a glazed lantern, and an entrance tower with a sunburst, a clock, a bulb marquee and gold neon.
  The name is set by `ARENA_NAME` at the top of the scene script in `arena/Arena_Lund.html`.
- **Lund**: the cathedral with its twin towers, Universitetshuset, Kungshuset, AF-borgen and the squares inside the ring
  of the old walls; Lund C with trains, the tram out to Brunnshög (MAX IV, ESS), the hospital, the engineering campus,
  terraced houses, villas and 1960s slab blocks, and a great many bicycles.
- **Round it**: Skåne's autumn fields, farmsteads and wind turbines, Höje å, Romeleåsen, the Öresund to the west, and
  Malmö with the Turning Torso on the horizon.

The file embeds Three.js r128 with its OrbitControls and Sky examples (MIT licence, © Three.js authors) and the fonts
Limelight, Josefin Sans and IBM Plex Mono (SIL Open Font Licence).
