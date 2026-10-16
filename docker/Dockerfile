# Full 64-bit Ubuntu for TabShell's Docker mode. ttyd serves the shell over a WebSocket.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color

# Homebrew's documented prerequisites, plus ttyd and sudo. tzdata is here so later installs never stop to ask for a time zone. Python and brew are left for the user to install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ttyd sudo build-essential procps curl file git ca-certificates nano less tzdata \
 && rm -rf /var/lib/apt/lists/*

# Homebrew refuses to run as root, so the shell runs as "dev" with passwordless sudo.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -s /bin/bash -u 1000 dev \
 && echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev \
 && printf '\nWelcome to TabShell (Ubuntu 24.04 in Docker).\n  sudo apt install python3\n  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\n' > /etc/motd \
 && echo 'cat /etc/motd' >> /home/dev/.bashrc

USER dev
WORKDIR /home/dev
# TOKEN is set per container by server.mjs; ttyd rejects WebSocket clients that don't send it.
CMD ["sh", "-c", "exec ttyd -W -p 7681 -c \"dev:$TOKEN\" bash -l"]
