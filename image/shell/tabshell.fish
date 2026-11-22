# TabShell's fish setup (/etc/fish/conf.d). oh-my-fish loads from the user's own config.
if status is-interactive
    set -g fish_greeting ""
    command -q zoxide; and zoxide init fish | source
end

# When a command isn't found, the page offers a corrected command (OSC 7777, base64 of the typed words).
function fish_command_not_found
    if isatty stderr
        printf '\e]7777;assist;%s\a' (string join ' ' -- $argv | base64 | string join '') >&2
    end
    __fish_default_command_not_found_handler $argv
end
