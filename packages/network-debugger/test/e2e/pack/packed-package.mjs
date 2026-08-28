import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PACKAGE_NAME = 'node-network-devtools'

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function assertTarball(path) {
  if (!path.endsWith('.tgz')) {
    throw new Error(`Expected an npm .tgz, received: ${path}`)
  }
  return realpath(path)
}

/**
 * Resolve the one package artifact downloaded by CI. Tests deliberately do not
 * fall back to `npm pack` or a repository dist directory: the exact uploaded
 * tarball is the release candidate under test.
 */
export async function locatePackedTarball() {
  if (process.env.NND_PACK_TARBALL) {
    return assertTarball(resolve(process.env.NND_PACK_TARBALL))
  }

  const directory = process.env.NND_PACK_DIR
  if (!directory) {
    throw new Error('Set NND_PACK_TARBALL or NND_PACK_DIR to the downloaded npm artifact.')
  }

  const entries = (await readdir(resolve(directory))).filter((entry) => entry.endsWith('.tgz'))
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one .tgz in ${directory}; found ${entries.length}: ${entries.join(', ')}`
    )
  }
  return assertTarball(join(resolve(directory), entries[0]))
}

export async function installPackedPackage(prefix = 'node-network-devtools-pack-') {
  const tarball = await locatePackedTarball()
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'nnd-packed-consumer', version: '0.0.0', private: true }, null, 2),
    'utf8'
  )

  try {
    await execFileAsync(
      npmExecutable(),
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
      {
        cwd: root,
        env: { ...process.env, npm_config_update_notifier: 'false' },
        // Windows npm is a .cmd shim and therefore needs cmd.exe; POSIX keeps
        // the safer direct execFile path.
        shell: process.platform === 'win32',
        maxBuffer: 10 * 1024 * 1024
      }
    )
  } catch (error) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n')
    throw new Error(`Could not install ${basename(tarball)} with ${npmExecutable()}:\n${output}`, {
      cause: error
    })
  }

  const packageDirectory = join(root, 'node_modules', PACKAGE_NAME)
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(`Installed unexpected package ${manifest.name ?? '(missing name)'}`)
  }

  return { root, packageDirectory, manifest, tarball }
}

export async function removePackedInstallation(installation) {
  if (!installation?.root) return
  await rm(installation.root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 10 : 3,
    retryDelay: 100
  })
}

export async function runNode(entry, { cwd, env = {}, args = [] } = {}) {
  try {
    return await execFileAsync(process.execPath, [...args, entry], {
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024
    })
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n')
    throw new Error(`Packed consumer ${entry} failed:\n${output}`, { cause: error })
  }
}
