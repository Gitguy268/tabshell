# Full 64-bit Ubuntu for TabShell's Docker mode. ttyd serves the shell over a WebSocket.
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color

# Homebrew's documented prerequisites, plus ttyd and sudo. tzdata is here so later installs never stop to ask for a time zone. Python and brew are left for the user to install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ttyd sudo build-essential procps curl file git ca-certificates nano less tzdata podman \
 && rm -rf /var/lib/apt/lists/*

# Homebrew refuses to run as root, so the shell runs as "dev" with passwordless sudo.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -s /bin/bash -u 1000 dev \
 && echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev \
 && printf '\nWelcome to TabShell (Ubuntu 26.04 in Docker).\n  sudo apt install python3\n  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n  spf\n  opencode\n  container run --rm alpine echo hi\n\n' > /etc/motd \
 && echo 'cat /etc/motd' >> /home/dev/.bashrc

# Podman behind the `container` command. Rootless podman can't mount /proc in an apple/container VM, so `container`
# runs it as root through sudo; /proc/sys is read-only there, so containers share the machine's network and skip cgroups.
RUN mkdir -p /etc/containers/registries.conf.d \
 && printf 'unqualified-search-registries = ["docker.io"]\nshort-name-mode = "permissive"\n' > /etc/containers/registries.conf.d/tabshell.conf \
 && printf '[containers]\nnetns = "host"\ncgroups = "disabled"\n\n[engine]\nevents_logger = "file"\n' > /etc/containers/containers.conf \
 && mkdir -p /usr/local/libexec && printf '#!/bin/sh\nexec sudo podman "$@"\n' > /usr/local/libexec/podman-root && chmod +x /usr/local/libexec/podman-root
ENV CONTAINER_PODMAN=/usr/local/libexec/podman-root

# spf (superfile), opencode and container, built from sibling checkouts by scripts/build-tools.sh; empty when they aren't there.
COPY tools/ubuntu/ /usr/local/bin/
RUN for t in spf opencode container; do [ -x /usr/local/bin/$t ] || sed -i "/^  $t\b/d" /etc/motd; done

USER dev
WORKDIR /home/dev
# TOKEN is set per container by server.mjs; ttyd rejects WebSocket clients that don't send it.
CMD ["sh", "-c", "exec ttyd -W -p 7681 -c \"dev:$TOKEN\" bash -l"]
