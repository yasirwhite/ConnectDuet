# ConnectDuet conceptual overview

An original, synthetic 12-second diagram explaining one coordinating Claude Duet session delegating to friendly Claude sessions, with Codex steering as a bonus. Native routes are shown: Claude app frontend input and active Codex session steering. This is an illustration of the configured routing setup, **not a screen recording or evidence that real agents completed the displayed tasks**. Standalone mailbox mode has different delivery behavior.

The scene was rendered with [OpenDemo](https://github.com/yasirwhite/OpenDemo), using its [`src/lib/textcards/render.mjs`](https://github.com/yasirwhite/OpenDemo/blob/main/src/lib/textcards/render.mjs) frame renderer and `--html` support. OpenDemo launches Playwright, evaluates the pure `renderAtTime(t)` scene, and pipes frames to FFmpeg. No OpenDemo source code is vendored here. `scene.js` is original ConnectDuet code; OpenDemo is MIT licensed.

## Files

- `connectduet.html`: 1280×720 private rendering stage; `window.DURATION = 12`.
- `scene.js`: time-based SVG composition, with no network calls or private session data.
- `export-still.mjs`: regenerates the accessible SVG from the same scene.
- `../docs/assets/connectduet-overview.gif`: looping README preview.
- `../docs/assets/connectduet-overview.mp4`: silent 30 fps video.
- `../docs/assets/connectduet-overview.png` and `.svg`: static diagram.

## Reproduce

Install OpenDemo's renderer prerequisites in a separate checkout: Node, Playwright with Chromium, and FFmpeg. See its documentation for platform setup. The paths below are illustrative and should point to your own directories. Render commands run from the ConnectDuet repository:

```sh
node /path/to/OpenDemo/src/lib/textcards/render.mjs --html demo/connectduet.html --out docs/assets/connectduet-overview.mp4 --fps 30
node /path/to/OpenDemo/src/lib/textcards/render.mjs --html demo/connectduet.html --at 10.8 --png docs/assets/connectduet-overview.png
node demo/export-still.mjs
ffmpeg -y -i docs/assets/connectduet-overview.mp4 -filter_complex "[0:v]fps=18,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 docs/assets/connectduet-overview.gif
```

The scene never runs agent tools, performs model calls, or sends Discord messages. Every displayed message is fictional. The native bridge still requires compatible local routes; it does not claim to bypass model policies or wake arbitrary unconfigured sessions.
