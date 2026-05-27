# Cost Control — Beta Idle Mode

NeoApex on Fly.io was originally tuned for "always-warm" production traffic.
For beta testing — where the platform sits idle for days at a time — we
want every machine to scale to zero when no one is using it.

This doc explains what we changed, how to verify it, and how to bring the
fleet back online when you want to test.

## Summary of changes

| App | Before | After | Effect |
|---|---|---|---|
| `papermite-api` | `min_machines_running = 1` on `[http_service]`; no auto-stop on internal `[[services]]` | `min_machines_running = 0` on both; `auto_stop_machines` on the internal service | 4gb / 2-CPU machine suspends when idle (~$31/mo → ~$0) |
| `launchpad-api` | `min_machines_running = 1` | `min_machines_running = 0` | 512mb machine suspends when idle |
| `datacore` | No auto-stop on its TCP `[[services]]` block (ran 24/7) | `auto_stop_machines = "suspend"` + `min_machines_running = 0` | Suspends when no sibling app is calling it; wakes on next `datacore.flycast:5800` request |
| `admindash-api` | Already `min_machines_running = 0` | unchanged | No change needed — already scaled to zero |

Estimated idle savings: **~$35–40/month** in compute. See "Residual idle costs"
below for what we did not eliminate.

## How auto-stop works on Fly

- `auto_stop_machines = "suspend"` — machine RAM is checkpointed to disk;
  wake is fast (~hundreds of ms). Costs a small amount of disk while suspended.
- `auto_stop_machines = "stop"` — full shutdown. No suspend-disk cost but
  cold start is several seconds longer.
- `auto_start_machines = true` — Fly's proxy will boot the machine on the
  next incoming request. This works for `[http_service]` AND `[[services]]`
  blocks reached via `<app>.flycast`.
- `min_machines_running = 0` — Fly is allowed to stop the last machine.
  With `1`, at least one machine stays warm regardless.

We chose `suspend` because beta testing flows are interactive and a couple
of seconds of cold start is more disruptive than the tiny suspend-disk fee.

## Cold start expectations

| App | First request after idle |
|---|---|
| `launchpad-api` | ~2–3s |
| `admindash-api` | ~2–3s (FastAPI cold start) |
| `papermite-api` | ~5–8s (4gb machine + docling/libmagic warmup) |
| `datacore` | ~3–5s + LanceDB load (depends on table count) |

Cold-start chains compound. A user clicking "Upload" in admindash from
fully-cold cold may trigger: admindash wake → datacore wake → papermite wake
in sequence. Worst-case first request after a week of idle: ~15–20s.
Subsequent requests are normal latency until idle again.

## Bringing the fleet back online for a testing session

You generally do not need to. The next user request will wake everything via
`auto_start_machines`. If you want to pre-warm to avoid making testers see
cold-start latency:

```bash
# Wake every public app (a single curl is enough — Fly's proxy starts the machine on the first request)
curl -sI https://api.launchpad.floatify.com/api/health
curl -sI https://api.papermite.floatify.com/api/health
curl -sI https://api.admin.floatify.com/api/health

# datacore is private — wake it by calling it from a sibling app, or:
fly machine start -a datacore <machine-id>   # find the id with `fly machine list -a datacore`
```

Status check:

```bash
fly status -a datacore
fly status -a launchpad-api
fly status -a papermite-api
fly status -a admindash-api
```

A machine in `state: started` is warm. `stopped` or `suspended` is idle.

## If you want to force everything OFF (deepest idle)

```bash
fly scale count 0 -a datacore
fly scale count 0 -a launchpad-api
fly scale count 0 -a papermite-api
fly scale count 0 -a admindash-api
```

This guarantees zero compute charges and disables `auto_start_machines` —
the next request will 503 until you scale back up:

```bash
fly scale count 1 -a datacore
fly scale count 1 -a launchpad-api
fly scale count 1 -a papermite-api
fly scale count 1 -a admindash-api
```

Use this only if you are going weeks without testing and want to avoid
even the (small) suspend-disk fee. Auto-stop covers the normal case.

## Deploying the changes

These config edits are picked up on the next `fly deploy`. The repo's release
pipeline (see `release-runbook.md`) handles deploys, but you can also deploy
the config-only changes directly:

```bash
fly deploy -a datacore       --config datacore/fly.toml      --remote-only
fly deploy -a launchpad-api  --config launchpad/fly.toml     --remote-only
fly deploy -a papermite-api  --config papermite/fly.toml     --remote-only
```

(`admindash-api` was not changed, so no deploy needed.)

## Residual idle costs we did not eliminate

Even with everything suspended, the following keep accruing:

- **`datacore_data` volume (3gb)** — ~$0.45/mo. Required to preserve LanceDB
  data between sessions. Snapshot retention is 7 daily snapshots, small.
- **Dedicated IPv4 addresses on the 3 public apps** — Fly charges ~$2/mo
  for each *dedicated* IPv4. As of 2026-05-27 our fleet uses **shared
  IPv4 + dedicated IPv6** on `launchpad-api`, `papermite-api`, and
  `admindash-api`. Dedicated IPv6 is free, so we are not paying for IPs.

  If a future change moves an app to dedicated IPv4 (e.g. allocated via
  `fly ips allocate-v4 -a <app>`), release it with:

  ```bash
  fly ips list -a <app>                    # confirm `public ingress (dedicated)` on a v4 entry
  fly ips release <address> -a <app>       # only safe with Cloudflare in front
  ```

Total residual idle cost after all changes: **~$0.50–1/month** (volume +
snapshots only).

## Reverting

If beta load picks up and cold starts become unacceptable, restore warm
machines per app by changing `min_machines_running = 0` back to `1` in the
relevant `fly.toml` and redeploying. The `auto_stop_machines` settings can
stay — they only kick in when there is no traffic, so warming `min_machines_running`
back up is sufficient.
