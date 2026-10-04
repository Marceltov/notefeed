---
status: accepted
date: 2026-10-04
decision-makers: Marcel Bruckner
---

# Metrics: a Prometheus endpoint on the app's port, with prom-client

## Context and Problem Statement

Nobody knows how long feed reads take on a real instance, so #96 (a folder listing per note, the tag filter reading every note), the in-memory note index (ADR 0004) and a different storage backend (#93) cannot be weighed. Issue #116 asks to measure first and decide later. The operator already runs Grafana, Prometheus and InfluxDB.

## Considered Options

* A `/metrics` route on the app's port, off by default, with an optional bearer token, written with `prom-client`.
* The same with the text format written by hand (no dependency).
* A separate port that is not published.
* Timings in the log, read by a pipeline.

## Decision Outcome

Chosen option: the first. The Prometheus text format serves Prometheus and Grafana directly and InfluxDB through Telegraf's `prometheus` input, so one endpoint serves all three. `prom-client` brings correct histograms and the default process and event-loop metrics for one dependency (two small ones of its own); it is listed in `serverExternalPackages` like `pino`, so every route bundle shares one module instance and the standalone build traces it.

* **Off by default.** `NOTEFEED_METRICS=1` turns it on; off, `/metrics` is a `404` and nothing is measured. `metrics` is a reserved feed name, because `/metrics` and `/<feed>` share a path shape.
* **Access.** `NOTEFEED_METRICS_TOKEN` makes it need `Authorization: Bearer`; without one it is open and the start-up log warns. The operator's reverse proxy can keep it private instead.
* **Labels are closed sets:** route kind (an operation id, never client input), status class and feed-size bucket. No feed name, read id, text or address is ever a label or value, so the series count does not grow with traffic or feeds.
* **Where time is taken.** A request is measured around the dispatcher, the RSS and file routes, and the feed page's data load (server time to read the notes, not streaming). The data layer reports its directory and file reads and the feed's size to a per-request `AsyncLocalStorage` scope.
* **Persistence.** The counters live in memory and restart at 0; Prometheus keeps the history.

### Consequences

* Good, because the measurements that decide #96, #93 and the index come from real use, with the cost of the tag filter and of reading a note's folder visible per request.
* Good, because nothing runs while it is off.
* Bad, because there is a new dependency, and `prom-client` must stay in `serverExternalPackages`.
* Bad, because a feed already named `metrics` is no longer reachable by name.
* Bad, because the read pages, `/mcp` and sign-in are not measured.
