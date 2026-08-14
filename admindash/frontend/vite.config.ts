import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  // `@neoapex/workflow-forms` is a `file:` dependency, which npm SYMLINKS
  // rather than copies. Vite resolves symlinks to their real path, so an
  // `import ... from 'react'` inside workflow-forms/src resolves against
  // workflow-forms/node_modules — where its own react sits, installed as a
  // transitive devDependency of react-dom/@testing-library/react. This app's
  // own code resolves its own node_modules/react. Two distinct files, so
  // Rollup bundles TWO React copies.
  //
  // The symptom is brutal and non-obvious: workflow-forms components render
  // until one calls a hook, then read a null dispatcher off their own React
  // copy — `Cannot read properties of null (reading 'useContext')` — and
  // with no error boundary in these apps that unmounts the whole page.
  //
  // Confirmed empirically in apexflow (2026-08-14): a Rollup `moduleParsed`
  // probe showed 3 react/react-dom package roots without `dedupe` and 2
  // with it. Applied here too because this app consumes workflow-forms the
  // same way; the failure needs only a workflow-forms component that calls
  // a hook.
  //
  // Do NOT try to verify by grepping the bundle for React marker strings:
  // `react` and `react-dom` each ship their own "react.dev/errors", so the
  // count is 2 either way. The module graph is the only reliable check.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: services.services["admindash-frontend"].port,
    host: '127.0.0.1',
  },
})
