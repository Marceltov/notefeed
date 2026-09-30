# notefeed

Post markdown notes to a [notefeed](https://github.com/Marceltov/notefeed) server from Python or the command line. No dependencies.

```sh
pip install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_TOKEN=...
notefeed post "# Backup finished"
backup.sh 2>&1 | notefeed post -
```

```python
from notefeed import Client

client = Client("https://notes.example.com", token)  # URL and token set once
print(client.post("# Deploy done\nversion 1.4.2").url)
```

The `notefeed` command reads `--url` / `--token`, or `NOTEFEED_URL` / `NOTEFEED_TOKEN`. The library itself never reads the environment.

Full documentation: https://notefeed.marceltov.de/clients/
