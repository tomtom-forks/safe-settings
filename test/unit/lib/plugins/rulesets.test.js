/* eslint-disable no-undef */

const { when } = require('jest-when')
const Rulesets = require('../../../../lib/plugins/rulesets')
const version = {
  'X-GitHub-Api-Version': '2022-11-28'
}

function generateRequestRuleset(id, name, checks) {
  return {
    id: id,
    name: name,
    source_type: 'Repository',
    target: 'branch',
    enforcement: 'active',
    conditions: {
      ref_name: {
        include: ['~ALL'],
        exclude: []
      }
    },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: checks
        }
      }
    ]
  }
}

function generateResponseRuleset(id, name, checks) {
  return {
    id: id,
    name: name,
    source_type: 'Repository',
    target: 'branch',
    enforcement: 'active',
    conditions: {
      ref_name: {
        include: ['~ALL'],
        exclude: []
      }
    },
    owner: 'jitran',
    repo: 'test',
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: checks
        }
      }
    ],
    headers: version,
  }
}

describe('Rulesets', () => {
  let github
  const log = jest.fn()
  log.debug = jest.fn()
  log.error = jest.fn()

  function configure (config) {
    const noop = false
    const errors = []
    return new Rulesets(noop, github, { owner: 'jitran', repo: 'test' }, config, log, errors)
  }

  beforeEach(() => {
    github = {
      repos: {
        get: jest.fn().mockResolvedValue({
          data: {
            default_branch: 'main'
          }
        })
      },
      request: jest.fn().mockImplementation(() => Promise.resolve('request')),
    }
    
    github.request.endpoint = {
      merge: jest.fn().mockReturnValue({
        method: 'GET',
        url: '/repos/jitran/test/rulesets',
        headers: version
        })
      }
  })

  describe('sync', () => {
    it('syncs ruleset settings', () => {
      // Mock the GitHub API response
      github.paginate = jest.fn().mockResolvedValue([])

      // Initialise safe-settings
      const plugin = configure(
        [
          generateRequestRuleset(
            1,
            'All branches',
            [
              { context: 'Status Check 1' },
              { context: 'Status Check 2' }
            ]
          )
        ]
      )

      return plugin.sync().then(() => {
        expect(github.request).toHaveBeenLastCalledWith(
          'POST /repos/{owner}/{repo}/rulesets',
          generateResponseRuleset(
            1,
            'All branches',
            [
              { context: 'Status Check 1' },
              { context: 'Status Check 2' }
            ]
          )
        )
      })
    })
  })

  describe('when {{EXTERNALLY_DEFINED}} is present in "required_status_checks" and no status checks exists in GitHub', () => {
    it('it initialises the status checks with an empty list', () => {
      // Mock the GitHub API response
      github.paginate = jest.fn().mockResolvedValue([])

      // Initialise safe-settings
      const plugin = configure(
        [
          generateRequestRuleset(
            1,
            'All branches',
            [
              { context: 'Status Check 1' },
              { context: '{{EXTERNALLY_DEFINED}}' }
            ]
          )
        ]
      )

      return plugin.sync().then(() => {
        expect(github.request).toHaveBeenLastCalledWith(
          'POST /repos/{owner}/{repo}/rulesets',
          generateResponseRuleset(
            1,
            'All branches',
            []
          )
        )
      })
    })
  })

  describe('when {{EXTERNALLY_DEFINED}} is present in "required_status_checks" and status checks exists in GitHub', () => {
    it('it retains the status checks from GitHub and everything else is reset to the safe-settings', () => {
      // Mock the GitHub API response
      github.paginate = jest.fn().mockResolvedValue([
        generateRequestRuleset(
          1,
          'All branches 1',
          [
            { context: 'Custom Check 1' },
            { context: 'Custom Check 2' }
          ]
        ),
        generateRequestRuleset(
          2,
          'All branches 2',
          [
            { context: 'Custom Check 3' },
            { context: 'Custom Check 4' }
          ]
        ),
        generateRequestRuleset(
          3,
          'All branches 3',
          [
            { context: 'Custom Check 5' },
            { context: 'Custom Check 6' }
          ]
        )
      ])

      // Initialise safe-settings
      const plugin = configure(
        [
          generateRequestRuleset(
            1,
            'All branches 1',
            [
              { context: 'Status Check 1' },
              { context: '{{EXTERNALLY_DEFINED}}' }
            ]
          ),
          generateRequestRuleset(
            2,
            'All branches 2',
            [
              { context: 'Status Check 1' },
              { context: 'Status Check 2' }
            ]
          ),
          generateRequestRuleset(
            3,
            'All branches 3',
            []
          )
        ]
      )

      return plugin.sync().then(() => {
        expect(github.request).toHaveBeenNthCalledWith(
          1,
          'PUT /repos/{owner}/{repo}/rulesets/{id}',
          generateResponseRuleset(
            1,
            'All branches 1',
            [
              { context: 'Custom Check 1' },
              { context: 'Custom Check 2' }
            ]
          )
        )
        expect(github.request).toHaveBeenNthCalledWith(
          2,
          'PUT /repos/{owner}/{repo}/rulesets/{id}',
          generateResponseRuleset(
            2,
            'All branches 2',
            [
              { context: 'Status Check 1' },
              { context: 'Status Check 2' }
            ]
          )
        )
        expect(github.request).toHaveBeenNthCalledWith(
          3,
          'PUT /repos/{owner}/{repo}/rulesets/{id}',
          generateResponseRuleset(
            3,
            'All branches 3',
            []
          )
        )
      })
    })
  })
  // TODO: Write tests for org rulesets
})
