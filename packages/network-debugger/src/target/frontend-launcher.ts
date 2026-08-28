import open from 'open'
import type { DevtoolsTarget } from '../adapters/types'

export async function openDevtoolsTarget(target: DevtoolsTarget): Promise<void> {
  const frontendUrl = target.devtoolsFrontendUrl ?? target.devtoolsFrontendUrlCompat
  if (!frontendUrl) {
    throw Object.assign(new Error('The selected target does not expose a DevTools frontend URL.'), {
      code: 'NND_FRONTEND_URL_UNAVAILABLE'
    })
  }

  // The browser is deliberately not retained: the target and frontend have
  // independent lifecycles, and disposing a registration must never kill a
  // user browser process.
  await open(frontendUrl, { wait: false })
}
