import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'docs/**', 'assets/**', 'scripts/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' } },
  },
)
