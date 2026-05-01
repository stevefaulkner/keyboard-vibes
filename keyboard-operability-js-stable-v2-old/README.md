# Keyboard Operability JS Stable v2

This version removes TypeScript, tsx, esbuild, and browser global helper dependencies.

## Windows install

```powershell
cd C:\Users\sfaul\OneDrive\test\keyboard-operability-js-stable-v2
npm install
npm run install:browsers
npm run test:keyboard -- --url https://example.com --headed
```

Reports are written to `reports/`.

## Options

```powershell
npm run test:keyboard -- --url https://example.com --max-tabs 200
npm run test:keyboard -- --url https://example.com --output-dir my-reports
```
