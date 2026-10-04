# Metrics

With `NOTEFEED_METRICS=1`, `GET /metrics` serves how long requests take, in the Prometheus text format ([Configuration](configuration.md) has the token setting; with a token, send `Authorization: Bearer <token>`). It exists to answer one question with data: is reading a feed slow enough to be worth an index or another storage? Off by default; nothing is measured while it is off. `metrics` is a reserved feed name.

The counters live in the app's memory and start at 0 again when the container restarts. That is what Prometheus expects: it keeps the history and treats a drop as a reset, so always query with `rate()` or `increase()`, never the raw values.

| Metric | What it shows |
|---|---|
| `notefeed_request_duration_seconds` | A histogram of the time a request took, by `kind`, `status` (`2xx`, `4xx`, `5xx`; a redirect counts as `2xx`) and `feed_size` (the notes of the feed it ran against: `lt10`, `lt100`, `lt1000`, `gte1000`, or `none` for a request that reads no feed). |
| `notefeed_request_dir_reads`, `notefeed_request_file_reads` | Histograms of the directory reads and file reads one request made, by `kind` and `feed_size`. Reading a note lists its feed's folder again, so these grow with the feed: they show the cost behind [#96](https://github.com/Marceltov/notefeed/issues/96) directly. |
| `notefeed_parse_duration_seconds`, `notefeed_parse_timeouts_total`, `notefeed_parse_waiting` | The worker that reads a text posted with pictures: how long reading took, how many texts were refused for time (`NOTEFEED_PARSE_TIMEOUT_MS`), and how many wait for a free worker now. |
| `notefeed_nodejs_eventloop_lag_*` | The event-loop lag: a stall of the main thread shows here. |
| `notefeed_process_*`, `notefeed_nodejs_*` | Node's default process metrics: memory, CPU, open handles, garbage collection. |

`kind` is a fixed name, never anything a client sent: the API's operation id (`listNotes`, `getNote`, `postNote`, `editNote`, and so on, as in the [API](../integrations/api.md)), `<operation>_tag` for a listing filtered by `tag` (it reads every note until it has enough), `rss` for the feed's RSS, `feed_file` for a file of a feed, and `feed_page` and `feed_page_tag` for the feed's web page. Posting with pictures is `postNote` like any other post. Requests to an unknown path or with a wrong method, `/mcp`, sign-in and the read pages are not measured.

`feed_page` is the server's time to read the feed's notes for the page, not the time to send it: network and streaming are not in it, which is what you want to decide on storage. A page with a `tag` filter counts twice: the filtered read is `feed_page_tag`, and the page's title is read unfiltered, which is one `feed_page` sample, so `feed_page` counts include those views.

A feed that was already named `metrics` can no longer be opened by name, because `/metrics` is the scrape route. The start-up log names such a folder (`a feed folder is named like one of notefeed's routes`); rename it in `DATA_DIR` and restart.

No feed name, read id, note text, title, sender or address is ever a label or a value, so the number of series stays small whatever the traffic or the number of feeds.

## What counts as a problem

A rule of thumb to start from: the 95th percentile of `feed_page` over 200 ms for feeds under 1000 notes (`feed_size` below `gte1000`) means the reading of notes (#96) or an in-memory index is worth doing. A rising number of directory and file reads per request for `listNotes_tag` shows the tag filter reading the whole feed. Look at `rate()`s over a few days of real use before deciding.

## Scraping

Prometheus:

```yaml
scrape_configs:
  - job_name: notefeed
    metrics_path: /metrics
    authorization:
      credentials: <the value of NOTEFEED_METRICS_TOKEN>   # leave out without a token
    static_configs:
      - targets: ["notefeed:3000"]
```

InfluxDB takes the same endpoint through Telegraf:

```toml
[[inputs.prometheus]]
  urls = ["http://notefeed:3000/metrics"]
  http_headers = { "Authorization" = "Bearer <the value of NOTEFEED_METRICS_TOKEN>" }
  metric_version = 2
```

A starter Grafana dashboard (import it, pick the Prometheus data source): [grafana-notefeed.json](../assets/grafana-notefeed.json).

## Setup with Prometheus and Grafana

The steps to get from the endpoint to the dashboard, as they run on a Docker host with Prometheus and Grafana on their own containers:

1. Set `NOTEFEED_METRICS=1` and a `NOTEFEED_METRICS_TOKEN` in notefeed's environment and restart it. `curl -H "Authorization: Bearer <token>" http://<host>:3000/metrics` should print `notefeed_` lines.
2. Add the `notefeed` job above to Prometheus. Keep the token out of the config file in git: `authorization: { credentials_file: <path> }` reads it from a file that stays on the host (mount it into the Prometheus container read-only; a mount of a file that does not exist yet makes Docker create a folder, so create the file first). Reload Prometheus and check that the target is `up` under Status, Targets.
3. Provision the dashboard from [grafana-notefeed.json](../assets/grafana-notefeed.json). Imported by hand, Grafana asks for the data source. Provisioned from a file, replace `${DS_PROMETHEUS}` with the uid of your Prometheus data source and delete the `__inputs` block, since provisioning does not fill inputs in.
4. Give it a few days of real use before reading it; the counters start at 0 on every restart, which `rate()` handles.

Reading the panels:

- **feed_page p95 by feed size**: the panel the decision rests on. Over 200 ms for `feed_size` below `gte1000` is the sign that [#96](https://github.com/Marceltov/notefeed/issues/96) or an index is worth doing.
- **Requests per second by kind**: what the instance is used for; a `_tag` kind with traffic is the tag filter reading whole feeds.
- **Directory and file reads per request**: the cost behind the latency. Flat across `feed_size` means reading does not grow with the feed; rising with it is what #96 describes.
- **Texts refused for time and waiting**: anything above 0 for refused texts means a post with pictures hit `NOTEFEED_PARSE_TIMEOUT_MS`; waiting above 0 for long means the worker is the bottleneck.
- **Event-loop lag and memory**: a lag that spikes together with a slow `feed_page` points at the main thread rather than the disk.

An alert is not part of the dashboard. If you want one, start from the rule of thumb above and from the target being down (`up{job="notefeed"} == 0`). Its panels are the 95th percentile of `feed_page` by feed size, requests per second by kind, directory and file reads per request, texts refused for time and waiting, event-loop lag and memory.
