# Contributing

Thanks for helping with TabShell.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/tabshell/issues/new/choose) and use the template. For a bug, say which mode (Browser VM or Docker), which browser and version, what you did, what you expected and what happened.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set it up and run it. You need Node.js 20 or newer and Docker.

   ```sh
   npm ci
   ./scripts/build-tools.sh   # optional: spf, opencode, container from ../superfile, ../opencode, ../container
   npm run image      # builds the Alpine VM image into public/alpine/ (one time)
   docker build -t tabshell-ubuntu -f docker/Dockerfile .
   npm run build
   npm start          # http://localhost:8686
   ```

   For quick frontend work, `npm run dev` serves on http://localhost:8690 (Browser VM mode only).

3. Make your change. Keep commits small, each with a clear message.
4. Run the checks below and update the README if behaviour changed.
5. Open a pull request and fill in the template.

## Checks

```sh
npm test
npm run build
```

`npm test` checks the local server's protections: Host and Origin checks, no CORS headers, no path traversal.
