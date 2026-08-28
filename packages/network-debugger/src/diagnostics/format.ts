import type { Diagnostic } from '../adapters/types'
import type { DoctorReport } from './doctor'

function mark(level: Diagnostic['level']): string {
  if (level === 'error') return 'x'
  if (level === 'warn') return '!'
  return 'i'
}

export function formatDoctorReport(report: DoctorReport, json = false): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`

  const selected = report.selection.selected ?? 'none'
  const capabilities = Object.entries(report.capabilities)
    .filter(([, supported]) => supported)
    .map(([capability]) => capability)
  const lines = [
    `Node Network Devtools doctor (${report.ok ? 'ok' : 'failed'})`,
    `Node: ${report.nodeVersion}`,
    `Package: ${report.packageVersion}`,
    `Inspector: ${report.inspectorAvailable ? 'available' : 'unavailable'}`,
    `Experimental flag: ${report.experimentalFlag ? 'enabled' : 'missing'}`,
    `Network methods: ${report.networkMethods.available.length} available, ${report.networkMethods.missingRequired.length} required missing`,
    `Selection: ${report.selection.requested} -> ${selected}`,
    `Native capabilities: ${capabilities.length ? capabilities.join(', ') : 'none'}`,
    '',
    ...report.diagnostics.map((item) => {
      const hint = item.hint ? ` Hint: ${item.hint}` : ''
      return `[${mark(item.level)}] ${item.code}: ${item.message}${hint}`
    })
  ]
  return `${lines.join('\n')}\n`
}
