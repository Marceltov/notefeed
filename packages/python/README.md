# notefeed

Post and read markdown notes on a [notefeed](https://github.com/Marceltov/notefeed) server from Python or the command line. Python 3.11 or newer.

```sh
pip install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "# Backup finished"
backup.sh 2>&1 | notefeed post -
notefeed notes --limit 5
```

```python
from notefeed import Client

client = Client("https://notes.example.com", feed="homelab-7f3k2q9x4m8wz")  # password="..." if the instance has one
created = client.post("# Deploy done\nversion 1.4.2")
print(created.url, created.read_url)
for note in client.notes():  # newest first, page by page
    print(note.created_at, note.title)
```

`Client.from_env()` reads `NOTEFEED_URL` / `NOTEFEED_FEED` / `NOTEFEED_PASSWORD`; so does the `notefeed` command, unless given `--url` / `--feed` / `--password`.

Full documentation: https://docs.notefeed.me/clients/
