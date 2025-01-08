const ErrorStash = require('./errorStash')

module.exports = class Overrides extends ErrorStash {
  static getObjectRef (data, dataKey) {
    const results = []
    const traverse = (obj) => {
      for (const key in obj) {
        if (key === dataKey) {
          results.push(obj)
        } else if (Array.isArray(obj[key])) {
          obj[key].forEach(element => traverse(element))
        } else if (typeof obj[key] === 'object' && obj[key]) {
          traverse(obj[key])
        }
      }
    }
    traverse(data)
    return results
  }

  // When {{EXTERNALLY_DEFINED}} is found in the override value, retain the
  // existing value from GitHub.
  // Note:
  //   - The admin settings could define multiple overrides, but the GitHub API
  //     retains one only.
  //   - The PUT method for rulesets (update) allows for multiple overrides.
  //   - The POST method for rulesets (create) allows for one override only.
  static removeOverrides (overrides, source, existing) {
    overrides.forEach(override => {
      let sourceRefs = Overrides.getObjectRef(source, override)
      let data = JSON.stringify(sourceRefs)
      if (data.includes('{{EXTERNALLY_DEFINED}}')) {
        let existingRefs = Overrides.getObjectRef(existing, override)
        sourceRefs.forEach(sourceRef => {
          if (existingRefs[0]) {
            sourceRef[override] = existingRefs[0][override]
          } else if (Array.isArray(sourceRef[override])) {
            sourceRef[override] = []
          } else if (typeof sourceRef[override] === 'object' && sourceRef[override]) {
            sourceRef[override] = {}
          } else {
            sourceRef[override] = ''
          }
        })
      }
    })
    return source
  }
}
