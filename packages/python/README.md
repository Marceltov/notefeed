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

note = Client().post("# Deploy done\nversion 1.4.2")  # reads NOTEFEED_URL / NOTEFEED_TOKEN
print(note.url)
```

Full documentation: https://marceltov.github.io/notefeed/clients/
