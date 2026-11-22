# TabShell: when a command isn't found in bash or zsh, the page offers a corrected command to run.
# The typed words go to the page as base64 in OSC 7777; nothing leaves the page.
__tabshell_assist() {
  [ -t 2 ] && printf '\033]7777;assist;%s\007' "$(printf '%s' "$*" | base64 | tr -d '\n')" >&2
}
command_not_found_handle() {
  __tabshell_assist "$@"
  printf '%s: command not found\n' "$1" >&2
  return 127
}
command_not_found_handler() { command_not_found_handle "$@"; }
