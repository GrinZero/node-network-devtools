import assert from 'node:assert/strict'
import { access, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { join, normalize } from 'node:path'

import { installPackedPackage, removePackedInstallation, runNode } from './packed-package.mjs'

function exportedFiles(exports, files = []) {
  if (typeof exports === 'string') {
    if (exports.startsWith('./')) files.push(exports)
    return files
  }
  if (!exports || typeof exports !== 'object') return files
  for (const value of Object.values(exports)) exportedFiles(value, files)
  return files
}

test(
  'the exact npm tarball has complete exports and resolves from CJS and ESM consumers',
  { timeout: 120_000 },
  async (t) => {
    const installation = await installPackedPackage()
    t.after(() => removePackedInstallation(installation))

    const { root, packageDirectory, manifest } = installation
    const publicTargets = new Set([
      ...exportedFiles(manifest.exports),
      ...Object.values(manifest.bin ?? {})
    ])
    assert.ok(publicTargets.size > 0, 'package.json must declare public exports or bins')

    for (const relativeTarget of publicTargets) {
      assert.ok(
        typeof relativeTarget === 'string' && relativeTarget.startsWith('./'),
        `public target must be package-relative: ${relativeTarget}`
      )
      const normalizedTarget = normalize(relativeTarget).replace(/^(\.\.[/\\])+/, '')
      assert.equal(
        normalizedTarget,
        normalize(relativeTarget),
        `public target must not escape the package: ${relativeTarget}`
      )
      await access(join(packageDirectory, normalizedTarget)).catch(() => {
        assert.fail(`packed package is missing public target ${relativeTarget}`)
      })
    }

    const installedManifest = JSON.parse(
      await readFile(join(packageDirectory, 'package.json'), 'utf8')
    )
    assert.equal(installedManifest.name, 'node-network-devtools')
    assert.match(installedManifest.version, /^\d+\.\d+\.\d+(?:[-+].+)?$/)
    assert.equal(installedManifest.engines?.node, '>=18.18')
    assert.equal(installedManifest.exports?.['./register']?.types, './dist/preload/register.d.ts')
    assert.equal(installedManifest.exports?.['./preload']?.types, './dist/preload/register.d.ts')

    const preloadDeclaration = await readFile(
      join(packageDirectory, 'dist/preload/register.d.ts'),
      'utf8'
    )
    assert.match(preloadDeclaration, /^export \{\};/)
    assert.doesNotMatch(
      preloadDeclaration,
      /declare (?:function|const) (?:preload|getPreloadHandle)/
    )

    const license = await readFile(join(packageDirectory, 'LICENSE'), 'utf8')
    assert.match(license, /^MIT License/)
    assert.match(license, /included in all\s+copies or substantial portions/)

    const commonJsEntry = join(root, 'consumer.cjs')
    await writeFile(
      commonJsEntry,
      `'use strict'\n` +
        `const assert = require('node:assert/strict')\n` +
        `const api = require('node-network-devtools')\n` +
        `const config = require('node-network-devtools/config')\n` +
        `assert.equal(typeof api.register, 'function')\n` +
        `assert.equal(typeof config.defineConfig, 'function')\n` +
        `assert.equal(config.defineConfig({ mode: 'legacy' }).mode, 'legacy')\n` +
        `process.stdout.write('cjs-consumer-ok\\n')\n`,
      'utf8'
    )
    const cjs = await runNode(commonJsEntry, { cwd: root })
    assert.match(cjs.stdout, /cjs-consumer-ok/)

    const esmEntry = join(root, 'consumer.mjs')
    await writeFile(
      esmEntry,
      `import assert from 'node:assert/strict'\n` +
        `import { register } from 'node-network-devtools'\n` +
        `import { defineConfig } from 'node-network-devtools/config'\n` +
        `assert.equal(typeof register, 'function')\n` +
        `assert.equal(typeof defineConfig, 'function')\n` +
        `assert.equal(defineConfig({ mode: 'legacy' }).mode, 'legacy')\n` +
        `process.stdout.write('esm-consumer-ok\\n')\n`,
      'utf8'
    )
    const esm = await runNode(esmEntry, { cwd: root })
    assert.match(esm.stdout, /esm-consumer-ok/)
  }
)
