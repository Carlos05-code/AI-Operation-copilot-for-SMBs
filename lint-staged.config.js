module.exports = {
  '*.{js,ts,tsx,md,json,yml,yaml}': ['prettier --write'],
  '*.{ts,tsx,js}': ['eslint --fix'],
  '*.{ts,tsx}': ['tsc --noEmit'],
};
