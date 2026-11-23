const Repository = require('../../../../lib/plugins/repository')

describe('Repository', () => {
  function mockEndpoint (path) {
    return Object.assign(jest.fn().mockResolvedValue(), {
      endpoint: jest.fn(({ owner, repo }) => ({ url: `/repos/${owner}/${repo}/${path}` }))
    })
  }

  const github = {
    repos: {
      get: jest.fn().mockResolvedValue({
        data: {
          topics: []
        }
      }),
      update: Object.assign(jest.fn().mockResolvedValue(), {
        endpoint: jest.fn(({ owner, repo }) => ({ url: `/repos/${owner}/${repo}` }))
      }),
      replaceAllTopics: jest.fn().mockResolvedValue(),
      enableVulnerabilityAlerts: mockEndpoint('vulnerability-alerts'),
      disableVulnerabilityAlerts: mockEndpoint('vulnerability-alerts'),
      enableAutomatedSecurityFixes: mockEndpoint('automated-security-fixes'),
      disableAutomatedSecurityFixes: mockEndpoint('automated-security-fixes')
    }
  }
  const log = jest.fn()
  log.debug = jest.fn()
  log.error = jest.fn()

  function configure (config, nop = false) {
    const errors = []
    return new Repository(nop, github, { owner: 'bkeepers', repo: 'test' }, config, 1, log, errors)
  }

  describe('sync', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('syncs repository settings', () => {
      const plugin = configure({
        name: 'test',
        description: 'Hello World!',
        topics: []
      })
      return plugin.sync().then(() => {
        expect(github.repos.update).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          name: 'test',
          description: 'Hello World!',
          mediaType: { previews: ['nebula-preview'] }
        })
      })
    })

    it('handles renames', () => {
      const plugin = configure({
        name: 'new-name'
      })
      return plugin.sync().then(() => {
        expect(github.repos.update).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          name: 'new-name',
          mediaType: { previews: ['nebula-preview'] }
        })
      })
    })

    it('syncs topics', () => {
      const plugin = configure({
        topics: ['foo', 'bar']
      })

      return plugin.sync().then(() => {
        expect(github.repos.replaceAllTopics).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          names: ['foo', 'bar'],
          mediaType: {
            previews: ['mercy']
          }
        })
      })
    })

    describe('security', () => {
      beforeEach(() => {
        github.repos.get.mockResolvedValueOnce({
          data: {
            name: 'test',
            owner: { login: 'bkeepers' },
            topics: []
          }
        })
      })

      it('enables automated security fixes when nothing else changed', () => {
        const plugin = configure({
          security: { enableAutomatedSecurityFixes: true }
        })

        return plugin.sync().then(() => {
          expect(github.repos.update).not.toHaveBeenCalled()
          expect(github.repos.enableAutomatedSecurityFixes).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test'
          })
        })
      })

      it('disables automated security fixes when nothing else changed', () => {
        const plugin = configure({
          security: { enableAutomatedSecurityFixes: false }
        })

        return plugin.sync().then(() => {
          expect(github.repos.update).not.toHaveBeenCalled()
          expect(github.repos.disableAutomatedSecurityFixes).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test'
          })
        })
      })

      it('enables automated security fixes along with other repository changes', () => {
        const plugin = configure({
          description: 'Hello World!',
          security: { enableAutomatedSecurityFixes: true }
        })

        return plugin.sync().then(() => {
          expect(github.repos.update).toHaveBeenCalled()
          expect(github.repos.enableAutomatedSecurityFixes).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test'
          })
        })
      })

      it('enables automated security fixes only after vulnerability alerts', async () => {
        let resolveAlerts
        github.repos.enableVulnerabilityAlerts.mockReturnValueOnce(new Promise(resolve => { resolveAlerts = resolve }))
        const plugin = configure({
          security: { enableVulnerabilityAlerts: true, enableAutomatedSecurityFixes: true }
        })

        const syncing = plugin.sync()
        await new Promise(setImmediate)
        expect(github.repos.enableVulnerabilityAlerts).toHaveBeenCalled()
        expect(github.repos.enableAutomatedSecurityFixes).not.toHaveBeenCalled()

        resolveAlerts()
        await syncing
        expect(github.repos.enableAutomatedSecurityFixes).toHaveBeenCalled()
      })

      it('reports automated security fixes in a dry run when nothing else changed', () => {
        const plugin = configure({
          security: { enableAutomatedSecurityFixes: true }
        }, true)

        return plugin.sync().then(res => {
          expect(github.repos.enableAutomatedSecurityFixes).not.toHaveBeenCalled()
          expect(res).toContainEqual(expect.objectContaining({
            endpoint: '/repos/bkeepers/test/automated-security-fixes',
            action: expect.objectContaining({ msg: 'Enabling Dependabot security updates' })
          }))
        })
      })

      it('reports automated security fixes in a dry run along with other repository changes', () => {
        const plugin = configure({
          description: 'Hello World!',
          security: { enableVulnerabilityAlerts: true, enableAutomatedSecurityFixes: true }
        }, true)

        return plugin.sync().then(res => {
          expect(res.map(command => command.endpoint)).toEqual(expect.arrayContaining([
            '/repos/bkeepers/test',
            '/repos/bkeepers/test/vulnerability-alerts',
            '/repos/bkeepers/test/automated-security-fixes'
          ]))
        })
      })
    })
  })
})
