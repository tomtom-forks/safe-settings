/* eslint-disable no-undef */
const { Octokit } = require('@octokit/core')
const Settings = require('../../../lib/settings')
const yaml = require('js-yaml')
// jest.mock('../../../lib/settings', () => {
//   const OriginalSettings = jest.requireActual('../../../lib/settings')
//   //const orginalSettingsInstance = new OriginalSettings(false, stubContext, mockRepo, config, mockRef, mockSubOrg)
//   return OriginalSettings
// })

describe('Settings Tests', () => {
  let stubContext
  let mockRepo
  let stubConfig
  let mockRef
  let mockSubOrg
  let subOrgConfig

  function createSettings(config) {
    const settings = new Settings(false, stubContext, mockRepo, config, mockRef, mockSubOrg)
    return settings;
  }

  beforeEach(() => {
    const mockOctokit = jest.mocked(Octokit)
    const content = Buffer.from(`
suborgrepos:
- new-repo
#- test*
#- secret*

suborgteams:
- core

suborgproperties:
- EDP: true
- do_no_delete: true

teams:
  - name: core
    permission: bypass
  - name: docss
    permission: pull
  - name: docs
    permission: pull

validator:
  pattern: '[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+.*'

repository:
  # A comma-separated list of topics to set on the repository
  topics:
  - frontend
     `).toString('base64');
    mockOctokit.repos = {
      getContent: jest.fn().mockResolvedValue({ data: { content } })
    }

    mockOctokit.request = {
      endpoint: jest.fn().mockReturnValue({})
    }

    mockOctokit.paginate = jest.fn().mockResolvedValue([])

    stubContext = {
      payload: {
        installation: {
          id: 123
        }
      },
      octokit: mockOctokit,
      log: {
        debug: jest.fn((msg) => {
          console.log(msg)
        }),
        info: jest.fn((msg) => {
          console.log(msg)
        }),
        warn: jest.fn((msg) => {
          console.log(msg)
        }),
        error: jest.fn((msg) => {
          console.log(msg)
        })
      }
    }



    mockRepo = { owner: 'test', repo: 'test-repo' }
    mockRef = 'main'
    mockSubOrg = 'frontend'
  })

  describe('restrictedRepos', () => {
    describe('restrictedRepos not defined', () => {
      beforeEach(() => {
        stubConfig = {
          restrictedRepos: {
          }
        }
      })

      it('Allow repositories being configured', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo')).toEqual(false)
        expect(settings.isRestricted('another-repo')).toEqual(false)
      })

      it('Do not allow default excluded repositories being configured', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('.github')).toEqual(false)
        expect(settings.isRestricted('safe-settings')).toEqual(false)
        expect(settings.isRestricted('admin')).toEqual(false)
      })
    })

    describe('restrictedRepos.exclude defined', () => {
      beforeEach(() => {
        stubConfig = {
          restrictedRepos: {
            exclude: ['foo', '*-test', 'personal-*']
          }
        }
      })

      it('Skipping excluded repository from being configured', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('foo')).toEqual(true)
      })

      it('Skipping excluded repositories matching regex in restrictedRepos.exclude', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo-test')).toEqual(true)
        expect(settings.isRestricted('personal-repo')).toEqual(true)
      })

      it('Allowing repositories not matching regex in restrictedRepos.exclude', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo-test-data')).toEqual(false)
        expect(settings.isRestricted('personalization-repo')).toEqual(false)
      })
    })

    describe('restrictedRepos.include defined', () => {
      beforeEach(() => {
        stubConfig = {
          restrictedRepos: {
            include: ['foo', '*-test', 'personal-*']
          }
        }
      })

      it('Allowing repository from being configured', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('foo')).toEqual(false)
      })

      it('Allowing repositories matching regex in restrictedRepos.include', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo-test')).toEqual(false)
        expect(settings.isRestricted('personal-repo')).toEqual(false)
      })

      it('Skipping repositories not matching regex in restrictedRepos.include', () => {
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo-test-data')).toEqual(true)
        expect(settings.isRestricted('personalization-repo')).toEqual(true)
      })
    })

    describe('restrictedRepos not defined', () => {
      it('Throws TypeError if restrictedRepos not defined', () => {
        stubConfig = {}
        settings = createSettings(stubConfig)
        expect(() => settings.isRestricted('my-repo')).toThrow('Cannot read properties of undefined (reading \'include\')')
      })

      it('Throws TypeError if restrictedRepos is null', () => {
        stubConfig = {
          restrictedRepos: null
        }
        settings = createSettings(stubConfig)
        expect(() => settings.isRestricted('my-repo')).toThrow('Cannot read properties of null (reading \'include\')')
      })

      it('Allowing all repositories if restrictedRepos is empty', () => {
        stubConfig = {
          restrictedRepos: []
        }
        settings = createSettings(stubConfig)
        expect(settings.isRestricted('my-repo')).toEqual(false)
      })
    })
  }) // restrictedRepos

  describe('getRepoOverrideConfig', () => {
    describe('repository defined in a file using the .yaml extension', () => {
      beforeEach(() => {
        stubConfig = {
          repoConfigs: {
            'repository.yaml': { repository: { name: 'repository', config: 'config1' } }
          }
        }
      })

      it('Picks up a repository defined in file using the .yaml extension', () => {
        settings = createSettings(stubConfig)
        settings.repoConfigs = stubConfig.repoConfigs
        const repoConfig = settings.getRepoOverrideConfig('repository')

        expect(typeof repoConfig).toBe('object')
        expect(repoConfig).not.toBeNull()
        expect(Object.keys(repoConfig).length).toBeGreaterThan(0)
      })
    })

    describe('repository defined in a file using the .yml extension', () => {
      beforeEach(() => {
        stubConfig = {
          repoConfigs: {
            'repository.yml': { repository: { name: 'repository', config: 'config1' } }
          }
        }
      })

      it('Picks up a repository defined in file using the .yml extension', () => {
        settings = createSettings(stubConfig)
        settings.repoConfigs = stubConfig.repoConfigs
        const repoConfig = settings.getRepoOverrideConfig('repository')

        expect(typeof repoConfig).toBe('object')
        expect(repoConfig).not.toBeNull()
        expect(Object.keys(repoConfig).length).toBeGreaterThan(0)
      })
    })
  }) // repoOverrideConfig
  describe('loadConfigs', () => {
    describe('load suborg configs', () => {
      beforeEach(() => {
        stubConfig = {
          restrictedRepos: {
          }
        }
        subOrgConfig = yaml.load(`
          suborgrepos:
          - new-repo

          suborgproperties:
          - EDP: true
          - do_no_delete: true

          teams:
            - name: core
              permission: bypass
            - name: docss
              permission: pull
            - name: docs
              permission: pull

          validator:
            pattern: '[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+.*'

          repository:
            # A comma-separated list of topics to set on the repository
            topics:
            - frontend

          `)

      })

      it("Should load configMap for suborgs'", async () => {
        //mockSubOrg = jest.fn().mockReturnValue(['suborg1', 'suborg2'])
        mockSubOrg = undefined
        settings = createSettings(stubConfig)
        jest.spyOn(settings, 'loadConfigMap').mockImplementation(() => [{ name: "frontend", path: ".github/suborgs/frontend.yml" }])
        jest.spyOn(settings, 'loadYaml').mockImplementation(() => subOrgConfig)
        jest.spyOn(settings, 'getReposForTeam').mockImplementation(() => [{ name: 'repo-test' }])
        jest.spyOn(settings, 'getSubOrgRepositories').mockImplementation(() => [{ repository_name: 'repo-for-property' }])

        const subOrgConfigs = await settings.getSubOrgConfigs()
        expect(settings.loadConfigMap).toHaveBeenCalledTimes(1)

        // Get own properties of subOrgConfigs
        const ownProperties = Object.getOwnPropertyNames(subOrgConfigs);
        expect(ownProperties.length).toEqual(3)
      })

      it("Should NOT throw when a repo is found in multiple suborg configs; instead log a SUBORG_CONFLICT warning and let the last-loaded config win (TomTom fork: matches 0.3.3 silent-overwrite to avoid freezing the org sync on bad admin config)", async () => {
        mockSubOrg = undefined
        settings = createSettings(stubConfig)
        const warnSpy = jest.spyOn(settings.log, 'warn').mockImplementation(() => {})
        jest.spyOn(settings, 'loadConfigMap').mockImplementation(() => [{ name: "frontend", path: ".github/suborgs/frontend.yml" }, { name: "backend", path: ".github/suborgs/backend.yml" }])
        jest.spyOn(settings, 'loadYaml').mockImplementation(() => subOrgConfig)
        jest.spyOn(settings, 'getReposForTeam').mockImplementation(() => [{ name: 'repo-test' }])
        jest.spyOn(settings, 'getSubOrgRepositories').mockImplementation(() => [{ repository_name: 'repo-for-property' }])

        const subOrgConfigs = await settings.getSubOrgConfigs()
        expect(subOrgConfigs).toBeDefined()
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^SUBORG_CONFLICT repo=new-repo winner=.+ loser=.+$/)
        )
      })
    })
  }) // loadConfigs

  describe('loadYaml', () => {
    let settings;

    beforeEach(() => {
      Settings.fileCache = {};
      stubContext = {
        octokit: {
          repos: {
            getContent: jest.fn()
          },
          request: jest.fn(),
          paginate: jest.fn()
        },
        log: {
          debug: jest.fn(),
          info: jest.fn(),
          error: jest.fn()
        },
        payload: {
          installation: {
            id: 123
          }
        }
      };
      settings = createSettings({});
    });

    it('should return parsed YAML content when file is fetched successfully', async () => {
      // Given
      const filePath = 'path/to/file.yml';
      const content = Buffer.from('key: value').toString('base64');
      jest.spyOn(settings.github.repos, 'getContent').mockResolvedValue({
        data: { content },
        headers: { etag: 'etag123' }
      });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toEqual({ key: 'value' });
      expect(Settings.fileCache[`${mockRepo.owner}/${filePath}`]).toEqual({
        etag: 'etag123',
        data: { content }
      });
    });

    it('should return cached content when file has not changed (304 response)', async () => {
      // Given
      const filePath = 'path/to/file.yml';
      const content = Buffer.from('key: value').toString('base64');
      Settings.fileCache[`${mockRepo.owner}/${filePath}`] = { etag: 'etag123', data: { content } };
      jest.spyOn(settings.github.repos, 'getContent').mockRejectedValue({ status: 304 });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toEqual({ key: 'value' });
      expect(settings.github.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { 'If-None-Match': 'etag123' } })
      );
    });

    it('should not return cached content when the cache is for another org', async () => {
      // Given
      const filePath = 'path/to/file.yml';
      const content = Buffer.from('key: value').toString('base64');
      const wrongContent = Buffer.from('wrong: content').toString('base64');
      Settings.fileCache['another-org/path/to/file.yml'] = { etag: 'etag123', data: { wrongContent } };
      jest.spyOn(settings.github.repos, 'getContent').mockResolvedValue({
        data: { content },
        headers: { etag: 'etag123' }
      });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toEqual({ key: 'value' });
    })

    it('should return null when the file path is a folder', async () => {
      // Given
      const filePath = 'path/to/folder';
      jest.spyOn(settings.github.repos, 'getContent').mockResolvedValue({
        data: []
      });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toBeNull();
    });

    it('should return null when the file is a symlink or submodule', async () => {
      // Given
      const filePath = 'path/to/symlink';
      jest.spyOn(settings.github.repos, 'getContent').mockResolvedValue({
        data: { content: null }
      });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toBeUndefined();
    });

    it('should handle 404 errors gracefully and return null', async () => {
      // Given
      const filePath = 'path/to/nonexistent.yml';
      jest.spyOn(settings.github.repos, 'getContent').mockRejectedValue({ status: 404 });

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toBeNull();
    });

    it('should throw an error for non-404 exceptions when not in nop mode', async () => {
      // Given
      const filePath = 'path/to/error.yml';
      jest.spyOn(settings.github.repos, 'getContent').mockRejectedValue(new Error('Unexpected error'));

      // When / Then
      await expect(settings.loadYaml(filePath)).rejects.toThrow('Unexpected error');
    });

    it('should log and append NopCommand for non-404 exceptions in nop mode', async () => {
      // Given
      const filePath = 'path/to/error.yml';
      settings.nop = true;
      jest.spyOn(settings.github.repos, 'getContent').mockRejectedValue(new Error('Unexpected error'));
      jest.spyOn(settings, 'appendToResults');

      // When
      const result = await settings.loadYaml(filePath);

      // Then
      expect(result).toBeUndefined();
      expect(settings.appendToResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'ERROR',
            action: expect.objectContaining({
              msg: expect.stringContaining('Unexpected error')
            })
          })
        ])
      );
    });
  });

  describe('updateRepos shared-mutable-state regression', () => {
    // Regression test for the bug where `Object.assign(this.config.repository, ...)`
    // mutated the shared org-level config object across concurrent repo iterations,
    // causing the Repository plugin to receive a `name` belonging to a different
    // repo and emit a `PATCH /repos/{owner}/{repo}` rename request.
    //
    // The fix is to clone (`Object.assign({}, ...)`) instead of mutating.

    it('does not mutate this.config.repository when called per-repo', async () => {
      const config = {
        restrictedRepos: { exclude: [] },
        repository: { topics: ['shared'] }
      }
      const settings = createSettings(config)
      // Pre-load suborg/repo configs to avoid network calls inside updateRepos
      settings.subOrgConfigs = {}
      settings.repoConfigs = {}
      // Default beforeEach sets subOrgConfigMap (suborg='frontend') which would
      // make updateRepos early-return; clear it so the plugin path runs.
      settings.subOrgConfigMap = undefined
      // We don't need updateRepos to actually run plugins; bail out early by
      // making `repoConfig` evaluation succeed but plugins never run. The
      // assertions only need the early portion of updateRepos to execute.
      // Spy on the Repository plugin so it does no real work.
      const originalRepoPlugin = Settings.PLUGINS.repository
      Settings.PLUGINS.repository = jest.fn().mockImplementation(() => ({
        sync: jest.fn().mockResolvedValue([])
      }))
      const archiveSpy = jest
        .spyOn(require('../../../lib/plugins/archive').prototype, 'getState')
        .mockResolvedValue({ shouldArchive: false, shouldUnarchive: false })
      try {
        await settings.updateRepos({ owner: 'tomtomsptesting', repo: 'repo-a' })
        await settings.updateRepos({ owner: 'tomtomsptesting', repo: 'repo-b' })
        // The shared org config object MUST NOT have acquired a `name` field
        // from either iteration. If this assertion fails we are back to the
        // pre-fix shared-mutable-state behaviour.
        expect(config.repository).toEqual({ topics: ['shared'] })
        expect(config.repository).not.toHaveProperty('name')
        expect(config.repository).not.toHaveProperty('org')
      } finally {
        Settings.PLUGINS.repository = originalRepoPlugin
        archiveSpy.mockRestore()
      }
    })

    it('passes a per-repo `name` to the Repository plugin even under concurrent runs', async () => {
      const config = {
        restrictedRepos: { exclude: [] },
        repository: { topics: ['shared'] }
      }
      const settings = createSettings(config)
      settings.subOrgConfigs = {}
      settings.repoConfigs = {}
      settings.subOrgConfigMap = undefined
      const passedConfigs = []
      const originalRepoPlugin = Settings.PLUGINS.repository
      Settings.PLUGINS.repository = jest
        .fn()
        .mockImplementation((nop, github, repo, repoConfig) => {
          // Snapshot at construction time so a later mutation cannot rewrite history
          passedConfigs.push({ repo: repo.repo, name: repoConfig.name })
          return { sync: jest.fn().mockResolvedValue([]) }
        })
      const archiveSpy = jest
        .spyOn(require('../../../lib/plugins/archive').prototype, 'getState')
        .mockResolvedValue({ shouldArchive: false, shouldUnarchive: false })
      try {
        await Promise.all([
          settings.updateRepos({ owner: 'tomtomsptesting', repo: 'repo-a' }),
          settings.updateRepos({ owner: 'tomtomsptesting', repo: 'repo-b' }),
          settings.updateRepos({ owner: 'tomtomsptesting', repo: 'repo-c' })
        ])
        const byRepo = Object.fromEntries(passedConfigs.map(p => [p.repo, p.name]))
        expect(byRepo['repo-a']).toBe('repo-a')
        expect(byRepo['repo-b']).toBe('repo-b')
        expect(byRepo['repo-c']).toBe('repo-c')
      } finally {
        Settings.PLUGINS.repository = originalRepoPlugin
        archiveSpy.mockRestore()
      }
    })
  })
}) // Settings Tests
