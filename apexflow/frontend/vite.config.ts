import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  // `@neoapex/workflow-forms` is a `file:` dependency, which npm SYMLINKS
  // rather than copies. Vite resolves symlinks to their real path, so an
  // `import ... from 'react'` inside workflow-forms/src resolves against
  // workflow-forms/node_modules — where its own react sits, installed as a
  // transitive devDependency of react-dom/@testing-library/react. The app's
  // own code resolves apexflow/frontend/node_modules/react. Two distinct
  // files, so Rollup bundles TWO React copies.
  //
  // The symptom is brutal and non-obvious: workflow-forms components render
  // fine until one calls a hook, then reads a null dispatcher off its own
  // React copy — `Cannot read properties of null (reading 'useContext')` —
  // and with no error boundary in this app that unmounts the whole page.
  // Only the Preview tab was affected, because PreviewPane is the only
  // place apexflow mounts a workflow-forms component.
  //
  // `dedupe` forces both specifiers onto a single copy.
  //
  // Do NOT try to verify this by grepping the bundle for React marker
  // strings: `react` and `react-dom` each ship their own copy of
  // "react.dev/errors", so the count is 2 whether or not the bug is
  // present. The only reliable check is the module graph — a temporary
  // Rollup `moduleParsed` hook collecting `node_modules/(react|react-dom)`
  // package roots prints 3 roots when broken (the third being
  // workflow-forms/node_modules/react) and 2 when correct.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: services.services["apexflow-frontend"].port,
    host: '127.0.0.1',
  },
})
