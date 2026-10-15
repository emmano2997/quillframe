import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.reference-pack/**',
      '**/*.generated.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Documento 02, §5.10: SQL manual só com o template $queryRaw
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message: 'Proibido: use $queryRaw com template (documento 02, §5.10).',
        },
        {
          property: '$executeRawUnsafe',
          message: 'Proibido: use $executeRaw com template (documento 02, §5.10).',
        },
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Documento 03, §11: conteúdo de usuário nunca vira HTML
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Proibido: conteúdo de usuário só como texto ou no canvas (documento 03, §11).',
        },
      ],
    },
  },
)
