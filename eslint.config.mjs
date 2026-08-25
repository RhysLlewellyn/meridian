import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  // Build output and vendored code. `.next` in particular holds generated
  // bundles that would otherwise be linted on every run.
  {ignores: ['.next/**', '.vercel/**', 'node_modules/**', 'next-env.d.ts']},
  ...coreWebVitals,
  ...typescript,
]

export default config
