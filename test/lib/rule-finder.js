const path = require('path');
const assert = require('assert');
const proxyquire = require('proxyquire');

let ModuleResolver;
try {
  // eslint 6 and over: load the actual module
  // eslint-disable-next-line import/no-unresolved
  ModuleResolver = require('eslint/lib/shared/relative-module-resolver');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') {
    throw err;
  }
  // eslint < 6: ModuleResolver is `undefined`, which is okay. The proxyquire
  // override for ../shared/relative-module-resolver won't be used because
  // eslint < 6 does not have that module and so does not try to load it.
  ModuleResolver = undefined;
}

const processCwd = process.cwd;

const eslintVersion = process.env.ESLINT === '3' || process.env.ESLINT === '4' ? '<v5' : 'v5+';
const supportsScopedPlugins = process.env.ESLINT !== '3' && process.env.ESLINT !== '4';

const getRuleFinder = proxyquire('../../src/lib/rule-finder', {
  eslint: {
    linter: {
      getRules() {
        return new Map()
          .set('foo-rule', {})
          .set('old-rule', {meta: {deprecated: true}})
          .set('bar-rule', {})
          .set('baz-rule', {});
      }
    }
  },
  //
  // This following module override is needed for eslint v6 and over. The module
  // path that we pass here is literally the one used in eslint (specifially in
  // eslint/lib/cli-engine/config-array-factory.js)
  //
  // The stock `resolve` method attempts to resolve to a file path the module
  // name passed in `name` relative to the path in `relative`. We have to
  // override that function, otherwise eslint fails to "load" our plugins.
  //
  '../shared/relative-module-resolver': {
    resolve(name, relative) {
      // The strategy is simple: if called with one of our plugins, just return
      // the module name, as-is. This is a lie because what we return is not a
      // path, but it is simple, and works. Otherwise, we just call the original
      // `resolve` from the stock module.
      return ['eslint-plugin-plugin',
        'eslint-plugin-no-rules',
        '@scope/eslint-plugin-scoped-plugin',
        '@scope/eslint-plugin'].includes(name) ?
        name :
        ModuleResolver.resolve(name, relative);
    },
    '@global': true,
    '@noCallThru': true
  },
  'eslint-plugin-plugin': {
    rules: {
      'foo-rule': {},
      'bar-rule': {},
      'old-plugin-rule': {meta: {deprecated: true}},
      'baz-rule': {}
    },
    '@noCallThru': true,
    '@global': true
  },
  'eslint-plugin-no-rules': {
    processors: {},
    '@noCallThru': true,
    '@global': true
  },
  '@scope/eslint-plugin-scoped-plugin': {
    rules: {
      'foo-rule': {},
      'old-plugin-rule': {meta: {deprecated: true}},
      'bar-rule': {}
    },
    '@noCallThru': true,
    '@global': true
  },
  '@scope/eslint-plugin': {
    rules: {
      'foo-rule': {},
      'old-plugin-rule': {meta: {deprecated: true}},
      'bar-rule': {}
    },
    '@noCallThru': true,
    '@global': true
  }
});

function assertDeepEqual(a, b) {
  if (supportsScopedPlugins) {
    return assert.deepEqual(a, b);
  }

  if (Array.isArray(b)) {
    return assert.deepEqual(a, b.filter(s => !s.startsWith('@')));
  }

  const bWithoutScoped = Object.keys(b).filter(s => !s.startsWith('@')).reduce((acc, k) => {
    acc[k] = b[k];
    return acc;
  }, {});

  return assert.deepEqual(a, bWithoutScoped);
}

const getRuleFinderForDedupeTests = proxyquire('../../src/lib/rule-finder', {
  eslint: {
    linter: {
      getRules() {
        return new Map()
          .set('foo-rule', {})
          .set('bar-rule', {})
          .set('plugin/duplicate-foo-rule', {})
          .set('plugin/duplicate-bar-rule', {});
      }
    }
  },
  // See the long comment in `getRuleFinder` above to learn what the point of
  // this override is.
  '../shared/relative-module-resolver': {
    resolve(name, relative) {
      return name === 'eslint-plugin-plugin' ?
        name :
        ModuleResolver.resolve(name, relative);
    },
    '@global': true,
    '@noCallThru': true
  },
  'eslint-plugin-plugin': {
    rules: {
      'duplicate-foo-rule': {},
      'duplicate-bar-rule': {}
    },
    '@noCallThru': true,
    '@global': true
  }
});

const noSpecifiedFile = path.resolve(process.cwd(), `./test/fixtures/${eslintVersion}/no-path`);
const specifiedFileRelative = `./test/fixtures/${eslintVersion}/eslint.json`;
const specifiedFileAbsolute = path.join(process.cwd(), specifiedFileRelative);
const noRulesFile = path.join(process.cwd(), `./test/fixtures/${eslintVersion}/eslint-with-plugin-with-no-rules.json`);
const noDuplicateRulesFiles = `./test/fixtures/${eslintVersion}/eslint-dedupe-plugin-rules.json`;
const usingDeprecatedRulesFile = path.join(process.cwd(), `./test/fixtures/${eslintVersion}/eslint-with-deprecated-rules.json`);

describe('rule-finder', () => {
  afterEach(() => {
    process.cwd = processCwd;
  });

  it('no specifiedFile - unused rules', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder();
    assertDeepEqual(ruleFinder.getUnusedRules(), ['bar-rule', 'baz-rule']);
  });

  it('no specifiedFile - unused rules including deprecated', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder(null, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getUnusedRules(), ['bar-rule', 'baz-rule', 'old-rule']);
  });

  it('no specifiedFile - current rules', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder();
    assertDeepEqual(ruleFinder.getCurrentRules(), ['foo-rule']);
  });

  it('no specifiedFile - current rule config', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder();
    assertDeepEqual(ruleFinder.getCurrentRulesDetailed(), {'foo-rule': [2]});
  });

  it('no specifiedFile - plugin rules', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder();
    assertDeepEqual(ruleFinder.getPluginRules(), []);
  });

  it('no specifiedFile - all available rules', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder();
    assertDeepEqual(ruleFinder.getAllAvailableRules(), ['bar-rule', 'baz-rule', 'foo-rule']);
  });

  it('no specifiedFile - all available rules without core', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder(null, {omitCore: true});
    assertDeepEqual(ruleFinder.getAllAvailableRules(), []);
  });

  it('no specifiedFile - all available rules including deprecated', () => {
    process.cwd = function () {
      return noSpecifiedFile;
    };
    const ruleFinder = getRuleFinder(null, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getAllAvailableRules(), ['bar-rule', 'baz-rule', 'foo-rule', 'old-rule']);
  });

  it('specifiedFile (relative path) - unused rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative);
    assertDeepEqual(ruleFinder.getUnusedRules(), [
      '@scope/bar-rule',
      '@scope/scoped-plugin/bar-rule',
      'baz-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule'
    ]);
  });

  it('specifiedFile (relative path) - unused rules including deprecated', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getUnusedRules(), [
      '@scope/bar-rule',
      '@scope/old-plugin-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/old-plugin-rule',
      'baz-rule',
      'old-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule',
      'plugin/old-plugin-rule'
    ]);
  });

  it('specifiedFile (relative path) - current rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative);
    assertDeepEqual(ruleFinder.getCurrentRules(), [
      '@scope/foo-rule',
      '@scope/scoped-plugin/foo-rule',
      'bar-rule',
      'foo-rule'
    ]);
  });

  it('specifiedFile (relative path) - current rule config', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative);
    assertDeepEqual(ruleFinder.getCurrentRulesDetailed(), {
      '@scope/foo-rule': [2],
      '@scope/scoped-plugin/foo-rule': [2],
      'bar-rule': [2],
      'foo-rule': [2]
    });
  });

  it('specifiedFile (relative path) - plugin rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative);
    assertDeepEqual(ruleFinder.getPluginRules(), [
      '@scope/bar-rule',
      '@scope/foo-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/foo-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule'
    ]);
  });

  it('specifiedFile (relative path) - plugin rules including deprecated', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getPluginRules(), [
      '@scope/bar-rule',
      '@scope/foo-rule',
      '@scope/old-plugin-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/foo-rule',
      '@scope/scoped-plugin/old-plugin-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule',
      'plugin/old-plugin-rule'
    ]);
  });

  it('specifiedFile (relative path) - all available rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative);
    assertDeepEqual(
      ruleFinder.getAllAvailableRules(),
      [
        '@scope/bar-rule',
        '@scope/foo-rule',
        '@scope/scoped-plugin/bar-rule',
        '@scope/scoped-plugin/foo-rule',
        'bar-rule',
        'baz-rule',
        'foo-rule',
        'plugin/bar-rule',
        'plugin/baz-rule',
        'plugin/foo-rule'
      ]
    );
  });

  it('specifiedFile (relative path) - all available rules without core', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative, {omitCore: true});
    assertDeepEqual(
      ruleFinder.getAllAvailableRules(),
      [
        '@scope/bar-rule',
        '@scope/foo-rule',
        '@scope/scoped-plugin/bar-rule',
        '@scope/scoped-plugin/foo-rule',
        'plugin/bar-rule',
        'plugin/baz-rule',
        'plugin/foo-rule'
      ]
    );
  });

  it('specifiedFile (relative path) - all available rules including deprecated', () => {
    const ruleFinder = getRuleFinder(specifiedFileRelative, {includeDeprecated: true});
    assertDeepEqual(
      ruleFinder.getAllAvailableRules(),
      [
        '@scope/bar-rule',
        '@scope/foo-rule',
        '@scope/old-plugin-rule',
        '@scope/scoped-plugin/bar-rule',
        '@scope/scoped-plugin/foo-rule',
        '@scope/scoped-plugin/old-plugin-rule',
        'bar-rule',
        'baz-rule',
        'foo-rule',
        'old-rule',
        'plugin/bar-rule',
        'plugin/baz-rule',
        'plugin/foo-rule',
        'plugin/old-plugin-rule'
      ]
    );
  });

  it('specifiedFile (absolute path) - unused rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(ruleFinder.getUnusedRules(), [
      '@scope/bar-rule',
      '@scope/scoped-plugin/bar-rule',
      'baz-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule'
    ]);
  });

  it('specifiedFile (absolute path) - unused rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getUnusedRules(), [
      '@scope/bar-rule',
      '@scope/old-plugin-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/old-plugin-rule',
      'baz-rule',
      'old-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule',
      'plugin/old-plugin-rule'
    ]);
  });

  it('specifiedFile (absolute path) - current rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(ruleFinder.getCurrentRules(), [
      '@scope/foo-rule',
      '@scope/scoped-plugin/foo-rule',
      'bar-rule',
      'foo-rule'
    ]);
  });

  it('specifiedFile (absolute path) - current rule config', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(ruleFinder.getCurrentRulesDetailed(), {
      '@scope/foo-rule': [2],
      '@scope/scoped-plugin/foo-rule': [2],
      'foo-rule': [2],
      'bar-rule': [2]
    });
  });

  it('specifiedFile (absolute path) - plugin rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(ruleFinder.getPluginRules(), [
      '@scope/bar-rule',
      '@scope/foo-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/foo-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule'
    ]);
  });

  it('specifiedFile (absolute path) - plugin rules including deprecated', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute, {includeDeprecated: true});
    assertDeepEqual(ruleFinder.getPluginRules(), [
      '@scope/bar-rule',
      '@scope/foo-rule',
      '@scope/old-plugin-rule',
      '@scope/scoped-plugin/bar-rule',
      '@scope/scoped-plugin/foo-rule',
      '@scope/scoped-plugin/old-plugin-rule',
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule',
      'plugin/old-plugin-rule'
    ]);
  });

  it('specifiedFile (absolute path) - all available rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(
      ruleFinder.getAllAvailableRules(),
      [
        '@scope/bar-rule',
        '@scope/foo-rule',
        '@scope/scoped-plugin/bar-rule',
        '@scope/scoped-plugin/foo-rule',
        'bar-rule',
        'baz-rule',
        'foo-rule',
        'plugin/bar-rule',
        'plugin/baz-rule',
        'plugin/foo-rule'
      ]
    );
  });

  it('specifiedFile (absolute path) - all available rules including deprecated', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute, {includeDeprecated: true});
    assertDeepEqual(
      ruleFinder.getAllAvailableRules(),
      [
        '@scope/bar-rule',
        '@scope/foo-rule',
        '@scope/old-plugin-rule',
        '@scope/scoped-plugin/bar-rule',
        '@scope/scoped-plugin/foo-rule',
        '@scope/scoped-plugin/old-plugin-rule',
        'bar-rule',
        'baz-rule',
        'foo-rule',
        'old-rule',
        'plugin/bar-rule',
        'plugin/baz-rule',
        'plugin/foo-rule',
        'plugin/old-plugin-rule'
      ]
    );
  });

  it('specifiedFile (absolute path) without rules - plugin rules', () => {
    const ruleFinder = getRuleFinder(noRulesFile);
    assertDeepEqual(ruleFinder.getPluginRules(), [
      'plugin/bar-rule',
      'plugin/baz-rule',
      'plugin/foo-rule'
    ]);
  });

  it('dedupes plugin rules - all available rules', () => {
    const ruleFinder = getRuleFinderForDedupeTests(noDuplicateRulesFiles);
    assertDeepEqual(ruleFinder.getAllAvailableRules(), [
      'bar-rule',
      'foo-rule',
      'plugin/duplicate-bar-rule',
      'plugin/duplicate-foo-rule'
    ]);
  });

  it('dedupes plugin rules - unused rules', () => {
    const ruleFinder = getRuleFinderForDedupeTests(noDuplicateRulesFiles);
    assertDeepEqual(ruleFinder.getUnusedRules(), [
      'bar-rule',
      'plugin/duplicate-foo-rule'
    ]);
  });

  it('specifiedFile (absolute path) without deprecated rules - deprecated rules', () => {
    const ruleFinder = getRuleFinder(specifiedFileAbsolute);
    assertDeepEqual(ruleFinder.getDeprecatedRules(), []);
  });

  it('specifiedFile (absolute path) with deprecated rules - deprecated rules', () => {
    const ruleFinder = getRuleFinder(usingDeprecatedRulesFile);
    assertDeepEqual(ruleFinder.getDeprecatedRules(), [
      '@scope/old-plugin-rule',
      '@scope/scoped-plugin/old-plugin-rule',
      'old-rule',
      'plugin/old-plugin-rule'
    ]);
  });
});
