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

  static findParentObj (source, child, remove = false) {
    let parent = null
    const traverse = (obj, parentObj = null, parentKey = '') => {
      for (const key in obj) {
        if (obj[key] === child) {
          parent = obj
          if (remove && parentObj && parentKey) {
            delete parentObj[parentKey]
          }
        } else if (Array.isArray(obj[key])) {
          obj[key].forEach((element, index) => {
            if (element === child) {
              parent = obj[key]
              if (remove) {
                obj[key].splice(index, 1)
              }
            } else {
              traverse(element)
            }
          })
        } else if (typeof obj[key] === 'object' && obj[key]) {
          traverse(obj[key], obj, key)
        }
      }
    }
    traverse(source)
    return parent
  }

  static removeParentObj (source, child, levels) {
    let parent = child
    for (let i = 0; i < levels; i++) {
      if (i + 1 === levels) {
        parent = Overrides.findParentObj(source, parent, true)
      } else {
        parent = Overrides.findParentObj(source, parent, false)
      }
    }
  }

  // When {{EXTERNALLY_DEFINED}} is found in the override value, retain the
  // existing value from GitHub.
  // Note:
  //   - The admin settings could define multiple status check rules for a
  //     ruleset, but the GitHub API retains one only, i.e. the last one.
  //   - The PUT method for rulesets (update) allows for multiple overrides.
  //   - The POST method for rulesets (create) allows for one override only.
  static removeOverrides (overrides, source, existing) {
    Object.entries(overrides).forEach(([override, props]) => {
      let sourceRefs = Overrides.getObjectRef(source, override)
      let data = JSON.stringify(sourceRefs)
      if (data.includes('{{EXTERNALLY_DEFINED}}')) {
        let existingRefs = Overrides.getObjectRef(existing, override)
        sourceRefs.forEach(sourceRef => {
          if (existingRefs[0]) {
            sourceRef[override] = existingRefs[0][override]
          } else if (props['action'] === 'delete') {
            Overrides.removeParentObj(source, sourceRef[override], props['parents'])
          } else if (props['type'] === 'array') {
            sourceRef[override] = []
          } else if (props['type'] === 'dict') {
            sourceRef[override] = {}
          } else {
            throw new Error(`Unknown type ${props['type']} for ${override}`)
          }
        })
      }
    })
    return source
  }
}
