# TabShell's zsh setup: history, completion, a prompt like the other shells, fish-like suggestions and colours.
HISTFILE=~/.zsh_history HISTSIZE=5000 SAVEHIST=5000
setopt share_history hist_ignore_dups interactive_comments
autoload -Uz compinit && compinit -u -d ~/.zcompdump
zstyle ':completion:*' menu select
bindkey -e
PROMPT='%F{green}%n@%m%f:%F{blue}%~%f%# '
. /etc/tabshell/hook.sh
for f in /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
         /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh; do
  [ -r "$f" ] && . "$f"
done
unset f
command -v zoxide >/dev/null && eval "$(zoxide init zsh)"
