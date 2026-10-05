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
