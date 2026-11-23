#!/usr/bin/env python3
"""Cost of one safe-settings full sync, in calls charged to the App installation's primary
quota (every request except 304 Not Modified), today (2.1.18-tomtom-rc.9) and after the five
cuts of the cron-sync design.

Usage: tickmodel.py <coverage.json> <rates.json> [--warm-config] [--scheduled]
  coverage.json  coverage.js output: per-plugin repo counts, resolved with safe-settings' own
                 Settings code from the org's config and repo listing
  rates.json     data-dependent rates per sync, measured from logs (keys below)
  --warm-config  suborg/repo files answer 304 (in-process cron on a long-lived pod)
  --scheduled    after the change, a scheduled run posts no check run

Per-repo call counts follow the code paths of rc.9. The dev tick of 2026-11-23 12:00Z
(pod frz7c, 1,402 request lines) reproduces exactly: see check_dev().
"""
import json
import math
import sys


def terms(c, r, warm=False, scheduled=False, after=False):
    """Return [(name, kind, calls)] for one full run. kind: read | write | free | app."""
    A = c['active']
    p, ap = c['plugins'], c.get('archivedPlugins', {})
    T = p.get('teams', 0) + ap.get('teams', 0)               # teams syncs (active + archived)
    Ca = ap.get('collaborators', 0)                         # archived repos still read collaborators
    B = c['branchEntries']
    out = [
        ('repo listing, 100/page', 'read', math.ceil(c['repos'] / 100)),
        ('config: settings.yml, 2 dirs, tree', 'read', 4),
        ('config: suborg + repo files', 'free' if warm else 'read', c['suborgFiles'] + c['repoFiles']),
        ('org rulesets: list + one per ruleset', 'read', 1 + r['org_rulesets']),
        ('GET repo', 'read', (1 if after else 3) * A + (0 if after else p.get('labels', 0))),  # cut (e)
        ('GET protection, per protected branch', 'read', B),
        ('PUT protection', 'write', r.get('real_prot_put', 0) if after else round(r['prot_put'] * B)),  # cut (a)
        ('GET vulnerability-alerts', 'read', A if after else 0),                         # cut (b)
        ('PUT vulnerability-alerts', 'write', r.get('real_vuln_put', 0) if after else A),
        ('GET teams (+ extra pages)', 'read', round(T * (1 + r['teams_pages']))),
        ('GET security-managers', 'read', 1 if after else T),                            # cut (e)
        ('GET team repo grants, per candidate team', 'read', r['grant_list_pages'] if after else 0),  # cut (c)
        ('DELETE team grant (org-role ghosts + real)', 'write',
         r['real_team_delete'] if after else r['ghost_team_delete'] + r['real_team_delete']),
        ('GET team by name before PUT', 'read', r['team_put_per_run']),
        ('PUT team grant', 'write', r['team_put_per_run']),
        ('GET autolinks', 'read', p.get('autolinks', 0)),
        ('GET topics (validator)', 'read', p.get('validator', 0)),
        ('GET labels', 'read', p.get('labels', 0)),
        ('GET collaborators + invitations', 'read', 2 * (p.get('collaborators', 0) + Ca)),
        ('GET membership, per distinct user (active + archived)', 'read', c.get('collabUsersAll', c['collabUsers']) if (p.get('collaborators') or Ca) else 0),
        ('PUT collaborator on archived repo (403)', 'write', 0 if after else r['archived_collab_put']),  # cut (d): no PUT there
        ('rulesets: list + one per ruleset', 'read', p.get('rulesets', 0) + r.get('repo_rulesets', c['rulesetEntries'])),
        ('ruleset writes', 'write', round(r['ruleset_writes'] * p.get('rulesets', 0))),
        ('environments: list + 3 per env', 'read', p.get('environments', 0) + 3 * c['envEntries']),
        ('other writes (real drift: repo PATCH, labels, topics, autolinks)', 'write', r['other_writes_per_run']),
        ('check run: GET commits', 'read', 0 if (after and scheduled) else 1),
        ('check run: POST', 'write', 0 if (after and scheduled) else 1),
        ('App JWT: installations + token', 'app', 2),
    ]
    return out


def totals(t):
    s = {'read': 0, 'write': 0, 'free': 0, 'app': 0}
    for _, k, n in t:
        s[k] += n
    s['charged'] = s['read'] + s['write']
    return s


def show(title, t):
    s = totals(t)
    print(f'\n== {title}')
    for name, k, n in t:
        if n:
            print(f'  {k:5s} {n:7,d}  {name}')
    print(f"  reads {s['read']:,}  writes {s['write']:,}  charged {s['charged']:,}  (304s {s['free']:,}, App-JWT {s['app']})")
    return s


def hours_under_floor(charged, budget=15000, floor=5000, webhooks=244):
    """Windows needed when the run may spend down to `floor`, while webhooks use `webhooks`/h."""
    return charged / (budget - floor - webhooks)


def check_dev(cov, rates):
    """Dev tick 2026-11-23 12:00Z, pod frz7c: 975 reads (19 of them 304) + 427 writes."""
    t = terms(cov, rates, warm=True)
    s = totals(t)
    got = (s['read'] + s['free'] + 1, s['write'] + 1)  # +1/+1: the App-JWT GET and POST appear as request lines
    print(f'\n== dev check: model reads+304+jwt={got[0]} (measured 975), writes+jwt={got[1]} (measured 427)')
    return got == (975, 427)


if __name__ == '__main__':
    cov = json.load(open(sys.argv[1]))
    rates = json.load(open(sys.argv[2]))
    warm = '--warm-config' in sys.argv
    scheduled = '--scheduled' in sys.argv
    if rates.get('name') == 'dev':
        ok = check_dev(cov, rates)
        print('dev check', 'PASS' if ok else 'FAIL')
    today = show(f"{cov['org']} today (rc.9), {'warm' if warm else 'cold'} config", terms(cov, rates, warm))
    after = show(f"{cov['org']} after the five cuts{', scheduled run' if scheduled else ''}", terms(cov, rates, warm, scheduled, after=True))
    for name, s in (('today', today), ('after', after)):
        print(f"  {name}: {s['charged']:,} charged -> {hours_under_floor(s['charged']):.1f} h of 10k-per-hour windows; "
              f"writes alone take >= {s['write'] / 3600:.1f} h at 1 write/s")
