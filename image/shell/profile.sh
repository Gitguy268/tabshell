# TabShell: sourced by sh and bash login shells (/etc/profile.d).
# The first login shell of a session tells the page it's ready, so the page can start the shell picked in
# its Shell menu (it sends `exec zsh -l`). OSC 7777 is a private sequence; other terminals ignore it.
if [ -z "$TABSHELL_READY" ] && [ -t 1 ]; then
  export TABSHELL_READY=1
  if [ -n "$BASH_VERSION" ]; then printf '\033]7777;ready;bash\007'; else printf '\033]7777;ready;sh\007'; fi
fi
# Login bash doesn't read the bashrc files, so it gets the command-not-found hook here.
[ -n "$BASH_VERSION" ] && . /etc/tabshell/hook.sh
