// Which plugins apply to each repo in a full sync, resolved with safe-settings' own Settings code
// (suborg precedence, repo overrides, include/exclude, restricted repos, archived handling).
// Usage: node coverage.js <cfg-dir containing .github> <repos.tsv: name\tarchived> <app dir> <org>
// GHOST_TEAMS=a,b (optional): also count, per team, the teams-synced repos whose config grants it.
// Inputs are private (admin config checkout, repo list from GET /orgs/{org}/repos); only the counts go in inputs/.
// Prints a JSON summary: per-plugin repo counts for active repos and for archived repos that still sync.
const fs = require('fs')
const path = require('path')
const [cfgDir, reposTsv, appDir, org] = process.argv.slice(2)
const Settings = require(path.join(appDir, 'lib/settings'))
const yaml = require(path.join(appDir, 'node_modules/js-yaml'))

const gh = path.join(cfgDir, '.github')
const b64 = s => Buffer.from(s).toString('base64')
const fakeGithub = {
  repos: {
    getContent: async ({ path: p }) => {
      const full = path.join(cfgDir, p)
      if (fs.statSync(full).isDirectory()) {
        return { data: fs.readdirSync(full).map(name => ({ name, path: path.posix.join(p, name), type: fs.statSync(path.join(full, name)).isDirectory() ? 'dir' : 'file', sha: 'sha-' + name })) }
      }
      return { data: { content: b64(fs.readFileSync(full, 'utf8')) }, headers: { etag: 'x' } }
    }
  },
  git: {
    getTree: async () => ({ data: { truncated: false, tree: fs.readdirSync(path.join(gh, 'repos')).map(f => ({ path: f })) } })
  }
}
const quiet = { debug () {}, info () {}, warn () {}, error () {}, trace () {} }
const ctx = { payload: { installation: { id: 1 } }, octokit: fakeGithub, log: quiet, repo: () => ({ owner: org, repo: 'admin' }) }
const runtime = yaml.load(fs.readFileSync(path.join(gh, 'settings.yml'), 'utf8')) || {}
const config = Object.assign({ restrictedRepos: { exclude: ['.github', 'safe-settings'] } }, runtime)

;(async () => {
  Settings.fileCache = {}
  const s = new Settings(false, ctx, { owner: org, repo: 'admin' }, config)
  await s.loadConfigs()
  const repos = fs.readFileSync(reposTsv, 'utf8').trim().split('\n').map(l => l.split('\t')).map(([name, archived]) => ({ name, archived: archived === 'true' }))
  const ghosts = (process.env.GHOST_TEAMS || '').split(',').filter(Boolean)
  const archivedUsers = new Set() // users configured on archived repos; the members-only check reads each distinct user once per run
  const res = { teamListed: {}, teamsSynced: 0, org, repos: repos.length, restricted: 0, active: 0, archived: 0, archivedSynced: 0, activeWithSuborg: 0, activeWithRepoFile: 0, plugins: {}, archivedPlugins: {}, branchEntries: 0, rulesetEntries: 0, envEntries: 0, collabEntries: 0, archivedCollabEntries: 0, collabUsers: new Set(), validationErrors: 0 }
  for (const r of repos) {
    if (s.isRestricted(r.name)) { res.restricted++; continue }
    let plugins
    try {
      plugins = s.childPluginsList({ owner: org, repo: r.name })
    } catch (e) { res.validationErrors++; plugins = [] }
    const names = plugins.map(([P]) => Object.keys(Settings.PLUGINS).find(k => Settings.PLUGINS[k] === P))
    if (r.archived) {
      res.archived++
      // rc.9: archived repos sync only teams/collaborators, and only when the effective config has them
      const access = plugins.filter(([P]) => P === Settings.PLUGINS.teams || P === Settings.PLUGINS.collaborators)
      if (access.length) {
        res.archivedSynced++
        for (const [P, cfg] of access) {
          const n = P === Settings.PLUGINS.teams ? 'teams' : 'collaborators'
          res.archivedPlugins[n] = (res.archivedPlugins[n] || 0) + 1
          if (n === 'teams') { res.teamsSynced++; for (const g of ghosts) if ((cfg || []).some(t => String(t.name).toLowerCase() === g)) res.teamListed[g] = (res.teamListed[g] || 0) + 1 }
          if (n === 'collaborators') { (cfg || []).forEach(c => archivedUsers.add(String(c.username).toLowerCase())); res.archivedCollabEntries += Array.isArray(cfg) ? cfg.length : 0 }
        }
      }
      continue
    }
    res.active++
    if (s.getSubOrgConfig(r.name)) res.activeWithSuborg++
    if (Object.keys(s.getRepoOverrideConfig(r.name)).length) res.activeWithRepoFile++
    for (const [P, cfg] of plugins) {
      const n = names[plugins.findIndex(([Q]) => Q === P)]
      res.plugins[n] = (res.plugins[n] || 0) + 1
      if (n === 'teams') { res.teamsSynced++; for (const g of ghosts) if ((cfg || []).some(t => String(t.name).toLowerCase() === g)) res.teamListed[g] = (res.teamListed[g] || 0) + 1 }
      if (n === 'branches') res.branchEntries += (cfg || []).filter(b => b.protection !== undefined).length
      if (n === 'rulesets') res.rulesetEntries += (cfg || []).length
      if (n === 'environments') res.envEntries += (cfg || []).length
      if (n === 'collaborators') { (cfg || []).forEach(c => res.collabUsers.add(String(c.username).toLowerCase())); res.collabEntries += Array.isArray(cfg) ? cfg.length : 0 }
    }
  }
  res.collabUsersAll = new Set([...res.collabUsers, ...archivedUsers]).size // active + archived, distinct
  res.collabUsers = res.collabUsers.size
  res.suborgFiles = fs.readdirSync(path.join(gh, 'suborgs')).length
  res.repoFiles = fs.readdirSync(path.join(gh, 'repos')).length
  console.log(JSON.stringify(res, null, 1))
})().catch(e => { console.error(e); process.exit(1) })
