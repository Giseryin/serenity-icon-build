import { defineConfig } from '@varlet/icon-builder'

export default defineConfig({
  name: 'serenity-icons',
  namespace: 'serenity',
  fontFamilyClassName: 'serenity--set',
  entry: './src/svg',
  output: './iconfonts',
})