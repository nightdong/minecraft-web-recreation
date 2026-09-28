# Contributing

Thanks for helping improve this project.

## Development

Requirements:

- Node.js 24 or a compatible current Node.js release
- npm

Install and run:

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm test
npm run build
```

For the full browser verification suite:

```bash
npm run verify
```

## Project constraints

- Do not add Minecraft/Mojang/Microsoft proprietary textures, audio, source code, or other copyrighted game assets.
- Keep gameplay state in the existing Game/World/Player/EntitySystem architecture rather than introducing test-only state paths.
- Preserve the 20 Hz fixed-step simulation model unless a change has strong regression coverage.
- New performance claims should include measurements; do not reduce default quality silently to manufacture better numbers.
- Add or update regression tests for gameplay, persistence, rendering, or input bugs.

## Pull requests

Keep changes focused, explain user-visible behavior, and include the commands you ran to verify the change.
