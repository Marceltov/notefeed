#!/bin/sh
# Run notefeed as the owner of /data, so notes on a bind mount belong to the host user
# (e.g. to commit them with git). PUID/PGID override that. A root-owned /data (Docker
# created the bind-mount folder) falls back to uid/gid 1000. Only /data itself is chowned,
# never the files in it.
set -e
if [ "$(id -u)" != 0 ]; then
  exec "$@" # started with `user:`, nothing to switch
fi
uid=${PUID:-$(stat -c %u /data)}
gid=${PGID:-$(stat -c %g /data)}
if [ "$uid" = 0 ]; then uid=1000; fi
if [ "$gid" = 0 ]; then gid=1000; fi
[ "$(stat -c %u:%g /data)" = "$uid:$gid" ] || chown "$uid:$gid" /data
exec su-exec "$uid:$gid" "$@"
