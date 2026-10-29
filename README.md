# LobeHub Pixel Pet

A pixel-art desktop pet whose brain is a [LobeHub](https://lobehub.com) agent. It needs a LobeHub account and the LobeHub CLI (`lh`). This is a community project that builds on LobeHub, not an official LobeHub product.

1. First launch: four eggs (fire / water / grass / whale). Pick one.
2. The app calls the LobeHub CLI: `lh login` (device-code login in your browser, skipped if you are already logged in), then `lh agent create` to make **your** pet's agent, with the species personality baked into its system role.
3. The pet lives on your desktop: it gets hungry, tired and bored, evolves (baby → child → adult), remembers what you tell it, and speaks up on its own.

The fire, water and grass pets are pixel art generated in code (`src/renderer/sprites.js`), with no third-party assets. The fourth, **大肥鱼 (Dafeiyu)**, uses animations from a community project; see [Credits](#credits). The pet window is small and shows only the pet; the bars, buttons and chat box appear while the pointer is over it.

## What the pet can do (v0.2)

- **Works first, charms second.** The persona is flexible: simple jobs (look something up, search the web, calculate, translate, write) are just done, in the pet's voice. Replies aim for 50 characters or fewer, and big tasks are done one step at a time. Longer replies scroll inside the bubble.
- **Hover only.** Bars, name line, buttons and the chat box show **only while the pointer is over the pet window**. Moving away hides everything, even an open chat box: the draft and attached files are kept and come back on the next hover (the hidden box also gives up keyboard focus). The one exception is typing: during an IME composition (Chinese/Japanese/Korean input) and for 1.5 s after the last keystroke the box stays, because a Windows IME's candidate window fires blur/mouse-leave events and hiding the box would cancel the composition. Whether the pointer is over the pet is read from the OS cursor position, not from those DOM events. To paste a picture, hover the pet first.
- **Busy means busy.** While the pet is thinking or working, only the pet and a "思考中" bubble show; the bars, buttons and chat box stay hidden even on hover, and care actions are refused. While it works, hovering shows only a **■ 停止 (Stop)** button; click it (or press **Esc**) to interrupt, including while the device is being connected.
- **Pictures.** Paste with Ctrl/⌘+V, drag an image onto the window, or use the 📎 button (up to 4 images, 8 MB each). Images are sent directly to the Responses API.
- **Use this computer.** The hatch screen has an option (on by default) to let the pet use local tools. The app handles function calls locally without starting `lh connect`. Toggle access from the ⋯ menu.
- **Drop files on the pet.** Files and folders are passed by path. With local access enabled, the agent can inspect them using local tools; screenshots are sent to the API as images.

> **Security.** Local tools can read files and run commands as your user, including commands that write or delete files. They are not sandboxed. Untrusted pages, files and images may contain instructions intended to trick the model. Disable local access if you do not want this; never use it with untrusted content without supervision.

## Download (macOS)

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on a macOS runner: a **universal** build, so one file runs on both Apple Silicon and Intel.

1. Open the repository's **Releases** page and download `PixelPet-<version>-mac-universal.dmg` (or the `.zip`).
2. Drag **Pixel Pet** into Applications.
3. The app is **not signed or notarized** (no Apple developer certificate), so macOS will refuse the first launch. Either right-click the app and choose **Open**, or run:
   ```bash
   xattr -cr "/Applications/Pixel Pet.app"
   ```
4. Install the LobeHub CLI once, because the pet's brain runs through it: `npm install -g @lobehub/cli`. The app finds `lh` itself even when launched from Finder (Homebrew, nvm, fnm, volta and similar locations are searched).

To cut a release: `git tag v0.1.1 && git push origin v0.1.1`. To build without releasing, run the workflow manually from the Actions tab; the files are kept as a run artifact. Locally on a Mac: `npm run dist:mac`.

## Download (Windows 10/11, x64)

The same Releases page has `PixelPet-<version>-win-x64-setup.exe` (installer) and `PixelPet-<version>-win-x64.zip` (unzip and run `Pixel Pet.exe`).

1. The app is **not code-signed**, so Windows SmartScreen will warn: click **More info → Run anyway**.
2. Install Node.js and the LobeHub CLI (`npm install -g @lobehub/cli`); `lh --version` must work in a terminal.
3. On Windows `lh` is a `.cmd` shim, which Node cannot start without a shell, and a shell would be a command-injection risk for the pet's prompt text. The app therefore reads the shim, finds the JS entry it launches, and runs that directly with its own Electron binary (`ELECTRON_RUN_AS_NODE`), with no shell involved.
4. **Status:** the Windows build is produced by CI and its contents were inspected, but it has not been run on a real Windows machine by the author. The launch logic is covered by unit tests only.

## Run from source

Requires Node 20+, the [LobeHub CLI](https://www.npmjs.com/package/@lobehub/cli) (`lh`) on `PATH`, and a desktop session.

```bash
npm install
npm start
```

## How it is built

```
Electron renderer (canvas sprites, UI)  ⇄ preload IPC ⇄  PetService  ⇄  Responses API + local tools
                                                         ├─ LhClient   login and agent management
                                                         ├─ pet-state   needs, growth, sleep (pure, tested)
                                                         ├─ persona     system role + per-message [状态] block
                                                         ├─ proactive   when to speak + hourly LLM budget
                                                         └─ store       ~/.config/pixel-pet/pet.json
```

- **Harness boundary** — `lh` handles login and agent management. `src/core/responses-client.js` sends conversations to `/api/v1/responses` and executes enabled local function calls. It reads the CLI's encrypted credentials after `lh whoami` refreshes them; this relies on the CLI's current private credential format. `LOBEHUB_CLI_API_KEY` can be used instead.
- **Memory** — each turn persists the Responses API response ID and resumes from it. Existing CLI topic history is not automatically imported into the new response chain.
- **Pet feel** (borrowed from the "大肥鱼" community pets): a persona prompt, a state block injected in every message so the pet reacts to how it actually feels, and proactive lines (hungry / bored / morning / evening greetings) with a cooldown and an hourly LLM-call budget. When the agent is unreachable or the budget is spent, the pet falls back to canned in-character lines, so it never goes silent.
- Care actions (feed / play / sleep / pat) are local and free; only chat and proactive lines call the agent.

Cost note: each agent call goes through the LobeHub workspace's agent runtime, which can attach a large default context (tens of thousands of input tokens in our runs). The budget in `src/core/proactive.js` (`maxLlmPerHour`, default 6) keeps unattended spending bounded.

## Test

```bash
npm test                              # unit tests (fake `lh`, no network)
xvfb-run -a node e2e/run.js all       # drives the real Electron app; `live` uses your real `lh` login
```

`e2e/run.js live` creates a real agent in your LobeHub workspace and deletes it again at the end (also on failure). Screenshots land in `out/e2e/`.

## Known gaps

- The Responses API uses exclusive local tools; server-side built-in tools such as web search are not currently enabled.
- The macOS build is unsigned and has only been built by CI, not opened on a real Mac by the author. Linux and Windows builds are not set up.
- The real `lh login` browser flow has not been exercised end to end: tests use a fake `lh` that prints the same lines the real CLI does (read from the CLI source).
- Transparent / always-on-top / drag behaviour on a real desktop has not been visually verified (tests run under Xvfb with an opaque window).
- Pet needs only persist locally; "Release" optionally deletes the LobeHub agent too.

## Credits

The **大肥鱼 (Dafeiyu)** animations (`src/renderer/assets/dafeiyu/`) come from the open-source project **dsh-pet** by PC2005-cloud: <https://github.com/PC2005-cloud/dsh-pet>.

- The code of dsh-pet is MIT-licensed. Its assets are free for open-source use but **may not be used commercially**.
- The character is a community re-creation of DeepSeek's "大肥鱼" (not an official DeepSeek image), licensed **CC BY-NC-SA 4.0**. The prototype "溟月" is by Bilibili @上善无形; the DeepSeek maid-whale design is by Bilibili @ZipZipPipe.
- Because of those terms, do not sell this app or ship it commercially while it includes these files. Remove `src/renderer/assets/dafeiyu/` and the `dafeiyu` entry in `src/core/species.js` first.

Full text: `src/renderer/assets/dafeiyu/NOTICE.md`.

## License

The code is MIT, see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The 大肥鱼 animations in `src/renderer/assets/dafeiyu/` are **not** MIT: they are non-commercial only (see [Credits](#credits)), so builds that include them are for non-commercial use.
