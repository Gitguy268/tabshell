# Alpine i386 root filesystem for v86, adapted from v86's tools/docker/alpine.
FROM docker.io/i386/alpine:3.21.0

ENV KERNEL=virt

RUN apk add openrc alpine-base agetty alpine-conf linux-$KERNEL linux-firmware-none nodejs npm

# One autologin shell on the virtio console (hvc0); the page has no VGA screen or serial port.
RUN sed -i '/getty/d' /etc/inittab \
 && echo 'hvc0::respawn:/sbin/agetty --autologin root --noclear hvc0 xterm-256color' >> /etc/inittab \
 && echo "root:" | chpasswd \
 && echo "hostname=tabshell" > /etc/conf.d/hostname

# DHCP over the relay; udhcpc backgrounds itself, so boot does not hang without network.
RUN printf 'auto lo\niface lo inet loopback\n\nauto eth0\niface eth0 inet dhcp\n' > /etc/network/interfaces

RUN printf 'export LANG=C.UTF-8\nexport PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]# "\n' > /etc/profile.d/tabshell.sh \
 && printf '\nWelcome to TabShell (Alpine Linux in your browser).\n  apk add python3    install packages\n  snek               play Snake\n\n' > /etc/motd

# A restored VM resumes with the clock from when it was saved. Syncing once a minute fixes that;
# v86's network backends answer NTP, so this works with any relay.
RUN printf '#!/bin/sh\n(while :; do ntpd -nq -p pool.ntp.org >/dev/null 2>&1; sleep 60; done) &\n' > /etc/local.d/clock.start \
 && chmod +x /etc/local.d/clock.start

# taniarascia/snek, preinstalled so it works without network.
# The published package has no "bin" entry, so add the command ourselves.
RUN npm install -g snekjs@1.0.4 && npm cache clean --force \
 && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/snekjs/play.js "$@"\n' > /usr/local/bin/snek && chmod +x /usr/local/bin/snek

# https://wiki.alpinelinux.org/wiki/Alpine_Linux_in_a_chroot#Preparing_init_services
RUN for i in devfs dmesg mdev hwdrivers; do rc-update add $i sysinit; done \
 && for i in hwclock modules sysctl hostname syslog bootmisc; do rc-update add $i boot; done \
 && rc-update add networking default \
 && rc-update add local default \
 && rc-update add killprocs shutdown

# Generate initramfs with 9p modules
RUN mkinitfs -F "base virtio 9p" $(cat /usr/share/kernel/$KERNEL/kernel.release)
