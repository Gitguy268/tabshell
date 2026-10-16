# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/tabshell/security/advisories/new>

Include what you found, how to reproduce it, and the browser, OS and mode (Browser VM or Docker) you used. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

The most useful reports are about:

- a way for another website to reach the local server (`server.mjs`), the WebSocket proxy or the ttyd port, and so get a shell in the Docker container;
- a way out of the Docker container or the v86 VM into your computer;
- the container or server being reachable from other machines on the network;
- the GitHub Actions workflows in this repository.

Anything you run inside the VM or the container is yours to run; that alone is not a vulnerability. The Browser VM's traffic goes through a public relay by default, as the README and the Network panel say.

## Supported versions

Only the latest version on the `main` branch is supported.
