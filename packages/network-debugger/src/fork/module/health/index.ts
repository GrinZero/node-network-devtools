import { createPlugin, useHandler } from '../common'

export const healthPlugin = createPlugin('health', ({ devtool }) => {
  const notFoundList: string[] = [
    'Network.setCacheDisabled',
    'Network.enable',
    'Network.setAttachDebugStack',
    'Page.enable',
    'Page.getResourceTree',
    'DOM.enable',
    'CSS.enable',
    'Overlay.enable',
    'Overlay.setShowViewportSizeOnResize',
    'Emulation.setEmulatedMedia',
    'Emulation.setEmulatedVisionDeficiency',
    'Animation.enable',
    'Autofill.enable',
    'Log.enable',
    'Autofill.setAddresses',
    'Log.startViolationsReport',
    'ServiceWorker.enable',
    'Audits.enable',
    'Inspector.enable',
    'Target.setAutoAttach',
    'Target.setDiscoverTargets',
    'Target.setRemoteLocations',
    'Network.clearAcceptedEncodingsOverride',
    'DOMDebugger.setBreakOnCSPViolation',
    'Page.setAdBlockingEnabled',
    'Emulation.setFocusEmulationEnabled',
    'Fetch.enable',
    'Page.getNavigationHistory',
    'Page.startScreencast',
    'Page.stopScreencast',
    'Overlay.setShowGridOverlays',
    'Overlay.setShowFlexOverlays',
    'Overlay.setShowScrollSnapOverlays',
    'Overlay.setShowContainerQueryOverlays',
    'Overlay.setShowIsolatedElements',
    'Page.addScriptToEvaluateOnNewDocument'
  ]

  for (const method of notFoundList) {
    useHandler(method, ({ id }) => {
      if (!id) return
      devtool.send({
        id,
        error: {
          code: -32601,
          message: `'${method}' wasn't found`
        }
      })
    })
  }
})
