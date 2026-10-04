# From a script

The [client libraries](../integrations/clients.md) handle the request, the password and the errors for you, and bring a `notefeed` command for shell scripts. Plain curl works everywhere else.

A backup job that reports how it went:

=== "notefeed command"

    ```sh
    #!/usr/bin/env bash
    set -euo pipefail
    # NOTEFEED_URL and NOTEFEED_FEED (and NOTEFEED_PASSWORD, if set) come from the environment.

    if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

    printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
      notefeed post - > /dev/null
    ```

=== "curl"

    ```sh
    #!/usr/bin/env bash
    set -euo pipefail

    if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

    printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
      curl -fsS -H "Content-Type: text/markdown" --data-binary @- https://notes.example.com/homelab-7f3k2q9x4m8wz > /dev/null
    ```

From a program, with the client libraries:

=== "Python"

    ```python
    import shutil
    from notefeed import Client

    client = Client("https://notes.example.com", feed="homelab-7f3k2q9x4m8wz")

    usage = shutil.disk_usage("/srv")
    used = usage.used / usage.total
    if used > 0.9:
        print(client.post(f"# Disk space low\n/srv is {used:.0%} full").url)
    ```

=== "Node"

    ```js
    import { statfs } from "node:fs/promises";
    import { Client } from "notefeed";

    const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2q9x4m8wz" });

    const fs = await statfs("/srv");
    const used = 1 - fs.bavail / fs.blocks;
    if (used > 0.9) console.log((await client.post(`# Disk space low\n/srv is ${Math.round(used * 100)}% full`)).url);
    ```
