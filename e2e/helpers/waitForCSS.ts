import type { Page } from "@playwright/test";

export async function waitForCSS(page: Page) {
  // CSSファイルが読み込まれていることを確認
  await page.waitForFunction(
    () => {
      const styleSheets = Array.from(document.styleSheets);
      return styleSheets.some((sheet) => {
        try {
          return (
            sheet.href?.includes("index.css") ||
            (sheet.cssRules && sheet.cssRules.length > 0)
          );
        } catch (_e) {
          // CORS制限などでアクセスできない場合はスキップ
          return false;
        }
      });
    },
    { timeout: 30000 },
  );
}
