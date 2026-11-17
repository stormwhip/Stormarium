#!/bin/sh
# Forced-command SSH entrypoint; install root-owned and non-writable.
set -eu
/usr/bin/sudo -n /usr/bin/systemctl start stormarium-sync.service
version=$(/usr/bin/cat /www/wwwroot/stormwhip.com/stormarium-version.txt)
/usr/bin/printf '%s\n' "$version" | /usr/bin/grep -Eq '^[0-9a-f]{40}$'
/usr/bin/printf 'STORMARIUM_DEPLOYED_SHA=%s\n' "$version"
