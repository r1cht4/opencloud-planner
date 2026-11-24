module.exports = {
  input: {
    path: './src',
    include: ['**/*.js', '**/*.ts', '**/*.vue']
  },
  output: {
    locales: ['de', 'fr', 'es'],
    path: './l10n/locale',
    potPath: '../template.pot',
    jsonPath: '../translations.json',
    flat: false,
    linguas: false
  }
}
