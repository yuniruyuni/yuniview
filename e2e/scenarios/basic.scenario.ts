import { test } from "@playwright/test";
import { HomeScreen } from "../screens/home/HomeScreen";

test.describe("Basic Tests", () => {
  test("should load the application", async ({ page }) => {
    const homeScreen = new HomeScreen(page);

    await homeScreen.actions.goToHomePage();
    await homeScreen.state.expectHomePageTitle();
    await page.getByRole("heading", { name: "yuniview" }).waitFor();
  });
});
