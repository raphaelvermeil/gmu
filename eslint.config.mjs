import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.expo/**', '**/dist/**', '**/expo-env.d.ts'] },
  ...tseslint.configs.recommended,
);
