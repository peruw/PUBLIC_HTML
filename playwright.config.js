// Testes e2e do portal /professores/ (Playwright, Supabase mockado em http://supabase.test)
import { defineConfig, devices } from '@playwright/test';

// Porta/pasta configuráveis para rodar mais de uma suíte ao mesmo tempo (E2E_PORT=4174 npx playwright test)
const PORT = Number(process.env.E2E_PORT || 4173);
// Build de teste fica fora do dist/ (que é o que vai para a Hostinger); .vite/ já está no .gitignore
const OUT = `.vite/e2e-dist-${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: '.vite/test-results', // traces/screenshots de falha (fora do git)
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build --outDir ${OUT} --emptyOutDir && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/professores/`,
    // Sempre sobe um build novo com o Supabase falso (nunca reaproveita um servidor com config real)
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://supabase.test',
      VITE_SUPABASE_ANON_KEY: 'test',
    },
  },
});
